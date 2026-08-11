-- Phase 2B: daily supply history for snapshot-mode chains.
-- Sources: stellar.expert stats-history, Aptos indexer activities (cumsum),
-- Solana mint-account signatures (mint/burn deltas, cumsum).

create table if not exists raw.nonevm_supply_daily (
  chain            text not null,
  contract_address text not null,
  day              date not null,
  supply           numeric not null,
  holders          int,
  source           text not null,
  primary key (chain, contract_address, day)
);

-- fct_supply_daily: EVM event series UNION reconstructed non-EVM series
-- (forward-filled to today so the stacked chart has no ragged edge).
create or replace view marts.fct_supply_daily as
with daily as (
  select s.product_id, (date_trunc('day', s.block_time))::date as day,
         sum(case s.transfer_type when 'mint' then s.amount
                                  when 'burn' then -s.amount
                                  else 0 end) as net_change
  from marts.stg_transfers s
  group by 1, 2
),
spine as (
  select d.product_id, gs::date as day
  from (select product_id, min(day) as first_day from daily group by 1) d
  cross join lateral generate_series(d.first_day, current_date, interval '1 day') gs
),
events_series as (
  select
    s.product_id, p.symbol, p.issuer, p.chain, p.nav_model, s.day,
    coalesce(dl.net_change, 0) as net_change,
    sum(coalesce(dl.net_change, 0))
      over (partition by s.product_id order by s.day) as supply
  from spine s
  join ref.products p using (product_id)
  left join daily dl on dl.product_id = s.product_id and dl.day = s.day
  where p.data_mode = 'events'
),
nonevm_raw as (
  select p.product_id, p.symbol, p.issuer, p.chain, p.nav_model, n.day,
         n.supply,
         n.supply - lag(n.supply)
           over (partition by n.chain, n.contract_address order by n.day)
           as net_change
  from raw.nonevm_supply_daily n
  join ref.products p
    on p.chain = n.chain and p.contract_address = n.contract_address
  where p.in_scope
),
nonevm_fill as (
  select r.product_id, r.symbol, r.issuer, r.chain, r.nav_model,
         gs::date as day, r.supply, 0::numeric as net_change
  from (
    select distinct on (product_id) *
    from nonevm_raw order by product_id, day desc
  ) r
  cross join lateral generate_series(r.day + 1, current_date, interval '1 day') gs
)
select product_id, symbol, issuer, chain, nav_model, day, net_change, supply
from events_series
union all
select product_id, symbol, issuer, chain, nav_model, day,
       coalesce(net_change, 0), supply
from nonevm_raw
union all
select product_id, symbol, issuer, chain, nav_model, day, net_change, supply
from nonevm_fill;

-- flows: EVM mint/burn events UNION non-EVM day-over-day supply deltas
create or replace view marts.fct_flows_weekly as
select
  s.product_id, s.symbol, s.issuer, s.chain,
  (date_trunc('week', s.block_time))::date as week,
  sum(case when s.transfer_type = 'mint' then s.amount else 0 end) as minted,
  sum(case when s.transfer_type = 'burn' then s.amount else 0 end) as burned,
  sum(case s.transfer_type when 'mint' then s.amount
                           when 'burn' then -s.amount
                           else 0 end) as net_flow
from marts.stg_transfers s
where s.transfer_type in ('mint', 'burn')
group by 1, 2, 3, 4, 5
union all
select
  x.product_id, x.symbol, x.issuer, x.chain,
  (date_trunc('week', x.day))::date as week,
  sum(greatest(x.net_change, 0)) as minted,
  sum(greatest(-x.net_change, 0)) as burned,
  sum(x.net_change) as net_flow
from (
  select p.product_id, p.symbol, p.issuer, p.chain, n.day,
         n.supply - lag(n.supply)
           over (partition by n.chain, n.contract_address order by n.day)
           as net_change
  from raw.nonevm_supply_daily n
  join ref.products p
    on p.chain = n.chain and p.contract_address = n.contract_address
  where p.in_scope
) x
where x.net_change is not null and x.net_change <> 0
group by 1, 2, 3, 4, 5;

-- current positions: snapshot products now ALSO appear in fct_aum_daily via
-- the reconstructed series, so the events arm must exclude them.
create or replace view marts.fct_current_positions as
with events_latest as (
  select distinct on (a.product_id)
    a.product_id, a.symbol, a.issuer, a.chain, a.nav_model,
    a.day::timestamptz as as_of, a.supply, a.aum_usd, a.is_nav_proxy,
    'events'::text as data_mode
  from marts.fct_aum_daily a
  join ref.products p using (product_id)
  where p.data_mode = 'events'
  order by a.product_id, a.day desc
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
