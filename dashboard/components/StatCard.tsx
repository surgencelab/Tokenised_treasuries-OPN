export default function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const valueColor =
    tone === "good"
      ? "var(--good)"
      : tone === "warn"
        ? "var(--warning)"
        : tone === "bad"
          ? "var(--critical)"
          : "var(--ink)";
  return (
    <div className="panel" style={{ padding: "14px 16px", borderRadius: 8 }}>
      <div className="micro-label">{label}</div>
      <div className="kpi-value" style={{ color: valueColor, marginTop: 6 }}>
        {value}
      </div>
      {sub && (
        <div
          className="mono"
          style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
