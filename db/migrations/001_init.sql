create schema if not exists ref;
create schema if not exists raw;
create schema if not exists marts;
create schema if not exists recon;

create table if not exists ref.products (
  product_id       text primary key,
  symbol           text not null,
  fund_name        text not null,
  issuer           text not null,
  chain            text not null,
  contract_address text not null,
  nav_model        text not null check (nav_model in ('peg','accruing')),
  decimals         int,
  onchain_symbol   text,
  verified_at      timestamptz,
  notes            text,
  unique (chain, contract_address)
);

create table if not exists raw.erc20_transfers (
  chain            text not null,
  contract_address text not null,
  block_number     bigint not null,
  block_time       timestamptz not null,
  tx_hash          text not null,
  log_index        int not null,
  from_address     text not null,
  to_address       text not null,
  amount_raw       numeric not null,
  amount           numeric not null,
  ingested_at      timestamptz default now(),
  primary key (chain, tx_hash, log_index)
);
create index if not exists idx_transfers_product_time
  on raw.erc20_transfers (chain, contract_address, block_time);

create table if not exists raw.holder_snapshots (
  chain            text not null,
  contract_address text not null,
  snapshot_time    timestamptz not null,
  holder_address   text not null,
  balance          numeric not null,
  primary key (chain, contract_address, snapshot_time, holder_address)
);

create table if not exists raw.ingest_cursor (
  chain            text not null,
  contract_address text not null,
  last_block       bigint not null,
  updated_at       timestamptz default now(),
  primary key (chain, contract_address)
);

create table if not exists recon.results (
  run_at        timestamptz default now(),
  product_id    text not null,
  metric        text not null,
  ours          numeric,
  reference     numeric,
  pct_diff      numeric,
  status        text not null check (status in ('pass','warn','fail')),
  detail        text
);
