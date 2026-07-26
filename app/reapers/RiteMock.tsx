"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// THE RITE — "ONE BAR" redesign (Adrian 26-jul). The whole rite is one mental model:
//   every Pikkazo burned = +1 · reach 30 = SOUL REAPER · burn an exact batch of
//   6/12/18/30 and that batch ALSO forges its mark.
//
// The panel proposes a SINGLE aspirant (your OG with the most souls already
// consumed — keep feeding the one that is progressing), a big N/30 progress bar,
// ONE slider (1..min(balance,50)) with stops at the mark prices, and ONE button.
// Landing exactly on a forgeable, affordable stop forges that mark automatically;
// any other number is a pure feed. The concrete Pikkazo picking (auto least-rare +
// editable grid) and the full soul picker are collapsed behind discreet links.
//
//   demo (no wallet / flag off): the aspirant + offering wallet run on demo data so
//     the slider is fully playable; the CTA becomes "Connect wallet to burn".
//   live + connected: the aspirant is YOUR OG soul, the wallet is YOUR Pikkazos, and
//     the button runs approvals + forgeMark()/offer() against the diamond.
//
// The contract fits 1:1 — offer() for a feed, forgeMark() for a batch-forge. Nothing
// on-chain changes.

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
                s.forged
                  ? `${s.name} — already forged`
                  : reach
                    ? `Burn ${s.value} — forge ${s.name}`
                    : `${s.name} — need ${s.value - sliderMax} more Pikkazos`
              }
            >
              <span className={styles.stopTick} />
              <span className={styles.stopLabel}>
                <b>{s.value}</b>
                <em>{s.forged ? "✓" : reach ? s.short : `need ${s.value - sliderMax}`}</em>
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
        <span>drag to choose · stops forge marks</span>
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
  const [prices, setPrices] = useState<Record<number, number> | null>(null);

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

  // marks ALREADY forged on the picked soul (live only): the contract reverts
  // MarkAlreadyForged, so such a stop only ever feeds. Demo has no chain → none.
  const forgedMarkIds = useMemo(
    () => new Set<number>(!demo ? aspirant?.state?.marks ?? [] : []),
    [demo, aspirant],
  );

  // the offering wallet (demo · live real) + balance
  const wallet = demo ? DEMO_PIKKAZOS : ownedPikkazos;
  const balance = wallet.length;
  const gateReady = !demo && phase === "loaded";
  const sliderMax = clamp(Math.min(balance, 50), 1, 50);
  const trackMax = Math.max(ASCEND_AT, sliderMax); // always show every stop (6/12/18/30)

  // the four stops, priced live (markPrice) or by ratified defaults
  const stops: SliderStop[] = useMemo(
    () =>
      REAPER_MARKS.map((m) => {
        const value = costOf(m.markId, m.cost);
        return {
          markId: m.markId,
          value,
          name: m.name,
          short: m.name.replace("★ ", ""),
          file: m.file,
          forged: forgedMarkIds.has(m.markId),
          affordable: value <= sliderMax,
        };
      }),
    [costOf, forgedMarkIds, sliderMax],
  );

  // keep the slider inside [1..sliderMax]
  useEffect(() => {
    setBurnN((n) => clamp(n, 1, sliderMax));
  }, [sliderMax]);

  // does the current batch land exactly on a forgeable, affordable stop?
  const markHere = useMemo(() => {
    const m = REAPER_MARKS.find((mk) => costOf(mk.markId, mk.cost) === burnN && !forgedMarkIds.has(mk.markId));
    return m ? { ...m, cost: costOf(m.markId, m.cost) } : null;
  }, [burnN, costOf, forgedMarkIds]);
  const forgesNow = !!markHere && burnN <= balance;
  // a stop that IS at burnN but is already forged → messaging only (still a feed)
  const forgedHere = useMemo(
    () => REAPER_MARKS.find((mk) => costOf(mk.markId, mk.cost) === burnN && forgedMarkIds.has(mk.markId)) ?? null,
    [burnN, costOf, forgedMarkIds],
  );

  const required = burnN;
  const already = !demo ? aspirant?.state?.consumed ?? 0 : 0;
  const consumedAfter = already + required;
  const ascended = consumedAfter >= ASCEND_AT;
  const alreadyReaper = already >= ASCEND_AT;
  const displayName = ascended ? "Soul Reaper" : "Cubist Soul";
  const mhBonus = forgesNow ? markHere!.mh : 0;
  const mult = forgesNow ? markHere!.mult : 0;

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

  // try-on: compose the soul from its base layers, drawing forged marks + (when the
  // batch forges) the mark this batch would grant.
  const stack = useMemo(
    () => composeFromBase(aspirant?.base ?? {}, forgesNow ? [...forgedMarkIds, markHere!.id] : [...forgedMarkIds]),
    [aspirant, forgesNow, markHere, forgedMarkIds],
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
      let lastHash: `0x${string}`;

      if (forgesNow && markHere) {
        // exact batch → forge the mark at this stop (len == markPrice)
        setBusyLabel(`Forge ${markHere.name}…`);
        lastHash = await walletClient.writeContract({
          address: SOULS, abi: REAPER_ABI, functionName: "forgeMark",
          args: [reaperId, markHere.markId, argIds],
        });
      } else {
        // any other number → pure feed
        setBusyLabel("Confirm burn…");
        lastHash = await walletClient.writeContract({
          address: SOULS, abi: REAPER_ABI, functionName: "offer",
          args: [reaperId, argIds],
        });
      }
      await publicClient.waitForTransactionReceipt({ hash: lastHash });

      toast(
        `🜃 The fire is fed — <b>${ascended ? "Soul Reaper" : "Cubist Soul"} #${aspirant.id}</b> consumed ${ids.length} soul${ids.length === 1 ? "" : "s"}.` +
          (forgesNow && markHere ? ` <b>${markHere.name}</b> forged.` : "") +
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
      else if (/MarkAlreadyForged/i.test(raw)) {
        toast("That mark is already forged on this soul.");
        await loadWallet(address);
      } else if (/reject|denied|user rejected/i.test(msg)) toast("Stepped back from the fire.");
      else toast(`Failed: ${msg}`);
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }, [demo, walletClient, publicClient, address, aspirant, chosenIds, required, forgesNow, markHere, ensureMainnet, ascended, loadWallet]);

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
              <div className="tryon-stack">
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
                  <b className={ascended ? styles.pbarValUp : ""}>{consumedAfter}<i> / {ASCEND_AT}</i></b>
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
                    ? `★ SOUL REAPER · ${consumedAfter} consumed`
                    : ascended
                      ? "★ 30 reached — the museum renames it Soul Reaper"
                      : `${ASCEND_AT - consumedAfter} more to become a Soul Reaper`}
                  {!demo && already > 0 && !alreadyReaper ? ` · ${already} already` : ""}
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
                    {a.og && a.state && a.state.consumed > 0 ? <span className={styles.aspBadge}>🔥{a.state.consumed}</span> : null}
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
          {/* ---------- THE SLIDER — how many to burn (stops forge marks) ---------- */}
          <div className={styles.burnBox}>
            <div className={styles.burnHead}>
              <span className={styles.burnLead}>How many Pikkazos to burn</span>
              <span className={styles.balanceChip}>
                You have <b>{balance}</b> 🔥{demo ? <span className={styles.demoTag}>demo</span> : null}
              </span>
            </div>

            <BurnSlider value={burnN} onChange={setBurnN} sliderMax={sliderMax} trackMax={trackMax} stops={stops} />

            {/* the verdict — forge or feed, in one line */}
            <div className={`${styles.verdict}${forgesNow ? " " + styles.verdictForge : ""}`}>
              {forgesNow && markHere ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={styles.verdictThumb} src={markHere.file} alt="" />
                  <span>
                    This batch forges <b>{markHere.name}</b> — and +{burnN} to your count.
                  </span>
                </>
              ) : forgedHere ? (
                <span>
                  <b>{forgedHere.name}</b> already forged · +{burnN} to your count. No new mark.
                </span>
              ) : (
                <span>+{burnN} to your count. No mark.</span>
              )}
            </div>

            {/* perks earned by this batch (only when it forges) */}
            {forgesNow && (
              <div className="perk-chips" style={{ marginTop: ".7rem" }}>
                <span className="rk-chip"><span className="ico">⏳</span>MH <b>×{mult.toFixed(1)}</b></span>
                <span className="rk-chip"><span className="ico">✦</span><b>+{mhBonus}</b> MH/hr</span>
                <span className="rk-chip"><span className="ico">🜂</span>{rankName(consumedAfter)}</span>
              </div>
            )}
          </div>

          {/* ---------- MARKS — rewards of the path (informative) ---------- */}
          <div className={styles.markCards}>
            {stops.map((s) => {
              const reach = s.value <= sliderMax;
              const active = burnN === s.value && reach && !s.forged;
              const cls = [
                styles.markCard,
                s.forged ? styles.mcForged : !reach ? styles.mcLocked : active ? styles.mcActive : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={s.markId}
                  type="button"
                  className={cls}
                  disabled={s.forged || !reach}
                  onClick={() => reach && !s.forged && setBurnN(s.value)}
                  aria-label={s.forged ? `${s.name} forged` : reach ? `Set batch to ${s.value} to forge ${s.name}` : `${s.name} locked`}
                >
                  <span className={styles.mcThumb}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.file} alt="" loading="lazy" />
                  </span>
                  <span className={styles.mcName}>{s.short}</span>
                  <span className={styles.mcState}>
                    {s.forged ? "✓ Forged" : !reach ? `need ${s.value - sliderMax} 🔥` : active ? "this batch" : `${s.value} 🔥`}
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
                    (forgesNow && markHere
                      ? `🔥 Burn ${burnN} — forge ${markHere.name}`
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
