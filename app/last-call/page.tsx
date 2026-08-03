import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import RiteMock from "./RiteMock";
import TheOrder from "./TheOrder";
import TheConsumed from "./TheConsumed";
import Countdown from "./Countdown";
import { getReapers, getRising, getConsumed } from "@/lib/chain";
import flags from "@/public/flags.json";
import styles from "./lastcall.module.css";

// THE LAST CALL — a 48h reopening of the rite, asked for by holders after the Order
// closed at twelve (Adrian, 03-ago-2026). This page is a FROZEN COPY of /reapers as
// it was BEFORE the closure (commit 7a9f925), on its own CSS module, so the public
// /reapers page keeps its new "the Order is closed / THE TWELVE" shape untouched.
//
// UNLINKED on purpose, /raffles-style: noindex+nofollow, no entry in the Nav menu —
// it travels by the Discord announcement, not by discovery.
//
// The door is NOT this page: `ReaperFacetV5.offer` accepts sub-30 souls only while
// block.timestamp < REOPEN_UNTIL (2026-08-05 19:00 UTC, a bytecode constant with no
// setter). When the clock runs out the panel below simply starts reverting — nothing
// here needs to be deployed, flipped or remembered.
// 1-min ISR here (not the museum's 5): during a 48h window the roster moves.
export const revalidate = 60;

const REAPER_LIVE = (flags as { reaperLive?: boolean }).reaperLive === true;

export const metadata: Metadata = {
  title: "The Last Call — Soul Reapers",
  description:
    "The community asked. The rite is open for 48 hours: burn 30 Pikkazos and your OG Soul becomes a Soul Reaper. Then the Order is final.",
  robots: { index: false, follow: false, nocache: true },
  alternates: { canonical: "/last-call" },
  openGraph: {
    type: "website",
    title: "The Last Call — Soul Reapers",
    description: "48 hours. Burn 30 Pikkazos, become a Soul Reaper. Then the Order is final.",
    url: "https://cubistsouls.com/last-call",
    images: ["https://cubistsouls.com/api/img?id=136"],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Last Call — Soul Reapers",
    description: "48 hours. Burn 30 Pikkazos, become a Soul Reaper. Then the Order is final.",
    images: ["https://cubistsouls.com/api/img?id=136"],
  },
};

// Tight vertical rhythm (Adrian 26-jul — "demasiados espacios muertos"): sections
// hug their content and the reaper dividers are discreet. Applied inline so the
// shared global `.section`/`.rp-rule` rules (used by other pages) are untouched.
const SEC_PB = "clamp(1.2rem, 3.5vw, 1.8rem)";
const HEAD_MB = { marginBottom: "clamp(0.7rem, 2.5vw, 1.1rem)" };
const RULE_M = { margin: "clamp(0.7rem, 2vw, 1.1rem) auto" };

export default async function LastCallPage() {
  // Only touch the chain when the facet is live; otherwise The Order is preview-only.
  // THE CONSUMED, in contrast, is a memorial of what has actually burned — always
  // real on-chain history (last-good cached, own empty state), regardless of the flag.
  // RISING (aspirants, 0<consumed<30) is real on-chain activity like THE CONSUMED
  // — always read, independent of the flag (today: #8777 at 18/30).
  const [reapers, rising, consumed] = await Promise.all([
    REAPER_LIVE ? getReapers() : Promise.resolve([]),
    getRising(),
    getConsumed(),
  ]);

  return (
    <div className="reaper">
      <div className="teaser-strip">
        <span className="ts-dot" />
        The last call · 48 hours · then the Order is final
      </div>
      <Nav active="reapers" />

      {/* ---------- HERO — the whole page in two lines ---------- */}
      <header className="rp-hero">
        <div className="wrap">
          <span className="rp-kicker"><span className="scythe">🜃</span>The last call</span>
          <h1 className="rp-title">THE DOORS <em>REOPEN</em></h1>
          <p className="rp-mech">
            The Order closed at twelve. <b>You asked us to reopen it</b> — so it is
            open, for <b>48 hours</b>.
          </p>
          <p className="rp-mech rp-mech-2">
            Burn <b>30</b> Pikkazos with an OG Soul and it becomes a <b>SOUL REAPER</b>.
            After that the Order is final. <b>No extensions</b> — the deadline is
            written into the contract and cannot be moved.
          </p>
          <Countdown />
          <span className={styles.ogChip}><span className={styles.ogChipMark}>🜃</span>OG Souls only</span>
        </div>
      </header>

      {/* (3-steps + milestone section removed 26-jul per Adrian — the hero already
          says it all; straight to the panel.) */}

      {/* ---------- THE RITE — the panel is the center of the page ---------- */}
      <section id="rite" className="section" style={{ paddingTop: 0, paddingBottom: SEC_PB, scrollMarginTop: "80px" }}>
        <div className="wrap">
          <div className="sec-head" style={HEAD_MB}>
            <span className="eyebrow">Do it here</span>
            <h2>FEED <span className="rp-hot">THE FIRE</span></h2>
          </div>
          <RiteMock live={REAPER_LIVE} />
        </div>
      </section>

      <div className="rp-rule" style={RULE_M}><div className="line" /></div>

      {/* ---------- THE ORDER — ascended reapers + rising aspirants ---------- */}
      <section className="section" style={{ paddingTop: 0, paddingBottom: SEC_PB }}>
        <div className="wrap">
          <div className="sec-head" style={HEAD_MB}>
            <span className="eyebrow">Souls that hit 30</span>
            <h2>THE <span className="rp-hot">ORDER</span></h2>
          </div>
          <TheOrder live={REAPER_LIVE} reapers={reapers} rising={rising} />
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
            <summary className={styles.fineSummary}>How it works — the fine print</summary>
            <ul className={styles.fineList}>
              <li><b>Only souls freed before the eras (OG cohort) can become Soul Reapers.</b></li>
              <li>The fire burns <b>Pikkazos</b> (canvases), never freed Souls. Their souls are consumed by your reaper.</li>
              <li>Every Pikkazo burned = <b>+1</b>. Burn an <b>exact batch</b> and it also forges that mark: <b>Orange 6 · Flame Crown 12 · Phoenix 18 · Burning Soul 30</b>. Any other number is a pure feed.</li>
              <li>Every burn adds to <b>Souls Consumed</b>. At <b>30</b>, the museum renames your Soul to <b>Soul Reaper</b>.</li>
              <li>Your reaper <b>inherits</b> the hours of every soul it consumes — <b>+1 Museum Hour per hour</b> each, kept forever (up to 60).</li>
              <li><b>Every soul consumed = 1 raffle ticket. Forever.</b></li>
              <li><b>Reapers get first access to the trait shop.</b></li>
              <li><b>The museum never forgets what you were born as</b> — it only lets you become more.</li>
              <li>Burning is <b>irreversible</b>. Offerings and rewards may shift before launch.</li>
            </ul>
          </details>
        </div>
      </section>

      <Footer />
    </div>
  );
}
