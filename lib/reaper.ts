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
//   • marksOf(uint256) returns uint8[]  (the worn markIds, 0..3)
//   • soulsConsumed(uint256) returns uint256
//   • markPrice(uint8) returns uint16
//   • SoulsOffered/MarkForged/ReaperAscended shapes exactly as below
// If any of these differ on the deployed facet, only this file needs to change.

import type { PublicClient } from "viem";
import { parseAbi, parseAbiItem, getAddress } from "viem";

// The diamond IS the facet host. Reuse the canonical checksummed address.
export const SOULS = getAddress("0x9252fDc0b3945203314Ea1a9b8d64345bc868406");
export const PIKKAZO = getAddress("0x6478b94dfa32F3eab600970D04B34615eE97484e");
export const REAPER_DEPLOY_BLOCK = 25518546n; // diamond deploy; the cut is later, harmless lower bound

// souls consumed by one reaper to earn the "Soul Reaper #id" rename (Adrian 26-jul).
export const ASCEND_AT = 30;

// The AGREED ReaperFacet interface (contract between the web and facet workers).
export const REAPER_ABI = parseAbi([
  // writes
  "function offer(uint256 reaperId, uint256[] pikkazoIds)",
  "function forgeMark(uint256 reaperId, uint8 markId, uint256[] pikkazoIds)",
  // views
  "function soulsConsumed(uint256 reaperId) view returns (uint256)",
  "function marksOf(uint256 reaperId) view returns (uint8[])",
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
  mult: number; // MH Reaper multiplier at that mark's tier
  mh: number; // illustrative +MH/hr
};

export const REAPER_MARKS: Mark[] = [
  { id: "orange", markId: 0, file: `${T}/art-background/bc-orange.svg`, name: "★ Orange", kind: "Art Background", slot: "ab", cost: 6, mult: 1.2, mh: 2 },
  { id: "crown", markId: 1, file: `${T}/head/bc-flame-crown.svg`, name: "★ Flame Crown", kind: "Head", slot: "head", cost: 12, mult: 1.5, mh: 6 },
  { id: "phoenix", markId: 2, file: `${T}/burn-fx/phoenix.svg`, name: "★ Phoenix", kind: "Burn FX", slot: "fx", cost: 18, mult: 1.6, mh: 8 },
  { id: "burning", markId: 3, file: `${T}/base/bc-burning-soul.svg`, name: "★ Burning Soul", kind: "Base · skin", slot: "base", cost: 30, mult: 2.0, mh: 10 },
];

export const MARK_BY_ID = new Map(REAPER_MARKS.map((m) => [m.markId, m]));

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
        marks: m?.status === "success" ? (m.result as readonly number[]).map(Number) : [],
        isReaper: r?.status === "success" ? Boolean(r.result) : false,
      });
    });
  }
  return out;
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
