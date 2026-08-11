"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import StatCard from "./StatCard";
import Panel from "./Panel";
import AumChart from "./AumChart";
import FlowsChart from "./FlowsChart";
import ShareBars from "./ShareBars";
import ChainSplitPie from "./ChainSplitPie";
import HoldersTable from "./HoldersTable";
import { fmtDate, fmtNum, fmtUsd } from "@/lib/format";
import { CHAIN_LABELS } from "@/lib/palette";
import type {
  ChainStat,
  FlowRow,
  HolderRow,
  NavRow,
  PositionRow,
  SeriesRow,
} from "@/lib/queries";

const PRESETS: { label: string; days: number | null }[] = [
  { label: "7D", days: 7 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "All", days: null },
];

const DAILY_LIMIT = 200; // windows at or below this use the daily series

type ViewState = { win: number | null; chain: string };

const controlStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  border: "1px solid var(--border-strong)",
  borderRadius: 6,
  background: "var(--white)",
  color: "var(--ink)",
  height: 24,
  cursor: "pointer",
};

function ChartControls({
  view,
  setView,
  chains,
  onShot,
  time = true,
  chainSel = true,
  spanDays,
}: {
  view: ViewState;
  setView: (v: ViewState) => void;
  chains: string[];
  onShot?: () => void;
  time?: boolean;
  chainSel?: boolean;
  spanDays: number;
}) {
  function zoom(dir: 1 | -1) {
    const current = view.win ?? spanDays;
    if (dir === 1) setView({ ...view, win: Math.max(7, Math.round(current / 2)) });
    else {
      const next = current * 2;
      setView({ ...view, win: next >= spanDays ? null : next });
    }
  }
  return (
    <span
      data-no-shot="1"
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {time && (
        <>
          <span
            style={{
              display: "inline-flex",
              background: "var(--panel-2)",
              borderRadius: 6,
              padding: 2,
              gap: 2,
            }}
          >
            {PRESETS.map((p) => {
              const active = view.win === p.days;
              return (
                <button
                  key={p.label}
                  onClick={() => setView({ ...view, win: p.days })}
                  style={{
                    ...controlStyle,
                    height: 20,
                    padding: "0 8px",
                    border: "none",
                    borderRadius: 4,
                    background: active ? "var(--ink)" : "transparent",
                    color: active ? "var(--white)" : "var(--ink-2)",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </span>
          <button onClick={() => zoom(1)} title="Zoom in (halve the window)"
            style={{ ...controlStyle, width: 24 }}>+</button>
          <button onClick={() => zoom(-1)} title="Zoom out (double the window)"
            style={{ ...controlStyle, width: 24 }}>−</button>
        </>
      )}
      {chainSel && (
        <select
          value={view.chain}
          onChange={(e) => setView({ ...view, chain: e.target.value })}
          style={{ ...controlStyle, padding: "0 6px", maxWidth: 120 }}
        >
          <option value="all">All chains</option>
          {chains.map((c) => (
            <option key={c} value={c}>
              {CHAIN_LABELS[c] ?? c}
            </option>
          ))}
        </select>
      )}
      {onShot && (
        <button
          onClick={onShot}
          title="Download this panel as PNG"
          style={{
            ...controlStyle,
            padding: "0 8px",
            background: "var(--ink)",
            color: "var(--white)",
            fontWeight: 600,
          }}
        >
          PNG
        </button>
      )}
    </span>
  );
}

type Props = {
  weekly: SeriesRow[];
  daily: SeriesRow[];
  flows: FlowRow[];
  positions: PositionRow[];
  chainStats: ChainStat[];
  holders: HolderRow[];
  navs: NavRow[];
  latestDay: string;
};

export default function DashboardClient({
  weekly,
  daily,
  flows,
  positions,
  chainStats,
  holders,
  navs,
  latestDay,
}: Props) {
  const [aumView, setAumView] = useState<ViewState>({ win: null, chain: "all" });
  const [flowsView, setFlowsView] = useState<ViewState>({ win: null, chain: "all" });
  const [shareChain, setShareChain] = useState("all");
  const [holdersChain, setHoldersChain] = useState("all");

  const refs = {
    aum: useRef<HTMLDivElement>(null),
    share: useRef<HTMLDivElement>(null),
    split: useRef<HTMLDivElement>(null),
    flows: useRef<HTMLDivElement>(null),
    holders: useRef<HTMLDivElement>(null),
  };

  async function shoot(key: keyof typeof refs) {
    const node = refs[key].current;
    if (!node) return;
    const { toPng } = await import("html-to-image");
    const url = await toPng(node, {
      backgroundColor: "#05060b",
      pixelRatio: 2,
      filter: (n) => !(n instanceof HTMLElement && n.dataset?.noShot === "1"),
    });
    const a = document.createElement("a");
    a.download = `tokenized-treasuries-${key}-${latestDay}.png`;
    a.href = url;
    a.click();
  }

  const chains = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of positions)
      totals.set(p.chain, (totals.get(p.chain) ?? 0) + p.aumUsd);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [positions]);

  const spanDays = useMemo(() => {
    if (!weekly.length) return 365;
    const first = new Date(weekly[0].day).getTime();
    return Math.ceil((new Date(latestDay).getTime() - first) / 86400000);
  }, [weekly, latestDay]);

  function cutoffFor(win: number | null) {
    if (win == null) return null;
    const d = new Date(latestDay);
    d.setDate(d.getDate() - win);
    return d.toISOString().slice(0, 10);
  }

  // ---- AUM chart (per-panel window + chain) ----
  const aum = useMemo(() => {
    const cutoff = cutoffFor(aumView.win);
    const source =
      aumView.win != null && aumView.win <= DAILY_LIMIT ? daily : weekly;
    const byDay = new Map<string, Record<string, number | string>>();
    for (const r of source) {
      if (cutoff && r.day < cutoff) continue;
      if (aumView.chain !== "all" && r.chain !== aumView.chain) continue;
      if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day });
      const row = byDay.get(r.day)!;
      row[r.symbol] = ((row[r.symbol] as number) ?? 0) + r.aum;
    }
    const data = [...byDay.values()].sort((a, b) =>
      String(a.day) < String(b.day) ? -1 : 1
    );
    const last = data[data.length - 1] ?? {};
    const symbols = Object.keys(last)
      .filter((k) => k !== "day")
      .sort((a, b) => (last[b] as number) - (last[a] as number));
    return { data: data as any[], symbols };
  }, [weekly, daily, aumView, latestDay]);

  // ---- flows (per-panel window + chain; default 26 weeks) ----
  const flowsData = useMemo(() => {
    const cutoff =
      cutoffFor(flowsView.win) ??
      new Date(Date.now() - 182 * 86400000).toISOString().slice(0, 10);
    const byWeek = new Map<string, Record<string, number | string>>();
    const seen = new Set<string>();
    for (const r of flows) {
      if (r.week < cutoff) continue;
      if (flowsView.chain !== "all" && r.chain !== flowsView.chain) continue;
      if (!byWeek.has(r.week)) byWeek.set(r.week, { week: r.week });
      const row = byWeek.get(r.week)!;
      row[r.symbol] = ((row[r.symbol] as number) ?? 0) + r.net;
      seen.add(r.symbol);
    }
    return {
      data: [...byWeek.values()].sort((a, b) =>
        String(a.week) < String(b.week) ? -1 : 1
      ) as any[],
      symbols: [...seen],
    };
  }, [flows, flowsView, latestDay]);

  // ---- current-state aggregates ----
  const shareRows = useMemo(() => {
    const filtered = positions.filter(
      (p) => shareChain === "all" || p.chain === shareChain
    );
    const bySymbol = new Map<
      string,
      { symbol: string; issuer: string; chains: Set<string>; supply: number;
        aumUsd: number; isNavProxy: boolean }
    >();
    for (const p of filtered) {
      if (!bySymbol.has(p.symbol))
        bySymbol.set(p.symbol, {
          symbol: p.symbol, issuer: p.issuer, chains: new Set(),
          supply: 0, aumUsd: 0, isNavProxy: false,
        });
      const s = bySymbol.get(p.symbol)!;
      s.chains.add(p.chain);
      s.supply += p.supply;
      s.aumUsd += p.aumUsd;
      s.isNavProxy = s.isNavProxy || p.isNavProxy;
    }
    const total = [...bySymbol.values()].reduce((s, r) => s + r.aumUsd, 0);
    return [...bySymbol.values()]
      .sort((a, b) => b.aumUsd - a.aumUsd)
      .map((s) => ({
        symbol: s.symbol, issuer: s.issuer, chains: s.chains.size,
        supply: s.supply, aumUsd: s.aumUsd, share: s.aumUsd / total,
        isNavProxy: s.isNavProxy,
      }));
  }, [positions, shareChain]);

  const chainSlices = useMemo(() => {
    const byChain = new Map<string, number>();
    for (const p of positions)
      byChain.set(p.chain, (byChain.get(p.chain) ?? 0) + p.aumUsd);
    return [...byChain.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c, aumUsd]) => ({ chain: c, aumUsd }));
  }, [positions]);

  const kpis = useMemo(() => {
    const totalAum = positions.reduce((s, p) => s + p.aumUsd, 0);
    return {
      totalAum,
      netFlow30d: chainStats.reduce((s, r) => s + r.netFlow30d, 0),
      holders: chainStats.reduce((s, r) => s + r.holders, 0),
      products: new Set(positions.map((p) => p.symbol.replace("-I", ""))).size,
      deployments: positions.length,
      chains: new Set(positions.map((p) => p.chain)).size,
    };
  }, [positions, chainStats]);

  const holdersRows = useMemo(
    () => holders.filter((h) => holdersChain === "all" || h.chain === holdersChain),
    [holders, holdersChain]
  );

  return (
    <div style={{ background: "var(--white)" }}>
      {/* Topbar: branding only. Controls live on each panel */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          minHeight: 60,
          borderBottom: "1px solid var(--border)",
          marginBottom: 20,
        }}
      >
        <Image src="/iopn-mark.png" alt="IOPn" width={30} height={30}
          style={{ borderRadius: 7, border: "1px solid var(--border)" }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-0.01em" }}>
            Tokenized Treasuries
          </span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            IOPn
          </span>
        </div>
        <nav
          data-no-shot="1"
          style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}
        >
          <span
            className="mono"
            style={{
              fontSize: 12,
              padding: "4px 12px",
              borderRadius: 6,
              background: "var(--ink)",
              color: "var(--white)",
              fontWeight: 600,
            }}
          >
            Dashboard
          </span>
          <a
            href="/report"
            className="mono"
            style={{
              fontSize: 12,
              padding: "4px 12px",
              borderRadius: 6,
              color: "var(--ink-2)",
            }}
          >
            Report
          </a>
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="live-dot" />
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
            DATA AS OF {fmtDate(latestDay).toUpperCase()}
          </span>
        </div>
      </header>

      {/* What this is */}
      <p
        style={{
          fontSize: 13.5,
          color: "var(--ink-2)",
          lineHeight: 1.6,
          maxWidth: 880,
          margin: "0 0 18px",
        }}
      >
        Live market intelligence on tokenized U.S. Treasury funds: BUIDL,
        USYC, USDY, BENJI, USTB, OUSG, TBILL, and WTGXX tracked
        contract-by-contract across 16 blockchains. Every figure is measured
        first-party from the chains themselves and verified against on-chain
        supply before it ships. The full method is at the bottom of the page.
      </p>

      {/* KPI row (always all-chain) */}
      <div
        data-kpi-row
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <StatCard
          label="Indexed AUM"
          value={fmtUsd(kpis.totalAum)}
          sub={`${kpis.deployments} deployments · ${kpis.chains} chains`}
        />
        <StatCard
          label="Net flow · 30d"
          value={`${kpis.netFlow30d >= 0 ? "+" : ""}${fmtUsd(kpis.netFlow30d)}`}
          tone={kpis.netFlow30d >= 0 ? "good" : "bad"}
          sub="mints minus redemptions"
        />
        <StatCard
          label="Holder positions"
          value={fmtNum(kpis.holders)}
          sub="non-dust balances"
        />
        <StatCard
          label="Products tracked"
          value={String(kpis.products)}
          sub="from transfer-level events"
        />
      </div>

      {/* Hero AUM chart */}
      <div ref={refs.aum} style={{ marginBottom: 16 }}>
        <Panel
          title="Assets under management"
          note={
            (aumView.win ? `last ${aumView.win}d` : "full history") +
            (aumView.chain !== "all"
              ? ` · ${CHAIN_LABELS[aumView.chain] ?? aumView.chain}`
              : "")
          }
          explain="How much money each product manages on-chain over time. Every band is one product; its height is token supply rebuilt from on-chain mint and redemption activity, valued at NAV. History is event-level on the 8 EVM chains and reconstructed daily on Stellar, Aptos, Solana, XRP Ledger, and Plume; Sei, Sui, and Noble enter at current value only."
          aside={
            <ChartControls
              view={aumView}
              setView={setAumView}
              chains={chains}
              spanDays={spanDays}
              onShot={() => shoot("aum")}
            />
          }
        >
          {aum.data.length ? (
            <AumChart data={aum.data} symbols={aum.symbols} />
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
              No history series for this selection (current-value-only venue).
            </p>
          )}
        </Panel>
      </div>

      {/* Market structure */}
      <div
        data-two-col
        style={{
          display: "grid",
          gridTemplateColumns: "3fr 2fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div ref={refs.share}>
          <Panel
            title="Market share"
            note={
              shareChain === "all"
                ? "latest, by product"
                : `latest · ${CHAIN_LABELS[shareChain] ?? shareChain}`
            }
            explain="Each product's slice of the total indexed AUM right now, summed across every chain it is deployed on."
            aside={
              <ChartControls
                view={{ win: null, chain: shareChain }}
                setView={(v) => setShareChain(v.chain)}
                chains={chains}
                spanDays={spanDays}
                time={false}
                onShot={() => shoot("share")}
              />
            }
          >
            <ShareBars rows={shareRows} />
          </Panel>
        </div>
        <div ref={refs.split}>
          <Panel
            title="Chain split"
            note="latest, by network"
            explain="Where the assets actually sit: the same AUM, grouped by the network hosting the tokens."
            aside={
              <ChartControls
                view={{ win: null, chain: "all" }}
                setView={() => {}}
                chains={chains}
                spanDays={spanDays}
                time={false}
                chainSel={false}
                onShot={() => shoot("split")}
              />
            }
          >
            <ChainSplitPie slices={chainSlices} selected="all" />
          </Panel>
        </div>
      </div>

      {/* Momentum */}
      <div ref={refs.flows} style={{ marginBottom: 16 }}>
        <Panel
          title="Weekly net flows"
          note={
            `mints minus redemptions, USD` +
            (flowsView.win ? `, last ${flowsView.win}d` : ", last 26 weeks") +
            (flowsView.chain !== "all"
              ? ` · ${CHAIN_LABELS[flowsView.chain] ?? flowsView.chain}`
              : "")
          }
          explain="Primary-market momentum: dollars minted (subscriptions) minus dollars redeemed each week, colored by product. Bars above zero mean net capital came in that week; below zero, investors cashed out. EVM flows are event-exact; reconstructed chains use day-over-day supply changes."
          aside={
            <ChartControls
              view={flowsView}
              setView={setFlowsView}
              chains={chains}
              spanDays={spanDays}
              onShot={() => shoot("flows")}
            />
          }
        >
          {flowsData.data.length ? (
            <FlowsChart data={flowsData.data} symbols={flowsData.symbols} />
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
              No mint/redemption events for this selection.
            </p>
          )}
        </Panel>
      </div>

      {/* Holders */}
      <div ref={refs.holders} style={{ marginBottom: 16 }}>
        <Panel
          title="Holder structure"
          note="EVM running balances + Stellar holder lists"
          explain="Who holds each deployment and how concentrated it is: wallet count, the share controlled by the ten largest wallets, HHI concentration (1.000 = one holder owns everything), and the median position size in tokens. EVM chains are reconstructed from transfer events; Stellar from the live holder registry."
          aside={
            <ChartControls
              view={{ win: null, chain: holdersChain }}
              setView={(v) => setHoldersChain(v.chain)}
              chains={chains}
              spanDays={spanDays}
              time={false}
              onShot={() => shoot("holders")}
            />
          }
          flush
        >
          <HoldersTable rows={holdersRows} />
        </Panel>
      </div>

      {/* Methodology */}
      <Panel title="Methodology" note="how every number on this page is made">
        <div
          data-two-col
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "18px 28px",
            fontSize: 12.5,
            color: "var(--ink-2)",
            lineHeight: 1.65,
          }}
        >
          <div>
            <div className="micro-label" style={{ marginBottom: 6 }}>
              What this dashboard measures
            </div>
            <p>
              Tokenized U.S. Treasury funds: money-market and T-bill products
              issued on public blockchains by BlackRock/Securitize (BUIDL),
              Hashnote/Circle (USYC), Ondo (USDY, OUSG), Franklin Templeton
              (BENJI), Superstate (USTB), OpenEden (TBILL), and WisdomTree
              (WTGXX), tracked at the level of individual token contracts
              across 16 networks. Everything is measured first-party from the
              chains themselves; no third-party analytics feed is in the loop.
            </p>
          </div>
          <div>
            <div className="micro-label" style={{ marginBottom: 6 }}>
              Supply &amp; AUM
            </div>
            <p>
              For every registered contract we index each on-chain transfer
              event. Supply is mints (transfers from the zero address) minus
              redemptions (transfers to it), and each deployment must match
              its live on-chain <span className="mono">totalSupply()</span>{" "}
              exactly before its numbers ship. AUM is supply × NAV: peg
              products (BUIDL, BENJI, WTGXX) hold $1.00 and pay yield as new
              tokens, while accruing products appreciate and use dated
              reference NAV:{" "}
              {navs.map((n, i) => (
                <span key={n.symbol} className="mono" style={{ fontSize: 11.5 }}>
                  {n.symbol} ${n.nav}
                  {i < navs.length - 1 ? " · " : ""}
                </span>
              ))}{" "}
              (as of {navs[0] ? fmtDate(navs[0].asOf) : "n/a"}).
            </p>
          </div>
          <div>
            <div className="micro-label" style={{ marginBottom: 6 }}>
              Chain coverage &amp; sources
            </div>
            <p>
              Eight EVM chains (Ethereum, BNB Chain, Avalanche, Arbitrum,
              Optimism, Polygon, Base, Mantle, plus Plume) carry full
              event-level history from archive RPCs. Stellar history and
              holder lists come from the Horizon API and stellar.expert;
              Aptos from its public indexer; Solana from mint-account
              transaction scans; XRP Ledger from the issuer's complete
              transaction history. Sei, Sui, and Noble have no free archive
              source, so they enter at verified current value only. Mantle
              timestamps are interpolated between block anchors (minutes of
              error at most; amounts are exact).
            </p>
          </div>
          <div>
            <div className="micro-label" style={{ marginBottom: 6 }}>
              Flows &amp; holders
            </div>
            <p>
              Net flows are primary-market activity: subscription mints minus
              redemption burns, valued at NAV. On EVM chains they are
              event-exact; on reconstructed chains they are day-over-day
              supply changes, which is the same quantity at daily resolution.
              Holder counts are running balances above a 0.000001-token dust
              threshold (Stellar uses its live holder registry). Institutional
              omnibus wallets hold for many underlying investors, so true
              beneficial-owner counts are higher than wallet counts.
            </p>
          </div>
          <div>
            <div className="micro-label" style={{ marginBottom: 6 }}>
              Quality gates
            </div>
            <p>
              Nothing ships unverified. Every event-indexed deployment must
              reconcile to on-chain <span className="mono">totalSupply()</span>{" "}
              to the cent on every refresh; every reconstructed history series
              must land within 0.5% of an independently verified supply
              snapshot or it is rejected outright. USDM is excluded entirely:
              its rebasing supply cannot be derived from transfer events, and
              we do not publish numbers we cannot prove.
            </p>
          </div>
          <div>
            <div className="micro-label" style={{ marginBottom: 6 }}>
              Cadence &amp; caveats
            </div>
            <p>
              Event ingestion and supply snapshots refresh hourly; history
              series and holder registries daily. Reference NAVs for accruing
              products are updated with each report cycle, so their USD values
              drift slightly between updates while token supplies stay exact.
              Product AUM sums can overlap: OUSG holds BUIDL as its primary
              underlying, so summing every product overstates net Treasury
              exposure.
            </p>
          </div>
        </div>
      </Panel>

      <footer
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 24,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>
          © {new Date().getFullYear()} IOPN · TOKENIZED TREASURIES ·
          FIRST-PARTY DATA, INDEPENDENTLY VERIFIABLE · DASHBOARD BUILT BY
          DATUM LABS
        </span>
        <a
          data-no-shot="1"
          href="/api/summary"
          className="mono"
          style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}
        >
          API →
        </a>
      </footer>
    </div>
  );
}
