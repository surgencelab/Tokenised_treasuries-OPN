import { NextResponse } from "next/server";
import { getKpis, getMarketShare, getChainSplit } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const [kpis, share, chains] = await Promise.all([
    getKpis(),
    getMarketShare(),
    getChainSplit(),
  ]);
  return NextResponse.json(
    { asOf: kpis.latestDay, kpis, marketShare: share, chainSplit: chains },
    { headers: { "cache-control": "public, max-age=300" } }
  );
}
