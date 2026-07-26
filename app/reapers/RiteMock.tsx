"use client";

import { useState } from "react";

// THE RITE — fully client-side, no chain. Try before the fire: pick your soul,
// TOGGLE any number of Reaper marks (combine them), and the preview REBUILDS the
// aspirant soul from the artist's official VECTOR trait set (same engine as the
// Soul Builder) — each mark cleanly SUBSTITUTES its layer in the stack. No blends.
//
// Canonical mechanic (Adrian, ratified 25-jul): offerings are PIKKAZOS BURNED.
// The fire takes no already-freed soul — it feeds on canvases: the souls trapped
// in the offered Pikkazos are CONSUMED by the reaper (they never get minted).
// Each mark costs Pikkazos (= souls consumed). Total = SUM of the marks worn.
// At 30 consumed the museum RENAMES the piece "Soul Reaper #N". Numbers TBD.

// ---- Vector layer engine (mirrors public/builder.html) ----------------------
// Layers are the artist's 768×768 vector SVGs, drawn bottom→top in the generator's
// REAL z-order: Art Background → Base → Clothes → Head → Mouth → Left Eye → Nose
// → Right Eye → (Burn FX on top). Per-token traits come from the same dataset the
// gallery reads (cubist-souls-assets/traits/index.json); the 4 aspirants below are
// pre-decoded to their SVG files (all clean maps to the official vector set).
const T = "/assets/traits-svg";

// Canonical soul art (PNG) via the on-chain renderer host — used for the light
// aspirant picker thumbnails. The vector engine below drives the live PREVIEW,
// where marks substitute layers.
const IMG = (id: number) => `https://cubistsouls.vercel.app/api/img?id=${id}`;

// Ordered slots = z-order (bottom→top). The FX slot sits above everything.
const SLOTS = ["ab", "base", "clothes", "head", "mouth", "leye", "nose", "reye"] as const;
type Slot = (typeof SLOTS)[number];

type Aspirant = { id: number; name: string; layers: Record<Slot, string> };

const ASPIRANTS: Aspirant[] = [
  {
    id: 136,
    name: "№0136",
    layers: {
      ab: `${T}/art-background/emerald-tiles.svg`,
      base: `${T}/base/sun-burn.svg`,
      clothes: `${T}/clothes/white-hoodie.svg`,
      head: `${T}/head/punk-never-die.svg`,
      mouth: `${T}/mouth/diva.svg`,
      leye: `${T}/left-eye/colony.svg`,
      nose: `${T}/nose/amethyst-block.svg`,
      reye: `${T}/right-eye/gaze.svg`,
    },
  },
  {
    id: 42,
    name: "№0042",
    layers: {
      ab: `${T}/art-background/snow-tiles.svg`,
      base: `${T}/base/childs-play.svg`,
      clothes: `${T}/clothes/polo-spike.svg`,
      head: `${T}/head/punk-never-die.svg`,
      mouth: `${T}/mouth/not-speak.svg`,
      leye: `${T}/left-eye/so-lame.svg`,
      nose: `${T}/nose/pinocchio.svg`,
      reye: `${T}/right-eye/cynical.svg`,
    },
  },
  {
    id: 777,
    name: "№0777",
    layers: {
      ab: `${T}/art-background/snow-tiles.svg`,
      base: `${T}/base/glow-stone.svg`,
      clothes: `${T}/clothes/greek-gods.svg`,
      head: `${T}/head/red-flat-cap.svg`,
      mouth: `${T}/mouth/sheriff-on-duty.svg`,
      leye: `${T}/left-eye/danger-sign.svg`,
      nose: `${T}/nose/pinocchio.svg`,
      reye: `${T}/right-eye/smakeman.svg`,
    },
  },
  {
    id: 314,
    name: "№0314",
    layers: {
      ab: `${T}/art-background/star-brown.svg`,
      base: `${T}/base/soft-cloud.svg`,
      clothes: `${T}/clothes/greek-gods.svg`,
      head: `${T}/head/beanie-thug.svg`,
      mouth: `${T}/mouth/sheriff-on-duty.svg`,
      leye: `${T}/left-eye/kinda-blue.svg`,
      nose: `${T}/nose/thunderstorm.svg`,
      reye: `${T}/right-eye/emergency-exit.svg`,
    },
  },
];

// The Reaper marks = the ★ Burn Cube set from the official manifest. Each mark
// SUBSTITUTES one layer (slot "fx" = an extra layer painted on top of all).
// cost = Pikkazos burned = souls consumed. Prices (Adrian 26-jul): the SKIN is the
// dearest — Burning Soul 30 > Phoenix 18 > Flame Crown 12 > Orange 6.
type Mark = {
  id: string;
  file: string;
  name: string;
  kind: string;
  slot: Slot | "fx";
  cost: number;
  mult: number;
  mh: number;
};
const REAPER_MARKS: Mark[] = [
  { id: "orange", file: `${T}/art-background/bc-orange.svg`, name: "★ Orange", kind: "Art Background", slot: "ab", cost: 6, mult: 1.2, mh: 2 },
  { id: "crown", file: `${T}/head/bc-flame-crown.svg`, name: "★ Flame Crown", kind: "Head", slot: "head", cost: 12, mult: 1.5, mh: 6 },
  { id: "phoenix", file: `${T}/burn-fx/phoenix.svg`, name: "★ Phoenix", kind: "Burn FX", slot: "fx", cost: 18, mult: 1.6, mh: 8 },
  { id: "burning", file: `${T}/base/bc-burning-soul.svg`, name: "★ Burning Soul", kind: "Base · skin", slot: "base", cost: 30, mult: 2.0, mh: 10 },
];

const ASCEND_AT = 30; // souls consumed to be renamed a Soul Reaper

export default function RiteMock() {
  const [aspirantId, setAspirantId] = useState(136);
  // MULTI-SELECT: a set of mark ids worn at once.
  const [worn, setWorn] = useState<Set<string>>(() => new Set(["crown"]));

  const aspirant = ASPIRANTS.find((a) => a.id === aspirantId)!;
  const wornMarks = REAPER_MARKS.filter((m) => worn.has(m.id));

  // total cost = SUM of the marks worn = souls consumed
  const consumed = wornMarks.reduce((s, m) => s + m.cost, 0);
  const ascended = consumed >= ASCEND_AT;
  const pct = Math.min(100, (consumed / ASCEND_AT) * 100);
  const displayName = ascended ? "Soul Reaper" : "Cubist Soul";

  // aggregate perks across the worn marks
  const mhBonus = wornMarks.reduce((s, m) => s + m.mh, 0);
  const mult = wornMarks.reduce((mx, m) => Math.max(mx, m.mult), 0);
  const rank = consumed >= 30 ? "Ash Warden" : consumed >= 12 ? "Ember Reaper" : consumed > 0 ? "Initiate" : "—";

  // Compose the preview stack: for each slot, a mark can substitute the aspirant's
  // layer; the fx mark (Phoenix) is appended above everything. Clean layer swaps.
  const bySlot: Partial<Record<Slot | "fx", string>> = {};
  for (const m of wornMarks) bySlot[m.slot] = m.file;
  const stack: string[] = SLOTS.map((s) => bySlot[s] ?? aspirant.layers[s]);
  if (bySlot.fx) stack.push(bySlot.fx);

  function toggleMark(id: string) {
    setWorn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rite">
      {/* STEP 1 */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">1</span>Pick your aspirant</div>
        <div className="aspirants">
          {ASPIRANTS.map((a) => (
            <button
              key={a.id}
              className={`aspirant${aspirantId === a.id ? " sel" : ""}`}
              onClick={() => setAspirantId(a.id)}
              aria-pressed={aspirantId === a.id}
              aria-label={`Aspirant ${a.name}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={IMG(a.id)} alt={`Cubist Soul ${a.name}`} loading="lazy" />
              <span className="tag">{a.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* STEP 2 — try on marks (MULTI-SELECT: combine several) */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">2</span>Offer Pikkazos — combine any marks</div>
        <div className="rtraits">
          {REAPER_MARKS.map((t) => {
            const on = worn.has(t.id);
            return (
              <button
                key={t.id}
                className={`rtrait${on ? " sel" : ""}`}
                onClick={() => toggleMark(t.id)}
                aria-pressed={on}
                aria-label={`${t.name} — ${t.cost} Pikkazos`}
              >
                <span className="rt-price">{t.cost} 🔥</span>
                {on && <span className="rt-on">✓</span>}
                <span className="rt-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.file} alt={t.name} loading="lazy" />
                </span>
                <span className="rt-body">
                  <span className="rt-name"><b>{t.name}</b></span>
                  <span className="rt-kind">{t.kind}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 3 — live preview, consumption, rename */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">3</span>The Reaper rises</div>
        <div className="rite-preview">
          <div className="rp-portrait">
            <div className="tryon-stack">
              <span className="rp-stamp">Try-on</span>
              {stack.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${src}-${i}`} className="lyr" src={src} alt="" />
              ))}
            </div>
            {/* identity plate — renamed at 30 consumed */}
            <div className={`soul-plate${ascended ? " ascended" : ""}`} key={ascended ? "reaper" : "soul"}>
              {ascended && <span className="plate-mark">🜃</span>}
              {displayName} <span className="pnum">#{aspirantId}</span>
            </div>
            <div className="tryon-hint">Swap soul or toggle marks freely · try before the fire</div>
          </div>

          <div>
            <div className="granted-lab">
              Wearing · {wornMarks.length ? wornMarks.map((m) => m.name).join(" + ") : "nothing yet"}
            </div>
            <div className="perk-chips">
              <span className="rk-chip"><span className="ico">🔥</span><b>{consumed}</b> Pikkazos</span>
              <span className="rk-chip"><span className="ico">⏳</span>MH <b>×{mult ? mult.toFixed(1) : "1.0"}</b></span>
              <span className="rk-chip"><span className="ico">✦</span><b>+{mhBonus}</b> MH/hr</span>
              <span className="rk-chip"><span className="ico">🜂</span>{rank}</span>
            </div>

            {/* souls consumed → rename at 30 */}
            <div className="consumed">
              <div className="consumed-top"><span>Souls consumed</span><b>{consumed} / {ASCEND_AT}</b></div>
              <div className="consumed-bar"><span style={{ width: `${pct}%` }} /></div>
              <div className={`consumed-note${ascended ? " up" : ""}`}>
                {ascended
                  ? "★ 30 reached — renamed by the museum"
                  : consumed > 0
                    ? `${ASCEND_AT - consumed} more to ascend`
                    : "toggle marks to feed the fire"}
              </div>
            </div>

            {/* what OpenSea will show */}
            <div className="meta-preview">
              <div className="mp-head">Metadata preview · as on OpenSea</div>
              <div className="mp-row"><span>Name</span><b className={ascended ? "up" : ""}>{displayName} #{aspirantId}</b></div>
              <div className="mp-row"><span>Souls Consumed</span><b>{consumed}</b></div>
            </div>

            <div className="perk-ill">Offerings and rewards may shift before the fire is lit</div>
          </div>
        </div>
      </div>

      <div className="rite-cta">
        <button className="btn-rite" disabled aria-disabled="true">
          The rite is being prepared — the scythe is not yet forged
        </button>
        <div className="cost-line">
          Cost: <b>{consumed} Pikkazos</b> · <span className="irr">irreversible</span>
        </div>
      </div>
    </div>
  );
}
