#![allow(dead_code)]
//! Comprehensive input validation for all entry points.
//!
//! Centralizes validation logic so every entry point enforces consistent
//! bounds and constraints before touching storage.
//!
//! Closes #102

use soroban_sdk::{BytesN, Env, String};

use crate::errors::EscrowError;

/// Maximum allowed title length (bytes) for milestone titles.
pub const MAX_TITLE_LENGTH: u32 = 256;

/// Maximum allowed string length for cancellation reasons.
pub const MAX_REASON_LENGTH: u32 = 1024;

/// Maximum number of buyer signers per escrow.
pub const MAX_BUYER_SIGNERS: u32 = 10;

/// Maximum escrow amount to prevent overflow in downstream math.
pub const MAX_ESCROW_AMOUNT: i128 = i128::MAX / 2;

/// Validate that an amount is strictly positive and within safe bounds.
pub fn validate_amount(amount: i128) -> Result<(), EscrowError> {
    if amount <= 0 {
        return Err(EscrowError::InvalidAmount);
    }
    if amount > MAX_ESCROW_AMOUNT {
        return Err(EscrowError::AmountOverflow);
    }
    Ok(())
}

/// Validate that a brief hash is not all zeros.
pub fn validate_brief_hash(env: &Env, hash: &BytesN<32>) -> Result<(), EscrowError> {
    if hash == &BytesN::from_array(env, &[0u8; 32]) {
        return Err(EscrowError::InvalidBriefHash);
    }
    Ok(())
}

/// Validate that a deadline, if provided, is in the future.
pub fn validate_deadline(env: &Env, deadline: Option<u64>) -> Result<(), EscrowError> {
    if let Some(dl) = deadline {
        let now = env.ledger().timestamp();
        if dl <= now {
            return Err(EscrowError::DeadlineInPast);
        }
    }
    Ok(())
}

/// Validate that a lock_time, if provided, is in the future.
pub fn validate_lock_time(env: &Env, lock_time: Option<u64>) -> Result<(), EscrowError> {
    if let Some(lt) = lock_time {
        let now = env.ledger().timestamp();
        if lt <= now {
            return Err(EscrowError::LockTimeInPast);
        }
    }
    Ok(())
}

/// Validate milestone title length.
pub fn validate_title(title: &String) -> Result<(), EscrowError> {
    if title.len() == 0 {
        return Err(EscrowError::TitleEmpty);
    }
    if title.len() > MAX_TITLE_LENGTH {
        return Err(EscrowError::TitleTooLong);
    }
    Ok(())
}

/// Validate that two addresses are distinct (e.g. client != freelancer).
pub fn validate_distinct_parties(
    a: &soroban_sdk::Address,
    b: &soroban_sdk::Address,
) -> Result<(), EscrowError> {
    if a == b {
        return Err(EscrowError::E3);
    }
    Ok(())
}

/// Validate that the number of buyer signers does not exceed the cap.
pub fn validate_signer_count(count: u32) -> Result<(), EscrowError> {
    if count > MAX_BUYER_SIGNERS {
        return Err(EscrowError::TooManySigners);
    }
    Ok(())
}

/// Minimum length for a valid evidence reference string (CIDv0 is 46, hex sha256 is 64).
pub const MIN_EVIDENCE_REF_LEN: u32 = 32;

/// Maximum length for a valid evidence reference string.
pub const MAX_EVIDENCE_REF_LEN: u32 = 128;

/// Validate accepted evidence hash formats and reject empty, oversized, or malformed evidence references.
/// Supported formats:
/// - IPFS CIDv0: Base58btc starting with "Qm", exactly 46 characters.
/// - IPFS CIDv1: Base32 starting with "bafy" or "bafk", length between 50 and 64 characters.
/// - Hex SHA-256: 64 hexadecimal characters.
/// Rejects empty values, oversized values (> 128 characters), and invalid characters.
pub fn validate_evidence_reference(evidence_ref: &String) -> Result<(), EscrowError> {
    let len = evidence_ref.len();
    if len == 0 {
        return Err(EscrowError::EvidenceEmpty);
    }
    if len > MAX_EVIDENCE_REF_LEN {
        return Err(EscrowError::EvidenceTooLong);
    }
    if len < MIN_EVIDENCE_REF_LEN {
        return Err(EscrowError::EvidenceInvalidFormat);
    }

    let mut buf = [0u8; 128];
    let slice_len = (len as usize).min(128);
    evidence_ref.copy_into_slice(&mut buf[..slice_len]);
    let bytes = &buf[..slice_len];

    // Reject non-alphanumeric characters (spaces, punctuation, control chars)
    if !bytes.iter().all(|&b| b.is_ascii_alphanumeric()) {
        return Err(EscrowError::EvidenceInvalidFormat);
    }

    // IPFS CIDv0 format: "Qm" prefix, 46 characters, Base58btc (no '0', 'O', 'I', 'l')
    if bytes.starts_with(b"Qm") {
        if len == 46 {
            let base58_invalid = bytes.iter().any(|&b| b == b'0' || b == b'O' || b == b'I' || b == b'l');
            if base58_invalid {
                return Err(EscrowError::EvidenceInvalidFormat);
            }
            return Ok(());
        }
        return Err(EscrowError::EvidenceInvalidFormat);
    }

    // IPFS CIDv1 format: "bafy" or "bafk" prefix, 50-64 characters
    if bytes.starts_with(b"bafy") || bytes.starts_with(b"bafk") {
        if len >= 50 && len <= 64 {
            return Ok(());
        }
        return Err(EscrowError::EvidenceInvalidFormat);
    }

    // Hexadecimal SHA-256 hash: 64 hex characters
    if len == 64 {
        let is_hex = bytes.iter().all(|&b| {
            (b >= b'0' && b <= b'9') || (b >= b'a' && b <= b'f') || (b >= b'A' && b <= b'F')
        });
        if is_hex {
            return Ok(());
        }
    }

    Err(EscrowError::EvidenceInvalidFormat)
}

/// Validate evidence hash (raw 32-byte representation). Rejects zeroed hash.
pub fn validate_evidence_hash(env: &Env, hash: &BytesN<32>) -> Result<(), EscrowError> {
    if hash == &BytesN::from_array(env, &[0u8; 32]) {
        return Err(EscrowError::E80);
    }
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_validate_amount_positive() {
        assert!(validate_amount(100).is_ok());
    }

    #[test]
    fn test_validate_amount_zero_rejected() {
        assert!(validate_amount(0).is_err());
    }

    #[test]
    fn test_validate_amount_negative_rejected() {
        assert!(validate_amount(-1).is_err());
    }

    #[test]
    fn test_validate_amount_overflow_rejected() {
        assert!(validate_amount(MAX_ESCROW_AMOUNT + 1).is_err());
    }

    #[test]
    fn test_validate_brief_hash_zeros_rejected() {
        let env = Env::default();
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        assert!(validate_brief_hash(&env, &zero_hash).is_err());
    }

    #[test]
    fn test_validate_brief_hash_nonzero_ok() {
        let env = Env::default();
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        assert!(validate_brief_hash(&env, &hash).is_ok());
    }

    #[test]
    fn test_validate_title_empty_rejected() {
        let env = Env::default();
        let title = String::from_str(&env, "");
        assert!(validate_title(&title).is_err());
    }

    #[test]
    fn test_validate_title_ok() {
        let env = Env::default();
        let title = String::from_str(&env, "Design phase");
        assert!(validate_title(&title).is_ok());
    }

    #[test]
    fn test_validate_signer_count_ok() {
        assert!(validate_signer_count(5).is_ok());
    }

    #[test]
    fn test_validate_signer_count_exceeds_cap() {
        assert!(validate_signer_count(MAX_BUYER_SIGNERS + 1).is_err());
    }
}
