# Escrow State History Retention & Pruning Strategy

## Overview

The TrustChain Escrow smart contract tracks state transitions (e.g. from `Active` to `Completed` or `Disputed`) to provide a complete, immutable audit trail for participants and arbiters. To prevent unbounded storage growth on Stellar ledger persistent entries, a bounded retention and pruning strategy is enforced.

## Retention Policy

- **Maximum Entries Retained**: 50 transitions (`MAX_STATE_HISTORY_ENTRIES = 50`) per escrow.
- **Eviction Strategy**: FIFO (First-In, First-Out). When a state change occurs and the escrow's history exceeds 50 entries, the oldest entries are automatically pruned from persistent storage.
- **Persistent Storage**: History records are stored in `DataKey::StateHistory(u64)` and their TTL is bumped automatically on each record and query.

## Querying History

To avoid unbounded gas costs when reading large collections, callers should query history through the bounded pagination entry point:

```rust
// Bounded pagination entry point
get_state_history_bounded(escrow_id: u64, offset: u32, limit: u32) -> Vec<StateHistoryEntry>
```

- `offset`: Starting index (0-based)
- `limit`: Number of entries to retrieve, capped at `MAX_HISTORY_PAGE_SIZE = 50`

For backward compatibility, `get_state_history(escrow_id: u64)` returns the full retained list (which is strictly capped at 50 entries).
