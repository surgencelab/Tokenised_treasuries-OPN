# Phase 1 Technical Plan: EVM MVP (prove parity)

Deliverable: our current Dune numbers (Q1 supply/AUM, Q2 total + market share, Q4 net flows, Q5/Q6 holders) reproduced first-party from Alchemy into Postgres, transformed with dbt, and reconciled against rwa.xyz within tolerance. One branded page on top (KPI row + hero AUM chart).

Success criteria, checked before anything ships:
1. Total AUM within 2% of rwa.xyz for the covered products (peg products should be near-exact; accruing products may drift until Phase 2 NAV, flag them).
2. Per-product supply matches the token's explorer `totalSupply` at head.
3. Holder counts within 5% of explorer holder counts (explorers count dust differently; document the delta).

## 1. Scope

Products: the verified CA reference sheet (18 deployments). The five Ethereum majors carry most of the AUM and are the first backfill targets:

| symbol | chain | contract | nav_model |
|---|---|---|---|
| BUIDL | ethereum | 0x7712c34205737192402172409a8f7ccef8aa2aec | peg |
| USYC | ethereum | 0x136471a34f6ef19fe571effc1ca711fdb8e49f2b | accruing |
| USDY | ethereum | 0x96f6ef951840721adbf46ac996b59e0235cb985c | accruing |
| OUSG | ethereum | 0x1b19c19393e2d034d8ff31ff34c81252fcbbee92 | accruing |
| USTB | ethereum | 0x43415eb6ff9db7e26a15b704e7a3edce97d31c4e | accruing |

The remaining deployments (BUIDL on Optimism/Arbitrum/Avalanche/Polygon, BENJI x4, USDY x2, USDM, TBILL, WTGXX) load from `Tokenized_Treasuries_CA_Reference.xlsx` into the registry seed. Do not hand-type them; export the sheet to `seeds/products.csv`.

Out of scope for Phase 1: Stellar, Aptos, Solana, real NAV oracles (accruing products run at $1 with an `is_nav_proxy` flag, exactly as the Dune queries did).

## 2. Provider matrix (EVM)

| chain | transfer history | current balances | note |
|---|---|---|---|
| ethereum | Alchemy `alchemy_getAssetTransfers` | Alchemy `alchemy_getTokenBalances` / owners | primary |
| optimism | Alchemy | Alchemy | |
| arbitrum | Alchemy | Alchemy | |
| polygon | Alchemy | Alchemy | |
| base | Alchemy | Alchemy | |
| avalanche | `eth_getLogs` via Ankr/QuickNode public RPC (Transfers API not offered here) | Moralis or getLogs replay | verify Alchemy's current Avalanche coverage at build time |
| mantle | `eth_getLogs` via official public RPC | getLogs replay | low volume, cheap to replay |

The loader abstracts this: one code path for Alchemy Transfers, one generic `eth_getLogs` path filtering `Transfer(address,address,uint256)` (topic0 `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`). Both write the same rows.

## 3. Repo structure

```
tokenized-treasuries/
  docs/                      # this plan, architecture, methodology
  seeds/products.csv         # registry exported from the verified CA sheet
  ingest/
    alchemy_transfers.py     # backfill + incremental, Alchemy Transfers API
    getlogs_transfers.py     # generic eth_getLogs path (avalanche, mantle)
    holders_snapshot.py      # current holder snapshot per contract
    config.py                # chains, endpoints, confirmation lags
  db/migrations/             # raw DDL below
  dbt/                       # models ported from the Dune query pack
  recon/rwa_xyz_check.py     # reconciliation gate
  .env                       # ALCHEMY_API_KEY, DATABASE_URL
```

## 4. Postgres DDL (raw + ref)

```sql
create schema if not exists ref;
create schema if not exists raw;

create table ref.products (
  product_id     text primary key,          -- 'buidl-ethereum'
  symbol         text not null,
  issuer         text not null,
  chain          text not null,
  contract_address text not null,           -- lowercase 0x
  nav_model      text not null check (nav_model in ('peg','accruing')),
  decimals       int  not null,
  unique (chain, contract_address)
);

create table raw.erc20_transfers (
  chain          text not null,
  contract_address text not null,
  block_number   bigint not null,
  block_time     timestamptz not null,
  tx_hash        text not null,
  log_index      int not null,
  from_address   text not null,
  to_address     text not null,
  amount_raw     numeric not null,           -- unscaled uint256
  amount         numeric not null,           -- amount_raw / 10^decimals
  ingested_at    timestamptz default now(),
  primary key (chain, tx_hash, log_index)
);
create index on raw.erc20_transfers (chain, contract_address, block_time);

create table raw.holder_snapshots (
  chain          text not null,
  contract_address text not null,
  snapshot_time  timestamptz not null,
  holder_address text not null,
  balance        numeric not null,
  primary key (chain, contract_address, snapshot_time, holder_address)
);

create table raw.ingest_cursor (
  chain          text not null,
  contract_address text not null,
  last_block     bigint not null,
  primary key (chain, contract_address)
);
```

TimescaleDB hypertable on `raw.erc20_transfers(block_time)` is optional at this volume; plain Postgres with the index above is fine for Phase 1.

## 5. The Alchemy calls

Backfill, per contract, paginated:

```json
POST https://eth-mainnet.g.alchemy.com/v2/{KEY}
{
  "jsonrpc": "2.0", "id": 1, "method": "alchemy_getAssetTransfers",
  "params": [{
    "fromBlock": "0x0",
    "toBlock": "latest",
    "contractAddresses": ["0x7712c34205737192402172409a8f7ccef8aa2aec"],
    "category": ["erc20"],
    "withMetadata": true,
    "maxCount": "0x3e8",
    "pageKey": "<from previous response>"
  }]
}
```

Loader rules:
- Loop on `pageKey` until absent; upsert on the `(chain, tx_hash, log_index)` key (Alchemy's `uniqueId` decomposes to this). Idempotent by construction, safe to re-run.
- Incremental runs read `raw.ingest_cursor`, set `fromBlock = last_block - CONFIRMATIONS + 1` and re-upsert the tail. CONFIRMATIONS: 12 ethereum, 60 polygon, 15 for the rollups (their L1-anchored finality makes deep reorgs a non-issue; this is belt and braces).
- `rawContract.value` is hex uint256: store as `amount_raw`, compute `amount` with the registry's decimals. Do not trust Alchemy's pre-scaled `value` field blindly; cross-check one tx per product against the explorer.
- Lowercase every address on write.
- The zero address `0x0000...0000` stays in the data; mint/burn classification happens in dbt, not the loader.

Holder snapshot (KPI tiles want "holders now" without replaying history):

```json
{ "method": "alchemy_getOwnersForToken",
  "params": [{ "contractAddress": "0x...", "withTokenBalances": true }] }
```

Where unavailable (non-Alchemy chains), derive holders from running balances in dbt instead (the Q5 logic); the snapshot table is an accelerator, not a dependency.

Cost note: full transfer history for these contracts is small (tens of thousands of events, not millions). Backfill fits comfortably in Alchemy's free tier; throttle to ~5 req/s and add exponential backoff on 429s.

## 6. Cleaning rules (loader + staging)

1. Dedupe on `(chain, tx_hash, log_index)`; upserts make retries safe.
2. Drop zero-amount transfers in staging (they pollute holder counts), keep them in raw.
3. Classify in staging: `mint` (from = zero), `burn` (to = zero), `transfer` otherwise.
4. Sanity gate per product before marts refresh: `sum(mints) - sum(burns)` must equal on-chain `totalSupply` within rounding. If it doesn't, the backfill has a hole; stop and fix, never publish around it.
5. Keep an `excluded_addresses` seed (empty for now) for future bridge/wrapper adjustments so exclusions are config, not code.

## 7. dbt models (port of the Dune pack)

```
staging:  stg_transfers            -- typed, classified, zero-amounts dropped
marts:    fct_supply_daily         -- Q1: cumulative mint-burn per product per day
          fct_aum_daily            -- Q1/Q2: supply x NAV (peg = 1; accruing = 1 + is_nav_proxy flag)
          fct_market_share         -- Q2
          fct_flows_weekly         -- Q4: weekly net mint-burn
          fct_holder_balances      -- Q5: running balance per address
          fct_holder_metrics       -- Q6/Q7/Q8: count, top-10 share, HHI, avg/median
dims:     dim_products             -- from seeds/products.csv
seeds:    products.csv, excluded_addresses.csv
```

The SQL logic transfers almost 1:1 from the Dune query pack; the only changes are source table names and dialect (Trino -> Postgres: `date_trunc` is the same, `varbinary` literals become plain lowercase text, `approx_percentile` becomes `percentile_cont`).

Schedule: cron every 6h for MVP (`ingest -> dbt build -> recon`), Dagster in Phase 3.

## 8. Reconciliation gate (`recon/rwa_xyz_check.py`)

Pull rwa.xyz per-product AUM (page data or API), compare against `fct_aum_daily` latest:
- peg products: warn at 1%, fail at 2%
- accruing products at proxy NAV: expected to read low; check supply (token count) instead of USD AUM until Phase 2
- write results to `recon.results` and exit nonzero on failure so the pipeline blocks publishing

Known anchors from the Dune work (sanity, not gospel): BUIDL ~$2.6B, USYC ~$2.6B, BENJI ~$2.0B.

## 9. Execution order

1. Export the verified CA sheet to `seeds/products.csv`; load `ref.products`.
2. Apply DDL. Stand up Postgres (local Docker or Neon, same as Setnel).
3. Backfill BUIDL ethereum only. Run the totalSupply sanity gate. This validates the whole loader on one product.
4. Backfill the remaining Ethereum majors, then the L2/sidechain deployments, then the getLogs chains (avalanche, mantle).
5. dbt build; eyeball `fct_supply_daily` against the Dune Q1 chart.
6. Run the recon gate against rwa.xyz.
7. API layer (thin Next.js routes over the marts are fine for one page; Hasura when the surface grows) and the branded page: KPI row (total AUM, 30d net flow, holder count, product count) + hero AUM area chart stacked by product.

Estimated effort: loader + DDL 1-2 days, dbt port 1 day, recon + fixes 1 day, page 1-2 days. One focused week to parity.
