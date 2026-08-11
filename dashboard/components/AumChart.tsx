"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { symbolColor } from "@/lib/palette";
import { fmtUsd } from "@/lib/format";
import type { AumPoint } from "@/lib/queries";

function fmtAxisDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value ?? 0), 0);
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
        {new Date(label).toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
          year: "numeric",
        })}
      </div>
      {[...payload]
        .filter((p: any) => p.value > 0)
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
                background: p.color,
                flex: "none",
              }}
            />
            <span style={{ color: "var(--ink-2)" }}>{p.dataKey}</span>
            <span className="mono" style={{ marginLeft: "auto", fontWeight: 600 }}>
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
        <span style={{ color: "var(--muted)" }}>Total</span>
        <span className="mono" style={{ marginLeft: "auto", fontWeight: 700 }}>
          {fmtUsd(total)}
        </span>
      </div>
    </div>
  );
}

export default function AumChart({
  data,
  symbols,
}: {
  data: AumPoint[];
  symbols: string[];
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 14px",
          padding: "0 4px 12px",
        }}
      >
        {symbols.map((s) => (
          <span
            key={s}
            className="mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--ink-2)",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: symbolColor(s),
              }}
            />
            {s}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={340}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--panel-3)" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={fmtAxisDate}
            tick={{ fontSize: 11, fill: "var(--faint)", fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={48}
          />
          <YAxis
            tickFormatter={(v) => fmtUsd(v)}
            tick={{ fontSize: 11, fill: "var(--faint)", fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            width={58}
          />
          <Tooltip content={<ChartTooltip />} />
          {[...symbols].reverse().map((s) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stackId="aum"
              stroke={symbolColor(s)}
              fill={symbolColor(s)}
              fillOpacity={0.72}
              strokeWidth={1}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
