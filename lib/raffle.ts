// The museum's raffles — read side.
//
// Every rule lives on the diamond (RaffleFacet): the weights, the exclusions, the
// three blocks, the seed and the published winners. This file only reads them, so the
// page can never disagree with the contract about what an occasion's rules are.
//
// THE THREE BLOCKS, because they drive most of the copy on the page:
//   holderBlock — already past. The flat per-wallet entry was counted there, so it
//                 cannot be farmed by splitting a collection across new wallets.
//   closeBlock  — the window. Pikkazos burned up to here still earn their tickets;
//                 that is the whole point of leaving an occasion open for days.
//   drawBlock   — after the close, its hash is the seed.
//
// IMPORTANT — no ticket total on this page is "live". The counters on /my-souls read
// current state, which is right there and wrong here: a wallet that bought souls after
// the holder block would be shown entries it does not have.

import { createPublicClient, fallback, http } from "viem";
import { mainnet } from "viem/chains";

export const SOULS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406" as const;

const RPCS = [
  "https://gateway.tenderly.co/public/mainnet",
  "https://eth.drpc.org",
  "https://ethereum-rpc.publicnode.com",
];

const client = createPublicClient({
  chain: mainnet,
  transport: fallback(
    RPCS.map((url) => http(url, { retryCount: 0, timeout: 15_000 })),
    { rank: false },
  ),
});

export const RAFFLE_ABI = [
  { type: "function", name: "raffleCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "raffle",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "label", type: "string" },
      { name: "prizeURI", type: "string" },
      { name: "holderBlock", type: "uint64" },
      { name: "closeBlock", type: "uint64" },
      { name: "drawBlock", type: "uint64" },
      { name: "seed", type: "bytes32" },
      { name: "winners", type: "uint32" },
      { name: "cancelled", type: "bool" },
      { name: "ticketsHash", type: "bytes32" },
      { name: "winnerList", type: "address[]" },
      {
        name: "w",
        type: "tuple",
        components: [
          { name: "perConsumedSoul", type: "uint16" },
          { name: "perAscendedReaper", type: "uint16" },
          { name: "perHolderWallet", type: "uint16" },
          { name: "perSoulHeld", type: "uint16" },
          { name: "perOGSoulHeld", type: "uint16" },
          { name: "maxPerWallet", type: "uint32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "globallyExcluded",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
] as const;

export type Weights = {
  perConsumedSoul: number;
  perAscendedReaper: number;
  perHolderWallet: number;
  perSoulHeld: number;
  perOGSoulHeld: number;
  maxPerWallet: number;
};

export type Raffle = {
  id: number;
  label: string;
  prizeURI: string;
  holderBlock: number;
  closeBlock: number;
  drawBlock: number;
  seed: string;
  winners: number;
  cancelled: boolean;
  ticketsHash: string;
  winnerList: string[];
  w: Weights;
};

export type RaffleStage = "open" | "closed" | "awaiting-draw" | "drawn" | "published" | "cancelled";

/** Where an occasion is in its life, derived from the chain rather than a stored flag. */
export function stageOf(r: Raffle, head: number): RaffleStage {
  if (r.cancelled) return "cancelled";
  if (r.winnerList.length > 0) return "published";
  if (r.seed && !/^0x0+$/.test(r.seed)) return "drawn";
  if (head >= r.drawBlock) return "awaiting-draw";
  if (head >= r.closeBlock) return "closed";
  return "open";
}

/** Returns null when the facet isn't on the diamond yet — the page renders a preview. */
export async function loadRaffles(): Promise<{ raffles: Raffle[]; head: number } | null> {
  try {
    const [countRaw, head] = await Promise.all([
      client.readContract({ address: SOULS, abi: RAFFLE_ABI, functionName: "raffleCount" }),
      client.getBlockNumber(),
    ]);
    const count = Number(countRaw);
    const raffles: Raffle[] = [];
    for (let id = count - 1; id >= 0; id--) {
      const r = (await client.readContract({
        address: SOULS,
        abi: RAFFLE_ABI,
        functionName: "raffle",
        args: [BigInt(id)],
      })) as unknown as [string, string, bigint, bigint, bigint, string, number, boolean, string, string[], Weights];
      raffles.push({
        id,
        label: r[0],
        prizeURI: r[1],
        holderBlock: Number(r[2]),
        closeBlock: Number(r[3]),
        drawBlock: Number(r[4]),
        seed: r[5],
        winners: Number(r[6]),
        cancelled: r[7],
        ticketsHash: r[8],
        winnerList: r[9] as string[],
        w: {
          perConsumedSoul: Number(r[10].perConsumedSoul),
          perAscendedReaper: Number(r[10].perAscendedReaper),
          perHolderWallet: Number(r[10].perHolderWallet),
          perSoulHeld: Number(r[10].perSoulHeld),
          perOGSoulHeld: Number(r[10].perOGSoulHeld),
          maxPerWallet: Number(r[10].maxPerWallet),
        },
      });
    }
    return { raffles, head: Number(head) };
  } catch {
    return null; // facet not cut yet, or the chain is unreachable
  }
}

/** Earned while the window is open — burning now still counts toward these. */
export function earnableRules(w: Weights): string[] {
  const out: string[] = [];
  if (w.perConsumedSoul > 0) {
    out.push(`${w.perConsumedSoul} per Pikkazo your reapers give to the fire`);
  }
  if (w.perAscendedReaper > 0) {
    out.push(`${w.perAscendedReaper} more for every soul that reached Soul Reaper`);
  }
  return out;
}

/** Already settled at the holder block — nothing done now can change these. */
export function settledRules(w: Weights): string[] {
  const out: string[] = [];
  if (w.perHolderWallet > 0) {
    out.push(`${w.perHolderWallet} ticket${w.perHolderWallet > 1 ? "s" : ""} for holding a soul at all`);
  }
  if (w.perSoulHeld > 0) out.push(`${w.perSoulHeld} per soul held`);
  if (w.perOGSoulHeld > 0) out.push(`${w.perOGSoulHeld} per OG soul held`);
  if (w.maxPerWallet > 0) out.push(`capped at ${w.maxPerWallet} per wallet`);
  return out;
}

/** Roughly how long the window still has, at ~12s a block. */
export function blocksToHuman(blocks: number): string {
  if (blocks <= 0) return "closed";
  const mins = (blocks * 12) / 60;
  if (mins < 90) return `${Math.round(mins)} min`;
  const hours = mins / 60;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}
