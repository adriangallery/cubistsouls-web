// Server-side govern storage — the ONE redis helper and the ONE proposals
// loader shared by /api/govern/vote, /api/govern/proposals and
// /api/govern/propose. Server-only (env credentials); never import from a
// client component.
//
// Proposals live in TWO places, merged here:
//   • public/govern/proposals.json — the museum's own (prop-001…), deploy-gated.
//   • Redis HSET cs:gov:props <id> {json} — REAPER proposals, created live via
//     POST /api/govern/propose with an EIP-191 author signature.
// The vote API validates against the MERGED list, so a ballot on a reaper
// proposal goes through the exact same mailbox as one on a museum proposal.

const ENV = process.env;

export const PROPS_KEY = "cs:gov:props";

export async function redis(cmd: unknown[]) {
  const r = await fetch(ENV.UPSTASH_REDIS_REST_URL as string, {
    method: "POST",
    headers: { Authorization: "Bearer " + ENV.UPSTASH_REDIS_REST_TOKEN, "content-type": "application/json" },
    body: JSON.stringify(cmd),
    // Next's patched fetch can freeze a POST response in its Data Cache
    // (bit the giveaways feed, 10-ago) - Redis commands are never cacheable.
    cache: "no-store",
  });
  if (!r.ok) throw new Error("redis " + r.status);
  const j = await r.json();
  if (j.error) throw new Error("redis: " + j.error);
  return j.result;
}

export function redisConfigured(): boolean {
  return Boolean(ENV.UPSTASH_REDIS_REST_URL && ENV.UPSTASH_REDIS_REST_TOKEN);
}

// The stored shape of a reaper proposal — a strict superset of the static
// proposals.json entries, so Proposal.tsx renders both without knowing which
// store one came from. `author` + `sig` make every reaper proposal auditable:
// rebuild the canonical message from these fields and recover the signer.
export type StoredProposal = {
  id: string;
  type: "REAPER";
  proposer: string; // "Soul Reaper #<id>"
  reaperId: number;
  author: string; // lowercase 0x… that signed the proposal
  sig: string;
  title: string;
  body?: string;
  options: { label: string; sub?: string }[];
  windowDays: number;
  snapshotBlock: number;
  opensAt: string;
  closesAt: string;
};

// The museum's deploy-gated proposals, fetched through the same host the
// request came in on (same trick the vote route always used).
export async function loadStaticProposals(req: Request): Promise<any[]> {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0];
  const r = await fetch(`${proto}://${host}/govern/proposals.json`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("proposals " + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

export async function loadReaperProposals(): Promise<StoredProposal[]> {
  // HGETALL returns [field, value, field, value, ...] over the REST API.
  const flat = await redis(["HGETALL", PROPS_KEY]);
  const out: StoredProposal[] = [];
  if (Array.isArray(flat)) {
    for (let i = 0; i + 1 < flat.length; i += 2) {
      try {
        const p = JSON.parse(flat[i + 1]);
        if (p && typeof p.id === "string" && Array.isArray(p.options)) out.push(p);
      } catch {
        /* skip malformed entry */
      }
    }
  }
  return out;
}

// Merged list, museum first at equal state. Sorted the way the page reads:
// open proposals before closed ones, newest opening first within each band.
// A reaper id can never shadow a museum id (museum wins on collision).
export async function loadAllProposals(req: Request): Promise<any[]> {
  // A Redis blip degrades to the museum-only list rather than a 502: votes on
  // a reaper proposal would briefly 404 ("unknown proposal") and retry — the
  // store write behind them needs the same Redis anyway.
  const [fixed, live] = await Promise.all([
    loadStaticProposals(req),
    redisConfigured() ? loadReaperProposals().catch(() => []) : Promise.resolve([]),
  ]);
  const seen = new Set(fixed.map((p) => p?.id));
  const all = [...fixed, ...live.filter((p) => !seen.has(p.id))];
  const now = Date.now();
  const openRank = (p: any) => (now < Date.parse(p.closesAt) ? 0 : 1);
  const opens = (p: any) => Date.parse(p.opensAt || p.closesAt) || 0;
  all.sort((a, b) => openRank(a) - openRank(b) || opens(b) - opens(a));
  return all;
}
