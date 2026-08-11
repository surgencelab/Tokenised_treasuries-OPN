// Setnel detectors for the Tokenized Treasuries dashboard.
// Absolute-threshold rules over our own marts; the Hub owns baselines.

import { pool } from "@/lib/db";
import { defineDetector } from "./runtime";

// 1. Collection freshness: the newest EVM event cursor must move.
defineDetector({
  id: "treasuries.collection-stalled",
  label: "Ingestion stalled",
  category: "technical",
  severity: "critical",
  source: async () => {
    const { rows } = await pool.query(
      `select extract(epoch from now() - max(updated_at)) / 3600 as hours
       from raw.ingest_cursor`
    );
    return Number(rows[0]?.hours ?? 999);
  },
  detect: (hoursSince) =>
    hoursSince > 26
      ? [{
          message: `No ingestion cursor movement in ${hoursSince.toFixed(0)}h. Collection stalled.`,
          fingerprint: "treasuries.collection-stalled",
          payload: { hoursSince },
        }]
      : [],
});

// 2. Snapshot freshness: non-EVM supply snapshots must be under 48h old.
defineDetector({
  id: "treasuries.snapshots-stale",
  label: "Non-EVM snapshots stale",
  category: "technical",
  severity: "warning",
  source: async () => {
    const { rows } = await pool.query(
      `select extract(epoch from now() - max(snapshot_time)) / 3600 as hours
       from raw.supply_snapshots`
    );
    return Number(rows[0]?.hours ?? 999);
  },
  detect: (hoursSince) =>
    hoursSince > 48
      ? [{
          message: `Non-EVM supply snapshots are ${hoursSince.toFixed(0)}h old.`,
          fingerprint: "treasuries.snapshots-stale",
          payload: { hoursSince },
        }]
      : [],
});

// 3. NAV proxy leak: an accruing product valued at $1 understates AUM.
defineDetector({
  id: "treasuries.nav-proxy",
  label: "Accruing product missing reference NAV",
  category: "oracles",
  severity: "warning",
  source: async () => {
    const { rows } = await pool.query(
      `select symbol from marts.fct_current_positions
       where is_nav_proxy group by symbol`
    );
    return rows.map((r: any) => r.symbol as string);
  },
  detect: (symbols) =>
    symbols.map((s) => ({
      message: `${s} is accruing but has no reference NAV. AUM understated at $1.00.`,
      fingerprint: `treasuries.nav-proxy:${s}`,
      payload: { symbol: s },
    })),
});

// 4. Product AUM shock: >15% move in 24h is either a big story or bad data.
defineDetector({
  id: "treasuries.aum-shock",
  label: "Product AUM moved >15% in a day",
  category: "flows",
  severity: "warning",
  source: async () => {
    const { rows } = await pool.query(`
      with by_day as (
        select symbol, day, sum(aum_usd) as aum
        from marts.fct_aum_daily
        where day >= current_date - 2
        group by 1, 2
      ),
      pair as (
        select symbol, day, aum,
               lag(aum) over (partition by symbol order by day) as prev
        from by_day
      )
      select symbol, aum::float8, prev::float8
      from pair
      where day = (select max(day) from pair)
        and prev > 1e6 and abs(aum - prev) / prev > 0.15
    `);
    return rows as { symbol: string; aum: number; prev: number }[];
  },
  detect: (rows) =>
    rows.map((r) => ({
      message: `${r.symbol} AUM moved ${(((r.aum - r.prev) / r.prev) * 100).toFixed(1)}% in 24h (${(r.prev / 1e6).toFixed(1)}M → ${(r.aum / 1e6).toFixed(1)}M).`,
      fingerprint: `treasuries.aum-shock:${r.symbol}`,
      payload: r,
    })),
});
