import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import RiteMock from "./RiteMock";

// HIDDEN concept page. noindex + not linked from anywhere. CONCEPT ONLY —
// no on-chain mechanic exists; the sacrifice facet would be a future cut with
// Adrian's express OK. Every number here is illustrative until ratified.
export const metadata: Metadata = {
  title: "Soul Reapers — the second fire",
  description: "A secret order of the museum. Concept only.",
  robots: { index: false, follow: false },
};

// Real soul art via the on-chain renderer host (unchanged by the domain flip).
const IMG = (id: number) => `https://cubistsouls.vercel.app/api/img?id=${id}`;

export default function ReapersPage() {
  return (
    <div className="reaper">
      <div className="concept-flag">Concept · not live · nothing on-chain · numbers illustrative — final TBD</div>
      <Nav />

      {/* ---------- LORE (hero) ---------- */}
      <header className="rp-hero">
        <div className="wrap">
          <span className="rp-kicker"><span className="scythe">🜃</span>The second fire · a secret order of the museum</span>
          <h1 className="rp-title">SOUL <em>REAPERS</em></h1>
          <div className="rp-lore">
            <p>
              Not every freed soul is content to hang and be admired. A few take up the scythe. They are the
              <em> Soul Reapers</em> — a quiet order within the museum that gathers the ash of others, souls given
              willingly to the flame, and is remade by what it consumes.
            </p>
            <p>
              The first fire freed a soul from the canvas that trapped it. <span className="flame-word">The second fire</span> is
              different: it does not free, it transforms. Offer souls to the flame and their ash becomes your mark — or, if you
              cannot bear to part with a soul, bring more Pikkazos to the bonfire as an offering instead. Two ways to feed the
              same forge; either ember burns just as true.
            </p>
            <p>
              In return the museum grants what no builder could paint — Reaper traits from a set that never existed in the
              original hand, longer Museum Hours, and privileges kept for those who tend the flame. The order keeps no roster
              but its own. <em>And the museum never forgets what you were born as.</em>
            </p>
          </div>
        </div>
      </header>

      <div className="rp-rule"><div className="line" /></div>

      {/* ---------- THE RITE (interactive mock) ---------- */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">The rite · a walkthrough, not a transaction</span>
            <h2>ENTER <span className="rp-hot">THE ORDER</span></h2>
          </div>
          <RiteMock />
        </div>
      </section>

      <div className="rp-rule"><div className="line" /></div>

      {/* ---------- DOUBLE RARITY ---------- */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">Two rarities, two honors</span>
            <h2>WHAT YOU WERE <span className="rp-hot">& WHAT YOU ARE</span></h2>
          </div>

          <p className="rp-lore" style={{ margin: "0 auto 1.8rem", maxWidth: "62ch", textAlign: "center" }}>
            Every soul will carry <b style={{ color: "var(--bone)" }}>two marks</b>. <b style={{ color: "var(--bone-2)" }}>Provenance</b> is
            the rarity it was born with — frozen forever, an honor and a small permanent bonus. <b style={{ color: "var(--gild)" }}>Museum
            Rarity</b> is the living one: it is what Museum Hours and every perk actually read, and it climbs as new traits and
            Reaper status are earned.
          </p>

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
                <p className="rr-desc">
                  An <b>honorary</b> soul. Migrated a top-tier original, so its Provenance is locked at Masterpiece — and it keeps
                  a permanent bonus for it. Its Museum Rarity sits high from day one.
                </p>
                <span className="rr-tag">Honor kept · never devalued</span>
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
                <p className="rr-desc">
                  A middling original that <b>walked the rite</b>. Its Provenance stays Rare (that never changes) — but the Reaper
                  marks pushed its <b>Museum Rarity above</b> where it was born. This is the climb the second fire buys.
                </p>
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
                <p className="rr-desc">
                  A common soul, honestly freed. Provenance and Museum Rarity start close together — but the forge is open to it
                  just the same. Every soul can take up the scythe.
                </p>
                <span className="rr-tag">The path is open to all</span>
              </div>
            </div>
          </div>

          <p className="rarity-note">
            Whoever migrated a rare original keeps their honor and a permanent bonus for it. <b>The museum never forgets what you
            were born as</b> — it only lets you become more.
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
