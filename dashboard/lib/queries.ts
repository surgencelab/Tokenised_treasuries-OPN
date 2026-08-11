import { pool } from "./db";

export type Kpis = {
  totalAum: number;
  netFlow30d: number;
  holderPositions: number;
  products: number;
  chains: number;
  latestDay: string;
  navProxyCount: number;
};

export async function getKpis(): Promise<Kpis> {
  const { rows } = await pool.query(`
    with latest as (
      select product_id, chain, as_of, aum_usd, is_nav_proxy
      from marts.fct_current_positions
    ),
    flows as (
      select coalesce(sum(
        (case transfer_type when 'mint' then amount when 'burn' then -amount end)
        * coalesce(n.nav_usd, 1.0)), 0) as net_30d
      from marts.stg_transfers t
      left join ref.nav_reference n using (symbol)
      where t.transfer_type in ('mint','burn')
        and t.block_time >= now() - interval '30 days'
    ),
    holders as (
      select (select coalesce(sum(holders), 0) from marts.fct_holder_metrics)
           + (select coalesce(sum(s.holders), 0)
                from (select distinct on (chain, contract_address) holders
                      from raw.supply_snapshots
                      order by chain, contract_address, snapshot_time desc) s)
             as positions
    )
    select
      (select sum(aum_usd) from latest)               as total_aum,
      (select net_30d from flows)                     as net_flow_30d,
      (select positions from holders)                 as holder_positions,
      (select count(*) from latest)                   as products,
      (select count(distinct chain) from latest)      as chains,
      (select max(as_of) from latest)::date::text     as latest_day,
      (select count(*) from latest where is_nav_proxy) as nav_proxy_count
  `);
  const r = rows[0];
  return {
    totalAum: Number(r.total_aum),
    netFlow30d: Number(r.net_flow_30d),
    holderPositions: Number(r.holder_positions),
    products: Number(r.products),
    chains: Number(r.chains),
    latestDay: r.latest_day,
    navProxyCount: Number(r.nav_proxy_count),
  };
}

export type AumPoint = { day: string } & Record<string, number | string>;

export async function getAumSeries(): Promise<{
  data: AumPoint[];
  symbols: string[];
}> {
  // weekly (last day of each ISO week) + the latest day, to keep the SVG light
  const { rows } = await pool.query(`
    with daily as (
      select day, symbol, sum(aum_usd)::float8 as aum
      from marts.fct_aum_daily
      where day >= '2023-06-01'
      group by day, symbol
    ),
    picked as (
      select distinct on (symbol, date_trunc('week', day)) day, symbol, aum
      from daily
      order by symbol, date_trunc('week', day), day desc
    )
    select day::text, symbol, aum from picked
    union
    select day::text, symbol, aum from daily where day = (select max(day) from daily)
    order by day
  `);
  const symbolTotals = new Map<string, number>();
  const byDay = new Map<string, AumPoint>();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day });
    byDay.get(r.day)![r.symbol] = r.aum;
    symbolTotals.set(r.symbol, r.aum); // last write wins = latest value
  }
  // stack order: biggest at the bottom
  const symbols = [...symbolTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);
  return { data: [...byDay.values()], symbols };
}

export type ShareRow = {
  symbol: string;
  issuer: string;
  chains: number;
  supply: number;
  aumUsd: number;
  share: number;
  isNavProxy: boolean;
};

export async function getMarketShare(): Promise<ShareRow[]> {
  const { rows } = await pool.query(`
    select symbol, max(issuer) as issuer, count(distinct chain) as chains,
           sum(supply)::float8 as supply, sum(aum_usd)::float8 as aum_usd,
           bool_or(is_nav_proxy) as is_nav_proxy
    from marts.fct_current_positions
    group by symbol
    order by aum_usd desc
  `);
  const total = rows.reduce((s: number, r: any) => s + Number(r.aum_usd), 0);
  return rows.map((r: any) => ({
    symbol: r.symbol,
    issuer: r.issuer,
    chains: Number(r.chains),
    supply: Number(r.supply),
    aumUsd: Number(r.aum_usd),
    share: Number(r.aum_usd) / total,
    isNavProxy: r.is_nav_proxy,
  }));
}

export type ChainRow = { chain: string; aumUsd: number; share: number };

export async function getChainSplit(): Promise<ChainRow[]> {
  const { rows } = await pool.query(`
    select chain, sum(aum_usd)::float8 as aum_usd
    from marts.fct_current_positions
    group by chain order by aum_usd desc
  `);
  const total = rows.reduce((s: number, r: any) => s + Number(r.aum_usd), 0);
  return rows.map((r: any) => ({
    chain: r.chain,
    aumUsd: Number(r.aum_usd),
    share: Number(r.aum_usd) / total,
  }));
}

export type FlowPoint = { week: string } & Record<string, number | string>;

export async function getWeeklyFlows(): Promise<{
  data: FlowPoint[];
  symbols: string[];
}> {
  const { rows } = await pool.query(`
    select f.week::text, f.symbol,
           sum(f.net_flow * coalesce(n.nav_usd, 1.0))::float8 as net_usd
    from marts.fct_flows_weekly f
    left join ref.nav_reference n on n.symbol = f.symbol
    where f.week >= (date_trunc('week', now()) - interval '26 weeks')::date
      and f.week < date_trunc('week', now())::date
    group by f.week, f.symbol
    order by f.week
  `);
  const symbols = [...new Set(rows.map((r: any) => r.symbol as string))];
  const byWeek = new Map<string, FlowPoint>();
  for (const r of rows) {
    if (!byWeek.has(r.week)) byWeek.set(r.week, { week: r.week });
    byWeek.get(r.week)![r.symbol] = r.net_usd;
  }
  return { data: [...byWeek.values()], symbols };
}

export type HolderRow = {
  productId: string;
  symbol: string;
  chain: string;
  holders: number;
  top10Share: number;
  hhi: number;
  medianHolding: number;
  aumUsd: number;
};

export async function getHolderMetrics(): Promise<HolderRow[]> {
  const { rows } = await pool.query(`
    with latest as (
      select distinct on (product_id) product_id, aum_usd
      from marts.fct_aum_daily
      order by product_id, day desc
    )
    select h.product_id, h.symbol, h.chain, h.holders,
           h.top10_share::float8 as top10, h.hhi::float8 as hhi,
           h.median_holding::float8 as median_holding,
           l.aum_usd::float8 as aum_usd
    from marts.fct_holder_metrics h
    join latest l using (product_id)
    order by l.aum_usd desc
  `);
  return rows.map((r: any) => ({
    productId: r.product_id,
    symbol: r.symbol,
    chain: r.chain,
    holders: Number(r.holders),
    top10Share: Number(r.top10),
    hhi: Number(r.hhi),
    medianHolding: Number(r.median_holding),
    aumUsd: Number(r.aum_usd),
  }));
}

// ---- per-chain datasets for the interactive client shell ----

export type SeriesRow = { day: string; chain: string; symbol: string; aum: number };

export async function getAumWeeklyByChain(): Promise<SeriesRow[]> {
  const { rows } = await pool.query(`
    with daily as (
      select day, chain, symbol, sum(aum_usd)::float8 as aum
      from marts.fct_aum_daily
      where day >= '2023-06-01'
      group by 1, 2, 3
    ),
    picked as (
      select distinct on (chain, symbol, date_trunc('week', day))
        day, chain, symbol, aum
      from daily
      order by chain, symbol, date_trunc('week', day), day desc
    )
    select day::text, chain, symbol, aum from picked
    union
    select day::text, chain, symbol, aum from daily
    where day = (select max(day) from daily)
    order by day
  `);
  return rows;
}

export async function getAumDailyByChain(days = 210): Promise<SeriesRow[]> {
  const { rows } = await pool.query(
    `select day::text, chain, symbol, sum(aum_usd)::float8 as aum
     from marts.fct_aum_daily
     where day >= current_date - $1::int
     group by 1, 2, 3
     order by 1`,
    [days]
  );
  return rows;
}

export type FlowRow = { week: string; chain: string; symbol: string; net: number };

export async function getFlowsWeeklyByChain(): Promise<FlowRow[]> {
  const { rows } = await pool.query(`
    select f.week::text, f.chain, f.symbol,
           sum(f.net_flow * coalesce(n.nav_usd, 1.0))::float8 as net
    from marts.fct_flows_weekly f
    left join ref.nav_reference n on n.symbol = f.symbol
    where f.week < date_trunc('week', now())::date
    group by 1, 2, 3
    order by 1
  `);
  return rows;
}

export type PositionRow = {
  productId: string;
  symbol: string;
  issuer: string;
  chain: string;
  supply: number;
  aumUsd: number;
  isNavProxy: boolean;
  dataMode: string;
};

export async function getPositions(): Promise<PositionRow[]> {
  const { rows } = await pool.query(`
    select product_id, symbol, issuer, chain, supply::float8 as supply,
           aum_usd::float8 as aum_usd, is_nav_proxy, data_mode
    from marts.fct_current_positions
    order by aum_usd desc
  `);
  return rows.map((r: any) => ({
    productId: r.product_id,
    symbol: r.symbol,
    issuer: r.issuer,
    chain: r.chain,
    supply: Number(r.supply),
    aumUsd: Number(r.aum_usd),
    isNavProxy: r.is_nav_proxy,
    dataMode: r.data_mode,
  }));
}

export type ChainStat = { chain: string; netFlow30d: number; holders: number };

export async function getChainStats(): Promise<ChainStat[]> {
  const { rows } = await pool.query(`
    with flows as (
      select chain, sum(net_usd)::float8 as net_30d from (
        select t.chain,
               (case transfer_type when 'mint' then amount
                                   when 'burn' then -amount end)
               * coalesce(n.nav_usd, 1.0) as net_usd
        from marts.stg_transfers t
        left join ref.nav_reference n using (symbol)
        where t.transfer_type in ('mint','burn')
          and t.block_time >= now() - interval '30 days'
        union all
        select x.chain,
               (x.supply - lag(x.supply) over
                 (partition by x.chain, x.contract_address order by x.day))
               * coalesce(n.nav_usd, 1.0)
        from raw.nonevm_supply_daily x
        join ref.products p
          on p.chain = x.chain and p.contract_address = x.contract_address
        left join ref.nav_reference n on n.symbol = p.symbol
        where x.day >= current_date - 31
      ) f where net_usd is not null
      group by 1
    ),
    ev_holders as (
      select chain, sum(holders)::int as holders
      from marts.fct_holder_metrics group by 1
    ),
    snap_holders as (
      select chain, sum(holders)::int as holders from (
        select distinct on (chain, contract_address) chain, holders
        from raw.supply_snapshots
        order by chain, contract_address, snapshot_time desc
      ) s group by 1
    ),
    chains as (
      select distinct chain from marts.fct_current_positions
    )
    select c.chain,
           coalesce(f.net_30d, 0) as net_flow_30d,
           coalesce(e.holders, 0) + coalesce(sh.holders, 0) as holders
    from chains c
    left join flows f using (chain)
    left join ev_holders e using (chain)
    left join snap_holders sh using (chain)
  `);
  return rows.map((r: any) => ({
    chain: r.chain,
    netFlow30d: Number(r.net_flow_30d),
    holders: Number(r.holders),
  }));
}

export type NavRow = { symbol: string; nav: number; asOf: string; source: string };

export async function getNavReference(): Promise<NavRow[]> {
  const { rows } = await pool.query(
    `select symbol, nav_usd::float8 as nav, as_of::text, source
     from ref.nav_reference order by symbol`
  );
  return rows.map((r: any) => ({
    symbol: r.symbol,
    nav: Number(r.nav),
    asOf: r.as_of,
    source: r.source,
  }));
}
