// Curators' board — the Museum Hours leaderboard, computed SERVER-SIDE and cached.
//
// It used to be recomputed in every visitor's browser (buildBoard): a full-collection
// scan + cohortOf/getBlock storm per page view — slow for everyone and an RPC burst
// on each load. Adrian 28-jul: "siempre le cuesta cargar; no necesitamos tiempo real,
// cachear a X minutos". So the heavy pass moves here, behind a 5-min memo, and
// /my-souls just fetches this JSON (see MySouls.tsx → boardForAccount).
//
// Caching, mirroring lib/chain.ts getReapers:
//   • module-level memo, TTL 300s → within the window every request is served
//     WITHOUT touching RPC (single container on the mini, so the memo is shared by
//     every visitor);
//   • an inflight promise dedupes the concurrent recomputes right after expiry (the
//     first visitor after the TTL pays once; everyone else awaits the same compute);
//   • last-good fallback: if a fresh compute fails, serve the previous snapshot
//     rather than an empty board;
//   • Cache-Control s-maxage=300 so any upstream proxy can cache it too.
// ?warm=1 is accepted so a boot/cron ping can pre-compute the first snapshot; it
// behaves like any other request (computes if stale, otherwise returns the memo).

import type { NextRequest } from "next/server";
import { createPublicClient, fallback, http } from "viem";
import { mainnet } from "viem/chains";
import { computeBoardData, type BoardData } from "@/lib/mh";
import flags from "@/public/flags.json";

export const runtime = "nodejs";
// Never evaluate at build time (we don't want an RPC round-trip during docker build);
// the handler owns its own caching via the memo + Cache-Control header below.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REAPER_LIVE = (flags as { reaperLive?: boolean }).reaperLive === true;

// Server-side RPC failover — SAME ordering/rationale as lib/chain.ts: from the mini's
// datacenter IP only the Tenderly public gateway answers reliably; drpc + publicnode
// are the failover (drpc caps getLogs at 10k blocks on free, so the getLogs paths in
// lib/souls.ts keep a ≤9000-block chunk fallback). retryCount 0 so a stalled provider
// hands off fast; batch folds the multicall/getBlock reads into few POSTs.
const RPCS = [
  "https://gateway.tenderly.co/public/mainnet",
  "https://eth.drpc.org",
  "https://ethereum-rpc.publicnode.com",
];
const serverClient = createPublicClient({
  chain: mainnet,
  transport: fallback(
    RPCS.map((url) => http(url, { retryCount: 0, timeout: 20_000, batch: { wait: 16, batchSize: 100 } })),
    { rank: false },
  ),
});

const TTL_MS = 300_000; // 5 min — matches the /reapers ISR; the museum isn't real-time
// Beyond this we stop serving the old snapshot and make the caller wait: a board
// half an hour out of date is worse than a slow one.
const MAX_STALE_MS = 1_800_000; // 30 min
let memo: { value: BoardData; ts: number } | null = null;
let inflight: Promise<BoardData> | null = null;

async function computeSnapshot(): Promise<BoardData> {
  const core = await computeBoardData(serverClient, REAPER_LIVE);
  return { ...core, updatedAt: Date.now() };
}

// Recompute, deduped: concurrent callers share one pass. Never rejects while a
// last-good snapshot exists.
function refresh(): Promise<BoardData> {
  if (!inflight) {
    inflight = computeSnapshot()
      .then((d) => {
        memo = { value: d, ts: Date.now() };
        return d;
      })
      .catch((e) => {
        if (memo) return memo.value; // transient RPC failure must not break the board
        throw e;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// STALE-WHILE-REVALIDATE, server side.
//
// This used to `await` the recompute the moment the memo went stale, so every five
// minutes exactly one visitor paid the full pass — measured at ~11s in production —
// while a perfectly good snapshot sat unused in memory. That was the "why is the
// cached board still slow?" Adrian kept hitting: not a cache miss, a cache that
// refused to be served while it refreshed.
//
// Now the only request that ever waits is the very first one after a boot, when
// there is genuinely nothing to show.
async function getSnapshot(): Promise<BoardData> {
  const age = memo ? Date.now() - memo.ts : Number.POSITIVE_INFINITY;
  if (memo && age < TTL_MS) return memo.value; // fresh
  if (memo && age < MAX_STALE_MS) {
    // stale but usable: hand it over now, refresh behind the caller's back
    void refresh().catch(() => {});
    return memo.value;
  }
  return refresh(); // nothing usable — this one has to wait
}

export async function GET(_req: NextRequest) {
  try {
    const data = await getSnapshot();
    return Response.json(data, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch {
    // First-ever compute failed and there is no last-good yet. Return an empty board
    // (200, short cache) so the client shows "board couldn't load, your hours are
    // current" rather than a hard error — the next request retries.
    const empty: BoardData = { rows: [], contrib: [], totalRate: 0, totalLibs: 0, updatedAt: Date.now() };
    return Response.json(empty, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=30" },
    });
  }
}
