import DashboardClient from "@/components/DashboardClient";
import {
  getAumDailyByChain,
  getAumWeeklyByChain,
  getChainStats,
  getFlowsWeeklyByChain,
  getHolderMetrics,
  getNavReference,
  getPositions,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [weekly, daily, flows, positions, chainStats, holders, navs] =
    await Promise.all([
      getAumWeeklyByChain(),
      getAumDailyByChain(),
      getFlowsWeeklyByChain(),
      getPositions(),
      getChainStats(),
      getHolderMetrics(),
      getNavReference(),
    ]);

  const latestDay = weekly.reduce(
    (m, r) => (r.day > m ? r.day : m),
    weekly[0]?.day ?? new Date().toISOString().slice(0, 10)
  );

  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "0 20px 48px" }}>
      <DashboardClient
        weekly={weekly}
        daily={daily}
        flows={flows}
        positions={positions}
        chainStats={chainStats}
        holders={holders}
        navs={navs}
        latestDay={latestDay}
      />
    </main>
  );
}
