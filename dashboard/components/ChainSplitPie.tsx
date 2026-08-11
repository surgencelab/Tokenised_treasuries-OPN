"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHAIN_LABELS, chainColor } from "@/lib/palette";
import { fmtPct, fmtUsd } from "@/lib/format";

export type ChainSlice = { chain: string; aumUsd: number };

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div
      className="panel"
      style={{
        padding: "8px 10px",
        fontSize: 12,
        boxShadow: "0 1px 2px rgba(10,10,10,0.04), 0 8px 24px rgba(10,10,10,0.08)",
      }}
    >
      <span style={{ fontWeight: 600 }}>
        {CHAIN_LABELS[p.payload.chain] ?? p.payload.chain}
      </span>{" "}
      <span className="mono" style={{ fontWeight: 700 }}>
        {fmtUsd(p.value)}
      </span>
    </div>
  );
}

export default function ChainSplitPie({
  slices,
  selected,
}: {
  slices: ChainSlice[];
  selected: string; // 'all' or a chain id
}) {
  const total = slices.reduce((s, r) => s + r.aumUsd, 0);
  const top = slices.slice(0, 9);
  const rest = slices.slice(9);
  const data = rest.length
    ? [...top, { chain: "other", aumUsd: rest.reduce((s, r) => s + r.aumUsd, 0) }]
    : top;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div style={{ width: 210, height: 210, position: "relative", flex: "none" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<PieTooltip />} />
            <Pie
              data={data}
              dataKey="aumUsd"
              nameKey="chain"
              innerRadius="62%"
              outerRadius="96%"
              paddingAngle={1.5}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell
                  key={d.chain}
                  fill={d.chain === "other" ? "#d1d5db" : chainColor(d.chain)}
                  opacity={selected === "all" || selected === d.chain ? 1 : 0.25}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span className="micro-label">Total</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
            {fmtUsd(total)}
          </span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 5 }}>
        {data.map((r) => (
          <div key={r.chain} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: r.chain === "other" ? "#d1d5db" : chainColor(r.chain),
                flex: "none",
              }}
            />
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>
              {r.chain === "other" ? "Other" : (CHAIN_LABELS[r.chain] ?? r.chain)}
            </span>
            <span
              className="mono"
              style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600 }}
            >
              {fmtUsd(r.aumUsd)}
            </span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--muted)", width: 44, textAlign: "right" }}
            >
              {fmtPct(r.aumUsd / total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
