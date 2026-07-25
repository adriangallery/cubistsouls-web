// Cubist Souls Govern — public vote reader.
//   GET /api/govern/votes?id=<proposalId>
// Returns the raw ballot box for a proposal as flat JSON. Signatures are NOT
// filtered here; verification is the auditor's job.
//
// Ported from pikkazo-burn/api/govern/votes.js — identical shape + headers.

export const runtime = "nodejs";

const ENV = process.env;

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

export async function GET(req: Request) {
  if (!ENV.UPSTASH_REDIS_REST_URL || !ENV.UPSTASH_REDIS_REST_TOKEN)
    return Response.json({ error: "storage not configured" }, { status: 500 });

  const id = String(new URL(req.url).searchParams.get("id") || "");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });

  let flat;
  try {
    // HGETALL returns [field, value, field, value, ...] over the REST API.
    flat = await redis(["HGETALL", "cs:gov:votes:" + id]);
  } catch {
    return Response.json({ error: "read failed" }, { status: 502 });
  }

  const out: Record<string, any> = {};
  if (Array.isArray(flat)) {
    for (let i = 0; i + 1 < flat.length; i += 2) {
      try {
        out[flat[i]] = JSON.parse(flat[i + 1]);
      } catch {
        /* skip malformed entry */
      }
    }
  }

  return Response.json(
    { id, votes: out },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
      },
    }
  );
}
