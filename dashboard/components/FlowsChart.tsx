"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { symbolColor } from "@/lib/palette";
import { fmtUsd } from "@/lib/format";
import type { FlowPoint } from "@/lib/queries";

function fmtAxisDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function FlowTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p: any) => (p.value ?? 0) !== 0);
  const net = rows.reduce((s: number, p: any) => s + p.value, 0);
  return (
    <div
      className="panel"
      style={{
        padding: "10px 12px",
        boxShadow: "0 1px 2px rgba(10,10,10,0.04), 0 8px 24px rgba(10,10,10,0.08)",
        fontSize: 12,
      }}
    >
      <div className="micro-label" style={{ marginBottom: 6 }}>
        Week of {fmtAxisDate(label)}
      </div>
      {rows
        .sort((a: any, b: any) => b.value - a.value)
        .map((p: any) => (
          <div
            key={p.dataKey}
            style={{ display: "flex", alignItems: "center", gap: 8, lineHeight: 1.7 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: p.fill,
                flex: "none",
              }}
            />
            <span style={{ color: "var(--ink-2)" }}>{p.dataKey}</span>
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontWeight: 600,
                color: p.value >= 0 ? "var(--good)" : "var(--critical)",
              }}
            >
              {p.value >= 0 ? "+" : ""}
              {fmtUsd(p.value)}
            </span>
          </div>
        ))}
      <div
        style={{
          display: "flex",
          borderTop: "1px solid var(--border)",
          marginTop: 6,
          paddingTop: 6,
        }}
      >
        <span style={{ color: "var(--muted)" }}>Net</span>
        <span
          className="mono"
          style={{
            marginLeft: "auto",
            fontWeight: 700,
            color: net >= 0 ? "var(--good)" : "var(--critical)",
          }}
        >
          {net >= 0 ? "+" : ""}
          {fmtUsd(net)}
        </span>
      </div>
    </div>
  );
}

export default function FlowsChart({
  data,
  symbols,
}: {
  data: FlowPoint[];
  symbols: string[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={data}
        stackOffset="sign"
        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid stroke="var(--panel-3)" vertical={false} />
        <XAxis
          dataKey="week"
          tickFormatter={fmtAxisDate}
          tick={{ fontSize: 11, fill: "var(--faint)", fontFamily: "var(--font-mono)" }}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          minTickGap={32}
        />
        <YAxis
          tickFormatter={(v) => fmtUsd(v)}
          tick={{ fontSize: 11, fill: "var(--faint)", fontFamily: "var(--font-mono)" }}
          tickLine={false}
          axisLine={false}
          width={58}
        />
        <Tooltip content={<FlowTooltip />} cursor={{ fill: "var(--panel-2)" }} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        {symbols.map((s) => (
          <Bar
            key={s}
            dataKey={s}
            stackId="net"
            fill={symbolColor(s)}
            isAnimationActive={false}
            maxBarSize={28}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
