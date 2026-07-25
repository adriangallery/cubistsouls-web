"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import CollabGrid from "./CollabGrid";
import MobileWalletSheet, { useIsMobileNoInjected } from "../components/MobileWalletSheet";
import { loadSouls, tierOf, type SoulsData } from "@/lib/souls";
import { buildMH, type MHResult } from "@/lib/mh";
import { drawCard, shareText, downloadBlob, type CardStats } from "@/lib/share-card";

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

  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [data, setData] = useState<SoulsData | null>(null);
  const [mh, setMh] = useState<MHResult | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [collab, setCollab] = useState(true); // WTP collab spark; fail-open

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
      setPhase("loading");
      setData(null);
      setMh(null);
      try {
        const d = await loadSouls(client, acct);
        setData(d);
        setPhase("loaded");
        // Museum Hours always computed (public). Failure is non-fatal — the MH
        // section renders its own "records unavailable" note.
        if (d.freed > 0) {
          try {
            const m = await buildMH(client, acct, d.owned, d.freed);
            setMh(m);
          } catch {
            setMh(null);
          }
        }
      } catch {
        setPhase("error");
      }
    },
    [client],
  );

  useEffect(() => {
    if (mounted && isConnected && address) load(address);
    if (mounted && !isConnected) {
      setPhase("idle");
      setData(null);
      setMh(null);
    }
  }, [mounted, isConnected, address, load]);

  const cardStats: CardStats | null =
    data && data.freed > 0
      ? {
          freed: data.freed,
          rank: data.rank,
          total: data.totalLibs,
          held: data.owned.length,
          tier: tierOf(data.freed),
          ...(mh ? { mh: mh.me.mh, rate: mh.me.rate } : {}),
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
          {mounted && !isConnected && mobileNoInjected ? (
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
              <ClassicView data={data} shareRow={shareRow} address={address ?? ""} collab={collab} />
              {/* Museum Hours — public, integrated below the collection */}
              <MHView mh={mh} shareRow={null} />
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

/* ---------------- Museum Hours (?mh=1) ---------------- */
function MHIntro({ connected }: { connected: boolean }) {
  return (
    <section className="mh">
      <div className="mh-head">
        <h2 className="mh-title">🏛 Museum Hours</h2>
        <p className="mh-sub">The museum records every hour its souls are kept. Their purpose will be revealed.</p>
        <div className="mh-secret">Preview · the museum keeps its secrets</div>
      </div>
      {!connected && (
        <p className="mh-status" style={{ paddingTop: 24 }}>
          Connect your wallet to see the hours you&apos;ve kept.
        </p>
      )}
    </section>
  );
}

function MHView({ mh, shareRow }: { mh: MHResult | null; shareRow: React.ReactNode }) {
  const countRef = useRef<HTMLSpanElement>(null);

  // Live counter: base + rate × hoursElapsed, ticking client-side (rAF), exactly
  // like the vanilla page. Falls back to a 1s interval under reduced-motion.
  useEffect(() => {
    if (!mh) return;
    const el = countRef.current;
    if (!el) return;
    const t0 = performance.now();
    const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
    let raf = 0;
    let iv: ReturnType<typeof setInterval> | undefined;
    const frame = () => {
      el.textContent = mhNum(mh.me.mh + mh.me.rate * ((performance.now() - t0) / 3600000));
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    frame();
    if (reduced) iv = setInterval(frame, 1000);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (iv) clearInterval(iv);
    };
  }, [mh]);

  if (!mh) {
    return (
      <section className="mh">
        <MHIntro connected />
        <p className="mh-status">The museum&apos;s records are unavailable right now. Try again shortly.</p>
      </section>
    );
  }

  return (
    <section className="mh">
      <div className="mh-head">
        <h2 className="mh-title">🏛 Museum Hours</h2>
        <p className="mh-sub">The museum records every hour its souls are kept. Their purpose will be revealed.</p>
        <div className="mh-secret">Preview · the museum keeps its secrets</div>
      </div>

      <div className="mh-hero">
        <div className="cap">Your Museum Hours</div>
        <div className="mh-count">
          <span className="v" ref={countRef}>
            {mhNum(mh.me.mh)}
          </span>
          <span className="unit">MH</span>
        </div>
        <div className="mh-rate">+{mhNum(mh.me.rate)} MH / hour</div>
        <div className="mh-mult">
          <span className="mh-chip">
            Souls held <b>{mh.me.heldCount}</b>
          </span>
          <span className="mh-chip">
            Liberator <b>{mh.me.lib.name}</b> ×{mh.me.lib.mult}
          </span>
          <span className="mh-chip">
            Base <b>1.0</b> MH / soul / hr
          </span>
        </div>
        {shareRow}
      </div>

      <div className="section-label">
        The exhibits · {mh.ownedCount} soul{mh.ownedCount === 1 ? "" : "s"}
      </div>
      {mh.exhibits.length ? (
        <div className="mh-exhibits">
          {mh.exhibits.map((e) => (
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

      <div className="section-label">
        Curators&apos; board · top {Math.min(20, mh.board.filter((r) => !r.gap).length)} of{" "}
        {mh.board.length}
      </div>
      <div className="mh-board">
        {mh.board.map((r, i) =>
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

      <div className="section-label">Your standing</div>
      <div className="mh-badges">
        {mh.achievements.map((a, i) => (
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
