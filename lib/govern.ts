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
import { loadCohorts, getReaperState, loadRarity, SOULS, VAULT_ABI } from "./reaper";
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
  /** Set when the soul sits inside a reaper's 6551 vault this wallet commands
   *  (the value is that reaper's id). Control follows ownerOf(reaperId). */
  viaVault?: number;
};

export type WalletPower = {
  total: number;
  heldCount: number; // every soul the wallet commands: direct + inside its reapers' vaults
  souls: SoulPower[]; // sorted by power desc
  // layer totals — the pyramid's own share of this wallet's power
  cohortBase: number; // Σ cohortPts (before crown)
  crownBonus: number; // extra power the reaper crown adds
  starTotal: number; // Σ stars
  reaperCount: number;
  vaultSouls: number; // how many of heldCount live inside 6551 reaper vaults
  byCohort: { og: number; eraI: number; eraII: number }; // soul counts per band
};

// The 6551 vault addresses behind a set of ASCENDED reapers. The gate lives
// on-chain (reaperAccount reverts for regular souls — allowFailure skips them);
// only DEPLOYED vaults come back, because an undeployed one can't hold souls.
async function getVaultAccounts(
  client: PublicClient,
  reaperIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!reaperIds.length) return out;
  const res = await client.multicall({
    allowFailure: true,
    contracts: reaperIds.map((id) => ({
      address: SOULS,
      abi: VAULT_ABI,
      functionName: "reaperAccount" as const,
      args: [BigInt(id)] as const,
    })),
  });
  res.forEach((r, i) => {
    if (r.status !== "success") return;
    const [account, deployed] = r.result as readonly [`0x${string}`, boolean];
    if (deployed && account !== "0x0000000000000000000000000000000000000000")
      out.set(reaperIds[i], account.toLowerCase());
  });
  return out;
}

// Load one wallet's full soul-bound power breakdown, client-side (same RPC path as
// /my-souls: loadSouls → loadCohorts + getReaperState + rarity + acquisition block
// timestamps). Returns per-soul rows plus the layer aggregates the page bars use.
//
// SOULS INSIDE THE VAULTS COUNT (Adrian, 23-ago): a wallet's power is every
// soul it COMMANDS — the ones it holds directly plus the ones sitting inside
// the 6551 vaults of its own reapers (control follows ownerOf(reaperId), and
// AccountV3 blocks ownership cycles, so one level of vaults is the whole
// tree). Each vault soul's MH clock runs from when the VAULT acquired it —
// same held-by-current-owner rule as everywhere else. The vault address
// itself can never sign a ballot (it's a contract), so counting its souls
// under the commanding wallet is what makes those souls exist to the tally.
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
    vaultSouls: 0,
    byCohort: { og: 0, eraI: 0, eraII: 0 },
  };

  const d = await loadSouls(client, account);
  const owned = d.owned;
  // No direct souls → no reapers either (a reaper IS a soul), so no vaults.
  if (!owned.length) return empty;

  const [cohortsDirect, reaperDirect, rarity] = await Promise.all([
    loadCohorts(client, owned),
    getReaperState(client, owned),
    loadRarity(),
  ]);

  // The vaults of the crowned souls this wallet holds, and what stands inside.
  const crowned = owned.filter((id) => reaperDirect.get(id)?.isReaper);
  const vaults = await getVaultAccounts(client, crowned);
  const viaVault = new Map<number, number>(); // soulId → commanding reaperId
  const acq: Record<number, number> = { ...d.acq };
  const vaultLoads = await Promise.all(
    [...vaults.entries()].map(([rid, addr]) =>
      loadSouls(client, addr)
        .then((sd) => ({ rid, sd }))
        // A failed vault read drops that vault for this render rather than the
        // whole panel; the next poll retries.
        .catch(() => null),
    ),
  );
  const directSet = new Set(owned);
  const vaultIds: number[] = [];
  for (const v of vaultLoads) {
    if (!v) continue;
    for (const id of v.sd.owned) {
      if (directSet.has(id) || viaVault.has(id)) continue;
      viaVault.set(id, v.rid);
      vaultIds.push(id);
      acq[id] = v.sd.acq[id];
    }
  }

  const [cohortsVault, reaperVault] = vaultIds.length
    ? await Promise.all([loadCohorts(client, vaultIds), getReaperState(client, vaultIds)])
    : [new Map<number, number>(), new Map<number, { isReaper: boolean; consumed: number }>()];

  const allIds = [...owned, ...vaultIds];
  const cohortOf = (id: number) => cohortsDirect.get(id) ?? cohortsVault.get(id) ?? 3;
  const reaperOf = (id: number) => reaperDirect.get(id) ?? reaperVault.get(id);

  const blockTs = await getBlockTimestamps(
    client,
    allIds.map((id) => acq[id]).filter((b) => b != null),
  );

  const now = Math.floor(Date.now() / 1000);
  const tierOf = (id: number) => (rarity ? Number(rarity.tiers[id - 1]) || 0 : 0);
  const rarityMult = (id: number) => rarity?.tierMultipliers?.[tierOf(id)] ?? 1.0;

  const souls: SoulPower[] = allIds.map((id) => {
    const cohort = cohortOf(id);
    const rs = reaperOf(id);
    const isReaper = rs?.isReaper ?? false;
    const consumed = rs?.consumed ?? 0;
    // ratified per-soul MH rate (cohort × rarity × provenance + inherited)
    const rate =
      MH_BASE * (MH_COHORT_MULT[cohort] ?? 1.0) * rarityMult(id) * provenanceBonusOf(tierOf(id)) +
      inheritedMHOf(consumed);
    const acqTs = blockTs.get(acq[id]) ?? now;
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
      viaVault: viaVault.get(id),
    };
  });
  souls.sort((a, b) => b.power - a.power || b.soulMH - a.soulMH || a.id - b.id);

  const out: WalletPower = { ...empty, heldCount: allIds.length, souls };
  for (const s of souls) {
    out.total += s.power;
    out.cohortBase += s.cohortPts;
    out.crownBonus += s.isReaper ? s.cohortPts * (p.reaperCrown - 1) : 0;
    out.starTotal += s.stars;
    if (s.isReaper) out.reaperCount++;
    if (s.viaVault !== undefined) out.vaultSouls++;
    out.byCohort[s.cohortKey]++;
  }
  return out;
}
