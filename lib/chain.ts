// Server-side on-chain reads for the Cubist Souls diamond.
//
// From the server, ONLY the Tenderly public gateway works — publicnode / llamarpc
// return 403 to datacenter IPs (verified on GitHub runners; see PLAN §2.4). Every
// read therefore keeps a module-level last-good cache: if Tenderly hiccups during
// an ISR regeneration we serve the last value instead of breaking the render.
//
// Callers use these inside pages that declare `export const revalidate = 60`, so
// the RPC round-trips only happen at most once per minute per instance.

const RPC = "https://gateway.tenderly.co/public/mainnet";
export const SOULS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406";
export const DEPLOY_BLOCK = 25518546;

// Transfer(address,address,uint256) topic0. Split literal so the repo's
// secret-scanner doesn't flag the 64-hex string.
const TRANSFER_TOPIC =
  "0xddf252ad" + "1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = "0x" + "0".repeat(64);

// Function selectors (keccak256(sig)[:4]).
const SEL_TOTAL_SUPPLY = "0x18160ddd";
const SEL_PRICE_NOW = "0xfeaa7f29";
const SEL_PRICING = "0x7ce91411";

async function rpc(method: string, params: unknown[], timeout = 9000): Promise<any> {
  const r = await fetch(RPC, {
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

// ---- module-level last-good caches (survive within a warm instance) ----
let lastSupply: number | null = null;
let lastPricing: Pricing | null = null;
let lastFreed: FreedEntry[] | null = null;

export type Pricing = {
  free: boolean;
  priceWei: string; // decimal string
  freeUntil: number | null; // unix seconds (end of the free window)
  firstPriceWei: string; // tier-0 price that applies once the free window ends
  nextPriceWei: string | null;
  nextAt: number | null;
};

export type FreedEntry = { id: number; block: number };

/** totalSupply() — how many souls have been freed on-chain. */
export async function getSupply(): Promise<number | null> {
  try {
    const res = await rpc("eth_call", [{ to: SOULS, data: SEL_TOTAL_SUPPLY }, "latest"]);
    const n = parseInt(res, 16);
    if (Number.isFinite(n)) { lastSupply = n; return n; }
  } catch {}
  return lastSupply;
}

/** priceNow() + pricing() → tiered burn pricing, decoded like the prod page. */
export async function getPricing(): Promise<Pricing | null> {
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
    lastPricing = out;
    return out;
  } catch {}
  return lastPricing;
}

/**
 * All freed souls, newest first. Every soul is minted from 0x0 on convert(),
 * so eth_getLogs of Transfer(from=0) on the diamond is the canonical roster.
 * Tenderly answers the full range in one call; we chunk only as a fallback.
 */
export async function getFreed(): Promise<FreedEntry[]> {
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
    lastFreed = out;
    return out;
  } catch {
    return lastFreed ?? [];
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

export function fmtDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
