// Cubist Souls Raffles — gasless entry.
//
// Holders opt in by SIGNING, never by paying. An EIP-191 personal_sign costs nothing,
// proves the wallet, and leaves a signature anyone can re-check against the published
// entry list later.
//
// CANONICAL MESSAGE — kept short and readable, because people should be able to read
// what they are signing in the wallet popup:
//
//   Cubist Souls — entering the raffle
//   Occasion: <id>
//   Wallet: <address lowercase>
//
// The occasion id is what stops a signature being replayed into a different draw.
//
// UNLIKE the govern mailbox (which stores ballots unverified and lets the tally be
// recomputed client-side), this route VERIFIES before storing. An entry list decides
// who wins a prize; letting anyone POST rows for wallets they do not control would
// mean filtering forgeries out at publish time, and a mailbox nobody can trust is
// worse than no mailbox.
//
// Storage (Upstash Redis REST, same host env as govern):
//   HSET cs:raffle:reg:<id> <address_lc> {"sig":"0x..","ts":unix}
//   INCR cs:raffle:rl:<ip> (TTL 3600s) — light anti-spam

import { verifyMessage, isAddress } from "viem";
import { entryMessage } from "@/lib/raffle";

export const runtime = "nodejs";

const ENV = process.env;
const RL_MAX = 30;
const RL_WINDOW = 3600;

async function redis(cmd: unknown[]) {
  const r = await fetch(ENV.UPSTASH_REDIS_REST_URL as string, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + ENV.UPSTASH_REDIS_REST_TOKEN,
      "content-type": "application/json",
    },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  const j = await r.json();
  if (j.error) throw new Error("redis: " + j.error);
  return j.result;
}

export async function POST(req: Request) {
  if (!ENV.UPSTASH_REDIS_REST_URL || !ENV.UPSTASH_REDIS_REST_TOKEN) {
    return Response.json({ error: "storage not configured" }, { status: 500 });
  }

  let body: { raffleId?: unknown; address?: unknown; sig?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }

  const id = Number(body?.raffleId);
  if (!Number.isInteger(id) || id < 0 || id > 1_000_000) {
    return Response.json({ error: "bad occasion" }, { status: 400 });
  }
  const address = String(body?.address ?? "");
  if (!isAddress(address)) return Response.json({ error: "bad address" }, { status: 400 });
  const sig = String(body?.sig ?? "");
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) {
    return Response.json({ error: "bad signature" }, { status: 400 });
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message: entryMessage(id, address),
      signature: sig as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) return Response.json({ error: "signature does not match" }, { status: 401 });

  try {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const key = "cs:raffle:rl:" + ip;
    const n = (await redis(["INCR", key])) as number;
    if (n === 1) await redis(["EXPIRE", key, RL_WINDOW]);
    if (n > RL_MAX) return Response.json({ error: "rate limited" }, { status: 429 });
  } catch {
    /* a rate-limit hiccup must never drop a legitimate entry */
  }

  try {
    const value = JSON.stringify({ sig, ts: Math.floor(Date.now() / 1000) });
    await redis(["HSET", `cs:raffle:reg:${id}`, address.toLowerCase(), value]);
  } catch {
    return Response.json({ error: "store failed" }, { status: 502 });
  }

  return Response.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/// GET ?id=N            → { count }            how many wallets are in
/// GET ?id=N&address=0x → { count, entered }   …and whether this one is
export async function GET(req: Request) {
  if (!ENV.UPSTASH_REDIS_REST_URL || !ENV.UPSTASH_REDIS_REST_TOKEN) {
    return Response.json({ count: 0, entered: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id < 0) return Response.json({ error: "bad occasion" }, { status: 400 });
  const address = url.searchParams.get("address");

  try {
    const count = (await redis(["HLEN", `cs:raffle:reg:${id}`])) as number;
    let entered = false;
    if (address && isAddress(address)) {
      const v = await redis(["HGET", `cs:raffle:reg:${id}`, address.toLowerCase()]);
      entered = v != null;
    }
    return Response.json({ count: count ?? 0, entered }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ count: 0, entered: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
