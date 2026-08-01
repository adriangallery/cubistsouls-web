"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useHolderData } from "../my-souls/useHolderData";
import { entryMessage, type Raffle } from "@/lib/raffle";
import styles from "./raffles.module.css";

// YOUR ENTRIES — the number a holder actually came here for, plus the gasless way in.
//
// Two things this component refuses to do, both for the same reason (a holder must
// never be told they have entries they do not have):
//
//  · it never invents the count. Every line is the wallet's real chain state run
//    through the occasion's on-chain weights, so the arithmetic here and the
//    arithmetic in RaffleFacet.ticketsFor are the same arithmetic.
//  · it never presents a live number as final. Entries earned by burning keep moving
//    until the window shuts; the holder entry was settled before the announcement.
//    The two are labelled separately and never added into one triumphant total
//    without saying which half can still change.
//
// Entering is a SIGNATURE, not a transaction: free, and it proves the wallet.

const fmt = (n: number) => n.toLocaleString("en-US");

type RegState = "idle" | "checking" | "out" | "signing" | "saving" | "in" | "error";

export default function MyEntries({ raffle, open }: { raffle: Raffle; open: boolean }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const holder = useHolderData(address, mounted && isConnected);
  const [reg, setReg] = useState<RegState>("idle");
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Am I already in? (and how many wallets are, which is the social proof)
  useEffect(() => {
    let live = true;
    setReg(address ? "checking" : "idle");
    const q = new URLSearchParams({ id: String(raffle.id) });
    if (address) q.set("address", address);
    fetch(`/api/raffles/register?${q}`)
      .then((r) => r.json())
      .then((j: { count: number; entered: boolean }) => {
        if (!live) return;
        setCount(j.count ?? 0);
        if (address) setReg(j.entered ? "in" : "out");
      })
      .catch(() => live && address && setReg("out"));
    return () => {
      live = false;
    };
  }, [address, raffle.id]);

  const w = raffle.w;
  const held = holder.data?.owned.length ?? 0;
  const consumed = holder.consumed ?? 0;
  const ascended = useMemo(() => holder.mine.filter((m) => m.isReaper).length, [holder.mine]);

  // Exactly RaffleFacet.ticketsFor, split by whether it can still move.
  const settled = held > 0 ? w.perHolderWallet + held * w.perSoulHeld : 0;
  const earning = consumed * w.perConsumedSoul + ascended * w.perAscendedReaper;
  let total = settled + earning;
  const capped = w.maxPerWallet > 0 && total > w.maxPerWallet;
  if (capped) total = w.maxPerWallet;

  const enter = useCallback(async () => {
    if (!address) return;
    setErr(null);
    try {
      setReg("signing");
      const sig = await signMessageAsync({ message: entryMessage(raffle.id, address) });
      setReg("saving");
      const r = await fetch("/api/raffles/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raffleId: raffle.id, address, sig }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "could not save");
      }
      setReg("in");
      setCount((c) => (c ?? 0) + 1);
    } catch (e) {
      // a rejected wallet popup is not an error worth shouting about
      const msg = e instanceof Error ? e.message : "something went wrong";
      setErr(/rejected|denied|User rejected/i.test(msg) ? null : msg);
      setReg("out");
    }
  }, [address, raffle.id, signMessageAsync]);

  if (!mounted) return null;

  if (!isConnected) {
    return (
      <section className={styles.mine}>
        <span className={styles.rulesK}>Your entries</span>
        <p className={styles.mineLead}>Connect to see how many you hold.</p>
        <ConnectButton chainStatus="none" showBalance={false} accountStatus="address" />
        {count != null ? <p className={styles.mineCount}>{fmt(count)} wallets in so far</p> : null}
      </section>
    );
  }

  if (holder.phase === "loading" || holder.phase === "idle") {
    return (
      <section className={styles.mine}>
        <span className={styles.rulesK}>Your entries</span>
        <p className={styles.mineLead}>Counting your souls…</p>
      </section>
    );
  }

  if (holder.phase === "error") {
    return (
      <section className={styles.mine}>
        <span className={styles.rulesK}>Your entries</span>
        <p className={styles.mineLead}>Couldn&apos;t reach the chain. Try again in a moment.</p>
      </section>
    );
  }

  return (
    <section className={styles.mine}>
      <span className={styles.rulesK}>Your entries</span>

      <div className={styles.entryHero}>
        <span className={styles.entryNum}>{fmt(total)}</span>
        <span className={styles.entryUnit}>{total === 1 ? "entry" : "entries"}</span>
      </div>

      <ul className={styles.breakdown}>
        {settled > 0 ? (
          <li>
            <span className={styles.bLock}>🔒</span>
            <span>
              <b>{fmt(settled)}</b> for holding {fmt(held)} soul{held === 1 ? "" : "s"} — settled
            </span>
          </li>
        ) : null}
        {consumed > 0 ? (
          <li>
            <span className={styles.bFire}>🎟</span>
            <span>
              <b>{fmt(consumed * w.perConsumedSoul)}</b> from {fmt(consumed)} Pikkazo
              {consumed === 1 ? "" : "s"} given to the fire
            </span>
          </li>
        ) : null}
        {ascended > 0 ? (
          <li>
            <span className={styles.bFire}>🜃</span>
            <span>
              <b>{fmt(ascended * w.perAscendedReaper)}</b> for {fmt(ascended)} ascended Soul Reaper
              {ascended === 1 ? "" : "s"}
            </span>
          </li>
        ) : null}
        {capped ? (
          <li>
            <span className={styles.bLock}>▲</span>
            <span>capped at {fmt(w.maxPerWallet)} per wallet</span>
          </li>
        ) : null}
        {total === 0 ? (
          <li>
            <span className={styles.bLock}>—</span>
            <span>No entries yet. Hold a soul, or feed the fire while this is open.</span>
          </li>
        ) : null}
      </ul>

      {open && earning >= 0 ? (
        <p className={styles.mineLead}>
          {consumed > 0 || ascended > 0 ? "Every canvas you burn from here adds another." : "Burn a Pikkazo and this number grows."}{" "}
          <a href="/reapers#rite">Feed the fire →</a>
        </p>
      ) : null}

      <div className={styles.enterRow}>
        {reg === "in" ? (
          <span className={styles.inChip}>✓ You&apos;re in</span>
        ) : (
          <button
            className={styles.enterBtn}
            onClick={enter}
            disabled={reg === "signing" || reg === "saving" || reg === "checking" || total === 0}
          >
            {reg === "signing" ? "Sign in your wallet…" : reg === "saving" ? "Entering…" : "Enter — free, just a signature"}
          </button>
        )}
        {count != null ? <span className={styles.mineCount}>{fmt(count)} wallets in</span> : null}
      </div>
      {err ? <p className={styles.mineErr}>{err}</p> : null}
      <p className={styles.mineFine}>
        Signing costs nothing and sends no transaction — it only proves the wallet is yours.
      </p>
    </section>
  );
}
