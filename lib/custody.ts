// WHO REALLY HOLDS A SOUL.
//
// A soul can sit somewhere that is not a wallet and still belong to a person:
//   • inside the vault of a reaper they hold — placed there to strengthen it;
//   • inside the museum's custody, fused into a Memento Mori they hold.
//
// On chain those souls answer `ownerOf` with a vault address or with the diamond
// itself, so anything that reads ownership literally loses them: the hours stop,
// the collection shrinks, the govern power drops, and the vault turns up on the
// public board as if it were a curator. None of that is what happened — nobody
// gave anything away.
//
// This module resolves custody back to the person, and — just as important —
// keeps the CLOCK running. Moving a soul into your own reaper's vault is not a
// sale, so it must not restart its Museum Hours. Selling the reaper is, and that
// one does restart them for the buyer, exactly like buying a soul does.

import type { PublicClient } from "viem";
import { parseAbi } from "viem";
import { SOULS, getLogsRange } from "./souls";

const CUSTODY_ABI = parseAbi([
  "function vaultOf(uint256 reaperId) view returns (address)",
  "function orderRoster() view returns (uint256[])",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function membersOf(uint256 vesselId) view returns (uint256[])",
  "function isVesselToken(uint256 id) view returns (bool)",
]);

export type Custody = {
  /// soul ids the account effectively holds beyond its wallet
  extra: number[];
  /// soul id -> the block its CURRENT custody began (not the vault hop)
  acq: Record<number, number>;
  /// soul id -> where it is being kept, for the UI to explain itself
  where: Record<number, { kind: "reaper" | "vessel"; id: number }>;
};

const EMPTY: Custody = { extra: [], acq: {}, where: {} };

/// The vault addresses of a set of reapers.
export async function vaultsOf(client: PublicClient, reaperIds: number[]): Promise<Map<number, `0x${string}`>> {
  const out = new Map<number, `0x${string}`>();
  if (!reaperIds.length) return out;
  const res = await client.multicall({
    allowFailure: true,
    contracts: reaperIds.map((id) => ({
      address: SOULS,
      abi: CUSTODY_ABI,
      functionName: "vaultOf" as const,
      args: [BigInt(id)] as const,
    })),
  });
  reaperIds.forEach((id, i) => {
    if (res[i]?.status === "success") out.set(id, res[i].result as `0x${string}`);
  });
  return out;
}

/// Everything `account` holds through a reaper it owns or a Memento Mori it owns.
///
/// `ownedReapers` and `ownedVessels` are the tokens already known to be in the
/// wallet, so this never has to scan the collection.
export async function loadCustody(
  client: PublicClient,
  account: string,
  ownedReapers: number[],
  ownedVessels: number[] = [],
): Promise<Custody> {
  if (!account) return EMPTY;
  const acct = account.toLowerCase();
  try {
    const vaults = await vaultsOf(client, ownedReapers);
    const vaultAddrs = [...vaults.values()];
    const where: Record<number, { kind: "reaper" | "vessel"; id: number }> = {};
    const extra: number[] = [];

    // what each vault holds right now, from its inbound transfers minus what left
    for (const [reaperId, vault] of vaults) {
      const held = await heldBy(client, vault);
      for (const id of held) {
        extra.push(id);
        where[id] = { kind: "reaper", id: reaperId };
      }
    }

    // and the thirty inside each Memento Mori the wallet holds
    if (ownedVessels.length) {
      const res = await client.multicall({
        allowFailure: true,
        contracts: ownedVessels.map((id) => ({
          address: SOULS,
          abi: CUSTODY_ABI,
          functionName: "membersOf" as const,
          args: [BigInt(id)] as const,
        })),
      });
      ownedVessels.forEach((vesselId, i) => {
        if (res[i]?.status !== "success") return;
        for (const m of res[i].result as readonly bigint[]) {
          const id = Number(m);
          extra.push(id);
          where[id] = { kind: "vessel", id: vesselId };
        }
      });
    }

    const acq = await custodyStart(client, acct, vaultAddrs, extra);
    return { extra: [...new Set(extra)].sort((a, b) => a - b), acq, where };
  } catch {
    return EMPTY;
  }
}

/// Token ids currently sitting at `holder` (inbound transfers, minus those that
/// left again). Cheap: a vault holds a handful of things.
async function heldBy(client: PublicClient, holder: `0x${string}`): Promise<number[]> {
  const [inLogs, outLogs] = await Promise.all([
    getLogsRange(client, { toAddr: holder }),
    getLogsRange(client, { fromAddr: holder }),
  ]);
  const last = new Map<number, { to: string; block: number; idx: number }>();
  const consider = (l: any, to: string) => {
    const id = Number(l.args.tokenId);
    const block = Number(l.blockNumber);
    const idx = Number(l.logIndex);
    const prev = last.get(id);
    if (!prev || block > prev.block || (block === prev.block && idx > prev.idx)) {
      last.set(id, { to, block, idx });
    }
  };
  for (const l of inLogs) consider(l, holder.toLowerCase());
  for (const l of outLogs) consider(l, String(l.args.to).toLowerCase());
  const h = holder.toLowerCase();
  return [...last.entries()].filter(([, v]) => v.to === h).map(([id]) => id);
}

/// When the CURRENT custody began for each soul: the moment it entered the
/// wallet-or-own-vault set from outside it. A hop between them changes nothing,
/// which is the whole point — placing a soul behind your reaper must not reset
/// its hours.
async function custodyStart(
  client: PublicClient,
  acct: string,
  vaultAddrs: string[],
  ids: number[],
): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  if (!ids.length) return out;
  const inside = new Set([acct, ...vaultAddrs.map((v) => v.toLowerCase())]);

  // every transfer that touched this custody set, in order
  const parties = [acct, ...vaultAddrs];
  const logs: any[] = [];
  for (const p of parties) {
    const [i, o] = await Promise.all([
      getLogsRange(client, { toAddr: p as `0x${string}` }),
      getLogsRange(client, { fromAddr: p as `0x${string}` }),
    ]);
    logs.push(...i, ...o);
  }
  const wanted = new Set(ids);
  const byId = new Map<number, any[]>();
  for (const l of logs) {
    const id = Number(l.args.tokenId);
    if (!wanted.has(id)) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)!.push(l);
  }

  for (const [id, list] of byId) {
    list.sort((a, b) => Number(a.blockNumber - b.blockNumber) || Number(a.logIndex - b.logIndex));
    let start: number | null = null;
    let held = false;
    for (const l of list) {
      const from = String(l.args.from).toLowerCase();
      const to = String(l.args.to).toLowerCase();
      const cameIn = inside.has(to) && !inside.has(from);
      const wentOut = inside.has(from) && !inside.has(to);
      if (cameIn && !held) {
        start = Number(l.blockNumber);
        held = true;
      } else if (wentOut) {
        held = false;
        start = null;
      }
      // a hop inside the set (wallet -> own vault) touches nothing
    }
    if (held && start !== null) out[id] = start;
  }
  return out;
}

/// For the public board, which walks every transfer and would otherwise rank
/// vault addresses as if they were collectors: a map from a custody address to
/// the person behind it.
export async function custodyOwners(client: PublicClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const roster = (await client.readContract({
      address: SOULS,
      abi: CUSTODY_ABI,
      functionName: "orderRoster",
    })) as readonly bigint[];
    const ids = roster.map(Number);
    if (!ids.length) return map;
    const vaults = await vaultsOf(client, ids);
    const holders = await client.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({
        address: SOULS,
        abi: CUSTODY_ABI,
        functionName: "ownerOf" as const,
        args: [BigInt(id)] as const,
      })),
    });
    ids.forEach((id, i) => {
      const v = vaults.get(id);
      if (!v || holders[i]?.status !== "success") return;
      map.set(v.toLowerCase(), String(holders[i].result).toLowerCase());
    });
  } catch {
    /* a reader hiccup must not break the board */
  }
  return map;
}
