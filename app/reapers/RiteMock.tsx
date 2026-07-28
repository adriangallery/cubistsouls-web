"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { mainnet } from "wagmi/chains";
import MobileWalletSheet, { useIsMobileNoInjected } from "../components/MobileWalletSheet";
import { loadSouls } from "@/lib/souls";
import { loadPikkazos, approvalsNeeded, PIKKAZO_ABI } from "@/lib/pikkazo";
import { inheritedMHOf } from "@/lib/mh";
import {
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
  marksFromConsumed,
  MARK_THRESHOLDS,
  MARK_BY_ID,
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

// THE RITE — "ONE BAR" redesign (Adrian 26-jul). The whole rite is one mental model:
//   every Pikkazo burned = +1 to your soul's consumed count. Marks are MILESTONES of
//   that running total — Orange at 6, Flame Crown at 12, Phoenix at 18, and at 30 the
//   final prize: the Burning Soul skin AND the SOUL REAPER name. 30 Pikkazos = all.
//
// The panel proposes a SINGLE aspirant (your OG with the most souls already
// consumed — keep feeding the one that is progressing), a big N/30 progress bar,
// ONE slider (1..min(balance,50)) with milestone stops on the TOTAL, and ONE button.
// The batch just adds to the total; every milestone the total crosses unlocks its
// mark(s). Marks are derived CLIENT-SIDE from the consumed count (marksFromConsumed),
// unioned with legacy on-chain bits. The concrete Pikkazo picking (auto least-rare +
// editable grid) and the full soul picker are collapsed behind discreet links.
//
//   demo (no wallet / flag off): the aspirant + offering wallet run on demo data so
//     the slider is fully playable; the CTA becomes "Connect wallet to burn".
//   live + connected: the aspirant is YOUR OG soul, the wallet is YOUR Pikkazos, and
//     the button runs approvals + offer() against the diamond.
//
// The tx is ALWAYS offer() — forgeMark is never called (the milestone marks are
// display-derived; the V3 cut that aligns marksOf on-chain ships in parallel).

const IMG = (id: number) => `/api/img?id=${id}`;

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
  { id: 42, name: "№0042", base: { ab: `${T}/art-background/snow-tiles.svg`, base: `${T}/base/childs-play.svg`, clothes: `${T}/clothes/polo-spike.svg`, head: `${T}/head/punk-never-die.svg`, mouth: `${T}/mouth/not-speak.svg`, leye: `${T}/left-eye/so-lame.svg`, nose: `${T}/nose/pinocchio.svg`, reye: `${T}/right-eye/cynical.svg` } },
  { id: 136, name: "№0136", base: { ab: `${T}/art-background/emerald-tiles.svg`, base: `${T}/base/sun-burn.svg`, clothes: `${T}/clothes/white-hoodie.svg`, head: `${T}/head/punk-never-die.svg`, mouth: `${T}/mouth/diva.svg`, leye: `${T}/left-eye/colony.svg`, nose: `${T}/nose/amethyst-block.svg`, reye: `${T}/right-eye/gaze.svg` } },
  { id: 314, name: "№0314", base: { ab: `${T}/art-background/star-brown.svg`, base: `${T}/base/soft-cloud.svg`, clothes: `${T}/clothes/greek-gods.svg`, head: `${T}/head/beanie-thug.svg`, mouth: `${T}/mouth/sheriff-on-duty.svg`, leye: `${T}/left-eye/kinda-blue.svg`, nose: `${T}/nose/thunderstorm.svg`, reye: `${T}/right-eye/emergency-exit.svg` } },
  { id: 777, name: "№0777", base: { ab: `${T}/art-background/snow-tiles.svg`, base: `${T}/base/glow-stone.svg`, clothes: `${T}/clothes/greek-gods.svg`, head: `${T}/head/red-flat-cap.svg`, mouth: `${T}/mouth/sheriff-on-duty.svg`, leye: `${T}/left-eye/danger-sign.svg`, nose: `${T}/nose/pinocchio.svg`, reye: `${T}/right-eye/smakeman.svg` } },
];
// a demo wallet of Pikkazos for the preview offering grid (36 ids so every stop —
// including 30 — is reachable and the slider is fully demoable). Rarity is real via
// rarity.json.
const DEMO_PIKKAZOS = [
  7, 42, 88, 120, 136, 188, 210, 271, 300, 314, 360, 420, 480, 512, 560, 636, 700,
  777, 820, 900, 970, 1024, 1100, 1150, 1240, 1337, 1420, 1500, 1660, 1808, 1950,
  2020, 2222, 2400, 2600, 3003,
];

type Aspirant = { id: number; name: string; base: BaseMap; state?: ReaperState; og: boolean };

// a slider stop = one mark's price. `forged` marks give nothing (feed through);
// unaffordable stops are greyed with the shortfall.
type SliderStop = {
  markId: number;
  value: number; // Pikkazos == mark price
  name: string; // "★ Phoenix"
  short: string; // "Phoenix"
  file: string;
  forged: boolean;
  affordable: boolean;
};

const posPct = (v: number, trackMax: number) => (trackMax <= 1 ? 0 : ((v - 1) / (trackMax - 1)) * 100);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// -----------------------------------------------------------------------------
// The single burn slider: 1..sliderMax, snap-to-stops, finger + keyboard usable.
// The track visually spans 1..trackMax (>= 30 so all four stops are always shown);
// values past sliderMax are a greyed, unreachable zone.
// -----------------------------------------------------------------------------
function BurnSlider({
  value,
  onChange,
  sliderMax,
  trackMax,
  stops,
}: {
  value: number;
  onChange: (v: number) => void;
  sliderMax: number;
  trackMax: number;
  stops: SliderStop[];
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const snapStops = useMemo(() => stops.filter((s) => s.value <= sliderMax), [stops, sliderMax]);

  const valueFromX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const frac = rect.width ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
      const fv = 1 + frac * (trackMax - 1);
      for (const s of snapStops) if (Math.abs(fv - s.value) < 0.55) return Math.min(s.value, sliderMax);
      return clamp(Math.round(fv), 1, sliderMax);
    },
    [trackMax, sliderMax, snapStops, value],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      onChange(valueFromX(e.clientX));
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [valueFromX, onChange]);

  const onDown = (e: React.PointerEvent) => {
    dragging.current = true;
    onChange(valueFromX(e.clientX));
  };

  const onKey = (e: React.KeyboardEvent) => {
    let v = value;
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowUp") v = clamp(value + 1, 1, sliderMax);
    else if (k === "ArrowLeft" || k === "ArrowDown") v = clamp(value - 1, 1, sliderMax);
    else if (k === "Home") v = 1;
    else if (k === "End") v = sliderMax;
    else if (k === "PageUp") v = snapStops.map((s) => s.value).filter((x) => x > value).sort((a, b) => a - b)[0] ?? clamp(value + 6, 1, sliderMax);
    else if (k === "PageDown") v = snapStops.map((s) => s.value).filter((x) => x < value).sort((a, b) => b - a)[0] ?? clamp(value - 6, 1, sliderMax);
    else return;
    e.preventDefault();
    onChange(v);
  };

  const fillPct = posPct(value, trackMax);
  const lockLeft = posPct(sliderMax, trackMax);

  return (
    <div className={styles.slider}>
      <div className={styles.sliderTrack} ref={trackRef} onPointerDown={onDown}>
        <div className={styles.sliderFill} style={{ width: `${fillPct}%` }} />
        {sliderMax < trackMax && <div className={styles.sliderLockZone} style={{ left: `${lockLeft}%` }} />}

        {stops.map((s) => {
          const left = posPct(s.value, trackMax);
          const reach = s.value <= sliderMax;
          const on = value === s.value && reach && !s.forged;
          const cls = [
            styles.stop,
            s.forged ? styles.stopForged : !reach ? styles.stopLocked : on ? styles.stopActive : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={s.markId}
              type="button"
              className={cls}
              style={{ left: `${left}%` }}
              disabled={!reach}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (reach) onChange(s.value);
              }}
              aria-label={
                reach
                  ? `Burn ${s.value} — unlock ${s.name}`
                  : `${s.name} — need ${s.value - sliderMax} more Pikkazos`
              }
            >
              <span className={styles.stopTick} />
              <span className={styles.stopLabel}>
                <b>{s.value}</b>
                <em>{reach ? s.short : `need ${s.value - sliderMax}`}</em>
              </span>
            </button>
          );
        })}

        <div
          className={styles.sliderThumb}
          style={{ left: `${fillPct}%` }}
          role="slider"
          tabIndex={0}
          aria-valuemin={1}
          aria-valuemax={sliderMax}
          aria-valuenow={value}
          aria-label="Pikkazos to burn"
          onKeyDown={onKey}
        >
          <span className={styles.thumbVal}>{value}</span>
        </div>
      </div>
      <div className={styles.sliderScale}>
        <span>1</span>
        <span>drag to choose · stops = milestones</span>
        <span>{sliderMax}</span>
      </div>
    </div>
  );
}

export default function RiteMock({ live = false }: { live?: boolean }) {
  const { openConnectModal } = useConnectModal();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const mobileNoInjected = useIsMobileNoInjected();

  const [mounted, setMounted] = useState(false);
  const [sheet, setSheet] = useState(false);
  // ?demo=1 forces the playable demo (teaser preview) even for a connected wallet.
  const [demoParam, setDemoParam] = useState(false);

  // shared data
  const [rarity, setRarity] = useState<Rarity | null>(null);
  const [layerData, setLayerData] = useState<LayerData | null>(null);

  // live wallet data
  const [phase, setPhase] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [ownedSouls, setOwnedSouls] = useState<number[]>([]);
  const [ownedPikkazos, setOwnedPikkazos] = useState<number[]>([]);
  const [states, setStates] = useState<Map<number, ReaperState>>(new Map());
  const [cohorts, setCohorts] = useState<Map<number, number>>(new Map());

  // rite selection
  const [aspirantId, setAspirantId] = useState<number>(0);
  const [pickedManually, setPickedManually] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [burnN, setBurnN] = useState(6); // slider value
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [manual, setManual] = useState(false);
  const [showCanvases, setShowCanvases] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      setDemoParam(new URLSearchParams(window.location.search).has("demo"));
    } catch {}
  }, []);

  const connected = mounted && isConnected;
  // demo drives the data source: no flag, or connected-less, or an explicit ?demo=1
  // teaser (so the slider is always playable, wallet or not).
  const demo = !live || !connected || demoParam;

  // rarity + layer engine (both modes; layers drive the vector try-on / the live art)
  useEffect(() => {
    loadRarity().then(setRarity).catch(() => {});
    loadLayerData().then(setLayerData).catch(() => {});
  }, []);

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
      setPickedManually(false);
    }
  }, [live, mounted, isConnected, address, loadWallet]);

  // ---- aspirants (demo: hardcoded · live: owned souls composed from traits) ----
  const aspirants: Aspirant[] = useMemo(() => {
    if (demo) return PREVIEW_ASPIRANTS.map((a) => ({ ...a, og: true }));
    return ownedSouls.map((id) => ({
      id,
      name: `№${String(id).padStart(4, "0")}`,
      base: layerData ? baseLayersOf(id, layerData) : {},
      state: states.get(id),
      og: isOG(cohorts.get(id)),
    }));
  }, [demo, ownedSouls, layerData, states, cohorts]);

  // PROPOSED soul (Adrian): your OG with the MOST souls already consumed — keep
  // feeding the one that is progressing (never scatter burns across souls and reach
  // 30 on none). Ties / no consumption → the first OG by ascending id.
  const defaultAspId = useMemo(() => {
    const ogs = aspirants.filter((a) => a.og);
    const pool = ogs.length ? ogs : aspirants;
    if (!pool.length) return 0;
    return [...pool].sort((a, b) => (b.state?.consumed ?? 0) - (a.state?.consumed ?? 0) || a.id - b.id)[0].id;
  }, [aspirants]);

  // adopt the proposal until the curator picks another soul in the (collapsed) picker
  useEffect(() => {
    if (!pickedManually && defaultAspId) setAspirantId(defaultAspId);
  }, [defaultAspId, pickedManually]);

  const aspirant = aspirants.find((a) => a.id === aspirantId) ?? aspirants.find((a) => a.id === defaultAspId) ?? aspirants[0];
  const hasOG = aspirants.some((a) => a.og);

  const pickSoul = (id: number, og: boolean) => {
    if (!og) return;
    setAspirantId(id);
    setPickedManually(true);
    setPickerOpen(false);
  };

  // souls already consumed on the picked soul + legacy on-chain mark bits (live).
  const already = !demo ? aspirant?.state?.consumed ?? 0 : 0;
  const legacyBits = useMemo(() => (!demo ? aspirant?.state?.marks ?? [] : []), [demo, aspirant]);

  // marks ALREADY unlocked (permanent) — derived from the consumed total, unioned
  // with legacy forge bits. These are worn no matter where the slider sits.
  const unlockedNow = useMemo(() => marksFromConsumed(already, legacyBits), [already, legacyBits]);
  const unlockedNowSet = useMemo(() => new Set(unlockedNow), [unlockedNow]);

  // the offering wallet (demo · live real) + balance
  const wallet = demo ? DEMO_PIKKAZOS : ownedPikkazos;
  const balance = wallet.length;
  const gateReady = !demo && phase === "loaded";
  const sliderMax = clamp(Math.min(balance, 50), 1, 50);

  // slider stops = milestones STILL AHEAD, expressed as the batch that reaches them
  // (value = threshold − already). Milestones already behind you get no stop.
  const stops: SliderStop[] = useMemo(
    () =>
      MARK_THRESHOLDS.filter((t) => t.at > already && !unlockedNowSet.has(t.markId))
        .map((t) => {
          const m = MARK_BY_ID.get(t.markId)!;
          return {
            markId: t.markId,
            value: t.at - already, // batch that lands the TOTAL exactly on this milestone
            name: m.name,
            short: m.name.replace("★ ", ""),
            file: m.file,
            forged: false,
            affordable: t.at - already <= sliderMax,
          };
        }),
    [already, unlockedNowSet, sliderMax],
  );
  // the track always spans up to the final (30-total) milestone so every stop shows,
  // even the ones the current balance can't reach yet (greyed lock zone past sliderMax).
  const maxStop = stops.length ? Math.max(...stops.map((s) => s.value)) : sliderMax;
  const trackMax = Math.max(maxStop, sliderMax, ASCEND_AT - already);

  // keep the slider inside [1..sliderMax]
  useEffect(() => {
    setBurnN((n) => clamp(n, 1, sliderMax));
  }, [sliderMax]);

  const required = burnN;
  const consumedAfter = already + required;
  const ascended = consumedAfter >= ASCEND_AT;
  const alreadyReaper = already >= ASCEND_AT;
  const displayName = ascended ? "Soul Reaper" : "Cubist Soul";

  // marks worn AFTER this batch = milestones the new total crosses (+ legacy bits).
  const unlockedAfter = useMemo(
    () => marksFromConsumed(consumedAfter, legacyBits),
    [consumedAfter, legacyBits],
  );
  // marks this batch NEWLY unlocks (for the verdict + celebration).
  const newlyUnlocked = useMemo(
    () => unlockedAfter.filter((id) => !unlockedNowSet.has(id)),
    [unlockedAfter, unlockedNowSet],
  );
  const unlocksNow = newlyUnlocked.length > 0;
  // the next milestone still ahead after this batch (for the "next at N" hint).
  const nextAhead = MARK_THRESHOLDS.find((t) => t.at > consumedAfter && !unlockedNowSet.has(t.markId)) ?? null;
  // the immediate next milestone from where the soul stands now (for the "⟶ next" card).
  const nextFromNow = MARK_THRESHOLDS.find((t) => t.at > already && !unlockedNowSet.has(t.markId)) ?? null;

  // perks reflect the resulting reaper: MH is INHERITED additively — every soul this
  // reaper has consumed keeps counting +1 MH/h (capped at 60). Shown for the batch total.
  const inheritedMH = inheritedMHOf(consumedAfter);

  // progress-bar geometry (over-30 keeps counting; the bar celebrates and stays full)
  const basePct = Math.min(100, (already / ASCEND_AT) * 100);
  const afterPct = Math.min(100, (consumedAfter / ASCEND_AT) * 100);

  const cantAfford = gateReady && balance < 1;

  // auto-suggest the N least-rare Pikkazos whenever the requirement or wallet
  // changes — UNLESS the curator has taken manual control in the canvas picker.
  useEffect(() => {
    if (manual) return;
    setChosen(new Set(suggestLeastRare(wallet, required, rarity)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, rarity, wallet.join(","), manual]);

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

  // try-on: compose the soul from its base layers, drawing EVERY mark that would be
  // unlocked at the total after this batch (permanent + newly unlocked). At the 30
  // milestone this is all four — skin + everything — which is the whole point.
  const stack = useMemo(
    () => composeFromBase(aspirant?.base ?? {}, unlockedAfter),
    [aspirant, unlockedAfter],
  );

  const chosenIds = useMemo(() => [...chosen].sort((a, b) => a - b), [chosen]);
  const rareChosen = chosenIds.filter((id) => rarityOf(id, rarity).rare).length;
  const countOk = chosenIds.length === required && required > 0;
  const readyToRun = countOk && !!aspirant?.og;

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
    if (demo || !walletClient || !publicClient || !address || !aspirant) return;
    if (!aspirant.og) {
      toast("This soul isn't OG — only OGs can take the scythe.");
      return;
    }
    const ids = chosenIds;
    if (ids.length !== required || required < 1) {
      toast(`Select exactly ${required} Pikkazo${required === 1 ? "" : "s"} to burn.`);
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
      const argIds = ids.map((n) => BigInt(n));

      // ALWAYS offer() — marks are milestones of the consumed total, unlocked as it
      // crosses each threshold. No forgeMark call (works with the current facet).
      setBusyLabel("Confirm burn…");
      const lastHash = await walletClient.writeContract({
        address: SOULS, abi: REAPER_ABI, functionName: "offer",
        args: [reaperId, argIds],
      });
      await publicClient.waitForTransactionReceipt({ hash: lastHash });

      toast(
        `🜃 The fire is fed — <b>${ascended ? "Soul Reaper" : "Cubist Soul"} #${aspirant.id}</b> consumed ${ids.length} soul${ids.length === 1 ? "" : "s"}.` +
          (unlocksNow ? ` Unlocked <b>${newlyUnlocked.map((id) => MARK_BY_ID.get(id)!.name).join(" ")}</b>.` : "") +
          ` <a href="https://etherscan.io/tx/${lastHash}" target="_blank" rel="noopener">Etherscan</a>`,
        0,
      );
      setManual(false);
      setChosen(new Set());
      await loadWallet(address);
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Transaction failed";
      const raw = msg + String(e?.cause?.data ?? "");
      if (/NotOGSoul/i.test(raw)) toast("This soul isn't OG — only OGs can take the scythe.");
      else if (/reject|denied|user rejected/i.test(msg)) toast("Stepped back from the fire.");
      else toast(`Failed: ${msg}`);
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }, [demo, walletClient, publicClient, address, aspirant, chosenIds, required, unlocksNow, newlyUnlocked, ensureMainnet, ascended, loadWallet]);

  const startConnect = () => {
    if (mobileNoInjected) setSheet(true);
    else openConnectModal?.();
  };

  // ---------------------------------------------------------------- gated states
  // LIVE + connected but no souls (skipped when ?demo=1 forces the teaser)
  if (!demoParam && live && connected && phase === "loaded" && ownedSouls.length === 0) {
    return (
      <div className="rite">
        <p className="note" style={{ textAlign: "center" }}>
          No Souls in this wallet. Free one first. <a href="/">Free a soul</a>
        </p>
      </div>
    );
  }

  // LIVE + connected + owns souls but none is OG → only OGs can take the scythe
  if (!demoParam && live && connected && phase === "loaded" && ownedSouls.length > 0 && !hasOG) {
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
      {/* teaser / connect banner — the panel is fully playable without a wallet */}
      {demo && (
        <div className={styles.demoBanner}>
          <span className={styles.demoDot} />
          {live ? (
            <>Preview — <button type="button" className={styles.demoLink} onClick={startConnect}>connect</button> to use your own Souls</>
          ) : (
            <>Coming soon — try the rite below</>
          )}
        </div>
      )}
      {live && phase === "loading" && (
        <div className={styles.loadingRow}><span className="dot" /> Reading your Souls…</div>
      )}

      {aspirant && (
        <>
          {/* ---------- PROPOSED SOUL — one card, art + name + the N/30 bar ---------- */}
          <div className={styles.proposal}>
            <div className={styles.propArt}>
              <div className={`tryon-stack${unlocksNow ? " " + styles.tryonPreview : ""}`}>
                <span className="rp-stamp">Try-on</span>
                {stack.length ? (
                  stack.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={`${src}-${i}`} className="lyr" src={src} alt="" />
                  ))
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="lyr" src={IMG(aspirant.id)} alt="" />
                )}
              </div>
              {/* subtle cue that a mark is being TRIED ON, not yet earned */}
              {unlocksNow && (
                <div className={styles.tryonChip}>
                  Trying on {newlyUnlocked.map((id) => MARK_BY_ID.get(id)!.name).join(" ")}
                </div>
              )}
              <div className={`soul-plate${ascended ? " ascended" : ""}`} key={ascended ? "reaper" : "soul"}>
                {ascended && <span className="plate-mark">🜃</span>}
                {displayName} <span className="pnum">#{aspirant.id}</span>
              </div>
            </div>

            <div className={styles.propInfo}>
              <div className={styles.propHead}>
                <span className={styles.propLabel}>Your aspirant</span>
                {aspirants.length > 1 && (
                  <button type="button" className={styles.changeLink} onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen}>
                    change soul {pickerOpen ? "▴" : "▾"}
                  </button>
                )}
              </div>

              {/* the ONE progress bar — N / 30 → SOUL REAPER */}
              <div className={styles.pbar}>
                <div className={styles.pbarTop}>
                  <span>Souls consumed</span>
                  {/* REAL consumed of THIS soul only — the slider batch is preview
                      (ghost segment + verdict line), never mixed into this number.
                      (Adrian 27-jul: switching souls kept showing the batch as "1"). */}
                  <b className={ascended ? styles.pbarValUp : ""}>{already}<i> / {ASCEND_AT}</i></b>
                </div>
                <div className={`${styles.pbarTrack}${ascended ? " " + styles.pbarTrackUp : ""}`}>
                  <div className={styles.pbarBase} style={{ width: `${basePct}%` }} />
                  {afterPct > basePct && (
                    <div className={styles.pbarAdd} style={{ left: `${basePct}%`, width: `${afterPct - basePct}%` }} />
                  )}
                  <span className={`${styles.pbarGoal}${ascended ? " " + styles.pbarGoalHit : ""}`}>🜃</span>
                </div>
                <div className={`${styles.pbarNote}${ascended ? " " + styles.pbarNoteUp : ""}`}>
                  {alreadyReaper
                    ? `★ SOUL REAPER · ${already} consumed`
                    : ascended
                      ? "★ this burn hits 30 — the final prize: the Burning Soul skin and the SOUL REAPER name"
                      : `${ASCEND_AT - already} more to become a Soul Reaper`}
                  {!demo && !alreadyReaper && required > 0 ? ` · burning +${required} now` : ""}
                </div>
              </div>
            </div>
          </div>

          {/* ---------- SOUL PICKER — collapsed; full grid with OG gating ---------- */}
          {pickerOpen && (
            <div className={styles.picker}>
              <div className={styles.pickerLab}>Pick a Soul {demo ? "(demo)" : ""}</div>
              <div className="aspirants">
                {aspirants.map((a) => (
                  <button
                    key={a.id}
                    className={`aspirant${aspirantId === a.id ? " sel" : ""}${a.og ? "" : " " + styles.aspLocked}`}
                    onClick={() => pickSoul(a.id, a.og)}
                    disabled={!a.og}
                    aria-disabled={!a.og}
                    aria-pressed={aspirantId === a.id}
                    aria-label={a.og ? `Aspirant ${a.name}` : `${a.name} — OG only, cannot be used`}
                    title={a.og ? undefined : "Only OG souls can take the scythe"}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={IMG(a.id)} alt={`Cubist Soul ${a.name}`} loading="lazy" />
                    <span className="tag">{a.name}</span>
                    {a.og && a.state && a.state.consumed > 0 ? (
                      <span className={styles.aspBadge}>🔥{Math.min(a.state.consumed, ASCEND_AT)}/{ASCEND_AT}</span>
                    ) : null}
                    {!a.og ? <span className={styles.aspLock}>OG only</span> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {cantAfford ? (
        <div className={styles.needMin}>
          <p className={styles.needMinLead}>You need at least 1 Pikkazo to feed the fire.</p>
          <a className="btn btn-primary" href={OPENSEA_PIKKAZO_URL} target="_blank" rel="noopener noreferrer">
            Get Pikkazos
          </a>
        </div>
      ) : (
        <>
          {/* ---------- THE SLIDER — how many to burn (stops = milestones) ---------- */}
          <div className={styles.burnBox}>
            <div className={styles.burnHead}>
              <span className={styles.burnLead}>How many Pikkazos to burn</span>
              <span className={styles.balanceChip}>
                You have <b>{balance}</b> 🔥{demo ? <span className={styles.demoTag}>demo</span> : null}
              </span>
            </div>

            <BurnSlider value={burnN} onChange={setBurnN} sliderMax={sliderMax} trackMax={trackMax} stops={stops} />

            {/* the verdict — where this batch takes your total, and what it unlocks */}
            <div className={`${styles.verdict}${unlocksNow ? " " + styles.verdictForge : ""}`}>
              {unlocksNow ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={styles.verdictThumb} src={MARK_BY_ID.get(newlyUnlocked[newlyUnlocked.length - 1])!.file} alt="" />
                  <span>
                    Takes you to <b>{consumedAfter}/{ASCEND_AT}</b> —{" "}
                    {ascended ? (
                      <>unlocks <b>EVERYTHING</b>: ★★★★ + SOUL REAPER</>
                    ) : (
                      <>unlocks <b>{newlyUnlocked.map((id) => MARK_BY_ID.get(id)!.name).join(" ")}</b></>
                    )}
                  </span>
                </>
              ) : (
                <span>
                  Takes you to <b>{consumedAfter}/{ASCEND_AT}</b> —{" "}
                  {nextAhead ? `no new mark yet · next at ${nextAhead.at}` : "already a Soul Reaper"}
                </span>
              )}
            </div>

            {/* perks of the resulting reaper (shown when this batch unlocks a mark) */}
            {unlocksNow && (
              <div className="perk-chips" style={{ marginTop: ".7rem" }}>
                <span className="rk-chip"><span className="ico">⏳</span><b>+{inheritedMH}</b> MH/h inherited</span>
                <span className="rk-chip"><span className="ico">✦</span>each soul consumed = +1 MH/h</span>
                <span className="rk-chip"><span className="ico">🜂</span>{rankName(consumedAfter)}</span>
              </div>
            )}
          </div>

          {/* ---------- MARKS — milestones of the path (unlock at 6/12/18/30) ---------- */}
          <div className={styles.markCards}>
            {MARK_THRESHOLDS.map((t) => {
              const m = MARK_BY_ID.get(t.markId)!;
              const batchTo = t.at - already; // batch that reaches this milestone
              const unlocked = unlockedNowSet.has(t.markId);
              const willUnlock = !unlocked && unlockedAfter.includes(t.markId);
              const reach = batchTo >= 1 && batchTo <= sliderMax;
              const isNext = !unlocked && !willUnlock && nextFromNow?.markId === t.markId;
              const cls = [
                styles.markCard,
                unlocked ? styles.mcForged : willUnlock ? styles.mcActive : !reach ? styles.mcLocked : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={t.markId}
                  type="button"
                  className={cls}
                  disabled={unlocked || !reach}
                  onClick={() => !unlocked && reach && setBurnN(batchTo)}
                  aria-label={unlocked ? `${m.name} unlocked` : `${m.name} unlocks at ${t.at} consumed`}
                >
                  <span className={styles.mcThumb}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.file} alt="" loading="lazy" />
                  </span>
                  <span className={styles.mcName}>{m.name.replace("★ ", "")}</span>
                  <span className={styles.mcState}>
                    {unlocked
                      ? "✓ unlocked"
                      : willUnlock
                        ? "this batch"
                        : isNext
                          ? "⟶ next"
                          : !reach
                            ? `need ${batchTo - sliderMax} 🔥`
                            : `unlocks at ${t.at}`}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ---------- WHICH CANVASES — collapsed; auto-picks least rare ---------- */}
          <div className={styles.canvasWrap}>
            <button
              type="button"
              className={styles.canvasToggle}
              onClick={() => setShowCanvases((o) => !o)}
              aria-expanded={showCanvases}
            >
              <span>
                Burning <b>{required}</b> {demo ? "demo " : ""}canvas{required === 1 ? "" : "es"} · auto-picked least rare
                {rareChosen > 0 ? <em className={styles.canvasWarn}> · {rareChosen} rare</em> : null}
              </span>
              <span className={styles.canvasChevron}>choose which {showCanvases ? "▴" : "▾"}</span>
            </button>

            {showCanvases && (
              <div className={styles.canvasBody}>
                <div className={styles.offerHead}>
                  <div className={styles.offerCount}>
                    <b className={countOk ? styles.ok : styles.bad}>{chosenIds.length}</b> / {required} selected
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

                {!demo && phase === "loaded" && wallet.length === 0 ? (
                  <p className="note">
                    No Pikkazos in this wallet.{" "}
                    <a href={OPENSEA_PIKKAZO_URL} target="_blank" rel="noopener noreferrer">Go find some.</a>
                  </p>
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
              </div>
            )}
          </div>

          {/* ---------- ONE BUTTON ---------- */}
          <div className="rite-cta">
            {demo ? (
              <button className={styles.riteGo} onClick={startConnect}>
                {live ? "Connect wallet to burn" : "Coming soon"}
              </button>
            ) : (
              <button
                className={styles.riteGo}
                onClick={performRite}
                disabled={busy || !readyToRun || !aspirant?.og}
                aria-disabled={busy || !readyToRun || !aspirant?.og}
              >
                {!aspirant?.og
                  ? "OG Souls only"
                  : busyLabel ??
                    (unlocksNow
                      ? `🔥 Burn ${burnN} — reach ${consumedAfter}/${ASCEND_AT}`
                      : `🔥 Burn ${burnN} Pikkazo${burnN === 1 ? "" : "s"}`)}
              </button>
            )}
            <div className="cost-line">
              Cost: <b>{required} Pikkazo{required === 1 ? "" : "s"}</b> · <span className="irr">irreversible</span>
            </div>
            <div className="perk-ill">Try freely · nothing is burned until you confirm</div>
          </div>
        </>
      )}

      <MobileWalletSheet open={sheet} onClose={() => setSheet(false)} onWalletConnect={() => openConnectModal?.()} />
    </div>
  );
}
