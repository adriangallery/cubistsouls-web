// Museum Hours engine — soft-staking preview, now public on /my-souls.
// Ported 1:1 from my-souls.html (formula RATIFIED by Adrian). The math must be
// identical to the live page (Δ=0 vs 0x4943), only the reads move to viem.
//
// Split in two: buildMyMH (cheap — your hours, seconds) renders the hero right
// away, CLIENT-side and live; the heavy leaderboard (computeBoardData) now runs
// SERVER-side, cached to a 5-min snapshot (app/api/board), and the browser just
// fetches it + slices its own row via boardForAccount — no per-visitor scan.
//
//   per-soul rate/h = MH_BASE(1) × cohortMult × rarityMult
//   wallet MH       = liberatorMult × Σ (rate/h × hoursHeld since acquisition)
//   wallet rate/h   = liberatorMult × Σ rate/h
// Buying a soul does NOT inherit the previous owner's hours.

import type { PublicClient } from "viem";
import { parseAbiItem, zeroAddress } from "viem";
import { SOULS, getLogsRange } from "./souls";
import { getConsumedMap } from "./reaper";

export const MH_BASE = 1.0;
export const MH_COHORT_MULT = [2.0, 1.5, 1.25, 1.0, 1.0]; // OG · Era I · II · III · IV
export const MH_COHORT_NAME = ["OG", "Era I", "Era II", "Era III", "Era IV"];
const MH_RARITY_FALLBACK_MULT = [1.0, 1.15, 1.3, 1.5, 2.0];

// ── LAUNCH FACTORS (Adrian, ratified) — ADDED on top of the intact base formula;
// NEVER replace cohortMult/rarityMult. Applied per soul, CONSISTENTLY in buildMyMH
// (hero) and buildBoard (leaderboard) so a wallet's number matches (Δ=0).
//
//  INHERITANCE (Adrian 28-jul, AskUserQuestion, on the accountant's model) — ADDITIVE,
//  REPLACES the old ×1.5/×2/×4 Reaper multiplier. A reaper KEEPS the hours of the souls
//  it consumed: +1.0 MH/h per soul consumed, capped at 60. Reasons: under ×4, ascending
//  gave +6.8 MH/h vs +42.4 for converting (6× worse — nobody ascended), and the ×4 mult
//  degenerated with rare OGs (a full Masterpiece won a 20 MH/h lottery). Inheritance is
//  flat, effort-linked, fair. HARD CEILING documented by the accountant: λ must NEVER
//  exceed 1.41 (the Era II rate) — above it, burning Pikkazos would be the cheapest MH,
//  a degenerate sink. Consumption over 60 still counts for Order/rank but yields no more MH.
export const INHERIT_PER_SOUL = 1.0;
export const INHERIT_CAP = 60;
export function inheritedMHOf(consumed: number): number {
  return Math.min(consumed, INHERIT_CAP) * INHERIT_PER_SOUL;
}
//  Provenance bonus by the soul's FROZEN (born) rarity tier — applied as a factor:
//  Collection 0 · Catalogued +5% · Featured +10% · Exhibition +15% · Masterpiece +25%.
export const MH_PROVENANCE_BONUS = [1.0, 1.05, 1.1, 1.15, 1.25]; // by tier 0..4
export function provenanceBonusOf(tier: number): number {
  return MH_PROVENANCE_BONUS[tier] ?? 1.0;
}
const MH_LIB_TIERS = [
  { min: 50, name: "Founding Patron", mult: 1.3 },
  { min: 20, name: "Patron", mult: 1.2 },
  { min: 5, name: "Curator", mult: 1.1 },
  { min: 1, name: "Liberator", mult: 1.05 },
  { min: 0, name: "Visitor", mult: 1.0 },
];
const MH_ZERO = zeroAddress.toLowerCase();
const MH_RARITY_URL =
  "https://raw.githubusercontent.com/adriangallery/cubist-souls-assets/main/rarity/rarity.json";
const COHORT_ABI = [parseAbiItem("function cohortOf(uint256 tokenId) view returns (uint8)")] as const;

function mhLibOf(freed: number) {
  return MH_LIB_TIERS.find((t) => freed >= t.min)!;
}

type Rarity = {
  tiers?: string;
  ranks?: number[];
  tierMultipliers?: number[];
  tierNames?: string[];
  tierEmoji?: string[];
} | null;

export type MHExhibit = {
  id: number;
  cohortName: string;
  cohort: number; // 0..4 (OG … Era IV) — for sorting/filtering on the cards
  rate: number;
  tier?: number; // rarity tier 0..4 when rarity.json is reachable
  rank?: number; // rarity rank (1 = rarest) — numeric, for sorting
  raritySeal?: string;
  rankTxt?: string;
};
export type MHBoardRow = { rank: number; addr: string; mh: number; isMe: boolean; gap?: boolean };
// The board pass also resolves the deck's rank/tier by TOTAL contribution
// (freed + consumed) — see buildBoard. Returned alongside the rows so my-souls
// upgrades the plaque from the instant freed-based rank to the exact one.
export type MHBoardResult = {
  rows: MHBoardRow[];
  myRank: number;
  totalLibs: number;
  myContribution: number;
  totalRate: number; // Σ MH/h across every wallet — for "your share of the museum's emission"
};

// ── Account-AGNOSTIC leaderboard — computed ONCE server-side and cached (see
// app/api/board/route.ts), instead of recomputed in every visitor's browser. One
// row per wallet, ranked by MH desc, carrying the full (lowercase) address so any
// client can locate its own row by a pure string match — no on-chain re-scan. The
// mh/rate figures are the CACHED snapshot: the client renders them verbatim with an
// "updated Nm ago" caption (the whole point of moving the board off the client is
// that it no longer costs a full collection scan + RPC burst per page view).
export type BoardWalletRow = { rank: number; raw: string; addr: string; mh: number; rate: number };
export type BoardData = {
  rows: BoardWalletRow[]; // every wallet, ranked by MH desc
  contrib: { raw: string; contribution: number }[]; // ranked by contribution (freed+consumed) desc, >0 only
  totalRate: number; // Σ MH/h across every wallet
  totalLibs: number; // distinct contributors (freed OR consumed)
  updatedAt: number; // ms epoch the snapshot was computed (stamped by the route)
};
export type MHAchievement = { ic: string; nm: string; ds: string; state: "earned" | "locked" | "" };
export type MHMe = {
  mh: number;
  rate: number;
  heldCount: number;
  lib: { name: string; mult: number };
  freed: number;
  // launch-factor summary for the hero chips (only shown when they apply)
  reaperCount: number; // owned souls carrying the fire (consumed > 0)
  inheritedMH: number; // Σ min(consumed, 60) over owned — the additive MH/h inherited
  maxProvBonus: number; // top Provenance bonus among owned, as a % (0 = none)
};

// The CHEAP pass — everything about YOU (hero + exhibits + achievements). Reads
// only your souls (cohortOf of your held ids + getBlock of your acquisition
// blocks), so it returns in seconds. The leaderboard is a separate heavy pass.
export type MyMHResult = {
  me: MHMe;
  ownedCount: number;
  exhibits: MHExhibit[];
  achievements: MHAchievement[];
  // Oldest acquisition among held souls (the block timestamps are already fetched
  // for the MH math, so this costs no extra RPC) — powers "member since".
  memberSince: { id: number; block: number; ts: number } | null;
};

async function getRarity(): Promise<Rarity> {
  try {
    const r = await fetch(MH_RARITY_URL, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.tiers === "string" ? j : null;
  } catch {
    return null;
  }
}

// All Transfer logs on the diamond (both directions) → [block, index, from, to, id].
async function getTransfers(client: PublicClient) {
  const logs = await getLogsRange(client, {});
  return logs.map(
    (l) =>
      [
        Number(l.blockNumber),
        Number(l.logIndex),
        String(l.args.from).toLowerCase(),
        String(l.args.to).toLowerCase(),
        Number(l.args.tokenId),
      ] as const,
  );
}

async function getCohorts(client: PublicClient, ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const res = await client.multicall({
      allowFailure: true,
      contracts: chunk.map((id) => ({
        address: SOULS as `0x${string}`,
        abi: COHORT_ABI,
        functionName: "cohortOf" as const,
        args: [BigInt(id)] as const,
      })),
    });
    res.forEach((r, j) => out.set(chunk[j], r.status === "success" ? Number(r.result) : 3));
  }
  return out;
}

async function getBlockTimestamps(client: PublicClient, blocks: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const uniq = [...new Set(blocks)];
  const limit = 10;
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
  await Promise.all(Array.from({ length: Math.min(limit, uniq.length || 1) }, worker));
  return out;
}

const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

/**
 * CHEAP pass — your hero MH, your exhibits, your achievements. Reads only your
 * souls: cohortOf(your held ids) + getBlock(your acquisition blocks, a handful).
 * Returns in seconds; no full-collection scan. `acq` (owned id -> acquisition
 * block) comes from loadSouls, which already had the inbound transfers. The math
 * is byte-identical to the old monolithic pass for the connected wallet (same
 * formula, same per-token rate, same acquisition block).
 */
export async function buildMyMH(
  client: PublicClient,
  account: string,
  owned: number[],
  freed: number,
  acq: Record<number, number>,
  consumedById?: Map<number, number>,
  launch = false,
): Promise<MyMHResult> {
  const rarity = await getRarity();
  const [cohorts, blockTs] = await Promise.all([
    getCohorts(client, owned),
    getBlockTimestamps(client, [...new Set(Object.values(acq))]),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const rMult = Array.isArray(rarity?.tierMultipliers) ? rarity!.tierMultipliers! : MH_RARITY_FALLBACK_MULT;
  const tierOfId = (id: number) => (rarity ? Number(rarity.tiers![id - 1]) || 0 : 0);
  const consumedOf = (id: number) => consumedById?.get(id) ?? 0;
  // ratified launch factors, applied only once the fire is lit (launch flag).
  const inheritOf = (id: number) => (launch ? inheritedMHOf(consumedOf(id)) : 0);
  const provBonus = (id: number) => (launch ? provenanceBonusOf(tierOfId(id)) : 1.0);
  // base formula (cohort × rarity × provenance) PLUS the additive inheritance term.
  // (* binds tighter than +, so the base product is formed first, then inheritance added.)
  const tokenRate = (id: number) =>
    MH_BASE *
      (MH_COHORT_MULT[cohorts.get(id) ?? 3] ?? 1.0) *
      (rMult[tierOfId(id)] ?? 1.0) *
      provBonus(id) +
    inheritOf(id);
  const acqTs = (id: number) => {
    const b = acq[id];
    const ts = b != null ? blockTs.get(b) : null;
    return ts ?? now;
  };

  let rate = 0;
  let mh = 0;
  for (const id of owned) {
    const r = tokenRate(id);
    rate += r;
    mh += r * Math.max(0, (now - acqTs(id)) / 3600);
  }
  const lib = mhLibOf(freed || 0);
  // launch-factor summary for the hero chips (only rendered when they apply)
  let reaperCount = 0;
  let inheritedMH = 0;
  let maxProvBonus = 0;
  if (launch) {
    for (const id of owned) {
      const c = consumedOf(id);
      if (c > 0) reaperCount++;
      inheritedMH += inheritedMHOf(c);
      const pb = Math.round((provenanceBonusOf(tierOfId(id)) - 1) * 100);
      if (pb > maxProvBonus) maxProvBonus = pb;
    }
  }
  const me: MHMe = {
    mh: mh * lib.mult,
    rate: rate * lib.mult,
    heldCount: owned.length,
    lib,
    freed: freed || 0,
    reaperCount,
    inheritedMH,
    maxProvBonus,
  };

  const exhibits: MHExhibit[] = owned.map((id) => {
    const co = cohorts.get(id) ?? 3;
    const tier = tierOfId(id);
    const rank =
      rarity && Array.isArray(rarity.ranks) && rarity.ranks[id - 1] != null
        ? Number(rarity.ranks[id - 1])
        : undefined;
    const rankTxt = rank != null ? `Rank #${rank.toLocaleString("en-US")}` : undefined;
    const raritySeal = rarity
      ? `${rarity.tierEmoji?.[tier] || ""} ${rarity.tierNames?.[tier] || "Tier " + tier}`.trim()
      : undefined;
    return {
      id,
      cohortName: MH_COHORT_NAME[co],
      cohort: co,
      rate: tokenRate(id),
      ...(rarity ? { tier } : {}),
      ...(rank != null ? { rank } : {}),
      raritySeal,
      rankTxt,
    };
  });

  // Member since = the oldest acquisition block among held souls (ties → lowest id).
  // Reuses the block timestamps already fetched above — zero extra RPC.
  let memberSince: MyMHResult["memberSince"] = null;
  {
    let minBlock = Infinity;
    let minId = Infinity;
    for (const id of owned) {
      const b = acq[id];
      if (b == null) continue;
      if (b < minBlock || (b === minBlock && id < minId)) {
        minBlock = b;
        minId = id;
      }
    }
    if (minBlock !== Infinity) {
      const ts = blockTs.get(minBlock);
      if (ts != null) memberSince = { id: minId, block: minBlock, ts };
    }
  }

  const ownsOG = owned.some((id) => (cohorts.get(id) ?? 3) === 0);
  const ownsMaster = !!rarity && owned.some((id) => tierOfId(id) === 4);
  const oldest = owned.length ? Math.max(...owned.map((id) => now - acqTs(id))) : 0;
  const raw = [
    { ic: "🔥", nm: "Founding Liberator", ds: "Freed at least one soul", earned: freed >= 1 },
    { ic: "💯", nm: "Century Club", ds: "1,000+ Museum Hours", earned: me.mh >= 1000 },
    { ic: "🎩", nm: "Patron of the Arts", ds: "Patron tier or above", earned: freed >= 20 },
    { ic: "🏺", nm: "Keeper of a Masterpiece", ds: "Hold a Masterpiece soul", earned: ownsMaster, hide: !rarity },
    { ic: "🗿", nm: "OG Whisperer", ds: "Hold an OG-era soul", earned: ownsOG },
    { ic: "📅", nm: "Week One", ds: "Kept a soul seven days", earned: oldest >= 7 * 86400 },
    { ic: "❓", nm: "???", ds: "The museum keeps its secrets.", locked: true },
    { ic: "❓", nm: "???", ds: "The museum keeps its secrets.", locked: true },
    { ic: "❓", nm: "???", ds: "The museum keeps its secrets.", locked: true },
  ];
  const achievements: MHAchievement[] = raw
    .filter((a) => !a.hide)
    .map((a) => ({ ic: a.ic, nm: a.nm, ds: a.ds, state: a.locked ? "locked" : a.earned ? "earned" : "" }));

  return { me, ownedCount: owned.length, exhibits, achievements, memberSince };
}

/**
 * HEAVY pass — the curators' leaderboard, ACCOUNT-AGNOSTIC and computed ONCE.
 *
 * This is the expensive one (every Transfer on the diamond + cohortOf of every held
 * soul + getBlock of every acquisition block). It used to run in every visitor's
 * browser (buildBoard), which was slow for everyone and fanned out RPC on each page
 * view. It now runs SERVER-SIDE, cached to a 5-min snapshot (app/api/board), and the
 * browser just fetches the JSON — see boardForAccount for the per-wallet slice.
 *
 * No `account` param on purpose: the board is the same for everyone. Every wallet is
 * ranked from the transfer-derived holdings (the old per-connected-wallet ownerOf
 * override is gone — the snapshot treats the connected wallet exactly like the rest,
 * which is what a shared cache must do). Returns EVERY wallet (not just top 20) so a
 * client can find its own row/rank regardless of position.
 */
export async function computeBoardData(
  client: PublicClient,
  reaperLive = false,
): Promise<Omit<BoardData, "updatedAt">> {
  const [rarity, xfers] = await Promise.all([getRarity(), getTransfers(client)]);

  const lastXfer = new Map<number, { from: string; to: string; block: number }>();
  const freedBy = new Map<string, number>();
  for (const [block, index, from, to, id] of [...xfers].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    void index;
    lastXfer.set(id, { from, to, block });
    if (from === MH_ZERO) freedBy.set(to, (freedBy.get(to) || 0) + 1);
  }
  const holdings = new Map<string, number[]>();
  for (const [id, x] of lastXfer) {
    if (x.to === MH_ZERO) continue;
    if (!holdings.has(x.to)) holdings.set(x.to, []);
    holdings.get(x.to)!.push(id);
  }

  const allIds = [...new Set(([] as number[]).concat(...holdings.values()))];
  // Per-soul souls-consumed over the WHOLE held collection: drives both the Reaper
  // MH multiplier (below, same as the hero) AND the total-contribution ranking. One
  // extra multicall over the ~held set — only fired when the facet is live.
  const [cohorts, blockTs, consumedById] = await Promise.all([
    getCohorts(client, allIds),
    getBlockTimestamps(
      client,
      [...new Set(allIds.map((id) => lastXfer.get(id)?.block).filter(Boolean) as number[])],
    ),
    reaperLive ? getConsumedMap(client, allIds) : Promise.resolve(new Map<number, number>()),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const rMult = Array.isArray(rarity?.tierMultipliers) ? rarity!.tierMultipliers! : MH_RARITY_FALLBACK_MULT;
  const tierOfId = (id: number) => (rarity ? Number(rarity.tiers![id - 1]) || 0 : 0);
  const consumedOf = (id: number) => consumedById.get(id) ?? 0;
  // launch factors gated by the same flag as the hero (Δ=0 between the two views).
  const inheritOf = (id: number) => (reaperLive ? inheritedMHOf(consumedOf(id)) : 0);
  const provBonus = (id: number) => (reaperLive ? provenanceBonusOf(tierOfId(id)) : 1.0);
  // base formula (cohort × rarity × provenance) PLUS the additive inheritance term.
  const tokenRate = (id: number) =>
    MH_BASE *
      (MH_COHORT_MULT[cohorts.get(id) ?? 3] ?? 1.0) *
      (rMult[tierOfId(id)] ?? 1.0) *
      provBonus(id) +
    inheritOf(id);
  const acqTs = (id: number) => {
    const x = lastXfer.get(id);
    const ts = x ? blockTs.get(x.block) : null;
    return ts ?? now;
  };

  function compute(ids: number[], fr: number) {
    let rate = 0;
    let mh = 0;
    for (const id of ids) {
      const r = tokenRate(id);
      rate += r;
      mh += r * Math.max(0, (now - acqTs(id)) / 3600);
    }
    const lib = mhLibOf(fr || 0);
    return { rate: rate * lib.mult, mh: mh * lib.mult };
  }

  const boardAll = [...holdings.entries()]
    .map(([w, ids]) => ({ w, ...compute(ids, freedBy.get(w) || 0) }))
    .sort((a, b) => b.mh - a.mh);
  // Σ MH/h across the whole museum — the denominator for "your share of the
  // museum's hourly emission". Self-consistent with the same tally that ranks.
  const totalRate = boardAll.reduce((s, r) => s + r.rate, 0);
  const rows: BoardWalletRow[] = boardAll.map((r, i) => ({
    rank: i + 1,
    raw: r.w,
    addr: short(r.w),
    mh: r.mh,
    rate: r.rate,
  }));

  // ── Rank/tier by TOTAL contribution = freed + consumed (Adrian 26-jul: "ofrendar
  // no puede hacer perder rango vs convertir"). consumed per wallet = Σ soulsConsumed
  // over the souls it currently holds (same "sum by holder" as The Order — consumed
  // travels with the token). Liberators = anyone with any contribution (freed OR
  // consumed). Returned as a ranked list so the client resolves any wallet's rank.
  const contribBy = new Map<string, number>();
  for (const [w, fr] of freedBy) contribBy.set(w, (contribBy.get(w) || 0) + fr);
  for (const [w, ids] of holdings) {
    const c = ids.reduce((s, id) => s + consumedOf(id), 0);
    if (c) contribBy.set(w, (contribBy.get(w) || 0) + c);
  }
  const contrib = [...contribBy.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([raw, contribution]) => ({ raw, contribution }));

  return { rows, contrib, totalRate, totalLibs: contrib.length };
}

/**
 * Client adapter (NO on-chain reads) — turn the cached, account-agnostic BoardData
 * into the per-wallet MHBoardResult the dashboard consumes: top-20 rows + the
 * connected wallet's own row (with a gap marker when it sits beyond 20), plus its
 * contribution rank. The me-row's MH is the CACHED snapshot value (it can trail the
 * live hero by up to the cache TTL; my-souls renders an "updated Nm ago" caption so
 * the small delta reads as freshness, not a bug). A wallet holding nothing at
 * snapshot time simply isn't on the board — rank falls back to "last".
 */
export function boardForAccount(bd: BoardData, account: string): MHBoardResult {
  const acct = account.toLowerCase();
  const meIdx = bd.rows.findIndex((r) => r.raw === acct);
  const rows: MHBoardRow[] = bd.rows
    .slice(0, 20)
    .map((r) => ({ rank: r.rank, addr: r.addr, mh: r.mh, isMe: r.raw === acct }));
  if (meIdx >= 20) {
    const me = bd.rows[meIdx];
    rows.push({ rank: me.rank, addr: me.addr, mh: me.mh, isMe: true, gap: true });
  }
  const cIdx = bd.contrib.findIndex((c) => c.raw === acct);
  const myContribution = cIdx >= 0 ? bd.contrib[cIdx].contribution : 0;
  const myRank = cIdx >= 0 ? cIdx + 1 : bd.totalLibs + 1;
  return { rows, myRank, totalLibs: bd.totalLibs, myContribution, totalRate: bd.totalRate };
}
