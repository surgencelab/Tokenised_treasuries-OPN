-- Phase 2A: non-EVM coverage via current-state supply snapshots.
-- Full event history stays EVM; every other deployment gets a verified
-- point-in-time supply from its chain's own public API.

alter table ref.products
  add column if not exists data_mode text not null default 'events'
  check (data_mode in ('events', 'snapshot'));

create table if not exists raw.supply_snapshots (
  chain            text not null,
  contract_address text not null,   -- chain-native identifier
  snapshot_time    timestamptz not null,
  supply           numeric not null, -- decimal-adjusted token amount
  holders          int,              -- where the chain API exposes it
  source           text not null,    -- which API produced it
  primary key (chain, contract_address, snapshot_time)
);

-- Latest position per product: events products from the marts, snapshot
-- products from their newest snapshot. This is what current-state panels read.
create or replace view marts.fct_current_positions as
with events_latest as (
  select distinct on (product_id)
    product_id, symbol, issuer, chain, nav_model, day::timestamptz as as_of,
    supply, aum_usd, is_nav_proxy, 'events'::text as data_mode
  from marts.fct_aum_daily
  order by product_id, day desc
),
snap_latest as (
  select distinct on (p.product_id)
    p.product_id, p.symbol, p.issuer, p.chain, p.nav_model,
    s.snapshot_time as as_of, s.supply,
    s.supply * coalesce(n.nav_usd, 1.0) as aum_usd,
    (p.nav_model = 'accruing' and n.nav_usd is null) as is_nav_proxy,
    'snapshot'::text as data_mode
  from ref.products p
  join raw.supply_snapshots s
    on s.chain = p.chain and s.contract_address = p.contract_address
  left join ref.nav_reference n on n.symbol = p.symbol
  where p.data_mode = 'snapshot' and p.in_scope
  order by p.product_id, s.snapshot_time desc
)
select * from events_latest
union all
select * from snap_latest;
