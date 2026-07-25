import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import RiteMock from "./RiteMock";

// PUBLIC product teaser (Adrian, 25-jul): the page is now live, indexable and
// linked from Nav/Footer. The rite has no on-chain mechanic yet — the CTA stays
// disabled and offerings/rewards may shift before launch. Canonical is /reapers;
// the old secret slug /reapers-k7x2m9 redirects here (next.config).
export const metadata: Metadata = {
  title: "Soul Reapers — the second fire",
  description:
    "The second fire is coming. Burn Pikkazos for Reaper marks — special traits and Museum Hours perks. Try before the fire.",
  alternates: { canonical: "/reapers" },
  openGraph: {
    type: "website",
    title: "Soul Reapers — the second fire",
    description: "The second fire is coming. Burn Pikkazos for Reaper marks. Try before the fire.",
    url: "https://cubistsouls.com/reapers",
    images: ["https://cubistsouls.vercel.app/api/img?id=136"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Soul Reapers — the second fire",
    description: "The second fire is coming. Burn Pikkazos for Reaper marks. Try before the fire.",
    images: ["https://cubistsouls.vercel.app/api/img?id=136"],
  },
};

// Real soul art via the on-chain renderer host (unchanged by the domain flip).
const IMG = (id: number) => `https://cubistsouls.vercel.app/api/img?id=${id}`;

export default function ReapersPage() {
  return (
    <div className="reaper">
      <div className="teaser-strip">
        <span className="ts-dot" />The second fire is coming · the rite is being prepared
        <span className="ts-legal">offerings and rewards may shift before the fire is lit</span>
      </div>
      <Nav active="reapers" />

      {/* ---------- LORE (hero) — 2-3 lines, no paragraphs ---------- */}
      <header className="rp-hero">
        <div className="wrap">
          <span className="rp-kicker"><span className="scythe">🜃</span>The second fire · a secret order</span>
          <h1 className="rp-title">SOUL <em>REAPERS</em></h1>
          <p className="rp-tagline">Some freed souls take up the scythe.</p>
          <p className="rp-mech">
            Feed the second fire: burn <b>Pikkazos</b> for the marks.
          </p>
          <p className="rp-mech rp-mech-2">
            The fire takes <b>no freed soul</b> — it feeds on canvases. Their souls are <b>consumed</b> by your reaper.
          </p>
        </div>
      </header>

      <div className="rp-rule"><div className="line" /></div>

      {/* ---------- THE RITE (interactive mock) ---------- */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">The rite · try before the fire</span>
            <h2>ENTER <span className="rp-hot">THE ORDER</span></h2>
          </div>
          <RiteMock />
        </div>
      </section>

      <div className="rp-rule"><div className="line" /></div>

      {/* ---------- DOUBLE RARITY — legend + 3 cards ---------- */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">Two rarities, two honors</span>
            <h2>WHAT YOU WERE <span className="rp-hot">& WHAT YOU ARE</span></h2>
          </div>

          {/* one line per pill */}
          <div className="rr-legend">
            <div className="rr-leg">
              <span className="pill pill-prov">Born 🏺 Provenance</span>
              what you were born as — frozen forever.
            </div>
            <div className="rr-leg">
              <span className="pill pill-museum">Museum ✦ Rarity</span>
              the living one — perks read this.
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
                <span className="rr-tag">Honorary · never devalued</span>
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
                <span className="rr-tag up">Ascended by the rite ▲</span>
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
                <span className="rr-tag">The path is open to all</span>
              </div>
            </div>
          </div>

          <p className="rarity-note">
            <b>The museum never forgets what you were born as</b> — it only lets you become more.
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
