// Vessels — thirty souls fused inside a reaper-consumed canvas (VesselFacet,
// live 03-ago). The 30 members are held by the DIAMOND (custody, no path out);
// the vessel's ERC-6551 vault is created in the fuse tx and reserved for
// whatever the museum binds to vessels later. All gating lives on-chain — this
// module only reads it and shapes it for the wing.

import type { PublicClient } from "viem";
import { parseAbi, parseAbiItem } from "viem";
import { SOULS, REAPER_DEPLOY_BLOCK } from "./reaper";

export const UNION_SIZE = 30;

export const VESSEL_ABI = parseAbi([
  "function fuse(uint256 canvasId, uint256[] soulIds, string name) payable returns (address)",
  "function renameVessel(uint256 vesselId, string newName)",
  "function vesselFee() view returns (uint256)",
  "function isVesselToken(uint256 id) view returns (bool)",
  "function vesselNameOf(uint256 vesselId) view returns (string)",
  "function membersOf(uint256 vesselId) view returns (uint256[])",
  "function vesselOf(uint256 soulId) view returns (uint256)",
  "function custodianOf(uint256 soulId) view returns (address)",
  "function vesselVault(uint256 vesselId) view returns (address vault, bool deployed)",
  "event VesselFused(uint256 indexed vesselId, address indexed founder, address vault, string name, uint256[] members)",
]);

// The wake rite (VesselResurrectionFacet). A Memento Mori is born dormant; its
// CURRENT owner wakes it for the rite fee, and a transfer puts it back to sleep
// (the rite is bound to the pair vessel+keeper, compared on-chain, no hooks).
export const RITE_ABI = parseAbi([
  "function resurrect(uint256 vesselId) payable",
  "function isResurrected(uint256 vesselId) view returns (bool)",
  "function resurrectorOf(uint256 vesselId) view returns (address)",
  "function resurrectionsOf(uint256 vesselId) view returns (uint32)",
  "function resurrectionFee() view returns (uint256)",
  "function resurrectionPaused() view returns (bool)",
]);

export type RiteState = { awake: boolean; count: number };

/// Rite state for a set of vessels. Returns null when the rite surface is not
/// on-chain yet (pre-cut), so the client can hide the section instead of erroring.
export async function readRites(
  client: PublicClient,
  vesselIds: number[],
): Promise<{ fee: bigint; paused: boolean; states: Map<number, RiteState> } | null> {
  try {
    const fee = (await client.readContract({
      address: SOULS,
      abi: RITE_ABI,
      functionName: "resurrectionFee",
    })) as bigint;
    const paused = (await client.readContract({
      address: SOULS,
      abi: RITE_ABI,
      functionName: "resurrectionPaused",
    })) as boolean;
    const states = new Map<number, RiteState>();
    if (vesselIds.length) {
      const res = await client.multicall({
        allowFailure: true,
        contracts: vesselIds.flatMap((id) => [
          { address: SOULS, abi: RITE_ABI, functionName: "isResurrected" as const, args: [BigInt(id)] as const },
          { address: SOULS, abi: RITE_ABI, functionName: "resurrectionsOf" as const, args: [BigInt(id)] as const },
        ]),
      });
      vesselIds.forEach((id, i) => {
        states.set(id, {
          awake: res[i * 2]?.status === "success" ? Boolean(res[i * 2].result) : false,
          count: res[i * 2 + 1]?.status === "success" ? Number(res[i * 2 + 1].result) : 0,
        });
      });
    }
    return { fee, paused, states };
  } catch {
    return null; // pre-cut: the selector does not exist yet
  }
}

const VESSEL_FUSED_EVENT = parseAbiItem(
  "event VesselFused(uint256 indexed vesselId, address indexed founder, address vault, string name, uint256[] members)",
);
const SOULS_OFFERED_EVENT = parseAbiItem(
  "event SoulsOffered(uint256 indexed reaperId, address indexed offerer, uint256[] pikkazoIds, uint256 newConsumed)",
);

export type VesselEntry = {
  id: number;
  founder: `0x${string}`;
  vault: `0x${string}`;
  name: string;
  members: number[];
};

async function logsChunked(client: PublicClient, event: any): Promise<any[]> {
  const base = { address: SOULS, event } as const;
  try {
    return await client.getLogs({ ...base, fromBlock: REAPER_DEPLOY_BLOCK, toBlock: "latest" });
  } catch {
    const latest = await client.getBlockNumber();
    const acc: any[] = [];
    for (let f = REAPER_DEPLOY_BLOCK; f <= latest; f += 9000n) {
      const to = f + 8999n < latest ? f + 8999n : latest;
      acc.push(...(await client.getLogs({ ...base, fromBlock: f, toBlock: to })));
    }
    return acc;
  }
}

/// Every vessel ever fused (VesselFused is append-only truth).
export async function getVessels(client: PublicClient): Promise<VesselEntry[]> {
  const logs = await logsChunked(client, VESSEL_FUSED_EVENT);
  return logs.map((l: any) => ({
    id: Number(l.args.vesselId),
    founder: l.args.founder as `0x${string}`,
    vault: l.args.vault as `0x${string}`,
    name: String(l.args.name ?? ""),
    members: (l.args.members as bigint[]).map(Number),
  }));
}

/// Canvas ids consumed by reaper offerings, MINUS those already claimed by a
/// vessel — the founder's art menu. (A claimed canvas has an owner on-chain;
/// checking owners costs 1 multicall over the consumed set, which stays small.)
export async function getAvailableCanvases(client: PublicClient): Promise<number[]> {
  const offered = await logsChunked(client, SOULS_OFFERED_EVENT);
  const consumed = new Set<number>();
  for (const l of offered) {
    for (const pid of (l.args?.pikkazoIds ?? []) as bigint[]) consumed.add(Number(pid));
  }
  const ids = [...consumed].sort((a, b) => a - b);
  if (!ids.length) return [];
  const free: number[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const res = await client.multicall({
      allowFailure: true,
      contracts: chunk.map((id) => ({
        address: SOULS,
        abi: parseAbi(["function ownerOf(uint256) view returns (address)"]),
        functionName: "ownerOf" as const,
        args: [BigInt(id)] as const,
      })),
    });
    chunk.forEach((id, j) => {
      // ownerOf reverts for unminted ids -> the canvas is still free
      if (res[j].status !== "success") free.push(id);
    });
  }
  return free;
}

/// Which of the wallet's souls may join a union: consumed == 0 and not a vessel.
/// (Ownership is already guaranteed by the caller passing its own owned list.)
export async function filterEligible(client: PublicClient, owned: number[]): Promise<number[]> {
  if (!owned.length) return [];
  const out: number[] = [];
  for (let i = 0; i < owned.length; i += 200) {
    const chunk = owned.slice(i, i + 200);
    const res = await client.multicall({
      allowFailure: true,
      contracts: chunk.flatMap((id) => [
        {
          address: SOULS,
          abi: parseAbi(["function soulsConsumed(uint256) view returns (uint256)"]),
          functionName: "soulsConsumed" as const,
          args: [BigInt(id)] as const,
        },
        {
          address: SOULS,
          abi: VESSEL_ABI,
          functionName: "isVesselToken" as const,
          args: [BigInt(id)] as const,
        },
      ]),
    });
    chunk.forEach((id, j) => {
      const consumed = res[j * 2];
      const isV = res[j * 2 + 1];
      const clean = consumed?.status === "success" ? (consumed.result as bigint) === 0n : false;
      const vessel = isV?.status === "success" ? Boolean(isV.result) : false;
      if (clean && !vessel) out.push(id);
    });
  }
  return out;
}

/// Split an owned list into vessels and plain souls (one multicall).
export async function splitVessels(
  client: PublicClient,
  owned: number[],
): Promise<{ vessels: number[]; souls: number[] }> {
  if (!owned.length) return { vessels: [], souls: [] };
  const res = await client.multicall({
    allowFailure: true,
    contracts: owned.map((id) => ({
      address: SOULS,
      abi: VESSEL_ABI,
      functionName: "isVesselToken" as const,
      args: [BigInt(id)] as const,
    })),
  });
  const vessels: number[] = [];
  const souls: number[] = [];
  owned.forEach((id, i) => {
    if (res[i]?.status === "success" && Boolean(res[i].result)) vessels.push(id);
    else souls.push(id);
  });
  return { vessels, souls };
}
