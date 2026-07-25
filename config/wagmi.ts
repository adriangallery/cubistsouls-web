import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet } from "wagmi/chains";
import { fallback, http } from "wagmi";

// Cubist Souls lives on Ethereum mainnet ONLY (the diamond + SoulRendererV2 are
// mainnet). No testnet, no L2 — connecting on any other chain prompts a switch.
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

export const config = getDefaultConfig({
  appName: "Cubist Souls",
  projectId: WC_PROJECT_ID,
  chains: [mainnet],
  ssr: true,
  transports: {
    [mainnet.id]: mainnetTransport,
  },
});
