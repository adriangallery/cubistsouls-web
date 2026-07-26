"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import CollabGrid from "./CollabGrid";
import Panel from "../components/Panel";
import MyReapers, { mineFrom, type MineEntry } from "./MyReapers";
import MobileWalletSheet, { useIsMobileNoInjected } from "../components/MobileWalletSheet";
import { loadSouls, tierOf, type SoulsData } from "@/lib/souls";
import { buildMyMH, buildBoard, type MyMHResult, type MHBoardResult, type MHBoardRow } from "@/lib/mh";
import { getReaperState, type ReaperState } from "@/lib/reaper";
import { drawCard, shareText, downloadBlob, type CardStats } from "@/lib/share-card";
import flags from "@/public/flags.json";

const REAPER_LIVE = (flags as { reaperLive?: boolean }).reaperLive === true;

// DEV-ONLY read-only harness: ?as=0x… lets us render another wallet's page
// (no signer, reads only) to reproduce/verify. Gated to NODE_ENV==="development"
// so it is inert in every deployed build — the branch is dead code in prod.
function useDevAs(): string | undefined {
  const [as, setAs] = useState<string | undefined>();
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const v = new URLSearchParams(window.location.search).get("as");
    if (v && /^0x[0-9a-fA-F]{40}$/.test(v)) setAs(v.toLowerCase());
  }, []);
  return as;
}

const mhNum = (v: number) =>
  (v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toast(msg: string, ms = 6000) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
}

type Phase = "idle" | "loading" | "loaded" | "error";

export default function MySouls() {
  // Museum Hours are PUBLIC now — always shown, integrated below the collection
  // (no ?mh=1 gate; the flag survives only as a harmless no-op).
  const { address, isConnected } = useAccount();
  const client = usePublicClient();
  const { openConnectModal } = useConnectModal();
  const mobileNoInjected = useIsMobileNoInjected();
  const [sheet, setSheet] = useState(false);
  const devAs = useDevAs();

  // Effective wallet: the connected one, or the dev harness address in dev.
  const account = devAs ?? address;
  const connected = !!devAs || isConnected;

  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [data, setData] = useState<SoulsData | null>(null);
  const [reaper, setReaper] = useState<Map<number, ReaperState> | null>(null); // per-owned reaper state
  const [myMh, setMyMh] = useState<MyMHResult | null>(null);
  const [mhPhase, setMhPhase] = useState<Phase>("idle"); // your-hours pass (cheap)
  const [board, setBoard] = useState<MHBoardResult | null>(null);
  const [boardPhase, setBoardPhase] = useState<Phase>("idle"); // leaderboard (heavy)
  const [cardBusy, setCardBusy] = useState(false);
  const [collab, setCollab] = useState(true); // WTP collab spark; fail-open
  const reqRef = useRef(0); // guards against stale async when the wallet changes

  useEffect(() => setMounted(true), []);

  // Kill-switch for the WTP collab (flags.wc/collab pattern). Fail-open.
  useEffect(() => {
    fetch("/flags.json", { cache: "no-cache" })
      .then((r) => r.json())
      .then((f) => { if (f && f.collab === false) setCollab(false); })
      .catch(() => {});
  }, []);

  const load = useCallback(
    async (acct: string) => {
      if (!client) return;
      const reqId = ++reqRef.current;
      setPhase("loading");
      setData(null);
      setReaper(null);
      setMyMh(null);
      setBoard(null);
      setMhPhase("idle");
      setBoardPhase("idle");
      try {
        const d = await loadSouls(client, acct);
        if (reqId !== reqRef.current) return;
        setData(d);
        setPhase("loaded");
        if (d.freed > 0) {
          // Per-owned reaper state (consumed/marks) — cheap multicall. Powers the
          // "souls consumed" plaque stat, the YOUR REAPERS block, and the Reaper MH
          // multiplier fed into buildMyMH. Only fires when the facet is live.
          const rmap = REAPER_LIVE ? await getReaperState(client, d.owned) : new Map<number, ReaperState>();
          if (reqId !== reqRef.current) return;
          setReaper(rmap);
          const consumedById = new Map([...rmap].map(([id, s]) => [id, s.consumed]));
          // Phase 1 — YOUR hours (cheap; only your souls). Shows in seconds.
          setMhPhase("loading");
          try {
            const my = await buildMyMH(client, acct, d.owned, d.freed, d.acq, consumedById, REAPER_LIVE);
            if (reqId !== reqRef.current) return;
            setMyMh(my);
            setMhPhase("loaded");
            // Phase 2 — the curators' board (heavy: full collection scan). Runs
            // in the background so a slow/failing scan never hides your numbers.
            setBoardPhase("loading");
            buildBoard(client, acct, d.owned, d.freed, my.me.mh, REAPER_LIVE)
              .then((b) => {
                if (reqId === reqRef.current) {
                  setBoard(b);
                  setBoardPhase("loaded");
                }
              })
              .catch(() => {
                if (reqId === reqRef.current) setBoardPhase("error");
              });
          } catch {
            if (reqId === reqRef.current) setMhPhase("error");
          }
        }
      } catch {
        if (reqId === reqRef.current) setPhase("error");
      }
    },
    [client],
  );

  useEffect(() => {
    if (mounted && connected && account) load(account);
    if (mounted && !connected) {
      reqRef.current++;
      setPhase("idle");
      setData(null);
      setReaper(null);
      setMyMh(null);
      setBoard(null);
      setMhPhase("idle");
      setBoardPhase("idle");
    }
  }, [mounted, connected, account, load]);

  // Souls consumed = Σ soulsConsumed over the souls this wallet HOLDS (task rule:
  // "souls freed" stays pure mints; consumed travels with the token). The mine list
  // (souls with the fire in them) drives the YOUR REAPERS block.
  const mine: MineEntry[] = data ? mineFrom(reaper, data.owned) : [];
  const consumed = mine.reduce((s, e) => s + e.consumed, 0);
  // Total contribution = freed + consumed. Deck tier upgrades instantly (cheap
  // consumed); deck rank/total upgrade to the exact board figures when they land.
  const contribution = (data?.freed ?? 0) + consumed;
  const deckRank = board ? board.myRank : data?.rank ?? 0;
  const deckTotal = board ? board.totalLibs : data?.totalLibs ?? 0;

  const cardStats: CardStats | null =
    data && data.freed > 0
      ? {
          freed: data.freed,
          rank: deckRank,
          total: deckTotal,
          held: data.owned.length,
          tier: tierOf(contribution),
          ...(consumed ? { consumed } : {}),
          ...(myMh ? { mh: myMh.me.mh, rate: myMh.me.rate } : {}),
        }
      : null;

  const onShare = useCallback(async () => {
    if (!cardStats) return;
    setCardBusy(true);
    try {
      const blob = await drawCard(cardStats);
      const file = new File([blob], "cubist-souls.png", { type: "image/png" });
      const text = shareText(cardStats);
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text, title: "Cubist Souls" });
          setCardBusy(false);
          return;
        } catch {}
      }
      downloadBlob(blob, "cubist-souls.png");
      toast("Card downloaded — attach it to your tweet ✨");
      window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    } catch {
      toast("Couldn't make the card — try again.");
    }
    setCardBusy(false);
  }, [cardStats]);

  const onDownload = useCallback(async () => {
    if (!cardStats) return;
    try {
      downloadBlob(await drawCard(cardStats), "cubist-souls.png");
    } catch {
      toast("Couldn't make the card — try again.");
    }
  }, [cardStats]);

  const shareRow = cardStats ? (
    <div className="share-row">
      <button className="btn-share" onClick={onShare} disabled={cardBusy}>
        {cardBusy ? "Making card…" : "Share on X"}
      </button>
      <button className="btn-share ghost" onClick={onDownload}>
        ⤓ Download card
      </button>
    </div>
  ) : null;

  return (
    <>
      <Nav active="souls" />

      {/* Masthead as a single compact row: identity on the left, wallet on the
          right. The lead only shows before you're in — once the deck and the
          panels are on screen, THEY are the page (Adrian, 26-jul). */}
      <header className="ms-top wrap">
        <div className="ms-top-l">
          <div className="eyebrow">Your place in the gallery</div>
          <h1 className="title ms-title">YOUR SOULS</h1>
          {!data ? (
            <p className="lead">
              Every Cubist Soul you freed, and your standing among the community that reclaimed the collection.
            </p>
          ) : null}
        </div>
        <div className="ms-top-r">
          {mounted && !connected && mobileNoInjected ? (
            <button className="btn btn-primary" onClick={() => setSheet(true)}>
              🔥 Connect Wallet
            </button>
          ) : (
            <ConnectButton chainStatus="none" showBalance={false} accountStatus="address" />
          )}
        </div>
      </header>

      <main className="wrap ms-main">
        <MobileWalletSheet
          open={sheet}
          onClose={() => setSheet(false)}
          onWalletConnect={() => openConnectModal?.()}
        />

        {/* ---------- states ---------- */}
        {!mounted || phase === "idle" ? (
          <EmptyState />
        ) : phase === "loading" ? (
          <div className="grid ms-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="skeleton" key={i} />
            ))}
          </div>
        ) : phase === "error" ? (
          <p className="note">Couldn&apos;t reach the chain right now. Try again in a moment.</p>
        ) : data && data.freed === 0 ? (
          <p className="note">
            You haven&apos;t freed a soul yet — <a href="/">burn a Pikkazo</a> and its Cubist Soul comes to this
            wallet.
          </p>
        ) : (
          data && (
            <Dashboard
              data={data}
              shareRow={shareRow}
              address={account ?? ""}
              collab={collab}
              mine={mine}
              consumed={consumed}
              contribution={contribution}
              deckRank={deckRank}
              deckTotal={deckTotal}
              myMh={myMh}
              mhPhase={mhPhase}
              board={board}
              boardPhase={boardPhase}
            />
          )
        )}
      </main>

      <Footer />
    </>
  );
}

/* ---------------- wallet-less empty state (classic) ---------------- */
function EmptyState() {
  return (
    <div className="ms-empty">
      <div className="ms-empty-mark">🖼️</div>
      <p className="ms-empty-lead">Your souls hang here.</p>
      <p className="note" style={{ padding: "8px 0 0" }}>
        Connect your wallet to see the Cubist Souls you&apos;ve freed and your standing among the liberators.
      </p>
    </div>
  );
}


/* ================= dashboard (the control room) =================
   One deck bar on top, then a two-column grid of collapsible panels:
   Museum Hours + Curators' board side by side, standing under the hours,
   and the collection across the full width. Stacked cards wasted the screen
   and buried MH under 346 souls (Adrian, 25-jul).
   ================================================================ */
function Dashboard({
  data,
  shareRow,
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
}: {
  data: SoulsData;
  shareRow: React.ReactNode;
  address: string;
  collab: boolean;
  mine: MineEntry[];
  consumed: number;
  contribution: number;
  deckRank: number;
  deckTotal: number;
  myMh: MyMHResult | null;
  mhPhase: Phase;
  board: MHBoardResult | null;
  boardPhase: Phase;
}) {
  // Tier by TOTAL contribution (freed + consumed) — offerings never cost you rank.
  const tier = tierOf(contribution);
  const earned = myMh ? myMh.achievements.filter((a) => a.state === "earned").length : 0;
  const openSeats = myMh ? myMh.achievements.length : 0;
  const boardTop = board ? Math.min(20, board.rows.filter((r) => !r.gap).length) : 0;

  return (
    <>
      {/* ---- deck: the recognition plaque, laid out as a status bar ---- */}
      <div className="deck">
        <div className="dk-id">
          <div className="dk-tier">Founding Liberator · {tier}</div>
          <div className="dk-headline">
            You freed <b>{data.freed}</b> soul{data.freed === 1 ? "" : "s"}
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
          {REAPER_LIVE ? (
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
        <div className="dk-actions">{shareRow}</div>
      </div>

      {/* ---- YOUR REAPERS — the prominent block, right under the plaque ---- */}
      {REAPER_LIVE ? <MyReapers mine={mine} /> : null}

      <div className="dash">
        <Panel
          id="mh"
          title="🏛 Museum Hours"
          meta={myMh ? `${mhNum(myMh.me.mh)} MH` : mhPhase === "error" ? "unavailable" : "counting…"}
        >
          <MHHero myMh={myMh} mhPhase={mhPhase} heldNone={!data.owned.length} />
        </Panel>

        <Panel
          id="board"
          title="Curators' board"
          meta={board ? `top ${boardTop} of ${board.rows.length}` : boardPhase === "error" ? "unavailable" : "tallying…"}
          tall
        >
          <BoardBody board={board?.rows ?? null} boardPhase={boardPhase} />
        </Panel>

        <Panel id="standing" title="Your standing" meta={myMh ? `${earned} of ${openSeats}` : undefined}>
          {myMh ? (
            <div className="mh-badges">
              {myMh.achievements.map((a, i) => (
                <div
                  className={`ach ${a.state}`}
                  key={i}
                  title={a.state === "locked" ? "The museum keeps its secrets." : a.ds}
                >
                  <div className="ico">{a.ic}</div>
                  <div className="nm">{a.nm}</div>
                  <div className="ds">{a.ds}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mh-status">
              {mhPhase === "error"
                ? "The museum's records are unavailable right now."
                : "The museum is checking your standing…"}
            </p>
          )}
        </Panel>

        <Panel
          id="collection"
          title="Your collection"
          meta={`${data.owned.length} soul${data.owned.length === 1 ? "" : "s"}`}
          wide
        >
          {data.owned.length ? (
            <CollabGrid
              owned={data.owned}
              address={address}
              collabEnabled={collab}
              exhibits={myMh?.exhibits ?? null}
            />
          ) : (
            <p className="mh-status">
              You&apos;ve freed souls but hold none right now — the clock only runs on souls you keep.
            </p>
          )}
        </Panel>
      </div>

      <div className="rewards">
        <h3>You were early</h3>
        <p>
          You reclaimed the collection when it mattered. Founding Liberators won&apos;t be forgotten — more on that
          soon.
        </p>
      </div>
    </>
  );
}

/* ---------------- Museum Hours hero (live counter) ---------------- */
function MHHero({ myMh, mhPhase, heldNone }: { myMh: MyMHResult | null; mhPhase: Phase; heldNone: boolean }) {
  const countRef = useRef<HTMLSpanElement>(null);

  // Live counter: base + rate × hoursElapsed, ticking client-side (rAF), exactly
  // like the vanilla page. Falls back to a 1s interval under reduced-motion.
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

  // Still counting YOUR hours — a distinct LOADING state (not the failure note).
  if (!myMh && (mhPhase === "loading" || mhPhase === "idle")) {
    return (
      <div className="mh-hero" aria-busy="true">
        <div className="cap">Your Museum Hours</div>
        <div className="mh-count">
          <span className="spinner" aria-hidden="true" />
        </div>
        <div className="mh-rate">The museum is counting your hours…</div>
      </div>
    );
  }

  // The cheap pass genuinely failed — only now show the unavailable note.
  if (!myMh) {
    return <p className="mh-status">The museum&apos;s records are unavailable right now. Try again shortly.</p>;
  }

  return (
    <>
      <div className="mh-hero">
        <div className="cap">Your Museum Hours</div>
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
              🜃 Reaper <b>{myMh.me.reaperCount}</b> ×{myMh.me.maxReaperMult.toFixed(1)}
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
          You hold no souls in this wallet right now — the clock only runs on souls you keep.
        </p>
      ) : null}

      <p className="mh-foot">
        The museum records every hour its souls are kept. Preview · their purpose will be revealed.
      </p>
    </>
  );
}

/* ---------------- Curators' board ---------------- */
function BoardBody({ board, boardPhase }: { board: MHBoardRow[] | null; boardPhase: Phase }) {
  if (!board) {
    return (
      <p className="mh-status">
        {boardPhase === "error"
          ? "The full board couldn't load right now — your hours are current."
          : "Tallying the curators' board…"}
      </p>
    );
  }
  return (
    <div className="mh-board">
      {board.map((r, i) =>
        r.gap ? (
          <div key={`g${i}`}>
            <div className="lb-gap">···</div>
            <div className="lb-row me">
              <span className="rk">#{r.rank}</span>
              <span className="addr">{r.addr}</span>
              <span className="mh">{mhNum(r.mh)} MH</span>
            </div>
          </div>
        ) : (
          <div className={`lb-row ${r.isMe ? "me" : ""}`} key={i}>
            <span className="rk">#{r.rank}</span>
            <span className="addr">{r.addr}</span>
            <span className="mh">{mhNum(r.mh)} MH</span>
          </div>
        ),
      )}
    </div>
  );
}
