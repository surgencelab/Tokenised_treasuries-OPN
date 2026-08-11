-- Non-EVM series gap-fill: sparse activity days -> full daily spine with
-- last-value carry-forward, so stacked charts don't sawtooth to zero.

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
nonevm_spine as (
  select b.chain, b.contract_address, gs::date as day
  from (select chain, contract_address, min(day) as first_day
        from raw.nonevm_supply_daily group by 1, 2) b
  cross join lateral generate_series(b.first_day, current_date, interval '1 day') gs
),
nonevm_joined as (
  select sp.chain, sp.contract_address, sp.day, n.supply as raw_supply,
         count(n.supply) over (partition by sp.chain, sp.contract_address
                               order by sp.day) as grp
  from nonevm_spine sp
  left join raw.nonevm_supply_daily n
    on n.chain = sp.chain and n.contract_address = sp.contract_address
   and n.day = sp.day
),
nonevm_filled as (
  select chain, contract_address, day,
         max(raw_supply) over (partition by chain, contract_address, grp)
           as supply
  from nonevm_joined
),
nonevm_series as (
  select p.product_id, p.symbol, p.issuer, p.chain, p.nav_model, f.day,
         coalesce(f.supply - lag(f.supply)
           over (partition by f.chain, f.contract_address order by f.day), 0)
           as net_change,
         f.supply
  from nonevm_filled f
  join ref.products p
    on p.chain = f.chain and p.contract_address = f.contract_address
  where p.in_scope
)
select product_id, symbol, issuer, chain, nav_model, day, net_change, supply
from events_series
union all
select product_id, symbol, issuer, chain, nav_model, day, net_change, supply
from nonevm_series;
