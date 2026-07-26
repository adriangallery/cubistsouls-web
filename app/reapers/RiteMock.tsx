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
  loadCohorts,
  isOG,
  OPENSEA_OG_URL,
  OPENSEA_PIKKAZO_URL,
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

type Aspirant = { id: number; name: string; base: BaseMap; state?: ReaperState; og: boolean };

export default function RiteMock({ live = false }: { live?: boolean }) {
  // (Launched 26-jul: the ?reaper=1 / ?demonog=1 pre-launch QA gates were removed
  // when flags.reaperLive flipped to true.)
  const demoNonOG = false;
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
  const [cohorts, setCohorts] = useState<Map<number, number>>(new Map());

  // rite selection
  const [aspirantId, setAspirantId] = useState<number>(136);
  // two explicit paths: FORGE a mark, or FEED only (pure offer, no mark).
  const [mode, setMode] = useState<"forge" | "feed">("forge");
  const [worn, setWorn] = useState<Set<string>>(() => new Set(["crown"]));
  const [feedQty, setFeedQty] = useState(1); // feed-only: how many Pikkazos to burn
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
        const [st, ch] = await Promise.all([
          souls.owned.length ? getReaperState(publicClient, souls.owned) : Promise.resolve(new Map<number, ReaperState>()),
          souls.owned.length ? loadCohorts(publicClient, souls.owned) : Promise.resolve(new Map<number, number>()),
        ]);
        setStates(st);
        setCohorts(ch);
        // default to an OG soul when there is one (only OGs can take the scythe)
        if (souls.owned.length) {
          const ogs = souls.owned.filter((id) => isOG(ch.get(id)));
          const pref = ogs.length ? ogs : souls.owned;
          setAspirantId((cur) => (pref.includes(cur) ? cur : pref[0]));
        }
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
      setCohorts(new Map());
    }
  }, [live, mounted, isConnected, address, loadWallet]);

  // ---- aspirants (preview: hardcoded · live: owned souls composed from traits) ----
  const aspirants: Aspirant[] = useMemo(() => {
    if (!live) {
      // preview: the 4 demo souls are all pre-cut → OG. ?demonog=1 flips the last
      // one to non-OG purely to demonstrate the locked "OG only" state.
      return PREVIEW_ASPIRANTS.map((a, i) => ({
        ...a,
        og: !(demoNonOG && i === PREVIEW_ASPIRANTS.length - 1),
      }));
    }
    return ownedSouls.map((id) => ({
      id,
      name: `№${String(id).padStart(4, "0")}`,
      base: layerData ? baseLayersOf(id, layerData) : {},
      state: states.get(id),
      og: isOG(cohorts.get(id)),
    }));
  }, [live, ownedSouls, layerData, states, cohorts, demoNonOG]);

  // never leave a non-OG selected — snap to the first OG aspirant if we can
  const aspirant = aspirants.find((a) => a.id === aspirantId) ?? aspirants[0];
  const hasOG = aspirants.some((a) => a.og);

  // marks ALREADY forged on the picked soul (live): the contract reverts
  // MarkAlreadyForged, so the web never lets one be re-selected. Recomputed
  // whenever the aspirant changes. Preview has no chain → empty.
  const forgedMarkIds = useMemo(
    () => new Set<number>(live ? aspirant?.state?.marks ?? [] : []),
    [live, aspirant],
  );

  // worn marks + the pikkazos each will consume (live cost overrides). A forged
  // mark can never count toward the sum or the tx, even if it lingered in `worn`.
  // Feed-only mode forges nothing, so it contributes no marks.
  const wornMarks = useMemo(
    () =>
      mode === "feed"
        ? []
        : REAPER_MARKS.filter((m) => worn.has(m.id) && !forgedMarkIds.has(m.markId)).map((m) => ({
            ...m,
            cost: costOf(m.markId, m.cost),
          })),
    [mode, worn, forgedMarkIds, costOf],
  );
  const forgeCost = wornMarks.reduce((s, m) => s + m.cost, 0);

  // the offering wallet (preview demo · live real)
  const wallet = live ? ownedPikkazos : DEMO_PIKKAZOS;
  const balance = wallet.length; // B (live: real owned Pikkazos)

  // how many Pikkazos this run burns: FEED = the chosen quantity, FORGE = mark cost.
  const required = mode === "feed" ? Math.min(feedQty, balance) : forgeCost;

  // existing consumption of the picked soul (live) — the rite ADDS to it
  const already = live ? aspirant?.state?.consumed ?? 0 : 0;
  const consumedAfter = already + required;
  const ascended = consumedAfter >= ASCEND_AT;
  const pct = Math.min(100, (consumedAfter / ASCEND_AT) * 100);
  const displayName = ascended ? "Soul Reaper" : "Cubist Soul";
  const mhBonus = wornMarks.reduce((s, m) => s + m.mh, 0);
  const mult = wornMarks.reduce((mx, m) => Math.max(mx, m.mult), 0);

  // ---- affordability gating (LIVE only) --------------------------------------
  // B = Pikkazos you own. C = cost of the marks already selected (= forgeCost). A
  // non-selected mark whose cost would push C+cost past B can't be picked — no
  // impossible "27/36 selected" state can exist. Preview has no real balance, so
  // it stays ungated. Only trust the balance once the wallet has loaded, so a
  // mid-load empty read never false-locks a genuine owner.
  const gateReady = live && phase === "loaded";
  // marks still available to forge on THIS soul (not already forged)
  const forgeableMarks = useMemo(
    () => REAPER_MARKS.filter((m) => !forgedMarkIds.has(m.markId)),
    [forgedMarkIds],
  );
  const allForged = forgeableMarks.length === 0;
  const minMarkCost = allForged
    ? Infinity
    : Math.min(...forgeableMarks.map((m) => costOf(m.markId, m.cost)));
  // FORGE below the cheapest forgeable mark → show the single "get more" state.
  // FEED needs only 1 Pikkazo (no minimum-6 rule — that only bounds forging).
  const cantAfford = gateReady && (mode === "feed" ? balance < 1 : balance < minMarkCost);

  // keep the feed quantity inside [1 .. balance]
  useEffect(() => {
    if (!gateReady) return;
    setFeedQty((q) => Math.max(1, Math.min(q, Math.max(1, balance))));
  }, [gateReady, balance]);

  // never leave the panel in the impossible state: the default worn set (crown)
  // may cost more than a small wallet holds, or contain a mark already forged on
  // the newly-picked soul. Once the balance/soul is known, prune worn to a set
  // that (a) excludes forged marks and (b) fits B — dropping the priciest first.
  useEffect(() => {
    if (!gateReady) return;
    setWorn((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const m of REAPER_MARKS) if (next.has(m.id) && forgedMarkIds.has(m.markId)) { next.delete(m.id); changed = true; }
      let total = REAPER_MARKS.filter((m) => next.has(m.id)).reduce((s, m) => s + costOf(m.markId, m.cost), 0);
      if (total > balance) {
        const picked = REAPER_MARKS.filter((m) => next.has(m.id)).sort((a, b) => costOf(b.markId, b.cost) - costOf(a.markId, a.cost));
        for (const m of picked) {
          if (total <= balance) break;
          next.delete(m.id); total -= costOf(m.markId, m.cost); changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [gateReady, balance, costOf, forgedMarkIds]);

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

  // preview: compose from the hardcoded base map · live: from traits index. Marks
  // already forged on the soul are drawn too (feed shows the soul as-is; forge
  // adds the newly-picked marks on top).
  const stack = useMemo(
    () => composeFromBase(aspirant?.base ?? {}, mode === "feed" ? [...forgedMarkIds] : [...forgedMarkIds, ...worn]),
    [aspirant, worn, mode, forgedMarkIds],
  );

  const chosenIds = useMemo(() => [...chosen].sort((a, b) => a - b), [chosen]);
  const rareChosen = chosenIds.filter((id) => rarityOf(id, rarity).rare).length;
  const countOk = chosenIds.length === required && required > 0;
  // forge needs at least one still-forgeable mark selected; feed needs none.
  const readyToRun = countOk && (mode === "feed" || wornMarks.length > 0);

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
    if (!aspirant.og) {
      toast("This soul isn't OG — only OGs can take the scythe.");
      return;
    }
    const ids = chosenIds;
    if (!ids.length) return;
    if (ids.length !== required) {
      toast(
        mode === "feed"
          ? `Select exactly ${required} Pikkazos to feed.`
          : `Select exactly ${required} Pikkazos for the chosen marks.`,
      );
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
          toast("One signature to let the fire burn your Pikkazos. Revocable anytime.", 0);
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

      if (mode === "feed") {
        // pure offering — consume souls without forging a mark
        setBusyLabel("Confirm feed…");
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
      const raw = msg + String(e?.cause?.data ?? "");
      if (/NotOGSoul/i.test(raw)) {
        toast("This soul isn't OG — only OGs can take the scythe.");
      } else if (/MarkAlreadyForged/i.test(raw)) {
        toast("That mark is already forged on this soul.");
        await loadWallet(address);
      } else if (/reject|denied|user rejected/i.test(msg)) {
        toast("Stepped back from the fire.");
      } else {
        toast(`Failed: ${msg}`);
      }
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }, [live, mode, walletClient, publicClient, address, aspirant, chosenIds, required, wornMarks, ensureMainnet, ascended, loadWallet]);

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
          <p className={styles.connectLead}>Connect to see your Souls.</p>
          <button className="btn btn-primary" onClick={startConnect}>Connect wallet</button>
          <p className="cta-note">Ethereum mainnet</p>
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
          No Souls in this wallet. Free one first.{" "}
          <a href="/" >Free a soul</a>
        </p>
      </div>
    );
  }

  // LIVE + connected + owns souls but none is OG → only OGs can take the scythe
  if (live && connected && phase === "loaded" && ownedSouls.length > 0 && !hasOG) {
    return (
      <div className="rite">
        <div className={styles.connect}>
          <p className={styles.connectLead}>Only OG souls can take the scythe.</p>
          <a className="btn btn-primary" href={OPENSEA_OG_URL} target="_blank" rel="noopener noreferrer">
            Get an OG soul
          </a>
          <p className="cta-note">OG cohort · freed before the eras</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rite">
      {live && phase === "loading" && (
        <div className={styles.loadingRow}><span className="dot" /> Reading your Souls…</div>
      )}

      {/* STEP 1 — pick the aspirant soul */}
      <div className="rite-step">
        <div className="rite-lab"><span className="n">1</span>Pick a Soul</div>
        <div className="aspirants">
          {aspirants.map((a) => {
            const st = a.state;
            return (
              <button
                key={a.id}
                className={`aspirant${aspirantId === a.id ? " sel" : ""}${a.og ? "" : " " + styles.aspLocked}`}
                onClick={() => a.og && setAspirantId(a.id)}
                disabled={!a.og}
                aria-disabled={!a.og}
                aria-pressed={aspirantId === a.id}
                aria-label={a.og ? `Aspirant ${a.name}` : `${a.name} — OG only, cannot be used`}
                title={a.og ? undefined : "Only OG souls can take the scythe"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={IMG(a.id)} alt={`Cubist Soul ${a.name}`} loading="lazy" />
                <span className="tag">{a.name}</span>
                {a.og && st && st.consumed > 0 ? <span className={styles.aspBadge}>🔥{st.consumed}</span> : null}
                {!a.og ? <span className={styles.aspLock}>OG only</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* MODE — two clear paths: forge a mark, or feed only (pure offer) */}
      <div className={styles.modeTabs} role="tablist" aria-label="Rite mode">
        <button
          type="button" role="tab" aria-selected={mode === "forge"}
          className={`${styles.modeTab}${mode === "forge" ? " " + styles.modeTabActive : ""}`}
          onClick={() => { setManual(false); setMode("forge"); }}
        >
          ★ Forge a mark
        </button>
        <button
          type="button" role="tab" aria-selected={mode === "feed"}
          className={`${styles.modeTab}${mode === "feed" ? " " + styles.modeTabActive : ""}`}
          onClick={() => { setManual(false); setMode("feed"); }}
        >
          🔥 Feed only
        </button>
      </div>

      {/* STEP 2 — forge: pick marks · feed: choose how many */}
      <div className="rite-step">
        <div className="rite-lab">
          <span className="n">2</span>{mode === "feed" ? "How many to feed" : "Pick your marks"}
        </div>

        {gateReady && (
          <div className={styles.balanceChip}>
            You have <b>{balance}</b> Pikkazo{balance === 1 ? "" : "s"} 🔥
          </div>
        )}

        {mode === "feed" ? (
          cantAfford ? (
            <div className={styles.needMin}>
              <p className={styles.needMinLead}>You need at least 1 Pikkazo.</p>
              <a className="btn btn-primary" href={OPENSEA_PIKKAZO_URL} target="_blank" rel="noopener noreferrer">
                Get Pikkazos
              </a>
            </div>
          ) : (
            <div className={styles.feedBox}>
              <p className={styles.feedNote}><b>FEED ONLY — no mark.</b> Just souls consumed.</p>
              <div className={styles.qtyRow}>
                <button type="button" className={styles.qtyBtn} aria-label="One fewer"
                  onClick={() => { setManual(false); setFeedQty((q) => Math.max(1, q - 1)); }}
                  disabled={required <= 1}>–</button>
                <span className={styles.qtyVal}><b>{required}</b> Pikkazo{required === 1 ? "" : "s"}</span>
                <button type="button" className={styles.qtyBtn} aria-label="One more"
                  onClick={() => { setManual(false); setFeedQty((q) => Math.min(balance, q + 1)); }}
                  disabled={required >= balance}>+</button>
                <button type="button" className={styles.qtyMax}
                  onClick={() => { setManual(false); setFeedQty(balance); }}
                  disabled={required >= balance}>Max</button>
              </div>
              <p className={styles.feedBenefit}>Counts toward 30 → <b>SOUL REAPER</b>.</p>
            </div>
          )
        ) : allForged ? (
          <div className={styles.needMin}>
            <p className={styles.needMinLead}>All marks already forged.</p>
            <button type="button" className="btn btn-primary" onClick={() => { setManual(false); setMode("feed"); }}>
              Feed only
            </button>
          </div>
        ) : cantAfford ? (
          <div className={styles.needMin}>
            <p className={styles.needMinLead}>You need at least {minMarkCost} Pikkazos.</p>
            <a className="btn btn-primary" href={OPENSEA_PIKKAZO_URL} target="_blank" rel="noopener noreferrer">
              Get Pikkazos
            </a>
          </div>
        ) : (
          <div className="rtraits">
            {REAPER_MARKS.map((t) => {
              const forged = forgedMarkIds.has(t.markId);
              const on = !forged && worn.has(t.id);
              const cost = costOf(t.markId, t.cost);
              // already forged → done, never selectable, no cost. Else, can't pay
              // for it (and not already worn) → lock it, show the shortfall.
              const locked = !forged && gateReady && !on && required + cost > balance;
              const need = required + cost - balance;
              const disabled = forged || locked;
              return (
                <button
                  key={t.id}
                  className={`rtrait${on ? " sel" : ""}${forged ? " " + styles.markForged : locked ? " " + styles.markLocked : ""}`}
                  onClick={() => { if (!disabled) toggleMark(t.id); }}
                  disabled={disabled}
                  aria-disabled={disabled}
                  aria-pressed={on}
                  aria-label={forged ? `${t.name} — already forged` : locked ? `${t.name} — need ${need} more Pikkazos` : `${t.name} — ${cost} Pikkazos`}
                  title={forged ? "Already forged on this soul" : locked ? `Need ${need} more Pikkazos` : undefined}
                >
                  {!forged && <span className="rt-price">{cost} 🔥</span>}
                  {on && <span className="rt-on">✓</span>}
                  {forged && <span className={styles.markForgedTag}>✓ Forged</span>}
                  {locked && <span className={styles.markNeed}>Need {need} more 🔥</span>}
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
        )}
      </div>

      {/* STEP 3 — offer Pikkazos (manual selection + auto-suggest) */}
      <div className="rite-step">
        <div className="rite-lab">
          <span className="n">3</span>
          Burn {required} Pikkazo{required === 1 ? "" : "s"}
        </div>

        {required === 0 ? (
          <p className={styles.offerEmpty}>{mode === "feed" ? "Get Pikkazos first." : "Pick a mark first."}</p>
        ) : (
          <>
            <div className={styles.offerHead}>
              <div className={styles.offerCount}>
                <b className={countOk ? styles.ok : styles.bad}>{chosenIds.length}</b> / {required} selected
                {!live && <span className={styles.demoTag}>demo wallet</span>}
              </div>
              <button className={styles.suggestBtn} onClick={resetSuggestion} type="button">
                ✦ Auto-pick commons
              </button>
            </div>

            {rareChosen > 0 && (
              <div className={styles.rareWarn}>
                ⚠ {rareChosen} rare piece{rareChosen === 1 ? "" : "s"} selected — burning is forever. Tap to deselect, or auto-pick commons.
              </div>
            )}

            {live && phase === "loaded" && wallet.length === 0 ? (
              <p className="note">No Pikkazos in this wallet. <a href="https://opensea.io/collection/cubist-souls" target="_blank" rel="noopener noreferrer">Go find some.</a></p>
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
        <div className="rite-lab"><span className="n">4</span>Preview</div>
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
            <div className="tryon-hint">Try freely · nothing is burned yet</div>
          </div>

          <div>
            <div className="granted-lab">
              Marks · {mode === "feed" ? "Feed only — no mark" : wornMarks.length ? wornMarks.map((m) => m.name).join(" + ") : "none yet"}
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
                    ? `${ASCEND_AT - consumedAfter} more to become a Reaper`
                    : mode === "feed" ? "choose how many" : "add marks to start"}
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
            disabled={busy || !readyToRun || !aspirant?.og}
            aria-disabled={busy || !readyToRun || !aspirant?.og}
          >
            {!aspirant?.og
              ? "OG Souls only"
              : (busyLabel ??
                  (mode === "feed"
                    ? `🔥 Feed ${required} Pikkazo${required === 1 ? "" : "s"}`
                    : `🔥 Forge for ${required} Pikkazo${required === 1 ? "" : "s"}`))}
          </button>
        ) : (
          <button className="btn-rite" disabled aria-disabled="true">
            Coming soon
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
