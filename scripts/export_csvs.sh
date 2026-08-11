#!/bin/zsh
# Export the full report data pack as CSVs from the primary database.
# Usage: ./scripts/export_csvs.sh  ->  exports/<today>/*.csv
set -e
cd "$(dirname "$0")/.."
source .env 2>/dev/null || true
DB="${DATABASE_URL:?set DATABASE_URL in .env}"
OUT="exports/$(date +%Y-%m-%d)"
mkdir -p "$OUT"

# 1. Registry: every deployment with its identifier (report appendix)
psql "$DB" -c "\copy (
  select product_id, symbol, fund_name, issuer, chain, contract_address,
         nav_model, decimals, data_mode, in_scope, onchain_symbol, notes
  from ref.products order by symbol, chain
) to '$OUT/products_registry.csv' csv header"

# 2. Current positions: latest supply + AUM per deployment
psql "$DB" -c "\copy (
  select p.product_id, p.symbol, p.issuer, p.chain, p.supply,
         coalesce(n.nav_usd, 1.0) as nav_usd, p.aum_usd, p.data_mode,
         p.as_of::date as as_of
  from marts.fct_current_positions p
  left join ref.nav_reference n on n.symbol = p.symbol
  order by p.aum_usd desc
) to '$OUT/current_positions.csv' csv header"

# 3. Daily AUM history by product and chain (the hero chart, fully granular)
psql "$DB" -c "\copy (
  select day, symbol, chain, round(supply::numeric, 6) as supply,
         round(aum_usd::numeric, 2) as aum_usd, is_nav_proxy
  from marts.fct_aum_daily order by day, symbol, chain
) to '$OUT/aum_daily_by_product_chain.csv' csv header"

# 4. Daily AUM by product (chains summed; easiest to chart)
psql "$DB" -c "\copy (
  select day, symbol, round(sum(supply)::numeric, 6) as supply,
         round(sum(aum_usd)::numeric, 2) as aum_usd
  from marts.fct_aum_daily group by 1, 2 order by 1, 2
) to '$OUT/aum_daily_by_product.csv' csv header"

# 5. Weekly primary-market flows (mint/redeem) by product and chain
psql "$DB" -c "\copy (
  select f.week, f.symbol, f.chain,
         round(f.minted::numeric, 6) as minted_tokens,
         round(f.burned::numeric, 6) as burned_tokens,
         round(f.net_flow::numeric, 6) as net_flow_tokens,
         round((f.net_flow * coalesce(n.nav_usd, 1.0))::numeric, 2) as net_flow_usd
  from marts.fct_flows_weekly f
  left join ref.nav_reference n on n.symbol = f.symbol
  order by f.week, f.symbol, f.chain
) to '$OUT/flows_weekly.csv' csv header"

# 5b. Daily net flows (mint minus redeem) by product and chain; exact source
# of the 30d KPI and any custom-window flow analysis
psql "$DB" -c "\copy (
  select s.day, s.symbol, s.chain,
         round(s.net_change::numeric, 6) as net_flow_tokens,
         round((s.net_change * coalesce(n.nav_usd, 1.0))::numeric, 2) as net_flow_usd
  from marts.fct_supply_daily s
  left join ref.nav_reference n on n.symbol = s.symbol
  where s.net_change <> 0
  order by s.day, s.symbol, s.chain
) to '$OUT/flows_daily.csv' csv header"

# 6. Holder concentration metrics per deployment
psql "$DB" -c "\copy (
  select h.product_id, h.symbol, h.chain, h.holders,
         round(h.held_supply::numeric, 2) as held_supply,
         round(h.top10_share::numeric, 4) as top10_share,
         round(h.hhi::numeric, 4) as hhi,
         round(h.avg_holding::numeric, 2) as avg_holding,
         round(h.median_holding::numeric, 2) as median_holding
  from marts.fct_holder_metrics h order by h.held_supply desc
) to '$OUT/holder_metrics.csv' csv header"

# 7. Top 25 holders per deployment (whale structure; addresses are public data)
psql "$DB" -c "\copy (
  select * from (
    select b.product_id, p.symbol, p.chain, b.holder,
           round(b.balance::numeric, 6) as balance,
           row_number() over (partition by b.product_id
                              order by b.balance desc) as rank
    from marts.fct_holder_balances b
    join ref.products p using (product_id)
  ) x where rank <= 25 order by product_id, rank
) to '$OUT/top_holders.csv' csv header"

# 8. Latest market share by product
psql "$DB" -c "\copy (
  select symbol, count(distinct chain) as chains,
         round(sum(supply)::numeric, 2) as supply,
         round(sum(aum_usd)::numeric, 2) as aum_usd,
         round((sum(aum_usd) / sum(sum(aum_usd)) over ())::numeric, 4) as share
  from marts.fct_current_positions group by symbol order by aum_usd desc
) to '$OUT/market_share_latest.csv' csv header"

# 9. Latest chain split
psql "$DB" -c "\copy (
  select chain, count(*) as deployments,
         round(sum(aum_usd)::numeric, 2) as aum_usd,
         round((sum(aum_usd) / sum(sum(aum_usd)) over ())::numeric, 4) as share
  from marts.fct_current_positions group by chain order by aum_usd desc
) to '$OUT/chain_split_latest.csv' csv header"

# 10. Reference NAVs used for accruing products
psql "$DB" -c "\copy (
  select symbol, nav_usd, as_of, source from ref.nav_reference order by symbol
) to '$OUT/nav_reference.csv' csv header"

# 11. Raw non-EVM supply snapshots (verification trail)
psql "$DB" -c "\copy (
  select chain, contract_address, snapshot_time, supply, holders, source
  from raw.supply_snapshots order by chain, contract_address, snapshot_time
) to '$OUT/supply_snapshots.csv' csv header"

echo "--- export complete: $OUT ---"
wc -l "$OUT"/*.csv
