// Cubist Souls Govern — public vote reader.
//   GET /api/govern/votes?id=<proposalId>
//
// Returns the raw ballot box PLUS the server-computed weights, and — once the
// proposal has closed — the FROZEN final tally:
//
//   { id, votes, weights }            while the vote is open
//   { id, votes, weights?, final }    once closed and frozen
//
// `votes` keeps the exact legacy shape (raw signed ballots, unfiltered) so the
// client-side audit path still works: anyone can recover every signature and
// re-weigh every wallet themselves. `weights` is the shared cache written by
// the vote intake / background weigher (lib/govern-weigh); the page uses it so
// visitors stop re-reading the chain per voter. `final` is written once with
// SET NX when the first reader finds the proposal closed — closed proposals
// cost zero chain reads forever after.
//
// Ported from pikkazo-burn/api/govern/votes.js (shape is a superset).

import { loadAllProposals, redisConfigured, redis } from "@/lib/govern-server";
import {
  freezeFinalTally,
  getFinalTally,
  getStoredWeights,
  isFresh,
  queueWeigh,
  type StoredWeight,
} from "@/lib/govern-weigh";

export const runtime = "nodejs";

type Ballot = { choice: number; sig: string; ts: number };

export async function GET(req: Request) {
  if (!redisConfigured())
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

  const votes: Record<string, Ballot> = {};
  if (Array.isArray(flat)) {
    for (let i = 0; i + 1 < flat.length; i += 2) {
      try {
        votes[flat[i]] = JSON.parse(flat[i + 1]);
      } catch {
        /* skip malformed entry */
      }
    }
  }

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
  };

  // The proposal itself (for closesAt / options / snapshot). A feed blip must
  // not take down the ballot box — degrade to the legacy votes-only shape.
  let prop: any = null;
  try {
    prop = (await loadAllProposals(req)).find((p) => p?.id === id) ?? null;
  } catch {
    /* votes-only response below */
  }

  const closed = prop ? Date.now() >= Date.parse(prop.closesAt) : false;

  // Closed → serve the frozen tally, freezing it on first read. While a freeze
  // is incomplete (a weigh failed) we fall through to the open-shape response
  // so the page still renders a live count, and the next read retries.
  if (closed && Array.isArray(prop.options)) {
    let final = await getFinalTally(id);
    if (!final) final = await freezeFinalTally(prop, votes);
    if (final) {
      // Frozen numbers never change — cache hard.
      return Response.json(
        { id, votes, final },
        { status: 200, headers: { ...headers, "Cache-Control": "public, max-age=60, s-maxage=300" } },
      );
    }
  }

  // Open (or freeze pending): attach the weights we have, queue the rest.
  const addrs = Object.keys(votes);
  let weights: Record<string, StoredWeight> = {};
  try {
    const stored = await getStoredWeights(addrs);
    weights = Object.fromEntries(stored);
    queueWeigh(addrs.filter((a) => !isFresh(stored.get(a.toLowerCase()))));
  } catch {
    /* weights are an optimization — the client can still weigh */
  }

  return Response.json({ id, votes, weights }, { status: 200, headers });
}
