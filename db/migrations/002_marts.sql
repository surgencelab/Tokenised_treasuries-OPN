-- Marts: the Dune query pack (Q1/Q2/Q4/Q5-Q8) ported to Postgres views.
-- Views for now; dbt takes over materialization in the productionize phase.

-- Q staging: typed, classified, zero-amounts dropped
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
where t.amount > 0;

-- Q1: supply per product per day (gap-filled spine, cumulative mint-burn)
create or replace view marts.fct_supply_daily as
with daily as (
  select product_id, (date_trunc('day', block_time))::date as day,
         sum(case transfer_type when 'mint' then amount
                                when 'burn' then -amount
                                else 0 end) as net_change
  from marts.stg_transfers
  group by 1, 2
),
spine as (
  select d.product_id, gs::date as day
  from (select product_id, min(day) as first_day from daily group by 1) d
  cross join lateral generate_series(d.first_day, current_date, interval '1 day') gs
)
select
  s.product_id, p.symbol, p.issuer, p.chain, p.nav_model, s.day,
  coalesce(dl.net_change, 0) as net_change,
  sum(coalesce(dl.net_change, 0))
    over (partition by s.product_id order by s.day) as supply
from spine s
join ref.products p using (product_id)
left join daily dl on dl.product_id = s.product_id and dl.day = s.day;

-- Q1/Q2: AUM = supply x NAV. Phase 1 proxy: NAV = 1 for everything, flagged.
create or replace view marts.fct_aum_daily as
select
  product_id, symbol, issuer, chain, nav_model, day, supply,
  supply * 1.0 as aum_usd,
  (nav_model = 'accruing') as is_nav_proxy
from marts.fct_supply_daily;

-- Q2: latest total + market share
create or replace view marts.fct_market_share as
with latest as (
  select distinct on (product_id) *
  from marts.fct_aum_daily
  order by product_id, day desc
)
select
  product_id, symbol, issuer, chain, nav_model, day, supply, aum_usd, is_nav_proxy,
  aum_usd / nullif(sum(aum_usd) over (), 0) as market_share
from latest;

-- Q4: weekly net flows
create or replace view marts.fct_flows_weekly as
select
  product_id, symbol, issuer, chain,
  (date_trunc('week', block_time))::date as week,
  sum(case when transfer_type = 'mint' then amount else 0 end) as minted,
  sum(case when transfer_type = 'burn' then amount else 0 end) as burned,
  sum(case transfer_type when 'mint' then amount
                         when 'burn' then -amount
                         else 0 end) as net_flow
from marts.stg_transfers
where transfer_type in ('mint', 'burn')
group by 1, 2, 3, 4, 5;

-- Q5: current balance per holder (running balances collapse to a sum at head)
create or replace view marts.fct_holder_balances as
with flows as (
  select product_id, to_address as holder, amount
  from marts.stg_transfers
  where to_address <> '0x0000000000000000000000000000000000000000'
  union all
  select product_id, from_address, -amount
  from marts.stg_transfers
  where from_address <> '0x0000000000000000000000000000000000000000'
)
select product_id, holder, sum(amount) as balance
from flows
group by 1, 2
having sum(amount) > 0.000001;  -- dust threshold, documented in methodology

-- Q6/Q7/Q8: holder count, top-10 share, HHI, avg/median holding
create or replace view marts.fct_holder_metrics as
with b as (select * from marts.fct_holder_balances),
totals as (
  select product_id, count(*) as holders, sum(balance) as held_supply
  from b group by 1
),
ranked as (
  select product_id, balance,
         row_number() over (partition by product_id order by balance desc) as rn
  from b
)
select
  t.product_id, p.symbol, p.chain,
  t.holders,
  t.held_supply,
  (select sum(r.balance) from ranked r
    where r.product_id = t.product_id and r.rn <= 10) / t.held_supply as top10_share,
  (select sum(power(bb.balance / t.held_supply, 2)) from b bb
    where bb.product_id = t.product_id) as hhi,
  t.held_supply / t.holders as avg_holding,
  (select percentile_cont(0.5) within group (order by bb.balance) from b bb
    where bb.product_id = t.product_id) as median_holding
from totals t
join ref.products p using (product_id);
