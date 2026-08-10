// The Enter button's landing — SoulWatcher calls this when someone presses
// Enter on a giveaway embed. S2S only (x-cs-bot-key): the bot is the single
// caller allowed to enter a wallet without a fresh signature, because the
// authority is the stored LINK signature plus Discord's own proof of who
// pressed the button.
//
// Same gates as the web entry: open, before the close, souls requirement
// checked fail-closed. Errors come back as readable strings the bot can put
// in an ephemeral reply verbatim.

import { createPublicClient, fallback, http } from "viem";
import { mainnet } from "viem/chains";
import {
  addEntry,
  botKeyOk,
  getGiveaway,
  getLinkByDiscord,
  hasEntered,
  storageConfigured,
} from "@/lib/giveaways";
import { SOULS } from "@/lib/raffle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!botKeyOk(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!storageConfigured()) return Response.json({ error: "storage not configured" }, { status: 500 });

  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "bad giveaway" }, { status: 400 });

  let body: { discordId?: unknown; username?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  const discordId = String(body.discordId ?? "").trim();
  const username = String(body.username ?? "").trim().slice(0, 40);
  if (!/^\d{5,25}$/.test(discordId)) return Response.json({ error: "bad discord id" }, { status: 400 });

  const g = await getGiveaway(id).catch(() => null);
  if (!g) return Response.json({ error: "not found" }, { status: 404 });
  if (g.status !== "open" || Math.floor(Date.now() / 1000) >= g.endsAt) {
    return Response.json({ error: "entries are closed" }, { status: 409 });
  }

  const link = await getLinkByDiscord(discordId).catch(() => null);
  if (!link) {
    // the bot turns this into "link your wallet first" with the URL
    return Response.json({ error: "no wallet linked", noLink: true }, { status: 404 });
  }

  if (await hasEntered(id, link.wallet).catch(() => false)) {
    return Response.json(
      { ok: true, already: true, wallet: link.wallet },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (g.requireSouls > 0) {
    let held: bigint;
    try {
      held = (await chain.readContract({
        address: SOULS,
        abi: ERC721_BALANCE,
        functionName: "balanceOf",
        args: [link.wallet as `0x${string}`],
      })) as bigint;
    } catch {
      return Response.json(
        { error: "could not verify your souls right now — try again in a minute" },
        { status: 503 },
      );
    }
    if (held < BigInt(g.requireSouls)) {
      return Response.json(
        {
          error: `this giveaway asks for ${g.requireSouls} soul${g.requireSouls > 1 ? "s" : ""} in the linked wallet`,
        },
        { status: 403 },
      );
    }
  }

  try {
    await addEntry(id, link.wallet, `discord:${discordId}`, "discord", {
      id: discordId,
      username: username || link.username,
    });
  } catch {
    return Response.json({ error: "store failed" }, { status: 502 });
  }
  return Response.json(
    { ok: true, wallet: link.wallet },
    { headers: { "Cache-Control": "no-store" } },
  );
}
