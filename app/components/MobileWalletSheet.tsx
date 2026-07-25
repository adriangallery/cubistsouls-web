"use client";

import { useEffect, useState } from "react";

// Proven mobile fallback (ported from pikkazo-burn/assets/wallet.js). On iOS the
// WalletConnect deep-link handoff Safari → wallet app is fragile: MetaMask opens
// but the connection request never appears. The reliable path is a UNIVERSAL LINK
// that opens THIS page inside the wallet's own dapp browser, where the provider is
// injected and connect is one tap — no QR, no handoff.
//
// Shown only when isMobile && no injected provider. WalletConnect stays available
// as a discreet secondary option (opens the RainbowKit modal).

// iPadOS 13+ reports as desktop "Macintosh"; caught via touchpoints on a Mac UA.
function detectMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPod|Windows Phone|BlackBerry|BB10|Mobi/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

// True when we should prefer our sheet over the RainbowKit modal: a mobile device
// with no injected wallet (i.e. plain Safari, not an in-wallet dapp browser).
export function useIsMobileNoInjected(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    setV(detectMobile() && !(typeof window !== "undefined" && (window as any).ethereum));
  }, []);
  return v;
}

type Link = { id: string; name: string; sub: string; tint: string; url: string };

function dappLinks(): Link[] {
  if (typeof location === "undefined") return [];
  const hostPath = location.host + location.pathname + location.search; // no scheme (MetaMask format)
  const full = location.protocol + "//" + hostPath; // full URL (Coinbase format)
  return [
    {
      id: "metamask",
      name: "MetaMask",
      sub: "Opens this page in MetaMask",
      tint: "#f6851b",
      url: "https://metamask.app.link/dapp/" + hostPath,
    },
    {
      id: "coinbase",
      name: "Coinbase Wallet",
      sub: "Opens this page in Coinbase Wallet",
      tint: "#0052ff",
      url: "https://go.cb-w.com/dapp?cb_url=" + encodeURIComponent(full),
    },
  ];
}

export default function MobileWalletSheet({
  open,
  onClose,
  onWalletConnect,
}: {
  open: boolean;
  onClose: () => void;
  onWalletConnect?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const links = dappLinks();

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wsheet" role="dialog" aria-modal="true">
        <button className="cx-close" aria-label="Close" onClick={onClose}>×</button>
        <div className="cx-eyebrow">Open in your wallet</div>
        <h3 className="wsheet-title">Connect on mobile</h3>
        <p className="wsheet-copy">
          For a reliable connection on your phone, open this page inside your wallet&apos;s browser — one tap, no QR.
        </p>
        {links.map((l) => (
          <a
            key={l.id}
            className="wsheet-btn"
            href={l.url}
            onClick={() => setTimeout(onClose, 400)}
          >
            <span className="wsheet-ic" style={{ background: l.tint }}>{l.name[0]}</span>
            <span className="wsheet-txt">
              <b>{l.name}</b>
              <span>{l.sub}</span>
            </span>
          </a>
        ))}
        {onWalletConnect && (
          <button className="wsheet-wc" onClick={() => { onClose(); onWalletConnect(); }}>
            or use WalletConnect (QR / other wallets)
          </button>
        )}
      </div>
    </div>
  );
}
