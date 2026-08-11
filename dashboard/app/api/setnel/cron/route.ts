import { NextResponse } from "next/server";
import { runDetectors } from "@/lib/setnel/runtime";
import "@/lib/setnel/detectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.SETNEL_CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hubUrl = process.env.SETNEL_HUB_URL;
  const secret = process.env.SETNEL_SECRET;
  if (!hubUrl || !secret) {
    return NextResponse.json(
      { skipped: true, reason: "SETNEL_HUB_URL / SETNEL_SECRET not configured" },
      { status: 200 }
    );
  }

  const report = await runDetectors({
    dashboardId: "tokenized-treasuries",
    hubUrl,
    secret,
  });
  return NextResponse.json(report);
}
