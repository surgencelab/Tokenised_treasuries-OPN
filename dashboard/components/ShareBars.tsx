import { symbolColor } from "@/lib/palette";
import { fmtPct, fmtUsd } from "@/lib/format";
import type { ShareRow } from "@/lib/queries";

export default function ShareBars({ rows }: { rows: ShareRow[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.symbol}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: symbolColor(r.symbol),
                alignSelf: "center",
                flex: "none",
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{r.symbol}</span>
            <span style={{ fontSize: 11, color: "var(--faint)" }}>
              {r.issuer} · {r.chains} chain{r.chains > 1 ? "s" : ""}
            </span>
            <span
              className="mono"
              style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 600 }}
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
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: "var(--panel-3)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.max(r.share * 100, 0.5)}%`,
                height: "100%",
                borderRadius: 3,
                background: symbolColor(r.symbol),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
