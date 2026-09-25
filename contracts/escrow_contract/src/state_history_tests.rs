#[cfg(test)]
#[allow(clippy::module_inception)]
mod state_history_tests {
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, Vec};

    use crate::{
        EscrowContract, EscrowContractClient, EscrowError, EscrowStatus, MultisigConfig,
        StateHistoryEntry, MAX_ESCROW_AMOUNT, MIN_ESCROW_AMOUNT,
    };

    fn setup() -> (
        Env,
        Address,
        Address,
        Address,
        EscrowContractClient<'static>,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);
        contract.initialize(&admin);

        (env, admin, client, freelancer, contract)
    }

    fn register_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = soroban_sdk::token::StellarAssetClient::new(env, &token_id.address());
        sac.mint(recipient, &amount);
        token_id.address()
    }

    fn hash32(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[1u8; 32])
    }

    fn no_multisig(env: &Env) -> MultisigConfig {
        MultisigConfig {
            approvers: soroban_sdk::Vec::new(env),
            weights: soroban_sdk::Vec::new(env),
            threshold: 0,
        }
    }

    #[test]
    fn test_state_history_records_create() {
        let (env, _admin, client, freelancer, contract) = setup();
        let token = register_token(&env, &_admin, &client, MAX_ESCROW_AMOUNT);
        let result = contract.create_escrow(
            &client,
            &freelancer,
            &token,
            &100_000,
            &hash32(&env),
            &None,
            &None,
            &None,
            &None,
            &no_multisig(&env),
        );
        assert!(result.is_ok());
        let escrow_id = result.unwrap();

        let history = contract.get_state_history(escrow_id);
        // At minimum the creation should be recorded
        assert!(!history.is_empty());
    }

    #[test]
    fn test_state_history_entry_fields() {
        let env = Env::default();
        env.mock_all_auths();
        let caller = Address::generate(&env);
        let entry = StateHistoryEntry {
            escrow_id: 1,
            from_status: EscrowStatus::Active,
            to_status: EscrowStatus::Completed,
            timestamp: env.ledger().timestamp(),
            caller: caller.clone(),
        };
        assert_eq!(entry.escrow_id, 1);
        assert_eq!(entry.from_status, EscrowStatus::Active);
        assert_eq!(entry.to_status, EscrowStatus::Completed);
        assert_eq!(entry.caller, caller);
    }

    #[test]
    fn test_state_history_pruning_at_capacity() {
        let env = Env::default();
        env.mock_all_auths();
        let caller = Address::generate(&env);
        let escrow_id = 42u64;

        // Record more than MAX_STATE_HISTORY_ENTRIES (55 entries)
        for i in 0..55 {
            let status_from = if i % 2 == 0 {
                EscrowStatus::Active
            } else {
                EscrowStatus::Disputed
            };
            let status_to = if i % 2 == 0 {
                EscrowStatus::Disputed
            } else {
                EscrowStatus::Active
            };
            crate::state_history::record_state_change(
                &env,
                escrow_id,
                status_from,
                status_to,
                &caller,
            );
        }

        let history = crate::state_history::get_state_history(&env, escrow_id);
        // Bounded retention: total entries should not exceed MAX_STATE_HISTORY_ENTRIES (50)
        assert_eq!(history.len(), crate::state_history::MAX_STATE_HISTORY_ENTRIES);
    }

    #[test]
    fn test_state_history_bounded_query() {
        let env = Env::default();
        env.mock_all_auths();
        let caller = Address::generate(&env);
        let escrow_id = 99u64;

        // Record 25 entries
        for _ in 0..25 {
            crate::state_history::record_state_change(
                &env,
                escrow_id,
                EscrowStatus::Active,
                EscrowStatus::Disputed,
                &caller,
            );
        }

        // Bounded query first page
        let page1 = crate::state_history::get_state_history_bounded(&env, escrow_id, 0, 10);
        assert_eq!(page1.len(), 10);

        // Bounded query second page
        let page2 = crate::state_history::get_state_history_bounded(&env, escrow_id, 10, 10);
        assert_eq!(page2.len(), 10);

        // Bounded query final partial page
        let page3 = crate::state_history::get_state_history_bounded(&env, escrow_id, 20, 10);
        assert_eq!(page3.len(), 5);

        // Query beyond range returns empty
        let page_empty = crate::state_history::get_state_history_bounded(&env, escrow_id, 30, 10);
        assert_eq!(page_empty.len(), 0);

        // Limit exceeding MAX_HISTORY_PAGE_SIZE is capped
        let all_capped = crate::state_history::get_state_history_bounded(&env, escrow_id, 0, 100);
        assert_eq!(all_capped.len(), 25);
    }

    #[test]
    fn test_state_history_bounded_query_via_contract_client() {
        let (env, _admin, client, freelancer, contract) = setup();
        let token = register_token(&env, &_admin, &client, MAX_ESCROW_AMOUNT);
        let escrow_id = contract
            .create_escrow(
                &client,
                &freelancer,
                &token,
                &100_000,
                &hash32(&env),
                &None,
                &None,
                &None,
                &None,
                &no_multisig(&env),
            )
            .unwrap();

        // Query bounded history via contract entry point
        let page = contract.get_state_history_bounded(&escrow_id, &0, &10);
        assert_eq!(page.len(), 1);
        assert_eq!(page.get(0).unwrap().escrow_id, escrow_id);
    }
}
