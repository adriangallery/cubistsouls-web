"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import styles from "./lastcall.module.css";

// THE COUNTDOWN — the last-call window, read FROM THE CONTRACT.
//
// ReaperFacetV5 exposes `REOPEN_UNTIL()` (a bytecode constant, no setter anywhere)
// and `reaperWindowOpen()`. The deadline shown here is fetched from the diamond, so
// the site can never disagree with the chain — and if the read fails we fall back to
// the same constant compiled into the facet rather than showing nothing.
//
// The clock is the honest kind: it ticks against the visitor's own machine, but the
// door itself is `block.timestamp` on chain. Once it hits zero the panel below stops
// accepting anything by itself — no deploy, no flag, no one awake.

const SOULS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406" as const;
// 2026-08-05 19:00:00 UTC — mirror of ReaperFacetV5.REOPEN_UNTIL, fallback only.
const FALLBACK_DEADLINE = 1785956400;

const ABI = [
  { type: "function", name: "REOPEN_UNTIL", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const two = (n: number) => String(n).padStart(2, "0");

export default function Countdown() {
  const client = usePublicClient({ chainId: 1 });
  const [deadline, setDeadline] = useState<number>(FALLBACK_DEADLINE);
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));

  // read the real deadline off the diamond (never trust the copy above)
  useEffect(() => {
    if (!client) return;
    let alive = true;
    client
      .readContract({ address: SOULS, abi: ABI, functionName: "REOPEN_UNTIL" })
      .then((v) => {
        if (alive && typeof v === "bigint" && v > 0n) setDeadline(Number(v));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const left = Math.max(0, deadline - now);
  const over = left === 0;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;

  const closesAt = new Date(deadline * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });

  return (
    <div className={styles.lcClock}>
      <span className={styles.lcClockLab}>{over ? "The window is closed" : "The window closes in"}</span>
      {!over && (
        <div className={styles.lcDigits}>
          <span>{two(h)}<i>h</i></span>
          <span>{two(m)}<i>m</i></span>
          <span>{two(s)}<i>s</i></span>
        </div>
      )}
      <span className={styles.lcClockSub}>
        {closesAt} UTC · the deadline lives in the contract, not on this page
      </span>
    </div>
  );
}
