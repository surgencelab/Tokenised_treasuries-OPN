import { CHAIN_LABELS } from "@/lib/palette";
import { fmtPct, fmtUsd } from "@/lib/format";
import type { ChainRow } from "@/lib/queries";

export default function ChainSplit({ rows }: { rows: ChainRow[] }) {
  const max = rows[0]?.share ?? 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r) => (
        <div
          key={r.chain}
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, width: 88, flex: "none" }}>
            {CHAIN_LABELS[r.chain] ?? r.chain}
          </span>
          <div
            style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              background: "var(--panel-3)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.max((r.share / max) * 100, 1)}%`,
                height: "100%",
                borderRadius: 3,
                background: "var(--ink-2)",
              }}
            />
          </div>
          <span
            className="mono"
            style={{ fontSize: 12.5, fontWeight: 600, width: 70, textAlign: "right" }}
          >
            {fmtUsd(r.aumUsd)}
          </span>
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--muted)", width: 44, textAlign: "right" }}
          >
            {fmtPct(r.share)}
          </span>
        </div>
      ))}
    </div>
  );
}
