-- Scope flag: USDM is a rebasing token, so supply-from-transfers undercounts;
-- at ~$87k AUM it is excluded from marts (raw data retained).
alter table ref.products add column if not exists in_scope boolean not null default true;
update ref.products
set in_scope = false,
    notes = 'Rebasing token: mint/burn undercounts supply. Excluded from marts.'
where product_id = 'usdm-ethereum';

-- Reference NAV for accruing tokens until Phase 2 wires oracles.
-- One row per symbol, manually curated, always dated and sourced.
create table if not exists ref.nav_reference (
  symbol  text primary key,
  nav_usd numeric not null,
  as_of   date not null,
  source  text not null
);

-- Rebuild staging with the scope filter
create or replace view marts.stg_transfers as
select
  p.product_id, p.symbol, p.issuer, p.chain, p.nav_model,
  t.block_time, t.block_number, t.tx_hash, t.log_index,
  t.from_address, t.to_address, t.amount,
  case
    when t.from_address = '0x0000000000000000000000000000000000000000' then 'mint'
    when t.to_address   = '0x0000000000000000000000000000000000000000' then 'burn'
    else 'transfer'
  end as transfer_type
from raw.erc20_transfers t
join ref.products p
  on p.chain = t.chain and p.contract_address = t.contract_address
where t.amount > 0
  and p.in_scope;

-- AUM now uses reference NAV where present; peg products stay at 1.
-- is_nav_proxy flags accruing products still valued at 1 (no NAV row yet).
create or replace view marts.fct_aum_daily as
select
  s.product_id, s.symbol, s.issuer, s.chain, s.nav_model, s.day, s.supply,
  s.supply * coalesce(n.nav_usd, 1.0) as aum_usd,
  (s.nav_model = 'accruing' and n.nav_usd is null) as is_nav_proxy,
  n.nav_usd, n.as_of as nav_as_of, n.source as nav_source
from marts.fct_supply_daily s
left join ref.nav_reference n using (symbol);
