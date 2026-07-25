// Client-side on-chain logic for the HOME burn flow, on viem (via the wagmi
// public client). Ports pikkazo-burn/index.html 1:1 — the holder connects and
// sees their Pikkazos, selects, and convert()s them into Cubist Souls.
//
// From the browser the public RPCs answer fine (unlike the server); wagmi's
// fallback transport rotates tenderly → publicnode → llamarpc. Every read here
// goes through that client, so a single gateway hiccup can't wedge the flow.

import type { PublicClient } from "viem";
import { parseAbi, parseAbiItem, getAddress, zeroAddress } from "viem";

// Pikkazo canvas (burned) and Cubist Souls diamond (freed). Checksummed.
export const PIKKAZO = getAddress("0x6478b94dfa32F3eab600970D04B34615eE97484e");
export const SOULS = getAddress("0x9252fDc0b3945203314Ea1a9b8d64345bc868406");
export const PIKKAZO_DEPLOY_BLOCK = 25424406n;

// Contract hard limit per convert(); big selections auto-chunk into 50s.
export const MAX_PER_TX = 50;
// At/above this many pending approvals, offer the one-signature approve-all.
export const APPROVE_ALL_AT = 6;

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

// Minimal ABIs — exactly the selectors this flow touches.
export const PIKKAZO_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function approve(address to, uint256 tokenId)",
  "function setApprovalForAll(address operator, bool approved)",
]);
export const SOULS_ABI = parseAbi([
  "function convert(uint256[] tokenIds) payable",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function priceNow() view returns (uint256)",
]);

export type PikkazoScan = {
  owned: number[]; // still yours, burnable (ascending)
  burned: number[]; // ownerOf reverted — canvas destroyed (ascending)
  freed: Set<number>; // of the burned, those whose Cubist Soul exists
};

// eth_getLogs of incoming Transfers → every token that ever landed in this
// wallet. Tenderly answers the full range at once; chunk only as a fallback.
export async function candidateIds(client: PublicClient, account: string): Promise<number[]> {
  const to = getAddress(account);
  const base = { address: PIKKAZO, event: TRANSFER_EVENT, args: { to } } as const;
  try {
    const logs = await client.getLogs({ ...base, fromBlock: PIKKAZO_DEPLOY_BLOCK, toBlock: "latest" });
    return dedupeSortIds(logs);
  } catch {
    const latest = await client.getBlockNumber();
    let out: any[] = [];
    for (let f = PIKKAZO_DEPLOY_BLOCK; f <= latest; f += 9000n) {
      const end = f + 8999n < latest ? f + 8999n : latest;
      out = out.concat(await client.getLogs({ ...base, fromBlock: f, toBlock: end }));
    }
    return dedupeSortIds(out);
  }
}

function dedupeSortIds(logs: any[]): number[] {
  return [...new Set(logs.map((l) => Number(l.args?.tokenId ?? 0n)))]
    .filter((id) => id > 0)
    .sort((a, b) => a - b);
}

// ownerOf() over a candidate set via Multicall3 (viem batches on mainnet).
// Returns lowercase owner, or null when ownerOf reverted (burned/nonexistent).
async function multicallOwners(
  client: PublicClient,
  target: `0x${string}`,
  ids: number[],
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const res = await client.multicall({
      allowFailure: true,
      contracts: chunk.map((id) => ({
        address: target,
        abi: PIKKAZO_ABI,
        functionName: "ownerOf" as const,
        args: [BigInt(id)] as const,
      })),
    });
    res.forEach((r, j) => {
      out.set(chunk[j], r.status === "success" ? String(r.result).toLowerCase() : null);
    });
  }
  return out;
}

// Classify every token that ever touched this wallet, straight from the chain
// (persists across sessions/devices, no local state).
export async function scanCollection(
  client: PublicClient,
  ids: number[],
  account: string,
): Promise<PikkazoScan> {
  const acct = account.toLowerCase();
  const pikkazoOwners = await multicallOwners(client, PIKKAZO, ids);
  const owned: number[] = [];
  const burned: number[] = [];
  for (const id of ids) {
    const o = pikkazoOwners.get(id);
    if (o === null || o === undefined) burned.push(id); // ownerOf reverted → destroyed
    else if (o === acct) owned.push(id);
    // owned by someone else (sold/transferred) → not shown
  }

  const freed = new Set<number>();
  if (burned.length) {
    const soulOwners = await multicallOwners(client, SOULS, burned);
    for (const id of burned) if (soulOwners.get(id)) freed.add(id);
  }
  return {
    owned: owned.sort((a, b) => a - b),
    burned: burned.sort((a, b) => a - b),
    freed,
  };
}

export type PikkazoData = { account: string } & PikkazoScan;

export async function loadPikkazos(client: PublicClient, account: string): Promise<PikkazoData> {
  const ids = await candidateIds(client, account);
  const scan = await scanCollection(client, ids, account);
  return { account: account.toLowerCase(), ...scan };
}

// Which of the selected ids still need approval for the Souls diamond to burn
// them. Reads via multicall so it's idempotent: pieces already approved — or a
// pre-existing all-collection approval — are skipped.
export async function approvalsNeeded(
  client: PublicClient,
  account: string,
  ids: number[],
): Promise<number[]> {
  const owner = getAddress(account);

  // A pre-existing all-collection approval covers everything → nothing to sign.
  try {
    const all = (await client.readContract({
      address: PIKKAZO,
      abi: PIKKAZO_ABI,
      functionName: "isApprovedForAll",
      args: [owner, SOULS],
    })) as boolean;
    if (all) return [];
  } catch { /* fall through to per-token check */ }

  const approvals = await client.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({
      address: PIKKAZO,
      abi: PIKKAZO_ABI,
      functionName: "getApproved" as const,
      args: [BigInt(id)] as const,
    })),
  });
  const soul = SOULS.toLowerCase();
  const need: number[] = [];
  ids.forEach((id, i) => {
    const r = approvals[i];
    const appr = r?.status === "success" ? String(r.result).toLowerCase() : null;
    if (appr !== soul) need.push(id);
  });
  return need;
}

// priceNow() read FRESH right before signing (in case a tier boundary passed).
export async function getPriceNow(client: PublicClient): Promise<bigint> {
  return (await client.readContract({
    address: SOULS,
    abi: SOULS_ABI,
    functionName: "priceNow",
  })) as bigint;
}

export { zeroAddress };
