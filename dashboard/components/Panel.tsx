import type { ReactNode } from "react";

export default function Panel({
  title,
  note,
  aside,
  explain,
  children,
  flush = false,
}: {
  title: string;
  note?: string;
  aside?: ReactNode;
  explain?: string;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="panel">
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          padding: "13px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h2
          style={{
            fontSize: 15,
            fontWeight: 650,
            letterSpacing: "-0.01em",
            lineHeight: 1.35,
          }}
        >
          {title}
        </h2>
        {note && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{note}</span>
        )}
        {aside && <span style={{ marginLeft: "auto" }}>{aside}</span>}
      </header>
      <div style={{ padding: flush ? 0 : 16 }}>
        {explain && (
          <p
            style={{
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.55,
              maxWidth: 860,
              padding: flush ? "10px 16px" : 0,
              marginBottom: flush ? 0 : 12,
              borderBottom: flush ? "1px solid var(--panel-3)" : undefined,
            }}
          >
            {explain}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}
