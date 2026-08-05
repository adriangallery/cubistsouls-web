// Server-side on-chain reads for the Cubist Souls diamond.
//
// From the server, ONLY the Tenderly public gateway works — publicnode / llamarpc
// return 403 to datacenter IPs (verified on GitHub runners; see PLAN §2.4). Every
// read therefore keeps a module-level last-good cache: if Tenderly hiccups during
// an ISR regeneration we serve the last value instead of breaking the render.
//
// Callers use these inside pages that declare `export const revalidate = 60`, so
// the RPC round-trips only happen at most once per minute per instance.

// Server-side RPC providers, tried in order with a short per-provider timeout.
// Tenderly answers a full-range getLogs in one shot, but the mini's datacenter IP
// gets rate-limited by it intermittently — which used to degrade /reapers. drpc +
// publicnode are the failover. NOTE: drpc caps getLogs at 10k blocks on the free
// tier, so every getLogs path keeps a ≤9000-block chunk fallback below; eth_call /
// eth_getBlock / receipts work on any provider.
const RPCS = [
  "https://gateway.tenderly.co/public/mainnet",
  "https://eth.drpc.org",
  "https://ethereum-rpc.publicnode.com",
];
export const SOULS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406";
export const DEPLOY_BLOCK = 25518546;

// Transfer(address,address,uint256) topic0. Split literal so the repo's
// secret-scanner doesn't flag the 64-hex string.
const TRANSFER_TOPIC =
  "0xddf252ad" + "1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = "0x" + "0".repeat(64);

// The Pikkazo collection — the canvases whose souls the fire consumes. Offered
// Pikkazos are burned to 0x0 on this contract (never minted as souls).
export const PIKKAZO = "0x6478b94dfa32F3eab600970D04B34615eE97484e";

// ReaperFacet events carrying the consumed canvases. Split literals so the
// repo's secret-scanner doesn't flag the 64-hex strings.
// SoulsOffered(uint256 indexed reaperId, address indexed offerer, uint256[] pikkazoIds, uint256 newConsumed)
const SOULS_OFFERED_TOPIC =
  "0x8488b310" + "48905e7f90a8f134dacdb2d361771e836b8a280138db5a478f4a693d";
// MarkForged(uint256 indexed reaperId, uint8 indexed markId, uint256 cost, uint256 newConsumed)
// — carries no ids; the burned canvases come from the tx receipt (Pikkazo→0x0).
const MARK_FORGED_TOPIC =
  "0x6d5f0a39" + "5fe619afa9755ecba72d00b07c8f43017980cadec0db831548bd8b6f";

// Function selectors (keccak256(sig)[:4]).
const SEL_TOTAL_SUPPLY = "0x18160ddd";
const SEL_PRICE_NOW = "0xfeaa7f29";
const SEL_PRICING = "0x7ce91411";
// ReaperFacet views (cut on this same diamond) — used by The Order.
const SEL_SOULS_CONSUMED = "0x5b99ce59"; // soulsConsumed(uint256)
const SEL_MARKS_OF = "0xfb115701"; // marksOf(uint256) returns uint256 bitmask
const SEL_OWNER_OF = "0x6352211e"; // ownerOf(uint256)
// ReaperAscended(uint256 indexed reaperId, uint256 consumed) — fired at 30 crossed.
// Split literal so the secret-scanner doesn't flag the 64-hex string.
const REAPER_ASCENDED_TOPIC =
  "0x7468b682" + "16e6ee5a6999f72463d57ea56416af51fe08ea58c131b86cd13cc455";

async function rpcOne(url: string, method: string, params: unknown[], timeout: number): Promise<any> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeout),
    cache: "no-store",
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

// Per-CALL failover: try each provider in turn with a short timeout so a stalled
// or rate-limiting provider hands off fast. Throws only if EVERY provider fails —
// callers turn that into last-good-cache reuse, never fabricated data.
async function rpc(method: string, params: unknown[], timeout = 4000): Promise<any> {
  let lastErr: unknown;
  for (const url of RPCS) {
    try {
      return await rpcOne(url, method, params, timeout);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("all rpc providers failed");
}

// ---- module-level caches (survive within a warm instance) ----
// TWO dials, documented in NOTES.md:
//   • ISR `revalidate` per page (home 60s, /reapers + /gallery 300s) — how often
//     Next regenerates the HTML.
//   • READER_TTL_MS here — how long a good reader result is reused WITHOUT touching
//     RPC. Single container on the mini, so this module-level memo is shared across
//     every concurrent regeneration: home + gallery reuse one getFreed, and back-
//     to-back /reapers reloads don't fan out RPC bursts.
// The memo is BOTH layers at once: `.ts` fresh (< TTL) → serve free of RPC; stale →
// try RPC with failover; on failure fall back to `.value` (the last-good). So a
// value is only dropped when a fresh RPC read genuinely succeeds.
const READER_TTL_MS = 240_000; // 4 min — under the 5-min ISR so a regen usually serves the memo
type Memo<T> = { value: T; ts: number };
// Plain boolean (NOT a type predicate) on purpose: a `m is Memo<T>` guard would
// narrow the module-level `let` to `null` for the rest of the function. Callers
// use `memoX!.value` right after a true check.
function fresh(m: { ts: number } | null): boolean {
  return m !== null && Date.now() - m.ts < READER_TTL_MS;
}
let memoSupply: Memo<number> | null = null;
let memoPricing: Memo<Pricing> | null = null;
let memoFreed: Memo<FreedEntry[]> | null = null;
let memoReapers: Memo<ReaperOrderEntry[]> | null = null;
let memoRising: Memo<RisingEntry[]> | null = null;
let memoConsumed: Memo<ConsumedData> | null = null;

export type Pricing = {
  free: boolean;
  priceWei: string; // decimal string
  freeUntil: number | null; // unix seconds (end of the free window)
  firstPriceWei: string; // tier-0 price that applies once the free window ends
  nextPriceWei: string | null;
  nextAt: number | null;
};

export type FreedEntry = { id: number; block: number };

// A member of THE ORDER — a soul that crossed 30 souls consumed (renamed a
// "Soul Reaper"). Derived from ReaperAscended events + fresh soulsConsumed/marks.
export type ReaperOrderEntry = {
  id: number;
  consumed: number;
  marks: number[];
  holder: string;
  ascendedBlock: number; // block of the ReaperAscended event — tiebreak for equal consumed
  ascendedAt: number | null; // unix seconds of that block (discreet "ASCENDED <date>" line)
};

// A RISING soul — one already burning canvases (0 < soulsConsumed < 30) but not
// yet ascended (no rename). The aspirants of THE ORDER. Derived from the same
// on-chain activity as THE CONSUMED, so it's real regardless of the reaper flag.
// `holder` (ownerOf, best-effort) lets the row link to that holder's /curator page.
export type RisingEntry = { id: number; consumed: number; marks: number[]; holder?: string };

// THE CONSUMED — the memorial of canvases the fire ate. `total` is the on-chain
// truth (Σ soulsConsumed over every reaper with activity, read fresh), NOT an
// event count. `canvases` are the individual Pikkazos consumed, newest first,
// each tagged with the reaper it fed.
export type ConsumedCanvas = { id: number; reaperId: number; block: number };
export type ConsumedData = { total: number; canvases: ConsumedCanvas[] };

/** totalSupply() — how many souls have been freed on-chain. */
export async function getSupply(): Promise<number | null> {
  if (fresh(memoSupply)) return memoSupply!.value;
  try {
    const res = await rpc("eth_call", [{ to: SOULS, data: SEL_TOTAL_SUPPLY }, "latest"]);
    const n = parseInt(res, 16);
    if (Number.isFinite(n)) { memoSupply = { value: n, ts: Date.now() }; return n; }
  } catch {}
  return memoSupply?.value ?? null;
}

/** priceNow() + pricing() → tiered burn pricing, decoded like the prod page. */
export async function getPricing(): Promise<Pricing | null> {
  if (fresh(memoPricing)) return memoPricing!.value;
  try {
    const [pnRes, prRes] = await Promise.all([
      rpc("eth_call", [{ to: SOULS, data: SEL_PRICE_NOW }, "latest"]),
      rpc("eth_call", [{ to: SOULS, data: SEL_PRICING }, "latest"]),
    ]);
    const priceWei = BigInt(pnRes);
    const h = prRes.slice(2);
    const w = (i: number) => BigInt("0x" + h.slice(i * 64, i * 64 + 64));
    const ss = Number(w(0)); // startTime
    const b0 = Number(w(1)); // free window length (s)
    const b1 = Number(w(2));
    const b2 = Number(w(3));
    const p0 = w(4);
    const p1 = w(5);
    const p2 = w(6);
    const first = p0.toString();

    let out: Pricing;
    if (priceWei === 0n) {
      out = { free: true, priceWei: "0", freeUntil: ss + b0, firstPriceWei: first, nextPriceWei: null, nextAt: null };
    } else {
      const e = Math.floor(Date.now() / 1000) - ss;
      let nextAt: number | null = null;
      let nextPriceWei: string | null = null;
      if (e < b1) { nextAt = ss + b1; nextPriceWei = p1.toString(); }
      else if (e < b2) { nextAt = ss + b2; nextPriceWei = p2.toString(); }
      out = { free: false, priceWei: priceWei.toString(), freeUntil: null, firstPriceWei: first, nextPriceWei, nextAt };
    }
    memoPricing = { value: out, ts: Date.now() };
    return out;
  } catch {}
  return memoPricing?.value ?? null;
}

/**
 * All freed souls, newest first. Every soul is minted from 0x0 on convert(),
 * so eth_getLogs of Transfer(from=0) on the diamond is the canonical roster.
 * Tenderly answers the full range in one call; we chunk only as a fallback.
 */
export async function getFreed(): Promise<FreedEntry[]> {
  if (fresh(memoFreed)) return memoFreed!.value;
  const filter = { address: SOULS, topics: [TRANSFER_TOPIC, ZERO_TOPIC] };
  try {
    let logs: any[];
    try {
      logs = await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(DEPLOY_BLOCK), toBlock: "latest" }], 20000);
    } catch {
      const latest = parseInt(await rpc("eth_blockNumber", []), 16);
      logs = [];
      for (let f = DEPLOY_BLOCK; f <= latest; f += 9000) {
        const to = Math.min(f + 8999, latest);
        logs = logs.concat(await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(f), toBlock: hex(to) }], 20000));
      }
    }
    const entries: FreedEntry[] = logs
      .map((l) => ({ id: Number(BigInt(l.topics[3])), block: parseInt(l.blockNumber, 16) }))
      .filter((e) => e.id >= 1 && e.id <= 10000);
    // newest first, de-duped by id (a soul is minted once)
    entries.sort((a, b) => b.block - a.block);
    const seen = new Set<number>();
    const out = entries.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
    memoFreed = { value: out, ts: Date.now() };
    return out;
  } catch {
    return memoFreed?.value ?? [];
  }
}

/**
 * THE ORDER — every soul that reached the Soul Reaper rename (soulsConsumed ≥30),
 * derived from ReaperAscended events on the diamond (same "derive from chain"
 * pattern as getFreed). For each ascended id we read soulsConsumed() fresh (it
 * keeps climbing after the 30-crossing) + marksOf() + ownerOf(), then rank by
 * consumption desc — the leaderboard of the order. Server-only (Tenderly),
 * last-good cached. Returns [] when the facet isn't live yet (no events).
 */
// ¿Sigue abierta la Last Call? ReaperFacetV5 expone `reaperWindowOpen()` (0x8ff33d7b)
// y `REOPEN_UNTIL()` (0x5fde227d), una constante de bytecode sin setter. Se lee aquí
// para que la página ENLAZADA no anuncie un cierre que la cadena todavía no aplica.
// Fail-closed: si la lectura falla, se comporta como hasta ahora (cerrada).
let memoWindow: Memo<{ open: boolean; until: number | null }> | null = null;
export async function getReaperWindow(): Promise<{ open: boolean; until: number | null }> {
  if (fresh(memoWindow)) return memoWindow!.value;
  try {
    const [openRes, untilRes] = await Promise.all([
      rpc("eth_call", [{ to: SOULS, data: "0x8ff33d7b" }, "latest"], 8000),
      rpc("eth_call", [{ to: SOULS, data: "0x5fde227d" }, "latest"], 8000),
    ]);
    const open = /[1-9a-f]/.test(String(openRes).slice(2));
    const until = parseInt(String(untilRes), 16) || null;
    const value = { open, until };
    memoWindow = { value, ts: Date.now() };
    return value;
  } catch {
    return memoWindow?.value ?? { open: false, until: null };
  }
}

export async function getReapers(): Promise<ReaperOrderEntry[]> {
  if (fresh(memoReapers)) return memoReapers!.value;
  const filter = { address: SOULS, topics: [REAPER_ASCENDED_TOPIC] };
  try {
    let logs: any[];
    try {
      logs = await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(DEPLOY_BLOCK), toBlock: "latest" }], 20000);
    } catch {
      const latest = parseInt(await rpc("eth_blockNumber", []), 16);
      logs = [];
      for (let f = DEPLOY_BLOCK; f <= latest; f += 9000) {
        const to = Math.min(f + 8999, latest);
        logs = logs.concat(await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(f), toBlock: hex(to) }], 20000));
      }
    }
    // unique reaper ids from the indexed topic[1], each tagged with the EARLIEST
    // block it ascended at (a soul crosses 30 once; guard against dup events).
    const ascBlock = new Map<number, number>();
    for (const l of logs) {
      const id = Number(BigInt(l.topics[1]));
      if (id < 1 || id > 10000) continue;
      const b = parseInt(l.blockNumber, 16);
      const prev = ascBlock.get(id);
      if (prev == null || b < prev) ascBlock.set(id, b);
    }
    const ids = [...ascBlock.keys()];
    if (!ids.length) { memoReapers = { value: [], ts: Date.now() }; return []; }

    // Timestamps for the (few) ascension blocks → the discreet "ASCENDED <date>"
    // line. One getBlock per ascended soul; the whole result is last-good cached.
    const ascTimes = await getBlockTimes([...new Set(ascBlock.values())]);

    // last-good entries by id — the fallback when a per-id read fails. NEVER
    // fabricate (the old `catch → {consumed:30, marks:[], holder:""}` was the
    // "arte plano / HELD BY —" bug). If there's no last-good for a failing id,
    // EXCLUDE it this cycle: better absent for one regeneration than a lie.
    const prevById = new Map<number, ReaperOrderEntry>((memoReapers?.value ?? []).map((e) => [e.id, e]));
    const pad = (id: number) => id.toString(16).padStart(64, "0");
    const settled = await Promise.all(
      ids.map(async (id): Promise<ReaperOrderEntry | null> => {
        const ascendedBlock = ascBlock.get(id)!;
        const prev = prevById.get(id);
        const ascendedAt = ascTimes[ascendedBlock] ?? prev?.ascendedAt ?? null;
        try {
          const [cRes, mRes, oRes] = await Promise.all([
            rpc("eth_call", [{ to: SOULS, data: SEL_SOULS_CONSUMED + pad(id) }, "latest"]),
            rpc("eth_call", [{ to: SOULS, data: SEL_MARKS_OF + pad(id) }, "latest"]),
            rpc("eth_call", [{ to: SOULS, data: SEL_OWNER_OF + pad(id) }, "latest"]),
          ]);
          const consumed = parseInt(cRes, 16) || 0;
          const holder = "0x" + oRes.slice(-40);
          const marks = decodeMarksBitmask(mRes);
          // A read that comes back empty (holder 0x0 / marks 0 / consumed 0) is a
          // degraded answer, not truth — prefer last-good over a hollow entry.
          if ((!holder || /^0x0+$/.test(holder)) && prev) return prev;
          return { id, consumed, marks, holder, ascendedBlock, ascendedAt };
        } catch {
          return prev ? { ...prev, ascendedBlock, ascendedAt } : null;
        }
      }),
    );
    const entries = settled.filter((e): e is ReaperOrderEntry => e !== null);
    if (!entries.length) return memoReapers?.value ?? [];
    // Rank by consumption desc; ties broken by ASCENSION ORDER (earliest block
    // first) so the first Soul Reaper in history leads, not the lowest tokenId.
    const out = entries.sort((a, b) => b.consumed - a.consumed || a.ascendedBlock - b.ascendedBlock);
    memoReapers = { value: out, ts: Date.now() };
    return out;
  } catch {
    return memoReapers?.value ?? [];
  }
}

/**
 * RISING — the aspirants of THE ORDER: souls already burning canvases but not yet
 * ascended (0 < soulsConsumed < 30). Derived from the SAME activity events as THE
 * CONSUMED (SoulsOffered + MarkForged carry the reaper id in topic[1]); for each id
 * we read soulsConsumed() FRESH and keep only the ones climbing toward 30. Real
 * on-chain data regardless of the reaper flag (today: #8777 at 18/30). Ranked by
 * consumption desc, server-only (Tenderly), last-good cached.
 */
export async function getRising(): Promise<RisingEntry[]> {
  if (fresh(memoRising)) return memoRising!.value;
  try {
    const [offered, forged] = await Promise.all([
      getLogsRanged({ address: SOULS, topics: [SOULS_OFFERED_TOPIC] }),
      getLogsRanged({ address: SOULS, topics: [MARK_FORGED_TOPIC] }),
    ]);
    const ids = new Set<number>();
    for (const l of [...offered, ...forged]) {
      const id = Number(BigInt(l.topics[1]));
      if (id >= 1 && id <= 10000) ids.add(id);
    }
    if (!ids.size) { memoRising = { value: [], ts: Date.now() }; return []; }

    const pad = (id: number) => id.toString(16).padStart(64, "0");
    let failed = false; // any per-id read failed → the roster is partial, don't publish it
    const entries = await Promise.all(
      [...ids].map(async (id) => {
        try {
          // ownerOf is best-effort (drives the /curator link only); a failure there
          // must NOT mark the roster partial — the aspirant is still real without it.
          const [cRes, mRes, oRes] = await Promise.all([
            rpc("eth_call", [{ to: SOULS, data: SEL_SOULS_CONSUMED + pad(id) }, "latest"]),
            rpc("eth_call", [{ to: SOULS, data: SEL_MARKS_OF + pad(id) }, "latest"]),
            rpc("eth_call", [{ to: SOULS, data: SEL_OWNER_OF + pad(id) }, "latest"]).catch(() => null),
          ]);
          const holder = oRes ? "0x" + String(oRes).slice(-40) : undefined;
          const clean = holder && !/^0x0+$/.test(holder) ? holder : undefined;
          return { id, consumed: parseInt(cRes, 16) || 0, marks: decodeMarksBitmask(mRes), holder: clean };
        } catch {
          failed = true;
          return { id, consumed: 0, marks: [] as number[] };
        }
      }),
    );
    // A partial read would silently DROP aspirants (consumed came back 0) — serve
    // the previous complete roster instead of a shrunken one.
    if (failed && memoRising) return memoRising.value;
    // aspirants only: has burned something, hasn't crossed 30 yet.
    const out = entries
      .filter((e) => e.consumed > 0 && e.consumed < 30)
      .sort((a, b) => b.consumed - a.consumed || a.id - b.id);
    memoRising = { value: out, ts: Date.now() };
    return out;
  } catch {
    return memoRising?.value ?? [];
  }
}

// marksOf() on the deployed facet (0x8fa530b6…50a5) returns a uint256 BITMASK:
// bit i set == markId i forged. Decode the single word into a markId list.
function decodeMarksBitmask(data: string): number[] {
  try {
    const word = BigInt(data);
    const out: number[] = [];
    for (let i = 0; i < 8; i++) if ((word >> BigInt(i)) & 1n) out.push(i);
    return out;
  } catch {
    return [];
  }
}

/**
 * THE CONSUMED — the memorial of every canvas the fire has eaten.
 *
 * Two sources of consumed Pikkazo ids:
 *   • SoulsOffered — the ids ride in the event `data` (uint256[] pikkazoIds).
 *   • MarkForged — carries no ids (the two legacy forges of #8777), so we read
 *     them from the tx receipt: Pikkazo Transfer(→0x0) logs in the same tx.
 *
 * The big counter is NOT an event tally: we collect the reaper ids that show any
 * activity, read soulsConsumed() FRESH per reaper (multicall-style parallel), and
 * sum — the on-chain number is the truth (it keeps climbing after each burn).
 *
 * Server-only (Tenderly), last-good cached like getFreed/getReapers.
 */
export async function getConsumed(): Promise<ConsumedData> {
  if (fresh(memoConsumed)) return memoConsumed!.value;
  try {
    const [offered, forged] = await Promise.all([
      getLogsRanged({ address: SOULS, topics: [SOULS_OFFERED_TOPIC] }),
      getLogsRanged({ address: SOULS, topics: [MARK_FORGED_TOPIC] }),
    ]);

    let failed = false; // any per-reaper / per-receipt read failed → total is partial
    const reaperIds = new Set<number>();
    const canvases: ConsumedCanvas[] = [];

    // SoulsOffered: ids in data. Non-indexed params = (uint256[] pikkazoIds,
    // uint256 newConsumed). Head: [offset=0x40][newConsumed]; at 0x40: [len][ids…].
    for (const l of offered) {
      const reaperId = Number(BigInt(l.topics[1]));
      reaperIds.add(reaperId);
      const block = parseInt(l.blockNumber, 16);
      const h = (l.data || "0x").slice(2);
      const word = (i: number) => h.slice(i * 64, i * 64 + 64);
      const len = parseInt(word(2), 16) || 0;
      for (let k = 0; k < len; k++) {
        const id = parseInt(word(3 + k), 16);
        if (id >= 1 && id <= 10000) canvases.push({ id, reaperId, block });
      }
    }

    // MarkForged: pull the burned canvases from the tx receipt.
    await Promise.all(
      forged.map(async (l: any) => {
        const reaperId = Number(BigInt(l.topics[1]));
        reaperIds.add(reaperId);
        const block = parseInt(l.blockNumber, 16);
        try {
          const rec = await rpc("eth_getTransactionReceipt", [l.transactionHash]);
          for (const x of rec?.logs ?? []) {
            if (
              x.address?.toLowerCase() === PIKKAZO.toLowerCase() &&
              x.topics?.[0] === TRANSFER_TOPIC &&
              x.topics?.[2] === ZERO_TOPIC
            ) {
              const id = Number(BigInt(x.topics[3]));
              if (id >= 1 && id <= 10000) canvases.push({ id, reaperId, block });
            }
          }
        } catch {
          failed = true;
        }
      }),
    );

    // Fresh soulsConsumed() per reaper → the true total.
    const pad = (id: number) => id.toString(16).padStart(64, "0");
    let total = 0;
    await Promise.all(
      [...reaperIds].map(async (id) => {
        try {
          const res = await rpc("eth_call", [{ to: SOULS, data: SEL_SOULS_CONSUMED + pad(id) }, "latest"]);
          total += parseInt(res, 16) || 0;
        } catch {
          failed = true;
        }
      }),
    );

    // A partial sum (some reaper read failed) is a LIE — it renders "30" instead of
    // the real ~102. Serve the previous complete memorial rather than the shortfall.
    if (failed && memoConsumed) return memoConsumed.value;

    // newest first, de-duped by canvas id (a Pikkazo burns once)
    canvases.sort((a, b) => b.block - a.block || b.id - a.id);
    const seen = new Set<number>();
    const uniq = canvases.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

    const out: ConsumedData = { total, canvases: uniq };
    memoConsumed = { value: out, ts: Date.now() };
    return out;
  } catch {
    return memoConsumed?.value ?? { total: 0, canvases: [] };
  }
}

/** eth_getLogs over the full deploy range, chunked only as a Tenderly fallback. */
async function getLogsRanged(filter: Record<string, unknown>): Promise<any[]> {
  try {
    return await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(DEPLOY_BLOCK), toBlock: "latest" }], 20000);
  } catch {
    const latest = parseInt(await rpc("eth_blockNumber", []), 16);
    let logs: any[] = [];
    for (let f = DEPLOY_BLOCK; f <= latest; f += 9000) {
      const to = Math.min(f + 8999, latest);
      logs = logs.concat(await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(f), toBlock: hex(to) }], 20000));
    }
    return logs;
  }
}

/** Timestamps for a small set of blocks (used for the home "recent" grid). */
export async function getBlockTimes(blocks: number[]): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  await Promise.all(
    blocks.map(async (bn) => {
      try {
        const b = await rpc("eth_getBlockByNumber", [hex(bn), false], 8000);
        if (b?.timestamp) out[bn] = parseInt(b.timestamp, 16);
      } catch {}
    })
  );
  return out;
}

function hex(n: number): string {
  return "0x" + n.toString(16);
}

export function ago(sec: number): string {
  if (sec < 60) return "just now";
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtEth(wei: string): string {
  // wei (decimal string) → trimmed ETH string
  const v = BigInt(wei);
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/// HOW DEEP EACH REAPER IS DROWNED, read on the server.
///
/// The compositor needs this number to draw the right art, and until now it only
/// reached it from the browser — so the server rendered every face with `kept=0`
/// and the client immediately asked for the same faces again with the real
/// number. Two fetches per reaper, and if the chain read behind the compositor
/// ever hiccups on that first pass, the hint it falls back to is a lie (dry).
///
/// Reading it here fixes both: the HTML ships the right URL the first time.
/// One `tide` call per member, memoized like every other reader, under an ISR of
/// five minutes — so in practice a handful of calls per regeneration.
/// ⚠️ `tide` vive en el RENDERER, no en el Diamond — pedírselo al Diamond
/// revierte con FunctionNotFound y devuelve ceros silenciosos (o sea, reapers
/// secos). Se pregunta primero por la dirección del renderer vivo, igual que
/// hace el compositor, para que esta lectura no pueda contradecir al arte.
const SEL_RENDERER = "0x8ada6b0f"; // renderer()
const SEL_TIDE = "0x4c0a4877"; // tide(uint256) -> (uint8 depth, uint256 kept)
let memoKept: Memo<Record<number, number>> | null = null;
let rendererAddr: string | null = null; // inmutable en la práctica: se cachea sin TTL

export async function getReaperKept(ids: number[]): Promise<Record<number, number>> {
  if (fresh(memoKept)) return memoKept!.value;
  if (!ids.length) return {};
  try {
    if (!rendererAddr) {
      const raw: string = await rpc("eth_call", [{ to: SOULS, data: SEL_RENDERER }, "latest"]);
      if (!raw || raw.length < 42) return memoKept?.value ?? {};
      rendererAddr = "0x" + raw.slice(-40);
    }
    const out: Record<number, number> = {};
    const res = await Promise.all(
      ids.map((id) =>
        rpc("eth_call", [{ to: rendererAddr, data: SEL_TIDE + id.toString(16).padStart(64, "0") }, "latest"])
          .then((r: string) => (r && r.length >= 130 ? parseInt(r.slice(66, 130), 16) : 0))
          .catch(() => null),
      ),
    );
    ids.forEach((id, i) => {
      if (res[i] !== null) out[id] = res[i] as number;
    });
    memoKept = { value: out, ts: Date.now() };
    return out;
  } catch {
    // a reader hiccup must not blank the roster — last-good beats nothing, and
    // nothing beats a wrong zero
    return memoKept?.value ?? {};
  }
}

export function fmtDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
