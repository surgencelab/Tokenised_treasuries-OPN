-- Holder concentration metrics: EVM running balances UNION snapshot-based
-- holder lists (Stellar via stellar.expert /holders).

create or replace view marts.fct_holder_metrics as
with evm as (
  select b.product_id, b.holder, b.balance
  from marts.fct_holder_balances b
),
snap_latest as (
  select h.chain, h.contract_address, max(h.snapshot_time) as ts
  from raw.holder_snapshots h
  group by 1, 2
),
snap as (
  select p.product_id, h.holder_address as holder, h.balance
  from raw.holder_snapshots h
  join snap_latest l
    on l.chain = h.chain and l.contract_address = h.contract_address
   and l.ts = h.snapshot_time
  join ref.products p
    on p.chain = h.chain and p.contract_address = h.contract_address
  where p.in_scope and h.balance > 0.000001
),
b as (
  select * from evm
  union all
  select * from snap
),
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
