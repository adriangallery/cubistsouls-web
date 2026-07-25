"use client";

import { useState } from "react";

// THE RITE — fully client-side, no chain. Try before the fire: pick your soul,
// tap any Reaper mark, and the preview composes the REAL soul art with the
// trait SVG stacked on top (like the Soul Builder).
//
// Mechanic (Adrian, in-file edit): NO soul is ever sacrificed. You bring
// Pikkazos and burn them for the marks; a Pikkazo burned in the rite gives the
// MARK instead of a soul, and the museum takes no toll — the fire is free (you
// only bring the fuel). Each mark has its own Pikkazo price; the top costs the
// most. Numbers ILLUSTRATIVE — final TBD.

// Real soul art via the on-chain renderer host (unchanged by the domain flip).
const IMG = (id: number) => `https://cubistsouls.vercel.app/api/img?id=${id}`;

const ASPIRANTS = [
  { id: 136, name: "№0136" },
  { id: 42, name: "№0042" },
  { id: 777, name: "№0777" },
  { id: 90, name: "№0090" },
];

// The Reaper trait set = the NEW builder marks (the ★ / bc-* set) from /public.
// `cost` is in Pikkazos burned. `blend` composes each mark believably over the
// flat soul art: the crown sits on top; fire/aura glow.
const T = "/assets/traits-svg";
const REAPER_TRAITS = [
  { id: "orange", file: `${T}/art-background/bc-orange.svg`, name: "★ Orange", kind: "Background", cost: 6, blend: "screen", mult: "1.2", mh: 2, rank: "Initiate" },
  { id: "burning", file: `${T}/base/bc-burning-soul.svg`, name: "★ Burning Soul", kind: "Base", cost: 12, blend: "screen", mult: "1.4", mh: 4, rank: "Ember Reaper" },
  { id: "crown", file: `${T}/head/bc-flame-crown.svg`, name: "★ Flame Crown", kind: "Head", cost: 18, blend: "normal", mult: "1.6", mh: 6, rank: "Ember Reaper" },
  { id: "phoenix", file: `${T}/burn-fx/phoenix.svg`, name: "★ Phoenix", kind: "Burn FX", cost: 30, blend: "screen", mult: "2.0", mh: 10, rank: "Ash Warden" },
] as const;

export default function RiteMock() {
  const [aspirant, setAspirant] = useState(136);
  const [traitId, setTraitId] = useState<string>("crown");

  const trait = REAPER_TRAITS.find((t) => t.id === traitId)!;

  return (
    <div className="rite">
      {/* STEP 1 */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">1</span>Pick your aspirant</div>
        <div className="aspirants">
          {ASPIRANTS.map((a) => (
            <button
              key={a.id}
              className={`aspirant${aspirant === a.id ? " sel" : ""}`}
              onClick={() => setAspirant(a.id)}
              aria-pressed={aspirant === a.id}
              aria-label={`Aspirant ${a.name}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={IMG(a.id)} alt={`Cubist Soul ${a.name}`} loading="lazy" />
              <span className="tag">{a.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* STEP 2 — try on a mark */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">2</span>Try on a Reaper mark</div>
        <div className="rtraits">
          {REAPER_TRAITS.map((t) => (
            <button
              key={t.id}
              className={`rtrait${traitId === t.id ? " sel" : ""}`}
              onClick={() => setTraitId(t.id)}
              aria-pressed={traitId === t.id}
              aria-label={`${t.name} — ${t.cost} Pikkazos`}
            >
              <span className="rt-price">{t.cost} 🔥</span>
              <span className="rt-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.file} alt={t.name} loading="lazy" />
              </span>
              <span className="rt-body">
                <span className="rt-name"><b>{t.name}</b></span>
                <span className="rt-kind">{t.kind}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* STEP 3 — live preview + cost */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">3</span>The Reaper rises</div>
        <div className="rite-preview">
          <div className="rp-portrait">
            <div className="tryon-stack">
              <span className="rp-stamp">Try-on</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="base" src={IMG(aspirant)} alt={`Aspirant soul №${String(aspirant).padStart(4, "0")}`} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="layer" src={trait.file} alt={trait.name} style={{ mixBlendMode: trait.blend as React.CSSProperties["mixBlendMode"] }} />
            </div>
            <div className="tryon-hint">Swap soul or mark freely · try before the fire</div>
          </div>

          <div>
            <div className="granted-lab">Wearing · {trait.name}</div>
            <div className="perk-chips">
              <span className="rk-chip"><span className="ico">🔥</span><b>{trait.cost}</b> Pikkazos</span>
              <span className="rk-chip"><span className="ico">⏳</span>MH <b>×{trait.mult}</b></span>
              <span className="rk-chip"><span className="ico">✦</span><b>+{trait.mh}</b> MH/hr</span>
              <span className="rk-chip"><span className="ico">🜂</span>{trait.rank}</span>
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
          Cost: <b>{trait.cost} Pikkazos</b> · <span className="irr">irreversible</span>
        </div>
      </div>
    </div>
  );
}
