// Museum Hours engine — soft-staking preview, now public on /my-souls.
// Ported 1:1 from my-souls.html (formula RATIFIED by Adrian). The math must be
// identical to the live page (Δ=0 vs 0x4943), only the reads move to viem.
//
// Split in two: buildMyMH (cheap — your hours, seconds) renders the hero right
// away; buildBoard (heavy — the full leaderboard) runs after so a slow/failing
// collection scan never blocks or hides your own numbers.
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

// ── LAUNCH FACTORS (Adrian 26-jul, ratified) — ADDED on top of the intact base
// formula; NEVER replace cohortMult/rarityMult. Applied per soul, CONSISTENTLY in
// buildMyMH (hero) and buildBoard (leaderboard) so a wallet's number matches (Δ=0).
//
//  Reaper multiplier by that soul's OWN souls-consumed: ≥6 ×1.5 · ≥18 ×2.0 · ≥30 ×4.0.
//  (Raised by Adrian 26-jul noche — "más bestia": the old 1.2/1.5/2.0 left a full Soul
//   Reaper below a passive Masterpiece. With ×4 a #8777 full = 9.66 MH/h/soul, dominant.)
//  (Consumed souls "pay" the wallet's contribution via THIS multiplier — MH does not
//   also count them in the liberator tier, which stays on freed. No double-count.)
const MH_REAPER_TIERS = [
  { min: 30, mult: 4.0 },
  { min: 18, mult: 2.0 },
  { min: 6, mult: 1.5 },
];
export function reaperMultOf(consumed: number): number {
  for (const t of MH_REAPER_TIERS) if (consumed >= t.min) return t.mult;
  return 1.0;
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
export type MHBoardResult = { rows: MHBoardRow[]; myRank: number; totalLibs: number; myContribution: number };
export type MHAchievement = { ic: string; nm: string; ds: string; state: "earned" | "locked" | "" };
export type MHMe = {
  mh: number;
  rate: number;
  heldCount: number;
  lib: { name: string; mult: number };
  freed: number;
  // launch-factor summary for the hero chips (only shown when they apply)
  reaperCount: number; // owned souls empowered by a Reaper mult (consumed ≥6)
  maxReaperMult: number; // top Reaper mult among owned (1.0 = none)
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
  const reaperMult = (id: number) => (launch ? reaperMultOf(consumedOf(id)) : 1.0);
  const provBonus = (id: number) => (launch ? provenanceBonusOf(tierOfId(id)) : 1.0);
  // base formula (cohort × rarity) × the ratified launch factors (reaper × provenance)
  const tokenRate = (id: number) =>
    MH_BASE *
    (MH_COHORT_MULT[cohorts.get(id) ?? 3] ?? 1.0) *
    (rMult[tierOfId(id)] ?? 1.0) *
    reaperMult(id) *
    provBonus(id);
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
  let maxReaperMult = 1.0;
  let maxProvBonus = 0;
  if (launch) {
    for (const id of owned) {
      const rm = reaperMultOf(consumedOf(id));
      if (rm > 1) reaperCount++;
      if (rm > maxReaperMult) maxReaperMult = rm;
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
    maxReaperMult,
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

  return { me, ownedCount: owned.length, exhibits, achievements };
}

/**
 * HEAVY pass — the curators' leaderboard. This is the expensive one (every
 * Transfer on the diamond + cohortOf of every held soul + getBlock of every
 * acquisition block), so it runs AFTER the cheap pass, in the background: the
 * hero shows in seconds and the board fills in a moment later. If it fails
 * (public-RPC rate limit on the getBlock storm) only the board is missing.
 *
 * `meMh` (from the cheap pass) is used verbatim for the connected wallet's row,
 * so the number on the board always matches the hero even if a background rarity
 * refetch differs. Ranking still uses the board's own self-consistent tally.
 */
export async function buildBoard(
  client: PublicClient,
  account: string,
  owned: number[],
  freed: number,
  meMh: number,
  reaperLive = false,
): Promise<MHBoardResult> {
  const acct = account.toLowerCase();
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
  // authoritative override for the connected wallet (ownerOf-derived set + verified freed)
  holdings.set(acct, owned.slice());
  freedBy.set(acct, freed);

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
  const reaperMult = (id: number) => (reaperLive ? reaperMultOf(consumedOf(id)) : 1.0);
  const provBonus = (id: number) => (reaperLive ? provenanceBonusOf(tierOfId(id)) : 1.0);
  const tokenRate = (id: number) =>
    MH_BASE *
    (MH_COHORT_MULT[cohorts.get(id) ?? 3] ?? 1.0) *
    (rMult[tierOfId(id)] ?? 1.0) *
    reaperMult(id) *
    provBonus(id);
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
    return { ids, freed: fr || 0, lib, rate: rate * lib.mult, mh: mh * lib.mult };
  }

  const boardAll = [...holdings.entries()]
    .map(([w, ids]) => ({ w, ...compute(ids, freedBy.get(w) || 0) }))
    .sort((a, b) => b.mh - a.mh);
  const meIdx = boardAll.findIndex((r) => r.w === acct);

  // top 20 + connected wallet's own row (with gap if beyond 20). The me row's MH
  // is the value from the cheap pass so hero and board never disagree.
  const rows: MHBoardRow[] = boardAll
    .slice(0, 20)
    .map((r, i) => ({ rank: i + 1, addr: short(r.w), mh: r.w === acct ? meMh : r.mh, isMe: r.w === acct }));
  if (meIdx >= 20) {
    rows.push({ rank: meIdx + 1, addr: short(acct), mh: meMh, isMe: true, gap: true });
  } else if (meIdx < 0) {
    rows.push({ rank: boardAll.length + 1, addr: short(acct), mh: meMh, isMe: true, gap: true });
  }

  // ── Deck rank + tier by TOTAL contribution = freed + consumed (Adrian 26-jul:
  // "ofrendar no puede hacer perder rango vs convertir"). consumed per wallet =
  // Σ soulsConsumed over the souls it currently holds (same "sum by holder" as The
  // Order — consumed travels with the token). Liberators = anyone with any
  // contribution (freed OR consumed). Exact here because we already enumerate every
  // holding; the deck shows the instant freed-rank until this lands (Δ=0 when
  // consumed==0, which is the case for all but a handful at launch).
  const contribBy = new Map<string, number>();
  for (const [w, fr] of freedBy) contribBy.set(w, (contribBy.get(w) || 0) + fr);
  for (const [w, ids] of holdings) {
    const c = ids.reduce((s, id) => s + consumedOf(id), 0);
    if (c) contribBy.set(w, (contribBy.get(w) || 0) + c);
  }
  const contribRanked = [...contribBy.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const myContribution = contribBy.get(acct) || 0;
  const myRank = contribRanked.findIndex(([w]) => w === acct) + 1;
  const totalLibs = contribRanked.length;

  return { rows, myRank: myRank || totalLibs + 1, totalLibs, myContribution };
}
