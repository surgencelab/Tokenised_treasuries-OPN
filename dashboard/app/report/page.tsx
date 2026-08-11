import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Tokenized Treasuries: Inside the On-Chain Bond Market · IOPn",
  description:
    "IOPn report on the $10.5B tokenized U.S. Treasury market: market structure, flows, holders, yield, and the missing rails. First-party data across 16 chains.",
};

const tabStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "4px 12px",
  borderRadius: 6,
};

export default function ReportPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          minHeight: 56,
          padding: "0 20px",
          borderBottom: "1px solid var(--border)",
          flex: "none",
        }}
      >
        <Image src="/iopn-mark.png" alt="IOPn" width={28} height={28}
          style={{ borderRadius: 7, border: "1px solid var(--border)" }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-0.01em" }}>
            Tokenized Treasuries
          </span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            IOPn
          </span>
        </div>
        <nav style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <Link href="/" style={{ ...tabStyle, color: "var(--ink-2)" }}>
            Dashboard
          </Link>
          <span
            style={{
              ...tabStyle,
              background: "var(--ink)",
              color: "var(--white)",
              fontWeight: 600,
            }}
          >
            Report
          </span>
        </nav>
      </header>
      <iframe
        src="/report-content.html"
        title="Tokenized Treasuries: Inside the On-Chain Bond Market"
        style={{ border: 0, width: "100%", flex: 1 }}
      />
    </div>
  );
}
