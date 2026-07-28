import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import GovernClient from "./GovernClient";
import { getReapers } from "@/lib/chain";
import styles from "./govern.module.css";

// THE PYRAMID — hidden design page for Cubist Souls' soul-bound govern (PLAN_
// CUBISTSOULS_GOVERN.md). HIDDEN by Adrian's order until he decides visually:
//   • noindex/nofollow (robots below) — never indexed;
//   • NOT linked from any page (no entry in Nav/Footer/anywhere) — reachable only
//     by typing /govern.
// It is a DESIGN DEMO: the pyramid + your real soul-bound power (client-side, from
// the hot params JSON) + a LOCAL fake ballot. Nothing on-chain, nothing persisted
// server-side. The real EIP-191 vote engine (govern-x9v4k2) is wired in a later
// phase once Adrian freezes this design.
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

export type PyramidCounts = { reapers: number; og: number; eras: number };

async function liveCounts(): Promise<PyramidCounts> {
  const [reapers, cohorts] = await Promise.all([
    getReapers()
      .then((r) => r.length)
      .catch(() => 0),
    fetch(COHORTS_URL, { next: { revalidate: 300 } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);
  let og = 0;
  let eras = 0;
  if (cohorts && cohorts.cohorts) {
    for (const v of Object.values(cohorts.cohorts)) {
      if (Number(v) === 0) og++;
      else eras++;
    }
  }
  return { reapers, og, eras };
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
