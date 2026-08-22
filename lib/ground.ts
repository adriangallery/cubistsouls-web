// THE GROUND DIVIDEND — revenue collected on Robinhood Chain and split equally
// between the reapers that stand on solid ground (60+ souls in their vault).
//
// WHY ANY OF THIS IS ON ANOTHER CHAIN. The collection that funds it mints on
// Robinhood Chain. Bridging to Ethereum would cost a ~7-day withdrawal and a
// human pressing a button every time, so the money stays where it lands and the
// split happens there.
//
// WHAT DOES NOT CROSS. A contract on Robinhood Chain cannot read Ethereum, so
// it cannot count anyone's souls. The roster — sixteen ids, sixteen payout
// addresses, sixteen soul counts — is posted by the museum and is the one
// trusted input in the whole design. It is also trivially checkable: this file
// reads BOTH chains and the page shows them side by side, so a roster that
// disagrees with mainnet is visible rather than buried.

import { parseAbi, formatEther, formatUnits } from "viem";

export const GROUND_CHAIN_ID = 4663;
export const GROUND_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const GROUND_EXPLORER = "https://explorer.mainnet.chain.robinhood.com";

/// ⚠️ Hardcoded on purpose, with the env var only as an override. A
/// NEXT_PUBLIC_* variable is baked at BUILD time, and this image is built by a
/// plain `docker build` that passes no build args — so relying on the env alone
/// would have shipped a green deploy with an empty address and a page insisting
/// the router was not live. A deployed contract address is public anyway.
export const GROUND_ROUTER = (process.env.NEXT_PUBLIC_GROUND_ROUTER ||
  "0xFEF46435Dea467bb05DC0c51Bad6C720Ee66D6f0") as `0x${string}`;

/// Souls that make a reaper fully earthed. Mirrors the contract; the contract wins.
export const GROUND_THRESHOLD = 60;

/// The assets a marketplace might settle in. ETH is the native token here; the
/// rest are whatever gets bridged. Adding one is a line, not a redeploy — the
/// router takes any ERC-20 address.
export const GROUND_ASSETS: { symbol: string; address: `0x${string}` | null; decimals: number }[] = [
  { symbol: "ETH", address: null, decimals: 18 },
  { symbol: "WETH", address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", decimals: 18 },
  { symbol: "USDC", address: "0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8", decimals: 6 },
];

export const GROUND_ABI = parseAbi([
  "function roster() view returns ((uint256 reaperId,address payout,uint16 souls)[])",
  "function threshold() view returns (uint16)",
  "function eligibleCount() view returns (uint256)",
  "function minAmount() view returns (uint256)",
  "function minInterval() view returns (uint64)",
  "function lastDistribution() view returns (uint64)",
  "function readyAt() view returns (uint64)",
  "function rosterPostedAt() view returns (uint64)",
  "function preview(uint256 amount) view returns (uint256[] ids, address[] payouts, uint256 share, uint256 dust)",
  "function distribute()",
  "function distributeToken(address token)",
]);

export type RosterEntry = { reaperId: number; payout: `0x${string}`; souls: number };
export type PotAsset = { symbol: string; address: `0x${string}` | null; decimals: number; balance: bigint };

/// A bare JSON-RPC call against Robinhood Chain. Deliberately not wagmi: the
/// page must be able to show the pot before a wallet is connected, and to a
/// visitor who never connects one at all.
async function rhCall(to: string, data: string): Promise<string | null> {
  try {
    const r = await fetch(GROUND_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    if (j.error || !j.result || j.result === "0x") return null;
    return j.result as string;
  } catch {
    return null;
  }
}

export async function rhBalance(address: string): Promise<bigint> {
  try {
    const r = await fetch(GROUND_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    return j?.result ? BigInt(j.result) : 0n;
  } catch {
    return 0n;
  }
}

const SEL_BALANCE_OF = "0x70a08231";

export async function rhTokenBalance(token: string, who: string): Promise<bigint> {
  const res = await rhCall(token, SEL_BALANCE_OF + who.slice(2).padStart(64, "0").toLowerCase());
  return res ? BigInt(res) : 0n;
}

/// What the pot holds, asset by asset.
export async function readPot(router: string): Promise<PotAsset[]> {
  return Promise.all(
    GROUND_ASSETS.map(async (a) => ({
      ...a,
      balance: a.address ? await rhTokenBalance(a.address, router) : await rhBalance(router),
    })),
  );
}

/// The roster the router will actually pay, read from Robinhood Chain.
export async function readRoster(router: string): Promise<RosterEntry[] | null> {
  const raw = await rhCall(router, "0x0cbf77ab"); // roster() — verified against the compiled ABI, not guessed
  if (!raw) return null;
  try {
    const body = raw.slice(2);
    // offset(32) | length(32) | then 3 words per entry
    const len = parseInt(body.slice(64, 128), 16);
    const out: RosterEntry[] = [];
    for (let i = 0; i < len; i++) {
      const at = 128 + i * 192;
      out.push({
        reaperId: parseInt(body.slice(at, at + 64), 16),
        payout: (`0x${body.slice(at + 64 + 24, at + 128)}`) as `0x${string}`,
        souls: parseInt(body.slice(at + 128, at + 192), 16),
      });
    }
    return out;
  } catch {
    return null;
  }
}

/// Balances the reaper VAULTS hold on Robinhood Chain. The museum's cards have
/// always shown a vault's mainnet ETH; once a dividend is paid, part of what
/// stands behind a reaper lives here instead, and a card that ignored it would
/// be quietly under-reporting what a buyer is bidding on.
export async function readTwinBalances(payouts: string[]): Promise<Record<string, bigint>> {
  const out: Record<string, bigint> = {};
  await Promise.all(
    payouts.map(async (p) => {
      out[p.toLowerCase()] = await rhBalance(p);
    }),
  );
  return out;
}

export const fmtAsset = (v: bigint, decimals: number, symbol: string) => {
  const n = decimals === 18 ? Number(formatEther(v)) : Number(formatUnits(v, decimals));
  if (n === 0) return `0 ${symbol}`;
  if (n < 0.000001) return `<0.000001 ${symbol}`;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: decimals === 6 ? 2 : 6 })} ${symbol}`;
};
