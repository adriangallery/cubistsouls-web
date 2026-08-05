"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import MobileWalletSheet, { useIsMobileNoInjected } from "../components/MobileWalletSheet";
import Dashboard from "./Dashboard";
import { useHolderData } from "./useHolderData";
import { tierOf } from "@/lib/souls";
import { drawCard, shareText, downloadBlob, type CardStats } from "@/lib/share-card";

// DEV-ONLY read-only harness: ?as=0x… lets us render another wallet's page (no
// signer, reads only) to reproduce/verify. Gated to development so it is inert in
// every deployed build. NOTE: the PUBLIC equivalent of this harness is now the real
// /curator/<address> route — this stays only as a dev convenience on my-souls.
function useDevAs(): string | undefined {
  const [as, setAs] = useState<string | undefined>();
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const v = new URLSearchParams(window.location.search).get("as");
    if (v && /^0x[0-9a-fA-F]{40}$/.test(v)) setAs(v.toLowerCase());
  }, []);
  return as;
}

function toast(msg: string, ms = 6000) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
}

export default function MySouls() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const mobileNoInjected = useIsMobileNoInjected();
  const [sheet, setSheet] = useState(false);
  const devAs = useDevAs();

  // Effective wallet: the connected one, or the dev harness address in dev.
  const account = devAs ?? address;
  const connected = !!devAs || isConnected;

  const [mounted, setMounted] = useState(false);
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

  // ── the shared per-holder load — SAME hook /curator uses (read-only there) ──
  const h = useHolderData(account, mounted && connected && !!account);
  const { phase, data, myMh, mhPhase, board, boardPhase, boardUpdatedAt, mine, consumed, contribution, deckRank, deckTotal, reaperLive } = h;

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
          custodyCount={h.custody?.extra.length ?? 0}
              mode="self"
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
              boardUpdatedAt={boardUpdatedAt}
              reaperLive={reaperLive}
              onTransferred={h.reload}
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
