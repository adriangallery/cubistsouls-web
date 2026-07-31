import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import RafflesClient from "./RafflesClient";
import { loadRaffles } from "@/lib/raffle";
import styles from "./raffles.module.css";

// THE RAFFLES — where the reaper tickets are finally spent.
//
// HIDDEN by Adrian's order (30-jul) until he wants it seen:
//   • noindex/nofollow below — never indexed;
//   • NOT linked from Nav, Footer or anywhere else — reachable only by typing /raffles.
//
// Everything the page shows about an occasion comes from the diamond (RaffleFacet),
// so the site can never disagree with the contract about the rules. Until that facet
// is cut, loadRaffles() returns null and the page renders the first occasion as a
// clearly-badged PREVIEW.
export const metadata: Metadata = {
  title: "The Raffles — Cubist Souls",
  description: "Where the tickets are spent.",
  robots: { index: false, follow: false, nocache: true },
};

// The occasion changes on a human timescale, not a per-request one.
export const revalidate = 60;

export default async function RafflesPage() {
  const data = await loadRaffles();
  return (
    <div className={styles.rf}>
      <Nav />
      <RafflesClient data={data} />
      <Footer />
    </div>
  );
}
