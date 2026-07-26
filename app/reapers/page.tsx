import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import RiteMock from "./RiteMock";
import TheOrder from "./TheOrder";
import { getReapers } from "@/lib/chain";
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
    images: ["https://cubistsouls.vercel.app/api/img?id=136"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Soul Reapers",
    description: "Burn Pikkazos to power up your Soul. Hit 30 and become a Soul Reaper.",
    images: ["https://cubistsouls.vercel.app/api/img?id=136"],
  },
};

// Real soul art via the on-chain renderer host (unchanged by the domain flip).
const IMG = (id: number) => `https://cubistsouls.vercel.app/api/img?id=${id}`;

export default async function ReapersPage() {
  // Only touch the chain when the facet is live; otherwise The Order is preview-only.
  const reapers = REAPER_LIVE ? await getReapers() : [];

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
      <section id="rite" className="section" style={{ paddingTop: 0, scrollMarginTop: "80px" }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">Do it here</span>
            <h2>FEED <span className="rp-hot">THE FIRE</span></h2>
          </div>
          <RiteMock live={REAPER_LIVE} />
        </div>
      </section>

      <div className="rp-rule"><div className="line" /></div>

      {/* ---------- THE ORDER — souls that hit 30 ---------- */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">Souls that hit 30</span>
            <h2>THE <span className="rp-hot">ORDER</span></h2>
          </div>
          <TheOrder live={REAPER_LIVE} reapers={reapers} />
        </div>
      </section>

      <div className="rp-rule"><div className="line" /></div>

      {/* ---------- DOUBLE RARITY — 3 cards + 2 one-line pills ---------- */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">Two rarities</span>
            <h2>BORN <span className="rp-hot">&amp; BECOMING</span></h2>
          </div>

          {/* one line per pill */}
          <div className="rr-legend">
            <div className="rr-leg">
              <span className="pill pill-prov">Born 🏺</span>
              what you were born as — frozen forever.
            </div>
            <div className="rr-leg">
              <span className="pill pill-museum">Museum ✦</span>
              the living rank — perks read this one.
            </div>
          </div>

          <div className="rarity-cards">
            {/* honorary — born Masterpiece, stays high */}
            <div className="rr-card">
              <div className="rr-art">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={IMG(90)} alt="Cubist Soul №0090" loading="lazy" />
              </div>
              <div className="rr-body">
                <span className="rr-id">№0090</span>
                <div className="rr-pills">
                  <span className="pill pill-prov">Born 🏺 Masterpiece</span>
                  <span className="pill pill-museum">Museum ✦ Rank 6</span>
                </div>
                <span className="rr-tag">Never devalued</span>
              </div>
            </div>

            {/* mid — ascends after the rite */}
            <div className="rr-card ascend">
              <div className="rr-art">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={IMG(512)} alt="Cubist Soul №0512" loading="lazy" />
              </div>
              <div className="rr-body">
                <span className="rr-id">№0512</span>
                <div className="rr-pills">
                  <span className="pill pill-prov">Born 🏺 Rare</span>
                  <span className="pill pill-museum up">Museum ▲ Ascendant</span>
                </div>
                <span className="rr-tag up">Ascended by the fire ▲</span>
              </div>
            </div>

            {/* common */}
            <div className="rr-card">
              <div className="rr-art">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={IMG(314)} alt="Cubist Soul №0314" loading="lazy" />
              </div>
              <div className="rr-body">
                <span className="rr-id">№0314</span>
                <div className="rr-pills">
                  <span className="pill pill-prov">Born 🏺 Common</span>
                  <span className="pill pill-museum">Museum ✦ Rank 4,120</span>
                </div>
                <span className="rr-tag">Open to all</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- FINE PRINT — details for who wants them ---------- */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <details className={styles.fine}>
            <summary className={styles.fineSummary}>How it works — the fine print</summary>
            <ul className={styles.fineList}>
              <li><b>Only souls freed before the eras (OG cohort) can become Soul Reapers.</b></li>
              <li>The fire burns <b>Pikkazos</b> (canvases), never freed Souls. Their souls are consumed by your reaper.</li>
              <li>Every Pikkazo burned = <b>+1</b>. Burn an <b>exact batch</b> and it also forges that mark: <b>Orange 6 · Flame Crown 12 · Phoenix 18 · Burning Soul 30</b>. Any other number is a pure feed.</li>
              <li>Every burn adds to <b>Souls Consumed</b>. At <b>30</b>, the museum renames your Soul to <b>Soul Reaper</b>.</li>
              <li>Marks add Museum Hours perks — a higher multiplier and more MH per hour.</li>
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
