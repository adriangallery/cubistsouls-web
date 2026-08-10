import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import GiveawaysClient from "./GiveawaysClient";
import styles from "./giveaways.module.css";

// GIVEAWAYS — the museum lends its wall to friends.
//
// NOT /raffles. The raffles are the on-chain occasions where reaper tickets are
// spent; a giveaway here is an off-chain whitelist draw a collab manager runs
// for a PARTNER collection (Alphabot / Atlas3 territory): wallets enter with a
// free signature, the draw is a published-seed shuffle, and the winner list is
// what the partner receives for their mint.
//
// Like /raffles at birth: noindex and unlinked from Nav until Adrian wants it
// seen — the audience arrives from the Discord announcement, not from Google.
export const metadata: Metadata = {
  title: "Giveaways — Cubist Souls",
  description: "Partner mints, drawn on the museum's wall.",
  robots: { index: false, follow: false, nocache: true },
};

// The list lives in Redis and changes when a manager acts — always current,
// entry counts ride the client fetch anyway.
export const dynamic = "force-dynamic";

export default function GiveawaysPage() {
  return (
    <div className={styles.ga}>
      <Nav />
      <GiveawaysClient />
      <Footer />
    </div>
  );
}
