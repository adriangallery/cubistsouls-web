// Server-side ballot weighing — the scale fix for the pyramid's tally.
//
// Before this module the tally was weighed in EVERY visitor's browser: one
// loadWalletPower per voter per proposal per session (~25-30 RPC calls each,
// including two full-range getLogs). This weighs each wallet ONCE, on the
// server, and caches the result in Redis so every visitor and every proposal
// shares it. The client keeps its own weigher only as the trustless fallback /
// audit path — anyone can still reproduce the count.
//
// Storage (Upstash, same instance as the ballots):
//   HSET cs:gov:weights <addr_lc> {"power":n,"souls":n,"at":unix}
//   SET  cs:gov:final:<proposalId> {frozen tally}  NX   — written once, at close
//
// Freshness: a weight < WEIGHT_FRESH_S old is served as-is. Older entries are
// STILL served (power drifts slowly — it's MH stars accruing) but queued for a
// background re-weigh. Single Next container on the mini, so the module-level
// queue/dedupe below is effectively global.
//
// RPC: same three providers as lib/chain.ts, viem fallback transport. Tenderly
// answers full-range getLogs in one shot; souls.ts carries the ≤9000-block
// chunk fallback for drpc/publicnode.

import { createPublicClient, fallback, http, recoverMessageAddress, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { fetchGovernParams, loadWalletPower, type GovernParams } from "./govern";
import { ballotMessage } from "./govern-ballot";
import { redis } from "./govern-server";

const RPCS = [
  "https://gateway.tenderly.co/public/mainnet",
  "https://eth.drpc.org",
  "https://ethereum-rpc.publicnode.com",
];

export const WEIGHTS_KEY = "cs:gov:weights";
const WEIGHT_FRESH_S = 6 * 3600;

export type StoredWeight = { power: number; souls: number; at: number };

let clientMemo: PublicClient | null = null;
function chainClient(): PublicClient {
  if (!clientMemo) {
    clientMemo = createPublicClient({
      chain: mainnet,
      transport: fallback(RPCS.map((u) => http(u, { timeout: 20_000, retryCount: 1 }))),
    });
  }
  return clientMemo;
}

// Params are hot-loaded from the assets repo; a 60s memo keeps the weigher from
// hitting raw.githubusercontent once per ballot.
let paramsMemo: { p: Promise<GovernParams>; ts: number } | null = null;
function params(): Promise<GovernParams> {
  if (paramsMemo && Date.now() - paramsMemo.ts < 60_000) return paramsMemo.p;
  const p = fetchGovernParams();
  paramsMemo = { p, ts: Date.now() };
  p.catch(() => {
    if (paramsMemo?.p === p) paramsMemo = null;
  });
  return p;
}

export function isFresh(w: StoredWeight | undefined | null): boolean {
  return Boolean(w && Date.now() / 1000 - w.at < WEIGHT_FRESH_S);
}

// HMGET the stored weights for a set of addresses. Missing/malformed → absent.
export async function getStoredWeights(addrs: string[]): Promise<Map<string, StoredWeight>> {
  const out = new Map<string, StoredWeight>();
  if (!addrs.length) return out;
  const res = await redis(["HMGET", WEIGHTS_KEY, ...addrs.map((a) => a.toLowerCase())]);
  if (Array.isArray(res)) {
    res.forEach((v, i) => {
      if (typeof v !== "string") return;
      try {
        const w = JSON.parse(v);
        if (Number.isFinite(w?.power) && Number.isFinite(w?.souls) && Number.isFinite(w?.at))
          out.set(addrs[i].toLowerCase(), { power: w.power, souls: w.souls, at: w.at });
      } catch {
        /* skip malformed entry */
      }
    });
  }
  return out;
}

// Weigh one wallet NOW and store it. In-flight dedupe so a burst of requests
// for the same address does the chain reads once.
const inFlight = new Map<string, Promise<StoredWeight | null>>();
export function weighAndStore(address: string): Promise<StoredWeight | null> {
  const addr = address.toLowerCase();
  const running = inFlight.get(addr);
  if (running) return running;
  const p = (async () => {
    try {
      const wp = await loadWalletPower(chainClient(), addr, await params());
      const w: StoredWeight = {
        power: wp.total,
        souls: wp.heldCount,
        at: Math.floor(Date.now() / 1000),
      };
      await redis(["HSET", WEIGHTS_KEY, addr, JSON.stringify(w)]);
      return w;
    } catch {
      // transient (RPC / Redis) — the background queue or the next request retries
      return null;
    } finally {
      inFlight.delete(addr);
    }
  })();
  inFlight.set(addr, p);
  return p;
}

// Weigh with a deadline: the vote intake awaits this so a fresh ballot usually
// lands already weighed, but a slow RPC never blocks the "your ballot is in".
// The weigh itself keeps running past the deadline and stores when it finishes.
export function weighSoft(address: string, deadlineMs: number): Promise<StoredWeight | null> {
  return Promise.race([
    weighAndStore(address),
    new Promise<null>((res) => setTimeout(() => res(null), deadlineMs)),
  ]);
}

// Background queue — fire-and-forget from the votes reader. Sequential on
// purpose: weighing is heavy and the RPCs are public; one at a time finishes a
// 40-voter backlog in a few minutes without tripping rate limits.
const queue: string[] = [];
const queued = new Set<string>();
let draining = false;
export function queueWeigh(addrs: string[]): void {
  for (const a of addrs) {
    const addr = a.toLowerCase();
    if (queued.has(addr) || inFlight.has(addr)) continue;
    queued.add(addr);
    queue.push(addr);
  }
  if (draining || !queue.length) return;
  draining = true;
  (async () => {
    while (queue.length) {
      const addr = queue.shift()!;
      queued.delete(addr);
      await weighAndStore(addr);
    }
    draining = false;
  })().catch(() => {
    draining = false;
  });
}

// ── signature verification (server-side) ─────────────────────────────────────

export async function verifyBallotSig(
  proposalId: string,
  choice: number,
  snapshotBlock: number | undefined,
  address: string,
  sig: string,
): Promise<boolean> {
  try {
    const rec = await recoverMessageAddress({
      message: ballotMessage(proposalId, choice, snapshotBlock, address),
      signature: sig as `0x${string}`,
    });
    return rec.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

// ── the frozen tally (written once, when a proposal closes) ──────────────────

export type FinalTally = {
  frozen: true;
  at: number; // unix, when the freeze was computed
  closedAt: string;
  perOpt: { power: number; ballots: number }[];
  souls: number;
  powerSum: number;
  total: number; // ballots received (valid choice)
  counted: number; // ballots that carried power (valid signature, weighed)
  bad: number; // invalid signatures dropped
};

export function finalKey(proposalId: string): string {
  return "cs:gov:final:" + proposalId;
}

export async function getFinalTally(proposalId: string): Promise<FinalTally | null> {
  try {
    const raw = await redis(["GET", finalKey(proposalId)]);
    if (typeof raw !== "string") return null;
    const f = JSON.parse(raw);
    return f?.frozen === true && Array.isArray(f.perOpt) ? f : null;
  } catch {
    return null;
  }
}

// Try to freeze a closed proposal's tally. Verifies every signature and, when
// every valid voter already has a stored weight, writes the result with SET NX
// so two concurrent readers can never disagree about the final numbers. Voters
// still missing a weight are QUEUED (never weighed inline — a reader's GET must
// not hang for minutes) and the freeze returns null; the page keeps rendering
// the live count and a later read seals it once the queue drains.
export async function freezeFinalTally(
  prop: { id: string; closesAt: string; snapshotBlock?: number; options: unknown[] },
  votes: Record<string, { choice: number; sig: string }>,
): Promise<FinalTally | null> {
  const perOpt = prop.options.map(() => ({ power: 0, ballots: 0 }));
  const valid: { addr: string; choice: number }[] = [];
  let total = 0;
  let bad = 0;

  for (const [addr, v] of Object.entries(votes)) {
    if (!Number.isInteger(v.choice) || v.choice < 0 || v.choice >= prop.options.length) continue;
    total++;
    perOpt[v.choice].ballots++;
    const ok = await verifyBallotSig(prop.id, v.choice, prop.snapshotBlock, addr, v.sig);
    if (ok) valid.push({ addr: addr.toLowerCase(), choice: v.choice });
    else bad++;
  }

  const weights = await getStoredWeights(valid.map((v) => v.addr));
  const missing = valid.filter((v) => !weights.has(v.addr)).map((v) => v.addr);
  if (missing.length) {
    queueWeigh(missing);
    return null; // can't seal an incomplete count — a later read retries
  }

  let souls = 0;
  let counted = 0;
  for (const v of valid) {
    const w = weights.get(v.addr)!;
    counted++;
    souls += w.souls;
    perOpt[v.choice].power += w.power;
  }

  const final: FinalTally = {
    frozen: true,
    at: Math.floor(Date.now() / 1000),
    closedAt: prop.closesAt,
    perOpt,
    souls,
    powerSum: perOpt.reduce((a, o) => a + o.power, 0),
    total,
    counted,
    bad,
  };

  try {
    // NX: first writer wins; a concurrent freeze reads back the stored one.
    const set = await redis(["SET", finalKey(prop.id), JSON.stringify(final), "NX"]);
    if (set === "OK") return final;
    return (await getFinalTally(prop.id)) ?? final;
  } catch {
    return final; // computed but not persisted — next read recomputes
  }
}
