// Museum Hours engine — hidden soft-staking preview, ONLY reachable via ?mh=1.
// Ported 1:1 from my-souls.html (formula RATIFIED by Adrian). The math must be
// identical to the live page (Δ=0 vs 0x4943), only the reads move to viem.
//
//   per-soul rate/h = MH_BASE(1) × cohortMult × rarityMult
//   wallet MH       = liberatorMult × Σ (rate/h × hoursHeld since acquisition)
//   wallet rate/h   = liberatorMult × Σ rate/h
// Buying a soul does NOT inherit the previous owner's hours.

import type { PublicClient } from "viem";
import { parseAbiItem, zeroAddress } from "viem";
import { SOULS, getLogsRange } from "./souls";

export const MH_BASE = 1.0;
export const MH_COHORT_MULT = [2.0, 1.5, 1.25, 1.0, 1.0]; // OG · Era I · II · III · IV
export const MH_COHORT_NAME = ["OG", "Era I", "Era II", "Era III", "Era IV"];
const MH_RARITY_FALLBACK_MULT = [1.0, 1.15, 1.3, 1.5, 2.0];
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
  rate: number;
  raritySeal?: string;
  rankTxt?: string;
};
export type MHBoardRow = { rank: number; addr: string; mh: number; isMe: boolean; gap?: boolean };
export type MHAchievement = { ic: string; nm: string; ds: string; state: "earned" | "locked" | "" };
export type MHResult = {
  me: { mh: number; rate: number; heldCount: number; lib: { name: string; mult: number }; freed: number };
  ownedCount: number;
  exhibits: MHExhibit[];
  board: MHBoardRow[];
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

export async function buildMH(
  client: PublicClient,
  account: string,
  owned: number[],
  freed: number,
): Promise<MHResult> {
  const acct = account.toLowerCase();
  const [rarity, xfers] = await Promise.all([getRarity(), getTransfers(client)]);

  // current owner + acquisition block per token, and souls freed per wallet
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
  const [cohorts, blockTs] = await Promise.all([
    getCohorts(client, allIds),
    getBlockTimestamps(
      client,
      [...new Set(allIds.map((id) => lastXfer.get(id)?.block).filter(Boolean) as number[])],
    ),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const rMult = Array.isArray(rarity?.tierMultipliers) ? rarity!.tierMultipliers! : MH_RARITY_FALLBACK_MULT;
  const tierOfId = (id: number) => (rarity ? Number(rarity.tiers![id - 1]) || 0 : 0);
  const tokenRate = (id: number) =>
    MH_BASE * (MH_COHORT_MULT[cohorts.get(id) ?? 3] ?? 1.0) * (rMult[tierOfId(id)] ?? 1.0);
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
  const me = meIdx >= 0 ? boardAll[meIdx] : compute(owned, freed);

  // ── exhibits (connected wallet's held souls, ascending) ──
  const exhibits: MHExhibit[] = owned.map((id) => {
    const co = cohorts.get(id) ?? 3;
    const tier = tierOfId(id);
    const rankTxt =
      rarity && Array.isArray(rarity.ranks) && rarity.ranks[id - 1] != null
        ? `Rarity rank #${Number(rarity.ranks[id - 1]).toLocaleString("en-US")} of 10,000`
        : undefined;
    const raritySeal = rarity
      ? `${rarity.tierEmoji?.[tier] || ""} ${rarity.tierNames?.[tier] || "Tier " + tier}`.trim()
      : undefined;
    return { id, cohortName: MH_COHORT_NAME[co], rate: tokenRate(id), raritySeal, rankTxt };
  });

  // ── leaderboard: top 20 + connected wallet's own row (with gap if beyond 20) ──
  const board: MHBoardRow[] = boardAll
    .slice(0, 20)
    .map((r, i) => ({ rank: i + 1, addr: short(r.w), mh: r.mh, isMe: r.w === acct }));
  if (meIdx >= 20) {
    board.push({ rank: meIdx + 1, addr: short(acct), mh: me.mh, isMe: true, gap: true });
  } else if (meIdx < 0) {
    board.push({ rank: boardAll.length + 1, addr: short(acct), mh: me.mh, isMe: true, gap: true });
  }

  // ── achievements ──
  const held = me.ids;
  const ownsOG = held.some((id) => (cohorts.get(id) ?? 3) === 0);
  const ownsMaster = !!rarity && held.some((id) => tierOfId(id) === 4);
  const oldest = held.length ? Math.max(...held.map((id) => now - acqTs(id))) : 0;
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
    .map((a) => ({
      ic: a.ic,
      nm: a.nm,
      ds: a.ds,
      state: a.locked ? "locked" : a.earned ? "earned" : "",
    }));

  return {
    me: { mh: me.mh, rate: me.rate, heldCount: me.ids.length, lib: me.lib, freed: me.freed },
    ownedCount: owned.length,
    exhibits,
    board,
    achievements,
  };
}
