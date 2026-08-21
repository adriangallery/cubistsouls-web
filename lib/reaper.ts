// Soul Reapers — shared constants, the AGREED ReaperFacet ABI, and the client-side
// on-chain logic for the /reapers rite. The facet is a cut on the SAME Cubist Souls
// diamond (0x9252…8406) — there is NO separate contract address; every reaper read
// and write targets the diamond, exactly like convert() does today.
//
// The whole file is written against the ABI ratified in
// PLAN_CUBISTSOULS_NEXT_MIGRATION.md §6-ter. It is GATED at the call sites by the
// `reaperLive` flag (public/flags.json): until the cut is on-chain the panel runs in
// preview mode and none of the reads/writes below fire. When the flag flips, this is
// the real source — nothing else changes.
//
// ⚠️ ABI ASSUMPTIONS the facet MUST honor (flagged for the facet author):
//   • marksOf(uint256) returns uint256 — BITMASK (bit i set == markId i forged),
//     as deployed on mainnet (facet 0x8fa530b6…50a5); decode to markId list client-side
//   • soulsConsumed(uint256) returns uint256
//   • markPrice(uint8) returns uint16
//   • SoulsOffered/MarkForged/ReaperAscended shapes exactly as below
// If any of these differ on the deployed facet, only this file needs to change.

import type { PublicClient } from "viem";
import { parseAbi, parseAbiItem, getAddress, keccak256, encodeAbiParameters } from "viem";

// The diamond IS the facet host. Reuse the canonical checksummed address.
export const SOULS = getAddress("0x9252fDc0b3945203314Ea1a9b8d64345bc868406");
export const PIKKAZO = getAddress("0x6478b94dfa32F3eab600970D04B34615eE97484e");
export const REAPER_DEPLOY_BLOCK = 25518546n; // diamond deploy; the cut is later, harmless lower bound

// souls consumed by one reaper to earn the "Soul Reaper #id" rename (Adrian 26-jul).
export const ASCEND_AT = 30;

// OG-ONLY (Adrian 26-jul: "Only an OG could become a Soul Reaper"). The rite is
// reserved for cohort-0 souls; the on-chain guard reverts NotOGSoul in offer/
// forgeMark for any non-OG. The web mirrors it: non-OG aspirants are shown but
// disabled with an "OG only" badge, and the CTA refuses. cohortOf(id) == 0 = OG.
export const OG_COHORT = 0;

// OpenSea, filtered to the OG cohort trait (trait_type "Cohort", value "OG" —
// see app/api/meta). Degrades to the plain collection if OpenSea ignores the
// param, so it is always a safe link to "go get an OG".
export const OPENSEA_OG_URL =
  "https://opensea.io/collection/cubist-souls?traits=" +
  encodeURIComponent(JSON.stringify([{ traitType: "Cohort", values: ["OG"] }]));

// Where to buy Pikkazos (the fuel the rite burns). Verified OpenSea slug for the
// Pikkazo contract 0x6478…484e; falls back to the contract page if the slug ever
// moves. Shown when a wallet can't afford even the cheapest mark.
export const OPENSEA_PIKKAZO_URL = "https://opensea.io/collection/pikkazonft";

// The AGREED ReaperFacet interface (contract between the web and facet workers).
export const REAPER_ABI = parseAbi([
  // writes
  "function offer(uint256 reaperId, uint256[] pikkazoIds)",
  "function forgeMark(uint256 reaperId, uint8 markId, uint256[] pikkazoIds)",
  // views
  "function soulsConsumed(uint256 reaperId) view returns (uint256)",
  "function marksOf(uint256 reaperId) view returns (uint256)",
  "function isReaper(uint256 reaperId) view returns (bool)",
  "function markPrice(uint8 markId) view returns (uint16)",
  // events
  "event SoulsOffered(uint256 indexed reaperId, address indexed offerer, uint256[] pikkazoIds, uint256 newConsumed)",
  "event MarkForged(uint256 indexed reaperId, uint8 indexed markId, uint256 cost, uint256 newConsumed)",
  "event ReaperAscended(uint256 indexed reaperId, uint256 consumed)",
]);

const SOULS_OFFERED_EVENT = parseAbiItem(
  "event SoulsOffered(uint256 indexed reaperId, address indexed offerer, uint256[] pikkazoIds, uint256 newConsumed)",
);

// ---- The Reaper marks (the ★ Burn Cube set) ---------------------------------
// markId order is ON-CHAIN CANONICAL (Adrian): 0=Orange 1=FlameCrown 2=Phoenix
// 3=BurningSoul. cost = Pikkazos burned = souls consumed. Prices are the ratified
// defaults; when reaperLive they are overwritten by markPrice() reads (owner can
// retune in the clear). Each mark SUBSTITUTES one vector layer (slot); "fx" paints
// on top of everything. Files mirror public/builder.html's official vector set.
export const T = "/assets/traits-svg";
export type Slot = "ab" | "base" | "clothes" | "head" | "mouth" | "leye" | "nose" | "reye";

export type Mark = {
  id: string; // ui key
  markId: number; // ON-CHAIN markId (uint8)
  file: string;
  name: string;
  kind: string;
  slot: Slot | "fx";
  cost: number; // default; may be overwritten by markPrice()
};

// Marks are the visual milestones of cumulative consumption (Orange 6 · Flame Crown
// 12 · Phoenix 18 · Burning Soul 30). They carry NO MH multiplier anymore: MH is now
// INHERITED additively (+1 MH/h per soul consumed, cap 60 — see lib/mh.ts). The old
// per-mark `mult`/`mh` display fields were retired with the ×1.5/×2/×4 model.
export const REAPER_MARKS: Mark[] = [
  { id: "orange", markId: 0, file: `${T}/art-background/bc-orange.svg`, name: "★ Orange", kind: "Art Background", slot: "ab", cost: 6 },
  { id: "crown", markId: 1, file: `${T}/head/bc-flame-crown.svg`, name: "★ Flame Crown", kind: "Head", slot: "head", cost: 12 },
  { id: "phoenix", markId: 2, file: `${T}/burn-fx/phoenix.svg`, name: "★ Phoenix", kind: "Burn FX", slot: "fx", cost: 18 },
  { id: "burning", markId: 3, file: `${T}/base/bc-burning-soul.svg`, name: "★ Burning Soul", kind: "Base · skin", slot: "base", cost: 30 },
];

export const MARK_BY_ID = new Map(REAPER_MARKS.map((m) => [m.markId, m]));

// MARKS ARE MILESTONES OF CUMULATIVE CONSUMPTION (Adrian 26-jul). A mark is NOT
// bought by an exact batch — it unlocks the moment the soul's total consumed count
// crosses its threshold: Orange 6 · Flame Crown 12 · Phoenix 18 · Burning Soul 30
// (30 = the final prize: the skin AND the SOUL REAPER name). The `cost` field IS
// that threshold. Sorted ascending so "next milestone" reads left→right.
export const MARK_THRESHOLDS: { markId: number; at: number }[] = REAPER_MARKS.map((m) => ({
  markId: m.markId,
  at: m.cost,
})).sort((a, b) => a.at - b.at);

// The set of unlocked markIds for a given consumed total, unioned with any legacy
// on-chain bits (V2 forgeMark bitmask from marksOf) so nothing already forged is
// ever dropped while the V3 cut that aligns marksOf to the thresholds ships in
// parallel. The tx path stays offer()-only; this derives the display client-side.
export function marksFromConsumed(consumed: number, legacyBits: number[] = []): number[] {
  const set = new Set<number>(legacyBits);
  for (const { markId, at } of MARK_THRESHOLDS) if (consumed >= at) set.add(markId);
  return [...set].sort((a, b) => a - b);
}

export function rankName(consumed: number): string {
  if (consumed >= 30) return "Soul Reaper";
  if (consumed >= 18) return "Ember Reaper";
  if (consumed >= 6) return "Initiate";
  return consumed > 0 ? "Aspirant" : "—";
}

// =============================================================================
// RARITY — same rarity.json the gallery/MH read (applies to the shared tokenIds).
// A Pikkazo #N and its Cubist Soul #N are the same number, so rarity maps to the
// Pikkazos being offered too. Used to auto-suggest the LEAST rare pieces to burn
// and to mark each Pikkazo's rarity in the editable grid (nobody burns a gem by
// accident).
// =============================================================================
const RARITY_URL =
  "https://raw.githubusercontent.com/adriangallery/cubist-souls-assets/main/rarity/rarity.json";

export type Rarity = {
  tierNames: string[];
  tierEmoji: string[];
  tierMultipliers?: number[];
  tiers: string; // one digit per token, index = id-1
  ranks: number[]; // rank[id-1], 1 = rarest
};

export async function loadRarity(): Promise<Rarity | null> {
  try {
    const r = await fetch(RARITY_URL, { cache: "force-cache" });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.tiers === "string" && Array.isArray(j.ranks) ? j : null;
  } catch {
    return null;
  }
}

export type IdRarity = { tier: number; tierName: string; emoji: string; rank: number | null; rare: boolean };

// tier >= 3 (Exhibition, Masterpiece) is "rare" — worth a visual warning before it
// is fed to the fire.
export function rarityOf(id: number, rarity: Rarity | null): IdRarity {
  if (!rarity) return { tier: 0, tierName: "", emoji: "", rank: null, rare: false };
  const tier = Number(rarity.tiers[id - 1]) || 0;
  const rank = rarity.ranks[id - 1] != null ? Number(rarity.ranks[id - 1]) : null;
  return {
    tier,
    tierName: rarity.tierNames[tier] ?? `Tier ${tier}`,
    emoji: rarity.tierEmoji[tier] ?? "",
    rank,
    rare: tier >= 3,
  };
}

// Pre-select the N LEAST rare of the owned Pikkazos: highest rank number first
// (rank 1 = rarest, so the biggest numbers are the most common). Ties and the
// no-rarity fallback break by ascending id for a stable, legible order. Returns
// ids sorted ascending for display.
export function suggestLeastRare(owned: number[], n: number, rarity: Rarity | null): number[] {
  if (n <= 0) return [];
  const rankOf = (id: number) => {
    const r = rarity?.ranks?.[id - 1];
    return r != null ? Number(r) : -1; // unknown rarity sorts as "rarest-unknown" last
  };
  const picked = [...owned]
    .sort((a, b) => rankOf(b) - rankOf(a) || a - b) // least rare (highest rank) first
    .slice(0, n);
  return picked.sort((a, b) => a - b);
}

// =============================================================================
// VECTOR LAYER ENGINE — compose any token's art from the artist's official SVG
// set, then let marks SUBSTITUTE layers (never blend SVG over the flat PNG). Same
// engine as public/builder.html; reused by the try-on carousel AND The Order.
// =============================================================================
export type TraitsIdx = { base: number; values: Record<string, string[]>; tokens: Record<string, string> };
type Manifest = { categories: { id: string; label: string; options: { label: string; file: string }[] }[] };

const TRAITS_URL = "https://raw.githubusercontent.com/adriangallery/cubist-souls-assets/main/traits/index.json";
const MANIFEST_URL = "/assets/traits-svg/manifest.json";

// draw order (bottom→top), matching the generator's real z-order. Left Eye / Nose
// / Right Eye sit above Mouth; the fx mark is appended last.
const DRAW_ORDER: { cat: string; slot: Slot }[] = [
  { cat: "Art Background", slot: "ab" },
  { cat: "Base", slot: "base" },
  { cat: "Clothes", slot: "clothes" },
  { cat: "Head", slot: "head" },
  { cat: "Mouth", slot: "mouth" },
  { cat: "Left Eye", slot: "leye" },
  { cat: "Nose", slot: "nose" },
  { cat: "Right Eye", slot: "reye" },
];

export type LayerData = { traits: TraitsIdx; fileFor: Map<string, Map<string, string>> };

export async function loadLayerData(): Promise<LayerData | null> {
  try {
    const [t, m] = await Promise.all([
      fetch(TRAITS_URL, { cache: "force-cache" }).then((x) => x.json() as Promise<TraitsIdx>),
      fetch(MANIFEST_URL, { cache: "force-cache" }).then((x) => x.json() as Promise<Manifest>),
    ]);
    // category label -> (option label -> file)
    const fileFor = new Map<string, Map<string, string>>();
    for (const c of m.categories) {
      const inner = new Map<string, string>();
      for (const o of c.options) inner.set(o.label, o.file);
      fileFor.set(c.label, inner);
    }
    return { traits: t, fileFor };
  } catch {
    return null;
  }
}

export function baseLayersOf(id: number, data: LayerData): Partial<Record<Slot, string>> {
  const out: Partial<Record<Slot, string>> = {};
  const { traits, fileFor } = data;
  for (const { cat, slot } of DRAW_ORDER) {
    const vals = traits.values[cat];
    const packed = traits.tokens[cat];
    if (!vals || !packed) continue;
    const label = vals[packed.charCodeAt(id - 1) - traits.base];
    if (!label) continue;
    const file = fileFor.get(cat)?.get(label);
    if (file) out[slot] = `${T}/${file}`;
  }
  return out;
}

const SLOT_ORDER: Slot[] = ["ab", "base", "clothes", "head", "mouth", "leye", "nose", "reye"];

// Compose a src stack from an already-resolved base layer map + worn marks (marks
// SUBSTITUTE their slot; fx appended on top). Shared by the preview (hardcoded
// aspirant maps) and the live path.
export function composeFromBase(
  base: Partial<Record<Slot, string>>,
  markKeys: (number | string)[] = [],
): string[] {
  const marks = markKeys
    .map((k) => (typeof k === "number" ? MARK_BY_ID.get(k) : REAPER_MARKS.find((m) => m.id === k)))
    .filter(Boolean) as Mark[];
  const bySlot: Partial<Record<Slot | "fx", string>> = {};
  for (const m of marks) bySlot[m.slot] = m.file;
  const stack: string[] = [];
  for (const s of SLOT_ORDER) {
    const src = bySlot[s] ?? base[s];
    if (src) stack.push(src);
  }
  if (bySlot.fx) stack.push(bySlot.fx);
  return stack;
}

/// THE TIDE — the water pieces, by the slot code the on-chain renderer uses
/// (0 background · 1 base · 3 head · 4 mouth · 6 nose · 8 fx). The eyes are not
/// in here on purpose: they are what keeps a drowned reaper recognisable.
export const WATER_BY_SLOT: Record<number, string> = {
  0: `${T}/water/opensea.svg`,
  1: `${T}/water/underwater-love.svg`,
  3: `${T}/water/go-with-the-flow.svg`,
  4: `${T}/water/cold-lips.svg`,
  6: `${T}/water/touch-sea-grass.svg`,
  8: `${T}/water/drowning-dreams.svg`,
};

/// THE GROUND — the earth pieces, same six slot codes as the water. They come
/// after the tide: once a reaper is fully drowned at thirty kept souls, every
/// five further souls swaps one more water piece for land, to sixty.
export const EARTH_BY_SLOT: Record<number, string> = {
  0: `${T}/earth/all-the-way-to-the-bottom.svg`,
  1: `${T}/earth/salt-of-the-earth.svg`,
  3: `${T}/earth/on-top-of-the-world.svg`,
  4: `${T}/earth/no-hands.svg`,
  6: `${T}/earth/there-will-be-signs.svg`,
  8: `${T}/earth/clap-in-the-woods.svg`,
};

const SLOT_BY_CODE: Record<number, Slot> = { 0: "ab", 1: "base", 3: "head", 4: "mouth", 6: "nose" };

/// The stack a taken reaper draws: the ground takes the slots it has claimed,
/// then the water takes what is left of its own, the clothes come off with the
/// water, and the eyes never move. Mirrors SoulRendererV8 — if these two ever
/// disagree, the chain is right.
///
/// `earthDepth`/`earthOrder` are optional: called without them this is exactly
/// the V7 behaviour it replaces.
export function composeWithTide(
  base: Partial<Record<Slot, string>>,
  markKeys: (number | string)[],
  depth: number,
  order: number[],
  earthDepth = 0,
  earthOrder: number[] = [],
): string[] {
  const hasEarth = earthDepth > 0 && earthOrder.length >= 6;
  if ((!depth || order.length < 6) && !hasEarth) return composeFromBase(base, markKeys);
  const wet = new Set(order.length >= 6 ? order.slice(0, depth) : []);
  const dirt = new Set(hasEarth ? earthOrder.slice(0, earthDepth) : []);
  const marks = markKeys
    .map((k) => (typeof k === "number" ? MARK_BY_ID.get(k) : REAPER_MARKS.find((m) => m.id === k)))
    .filter(Boolean) as Mark[];
  const bySlot: Partial<Record<Slot | "fx", string>> = {};
  for (const m of marks) bySlot[m.slot] = m.file;

  const stack: string[] = [];
  for (const s of SLOT_ORDER) {
    if (s === "clothes") continue; // the water takes the clothes with it
    const code = Number(Object.keys(SLOT_BY_CODE).find((c) => SLOT_BY_CODE[Number(c)] === s) ?? -1);
    if (code >= 0 && dirt.has(code)) {
      stack.push(EARTH_BY_SLOT[code]);
      continue;
    }
    if (code >= 0 && wet.has(code)) {
      stack.push(WATER_BY_SLOT[code]);
      continue;
    }
    const src = bySlot[s] ?? base[s];
    if (src) stack.push(src);
  }
  if (dirt.has(8)) stack.push(EARTH_BY_SLOT[8]);
  else if (wet.has(8)) stack.push(WATER_BY_SLOT[8]);
  else if (bySlot.fx) stack.push(bySlot.fx);
  return stack;
}

// The composed src stack for a token id, with the given worn marks substituting
// their slots. If `data` is missing, returns [] (caller falls back to /api/img).
export function composeStack(
  id: number,
  data: LayerData | null,
  markKeys: (number | string)[] = [],
): string[] {
  if (!data) return [];
  return composeFromBase(baseLayersOf(id, data), markKeys);
}

// =============================================================================
// ON-CHAIN READS (client, via wagmi public client) — only fire when reaperLive.
// =============================================================================
export type ReaperState = { consumed: number; marks: number[]; isReaper: boolean };

// marksOf() on the deployed facet is a uint256 bitmask (bit i == markId i forged).
export function bitmaskToMarkIds(mask: bigint): number[] {
  const out: number[] = [];
  for (let i = 0; i < 8; i++) if ((mask >> BigInt(i)) & 1n) out.push(i);
  return out;
}

// per-soul consumed / marks / isReaper via one multicall batch.
export async function getReaperState(
  client: PublicClient,
  ids: number[],
): Promise<Map<number, ReaperState>> {
  const out = new Map<number, ReaperState>();
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const res = await client.multicall({
      allowFailure: true,
      contracts: chunk.flatMap((id) => [
        { address: SOULS, abi: REAPER_ABI, functionName: "soulsConsumed" as const, args: [BigInt(id)] as const },
        { address: SOULS, abi: REAPER_ABI, functionName: "marksOf" as const, args: [BigInt(id)] as const },
        { address: SOULS, abi: REAPER_ABI, functionName: "isReaper" as const, args: [BigInt(id)] as const },
      ]),
    });
    chunk.forEach((id, j) => {
      const c = res[j * 3];
      const m = res[j * 3 + 1];
      const r = res[j * 3 + 2];
      out.set(id, {
        consumed: c?.status === "success" ? Number(c.result as bigint) : 0,
        marks: m?.status === "success" ? bitmaskToMarkIds(m.result as bigint) : [],
        isReaper: r?.status === "success" ? Boolean(r.result) : false,
      });
    });
  }
  return out;
}

// soulsConsumed(id) ONLY, for a set of souls, via multicall batches. Lighter than
// getReaperState (1 call/id instead of 3) — used by the MH board's full-collection
// scan, where marks/isReaper are not needed, only the per-soul consumption that
// drives the Reaper MH multiplier and the total-contribution ranking.
export async function getConsumedMap(
  client: PublicClient,
  ids: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const res = await client.multicall({
      allowFailure: true,
      contracts: chunk.map((id) => ({
        address: SOULS,
        abi: REAPER_ABI,
        functionName: "soulsConsumed" as const,
        args: [BigInt(id)] as const,
      })),
    });
    chunk.forEach((id, j) => {
      const r = res[j];
      out.set(id, r?.status === "success" ? Number(r.result as bigint) : 0);
    });
  }
  return out;
}

// cohortOf(id) for a set of souls, via one multicall batch (same view + pattern
// as lib/mh.ts). 0 = OG. On a per-id read failure we fall back to OG (0): the
// on-chain guard is authoritative (it reverts NotOGSoul), so a flaky RPC must not
// wrongly LOCK a genuine OG out of the rite — the worst case is a clear revert
// toast, never a false lockout.
const COHORT_ABI = parseAbi(["function cohortOf(uint256 tokenId) view returns (uint8)"]);

export async function loadCohorts(client: PublicClient, ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const res = await client.multicall({
      allowFailure: true,
      contracts: chunk.map((id) => ({
        address: SOULS,
        abi: COHORT_ABI,
        functionName: "cohortOf" as const,
        args: [BigInt(id)] as const,
      })),
    });
    chunk.forEach((id, j) => {
      const r = res[j];
      out.set(id, r?.status === "success" ? Number(r.result) : OG_COHORT);
    });
  }
  return out;
}

export function isOG(cohort: number | undefined): boolean {
  return cohort === undefined || cohort === OG_COHORT;
}

// markPrice(0..3) → costs; falls back to the ratified defaults on any failure.
export async function getMarkPrices(client: PublicClient): Promise<Record<number, number>> {
  const fallback: Record<number, number> = { 0: 6, 1: 12, 2: 18, 3: 30 };
  try {
    const res = await client.multicall({
      allowFailure: true,
      contracts: [0, 1, 2, 3].map((markId) => ({
        address: SOULS,
        abi: REAPER_ABI,
        functionName: "markPrice" as const,
        args: [markId] as const,
      })),
    });
    const out: Record<number, number> = { ...fallback };
    res.forEach((r, i) => {
      if (r?.status === "success") {
        const v = Number(r.result as number);
        if (v > 0) out[i] = v;
      }
    });
    return out;
  } catch {
    return fallback;
  }
}

// =============================================================================
// REUSABLE TALLY — souls consumed per offerer (Adrian's stats rule, 26-jul):
//   "souls freed"     stays PURE (Transfer from=0 mints, see lib/souls).
//   "souls consumed"  = tally of SoulsOffered by offerer (indexed, same pattern
//                        as Transfer from=0), summing offered pikkazoIds.
//   rank/tier of liberators = TOTAL contribution = freed + consumed.
// Exposed here so the launch wave (my-souls) reuses it verbatim — do NOT
// reimplement the tally elsewhere.
// =============================================================================
export async function tallyOffered(client: PublicClient): Promise<Map<string, number>> {
  const base = { address: SOULS, event: SOULS_OFFERED_EVENT } as const;
  const acc = new Map<string, number>();
  const add = (logs: any[]) => {
    for (const l of logs) {
      const offerer = String(l.args?.offerer ?? "").toLowerCase();
      if (!offerer) continue;
      const n = Array.isArray(l.args?.pikkazoIds) ? l.args.pikkazoIds.length : 0;
      acc.set(offerer, (acc.get(offerer) || 0) + n);
    }
  };
  try {
    add(await client.getLogs({ ...base, fromBlock: REAPER_DEPLOY_BLOCK, toBlock: "latest" }));
  } catch {
    const latest = await client.getBlockNumber();
    for (let f = REAPER_DEPLOY_BLOCK; f <= latest; f += 9000n) {
      const to = f + 8999n < latest ? f + 8999n : latest;
      add(await client.getLogs({ ...base, fromBlock: f, toBlock: to }));
    }
  }
  return acc;
}

// Consumed for one wallet, from a pre-built tally (convenience for the panel).
export function consumedOf(tally: Map<string, number>, account: string): number {
  return tally.get(account.toLowerCase()) || 0;
}

// The contribution that ranks liberators (Adrian 26-jul): freed + consumed.
export function totalContribution(freed: number, consumed: number): number {
  return freed + consumed;
}

// ---- Reaper vaults (ERC-6551, Ascended only) --------------------------------
// Every Ascended reaper carries a token-bound account ("vault") — deployed by
// the museum the moment ReaperAscended fires. THE GATE lives on-chain
// (ReaperAccountFacet): reaperAccount() reverts for regular souls, so the map
// below simply omits ids the diamond refuses — the UI never decides who has a
// vault, the contract does. Control follows ownerOf(reaperId), always.

export const VAULT_ABI = parseAbi([
  "function reaperAccount(uint256 reaperId) view returns (address account, bool deployed)",
]);

export type ReaperVault = {
  account: `0x${string}`;
  deployed: boolean;
  eth: bigint;
  kept: number; // souls standing behind the reaper — its weight in the draw
};

export async function getReaperVaults(
  client: PublicClient,
  ids: number[],
): Promise<Map<number, ReaperVault>> {
  const out = new Map<number, ReaperVault>();
  if (!ids.length) return out;
  const res = await client.multicall({
    allowFailure: true, // regular souls revert NotAscended — skipped, not fatal
    contracts: ids.map((id) => ({
      address: SOULS,
      abi: VAULT_ABI,
      functionName: "reaperAccount" as const,
      args: [BigInt(id)] as const,
    })),
  });
  const balances = await Promise.all(
    res.map(async (r) => {
      if (r.status !== "success") return 0n;
      const [account, deployed] = r.result as readonly [`0x${string}`, boolean];
      if (!deployed || account === "0x0000000000000000000000000000000000000000") return 0n;
      try {
        return await client.getBalance({ address: account });
      } catch {
        return 0n;
      }
    }),
  );

  // and how many souls stand behind each one — the thing that moves its odds
  const KEPT_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
  const keptRes = await client.multicall({
    allowFailure: true,
    contracts: res.map((r) => {
      const account =
        r.status === "success"
          ? (r.result as readonly [`0x${string}`, boolean])[0]
          : ("0x0000000000000000000000000000000000000000" as `0x${string}`);
      return { address: SOULS, abi: KEPT_ABI, functionName: "balanceOf" as const, args: [account] as const };
    }),
  });
  ids.forEach((id, i) => {
    const r = res[i];
    if (r.status !== "success") return;
    const [account, deployed] = r.result as readonly [`0x${string}`, boolean];
    const kept = keptRes[i]?.status === "success" ? Number(keptRes[i].result as bigint) : 0;
    out.set(id, { account, deployed, eth: balances[i], kept });
  });
  return out;
}

export const vaultEtherscanUrl = (account: string) => `https://etherscan.io/address/${account}`;

/// THE NAME OF A REAPER.
///
/// `136.cubistsouls.eth` is the vault of Soul Reaper #136 — a real ENS name that
/// any wallet resolves. It takes no lookup to build because nothing was ever
/// registered: the resolver on `cubistsouls.eth` COMPUTES the answer from the
/// diamond, so every member has a name the moment it ascends and this page can
/// print it from the id alone.
///
/// Resolver: 0xbd3Cfd235D26D865431b99FF238D5443D49EA37d. It answers both ways a
/// client can ask — the ENSIP-10 wildcard that modern libraries use, and the
/// flat `addr(node)` that MetaMask mobile uses. The sixteen subdomains are also
/// written into the ENS registry, because that flat path needs them to exist.
/// Cuantas almas de la boveda cuentan para el sorteo. La VERDAD esta en el
/// contrato (`weightParams`) y el modal la lee de ahi antes de dejar firmar;
/// esto es solo el valor por defecto para pintar barras y avisos sin esperar a
/// una lectura. Si algun dia difieren, manda el contrato.
export const BEHIND_CAP = 30;

/// Where the ART stops, which is NOT where the odds stop. Thirty is the draw's
/// ceiling (`weightParams`); past it a soul buys no ticket, but it does buy
/// ground — one more earth piece every five, to sixty. Saying "vault full" and
/// nothing else at thirty was true about odds and wrong about the token.
export const GROUND_CAP = 60;

/// THE ORDER the ground takes a reaper in, computed instead of asked.
///
/// It is pure maths on the token id — the same permutation SoulRendererV8 runs,
/// keccak256(abi.encode(id, "cubistsouls.earth")), hair first — so there is no
/// reason to depend on a node answering to know it. The chain stays the
/// authority and the reader still prefers it; this is what keeps a blink from
/// painting water where there should be ground, which is the one failure mode
/// that matters: a slow picture is fine, a wrong one is not.
function takeOrderOf(tokenId: number, tag: string): number[] {
  const order: number[] = [3]; // the hair, always first
  const rest = [0, 1, 4, 6, 8];
  let seed = BigInt(
    keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "string" }], [BigInt(tokenId), tag])),
  );
  for (let i = 5; i > 0; i--) {
    const j = Number(seed % BigInt(i));
    seed /= 7n;
    order.push(rest[j]);
    rest[j] = rest[i - 1];
  }
  return order;
}

export const earthOrderOf = (tokenId: number) => takeOrderOf(tokenId, "cubistsouls.earth");
export const tideOrderOf = (tokenId: number) => takeOrderOf(tokenId, "cubistsouls.tide");

/// The two stages a reaper's art moves through, from the souls its vault keeps.
/// Mirrors SoulRendererV8; if these ever disagree, the chain is right.
export function stagesFromKept(kept: number): { tide: number; earth: number } {
  const clamp = (n: number) => (n < 0 ? 0 : n > 6 ? 6 : n);
  return {
    tide: clamp(Math.floor(kept / 5)),
    earth: kept > BEHIND_CAP ? clamp(Math.floor((kept - BEHIND_CAP) / 5)) : 0,
  };
}

export const ensNameOf = (id: number) => `${id}.cubistsouls.eth`;

/// Where a holder goes to see the name the way the rest of the world sees it.
export const ensProfileUrl = (id: number) => `https://app.ens.domains/${ensNameOf(id)}`;

export function fmtVaultEth(wei: bigint): string {
  if (wei === 0n) return "Ξ0";
  const eth = Number(wei) / 1e18;
  return `Ξ${eth < 0.0001 ? "<0.0001" : eth.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}
