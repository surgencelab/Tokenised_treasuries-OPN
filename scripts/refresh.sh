#!/bin/zsh
# Scheduled refresh. Hourly: incremental ingest + snapshots + supply gate.
# With REFRESH_HISTORY=1 (daily cron): also rebuild non-EVM history series
# and Stellar holder lists (full refetch — too heavy for hourly).
# Nonzero exit = gate failed = do not publish.
set -e
cd "$(dirname "$0")/.."
./.venv/bin/python ingest/backfill.py
./.venv/bin/python ingest/snapshot_nonevm.py || echo "snapshots: some venues failed (non-fatal)"
if [[ "$REFRESH_HISTORY" == "1" ]]; then
  # individual reconstructed series may fail transiently (rate windows);
  # they are snapshot-gated on write, so a miss is stale-not-wrong.
  ./.venv/bin/python ingest/history_nonevm.py || echo "history: some series failed (non-fatal)"
  ./.venv/bin/python ingest/stellar_holders.py || echo "holders: failed (non-fatal)"
fi
# the hard gate: computed supply must equal on-chain totalSupply
./.venv/bin/python ingest/validate_supply.py
echo "refresh complete: $(date)"
