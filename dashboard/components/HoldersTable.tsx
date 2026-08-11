import { symbolColor, CHAIN_LABELS } from "@/lib/palette";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import type { HolderRow } from "@/lib/queries";

export default function HoldersTable({ rows }: { rows: HolderRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Chain</th>
            <th>AUM</th>
            <th>Holders</th>
            <th>Top-10 share</th>
            <th>HHI</th>
            <th>Median holding</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productId}>
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
                      background: symbolColor(r.symbol),
                    }}
                  />
                  {r.symbol}
                </span>
              </td>
              <td style={{ color: "var(--muted)" }}>
                {CHAIN_LABELS[r.chain] ?? r.chain}
              </td>
              <td style={{ fontWeight: 600 }}>{fmtUsd(r.aumUsd)}</td>
              <td>{fmtNum(r.holders)}</td>
              <td>{fmtPct(r.top10Share)}</td>
              <td>{r.hhi.toFixed(3)}</td>
              <td>{fmtNum(r.medianHolding)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
