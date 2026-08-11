# First-Party Data Stack: Architecture (v2)

Goal: own the tokenized-treasuries data end to end. Index it ourselves, compute the metrics, serve them through our own API, and render branded Surgence Research dashboards. No dependency on Dune, and full access to the chains Dune gates behind enterprise (Stellar, Aptos).

## Why first-party

- Dune gates Stellar and Aptos behind enterprise fees, so a complete BENJI picture is impossible on the free tier.
- The raw data is public and free outside Dune. Stellar publishes the Hubble dataset on Google BigQuery (`crypto-stellar`), Aptos runs a free public GraphQL indexer, and EVM data is available from any archive RPC or data API. Self-hosting unlocks the gated chains rather than just avoiding a bill.
- It compounds. Every report reuses the same pipelines and registry. After a few reports we have a data and dashboard layer competitors can't reproduce without doing the same work.

## Decision: EVM ingestion path (updated)

**MVP (report one): Alchemy data APIs.** `alchemy_getAssetTransfers` for historical Transfer events per registry contract (mints and burns are transfers from/to the zero address), plus the token balance and owner endpoints for current-holder snapshots. Fastest credible path to numbers we can reconcile.

**Durable (Phase 3): graduate to Ponder.** Point it at the registry contracts and archive RPCs, let it handle backfill, tailing, and reorgs, writing to the same Postgres. Only the loader changes; the dbt compute underneath is identical either way.

Chains Alchemy does not cover fall back to another provider (Moralis, Ankr, QuickNode) or the chain's public RPC with `eth_getLogs`. Provider choice per chain is recorded in the Phase 1 plan; the registry and schema are provider-agnostic.

Rejected for MVP: raw RPC (hand-rolling pagination, backfill, and reorg handling buys nothing over a framework) and The Graph subgraphs (one subgraph per chain to write and sync is more overhead than either option above).

## The stack, layer by layer

**1. Token registry (config).** One source of truth: `(symbol, issuer, chain, identifier, nav_model, decimals)`. The verified CA reference sheet is the seed, extended with Stellar asset `code+issuer` and Aptos `asset_type`. Drives everything downstream. New product or chain = one config row.

**2. Ingestion (per chain).**
- EVM (Ethereum, Optimism, Arbitrum, Avalanche, Polygon, Base, Mantle): Alchemy Transfers API for MVP, Ponder later. Backfill history once, then poll new blocks with a confirmation lag for reorg safety.
- Stellar: payments and trust_lines from the public BigQuery `crypto-stellar` dataset on a scheduled sync (or self-run Galexie/Hubble later).
- Aptos: the public Aptos Indexer GraphQL API (`fungible_asset_activities`, balances), or self-hosted indexer later.
- Solana (optional next): Helius or the public dataset.
- NAV / prices: on-chain oracles (RedStone, Chainlink) for accruing tokens (USDY, OUSG, USTB, USDM, TBILL), issuer NAV feeds as fallback. This fixes the OUSG understatement.

**3. Storage.** Postgres + TimescaleDB. Raw events in a `raw` schema, curated marts in `marts`. ClickHouse only if volume ever demands it.

**4. Transform.** dbt models port the DuneSQL logic we already wrote: supply from mint/burn, AUM = supply x NAV, holders from running balances, concentration/HHI, flows, velocity. Hourly or daily refresh.

**5. Serve.** Hasura or PostgREST over the marts (GraphQL/REST for free), or thin Next.js API routes. Redis/CDN cache in front. These endpoints are what the dashboards read.

**6. Present.** Next.js + Recharts on Vercel, Surgence-branded, embeddable via iframe. Reusable component library so future reports reskin fast.

**7. Ops + QA.** Dagster (cron for MVP). Freshness and reorg-lag alerts. A standing reconciliation check against rwa.xyz that flags any product drifting beyond tolerance and gates publishing.

## Data flow

Registry -> per-chain ingestion (Alchemy EVM / BigQuery Stellar / Aptos indexer) -> Postgres (raw) -> dbt (marts: supply, AUM, holders, flows, NAV) -> API -> branded Next.js dashboard. Scheduler runs the refresh; the reconciliation job gates publishing.

## Phased build

**Phase 1: EVM MVP (prove parity).** Alchemy -> Postgres -> dbt -> API -> one branded page (KPI row + hero AUM chart). Reproduce the Dune numbers first-party and reconcile against rwa.xyz. See `phase-1-technical-plan.md`.

**Phase 2: beat Dune.** Add Stellar (BigQuery) and Aptos (indexer) so BENJI is complete; Solana if wanted. Wire real NAV for accruing tokens. This is where the total reconciles to ~$10b+ and the dashboard shows data Dune's free tier can't.

**Phase 3: productionize + templatize.** Swap Alchemy for Ponder, reorg handling, caching, embeds, monitoring, scheduled refresh. Generalize the registry, dbt models, and components so the next report is a config change plus a few models, not a rebuild.

*Verify current endpoints and quotas for the Stellar BigQuery dataset and the Aptos indexer before committing; both are public today but access terms change.*
