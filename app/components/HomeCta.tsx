"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Home CTA. Before a wallet is connected it opens the RainbowKit connect modal
// (this is what W1's disabled "Light the fire" button becomes). Once connected,
// it points at /my-souls — the real per-token burn selection lands in W3, so we
// don't fake a burn flow here.
export default function HomeCta() {
  const { openConnectModal } = useConnectModal();
  const { isConnected } = useAccount();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const connected = mounted && isConnected;

  return (
    <>
      <button
        className="btn btn-primary"
        onClick={() => (connected ? router.push("/my-souls") : openConnectModal?.())}
      >
        🔥 {connected ? "Choose your Pikkazos" : "Light the fire — free your Pikkazo"}
      </button>
      <a
        className="btn btn-secondary"
        href="https://opensea.io/collection/cubist-souls"
        target="_blank"
        rel="noopener noreferrer"
      >
        View on OpenSea
      </a>
    </>
  );
}
