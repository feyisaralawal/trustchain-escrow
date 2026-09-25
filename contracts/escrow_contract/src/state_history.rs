use soroban_sdk::{Address, Env, Vec};

use crate::errors::EscrowError;
use crate::storage::ContractStorage;
use crate::types::{DataKey, EscrowStatus, StateHistoryEntry};

/// Maximum number of historical state transitions retained per escrow.
/// Older entries are pruned (FIFO) when this limit is exceeded to prevent unbounded storage growth.
pub const MAX_STATE_HISTORY_ENTRIES: u32 = 50;

/// Maximum entries returned in a single bounded history query.
pub const MAX_HISTORY_PAGE_SIZE: u32 = 50;

pub fn record_state_change(
    env: &Env,
    escrow_id: u64,
    from_status: EscrowStatus,
    to_status: EscrowStatus,
    caller: &Address,
) {
    let key = DataKey::StateHistory(escrow_id);
    let now = env.ledger().timestamp();
    let entry = StateHistoryEntry {
        escrow_id,
        from_status,
        to_status,
        timestamp: now,
        caller: caller.clone(),
    };
    let mut history: Vec<StateHistoryEntry> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    history.push_back(entry);

    // Prune oldest entries if history exceeds retention limit
    while history.len() > MAX_STATE_HISTORY_ENTRIES {
        history.remove(0);
    }

    env.storage().persistent().set(&key, &history);
    ContractStorage::bump_persistent_ttl(env, &key);
}

pub fn get_state_history(env: &Env, escrow_id: u64) -> Vec<StateHistoryEntry> {
    let key = DataKey::StateHistory(escrow_id);
    match env.storage().persistent().get(&key) {
        Some(history) => {
            ContractStorage::bump_persistent_ttl(env, &key);
            history
        }
        None => Vec::new(env),
    }
}

/// Returns a paginated/bounded window of the state history for an escrow.
/// `limit` is capped at `MAX_HISTORY_PAGE_SIZE`.
pub fn get_state_history_bounded(
    env: &Env,
    escrow_id: u64,
    offset: u32,
    limit: u32,
) -> Vec<StateHistoryEntry> {
    let history = get_state_history(env, escrow_id);
    let capped_limit = limit.min(MAX_HISTORY_PAGE_SIZE) as usize;
    let total_len = history.len() as usize;
    let start = (offset as usize).min(total_len);
    let end = (start + capped_limit).min(total_len);

    let mut result = Vec::new(env);
    for i in start..end {
        if let Some(entry) = history.get(i as u32) {
            result.push_back(entry);
        }
    }
    result
}

