"use client";

import { useState } from "react";

// THE RITE — a fully client-side, no-chain mock. Nothing is signed, nothing
// burns. It lets Adrian feel the flow: pick an aspirant soul, choose the
// offering (sacrifice N souls OR burn M Pikkazos), and preview the Reaper
// result + perks. Every number is ILLUSTRATIVE — final values TBD.

// Real soul art via the on-chain renderer host (unchanged by the domain flip).
const IMG = (id: number) => `https://cubistsouls.vercel.app/api/img?id=${id}`;

// Aspirant candidates (real freed souls, illustrative selection).
const ASPIRANTS = [
  { id: 136, name: "№0136" },
  { id: 42, name: "№0042" },
  { id: 777, name: "№0777" },
  { id: 90, name: "№0090" },
];

// The Reaper trait set = the NEW builder marks that never existed in the
// original hand (the ★ / bc-* set). Served from /public.
const T = "/assets/traits-svg";
const REAPER_TRAITS = [
  { file: `${T}/art-background/bc-orange.svg`, name: "★ Orange", kind: "Background" },
  { file: `${T}/head/bc-flame-crown.svg`, name: "★ Flame Crown", kind: "Head" },
  { file: `${T}/base/bc-burning-soul.svg`, name: "★ Burning Soul", kind: "Base" },
  { file: `${T}/burn-fx/phoenix.svg`, name: "★ Phoenix", kind: "Burn FX" },
];

type Mode = "souls" | "pikkazos";

// Illustrative offering weight → tier. Souls are worth more than Pikkazos.
function tierFor(weight: number) {
  if (weight >= 12) return { name: "Ash Warden", mult: "2.0", traits: 4, seal: "Warden seal" };
  if (weight >= 6) return { name: "Ember Reaper", mult: "1.5", traits: 2, seal: "Reaper seal" };
  return { name: "Initiate", mult: "1.2", traits: 1, seal: "Initiate mark" };
}

export default function RiteMock() {
  const [aspirant, setAspirant] = useState(136);
  const [mode, setMode] = useState<Mode>("souls");
  const [souls, setSouls] = useState(2);
  const [pikkazos, setPikkazos] = useState(4);

  const count = mode === "souls" ? souls : pikkazos;
  const max = mode === "souls" ? 5 : 10;
  const fill = ((count - 1) / (max - 1)) * 100;
  const weight = mode === "souls" ? souls * 3 : pikkazos * 1; // souls worth 3×
  const tier = tierFor(weight);
  const mhBonus = weight; // +MH/hour, illustrative
  const granted = REAPER_TRAITS.slice(0, tier.traits);

  return (
    <div className="rite">
      {/* STEP 1 — aspirant */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">1</span>Choose your aspirant soul</div>
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

      {/* STEP 2 — offering */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">2</span>Feed the second fire</div>
        <div className="offer-toggle" role="tablist" aria-label="Offering type">
          <button role="tab" aria-selected={mode === "souls"} className={mode === "souls" ? "on" : ""} onClick={() => setMode("souls")}>
            Sacrifice souls
          </button>
          <button role="tab" aria-selected={mode === "pikkazos"} className={mode === "pikkazos" ? "on" : ""} onClick={() => setMode("pikkazos")}>
            Burn Pikkazos
          </button>
        </div>
        <div className="offer-body">
          <div className="offer-count">
            <span className="big"><b>{count}</b></span>
            <span className="unit">{mode === "souls" ? (count === 1 ? "soul to the fire" : "souls to the fire") : (count === 1 ? "Pikkazo as offering" : "Pikkazos as offering")}</span>
          </div>
          <input
            className="slider"
            type="range"
            min={1}
            max={max}
            value={count}
            style={{ ["--fill" as string]: `${fill}%` }}
            onChange={(e) => (mode === "souls" ? setSouls(+e.target.value) : setPikkazos(+e.target.value))}
            aria-label={mode === "souls" ? "Souls to sacrifice" : "Pikkazos to burn"}
          />
          <p className="offer-hint">
            {mode === "souls"
              ? "Souls given willingly to the flame become ash — and the ash feeds the Reaper. The larger the offering, the deeper the mark."
              : "Bring fresh Pikkazos to the bonfire instead. The same forge, a different ember — free more souls while you rise."}
          </p>
        </div>
      </div>

      {/* STEP 3 — preview */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">3</span>The soul, remade</div>
        <div className="rite-preview">
          <div className="rp-portrait">
            <div className="frame-img">
              <span className="rp-stamp">Reaper</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={IMG(aspirant)} alt={`Aspirant soul №${String(aspirant).padStart(4, "0")}`} />
            </div>
            <div className="rp-rank">{tier.name}<small>Illustrative rank</small></div>
          </div>

          <div>
            <div className="granted-lab">Reaper traits granted (from the new set)</div>
            <div className="granted">
              {granted.map((g) => (
                <div className="gtrait" key={g.file}>
                  <span className="thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g.file} alt={g.name} loading="lazy" />
                  </span>
                  <span className="gname"><b>{g.name}</b><br />{g.kind}</span>
                </div>
              ))}
            </div>

            <ul className="perks">
              <li className="perk">
                <span className="pi">⏳</span>
                <span className="pt">Museum Hours multiplier <b>×{tier.mult}</b> <span className="ill">(illustrative)</span></span>
              </li>
              <li className="perk">
                <span className="pi">✦</span>
                <span className="pt"><b>+{mhBonus} MH / hour</b> bonus while the mark holds <span className="ill">(illustrative)</span></span>
              </li>
              <li className="perk">
                <span className="pi">🜂</span>
                <span className="pt"><b>{tier.seal}</b> — a permanent Reaper stamp on the plaque</span>
              </li>
              <li className="perk">
                <span className="pi">🗝️</span>
                <span className="pt">Future privileges — exhibitions, raffles, first light in new eras <span className="ill">(illustrative)</span></span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="rite-cta">
        <button className="btn-rite" disabled aria-disabled="true">
          The rite is being prepared — the scythe is not yet forged
        </button>
        <div className="rite-note">Concept only · nothing is signed, nothing burns · illustrative — final numbers TBD</div>
      </div>
    </div>
  );
}
