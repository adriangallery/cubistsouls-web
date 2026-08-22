import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import GroundDesk from "./GroundDesk";

// THE GROUND — what sixty souls earn.
//
// HIDDEN while the mechanic is being proven with real money at a scale where
// being wrong costs cents: noindex/nofollow, and NOT linked from Nav or Footer.
// Reachable only by typing /ground, the same discipline /vessels and /raffles
// were held to before they were announced.
export const metadata: Metadata = {
  title: "The Ground — Cubist Souls",
  description: "What a reaper on solid ground earns.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default function GroundPage() {
  return (
    <>
      <Nav />
      <main className="ground-page">
        <header className="ground-hero">
          <span className="ground-kick">
            <span className="ground-kick-mark">🜃</span> What solid ground earns
          </span>
          <h1 className="ground-title">The Ground</h1>
          <p className="ground-lead">
            Past thirty souls a reaper stops buying draw tickets and starts raising land. At sixty it stands
            on solid ground — and this is what the ground pays: revenue collected on Robinhood Chain, split
            equally between the earthed, by a button anyone can press.
          </p>
        </header>
        <GroundDesk />
      </main>
      <Footer />
    </>
  );
}
