// Cubist Souls Govern — REAPERS OPEN PROPOSALS.
//   POST /api/govern/propose
//
// Unlike the vote mailbox (dumb on purpose — tally is client-side), this route
// VERIFIES before it stores, because a stored proposal goes LIVE on /govern
// with no human in between:
//
//   1. the EIP-191 signature recovers to `address` over the canonical message
//      (lib/govern-propose — the same builder the form signs with), and
//   2. ON-CHAIN, fresh: ownerOf(reaperId) == address AND isReaper(reaperId).
//      Without this, anyone could put a proposal on the museum's wall; the
//      crown is the whole gate ("Only reapers open a proposal").
//
// The voting window is a CLOSED selector (3/7/14 days — PROPOSAL_WINDOWS);
// closesAt is derived HERE from receipt time, never trusted from the client.
// snapshotBlock is the chain head at creation — same role it plays in
// prop-001: it pins when the ballot opened and rides inside every vote
// message. Storage: HSET cs:gov:props <id> {json} (see lib/govern-server).

import { recoverMessageAddress } from "viem";
import { buildProposeMessage, validatePropose } from "@/lib/govern-propose";
import {
  PROPS_KEY,
  loadAllProposals,
  redis,
  redisConfigured,
  type StoredProposal,
} from "@/lib/govern-server";
import { getLatestBlock, getProposerGate } from "@/lib/chain";

export const runtime = "nodejs";

// Stricter than the vote limiter: 5 proposal attempts per hour per IP.
const RL_MAX = 5;
const RL_WINDOW = 3600;

const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "untitled";

export async function POST(req: Request) {
  if (!redisConfigured()) return Response.json({ error: "storage not configured" }, { status: 500 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const v = validatePropose(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const f = v.fields;

  const sig = body?.sig;
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig))
    return Response.json({ error: "bad signature" }, { status: 400 });

  // Rate limit BEFORE the expensive checks (recover + 2 RPC reads). Unlike the
  // vote route this one fails CLOSED on a Redis error: if we can't count
  // attempts we couldn't store the proposal either.
  try {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const key = "cs:gov:rlp:" + ip;
    const n = await redis(["INCR", key]);
    if (n === 1) await redis(["EXPIRE", key, RL_WINDOW]);
    if (n > RL_MAX) return Response.json({ error: "rate limited" }, { status: 429 });
  } catch {
    return Response.json({ error: "store unavailable" }, { status: 502 });
  }

  // 1) The signature must be the reaper's own hand over these exact fields.
  try {
    const rec = await recoverMessageAddress({
      message: buildProposeMessage(f),
      signature: sig as `0x${string}`,
    });
    if (rec.toLowerCase() !== f.address)
      return Response.json({ error: "signature does not match author" }, { status: 401 });
  } catch {
    return Response.json({ error: "signature unverifiable" }, { status: 400 });
  }

  // 2) The crown, read fresh from the diamond.
  let snapshotBlock: number;
  try {
    const [gate, head] = await Promise.all([getProposerGate(f.reaperId), getLatestBlock()]);
    if (!gate.isReaper)
      return Response.json({ error: `soul #${f.reaperId} is not a reaper` }, { status: 403 });
    if (gate.holder !== f.address)
      return Response.json({ error: `you do not hold reaper #${f.reaperId}` }, { status: 403 });
    snapshotBlock = head;
  } catch {
    return Response.json({ error: "chain unreachable — try again" }, { status: 502 });
  }

  // One live proposal per author at a time — the wall is a rostrum, not a feed.
  let existing: any[];
  try {
    existing = await loadAllProposals(req);
  } catch {
    return Response.json({ error: "proposals unavailable" }, { status: 502 });
  }
  const now = Date.now();
  if (
    existing.some(
      (p) => p?.author === f.address && p.closesAt && now < Date.parse(p.closesAt),
    )
  )
    return Response.json(
      { error: "you already have a live proposal — one at a time" },
      { status: 409 },
    );

  // id: readable slug + a suffix from the signature (deterministic, retriable).
  const ids = new Set(existing.map((p) => p?.id));
  let id = `prop-${slugOf(f.title)}-${sig.slice(-6)}`;
  if (ids.has(id)) id = `prop-${slugOf(f.title)}-${sig.slice(-12)}`;
  if (ids.has(id)) return Response.json({ error: "id collision — reword the title" }, { status: 409 });

  const proposal: StoredProposal = {
    id,
    type: "REAPER",
    proposer: `Soul Reaper #${f.reaperId}`,
    reaperId: f.reaperId,
    author: f.address,
    sig,
    title: f.title,
    body: f.body || undefined,
    options: f.options,
    windowDays: f.windowDays,
    snapshotBlock,
    opensAt: new Date(now).toISOString(),
    closesAt: new Date(now + f.windowDays * 86_400_000).toISOString(),
  };

  try {
    // HSETNX: if two submissions race to the same id, the second loses loudly
    // instead of silently overwriting the first reaper's proposal.
    const set = await redis(["HSETNX", PROPS_KEY, id, JSON.stringify(proposal)]);
    if (set !== 1) return Response.json({ error: "id collision — try again" }, { status: 409 });
  } catch {
    return Response.json({ error: "store failed" }, { status: 502 });
  }

  return Response.json(
    { ok: true, id, proposal },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  return Response.json({ error: "POST only" }, { status: 405 });
}
