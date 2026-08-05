// THE ORDER'S DRAW — half of every burn-to-mint fee, paid to one reaper.
//
// Everything here is read from the diamond: who is on the roster, what each
// member's odds are, what is waiting in the pot, and who has been paid. The
// weight is `base + souls kept in the reaper's vault, capped` — so a reaper's
// strength is visible, comparable, and something a holder can act on.

import type { PublicClient } from "viem";
import { parseAbi, parseAbiItem, formatEther } from "viem";
import { SOULS, REAPER_DEPLOY_BLOCK } from "./reaper";

export const ORDER_ABI = parseAbi([
  "function orderPot() view returns (uint256)",
  "function orderRoster() view returns (uint256[])",
  "function weightOf(uint256 reaperId) view returns (uint256)",
  "function totalWeight() view returns (uint256)",
  "function weightParams() view returns (uint16 base, uint16 bonusCap)",
  "function pendingDraw() view returns (uint64 drawBlock, bool settleable, uint256 pot)",
  "function lastDraw() view returns (uint256 winner, uint64 at)",
  "function vaultOf(uint256 reaperId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
]);

const DRAW_SETTLED = parseAbiItem(
  "event DrawSettled(uint256 indexed reaperId, address indexed vault, uint256 amount, uint256 weight, uint256 totalWeight)",
);

export type Member = {
  id: number;
  vault: `0x${string}`;
  weight: number;
  kept: number; // souls held in the vault
  share: number; // 0..1 of the draw
};

export type OrderState = {
  members: Member[];
  totalWeight: number;
  pot: bigint;
  base: number;
  bonusCap: number;
};

export async function loadOrder(client: PublicClient): Promise<OrderState | null> {
  try {
    const [roster, pot, total, params] = await Promise.all([
      client.readContract({ address: SOULS, abi: ORDER_ABI, functionName: "orderRoster" }),
      client.readContract({ address: SOULS, abi: ORDER_ABI, functionName: "orderPot" }),
      client.readContract({ address: SOULS, abi: ORDER_ABI, functionName: "totalWeight" }),
      client.readContract({ address: SOULS, abi: ORDER_ABI, functionName: "weightParams" }),
    ]);
    const ids = (roster as readonly bigint[]).map(Number);
    if (!ids.length) return { members: [], totalWeight: 0, pot: pot as bigint, base: 100, bonusCap: 30 };

    const res = await client.multicall({
      allowFailure: true,
      contracts: ids.flatMap((id) => [
        { address: SOULS, abi: ORDER_ABI, functionName: "weightOf" as const, args: [BigInt(id)] as const },
        { address: SOULS, abi: ORDER_ABI, functionName: "vaultOf" as const, args: [BigInt(id)] as const },
      ]),
    });

    const [base, bonusCap] = params as readonly [number, number];
    const totalW = Number(total as bigint);
    const members: Member[] = ids.map((id, i) => {
      const w = res[i * 2]?.status === "success" ? Number(res[i * 2].result as bigint) : base;
      const vault = (res[i * 2 + 1]?.status === "success" ? res[i * 2 + 1].result : "0x0") as `0x${string}`;
      return { id, vault, weight: w, kept: Math.max(0, w - base), share: totalW ? w / totalW : 0 };
    });
    members.sort((a, b) => b.weight - a.weight || a.id - b.id);
    return { members, totalWeight: totalW, pot: pot as bigint, base, bonusCap };
  } catch {
    return null;
  }
}

export type DrawRecord = {
  reaperId: number;
  vault: `0x${string}`;
  amount: bigint;
  weight: number;
  totalWeight: number;
  block: bigint;
  txHash: `0x${string}`;
};

/// Every draw ever settled — the public ledger, straight from the chain.
export async function loadDraws(client: PublicClient): Promise<DrawRecord[]> {
  const base = { address: SOULS, event: DRAW_SETTLED } as const;
  let logs: any[] = [];
  try {
    logs = await client.getLogs({ ...base, fromBlock: REAPER_DEPLOY_BLOCK, toBlock: "latest" });
  } catch {
    const latest = await client.getBlockNumber();
    for (let f = REAPER_DEPLOY_BLOCK; f <= latest; f += 9000n) {
      const to = f + 8999n < latest ? f + 8999n : latest;
      logs.push(...(await client.getLogs({ ...base, fromBlock: f, toBlock: to })));
    }
  }
  return logs
    .map((l) => ({
      reaperId: Number(l.args.reaperId),
      vault: l.args.vault as `0x${string}`,
      amount: l.args.amount as bigint,
      weight: Number(l.args.weight),
      totalWeight: Number(l.args.totalWeight),
      block: l.blockNumber as bigint,
      txHash: l.transactionHash as `0x${string}`,
    }))
    .reverse(); // newest first
}

export const fmtEth = (wei: bigint) => {
  if (wei === 0n) return "Ξ0";
  const n = Number(wei) / 1e18;
  return `Ξ${n < 0.0001 ? "<0.0001" : n.toLocaleString("en-US", { maximumFractionDigits: 5 })}`;
};

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export { formatEther };
