// Wallet ↔ Discord link — the one-time signature behind the Enter button.
//
// GET    → { link: { wallet } | null }           (needs a Discord session)
// POST   { address, sig }   → link              (verifies walletLinkMessage)
// POST   { unlink: true }   → unlink
//
// The link belongs to the SESSION's Discord account: the signed message names
// that Discord id, so a signature collected for one account cannot be replayed
// to attach the same wallet to another. Any Discord login may link — this is
// for holders, not just managers.

import { verifyMessage, isAddress } from "viem";
import {
  clearLink,
  getLinkByDiscord,
  sessionFrom,
  setLink,
  storageConfigured,
} from "@/lib/giveaways";
import { walletLinkMessage } from "@/lib/giveaways-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ link: null }, { headers: { "Cache-Control": "no-store" } });
  if (!storageConfigured()) return Response.json({ error: "storage not configured" }, { status: 500 });
  const link = await getLinkByDiscord(s.discordId).catch(() => null);
  return Response.json(
    { link: link ? { wallet: link.wallet } : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: "sign in with Discord first" }, { status: 401 });
  if (!storageConfigured()) return Response.json({ error: "storage not configured" }, { status: 500 });

  let body: { address?: unknown; sig?: unknown; unlink?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }

  if (body.unlink === true) {
    await clearLink(s.discordId).catch(() => null);
    return Response.json({ ok: true, link: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const address = String(body.address ?? "");
  if (!isAddress(address)) return Response.json({ error: "bad address" }, { status: 400 });
  const sig = String(body.sig ?? "");
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return Response.json({ error: "bad signature" }, { status: 400 });

  let valid = false;
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message: walletLinkMessage(s.discordId, address),
      signature: sig as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) return Response.json({ error: "signature does not match" }, { status: 401 });

  try {
    await setLink(s.discordId, s.username, address);
  } catch {
    return Response.json({ error: "store failed" }, { status: 502 });
  }
  return Response.json(
    { ok: true, link: { wallet: address.toLowerCase() } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
