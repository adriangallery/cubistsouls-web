// Cubist Souls Govern — vote intake (dumb mailbox).
//
// Ported from pikkazo-burn/api/govern/vote.js. The server does NOT verify
// signatures; it only stores signed ballots. The tally is done client-side.
//
// CANONICAL MESSAGE the voter signs (EIP-191 personal_sign) — EXACT format:
//   Cubist Souls Govern
//   Proposal: <id>
//   Choice: <optionIndex>
//   Snapshot: <snapshotBlock>
//   Voter: <address lowercase>
//
// Storage (Upstash Redis REST, keys under cs:gov:):
//   HSET cs:gov:votes:<proposalId> <address_lc> {"choice":n,"sig":"0x..","ts":unix}
//   INCR cs:gov:rl:<ip>  (TTL 3600s)  — light anti-spam, 20 votes/hour/IP
//
// Credentials are injected by the host (Vercel env); never inline them.

export const runtime = "nodejs";

const ENV = process.env;
const RL_MAX = 20;
const RL_WINDOW = 3600;

async function redis(cmd: any[]) {
  const r = await fetch(ENV.UPSTASH_REDIS_REST_URL as string, {
    method: "POST",
    headers: { Authorization: "Bearer " + ENV.UPSTASH_REDIS_REST_TOKEN, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  const j = await r.json();
  if (j.error) throw new Error("redis: " + j.error);
  return j.result;
}

async function loadProposals(req: Request) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0];
  const r = await fetch(`${proto}://${host}/govern/proposals.json`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("proposals " + r.status);
  return r.json();
}

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

  return { ok: true as const, proposalId, address: address.toLowerCase(), choice: c };
}

export async function POST(req: Request) {
  if (!ENV.UPSTASH_REDIS_REST_URL || !ENV.UPSTASH_REDIS_REST_TOKEN)
    return Response.json({ error: "storage not configured" }, { status: 500 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  let proposals;
  try {
    proposals = await loadProposals(req);
  } catch {
    return Response.json({ error: "proposals unavailable" }, { status: 502 });
  }

  const v = validateVote(body, proposals, Date.now());
  if (!v.ok) return Response.json({ error: v.error }, { status: v.code });

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

  return Response.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return Response.json({ error: "POST only" }, { status: 405 });
}
