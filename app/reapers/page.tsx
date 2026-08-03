import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import RiteMock from "./RiteMock";
import TheOrder from "./TheOrder";
import TheConsumed from "./TheConsumed";
import { getReapers, getRising, getConsumed } from "@/lib/chain";
import flags from "@/public/flags.json";
import styles from "./reapers.module.css";

// Soul Reapers — THE ORDER IS CLOSED (Adrian, 03-ago-2026). With the twelfth reaper
// (#1650) ascended, ReaperFacetV4 sealed the register on chain: `offer` reverts
// OrderClosed for any soul under 30 consumed, so there are no new reapers and no new
// initiates — while the twelve keep reaping forever.
//
// The page follows the contract, not the other way round:
//   1. the hero states the closure,
//   2. THE TWELVE is the protagonist (it used to sit below the rite),
//   3. the rite survives BELOW, members-only (RiteMock gates on >=30 consumed),
//   4. THE CONSUMED memorial and the fine print close the page.
// Still gated by flags.reaperLive for the roster read; 5-min ISR (Adrian 28-jul:
// it's a museum). The rest of the reads are real chain history regardless.
export const revalidate = 300;

const REAPER_LIVE = (flags as { reaperLive?: boolean }).reaperLive === true;

export const metadata: Metadata = {
  title: "The Order — 12 Soul Reapers",
  description:
    "Twelve Cubist Souls burned 30 Pikkazos each and became Soul Reapers. The Order is closed — sealed on chain.",
  alternates: { canonical: "/reapers" },
  openGraph: {
    type: "website",
    title: "The Order — 12 Soul Reapers",
    description: "Twelve Souls. Thirty canvases each. The Order is closed.",
    url: "https://cubistsouls.com/reapers",
    images: ["https://cubistsouls.com/api/img?id=136"],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Order — 12 Soul Reapers",
    description: "Twelve Souls. Thirty canvases each. The Order is closed.",
    images: ["https://cubistsouls.com/api/img?id=136"],
  },
};

// Tight vertical rhythm (Adrian 26-jul — "demasiados espacios muertos"): sections
// hug their content and the reaper dividers are discreet.
const SEC_PB = "clamp(1.2rem, 3.5vw, 1.8rem)";
const HEAD_MB = { marginBottom: "clamp(0.7rem, 2.5vw, 1.1rem)" };
const RULE_M = { margin: "clamp(0.7rem, 2vw, 1.1rem) auto" };

export default async function ReapersPage() {
  const [reapers, rising, consumed] = await Promise.all([
    REAPER_LIVE ? getReapers() : Promise.resolve([]),
    getRising(),
    getConsumed(),
  ]);

  return (
    <div className="reaper">
      <div className="teaser-strip">
        <span className="ts-dot" />
        The Order is closed · twelve, final
      </div>
      <Nav active="reapers" />

      {/* ---------- HERO — the closure, in two lines ---------- */}
      <header className="rp-hero">
        <div className="wrap">
          <span className="rp-kicker"><span className="scythe">🜃</span>The Order</span>
          <h1 className="rp-title">THE ORDER IS <em>CLOSED</em></h1>
          <p className="rp-mech">
            Twelve Souls burned <b>30</b> Pikkazos each. The register is sealed.
          </p>
          <p className="rp-mech rp-mech-2">
            No new reapers. No new initiates. <b>The twelve keep reaping.</b>
          </p>
        </div>
      </header>

      {/* ---------- THE TWELVE — the protagonist of the page ---------- */}
      <section className="section" style={{ paddingTop: 0, paddingBottom: SEC_PB }}>
        <div className="wrap">
          <div className="sec-head" style={HEAD_MB}>
            <span className="eyebrow">The final roster</span>
            <h2>THE <span className="rp-hot">TWELVE</span></h2>
          </div>
          <TheOrder live={REAPER_LIVE} reapers={reapers} rising={rising} />
        </div>
      </section>

      <div className="rp-rule" style={RULE_M}><div className="line" /></div>

      {/* ---------- THE FIRE — still burning, members only ---------- */}
      <section id="rite" className="section" style={{ paddingTop: 0, paddingBottom: SEC_PB, scrollMarginTop: "80px" }}>
        <div className="wrap">
          <div className="sec-head" style={HEAD_MB}>
            <span className="eyebrow">Members only</span>
            <h2>FEED <span className="rp-hot">THE FIRE</span></h2>
          </div>
          <p className={styles.closedLead}>
            A Soul Reaper can keep burning canvases forever — its count climbs past 30.
            Any soul below 30 is refused by the contract itself.
          </p>
          <RiteMock live={REAPER_LIVE} />
        </div>
      </section>

      <div className="rp-rule" style={RULE_M}><div className="line" /></div>

      {/* ---------- THE CONSUMED — memorial of the canvases the fire ate ---------- */}
      <section className="section" style={{ paddingTop: 0, paddingBottom: SEC_PB }}>
        <div className="wrap">
          <div className="sec-head" style={HEAD_MB}>
            <span className="eyebrow">Ash of the offering</span>
            <h2>THE <span className="rp-hot">CONSUMED</span></h2>
          </div>
          <TheConsumed data={consumed} />
        </div>
      </section>

      {/* ---------- FINE PRINT — details for who wants them ---------- */}
      <section className="section" style={{ paddingTop: SEC_PB, paddingBottom: SEC_PB }}>
        <div className="wrap">
          <details className={styles.fine}>
            <summary className={styles.fineSummary}>The closure — the fine print</summary>
            <ul className={styles.fineList}>
              <li><b>The Order is twelve, and it is closed.</b> The rule lives in the contract: an offering is only accepted from a Soul already at 30 consumed.</li>
              <li><b>The twelve keep reaping.</b> Burning more canvases still adds to their count — and to everything the count pays for.</li>
              <li><b>Two souls were mid-climb when the doors shut</b> (#1682 and #2474). They stay exactly where they stopped. The museum keeps that record.</li>
              <li>Every soul consumed by a reaper is <b>1 raffle ticket. Forever.</b></li>
              <li>Each reaper <b>inherits</b> the hours of every soul it consumed — +1 Museum Hour per hour, kept forever (up to 60).</li>
              <li><b>Reapers get first access to the trait shop.</b></li>
              <li>Every reaper carries an <b>on-chain account of its own</b>, bound to the token: it travels with the reaper when it changes hands.</li>
              <li>Burning is <b>irreversible</b>, and a consumed canvas can never become a Soul.</li>
            </ul>
          </details>
        </div>
      </section>

      <Footer />
    </div>
  );
}
