import { symbolColor } from "@/lib/palette";
import { fmtPct, fmtUsd } from "@/lib/format";
import { REFERENCE_AS_OF, RWA_XYZ_TOTALS } from "@/lib/reference";
import type { ShareRow } from "@/lib/queries";

// BUIDL-I is a share class of BUIDL; rwa.xyz reports them as one product.
function mergedOurs(rows: ShareRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const key = r.symbol === "BUIDL-I" ? "BUIDL" : r.symbol;
    m.set(key, (m.get(key) ?? 0) + r.aumUsd);
  }
  return m;
}

export default function CoverageTable({ rows }: { rows: ShareRow[] }) {
  const ours = mergedOurs(rows);
  const items = [...ours.entries()]
    .map(([symbol, aum]) => ({
      symbol,
      aum,
      ref: RWA_XYZ_TOTALS[symbol],
      coverage: RWA_XYZ_TOTALS[symbol] ? aum / RWA_XYZ_TOTALS[symbol] : null,
    }))
    .sort((a, b) => (b.ref ?? 0) - (a.ref ?? 0));

  const totalOurs = items.reduce((s, i) => s + i.aum, 0);
  const totalRef = items.reduce((s, i) => s + (i.ref ?? 0), 0);

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Indexed</th>
            <th>All chains (rwa.xyz)</th>
            <th>Coverage</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.symbol}>
              <td>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: "var(--font-sans)",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: symbolColor(i.symbol),
                    }}
                  />
                  {i.symbol}
                </span>
              </td>
              <td style={{ fontWeight: 600 }}>{fmtUsd(i.aum)}</td>
              <td style={{ color: "var(--muted)" }}>
                {i.ref ? fmtUsd(i.ref) : "n/a"}
              </td>
              <td
                style={{
                  color:
                    (i.coverage ?? 0) > 0.9
                      ? "var(--good)"
                      : (i.coverage ?? 0) > 0.5
                        ? "var(--ink)"
                        : "var(--warning)",
                  fontWeight: 600,
                }}
              >
                {i.coverage != null ? fmtPct(Math.min(i.coverage, 1)) : "n/a"}
              </td>
            </tr>
          ))}
          <tr>
            <td style={{ fontFamily: "var(--font-sans)", fontWeight: 650 }}>Total</td>
            <td style={{ fontWeight: 700 }}>{fmtUsd(totalOurs)}</td>
            <td style={{ color: "var(--muted)", fontWeight: 600 }}>
              {fmtUsd(totalRef)}
            </td>
            <td style={{ fontWeight: 700 }}>{fmtPct(totalOurs / totalRef)}</td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: "var(--faint)", marginTop: 8 }}>
        Reference totals from rwa.xyz as of {REFERENCE_AS_OF}. Indexed =
        EVM event history plus verified non-EVM supply snapshots. Residual
        gaps are reference-date drift and deployments pending backfill.
      </p>
    </div>
  );
}
