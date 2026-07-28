"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Panel from "../components/Panel";
import CollabGrid from "./CollabGrid";
import MyReapers, { type MineEntry } from "./MyReapers";
import Standing from "./Standing";
import { tierOf, type SoulsData } from "@/lib/souls";
import type { MyMHResult, MHBoardResult, MHBoardRow } from "@/lib/mh";

export type DashPhase = "idle" | "loading" | "loaded" | "error";

const mhNum = (v: number) =>
  (v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "updated Nm ago" for the board's cached snapshot.
function agoShort(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/* ================= dashboard (the control room) =================
   One deck bar on top, then a two-column grid of collapsible panels:
   Museum Hours + Curators' board, YOUR REAPERS, YOUR STANDING, and the
   collection across the full width.

   SHARED by /my-souls (mode="self", with the share card + WTP collab spark) and
   /curator/<address> (mode="public", read-only — no share row, no spark). The panel
   layout, MH hero, board and standing are IDENTICAL between the two so a curator's
   public page reads exactly like their own does.
   ================================================================ */
export default function Dashboard({
  mode,
  data,
  shareRow = null,
  address,
  collab,
  mine,
  consumed,
  contribution,
  deckRank,
  deckTotal,
  myMh,
  mhPhase,
  board,
  boardPhase,
  boardUpdatedAt,
  reaperLive,
}: {
  mode: "self" | "public";
  data: SoulsData;
  shareRow?: React.ReactNode;
  address: string;
  collab: boolean;
  mine: MineEntry[];
  consumed: number;
  contribution: number;
  deckRank: number;
  deckTotal: number;
  myMh: MyMHResult | null;
  mhPhase: DashPhase;
  board: MHBoardResult | null;
  boardPhase: DashPhase;
  boardUpdatedAt: number | null;
  reaperLive: boolean;
}) {
  const tier = tierOf(contribution);
  const boardTop = board ? Math.min(20, board.rows.filter((r) => !r.gap).length) : 0;
  const consumedById = new Map(mine.map((e) => [e.id, e.consumed]));

  return (
    <>
      {/* ---- deck: the recognition plaque, laid out as a status bar ---- */}
      <div className="deck">
        <div className="dk-id">
          <div className="dk-tier">Founding Liberator · {tier}</div>
          <div className="dk-headline">
            {mode === "self" ? "You freed " : "Freed "}
            <b>{data.freed}</b> soul{data.freed === 1 ? "" : "s"}
          </div>
        </div>
        <div className="dk-stats">
          <div className="dk-stat">
            <b>#{deckRank}</b>
            <span>of {deckTotal} liberators</span>
          </div>
          <div className="dk-stat">
            <b>{data.freed}</b>
            <span>souls freed</span>
          </div>
          {reaperLive ? (
            <div className="dk-stat">
              <b>{consumed}</b>
              <span>souls consumed</span>
            </div>
          ) : null}
          <div className="dk-stat">
            <b>{data.owned.length}</b>
            <span>held now</span>
          </div>
        </div>
        {shareRow ? <div className="dk-actions">{shareRow}</div> : null}
      </div>

      <div className="dash">
        <Panel
          id="mh"
          title="🏛 Museum Hours"
          meta={myMh ? `${mhNum(myMh.me.mh)} MH` : mhPhase === "error" ? "unavailable" : "counting…"}
        >
          <MHHero mode={mode} myMh={myMh} mhPhase={mhPhase} heldNone={!data.owned.length} />
        </Panel>

        <Panel
          id="board"
          title="Curators' board"
          meta={board ? `top ${boardTop} of ${board.rows.length}` : boardPhase === "error" ? "unavailable" : "tallying…"}
          tall
        >
          <BoardBody mode={mode} board={board?.rows ?? null} boardPhase={boardPhase} updatedAt={boardUpdatedAt} />
        </Panel>

        {reaperLive ? <MyReapers mine={mine} mode={mode} /> : null}

        <Standing
          data={data}
          myMh={myMh}
          board={board}
          boardPhase={boardPhase}
          mine={mine}
          consumed={consumed}
          contribution={contribution}
          reaperLive={reaperLive}
          mode={mode}
        />

        <Panel
          id="collection"
          title={mode === "self" ? "Your collection" : "Collection"}
          meta={`${data.owned.length} soul${data.owned.length === 1 ? "" : "s"}`}
          wide
        >
          {data.owned.length ? (
            <CollabGrid
              owned={data.owned}
              address={address}
              collabEnabled={collab}
              exhibits={myMh?.exhibits ?? null}
              consumedById={consumedById}
            />
          ) : (
            <p className="mh-status">
              {mode === "self"
                ? "You've freed souls but hold none right now — the clock only runs on souls you keep."
                : "This wallet holds no souls right now — the clock only runs on souls kept."}
            </p>
          )}
        </Panel>
      </div>

      {mode === "self" ? (
        <div className="rewards">
          <h3>You were early</h3>
          <p>
            You reclaimed the collection when it mattered. Founding Liberators won&apos;t be forgotten — more on that
            soon.
          </p>
        </div>
      ) : null}
    </>
  );
}

/* ---------------- Museum Hours hero (live counter) ---------------- */
function MHHero({
  mode,
  myMh,
  mhPhase,
  heldNone,
}: {
  mode: "self" | "public";
  myMh: MyMHResult | null;
  mhPhase: DashPhase;
  heldNone: boolean;
}) {
  const countRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!myMh) return;
    const el = countRef.current;
    if (!el) return;
    const t0 = performance.now();
    const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
    let raf = 0;
    let iv: ReturnType<typeof setInterval> | undefined;
    const frame = () => {
      el.textContent = mhNum(myMh.me.mh + myMh.me.rate * ((performance.now() - t0) / 3600000));
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    frame();
    if (reduced) iv = setInterval(frame, 1000);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (iv) clearInterval(iv);
    };
  }, [myMh]);

  if (!myMh && (mhPhase === "loading" || mhPhase === "idle")) {
    return (
      <div className="mh-hero" aria-busy="true">
        <div className="cap">{mode === "self" ? "Your Museum Hours" : "Museum Hours"}</div>
        <div className="mh-count">
          <span className="spinner" aria-hidden="true" />
        </div>
        <div className="mh-rate">The museum is counting the hours…</div>
      </div>
    );
  }

  if (!myMh) {
    return <p className="mh-status">The museum&apos;s records are unavailable right now. Try again shortly.</p>;
  }

  return (
    <>
      <div className="mh-hero">
        <div className="cap">{mode === "self" ? "Your Museum Hours" : "Museum Hours"}</div>
        <div className="mh-count">
          <span className="v" ref={countRef}>
            {mhNum(myMh.me.mh)}
          </span>
          <span className="unit">MH</span>
        </div>
        <div className="mh-rate">+{mhNum(myMh.me.rate)} MH / hour</div>
        <div className="mh-mult">
          <span className="mh-chip">
            Souls held <b>{myMh.me.heldCount}</b>
          </span>
          <span className="mh-chip">
            Liberator <b>{myMh.me.lib.name}</b> ×{myMh.me.lib.mult}
          </span>
          {myMh.me.reaperCount > 0 ? (
            <span className="mh-chip reaper">
              🜃 Inherited <b>+{myMh.me.inheritedMH}</b> MH/h
            </span>
          ) : null}
          {myMh.me.maxProvBonus > 0 ? (
            <span className="mh-chip">
              🏺 Provenance <b>+{myMh.me.maxProvBonus}%</b>
            </span>
          ) : null}
          <span className="mh-chip">
            Base <b>1.0</b> MH / soul / hr
          </span>
        </div>
      </div>

      {heldNone ? (
        <p className="mh-status">
          {mode === "self"
            ? "You hold no souls in this wallet right now — the clock only runs on souls you keep."
            : "This wallet holds no souls right now — the clock only runs on souls kept."}
        </p>
      ) : null}

      <p className="mh-foot">
        The museum records every hour its souls are kept. Preview · their purpose will be revealed.
      </p>
    </>
  );
}

/* ---------------- Curators' board (server-cached snapshot) ---------------- */
// Each row links to that curator's public profile (/curator/<address>) — the board
// is the front door to "curiosear a la competencia". The raw address rides on the
// row (MHBoardRow.raw); the shortened `addr` is what's shown.
function BoardBody({
  mode,
  board,
  boardPhase,
  updatedAt,
}: {
  mode: "self" | "public";
  board: MHBoardRow[] | null;
  boardPhase: DashPhase;
  updatedAt: number | null;
}) {
  if (!board) {
    return (
      <p className="mh-status">
        {boardPhase === "error"
          ? "The full board couldn't load right now — the hours are current."
          : "Tallying the curators' board…"}
      </p>
    );
  }
  const Row = ({ r }: { r: MHBoardRow }) => {
    const inner = (
      <>
        <span className="rk">#{r.rank}</span>
        <span className="addr">{r.addr}</span>
        <span className="mh">{mhNum(r.mh)} MH</span>
      </>
    );
    return r.raw ? (
      <Link className={`lb-row lb-link ${r.isMe ? "me" : ""}`} href={`/curator/${r.raw}`}>
        {inner}
      </Link>
    ) : (
      <div className={`lb-row ${r.isMe ? "me" : ""}`}>{inner}</div>
    );
  };
  return (
    <div className={`mh-board${mode === "public" ? " public" : ""}`}>
      {board.map((r, i) =>
        r.gap ? (
          <div key={`g${i}`}>
            <div className="lb-gap">···</div>
            <Row r={r} />
          </div>
        ) : (
          <Row r={r} key={i} />
        ),
      )}
      {updatedAt ? <div className="lb-updated">Snapshot · updated {agoShort(updatedAt)}</div> : null}
    </div>
  );
}
