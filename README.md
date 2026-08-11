# Tokenized Treasuries — first-party data stack

First-party index of tokenized U.S. Treasury products (BUIDL, USYC, USDY, BENJI,
USTB, OUSG, TBILL, WTGXX) across 8 EVM chains, with a Datum Labs-branded
dashboard on top. No Dune dependency.

## Layout

- `seeds/products.csv` — token registry (the one config that drives everything).
  22 verified deployments; every row checked on-chain (symbol + decimals) at load.
- `ingest/` — Python loaders: `load_registry.py`, `backfill.py` (Alchemy
  Transfers API + public-RPC getLogs paths, idempotent upserts, resumable
  cursors), `validate_supply.py` (the mint-burn vs totalSupply gate).
- `db/migrations/` — Postgres schema: `raw` (events), `ref` (registry + NAV
  reference), `marts` (views ported from the Dune query pack Q1-Q8).
- `dashboard/` — Next.js 15 + Recharts, Datum Labs institutional-monitor
  design. Reads the marts directly; `/api/summary` for embeds.
  Dev: `npm run dev -- -p 3002` (or the `treasuries` launch config).
- `scripts/refresh.sh` — incremental ingest + gate, cron-able.
- `docs/` — architecture and phase plans.

## Article notes (methodology-sensitive findings)

- **Fund-of-fund double counting:** Ondo restructured OUSG (2024) to hold
  BlackRock's BUIDL as its primary underlying. Summing product AUMs therefore
  overstates net treasuries exposure; the article should note that OUSG's
  ~$408M partially re-counts BUIDL. Verified adjacent fact: wrapper variants
  (rUSDY holding 10.0M USDY on-chain; same pattern for any legacy rOUSG) add
  no hidden supply — the wrapped tokens sit inside the base token's
  totalSupply, which is what we index.
- **OUSG residual (~$72M vs rwa.xyz):** every tokenized venue in Ondo's docs
  is indexed (Ethereum, Polygon = 0, Solana = 0 on-chain, XRPL $222M).
  References themselves disagree on OUSG AUM ($480M rwa.xyz vs $556-625M
  elsewhere, mid-2026), consistent with non-tokenized/book-entry AUM inside
  product-level numbers. Divergence note, not missing data.

## Non-negotiables

1. Every product must pass the supply gate (computed = on-chain totalSupply)
   before its numbers ship.
2. Accruing tokens (USDY, USYC, OUSG, USTB, TBILL) use `ref.nav_reference`,
   dated and sourced; peg products are $1. Refresh NAV when refreshing
   reference totals in `dashboard/lib/reference.ts`.
3. USDM stays out of marts (rebasing supply cannot be derived from transfers).
4. Mantle block timestamps are interpolated between per-chunk anchors
   (250k-block chunks, two real timestamps each). Error is minutes on a
   fixed-cadence chain; amounts, ordering, and supply math are exact.

## Production (Phase 3 state)

- **Database: Neon** (`neondb` @ ep-mute-bird-atqtcz41). Dashboard reads via
  the pooler endpoint (`TREASURIES_DATABASE_URL` in `dashboard/.env.local`);
  ingest writes via the direct endpoint (`DATABASE_URL` in `.env`). The local
  homebrew Postgres remains as a dev copy (`LOCAL_DATABASE_URL`).
- **Refresh:** hourly cron on this machine (`crontab -l`, minute 15) running
  `scripts/refresh.sh` -> `logs/refresh.log`. Nonzero exit = gate failed.
- **Monitoring:** Setnel detector kit at `dashboard/lib/setnel/` +
  `/api/setnel/cron` (Vercel cron every 6h via `dashboard/vercel.json`).
  Needs `SETNEL_HUB_URL`, `SETNEL_SECRET`, `SETNEL_CRON_SECRET` env vars;
  skips gracefully until set. Detectors: ingestion stalled, snapshots stale,
  NAV proxy leak, per-product AUM shock >15%/day.
- **Deployed: https://tokenized-treasuries.vercel.app** (Vercel project
  `tokenized-treasuries` under `surgencebdm-3200s-projects`, Hobby plan so
  the Setnel cron runs daily 07:30 UTC). Redeploy: `cd dashboard &&
  vercel --prod`. Setnel env vars still to be added in Vercel for live
  alerting.
- **After shipping:** rotate the Alchemy key and the Neon password (both were
  shared in chat), and re-issue the env files.

## Postgres

Local: `postgresql://olusegunaborode@localhost:5432/tokenized_treasuries`
(homebrew postgresql@16). Note: some shells export a global `DATABASE_URL`
(goldsky); the dashboard deliberately uses `TREASURIES_DATABASE_URL`.

## Known state (2026-07-15, Phase 2A shipped)

- 25 EVM deployments with full event history (all pass the gate except
  `usdy-mantle`, scan finishing via Tenderly gateway; Alchemy free tier caps
  Mantle getLogs at 10 blocks) + 17 non-EVM deployments as verified supply
  snapshots (`ingest/snapshot_nonevm.py`: Horizon, Aptos indexer, Solana RPC,
  Sui, Noble LCD, XRPL gateway_balances, Plume/Sei public RPCs).
- Coverage vs rwa.xyz: **96.4%** of the covered products' global AUM
  ($10.55B / $10.95B). BENJI and USYC at 100%.
- Gap ledger (post-research, 2026-07-15): BUIDL gap CLOSED — it was the
  Nov 2025 BNB Chain deployment (0x2d5bdc96..., 245.75M tokens, verified
  exactly against on-chain supply and rwa.xyz's network table). OUSG ~$72M
  remains OPEN: every tokenized venue Ondo documents is indexed (Ethereum,
  Polygon = 0, Solana mint = 0 on-chain, XRPL $222M), so the residual is
  likely non-tokenized/book-entry AUM inside rwa's number or reference
  drift — treat as a divergence note in the article, not missing data.
  TBILL XRPL ~$30M stays HELD: the only sizeable TBILL issuer on XRPL
  (rTBLjLp1s...) shows 100M obligations vs rwa's 26.1M; do not add until
  OpenEden confirms the issuer address.
- BNB Chain matters: USYC keeps 97% of its supply there ($2.9B), TBILL $151M.
- Phase 2B (history, shipped without paid keys): Stellar via stellar.expert
  stats-history + /holders (holder concentration too), Aptos via indexer
  activities cumsum, Solana via mint-account signature scans (durable,
  resumable in raw.solana_mint_txs), XRPL via issuer account_tx, Plume as a
  full events chain (archive public RPC). Every series gated against its
  verified snapshot before storage.
- History NOT available free: Sei (all public RPCs prune to ~1 month; archive
  is paid; USDY-Sei $257M stays current-value-only), USDY-Solana ($181M —
  Solana's transferChecked references the mint, so an active token's mint
  signature list includes every transfer; needs Helius), Sui (needs
  event-type discovery), Noble (needs archival LCD sampling). All four have
  verified current snapshots feeding the current-state panels.
