import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet } from "wagmi/chains";
import { fallback, http } from "wagmi";
import { defineChain } from "viem";

/// ROBINHOOD CHAIN (4663) — where the ground dividend is collected and paid.
///
/// An Arbitrum Orbit L2 that settles DIRECTLY to Ethereum, not an L3 on top of
/// Arbitrum One. That distinction is the reason a reaper's 6551 vault has the
/// same address on both chains and can be driven from mainnet: an L1 sender is
/// aliased once, not twice.
///
/// Cubist Souls itself stays mainnet-only. This chain is here for one page.
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.mainnet.chain.robinhood.com" } },
  contracts: { multicall3: { address: "0x2cAC2D899eCC914d704FeaAE33ac1bF36277DaD1" } },
});

// Cubist Souls lives on Ethereum mainnet — the diamond, the reapers and their
// vaults are all mainnet, and every page but one only ever talks to it.
// Robinhood Chain is the exception: the ground dividend is collected and paid
// there, so /ground asks a wallet to switch and nothing else does.
//
// Transports (client-side): the Tenderly public gateway first (the one read that
// also works server-side), then publicnode + llamarpc as fallbacks. Unlike the
// server, these public RPCs answer datacenter-free browser IPs fine, so the
// fallbacks are real here. batch folds the my-souls ownerOf/cohortOf reads into
// few JSON-RPC POSTs; retryCount 0 so a hiccup falls straight through.
const rpcUrls = [
  "https://gateway.tenderly.co/public/mainnet",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
];

const mainnetTransport = fallback(
  rpcUrls.map((url) => http(url, { retryCount: 0, batch: { wait: 16, batchSize: 100 } })),
  { rank: false },
);

// Public WalletConnect projectId, reused from zerothetoken (not a secret — it is
// shipped in the client bundle by design, same as zerothetoken). Add this deploy's
// domain to the WalletConnect Cloud allowlist if the modal ever complains.
const WC_PROJECT_ID = "21fef48091f12692cad574a6f7753643";

// The WalletConnect dapp metadata.url MUST match the real origin the page is
// served from, or some mobile wallets silently DISCARD the session proposal
// (the reported iOS "MetaMask opens but nothing happens" glitch). On the client
// use the live origin; on the server (ssr) RainbowKit swaps in a mock connector
// anyway, so the fallback string is never actually used to pair.
const APP_URL =
  typeof window !== "undefined" ? window.location.origin : "https://cubistsouls-web.vercel.app";

export const config = getDefaultConfig({
  appName: "Cubist Souls",
  appDescription: "Burn a Pikkazo, free its Cubist Soul.",
  appUrl: APP_URL,
  appIcon: `${APP_URL}/assets/logo.svg`,
  projectId: WC_PROJECT_ID,
  chains: [mainnet, robinhood],
  ssr: true,
  transports: {
    [mainnet.id]: mainnetTransport,
    [robinhood.id]: http("https://rpc.mainnet.chain.robinhood.com", { retryCount: 1 }),
  },
  // wagmi v2's walletConnect connector already requests mainnet as an OPTIONAL
  // namespace (not required) — the historical "chains:[1] required → wallet
  // rejects" bug does not recur here. We only pin the metadata so the proposal
  // carries the correct origin.
  walletConnectParameters: {
    metadata: {
      name: "Cubist Souls",
      description: "Burn a Pikkazo, free its Cubist Soul.",
      url: APP_URL,
      icons: [`${APP_URL}/assets/logo.svg`],
    },
  },
});
