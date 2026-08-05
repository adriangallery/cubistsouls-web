import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import RiteMock from "./RiteMock";
import TheOrder from "./TheOrder";
import TheConsumed from "./TheConsumed";
import TheDraw from "./TheDraw";
import { getReapers, getRising, getConsumed, getReaperWindow, getReaperKept } from "@/lib/chain";
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

// El título y el OG también salían con "12" a mano. Van por el mismo roster que la
// página (getReapers está memoizada: no añade una lectura extra) y, si la lectura
// falla, se cae a una redacción SIN número en vez de anunciar una cifra falsa.
export async function generateMetadata(): Promise<Metadata> {
  const n = REAPER_LIVE ? (await getReapers()).length : 0;
  const title = n > 0 ? `The Order — ${n} Soul Reapers` : "The Order — Soul Reapers";
  const long = n > 0
    ? `${n} Cubist Souls burned 30 Pikkazos each and became Soul Reapers. The Order is closed — sealed on chain.`
    : "Cubist Souls burned 30 Pikkazos each and became Soul Reapers. The Order is closed — sealed on chain.";
  const short = n > 0
    ? `${n} Souls. Thirty canvases each. The Order is closed.`
    : "Thirty canvases each. The Order is closed.";
  return {
    title,
    description: long,
    alternates: { canonical: "/reapers" },
    openGraph: {
      type: "website",
      title,
      description: short,
      url: "https://cubistsouls.com/reapers",
      images: ["https://cubistsouls.com/api/img?id=136"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: short,
      images: ["https://cubistsouls.com/api/img?id=136"],
    },
  };
}

// Tight vertical rhythm (Adrian 26-jul — "demasiados espacios muertos"): sections
// hug their content and the reaper dividers are discreet.
const SEC_PB = "clamp(1.2rem, 3.5vw, 1.8rem)";
const HEAD_MB = { marginBottom: "clamp(0.7rem, 2.5vw, 1.1rem)" };
const RULE_M = { margin: "clamp(0.7rem, 2vw, 1.1rem) auto" };

export default async function ReapersPage() {
  const [reapers, rising, consumed, reaperWindow] = await Promise.all([
    REAPER_LIVE ? getReapers() : Promise.resolve([]),
    getRising(),
    getConsumed(),
    getReaperWindow(),
  ]);
  // La marea, leída aquí: el HTML ya sale pidiendo el arte correcto (antes salía
  // con kept=0 y el cliente repetía las 16 imágenes con el número real).
  const kept0 = await getReaperKept(reapers.map((r) => r.id));

  // ⚠️ El tamaño de la Orden ya NO se escribe a mano (04-ago): la Last Call de 48h
  // reabrió las puertas y entraron dos más (#2852, #5728) mientras el hero seguía
  // diciendo TWELVE con catorce en el roster de abajo. Ahora sale del propio roster,
  // así que el día que la ventana cierre la página ya dice el número final sola.
  // Roster vacío = fallo de lectura (TheOrder ya lo dice), NUNCA "cero": en ese caso
  // la página habla de "The Order" sin número en vez de mentir con una cifra.
  const windowCloses = reaperWindow.until
    ? new Date(reaperWindow.until * 1000).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        timeZone: "UTC", hour12: false,
      }) + " UTC"
    : null;
  const orderSize = reapers.length;
  const orderWord = orderSize > 0 ? numberWord(orderSize) : null;

  return (
    <div className="reaper">
      <div className="teaser-strip">
        <span className="ts-dot" />
        {reaperWindow.open
          ? `The doors are open${windowCloses ? ` · until ${windowCloses}` : ""}`
          : `The Order is closed · ${orderWord ? `${orderWord}, final` : "final"}`}
      </div>
      <Nav active="reapers" />

      {/* ---------- HERO — just the name of the thing (Adrian 03-ago: the strip
           above already says it is closed; the roster IS the message) ---------- */}
      <header className="rp-hero">
        <div className="wrap">
          <span className="rp-kicker"><span className="scythe">🜃</span>The Order</span>
          <h1 className="rp-title">THE <em>{orderWord ? orderWord.toUpperCase() : "ORDER"}</em></h1>
        </div>
      </header>

      {/* ---------- THE TWELVE — straight to the roster, no second heading ------ */}
      <section className="section" style={{ paddingTop: 0, paddingBottom: SEC_PB }}>
        <div className="wrap">
          <TheOrder live={REAPER_LIVE} reapers={reapers} rising={rising} kept0={kept0} />
          {/* Los nombres salen en cada tarjeta desde hoy; una linea basta para
              explicar que son reales y que nadie tuvo que registrarlos. */}
          <p className="rp-ens">
            Every member carries a name: <b>{"<id>"}.cubistsouls.eth</b> is that reaper&apos;s vault, and{" "}
            <b>cubistsouls.eth</b> is the museum itself. Nothing was registered for them — the resolver works
            each one out from the chain, so a soul that ascends tomorrow already has its name today.
          </p>
        </div>
      </section>

      <div className="rp-rule" style={RULE_M}><div className="line" /></div>

      {/* ---------- THE DRAW — half of every burn, paid to one member ---------- */}
      <section id="draw" className="section" style={{ paddingTop: 0, paddingBottom: SEC_PB, scrollMarginTop: "80px" }}>
        <div className="wrap">
          <div className="sec-head" style={HEAD_MB}>
            <span className="eyebrow">What the Order earns</span>
            <h2>THE <span className="rp-hot">DRAW</span></h2>
          </div>
          <TheDraw />
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
              <li>
                {reaperWindow.open ? (
                  <>
                    <b>The doors are open again{windowCloses ? ` until ${windowCloses}` : ""}.</b> Holders asked for it, so
                    the contract itself reopened: until that hour any OG soul can burn and ascend. After it, an offering is
                    only accepted from a Soul already at 30 consumed — no deploy, no switch, no one awake.
                  </>
                ) : (
                  <>
                    <b>The Order is closed{orderWord ? ` at ${orderWord}` : ""}.</b> The rule lives in the contract: an
                    offering is only accepted from a Soul already at 30 consumed.
                  </>
                )}
              </li>
              <li><b>They keep reaping.</b> Burning more canvases still adds to their count — and to everything the count pays for.</li>
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

// 12 → "twelve". Fuera del rango, el dígito: la Orden nunca va a ser tan grande,
// pero la página no se rompe si lo fuera.
const WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty",
];
function numberWord(n: number): string {
  return WORDS[n] ?? String(n);
}
