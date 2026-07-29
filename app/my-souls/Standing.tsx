"use client";

import type { ReactNode } from "react";
import Panel from "../components/Panel";
import { MHHero, BoardBody, type DashPhase } from "./MuseumParts";
import { MH_COHORT_NAME, type MyMHResult, type MHExhibit, type MHBoardResult } from "@/lib/mh";
import type { SoulsData } from "@/lib/souls";
import type { MineEntry } from "./MyReapers";

// YOUR STANDING — the museum's read-out of where a wallet sits: raffle tickets,
// rarity portfolio, weight, projection, next milestones, spotlight, member-since,
// cohorts. Reuses ONLY data already loaded (souls + MH hero + board + reaper
// state). Board-dependent numbers (weight %, rank nudge) show a skeleton until the
// heavy pass lands (the same two-phase pattern the hero uses). Copy stays terse
// (skin B, ≤8 words a line). No ETH/fiat anywhere — the flex is hours and rarity.

const mhNum = (v: number) =>
  (v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (v: number) => Math.round(v || 0).toLocaleString("en-US");
const pct = (v: number) => (v < 0.1 && v > 0 ? v.toFixed(2) : v.toFixed(1)) + "%";

const IMG = (id: number) => `/api/img?id=${id}`;
// Composed (marked) art — absolute prod endpoint, same as the collection grid.
const REAPER_IMG = (id: number) => `https://cubistsouls.com/api/reaper-img?id=${id}`;
const REAPER_ART_MIN = 6; // first mark unlocks at 6 consumed

const TIER_NAME = ["Collection", "Catalogued", "Featured", "Exhibition", "Masterpiece"];
const shortDate = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/* ============================ RAFFLE — third numeric card in the standing grid == */
// Lives inside the stat grid now (row 1, beside Weight + Projection) so the panel
// reads as one deterministic block instead of a card floating loose up above
// (Adrian, 28-jul). Keeps its reaper-perk purple accent, but shares the stat-card
// frame/padding/header so the three top numbers line up.
export function RaffleCard({ consumed }: { consumed: number }) {
  return (
    <div className="stat raffle st-raffle" aria-label="Raffle tickets">
      <div className="stat-h">🎟 Raffle tickets</div>
      <div className="stat-big raffle-n">{whole(consumed)}</div>
      <div className="stat-sub">
        1 per soul consumed. <b>Forever.</b>
      </div>
    </div>
  );
}

/* ============================ THE STANDING PANEL (7 stat cards) ================== */
export default function Standing({
  data,
  myMh,
  mhPhase,
  board,
  boardPhase,
  boardUpdatedAt,
  mine,
  consumed,
  contribution,
  reaperLive,
  mode = "self",
}: {
  data: SoulsData;
  myMh: MyMHResult | null;
  mhPhase: DashPhase;
  board: MHBoardResult | null;
  boardPhase: DashPhase;
  boardUpdatedAt: number | null;
  mine: MineEntry[];
  consumed: number;
  contribution: number;
  reaperLive: boolean;
  mode?: "self" | "public";
}) {
  const exhibits = myMh?.exhibits ?? [];
  const consumedById = new Map(mine.map((e) => [e.id, e.consumed]));
  const imgFor = (id: number) =>
    reaperLive && (consumedById.get(id) ?? 0) >= REAPER_ART_MIN ? REAPER_IMG(id) : IMG(id);

  // Deterministic grid (grid-template-areas in CSS) — same skeleton for EVERY
  // wallet, so a whale and a 1-soul holder both read as an ordered panel with no
  // dead gaps. DOM order below follows the mobile stack; desktop/tablet placement
  // is driven entirely by the `st-*` area classes. Raffle drops out cleanly when
  // reapers aren't live (the `no-raffle` template rebalances the top row).
  return (
    <Panel id="standing" title={mode === "self" ? "🏛 Your standing" : "🏛 Standing"} meta={`${data.owned.length} held`} wide>
      <div className={`stat-cards${reaperLive ? "" : " no-raffle"}`}>
        <WeightCard data={data} myMh={myMh} board={board} boardPhase={boardPhase} mode={mode} />
        <ProjectionCard myMh={myMh} />
        {reaperLive ? <RaffleCard consumed={consumed} /> : null}
        <RarityCard exhibits={exhibits} loading={!myMh} />
        <SpotlightCard exhibits={exhibits} imgFor={imgFor} loading={!myMh} />
        <MilestonesCard mine={mine} board={board} boardPhase={boardPhase} contribution={contribution} reaperLive={reaperLive} mode={mode} />
        <MemberSinceCard myMh={myMh} />
        {/* The panel closes on ONE row: the live hour counter at two thirds, the
            curators' board at one third. The counter keeps its size because it is
            the payoff of the whole section; the board only ever needed ~257px of
            the 321 a third gives it. Cohorts used to be a full-width band of its
            own — it is chip-shaped metadata like everything else in the counter's
            footer, so it moved in there. */}
        <div className="stat st-mh">
          <MHHero mode={mode} myMh={myMh} mhPhase={mhPhase} heldNone={!data.owned.length} />
          <CohortChips exhibits={exhibits} loading={!myMh} reaperLive={reaperLive} mode={mode} />
        </div>
        <div className="stat st-board">
          <div className="stat-h">🏛 Curators&apos; board</div>
          <BoardBody mode={mode} board={board?.rows ?? null} boardPhase={boardPhase} updatedAt={boardUpdatedAt} />
        </div>
      </div>
    </Panel>
  );
}

/* ---- 2 · rarity portfolio -------------------------------------------------- */
function RarityCard({ exhibits, loading }: { exhibits: MHExhibit[]; loading: boolean }) {
  const counts = [0, 0, 0, 0, 0];
  const seal = new Map<number, string>();
  let has = false;
  for (const e of exhibits) {
    if (e.tier != null) {
      counts[e.tier]++;
      has = true;
      if (e.raritySeal && !seal.has(e.tier)) seal.set(e.tier, e.raritySeal);
    }
  }
  const max = Math.max(1, ...counts);
  return (
    <div className="stat st-rarity">
      <div className="stat-h">📜 By rarity</div>
      {loading ? (
        <SkelLines n={3} />
      ) : !has ? (
        <p className="stat-note">Rarity ledger unavailable.</p>
      ) : (
        <div className="rz">
          {[4, 3, 2, 1, 0].map((t) => (
            <div className={`rz-row${counts[t] ? "" : " zero"}`} key={t}>
              <span className="rz-lbl">{seal.get(t) ?? TIER_NAME[t]}</span>
              <span className="rz-bar">
                <span
                  className="rz-fill"
                  data-t={t}
                  // min 6px so the rare tiers (the point of a portfolio) never
                  // vanish next to a few hundred Collection souls.
                  style={{ width: counts[t] ? `max(6px, ${(counts[t] / max) * 100}%)` : "0" }}
                />
              </span>
              <span className="rz-n">{counts[t]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- 3 · your weight in the museum ---------------------------------------- */
function WeightCard({
  data,
  myMh,
  board,
  boardPhase,
  mode = "self",
}: {
  data: SoulsData;
  myMh: MyMHResult | null;
  board: MHBoardResult | null;
  boardPhase: string;
  mode?: "self" | "public";
}) {
  const supplyPct = data.totalSupply > 0 ? (data.owned.length / data.totalSupply) * 100 : null;
  const ratePct = board && board.totalRate > 0 && myMh ? (myMh.me.rate / board.totalRate) * 100 : null;
  return (
    <div className="stat st-weight">
      <div className="stat-h">🏛️ {mode === "self" ? "Your weight" : "Weight"}</div>
      <div className="wt-two">
        <div className="wt-cell">
          {ratePct != null ? (
            <div className="wt-big">{pct(ratePct)}</div>
          ) : boardPhase === "error" ? (
            <div className="wt-big dim">—</div>
          ) : (
            <div className="wt-skel" />
          )}
          <div className="wt-sub">of MH emission</div>
        </div>
        <div className="wt-cell">
          {supplyPct != null ? <div className="wt-big">{pct(supplyPct)}</div> : <div className="wt-skel" />}
          <div className="wt-sub">of freed souls held</div>
        </div>
      </div>
    </div>
  );
}

/* ---- 4 · projection -------------------------------------------------------- */
function ProjectionCard({ myMh }: { myMh: MyMHResult | null }) {
  const rate = myMh?.me.rate ?? 0;
  return (
    <div className="stat st-proj">
      <div className="stat-h">⏱️ Projection</div>
      {myMh ? (
        <>
          <div className="stat-big">
            +{mhNum(rate * 24)}
            <span className="stat-unit">MH/day</span>
          </div>
          <div className="stat-sub">+{mhNum(rate * 168)} MH / week</div>
        </>
      ) : (
        <SkelLines n={2} />
      )}
    </div>
  );
}

/* ---- 5 · next milestones --------------------------------------------------- */
const LIB_TIERS = [
  { min: 1, name: "Liberator" },
  { min: 5, name: "Curator" },
  { min: 20, name: "Patron" },
  { min: 50, name: "Founding Patron" },
];
function MilestonesCard({
  mine,
  board,
  boardPhase,
  contribution,
  reaperLive,
  mode = "self",
}: {
  mine: MineEntry[];
  board: MHBoardResult | null;
  boardPhase: string;
  contribution: number;
  reaperLive: boolean;
  mode?: "self" | "public";
}) {
  const self = mode === "self";
  const nudges: { txt: ReactNode; href?: string }[] = [];

  // (a) a soul in the fire, closest to ascending (action link only on your own page)
  if (reaperLive) {
    const rising = mine.filter((e) => !e.isReaper && e.consumed > 0).sort((a, b) => b.consumed - a.consumed)[0];
    if (rising) {
      nudges.push({
        txt: (
          <>
            <b>{30 - rising.consumed}</b> more on #{rising.id} → SOUL REAPER
          </>
        ),
        ...(self ? { href: "/reapers#rite" } : {}),
      });
    }
  }

  // (b) place on the curators' board (MH-ranked)
  let boardPending = false;
  if (board) {
    const meRow = board.rows.find((r) => r.isMe);
    if (meRow?.rank === 1) {
      const second = board.rows.find((r) => r.rank === 2);
      if (second) nudges.push({ txt: <>{self ? "You lead" : "Leads"} by <b>{mhNum(meRow.mh - second.mh)}</b> MH</> });
    } else if (meRow && meRow.rank > 1) {
      const above = board.rows.find((r) => r.rank === meRow.rank - 1);
      if (above) {
        nudges.push({
          txt: <>
            <b>{mhNum(Math.max(0, above.mh - meRow.mh))}</b> MH to pass #{meRow.rank - 1}
          </>,
        });
      }
    }
  } else if (boardPhase === "loading" || boardPhase === "idle") {
    boardPending = true;
  }

  // (c) next Liberator tier by total contribution
  const next = LIB_TIERS.find((t) => contribution < t.min);
  if (next) {
    nudges.push({ txt: <><b>{next.min - contribution}</b> more to {next.name}</> });
  }

  const shown = nudges.slice(0, 3);
  return (
    <div className="stat st-next">
      <div className="stat-h">🎯 Next up</div>
      <ul className="ms-nudges">
        {shown.map((n, i) => (
          <li key={i}>{n.href ? <a href={n.href}>{n.txt} →</a> : n.txt}</li>
        ))}
        {boardPending ? <li className="nudge-skel" /> : null}
        {!shown.length && !boardPending ? (
          <li className="ms-top-line">{self ? "You're at the summit." : "At the summit."} 🜃</li>
        ) : null}
      </ul>
    </div>
  );
}

/* ---- 6 · spotlight --------------------------------------------------------- */
function SpotlightCard({
  exhibits,
  imgFor,
  loading,
}: {
  exhibits: MHExhibit[];
  imgFor: (id: number) => string;
  loading: boolean;
}) {
  const top = exhibits.reduce<MHExhibit | null>((b, e) => (e.rate > (b?.rate ?? -1) ? e : b), null);
  const rarest = exhibits.filter((e) => e.rank != null).sort((a, b) => a.rank! - b.rank!)[0] ?? null;
  return (
    <div className="stat spot st-spot">
      <div className="stat-h">⭐ Spotlight</div>
      {loading ? (
        <SkelLines n={2} />
      ) : (
        <div className="spot-two">
          {top ? <SpotMini label="Top earner" id={top.id} sub={`+${mhNum(top.rate)} MH/h`} img={imgFor(top.id)} /> : null}
          {rarest ? (
            <SpotMini label="Rarest" id={rarest.id} sub={`Rank #${rarest.rank!.toLocaleString("en-US")}`} img={imgFor(rarest.id)} />
          ) : null}
        </div>
      )}
    </div>
  );
}
function SpotMini({ label, id, sub, img }: { label: string; id: number; sub: string; img: string }) {
  return (
    <div className="spot-m">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="spot-art" src={img} alt={`Soul #${id}`} loading="lazy" />
      <div className="spot-cap">{label}</div>
      <div className="spot-id">№{String(id).padStart(4, "0")}</div>
      <div className="spot-sub">{sub}</div>
    </div>
  );
}

/* ---- 7 · member since ------------------------------------------------------ */
function MemberSinceCard({ myMh }: { myMh: MyMHResult | null }) {
  const ms = myMh?.memberSince;
  const days = ms ? Math.max(0, Math.floor(Date.now() / 1000 - ms.ts) / 86400) : 0;
  return (
    <div className="stat st-member">
      <div className="stat-h">🕯️ Member since</div>
      {ms ? (
        <>
          <div className="stat-big sm">{shortDate(ms.ts)}</div>
          <div className="stat-sub">
            {Math.floor(days)} days · first soul #{ms.id}
          </div>
        </>
      ) : (
        <SkelLines n={2} />
      )}
    </div>
  );
}

/* ---- 8 · cohorts ----------------------------------------------------------- */
/* What you hold, by era — a second chip row under the hour counter's multipliers.
   Same shape of fact, so it reads as one footer instead of two stacked bands. */
function CohortChips({ exhibits, loading, reaperLive, mode = "self" }: { exhibits: MHExhibit[]; loading: boolean; reaperLive: boolean; mode?: "self" | "public" }) {
  const counts = [0, 0, 0, 0, 0];
  for (const e of exhibits) counts[e.cohort]++;
  const parts = counts.map((n, i) => (n > 0 ? { name: MH_COHORT_NAME[i], n } : null)).filter(Boolean) as { name: string; n: number }[];
  const og = counts[0];
  if (loading) return <div className="mh-cohorts"><SkelLines n={1} /></div>;
  if (!parts.length) return null;
  return (
    <div className="mh-cohorts">
      <span className="mh-cohorts-k">Cohorts</span>
      {parts.map((p) => (
        <span className="mh-chip" key={p.name}>
          {p.name} <b>×{p.n}</b>
        </span>
      ))}
      {/* the scythe CTA is an action — only on your own page */}
      {mode === "self" && reaperLive && og > 0 ? (
        <a className="mh-cohorts-cta" href="/reapers#rite">
          OG souls can take the scythe →
        </a>
      ) : null}
    </div>
  );
}

/* ---- shared skeleton ------------------------------------------------------- */
function SkelLines({ n }: { n: number }) {
  return (
    <div className="stat-skel">
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
