// Client-side on-chain reads for the "Your Souls" page, on viem (via the wagmi
// public client). Mirrors the vanilla my-souls.html logic 1:1 — the numbers must
// match the live page byte-for-byte (validated against 0x4943: ~246 held, rank #1).
//
// From the browser the public RPCs answer fine (unlike the server), and wagmi's
// fallback transport already rotates tenderly → publicnode → llamarpc for us.

import type { PublicClient } from "viem";
import { parseAbiItem, getAddress, zeroAddress } from "viem";

export const SOULS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406" as const;
export const DEPLOY_BLOCK = 25518546n;

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);
const ERC721_ABI = [
  parseAbiItem("function ownerOf(uint256 tokenId) view returns (address)"),
] as const;

export function tierOf(n: number): string {
  if (n >= 50) return "Founding Patron";
  if (n >= 20) return "Patron";
  if (n >= 5) return "Curator";
  return "Liberator";
}

export type SoulsData = {
  freed: number; // souls this wallet freed (minted from 0x0)
  rank: number; // 1-based rank among liberators by count
  totalLibs: number; // number of distinct liberators
  owned: number[]; // token ids currently held, ascending
};

// Decoded Transfer log — only the fields the page consumes (viem's full generic
// return type is unwieldy across the chunk fallback, so we narrow it here).
export type TransferLog = {
  blockNumber: bigint | null;
  logIndex: number | null;
  args: { from?: `0x${string}`; to?: `0x${string}`; tokenId?: bigint };
};

// getLogs for a topic filter over the full deploy range, chunked on failure
// (Tenderly answers the whole range at once; the chunk loop is the safety net).
export async function getLogsRange(
  client: PublicClient,
  args: { fromAddr?: `0x${string}`; toAddr?: `0x${string}` },
): Promise<TransferLog[]> {
  const eventArgs: { from?: `0x${string}`; to?: `0x${string}` } = {};
  if (args.fromAddr) eventArgs.from = args.fromAddr;
  if (args.toAddr) eventArgs.to = args.toAddr;
  const base = { address: SOULS as `0x${string}`, event: TRANSFER_EVENT, args: eventArgs } as const;
  try {
    const logs = await client.getLogs({ ...base, fromBlock: DEPLOY_BLOCK, toBlock: "latest" });
    return logs as unknown as TransferLog[];
  } catch {
    const latest = await client.getBlockNumber();
    let out: TransferLog[] = [];
    for (let f = DEPLOY_BLOCK; f <= latest; f += 9000n) {
      const to = f + 8999n < latest ? f + 8999n : latest;
      const logs = await client.getLogs({ ...base, fromBlock: f, toBlock: to });
      out = out.concat(logs as unknown as TransferLog[]);
    }
    return out;
  }
}

// ownerOf() over a candidate set via Multicall3 (viem batches automatically on
// mainnet). Returns lowercase owner or null per id.
export async function ownersOf(
  client: PublicClient,
  ids: number[],
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const res = await client.multicall({
      allowFailure: true,
      contracts: chunk.map((id) => ({
        address: SOULS as `0x${string}`,
        abi: ERC721_ABI,
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

export async function loadSouls(client: PublicClient, account: string): Promise<SoulsData> {
  const acct = account.toLowerCase();
  const to = getAddress(account);

  const [inLogs, mintLogs] = await Promise.all([
    getLogsRange(client, { toAddr: to }),
    getLogsRange(client, { fromAddr: zeroAddress }),
  ]);

  // freed by this wallet + rank among liberators (tally of mints per recipient)
  const tally = new Map<string, number>();
  for (const l of mintLogs) {
    const dst = String(l.args.to).toLowerCase();
    tally.set(dst, (tally.get(dst) || 0) + 1);
  }
  const freed = tally.get(acct) || 0;
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const rank = ranked.findIndex((r) => r[0] === acct) + 1;
  const totalLibs = ranked.length;

  // souls currently held (received here, still owned per ownerOf)
  const candidates = [...new Set(inLogs.map((l) => Number(l.args.tokenId)))];
  const owners = candidates.length ? await ownersOf(client, candidates) : new Map();
  const owned = candidates.filter((id) => owners.get(id) === acct).sort((a, b) => a - b);

  return { freed, rank, totalLibs, owned };
}
