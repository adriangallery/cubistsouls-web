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
///
/// V2 (23-ago): the two-phase system. No stored roster and no owner posting one —
/// GroundRelay on Ethereum reads the vaults itself and sends them across, and
/// the router refuses to split on a reading older than 30 minutes. Both phases
/// are paid by whoever wants the split. V1 (0xFEF46435…) stays deployed as the
/// record of the first test; nothing points at it any more.
/// V3 (23-ago noche): ONE BUTTON. V2 was correct and unusable — read, wait for
/// the bridge, come back inside a thirty-minute window. Adrian paid for three
/// readings and the window expired every time before he could press the second
/// button. In V3 the split happens ON LANDING, in the same transaction the
/// roster arrives in: press "Read & split" on Ethereum, done. distribute()
/// remains for money that arrives after a landing.
export const GROUND_ROUTER = (process.env.NEXT_PUBLIC_GROUND_ROUTER ||
  "0x24100b298aC885CB09C49A7c88785E594a2709CF") as `0x${string}`;

/// Phase one lives on Ethereum: it reads the diamond and buys the bridge ticket.
export const GROUND_RELAY = "0x64Bc3945341D91B78258Ed6806439d3860c0892e" as const;

/// Gas for receiveRoster on the far side. ⚠️ 300k was the first, failed guess —
/// sixteen roster entries are cold storage writes and need ~1M; the ticket
/// auto-redeem ran out of gas and the roster never applied. 1.5M is measured
/// headroom, and unspent gas is refunded to the caller.
/// receiveRoster (16 cold slots ≈ 1M) PLUS the auto-split it now performs.
export const RELAY_GAS_LIMIT = 2_000_000n;
export const RELAY_MAX_FEE_PER_GAS = 50_000_000n; // 0.05 gwei

export const RELAY_ABI = parseAbi([
  "function quote(uint256 gasLimit, uint256 maxFeePerGas) view returns (uint256 total, uint256 maxSubmissionCost)",
  "function relay(uint256 gasLimit, uint256 maxFeePerGas) payable returns (uint256)",
  "function read() view returns (uint256[] ids, address[] payouts, uint16[] souls)",
]);

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
  "function state() view returns (bool isFresh, uint64 age, uint256 eligible, uint256 ethBalance, uint64 expiresAt)",
  "function eligibleCount() view returns (uint256)",
  "function rosterAge() view returns (uint64)",
  "function fresh() view returns (bool)",
  "function readAt() view returns (uint64)",
  "function distribute()",
  "function distributeToken(address token)",
]);

/// The V2 selectors, for the no-wallet reads. Verified against the compiled ABI.
export const SEL_STATE = "0xc19d93fb";
export const SEL_ROSTER = "0x0cbf77ab";

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

/// A reading that has left Ethereum but not yet landed here. The page needs
/// this because the bridge takes minutes and a holder who just paid for a
/// reading was left staring at "stale" with no sign anything was coming —
/// which reads as a broken button, not a crossing ticket.
///
/// Detected from the relay's own RosterRelayed events on mainnet: one newer
/// than the router's current readAt means a ticket is in flight (or, after
/// ~20 minutes, that its redeem needs help).
export async function readingInFlight(currentReadAt: number): Promise<{ sentAt: number } | null> {
  try {
    const topic = "0x" + "1c0801223e4f0e835e46dbce9c9c89a8106413ee882fdebad86d4a372fbc17ef";
    for (const rpc of [
      "https://gateway.tenderly.co/public/mainnet",
      "https://ethereum-rpc.publicnode.com",
    ]) {
      try {
        const r = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getLogs",
            params: [{ address: GROUND_RELAY, topics: [topic], fromBlock: "0x" + (25819300).toString(16) }],
          }),
          signal: AbortSignal.timeout(8000),
        });
        const j = await r.json();
        if (!Array.isArray(j?.result)) continue;
        let newest = 0;
        for (const log of j.result) {
          // RosterRelayed(ticketId, members, eligible, readAt) — all unindexed
          const readAt = parseInt(log.data.slice(2 + 64 * 3, 2 + 64 * 4), 16);
          if (readAt > newest) newest = readAt;
        }
        // Older than ~20 minutes and still not landed = the ticket's redeem
        // failed (it happened: a 300k-gas ticket died silently). Stop saying
        // "crossing" and give the button back, or a dead ticket wedges the page.
        const recent = newest > Date.now() / 1000 - 20 * 60;
        return newest > currentReadAt && recent ? { sentAt: newest } : null;
      } catch {
        continue;
      }
    }
  } catch {}
  return null;
}

/// The router's state, readable without a wallet.
export type GroundState = {
  fresh: boolean;
  age: number;
  eligible: number;
  ethBalance: bigint;
  expiresAt: number;
};

export async function readState(router: string): Promise<GroundState | null> {
  const raw = await rhCall(router, SEL_STATE);
  if (!raw || raw.length < 2 + 64 * 5) return null;
  const w = (i: number) => raw.slice(2 + i * 64, 2 + (i + 1) * 64);
  return {
    fresh: parseInt(w(0), 16) === 1,
    age: parseInt(w(1), 16),
    eligible: parseInt(w(2), 16),
    ethBalance: BigInt("0x" + w(3)),
    expiresAt: parseInt(w(4), 16),
  };
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

// ---------------------------------------------------------------------------
// BRINGING A DIVIDEND HOME
//
// A reaper's vault has the same address on both chains, but AccountV3 returns
// the ZERO address for owner() anywhere except its token's chain — it refuses to
// guess an owner it cannot read. So nobody can drive the Robinhood Chain twin
// directly. There is exactly one door: AccountV3 also accepts a caller whose
// address, un-aliased, is the account itself. That is the MAINNET twin sending
// an L1→L2 message, which Arbitrum delivers with the sender aliased by
// +0x1111…1111 — and Robinhood Chain settles straight to Ethereum, so it is one
// hop and the alias survives intact.
//
// Both halves are verified against the live chains, not assumed: the L1 call
// simulates to a ticket id, the twin accepts `execute` from the aliased address,
// and refuses the identical call from anyone else with NotAuthorized().
//
// The holder pays the ticket from their own wallet (execute is payable), so a
// vault holding no mainnet ether can still send its dividend home.

export const L1_INBOX = "0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D" as const;

export const INBOX_ABI = parseAbi([
  "function calculateRetryableSubmissionFee(uint256 dataLength, uint256 baseFee) view returns (uint256)",
  "function createRetryableTicket(address to, uint256 l2CallValue, uint256 maxSubmissionCost, address excessFeeRefundAddress, address callValueRefundAddress, uint256 gasLimit, uint256 maxFeePerGas, bytes data) payable returns (uint256)",
]);

export const ACCOUNT_ABI = parseAbi([
  "function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)",
]);

/// Generous on purpose. Robinhood Chain sits around 0.02 gwei, so 0.05 buys a
/// wide margin for a few thousandths of a cent, and unspent gas is refunded to
/// the address named below anyway. Under-paying is the expensive mistake: the
/// ticket lands unredeemed and someone has to go and redeem it by hand.
export const RH_GAS_LIMIT = 300_000n;
export const RH_MAX_FEE_PER_GAS = 50_000_000n; // 0.05 gwei

export const NOT_AUTHORIZED_SELECTOR = "0xea8e4eb5";
