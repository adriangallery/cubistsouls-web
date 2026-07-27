import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import GalleryGrid from "./GalleryGrid";
import { getFreed, getSupply, getConsumed } from "@/lib/chain";

export const revalidate = 60;

// Real soul art via the site's own image route (same-origin, relative).
const IMG = (id: number) => `/api/img?id=${id}`;

export const metadata: Metadata = {
  title: "The Freed — Cubist Souls",
  description: "Every soul pulled from the ash — the community's ledger of liberations.",
  openGraph: {
    title: "The Freed — Cubist Souls",
    images: ["https://cubistsouls.com/api/img?id=136"],
  },
};

export default async function Gallery() {
  // The Freed roster + the full burn accounting (same three-way tally as the home:
  // the prominent number is the GLOBAL Pikkazo burn = freed + consumed, the grid
  // stays freed-only — consumed canvases have no soul to hang, they live in The
  // Consumed on /reapers).
  const [freed, supply, consumed] = await Promise.all([getFreed(), getSupply(), getConsumed()]);
  const ids = freed.map((e) => e.id);
  const freedN = supply ?? freed.length;
  const eaten = consumed.total;

  return (
    <>
      <Nav active="freed" />

      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">Freed by fire · the ledger</span>
            <h2>PULLED FROM <em className="hot">THE ASH</em></h2>
          </div>

          {/* Global burn counter — every Pikkazo the fire has taken. */}
          <div className="tally" style={{ padding: "0 0 clamp(1.4rem,4vw,2rem)" }}>
            <div className="num hot">{(freedN + eaten).toLocaleString("en-US")}</div>
            <div className="cap">
              <b>{freedN.toLocaleString("en-US")}</b> souls freed
              {eaten > 0 ? (
                <>
                  {" · "}
                  <b>{eaten.toLocaleString("en-US")}</b> consumed by reapers{" "}
                  <a href="/reapers" style={{ color: "var(--reaper-lite, #a765d1)", textDecoration: "none" }}>
                    the consumed →
                  </a>
                </>
              ) : null}
            </div>
          </div>

          {ids.length === 0 ? (
            <div className="gempty">
              Couldn&apos;t reach Ethereum right now. Try again — or see the{" "}
              <a href="https://opensea.io/collection/cubist-souls" target="_blank" rel="noopener noreferrer">
                collection on OpenSea
              </a>
              .
            </div>
          ) : (
            <GalleryGrid freed={ids} />
          )}
        </div>
      </section>

      {/* ---------- BORN & BECOMING — double rarity (moved here from /reapers 26-jul:
          rarity belongs to the collection context). Wrapped in `.reaper` so the
          violet accent tokens (--reaper-lite…) resolve for the pills/cards. ---------- */}
      <div className="reaper">
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
      </div>

      <Footer />
    </>
  );
}
