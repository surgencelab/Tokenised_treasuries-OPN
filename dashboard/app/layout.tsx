import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";

// IOPn brand typeface; Geist Mono stays as the functional data mono.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Tokenized Treasuries · IOPn",
  description:
    "First-party on-chain analytics for tokenized U.S. Treasury products: AUM, flows, holders, and market structure across 16 chains.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jakarta.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
