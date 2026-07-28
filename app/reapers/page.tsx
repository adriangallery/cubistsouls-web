import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import RiteMock from "./RiteMock";
import TheOrder from "./TheOrder";
import TheConsumed from "./TheConsumed";
import { getReapers, getRising, getConsumed } from "@/lib/chain";
import flags from "@/public/flags.json";
import styles from "./reapers.module.css";

// Soul Reapers — public product panel. GATED by flags.reaperLive: false = preview
// (demo data, disabled CTA, empty Order), true = real reads/writes against the
// diamond's ReaperFacet cut. The flag is read at build time (flipping it is a
// deploy anyway — see the launch runbook in the worker report). The rite itself is
// a client component; The Order is derived from chain server-side (ISR).
export const revalidate = 60;

const REAPER_LIVE = (flags as { reaperLive?: boolean }).reaperLive === true;

export const metadata: Metadata = {
  title: "Soul Reapers",
  description:
    "Burn Pikkazos to power up your Cubist Soul. Hit 30 and it becomes a Soul Reaper.",
  alternates: { canonical: "/reapers" },
  openGraph: {
    type: "website",
    title: "Soul Reapers",
    description: "Burn Pikkazos to power up your Soul. Hit 30 and become a Soul Reaper.",
    url: "https://cubistsouls.com/reapers",
    images: ["https://cubistsouls.com/api/img?id=136"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Soul Reapers",
    description: "Burn Pikkazos to power up your Soul. Hit 30 and become a Soul Reaper.",
    images: ["https://cubistsouls.com/api/img?id=136"],
  },
};

// Tight vertical rhythm (Adrian 26-jul — "demasiados espacios muertos"): sections
// hug their content and the reaper dividers are discreet. Applied inline so the
// shared global `.section`/`.rp-rule` rules (used by other pages) are untouched.
const SEC_PB = "clamp(1.2rem, 3.5vw, 1.8rem)";
const HEAD_MB = { marginBottom: "clamp(0.7rem, 2.5vw, 1.1rem)" };
const RULE_M = { margin: "clamp(0.7rem, 2vw, 1.1rem) auto" };

export default async function ReapersPage() {
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
        {REAPER_LIVE ? "The fire is live · power up your Soul" : "Coming soon · try it now"}
      </div>
      <Nav active="reapers" />

      {/* ---------- HERO — the whole page in two lines ---------- */}
      <header className="rp-hero">
        <div className="wrap">
          <span className="rp-kicker"><span className="scythe">🜃</span>The fire</span>
          <h1 className="rp-title">SOUL <em>REAPERS</em></h1>
          <p className="rp-mech">
            Burn <b>Pikkazos</b> to power up your Soul.
          </p>
          <p className="rp-mech rp-mech-2">
            Hit <b>30</b> and become a <b>SOUL REAPER</b>.
          </p>
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
