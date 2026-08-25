// Cubist Souls Govern — vote intake.
//
// Ported from pikkazo-burn/api/govern/vote.js. Two duties since the tally-scale
// work (was a dumb mailbox before):
//   1. VERIFY the EIP-191 signature before storing — a ballot that can't recover
//      to its own address is rejected at the door, so nothing downstream (the
//      weigher, the freeze) ever spends chain reads on junk.
//   2. WEIGH the voter's soul-bound power ONCE, here, and cache it in Redis
//      (lib/govern-weigh) so no visitor's browser has to re-read the chain per
//      voter. Weighing races a soft deadline: a slow RPC never blocks the vote —
//      the weigh finishes in the background and the votes reader picks it up.
//
// CANONICAL MESSAGE (built by lib/govern-ballot, shared with the client):
//   Cubist Souls Govern
//   Proposal: <id>
//   Choice: <optionIndex>
//   Snapshot: <snapshotBlock>
//   Voter: <address lowercase>
//
// Storage (Upstash Redis REST, keys under cs:gov:):
//   HSET cs:gov:votes:<proposalId> <address_lc> {"choice":n,"sig":"0x..","ts":unix}
//   HSET cs:gov:weights <address_lc> {"power":n,"souls":n,"at":unix}
//   INCR cs:gov:rl:<ip>  (TTL 3600s)  — light anti-spam, 20 votes/hour/IP
//
// Credentials are injected by the host (Vercel env); never inline them.

import { loadAllProposals, redis, redisConfigured } from "@/lib/govern-server";
import { verifyBallotSig, weighSoft } from "@/lib/govern-weigh";

export const runtime = "nodejs";

const RL_MAX = 20;
const RL_WINDOW = 3600;

// Pure validator. Returns {ok:true,...} or {ok:false,code,error}.
function validateVote(body: any, proposals: any[], nowMs: number) {
  if (!body || typeof body !== "object") return { ok: false as const, code: 400, error: "bad body" };
  const { proposalId, choice, address, sig } = body;

  if (typeof proposalId !== "string" || proposalId.length > 64)
    return { ok: false as const, code: 400, error: "bad proposalId" };
  const prop = proposals.find((p) => p.id === proposalId);
  if (!prop) return { ok: false as const, code: 404, error: "unknown proposal" };

  const c = Number(choice);
  if (!Number.isInteger(c) || c < 0 || c >= prop.options.length)
    return { ok: false as const, code: 400, error: "choice out of range" };

  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address))
    return { ok: false as const, code: 400, error: "bad address" };

  // 65-byte secp256k1 signature = 132 hex chars incl. 0x.
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig))
    return { ok: false as const, code: 400, error: "bad signature" };

  if (nowMs >= Date.parse(prop.closesAt))
    return { ok: false as const, code: 409, error: "voting closed" };

  return {
    ok: true as const,
    proposalId,
    address: address.toLowerCase(),
    choice: c,
    snapshotBlock: typeof prop.snapshotBlock === "number" ? prop.snapshotBlock : undefined,
  };
}

export async function POST(req: Request) {
  if (!redisConfigured())
    return Response.json({ error: "storage not configured" }, { status: 500 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  // Museum proposals (proposals.json) + reaper proposals (Redis) — a ballot on
  // either goes through this same mailbox.
  let proposals;
  try {
    proposals = await loadAllProposals(req);
  } catch {
    return Response.json({ error: "proposals unavailable" }, { status: 502 });
  }

  const v = validateVote(body, proposals, Date.now());
  if (!v.ok) return Response.json({ error: v.error }, { status: v.code });

  // The ballot must recover to its own address — checked BEFORE the rate limit
  // so a forged ballot can't even burn the IP's budget.
  const sigOk = await verifyBallotSig(v.proposalId, v.choice, v.snapshotBlock, v.address, body.sig);
  if (!sigOk) return Response.json({ error: "invalid signature" }, { status: 401 });

  // light per-IP rate limit (best-effort; never blocks a legit single vote)
  try {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const key = "cs:gov:rl:" + ip;
    const n = await redis(["INCR", key]);
    if (n === 1) await redis(["EXPIRE", key, RL_WINDOW]);
    if (n > RL_MAX) return Response.json({ error: "rate limited" }, { status: 429 });
  } catch {
    /* rate-limit failure must not drop a vote */
  }

  try {
    const value = JSON.stringify({ choice: v.choice, sig: body.sig, ts: Math.floor(Date.now() / 1000) });
    await redis(["HSET", "cs:gov:votes:" + v.proposalId, v.address, value]);
  } catch {
    return Response.json({ error: "store failed" }, { status: 502 });
  }

  // Weigh the voter now, so the ballot usually lands already counted. Soft
  // deadline: a slow RPC returns the vote anyway and the weigh lands later.
  const weight = await weighSoft(v.address, 12_000);

  return Response.json(
    { ok: true, weight },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  return Response.json({ error: "POST only" }, { status: 405 });
}
