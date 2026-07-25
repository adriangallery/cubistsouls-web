"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import CollabGrid from "./CollabGrid";
import MobileWalletSheet, { useIsMobileNoInjected } from "../components/MobileWalletSheet";
import { loadSouls, tierOf, type SoulsData } from "@/lib/souls";
import { buildMyMH, buildBoard, type MyMHResult, type MHBoardRow } from "@/lib/mh";
import { drawCard, shareText, downloadBlob, type CardStats } from "@/lib/share-card";

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
  const [myMh, setMyMh] = useState<MyMHResult | null>(null);
  const [mhPhase, setMhPhase] = useState<Phase>("idle"); // your-hours pass (cheap)
  const [board, setBoard] = useState<MHBoardRow[] | null>(null);
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
          // Phase 1 — YOUR hours (cheap; only your souls). Shows in seconds.
          setMhPhase("loading");
          try {
            const my = await buildMyMH(client, acct, d.owned, d.freed, d.acq);
            if (reqId !== reqRef.current) return;
            setMyMh(my);
            setMhPhase("loaded");
            // Phase 2 — the curators' board (heavy: full collection scan). Runs
            // in the background so a slow/failing scan never hides your numbers.
            setBoardPhase("loading");
            buildBoard(client, acct, d.owned, d.freed, my.me.mh)
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
      setMyMh(null);
      setBoard(null);
      setMhPhase("idle");
      setBoardPhase("idle");
    }
  }, [mounted, connected, account, load]);

  const cardStats: CardStats | null =
    data && data.freed > 0
      ? {
          freed: data.freed,
          rank: data.rank,
          total: data.totalLibs,
          held: data.owned.length,
          tier: tierOf(data.freed),
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

      <header className="ms-head wrap">
        <div className="eyebrow">Your place in the gallery</div>
        <h1 className="title ms-title">YOUR SOULS</h1>
        <p className="lead">
          Every Cubist Soul you freed, and your standing among the community that reclaimed the collection.
        </p>
      </header>

      <main className="wrap ms-main">
        <div className="ms-connect">
          {mounted && !connected && mobileNoInjected ? (
            <button className="btn btn-primary" onClick={() => setSheet(true)}>
              🔥 Connect Wallet
            </button>
          ) : (
            <ConnectButton chainStatus="none" showBalance={false} accountStatus="address" />
          )}
        </div>
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
            <>
              {/* Recognition plaque + your collection (classic Your Souls) */}
              <ClassicView data={data} shareRow={shareRow} address={account ?? ""} collab={collab} />
              {/* Museum Hours — public, integrated below the collection */}
              <MHView myMh={myMh} mhPhase={mhPhase} board={board} boardPhase={boardPhase} />
            </>
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

/* ---------------- classic "Your Souls" view ---------------- */
function ClassicView({
  data,
  shareRow,
  address,
  collab,
}: {
  data: SoulsData;
  shareRow: React.ReactNode;
  address: string;
  collab: boolean;
}) {
  const tier = tierOf(data.freed);
  return (
    <>
      <div className="plaque">
        <div className="pl-tier">Founding Liberator · {tier}</div>
        <div className="pl-headline">
          You freed <b>{data.freed}</b> soul{data.freed === 1 ? "" : "s"}
        </div>
        <div className="pl-stats">
          <div className="pl-stat">
            <b>#{data.rank}</b>of {data.totalLibs} liberators
          </div>
          <div className="pl-stat">
            <b>{data.freed}</b>souls freed
          </div>
          <div className="pl-stat">
            <b>{data.owned.length}</b>held now
          </div>
        </div>
        {shareRow}
      </div>

      <div className="section-label">
        Your collection · {data.owned.length} soul{data.owned.length === 1 ? "" : "s"}
      </div>
      {data.owned.length ? (
        <CollabGrid owned={data.owned} address={address} collabEnabled={collab} />
      ) : (
        <p className="note" style={{ padding: "24px 0" }}>
          You&apos;ve freed souls but hold none right now.
        </p>
      )}

      <div className="rewards">
        <h3>You were early</h3>
        <p>
          You reclaimed the collection when it mattered. Founding Liberators won&apos;t be forgotten — more on
          that soon.
        </p>
      </div>
    </>
  );
}

/* ---------------- Museum Hours (public) ---------------- */
function MHHead() {
  return (
    <div className="mh-head">
      <h2 className="mh-title">🏛 Museum Hours</h2>
      <p className="mh-sub">The museum records every hour its souls are kept. Their purpose will be revealed.</p>
      <div className="mh-secret">Preview · the museum keeps its secrets</div>
    </div>
  );
}

function MHView({
  myMh,
  mhPhase,
  board,
  boardPhase,
}: {
  myMh: MyMHResult | null;
  mhPhase: Phase;
  board: MHBoardRow[] | null;
  boardPhase: Phase;
}) {
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
  if (mhPhase === "loading" || (mhPhase === "idle" && !myMh)) {
    return (
      <section className="mh">
        <MHHead />
        <div className="mh-hero" aria-busy="true">
          <div className="cap">Your Museum Hours</div>
          <div className="mh-count">
            <span className="spinner" aria-hidden="true" />
          </div>
          <div className="mh-rate">The museum is counting your hours…</div>
        </div>
      </section>
    );
  }

  // The cheap pass genuinely failed — only now show the unavailable note.
  if (!myMh) {
    return (
      <section className="mh">
        <MHHead />
        <p className="mh-status">The museum&apos;s records are unavailable right now. Try again shortly.</p>
      </section>
    );
  }

  return (
    <section className="mh">
      <MHHead />

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
          <span className="mh-chip">
            Base <b>1.0</b> MH / soul / hr
          </span>
        </div>
      </div>

      <div className="section-label">
        The exhibits · {myMh.ownedCount} soul{myMh.ownedCount === 1 ? "" : "s"}
      </div>
      {myMh.exhibits.length ? (
        <div className="mh-exhibits">
          {myMh.exhibits.map((e) => (
            <div className="exhibit" key={e.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/img?id=${e.id}`} loading="lazy" alt={`Cubist Soul #${e.id}`} />
              <div className="plaque-in">
                <div className="pl-id">Soul #{e.id}</div>
                <div className="pl-rate">+{mhNum(e.rate)} MH / hour</div>
                <div className="seals">
                  <span className="seal cohort">{e.cohortName}</span>
                  {e.raritySeal ? <span className="seal">{e.raritySeal}</span> : null}
                </div>
                {e.rankTxt ? <div className="pl-rank">{e.rankTxt}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mh-status">
          You hold no souls in this wallet right now — the clock only runs on souls you keep.
        </p>
      )}

      {/* ── Curators' board (heavy pass — fills in a moment after the hero) ── */}
      {board ? (
        <>
          <div className="section-label">
            Curators&apos; board · top {Math.min(20, board.filter((r) => !r.gap).length)} of {board.length}
          </div>
          <div className="mh-board">
            {board.map((r, i) =>
              r.gap ? (
                <div key={`g${i}`}>
                  <div className="lb-gap">···</div>
                  <div className={`lb-row me`}>
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
        </>
      ) : (
        <>
          <div className="section-label">Curators&apos; board</div>
          <p className="mh-status">
            {boardPhase === "error"
              ? "The full board couldn't load right now — your hours above are current."
              : "Tallying the curators' board…"}
          </p>
        </>
      )}

      <div className="section-label">Your standing</div>
      <div className="mh-badges">
        {myMh.achievements.map((a, i) => (
          <div className={`ach ${a.state}`} key={i} title={a.state === "locked" ? "The museum keeps its secrets." : a.ds}>
            <div className="ico">{a.ic}</div>
            <div className="nm">{a.nm}</div>
            <div className="ds">{a.ds}</div>
          </div>
        ))}
      </div>

      <p className="mh-status" style={{ paddingTop: 34 }}>
        The museum records every hour. Their purpose will be revealed.
      </p>
    </section>
  );
}
