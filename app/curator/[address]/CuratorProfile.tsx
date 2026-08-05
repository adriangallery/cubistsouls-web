"use client";

import { useCallback, useMemo, useState } from "react";
import { useEnsAddress, useEnsName } from "wagmi";
import { mainnet } from "wagmi/chains";
import { normalize } from "viem/ens";
import Nav from "../../components/Nav";
import Footer from "../../components/Footer";
import Dashboard from "../../my-souls/Dashboard";
import { useHolderData } from "../../my-souls/useHolderData";

const HEX = /^0x[0-9a-fA-F]{40}$/;
const short = (w: string) => (w && w.length >= 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w || "—");
const shortDate = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function toast(msg: string, ms = 4000) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
}

// PUBLIC read-only holder profile — an OpenSea-style "curator" page. Reuses the very
// same useHolderData + Dashboard as /my-souls, minus every wallet action (no share
// card, no WTP spark, no connect). `param` is the raw route segment: a 0x address or
// an ENS name we resolve client-side (cheap, one call on mainnet).
export default function CuratorProfile({ param }: { param: string }) {
  const isHex = HEX.test(param);

  // ENS name → address (only when the param isn't already a hex address).
  const ensName = useMemo(() => {
    if (isHex) return undefined;
    try {
      return normalize(param);
    } catch {
      return undefined;
    }
  }, [isHex, param]);
  const { data: resolvedAddr, isLoading: ensLoading } = useEnsAddress({
    name: ensName,
    chainId: mainnet.id,
    query: { enabled: !isHex && !!ensName },
  });

  const target = isHex ? param.toLowerCase() : resolvedAddr?.toLowerCase();

  // Reverse ENS for the header identity (cheap; only when we have a hex target and
  // the visitor didn't already arrive via an ENS name).
  const { data: reverseName } = useEnsName({
    address: (isHex ? (param as `0x${string}`) : undefined),
    chainId: mainnet.id,
    query: { enabled: isHex },
  });

  const h = useHolderData(target, !!target);
  const { phase, data, myMh, mhPhase, board, boardPhase, boardUpdatedAt, mine, consumed, contribution, deckRank, deckTotal, tier, reaperLive } = h;

  const onShare = useCallback(async () => {
    const url = typeof window !== "undefined" ? window.location.href : `https://cubistsouls.com/curator/${param}`;
    const title = `Curator ${ensName ?? short(target ?? param)} — Cubist Souls`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Profile link copied ✨");
    } catch {
      toast(url);
    }
  }, [param, ensName, target]);

  const identity = ensName ?? reverseName ?? short(target ?? param);
  const memberSince = myMh?.memberSince ?? null;

  // ── ENS that never resolved → branded "no such curator" ──
  if (!isHex && !ensLoading && !target) {
    return (
      <Shell>
        <div className="ms-empty">
          <div className="ms-empty-mark">🕯️</div>
          <p className="ms-empty-lead">No curator here.</p>
          <p className="note" style={{ padding: "8px 0 0" }}>
            <code>{param}</code> doesn&apos;t resolve to a wallet. Wander <a href="/gallery">The Freed</a> instead.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* ---------- identity header ---------- */}
      <header className="ms-top wrap curator-top">
        <div className="ms-top-l">
          <div className="eyebrow">Curator profile</div>
          <h1 className="title ms-title cur-name" title={target ?? param}>{identity}</h1>
          <div className="cur-sub">
            {data ? (
              <>
                <span className="cur-tier">{tier}</span>
                {memberSince ? <span className="cur-since"> · member since {shortDate(memberSince.ts)}</span> : null}
                {target ? (
                  <a
                    className="cur-scan"
                    href={`https://etherscan.io/address/${target}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {" "}· {short(target)} ↗
                  </a>
                ) : null}
              </>
            ) : (
              <span className="cur-since">Reading the museum&apos;s records…</span>
            )}
          </div>
        </div>
        <div className="ms-top-r">
          <button className="btn btn-primary" onClick={onShare}>
            ↗ Share profile
          </button>
        </div>
      </header>

      <main className="wrap ms-main">
        {phase === "idle" || phase === "loading" || (!isHex && ensLoading) ? (
          <div className="grid ms-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="skeleton" key={i} />
            ))}
          </div>
        ) : phase === "error" ? (
          <p className="note">Couldn&apos;t reach the chain right now. Try again in a moment.</p>
        ) : data && (data.freed > 0 || data.owned.length > 0) ? (
          <Dashboard
          custodyCount={h.custody?.extra.length ?? 0}
            mode="public"
            data={data}
            address={target ?? ""}
            collab={false}
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
          />
        ) : (
          <div className="ms-empty">
            <div className="ms-empty-mark">🖼️</div>
            <p className="ms-empty-lead">An empty wing.</p>
            <p className="note" style={{ padding: "8px 0 0" }}>
              This wallet hasn&apos;t freed or kept any Cubist Souls. Wander <a href="/gallery">The Freed</a> to see what&apos;s hung.
            </p>
          </div>
        )}
      </main>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      {children}
      <Footer />
    </>
  );
}
