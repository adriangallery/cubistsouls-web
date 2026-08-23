"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { mainnet } from "wagmi/chains";
import MobileWalletSheet, { useIsMobileNoInjected } from "./MobileWalletSheet";
import {
  loadPikkazos,
  approvalsNeeded,
  getPriceNow,
  PIKKAZO,
  PIKKAZO_ABI,
  SOULS,
  SOULS_ABI,
  MAX_PER_TX,
  APPROVE_ALL_AT,
  type PikkazoData,
} from "@/lib/pikkazo";

const OPENSEA_COLLECTION = "https://opensea.io/collection/cubist-souls";
const IMG = (id: number) => `/api/img?id=${id}`;

// HTML-capable toast (etherscan / opensea links). Content is fully controlled.
function toast(html: string, ms = 7000) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = html;
  document.body.appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
}

function fmtEth(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

type Phase = "idle" | "loading" | "loaded" | "error";
type ApprovalPrompt = { count: number; resolve: (mode: "all" | "each" | null) => void };

export default function BurnFlow({ priceWei }: { priceWei: string }) {
  const { openConnectModal } = useConnectModal();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: 1 });
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [data, setData] = useState<PikkazoData | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [freedNow, setFreedNow] = useState<Set<number>>(new Set());
  const [price, setPrice] = useState<bigint>(() => {
    try { return BigInt(priceWei || "0"); } catch { return 0n; }
  });
  const [busy, setBusy] = useState(false);
  const [burnLabel, setBurnLabel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<ApprovalPrompt | null>(null);
  const [sheet, setSheet] = useState(false);
  const mobileNoInjected = useIsMobileNoInjected();

  useEffect(() => setMounted(true), []);

  const load = useCallback(
    async (acct: string) => {
      if (!publicClient) return;
      setPhase("loading");
      setData(null);
      setSelected(new Set());
      setFreedNow(new Set());
      try {
        const d = await loadPikkazos(publicClient, acct);
        setData(d);
        setPhase("loaded");
      } catch {
        setPhase("error");
      }
    },
    [publicClient],
  );

  useEffect(() => {
    if (mounted && isConnected && address) load(address);
    if (mounted && !isConnected) {
      setPhase("idle");
      setData(null);
      setSelected(new Set());
      setFreedNow(new Set());
    }
  }, [mounted, isConnected, address, load]);

  // Keep the dock cost fresh-ish while browsing (not the tx price — that's read
  // again right before signing). Silent on failure; the server value stands in.
  useEffect(() => {
    if (!mounted || !isConnected || !publicClient) return;
    getPriceNow(publicClient).then(setPrice).catch(() => {});
  }, [mounted, isConnected, publicClient]);

  // Live, selectable canvases (still owned, minus the ones freed this session).
  const ownedNow = useMemo(
    () => (data ? data.owned.filter((id) => !freedNow.has(id)) : []),
    [data, freedNow],
  );
  // Graveyard: past burns + this-session burns, all shown greyed.
  const graveyard = useMemo(() => {
    if (!data) return [] as { id: number; freed: boolean }[];
    const past = data.burned.map((id) => ({ id, freed: data.freed.has(id) }));
    const now = [...freedNow].map((id) => ({ id, freed: true }));
    return [...now, ...past].sort((a, b) => a.id - b.id);
  }, [data, freedNow]);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setSelected(new Set(ownedNow)), [ownedNow]);
  const clearSel = useCallback(() => setSelected(new Set()), []);

  // Only shown for large batches: let the holder pick trust vs speed.
  const askApprovalMode = useCallback(
    (count: number) => new Promise<"all" | "each" | null>((resolve) => setPrompt({ count, resolve })),
    [],
  );
  const resolvePrompt = useCallback(
    (mode: "all" | "each" | null) => {
      setPrompt((p) => {
        p?.resolve(mode);
        return null;
      });
    },
    [],
  );

  const ensureMainnet = useCallback(async () => {
    if (chainId === mainnet.id) return true;
    try {
      await switchChainAsync({ chainId: mainnet.id });
      return true;
    } catch {
      toast("Please switch your wallet to Ethereum mainnet.");
      return false;
    }
  }, [chainId, switchChainAsync]);

  const burn = useCallback(async () => {
    const ids = [...selected].sort((a, b) => a - b);
    if (!ids.length || !walletClient || !publicClient || !address) return;
    if (!(await ensureMainnet())) return;

    setBusy(true);
    try {
      // --- Approvals --- (empty if approved-for-all; skips already-approved pieces)
      const need = await approvalsNeeded(publicClient, address, ids);
      if (need.length) {
        let mode: "all" | "each" | null = "each";
        if (need.length >= APPROVE_ALL_AT) {
          mode = await askApprovalMode(need.length);
          if (mode === null) { setBusy(false); setBurnLabel(null); return; }
        }
        if (mode === "all") {
          setBurnLabel("Approve all in wallet…");
          toast("One signature so the Souls contract can burn the pieces you select. You can revoke it any time.", 0);
          const h = await walletClient.writeContract({
            address: PIKKAZO, abi: PIKKAZO_ABI, functionName: "setApprovalForAll", args: [SOULS, true],
          });
          await publicClient.waitForTransactionReceipt({ hash: h });
        } else {
          for (let i = 0; i < need.length; i++) {
            setBurnLabel(need.length === 1 ? "Approve in wallet…" : `Approve ${i + 1}/${need.length}…`);
            toast(`Approving only the pieces you selected — never your whole collection.${need.length > 1 ? ` (${i + 1}/${need.length})` : ""}`, 0);
            const h = await walletClient.writeContract({
              address: PIKKAZO, abi: PIKKAZO_ABI, functionName: "approve", args: [SOULS, BigInt(need[i])],
            });
            await publicClient.waitForTransactionReceipt({ hash: h });
          }
        }
      }

      // --- Burn --- price read FRESH now (a tier boundary may have just passed).
      let p = price;
      try { p = await getPriceNow(publicClient); setPrice(p); } catch {}

      const chunks: number[][] = [];
      for (let i = 0; i < ids.length; i += MAX_PER_TX) chunks.push(ids.slice(i, i + MAX_PER_TX));
      let lastHash: `0x${string}` | undefined;

      for (let c = 0; c < chunks.length; c++) {
        const part = chunks[c];
        const value = p * BigInt(part.length);
        setBurnLabel(chunks.length > 1 ? `Confirm burn ${c + 1}/${chunks.length}…` : "Confirm in wallet…");
        const h = await walletClient.writeContract({
          address: SOULS, abi: SOULS_ABI, functionName: "convert",
          args: [part.map((n) => BigInt(n))], value,
        });
        lastHash = h;
        setBurnLabel(chunks.length > 1 ? `Burning ${c + 1}/${chunks.length}…` : "Burning…");
        toast(`🔥 Burning ${part.length} canvas${part.length > 1 ? "es" : ""}${value > 0n ? ` · Ξ${fmtEth(value)}` : ""}${chunks.length > 1 ? ` (batch ${c + 1}/${chunks.length})` : ""} — <a href="https://etherscan.io/tx/${h}" target="_blank" rel="noopener">Etherscan</a>`, 0);
        await publicClient.waitForTransactionReceipt({ hash: h });
        // move these to the graveyard as freed, drop from selection
        setFreedNow((prev) => { const n = new Set(prev); part.forEach((id) => n.add(id)); return n; });
        setSelected((prev) => { const n = new Set(prev); part.forEach((id) => n.delete(id)); return n; });
      }

      const one = ids.length === 1;
      const soulsUrl = one ? `https://opensea.io/item/ethereum/${SOULS}/${ids[0]}` : OPENSEA_COLLECTION;
      const soulsLink = `<a href="${soulsUrl}" target="_blank" rel="noopener">${one ? "See your Cubist Soul on OpenSea" : "See the Cubist Souls collection"}</a>`;
      const shareText = one
        ? `I burned Pikkazo #${ids[0]} and freed its Cubist Soul 🔥 Same number, art recovered.`
        : `I burned ${ids.length} Pikkazos and freed their Cubist Souls 🔥 Same numbers, art recovered.`;
      const shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(soulsUrl)}`;
      toast(
        `☠️ ${one ? `The canvas is ash — <b>Cubist Soul #${ids[0]}</b> is yours` : `${ids.length} canvases are ash — their <b>Cubist Souls</b> are yours`}. ` +
          soulsLink +
          ` · <a href="${shareUrl}" target="_blank" rel="noopener">Share on X</a>` +
          (lastHash ? ` · <a href="https://etherscan.io/tx/${lastHash}" target="_blank" rel="noopener">Proof</a>` : ""),
        0,
      );
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Transaction failed";
      toast(/reject|denied|user rejected/i.test(msg) ? "Chickened out. The art lives." : `Failed: ${msg}`);
    } finally {
      setBusy(false);
      setBurnLabel(null);
    }
  }, [selected, walletClient, publicClient, address, price, ensureMainnet, askApprovalMode]);

  const connected = mounted && isConnected;

  const startConnect = () => {
    // On a phone with no injected wallet, prefer the dapp-browser sheet — the
    // RainbowKit deep-link handoff to MetaMask hangs on iOS (Adrian's report).
    if (mobileNoInjected) setSheet(true);
    else openConnectModal?.();
  };

  // ---------- DISCONNECTED: the home CTA ----------
  if (!connected) {
    return (
      <>
        <div className="cta">
          <button className="btn btn-primary" onClick={startConnect}>
            🔥 Light the fire — free your Pikkazo
          </button>
          <a className="btn btn-secondary" href={OPENSEA_COLLECTION} target="_blank" rel="noopener noreferrer">
            View on OpenSea
          </a>
        </div>
        <p className="cta-note">Ethereum mainnet · connect to see your Pikkazos</p>
        <MobileWalletSheet
          open={sheet}
          onClose={() => setSheet(false)}
          onWalletConnect={() => openConnectModal?.()}
        />
      </>
    );
  }

  // ---------- CONNECTED: your Pikkazos, right here ----------
  const n = selected.size;
  const txs = Math.ceil(n / MAX_PER_TX);
  const ids = [...selected].sort((a, b) => a - b);
  const cost = price === 0n ? "Free" : `Ξ${fmtEth(price * BigInt(n))}`;
  const burnText = burnLabel ?? (n === 1 ? "🔥 Burn it" : `🔥 Burn ${n}`) + (n ? ` · ${cost}` : "");

  return (
    <>
      <div className="burn-account">
        <ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />
        {phase === "loaded" && data && (
          <span className="burn-pill">
            <span className="dot" /> <b>{ownedNow.length}</b> Pikkazo{ownedNow.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {phase === "loading" && (
        <div className="grid burn-grid" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <div className="skeleton" key={i} />
          ))}
        </div>
      )}

      {phase === "error" && (
        <p className="note">Couldn&apos;t read the chain right now. Try again in a moment.</p>
      )}

      {phase === "loaded" && data && ownedNow.length === 0 && graveyard.length === 0 && (
        <p className="note">
          No Pikkazos in this wallet — nothing to free.{" "}
          <a href={OPENSEA_COLLECTION} target="_blank" rel="noopener noreferrer">Go find some cubism first.</a>
        </p>
      )}

      {phase === "loaded" && data && (ownedNow.length > 0 || graveyard.length > 0) && (
        <>
          {ownedNow.length > 0 && (
            <div className="burn-tools">
              <button className="btn-ghost" onClick={selectAll}>Select all</button>
              <button className="btn-ghost" onClick={clearSel}>Clear</button>
            </div>
          )}
          <div className="grid burn-grid">
            {ownedNow.map((id, i) => {
              const sel = selected.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`pkz-card${sel ? " sel" : ""}`}
                  aria-pressed={sel}
                  onClick={() => toggle(id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={IMG(id)} loading={i < 18 ? "eager" : "lazy"} alt={`Pikkazo #${id}`} />
                  <span className="pkz-tag">#{id}</span>
                </button>
              );
            })}
            {graveyard.map(({ id, freed }) => (
              <div key={`g${id}`} className="pkz-card gone" aria-disabled>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={IMG(id)} loading="lazy" alt={`Pikkazo #${id}`} />
                <span className="pkz-tag">#{id} · {freed ? "soul freed" : "ashes"}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* fixed burn dock */}
      {n > 0 && (
        <div className="burn-dock up">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={IMG(ids[ids.length - 1])} alt="" />
          <div className="bd-meta">
            <b>{n === 1 ? `Pikkazo #${ids[0]}` : `${n} canvases selected`}</b>
            <span>
              {n === 1
                ? "Ready for the flames"
                : `#${ids.slice(0, 3).join(", #")}${n > 3 ? "…" : ""}${txs > 1 ? ` · ${txs} burn txs` : ""}`}
            </span>
          </div>
          <button className="btn-burn" onClick={burn} disabled={busy}>
            {burnText}
          </button>
        </div>
      )}

      {/* approve-mode modal (only for large batches) */}
      {prompt && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) resolvePrompt(null); }}>
          <div className="approve-modal" role="dialog" aria-modal="true">
            <h3>Approve {prompt.count} pieces to burn</h3>
            <p>That&apos;s a big batch. Approving each piece one by one means {prompt.count} separate wallet signatures. Your call:</p>
            <button className="m-all" onClick={() => resolvePrompt("all")}>
              ⚡ Approve all in one signature
              <span>Easiest for large holders — one tx lets the Souls contract burn the pieces you selected</span>
            </button>
            <button className="m-each" onClick={() => resolvePrompt("each")}>
              🔒 Approve each piece
              <span>Most cautious — {prompt.count} signatures, only the exact pieces you picked</span>
            </button>
            <button className="m-cancel" onClick={() => resolvePrompt(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
