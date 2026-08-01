import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import GovernClient from "./GovernClient";
import { getReapers, getSupply, getConsumed } from "@/lib/chain";
import styles from "./govern.module.css";

// THE PYRAMID — Cubist Souls' soul-bound govern (PLAN_CUBISTSOULS_GOVERN.md).
// Still noindex + unlinked (Adrian shares the URL directly until he orders it
// into the nav). Since 1-aug it carries the FIRST REAL PROPOSAL: votes are
// EIP-191 ballots stored via /api/govern/vote and tallied client-side, weighed
// with the soul-bound power calculator (see Proposal.tsx). The pyramid + cycle
// explainers fold shut so the ballot is the one thing above the fold.
export const metadata: Metadata = {
  title: "Govern — the pyramid",
  description: "Soul-bound governance, drawn. Design preview.",
  robots: { index: false, follow: false, nocache: true },
};

// The pyramid's live counts (Order size, cohort split) are on-chain-ish and don't
// need the anti-redeploy path — a 5-min ISR snapshot is plenty. The tunable NUMBERS
// (points, crown, quorum…) come from the client-fetched hot params instead.
export const revalidate = 300;

const COHORTS_URL =
  "https://raw.githubusercontent.com/adriangallery/cubist-souls-assets/main/cohorts/cohorts.json";

export type PyramidCounts = { reapers: number; og: number; eras: number; burned: number };

async function liveCounts(): Promise<PyramidCounts> {
  const [reapers, cohorts, supply, consumed] = await Promise.all([
    getReapers()
      .then((r) => r.length)
      .catch(() => 0),
    fetch(COHORTS_URL, { next: { revalidate: 300 } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    getSupply().catch(() => null),
    getConsumed().catch(() => ({ total: 0, canvases: [] })),
  ]);
  let og = 0;
  let eras = 0;
  if (cohorts && cohorts.cohorts) {
    for (const v of Object.values(cohorts.cohorts)) {
      if (Number(v) === 0) og++;
      else eras++;
    }
  }
  // Same math as the home hero: GLOBAL Pikkazo burns = freed (supply) + consumed.
  const burned = (supply ?? 0) + (consumed?.total ?? 0);
  return { reapers, og, eras, burned };
}

export default async function GovernPage() {
  const counts = await liveCounts();
  return (
    <div className={styles.gov}>
      <Nav />
      <GovernClient counts={counts} />
      <Footer />
    </div>
  );
}
