// Pyramidal govern — the power math and the HOT params loader (design phase, F1).
//
// The whole design is soul-bound: power lives in the TOKENS, the wallet only sums
// the souls it holds (PLAN_CUBISTSOULS_GOVERN.md). This file is the single source
// of the client-side power calculator the /govern page renders. NOTHING here is
// on-chain governance — votes are a LOCAL demo until Adrian freezes the design.
//
// ── THE ANTI-REDEPLOY PIECE ──────────────────────────────────────────────────
// Every tunable number (cohort points, the reaper crown, the seniority thresholds,
// quorum, seconds-required…) lives in govern-params.json in the cubist-souls-assets
// repo, served by raw.githubusercontent. The page fetches it CLIENT-SIDE with
// cache:"no-cache" + a timestamp buster, so editing the JSON and pushing changes the
// page in seconds — no rebuild, no redeploy. Bump `version` on every edit; the page
// footer shows "params vN" so we always know which numbers are live.

import type { PublicClient } from "viem";
import { loadSouls } from "./souls";
import { loadCohorts, getReaperState, loadRarity } from "./reaper";
import {
  MH_BASE,
  MH_COHORT_MULT,
  MH_COHORT_NAME,
  inheritedMHOf,
  provenanceBonusOf,
} from "./mh";

// ── Params ───────────────────────────────────────────────────────────────────

/// A layer-decomposed power figure (Order crown / cohort base / seniority stars),
/// so a tally can be drawn as "the pyramid voting" rather than one flat number.
export type LayerPower = { order: number; cohort: number; senior: number };

export type BallotOption = {
  label: string;
  sub?: string;
  value: number | string;
  seed?: LayerPower; // demo tally while votes are local-only
};

/// A STANDING VOTE: a question the pyramid answers again and again on a cadence,
/// over a set of options the museum wrote. The pyramid picks BETWEEN options — it
/// never writes a value — which is what keeps a bad night from breaking anything.
/// Defining one is an edit to govern-params.json: no redeploy, no cut.
export type Ballot = {
  key: string;
  question: string;
  cadence: string;
  options: BallotOption[];
  applies?: string; // public documentation of the exact call the museum will make
  onchain?: boolean; // true when applying it produces a transaction (default: true)
  seedSouls?: number;
};

/// One applied result, with the transaction that applied it. This is what turns
/// "the museum executes the result" into something auditable.
export type LedgerEntry = {
  key: string;
  date: string;
  winner: string;
  souls?: number;
  tx?: string;
};

export type GovernParams = {
  version: number;
  cohortPts: { og: number; eraI: number; eraII: number };
  reaperCrown: number;
  seniorityTiers: number[]; // ascending MH thresholds; +1 star per tier crossed
  quorumSouls: number;
  secondsRequired: number;
  salonCadence: string;
  brakeHours: number;
  ballots: Ballot[];
  ledger: LedgerEntry[];
};

/// Drop anything malformed rather than rendering NaNs or empty ballots: this JSON
/// is hand-edited in another repo, so the page must survive a typo.
function sanitizeBallots(raw: unknown): Ballot[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((b) => {
    if (!b || typeof b !== "object") return [];
    const o = b as Partial<Ballot>;
    const options = Array.isArray(o.options)
      ? o.options.filter((x) => x && typeof x.label === "string" && x.value !== undefined)
      : [];
    if (!o.key || !o.question || options.length < 2) return [];
    return [
      {
        key: String(o.key),
        question: String(o.question),
        cadence: String(o.cadence ?? ""),
        options,
        applies: o.applies ? String(o.applies) : undefined,
        onchain: o.onchain !== false,
        seedSouls: Number(o.seedSouls) || 0,
      },
    ];
  });
}

function sanitizeLedger(raw: unknown): LedgerEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    if (!e || typeof e !== "object") return [];
    const o = e as Partial<LedgerEntry>;
    if (!o.key || !o.winner) return [];
    return [
      {
        key: String(o.key),
        date: String(o.date ?? ""),
        winner: String(o.winner),
        souls: Number(o.souls) || undefined,
        tx: o.tx ? String(o.tx) : undefined,
      },
    ];
  });
}

// Ratified defaults (PLAN §pirámide). Used verbatim as the fallback if the remote
// JSON is ever unreachable, so the page always renders sane numbers.
export const DEFAULT_PARAMS: GovernParams = {
  version: 0,
  cohortPts: { og: 4, eraI: 2, eraII: 1 },
  reaperCrown: 3,
  seniorityTiers: [1000, 5000, 15000, 40000, 100000],
  quorumSouls: 400,
  secondsRequired: 2,
  salonCadence: "monthly",
  brakeHours: 72,
  ballots: [],
  ledger: [],
};

const PARAMS_URL =
  "https://raw.githubusercontent.com/adriangallery/cubist-souls-assets/main/govern/govern-params.json";

// Fetch the hot params CLIENT-SIDE, cache-busted, so a push to the assets repo is
// reflected in seconds without a redeploy. Any failure falls back to DEFAULT_PARAMS
// (version stays 0 so the footer signals "defaults, remote unreachable").
export async function fetchGovernParams(): Promise<GovernParams> {
  try {
    const r = await fetch(`${PARAMS_URL}?t=${Date.now()}`, { cache: "no-cache" });
    if (!r.ok) return DEFAULT_PARAMS;
    const j = (await r.json()) as Partial<GovernParams>;
    // Merge over defaults so a partial/older JSON never yields NaNs downstream.
    return {
      ...DEFAULT_PARAMS,
      ...j,
      cohortPts: { ...DEFAULT_PARAMS.cohortPts, ...(j.cohortPts || {}) },
      seniorityTiers: Array.isArray(j.seniorityTiers) ? j.seniorityTiers : DEFAULT_PARAMS.seniorityTiers,
      ballots: sanitizeBallots(j.ballots),
      ledger: sanitizeLedger(j.ledger),
    };
  } catch {
    return DEFAULT_PARAMS;
  }
}

// ── The power formula (PLAN §fórmula por soul) ───────────────────────────────
// poder = ptsCohorte × (esReaper ? crown : 1) + estrellas(MH_soul)
//
// Cohort ids (on-chain cohortOf): 0 = OG, 1 = Era I, 2..4 = Era II+ (they collapse
// to the same 1 pt — "Era II+" in the plan).
export function cohortPtsOf(cohort: number, p: GovernParams): number {
  if (cohort <= 0) return p.cohortPts.og;
  if (cohort === 1) return p.cohortPts.eraI;
  return p.cohortPts.eraII;
}

export function cohortKey(cohort: number): "og" | "eraI" | "eraII" {
  if (cohort <= 0) return "og";
  if (cohort === 1) return "eraI";
  return "eraII";
}

// Seniority stars: +1 per threshold the soul's accumulated MH has crossed, capped at
// the number of tiers (5). The stars are SOUL-BOUND (this soul's own hours), so a
// wallet split can never farm them.
export function starsOf(soulMH: number, p: GovernParams): number {
  let s = 0;
  for (const t of p.seniorityTiers) if (soulMH >= t) s++;
  return s;
}

// The soul-bound power of one soul. Everything the page shows per-soul comes from here.
export function powerOfSoul(
  cohort: number,
  isReaper: boolean,
  soulMH: number,
  p: GovernParams,
): number {
  return cohortPtsOf(cohort, p) * (isReaper ? p.reaperCrown : 1) + starsOf(soulMH, p);
}

// ── Per-soul MH (soul-bound seniority input) ─────────────────────────────────
// The soul's OWN accumulated Museum Hours = per-soul rate × hours held by the current
// wallet. Uses the RATIFIED MH formula constants from lib/mh (cohort × rarity ×
// provenance + inherited), WITHOUT the wallet-level liberator multiplier — stars are
// a property of the token, not of who holds it. Buying a soul does NOT inherit the
// previous owner's hours (same rule as the live MH board), so "held by this wallet"
// is the correct clock.
async function getBlockTimestamps(client: PublicClient, blocks: number[]): Promise<Map<number, number>> {
  const uniq = [...new Set(blocks.filter((b) => b != null))];
  const out = new Map<number, number>();
  let i = 0;
  const worker = async () => {
    while (i < uniq.length) {
      const b = uniq[i++];
      try {
        const blk = await client.getBlock({ blockNumber: BigInt(b) });
        if (blk?.timestamp) out.set(b, Number(blk.timestamp));
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: Math.min(10, uniq.length || 1) }, worker));
  return out;
}

export type SoulPower = {
  id: number;
  cohort: number;
  cohortName: string;
  cohortKey: "og" | "eraI" | "eraII";
  cohortPts: number;
  isReaper: boolean;
  consumed: number;
  soulMH: number;
  stars: number;
  power: number;
};

export type WalletPower = {
  total: number;
  heldCount: number;
  souls: SoulPower[]; // sorted by power desc
  // layer totals — the pyramid's own share of this wallet's power
  cohortBase: number; // Σ cohortPts (before crown)
  crownBonus: number; // extra power the reaper crown adds
  starTotal: number; // Σ stars
  reaperCount: number;
  byCohort: { og: number; eraI: number; eraII: number }; // soul counts per band
};

// Load one wallet's full soul-bound power breakdown, client-side (same RPC path as
// /my-souls: loadSouls → loadCohorts + getReaperState + rarity + acquisition block
// timestamps). Returns per-soul rows plus the layer aggregates the page bars use.
export async function loadWalletPower(
  client: PublicClient,
  account: string,
  p: GovernParams,
): Promise<WalletPower> {
  const empty: WalletPower = {
    total: 0,
    heldCount: 0,
    souls: [],
    cohortBase: 0,
    crownBonus: 0,
    starTotal: 0,
    reaperCount: 0,
    byCohort: { og: 0, eraI: 0, eraII: 0 },
  };

  const d = await loadSouls(client, account);
  const owned = d.owned;
  if (!owned.length) return empty;

  const [cohorts, reaperMap, rarity] = await Promise.all([
    loadCohorts(client, owned),
    getReaperState(client, owned),
    loadRarity(),
  ]);
  const blockTs = await getBlockTimestamps(
    client,
    owned.map((id) => d.acq[id]).filter((b) => b != null),
  );

  const now = Math.floor(Date.now() / 1000);
  const tierOf = (id: number) => (rarity ? Number(rarity.tiers[id - 1]) || 0 : 0);
  const rarityMult = (id: number) => rarity?.tierMultipliers?.[tierOf(id)] ?? 1.0;

  const souls: SoulPower[] = owned.map((id) => {
    const cohort = cohorts.get(id) ?? 3;
    const rs = reaperMap.get(id);
    const isReaper = rs?.isReaper ?? false;
    const consumed = rs?.consumed ?? 0;
    // ratified per-soul MH rate (cohort × rarity × provenance + inherited)
    const rate =
      MH_BASE * (MH_COHORT_MULT[cohort] ?? 1.0) * rarityMult(id) * provenanceBonusOf(tierOf(id)) +
      inheritedMHOf(consumed);
    const acqTs = blockTs.get(d.acq[id]) ?? now;
    const soulMH = rate * Math.max(0, (now - acqTs) / 3600);
    const cp = cohortPtsOf(cohort, p);
    const stars = starsOf(soulMH, p);
    const power = cp * (isReaper ? p.reaperCrown : 1) + stars;
    return {
      id,
      cohort,
      cohortName: MH_COHORT_NAME[cohort] ?? "Era",
      cohortKey: cohortKey(cohort),
      cohortPts: cp,
      isReaper,
      consumed,
      soulMH,
      stars,
      power,
    };
  });
  souls.sort((a, b) => b.power - a.power || b.soulMH - a.soulMH || a.id - b.id);

  const out: WalletPower = { ...empty, heldCount: owned.length, souls };
  for (const s of souls) {
    out.total += s.power;
    out.cohortBase += s.cohortPts;
    out.crownBonus += s.isReaper ? s.cohortPts * (p.reaperCrown - 1) : 0;
    out.starTotal += s.stars;
    if (s.isReaper) out.reaperCount++;
    out.byCohort[s.cohortKey]++;
  }
  return out;
}
