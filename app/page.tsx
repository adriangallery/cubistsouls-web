import Nav from "./components/Nav";
import Footer from "./components/Footer";
import Ticker from "./components/Ticker";
import SoulCard from "./components/SoulCard";
import HomeCta from "./components/HomeCta";
import { getSupply, getPricing, getFreed, getBlockTimes, ago, fmtEth, fmtDate, type Pricing } from "@/lib/chain";

// Live on-chain counter + roster, regenerated at most once per minute (ISR).
export const revalidate = 60;

const TOTAL = 10000;

function pricingPill(p: Pricing | null) {
  if (!p) return null;
  if (p.free) {
    const until = p.freeUntil ? ` until ${fmtDate(p.freeUntil)}` : "";
    const then = p.firstPriceWei && p.firstPriceWei !== "0" ? ` · then Ξ${fmtEth(p.firstPriceWei)}` : "";
    return (
      <p className="pricing">
        <span className="free">🎟 Free mint week</span> — free{until}. Just gas.{then}
      </p>
    );
  }
  const rises = p.nextAt && p.nextPriceWei ? ` · rises to Ξ${fmtEth(p.nextPriceWei)} on ${fmtDate(p.nextAt)}` : "";
  return (
    <p className="pricing">
      <b>Ξ{fmtEth(p.priceWei)}</b> per soul{rises}
    </p>
  );
}

function pricingTickerLine(p: Pricing | null): string | undefined {
  if (!p) return undefined;
  if (p.free) {
    const until = p.freeUntil ? ` until ${fmtDate(p.freeUntil)}` : "";
    const then = p.firstPriceWei && p.firstPriceWei !== "0" ? ` · then Ξ${fmtEth(p.firstPriceWei)}` : "";
    return `Free mint week — free${until}${then}`;
  }
  return `Ξ${fmtEth(p.priceWei)} per soul`;
}

export default async function Home() {
  const [freedCount, pricing, freed] = await Promise.all([getSupply(), getPricing(), getFreed()]);

  const freedN = freedCount ?? freed.length;
  const dark = Math.max(0, TOTAL - freedN);
  const pct = Math.min(100, (freedN / TOTAL) * 100);

  // Recent grid ("pulled from the ash") — newest 8, with real "ago" from block times.
  const recent = freed.slice(0, 8);
  const times = await getBlockTimes(Array.from(new Set(recent.map((e) => e.block))));
  const now = Math.floor(Date.now() / 1000);

  return (
    <>
      <Ticker pricingLine={pricingTickerLine(pricing)} />
      <Nav active="burn" />

      <header className="hero">
        <div className="hero-bg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/banner.jpg" alt="A cubist studio in flames" fetchPriority="high" />
        </div>
        <div className="hero-scrim" />
        <div className="hero-in wrap">
          <span className="eyebrow"><span className="dot" />The community is freeing them · live</span>
          <h1 className="title">CUBIST SOULS</h1>
          <p className="lead">You don&apos;t buy a soul. You free one — by burning the canvas that trapped it.</p>
        </div>
      </header>

      <section className="tally">
        <div className="wrap">
          <div className="num hot">{freedN.toLocaleString("en-US")}</div>
          <div className="cap">
            <b>{freedN.toLocaleString("en-US")}</b> freed by fire · <b>{dark.toLocaleString("en-US")}</b> still in the dark
          </div>
          <div className="emberbar"><span style={{ width: `${pct}%` }} /></div>
          {pricingPill(pricing)}
          <div className="cta">
            <HomeCta />
          </div>
          <p className="cta-note">Ethereum mainnet · connect to free your Pikkazo</p>
        </div>
      </section>

      <div className="rule"><div className="line" /></div>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="decree">
            <span className="seal">✕</span>
            <span className="k">The rite is irreversible</span>
            <p>
              <strong>This is real.</strong> The fire destroys the Pikkazo forever on Ethereum mainnet — and returns its Cubist Soul,
              same number, original art recovered. <strong>No undo, no refund, no takebacks.</strong> Free one piece at a time, or your
              whole collection in a single signature.
            </p>
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Freed by fire · the ledger</span>
              <h2>PULLED FROM <em className="hot">THE ASH</em></h2>
            </div>
            <div className="grid">
              {recent.map((e, i) => {
                const t = times[e.block];
                return <SoulCard key={e.id} id={e.id} status={t ? ago(now - t) : "Freed"} eager={i < 4} />;
              })}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </>
  );
}
