// One giveaway. GET → the public document + whether ?address= is in.
// POST → a wallet enters, by signature — never by payment.
//
// Same verify-before-store discipline as /api/raffles/register: an entry list
// decides who gets a WL spot, so a row only lands after the signature checks
// out against the canonical message. Optional gate: requireSouls > 0 means the
// wallet must hold that many Cubist Souls at entry time (balanceOf on mainnet).
// The balance read FAILS CLOSED — a wallet that cannot be verified is asked to
// try again, because handing partner WL spots to unverified wallets is worse
// than a retry.

import { verifyMessage, isAddress, createPublicClient, fallback, http } from "viem";
import { mainnet } from "viem/chains";
import {
  addEntry,
  entryCount,
  getGiveaway,
  giveawayEntryMessage,
  hasEntered,
  redis,
  storageConfigured,
} from "@/lib/giveaways";
import { SOULS } from "@/lib/raffle";

export const runtime = "nodejs";

const RL_MAX = 30;
const RL_WINDOW = 3600;

const RPCS = [
  "https://gateway.tenderly.co/public/mainnet",
  "https://eth.drpc.org",
  "https://ethereum-rpc.publicnode.com",
];

const chain = createPublicClient({
  chain: mainnet,
  transport: fallback(
    RPCS.map((url) => http(url, { retryCount: 0, timeout: 15_000 })),
    { rank: false },
  ),
});

const ERC721_BALANCE = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

function parseId(params: { id: string }): number | null {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 && id <= 1_000_000 ? id : null;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = parseId(params);
  if (id === null) return Response.json({ error: "bad giveaway" }, { status: 400 });
  if (!storageConfigured()) return Response.json({ error: "storage not configured" }, { status: 500 });

  const g = await getGiveaway(id).catch(() => null);
  if (!g) return Response.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  const [entries, entered] = await Promise.all([
    entryCount(id).catch(() => 0),
    address && isAddress(address) ? hasEntered(id, address).catch(() => false) : false,
  ]);

  const { createdBy, ...pub } = g;
  return Response.json(
    { ...pub, createdBy: createdBy?.username ?? "—", entries, entered },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const id = parseId(params);
  if (id === null) return Response.json({ error: "bad giveaway" }, { status: 400 });
  if (!storageConfigured()) return Response.json({ error: "storage not configured" }, { status: 500 });

  let body: { address?: unknown; sig?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  const address = String(body?.address ?? "");
  if (!isAddress(address)) return Response.json({ error: "bad address" }, { status: 400 });
  const sig = String(body?.sig ?? "");
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) {
    return Response.json({ error: "bad signature" }, { status: 400 });
  }

  const g = await getGiveaway(id).catch(() => null);
  if (!g) return Response.json({ error: "not found" }, { status: 404 });
  if (g.status !== "open") return Response.json({ error: "giveaway is not open" }, { status: 409 });
  if (Math.floor(Date.now() / 1000) >= g.endsAt) {
    return Response.json({ error: "entries are closed" }, { status: 409 });
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message: giveawayEntryMessage(id, address),
      signature: sig as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) return Response.json({ error: "signature does not match" }, { status: 401 });

  if (g.requireSouls > 0) {
    let held: bigint;
    try {
      held = (await chain.readContract({
        address: SOULS,
        abi: ERC721_BALANCE,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      })) as bigint;
    } catch {
      return Response.json(
        { error: "could not verify your souls right now — try again in a minute" },
        { status: 503 },
      );
    }
    if (held < BigInt(g.requireSouls)) {
      return Response.json(
        { error: `this giveaway asks for ${g.requireSouls} soul${g.requireSouls > 1 ? "s" : ""} in the wallet` },
        { status: 403 },
      );
    }
  }

  try {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const key = "cs:ga:rl:" + ip;
    const n = (await redis(["INCR", key])) as number;
    if (n === 1) await redis(["EXPIRE", key, RL_WINDOW]);
    if (n > RL_MAX) return Response.json({ error: "rate limited" }, { status: 429 });
  } catch {
    /* a rate-limit hiccup must never drop a legitimate entry */
  }

  try {
    await addEntry(id, address, sig);
  } catch {
    return Response.json({ error: "store failed" }, { status: 502 });
  }
  return Response.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
