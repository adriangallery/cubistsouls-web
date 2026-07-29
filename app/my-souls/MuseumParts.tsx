"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { MyMHResult, MHBoardRow } from "@/lib/mh";

export type DashPhase = "idle" | "loading" | "loaded" | "error";

// The two museum readouts that used to be standalone panels at the top of the
// dashboard. Adrian moved them INSIDE "Your standing" (29-jul) — the live hour
// counter and the curators' board now close that panel instead of opening the page.
// They live here rather than in Dashboard.tsx so both Dashboard and Standing can
// import them without a cycle.

export const mhNum = (v: number) =>
  (v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "updated Nm ago" for the board's cached snapshot.
export function agoShort(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/* ---------------- Museum Hours hero (live counter) ---------------- */
export function MHHero({
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
export function BoardBody({
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
    if (boardPhase === "error") {
      return <p className="mh-status">The full board couldn&apos;t load right now — the hours are current.</p>;
    }
    // The board is a 5-minute server-side snapshot, so it lands a beat after the
    // rest. Draw the ruled rows now and let the numbers arrive into them: the panel
    // never changes size, so the wait reads as tallying rather than as a broken page.
    return (
      <div aria-busy="true">
        <div className="bd-skeleton" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <span className="bd-sk-row" key={i} />
          ))}
        </div>
        <p className="bd-sk-note">Tallying the curators&apos; board…</p>
      </div>
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
