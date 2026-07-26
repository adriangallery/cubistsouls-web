"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { mainnet } from "wagmi/chains";
import MobileWalletSheet, { useIsMobileNoInjected } from "../components/MobileWalletSheet";
import { loadSouls } from "@/lib/souls";
import { loadPikkazos, approvalsNeeded, PIKKAZO_ABI } from "@/lib/pikkazo";
import {
  REAPER_MARKS,
  REAPER_ABI,
  SOULS,
  PIKKAZO,
  ASCEND_AT,
  T,
  rankName,
  loadRarity,
  rarityOf,
  suggestLeastRare,
  loadLayerData,
  baseLayersOf,
  composeFromBase,
  getReaperState,
  getMarkPrices,
  type Rarity,
  type LayerData,
  type Slot,
  type ReaperState,
} from "@/lib/reaper";
import styles from "./reapers.module.css";

// THE RITE — the real Soul Reapers panel, GATED by the `reaperLive` flag.
//
//   live=false (preview, default): try before the fire — pick an aspirant, combine
//     marks, and watch the vector engine rebuild the soul with the marks
//     substituting layers. The Pikkazo offering grid runs on DEMO ids so the
//     manual-selection + auto-suggest UX is fully exercised; the CTA is disabled.
//
//   live=true (facet on-chain): the carousel is YOUR owned souls (with their real
//     soulsConsumed/marks), the offering grid is YOUR real Pikkazos, and the CTA
//     runs approvals + forgeMark()/offer() against the diamond.
//
// The ENTIRE real logic is written here; the flag only swaps the data source.

const IMG = (id: number) => `https://cubistsouls.vercel.app/api/img?id=${id}`;

// HTML-capable toast (etherscan links). Content is fully controlled.
function toast(html: string, ms = 7000) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = html;
  document.body.appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
}

// ---- preview aspirants (hardcoded to the official vector set) ----------------
type BaseMap = Partial<Record<Slot, string>>;
const PREVIEW_ASPIRANTS: { id: number; name: string; base: BaseMap }[] = [
  { id: 136, name: "№0136", base: { ab: `${T}/art-background/emerald-tiles.svg`, base: `${T}/base/sun-burn.svg`, clothes: `${T}/clothes/white-hoodie.svg`, head: `${T}/head/punk-never-die.svg`, mouth: `${T}/mouth/diva.svg`, leye: `${T}/left-eye/colony.svg`, nose: `${T}/nose/amethyst-block.svg`, reye: `${T}/right-eye/gaze.svg` } },
  { id: 42, name: "№0042", base: { ab: `${T}/art-background/snow-tiles.svg`, base: `${T}/base/childs-play.svg`, clothes: `${T}/clothes/polo-spike.svg`, head: `${T}/head/punk-never-die.svg`, mouth: `${T}/mouth/not-speak.svg`, leye: `${T}/left-eye/so-lame.svg`, nose: `${T}/nose/pinocchio.svg`, reye: `${T}/right-eye/cynical.svg` } },
  { id: 777, name: "№0777", base: { ab: `${T}/art-background/snow-tiles.svg`, base: `${T}/base/glow-stone.svg`, clothes: `${T}/clothes/greek-gods.svg`, head: `${T}/head/red-flat-cap.svg`, mouth: `${T}/mouth/sheriff-on-duty.svg`, leye: `${T}/left-eye/danger-sign.svg`, nose: `${T}/nose/pinocchio.svg`, reye: `${T}/right-eye/smakeman.svg` } },
  { id: 314, name: "№0314", base: { ab: `${T}/art-background/star-brown.svg`, base: `${T}/base/soft-cloud.svg`, clothes: `${T}/clothes/greek-gods.svg`, head: `${T}/head/beanie-thug.svg`, mouth: `${T}/mouth/sheriff-on-duty.svg`, leye: `${T}/left-eye/kinda-blue.svg`, nose: `${T}/nose/thunderstorm.svg`, reye: `${T}/right-eye/emergency-exit.svg` } },
];
// a demo wallet of Pikkazos for the preview offering grid (rarity is real via rarity.json)
const DEMO_PIKKAZOS = [7, 42, 88, 136, 210, 271, 314, 420, 512, 636, 777, 900, 1024, 1150, 1337, 1500, 1808, 2020, 2222, 2600, 3003, 4200, 6400, 8000];

type Aspirant = { id: number; name: string; base: BaseMap; state?: ReaperState };

export default function RiteMock({ live = false }: { live?: boolean }) {
  // Secret pre-launch override: ?reaper=1 enables the live panel on prod while
  // flags.reaperLive stays false for everyone else (same pattern as the old
  // ?mh=1 gate). REMOVE at public launch, when the flag flips to true. The
  // on-chain facet stays paused, so this exposes UI only — no rite can run
  // until unpause; and only a soul's owner can forge anyway.
  const [urlOverride, setUrlOverride] = useState(false);
  useEffect(() => {
    setUrlOverride(new URLSearchParams(window.location.search).get("reaper") === "1");
  }, []);
  live = live || urlOverride;
  const { openConnectModal } = useConnectModal();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const mobileNoInjected = useIsMobileNoInjected();

  const [mounted, setMounted] = useState(false);
  const [sheet, setSheet] = useState(false);

  // shared data
  const [rarity, setRarity] = useState<Rarity | null>(null);
  const [layerData, setLayerData] = useState<LayerData | null>(null);
  const [prices, setPrices] = useState<Record<number, number> | null>(null);

  // live wallet data
  const [phase, setPhase] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [ownedSouls, setOwnedSouls] = useState<number[]>([]);
  const [ownedPikkazos, setOwnedPikkazos] = useState<number[]>([]);
  const [states, setStates] = useState<Map<number, ReaperState>>(new Map());

  // rite selection
  const [aspirantId, setAspirantId] = useState<number>(136);
  const [worn, setWorn] = useState<Set<string>>(() => new Set(["crown"]));
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  // rarity + layer engine (both modes; layers drive the vector try-on / the live art)
  useEffect(() => {
    loadRarity().then(setRarity).catch(() => {});
    loadLayerData().then(setLayerData).catch(() => {});
  }, []);

  // live: read the current mark prices from the facet (fallback to ratified defaults)
  useEffect(() => {
    if (!live || !mounted || !publicClient) return;
    getMarkPrices(publicClient).then(setPrices).catch(() => {});
  }, [live, mounted, publicClient]);

  const costOf = useCallback(
    (markId: number, fallback: number) => (live && prices ? prices[markId] ?? fallback : fallback),
    [live, prices],
  );

  // live: load the connected wallet's souls + pikkazos + reaper states
  const loadWallet = useCallback(
    async (acct: string) => {
      if (!publicClient) return;
      setPhase("loading");
      try {
        const [souls, pk] = await Promise.all([loadSouls(publicClient, acct), loadPikkazos(publicClient, acct)]);
        setOwnedSouls(souls.owned);
        setOwnedPikkazos(pk.owned);
        setStates(souls.owned.length ? await getReaperState(publicClient, souls.owned) : new Map());
        if (souls.owned.length) setAspirantId((cur) => (souls.owned.includes(cur) ? cur : souls.owned[0]));
        setPhase("loaded");
      } catch {
        setPhase("error");
      }
    },
    [publicClient],
  );

  useEffect(() => {
    if (!live || !mounted) return;
    if (isConnected && address) loadWallet(address);
    else {
      setPhase("idle");
      setOwnedSouls([]);
      setOwnedPikkazos([]);
      setStates(new Map());
    }
  }, [live, mounted, isConnected, address, loadWallet]);

  // ---- aspirants (preview: hardcoded · live: owned souls composed from traits) ----
  const aspirants: Aspirant[] = useMemo(() => {
    if (!live) return PREVIEW_ASPIRANTS;
    return ownedSouls.map((id) => ({
      id,
      name: `№${String(id).padStart(4, "0")}`,
      base: layerData ? baseLayersOf(id, layerData) : {},
      state: states.get(id),
    }));
  }, [live, ownedSouls, layerData, states]);

  const aspirant = aspirants.find((a) => a.id === aspirantId) ?? aspirants[0];

  // worn marks + the pikkazos each will consume (live cost overrides)
  const wornMarks = useMemo(
    () => REAPER_MARKS.filter((m) => worn.has(m.id)).map((m) => ({ ...m, cost: costOf(m.markId, m.cost) })),
    [worn, costOf],
  );
  const required = wornMarks.reduce((s, m) => s + m.cost, 0);

  // existing consumption of the picked soul (live) — the rite ADDS to it
  const already = live ? aspirant?.state?.consumed ?? 0 : 0;
  const consumedAfter = already + required;
  const ascended = consumedAfter >= ASCEND_AT;
  const pct = Math.min(100, (consumedAfter / ASCEND_AT) * 100);
  const displayName = ascended ? "Soul Reaper" : "Cubist Soul";
  const mhBonus = wornMarks.reduce((s, m) => s + m.mh, 0);
  const mult = wornMarks.reduce((mx, m) => Math.max(mx, m.mult), 0);

  // the offering wallet (preview demo · live real)
  const wallet = live ? ownedPikkazos : DEMO_PIKKAZOS;

  // auto-suggest the N least-rare Pikkazos whenever the requirement or wallet
  // changes — UNLESS the curator has taken manual control of the selection.
  useEffect(() => {
    if (manual) return;
    setChosen(new Set(suggestLeastRare(wallet, required, rarity)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, rarity, wallet.join(","), manual]);

  const toggleMark = (id: string) =>
    setWorn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const togglePikkazo = (id: number) => {
    setManual(true);
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const resetSuggestion = () => {
    setManual(false);
    setChosen(new Set(suggestLeastRare(wallet, required, rarity)));
  };

  // preview: compose from the hardcoded base map · live: from traits index
  const stack = useMemo(
    () => composeFromBase(aspirant?.base ?? {}, [...worn]),
    [aspirant, worn],
  );

  const chosenIds = useMemo(() => [...chosen].sort((a, b) => a - b), [chosen]);
  const rareChosen = chosenIds.filter((id) => rarityOf(id, rarity).rare).length;
  const countOk = chosenIds.length === required && required > 0;

  // ---------------------------------------------------------------- the tx flow
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

  const performRite = useCallback(async () => {
    if (!live || !walletClient || !publicClient || !address) return;
    if (!aspirant) return;
    const ids = chosenIds;
    if (!ids.length) return;
    if (worn.size > 0 && ids.length !== required) {
      toast(`Select exactly ${required} Pikkazos for the chosen marks.`);
      return;
    }
    if (!(await ensureMainnet())) return;

    setBusy(true);
    try {
      // --- approvals: the diamond must be allowed to burn the offered Pikkazos ---
      const need = await approvalsNeeded(publicClient, address, ids);
      if (need.length) {
        if (need.length >= 6) {
          setBusyLabel("Approve all in wallet…");
          toast("One signature so the fire can consume the pieces you offer. Revocable any time.", 0);
          const h = await walletClient.writeContract({
            address: PIKKAZO, abi: PIKKAZO_ABI, functionName: "setApprovalForAll", args: [SOULS, true],
          });
          await publicClient.waitForTransactionReceipt({ hash: h });
        } else {
          for (let i = 0; i < need.length; i++) {
            setBusyLabel(need.length === 1 ? "Approve in wallet…" : `Approve ${i + 1}/${need.length}…`);
            const h = await walletClient.writeContract({
              address: PIKKAZO, abi: PIKKAZO_ABI, functionName: "approve", args: [SOULS, BigInt(need[i])],
            });
            await publicClient.waitForTransactionReceipt({ hash: h });
          }
        }
      }

      const reaperId = BigInt(aspirant.id);
      let lastHash: `0x${string}` | undefined;

      if (worn.size === 0) {
        // pure offering — consume souls without forging a mark
        setBusyLabel("Confirm offering…");
        lastHash = await walletClient.writeContract({
          address: SOULS, abi: REAPER_ABI, functionName: "offer",
          args: [reaperId, ids.map((n) => BigInt(n))],
        });
        await publicClient.waitForTransactionReceipt({ hash: lastHash });
      } else {
        // forge one mark per worn mark, partitioning the offered ids by mark cost
        const marks = wornMarks.slice().sort((a, b) => a.markId - b.markId);
        let cursor = 0;
        for (let i = 0; i < marks.length; i++) {
          const m = marks[i];
          const part = ids.slice(cursor, cursor + m.cost);
          cursor += m.cost;
          setBusyLabel(marks.length > 1 ? `Forge ${m.name} (${i + 1}/${marks.length})…` : `Forge ${m.name}…`);
          const h = await walletClient.writeContract({
            address: SOULS, abi: REAPER_ABI, functionName: "forgeMark",
            args: [reaperId, m.markId, part.map((n) => BigInt(n))],
          });
          lastHash = h;
          await publicClient.waitForTransactionReceipt({ hash: h });
        }
      }

      toast(
        `🜃 The fire is fed — <b>${ascended ? "Soul Reaper" : "Cubist Soul"} #${aspirant.id}</b> consumed ${ids.length} souls.` +
          (lastHash ? ` <a href="https://etherscan.io/tx/${lastHash}" target="_blank" rel="noopener">Etherscan</a>` : ""),
        0,
      );
      // refresh state
      setManual(false);
      setChosen(new Set());
      await loadWallet(address);
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Transaction failed";
      toast(/reject|denied|user rejected/i.test(msg) ? "Stepped back from the fire." : `Failed: ${msg}`);
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }, [live, walletClient, publicClient, address, aspirant, chosenIds, worn, required, wornMarks, ensureMainnet, ascended, loadWallet]);

  const startConnect = () => {
    if (mobileNoInjected) setSheet(true);
    else openConnectModal?.();
  };

  // ---------------------------------------------------------------- gated states
  const connected = mounted && isConnected;

  // LIVE + not connected → connect prompt (the rite reads YOUR souls)
  if (live && !connected) {
    return (
      <div className="rite">
        <div className={styles.connect}>
          <p className={styles.connectLead}>The rite reads the souls you already hold. Connect to begin.</p>
          <button className="btn btn-primary" onClick={startConnect}>🜃 Enter the order</button>
          <p className="cta-note">Ethereum mainnet · connect to see your souls &amp; Pikkazos</p>
        </div>
        <MobileWalletSheet open={sheet} onClose={() => setSheet(false)} onWalletConnect={() => openConnectModal?.()} />
      </div>
    );
  }

  // LIVE + connected but no souls
  if (live && connected && phase === "loaded" && ownedSouls.length === 0) {
    return (
      <div className="rite">
        <p className="note" style={{ textAlign: "center" }}>
          No Cubist Souls in this wallet — free one first, then return to take up the scythe.{" "}
          <a href="/" >Free a soul</a>
        </p>
      </div>
    );
  }

  return (
    <div className="rite">
      {live && phase === "loading" && (
        <div className={styles.loadingRow}><span className="dot" /> Reading your souls from the chain…</div>
      )}

      {/* STEP 1 — pick the aspirant soul */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">1</span>{live ? "Pick your aspirant — one of your souls" : "Pick your aspirant"}</div>
        <div className="aspirants">
          {aspirants.map((a) => {
            const st = a.state;
            return (
              <button
                key={a.id}
                className={`aspirant${aspirantId === a.id ? " sel" : ""}`}
                onClick={() => setAspirantId(a.id)}
                aria-pressed={aspirantId === a.id}
                aria-label={`Aspirant ${a.name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={IMG(a.id)} alt={`Cubist Soul ${a.name}`} loading="lazy" />
                <span className="tag">{a.name}</span>
                {st && st.consumed > 0 ? <span className={styles.aspBadge}>🔥{st.consumed}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 2 — combine marks */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">2</span>Choose marks — combine any</div>
        <div className="rtraits">
          {REAPER_MARKS.map((t) => {
            const on = worn.has(t.id);
            const cost = costOf(t.markId, t.cost);
            return (
              <button
                key={t.id}
                className={`rtrait${on ? " sel" : ""}`}
                onClick={() => toggleMark(t.id)}
                aria-pressed={on}
                aria-label={`${t.name} — ${cost} Pikkazos`}
              >
                <span className="rt-price">{cost} 🔥</span>
                {on && <span className="rt-on">✓</span>}
                <span className="rt-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.file} alt={t.name} loading="lazy" />
                </span>
                <span className="rt-body">
                  <span className="rt-name"><b>{t.name}</b></span>
                  <span className="rt-kind">{t.kind}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 3 — offer Pikkazos (manual selection + auto-suggest) */}
      <div className="rite-step">
        <div className="rite-lab">
          <span className="n">3</span>
          Offer {required} Pikkazo{required === 1 ? "" : "s"} to the fire
        </div>

        {required === 0 ? (
          <p className={styles.offerEmpty}>Choose a mark above — the fire needs canvases to consume.</p>
        ) : (
          <>
            <div className={styles.offerHead}>
              <div className={styles.offerCount}>
                <b className={countOk ? styles.ok : styles.bad}>{chosenIds.length}</b> / {required} selected
                {!live && <span className={styles.demoTag}>demo wallet</span>}
              </div>
              <button className={styles.suggestBtn} onClick={resetSuggestion} type="button">
                ✦ Auto-pick least rare
              </button>
            </div>

            {rareChosen > 0 && (
              <div className={styles.rareWarn}>
                ⚠ {rareChosen} rare piece{rareChosen === 1 ? "" : "s"} selected — the fire is forever. Tap to deselect, or auto-pick the commons.
              </div>
            )}

            {live && phase === "loaded" && wallet.length === 0 ? (
              <p className="note">No Pikkazos in this wallet — nothing to offer. <a href="https://opensea.io/collection/cubist-souls" target="_blank" rel="noopener noreferrer">Go find some cubism.</a></p>
            ) : (
              <div className={styles.pkzGrid}>
                {wallet.map((id) => {
                  const r = rarityOf(id, rarity);
                  const sel = chosen.has(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`${styles.pkz}${sel ? " " + styles.pkzSel : ""}${r.rare ? " " + styles.pkzRare : ""}`}
                      onClick={() => togglePikkazo(id)}
                      aria-pressed={sel}
                      aria-label={`Pikkazo #${id}${r.tierName ? ` — ${r.tierName}` : ""}`}
                      title={r.rank ? `Rank #${r.rank.toLocaleString("en-US")} · ${r.tierName}` : `#${id}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={IMG(id)} alt={`Pikkazo #${id}`} loading="lazy" />
                      {sel && <span className={styles.pkzCheck}>✓</span>}
                      <span className={styles.pkzId}>#{id}</span>
                      {r.emoji && <span className={styles.pkzTier}>{r.emoji}{r.rare ? " rare" : ""}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* STEP 4 — live preview, consumption, rename */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">4</span>The Reaper rises</div>
        <div className="rite-preview">
          <div className="rp-portrait">
            <div className="tryon-stack">
              <span className="rp-stamp">Try-on</span>
              {stack.length ? (
                stack.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={`${src}-${i}`} className="lyr" src={src} alt="" />
                ))
              ) : (
                // fallback: flat render when the vector layers aren't available (e.g. 1/1)
                // eslint-disable-next-line @next/next/no-img-element
                <img className="lyr" src={IMG(aspirantId)} alt="" />
              )}
            </div>
            <div className={`soul-plate${ascended ? " ascended" : ""}`} key={ascended ? "reaper" : "soul"}>
              {ascended && <span className="plate-mark">🜃</span>}
              {displayName} <span className="pnum">#{aspirantId}</span>
            </div>
            <div className="tryon-hint">Swap soul or toggle marks freely · try before the fire</div>
          </div>

          <div>
            <div className="granted-lab">
              Wearing · {wornMarks.length ? wornMarks.map((m) => m.name).join(" + ") : "nothing yet"}
            </div>
            <div className="perk-chips">
              <span className="rk-chip"><span className="ico">🔥</span><b>{required}</b> Pikkazos</span>
              <span className="rk-chip"><span className="ico">⏳</span>MH <b>×{mult ? mult.toFixed(1) : "1.0"}</b></span>
              <span className="rk-chip"><span className="ico">✦</span><b>+{mhBonus}</b> MH/hr</span>
              <span className="rk-chip"><span className="ico">🜂</span>{rankName(consumedAfter)}</span>
            </div>

            <div className="consumed">
              <div className="consumed-top">
                <span>Souls consumed</span>
                <b>{consumedAfter} / {ASCEND_AT}</b>
              </div>
              <div className="consumed-bar"><span style={{ width: `${pct}%` }} /></div>
              <div className={`consumed-note${ascended ? " up" : ""}`}>
                {ascended
                  ? "★ 30 reached — renamed by the museum"
                  : required > 0
                    ? `${ASCEND_AT - consumedAfter} more to ascend`
                    : "add marks to feed the fire"}
                {live && already > 0 ? ` · ${already} already consumed` : ""}
              </div>
            </div>

            <div className="meta-preview">
              <div className="mp-head">Metadata preview · as on OpenSea</div>
              <div className="mp-row"><span>Name</span><b className={ascended ? "up" : ""}>{displayName} #{aspirantId}</b></div>
              <div className="mp-row"><span>Souls Consumed</span><b>{consumedAfter}</b></div>
            </div>

            <div className="perk-ill">Offerings and rewards may shift before the fire is lit</div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="rite-cta">
        {live ? (
          <button
            className={styles.riteGo}
            onClick={performRite}
            disabled={busy || !countOk}
            aria-disabled={busy || !countOk}
          >
            {busyLabel ?? (worn.size === 0 ? `🜃 Offer ${required} to the fire` : `🜃 Forge — burn ${required} Pikkazos`)}
          </button>
        ) : (
          <button className="btn-rite" disabled aria-disabled="true">
            The rite is being prepared — the scythe is not yet forged
          </button>
        )}
        <div className="cost-line">
          Cost: <b>{required} Pikkazos</b> · <span className="irr">irreversible</span>
        </div>
      </div>

      <MobileWalletSheet open={sheet} onClose={() => setSheet(false)} onWalletConnect={() => openConnectModal?.()} />
    </div>
  );
}
