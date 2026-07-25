"use client";

import { useEffect, useState } from "react";

// Live rite ledger (DESIGN_SYSTEM §4 "Ticker", dir. B). Client-side is fine here
// (per W1 brief): reads the latest Transfer(from=0) mints on the diamond and
// scrolls them as a marquee. Silent on any failure — falls back to the era line.

const SOULS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406";
const SOULS_DEPLOY = 25518546;
const TRANSFER_TOPIC =
  "0xddf252ad" + "1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = "0x" + "0".repeat(64);
// Client runs in the browser, so the public gateways work here (unlike server).
const RPCS = [
  "https://gateway.tenderly.co/public/mainnet",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
];
const CACHE_KEY = "cs:ticker";

type Entry = { id: number; ts: number };

async function rpc(method: string, params: unknown[]): Promise<any> {
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(9000),
      });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
    } catch {}
  }
  throw new Error("all rpcs failed");
}

function ago(sec: number): string {
  if (sec < 60) return "just now";
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ERA_LINE = "The community is freeing them, one signature at a time";

export default function Ticker({ pricingLine }: { pricingLine?: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = sessionStorage.getItem(CACHE_KEY);
        if (c) {
          const o = JSON.parse(c);
          if (Date.now() - o.t < 60000) { if (!cancelled) setEntries(o.e); return; }
        }
      } catch {}
      try {
        const latest = parseInt(await rpc("eth_blockNumber", []), 16);
        const from = Math.max(SOULS_DEPLOY, latest - 45000); // ~1 week
        const hex = (n: number) => "0x" + n.toString(16);
        const filter = { address: SOULS, topics: [TRANSFER_TOPIC, ZERO_TOPIC] };
        let logs: any[];
        try {
          logs = await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(from), toBlock: "latest" }]);
        } catch {
          logs = [];
          for (let f = from; f <= latest; f += 9000) {
            const to = Math.min(f + 8999, latest);
            logs = logs.concat(await rpc("eth_getLogs", [{ ...filter, fromBlock: hex(f), toBlock: hex(to) }]));
          }
        }
        if (!logs.length) return;
        logs.sort((a, b) => parseInt(b.blockNumber, 16) - parseInt(a.blockNumber, 16));
        const top = logs.slice(0, 20);
        const blocks = Array.from(new Set(top.map((l) => l.blockNumber)));
        const times: Record<string, number> = {};
        await Promise.all(
          blocks.map(async (bn) => {
            try {
              const b = await rpc("eth_getBlockByNumber", [bn, false]);
              if (b?.timestamp) times[bn] = parseInt(b.timestamp, 16);
            } catch {}
          })
        );
        const e: Entry[] = top
          .map((l) => ({ id: Number(BigInt(l.topics[3])), ts: times[l.blockNumber] }))
          .filter((x) => x.ts)
          .sort((a, b) => b.ts - a.ts);
        if (!e.length) return;
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), e })); } catch {}
        if (!cancelled) setEntries(e);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const parts: React.ReactNode[] = [];
  parts.push(<span className="fire" key="era">{pricingLine || ERA_LINE}</span>);
  if (entries && entries.length) {
    const now = Math.floor(Date.now() / 1000);
    const lastHour = entries.filter((e) => now - e.ts <= 3600).length;
    entries.slice(0, 10).forEach((e, i) => {
      parts.push(<span key={`e${i}`}>Soul #{e.id} freed {ago(now - e.ts)}</span>);
      if (i === 0 && lastHour >= 2) parts.push(<span key="lh"><b>{lastHour}</b> freed in the last hour</span>);
    });
  }

  // Duplicate the run so the marquee loops seamlessly (translateX -50%).
  const run = <>{parts}{parts}</>;

  return (
    <div className="ticker" aria-hidden="true">
      <div className="run">{run}</div>
    </div>
  );
}
