"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { timeLeft } from "../GiveawaysClient";
import styles from "../giveaways.module.css";

// The reader's shelf: every giveaway this wallet asked to be in, split into
// what's still running, what it won, and what passed it by.

type MineRow = {
  id: number;
  title: string;
  project: string;
  prize: string;
  status: "open" | "drawn" | "cancelled";
  endsAt: number;
  drawnAt: number | null;
  won: boolean;
};

export default function MineClient() {
  const { address, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [rows, setRows] = useState<MineRow[] | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!address) {
      setRows(null);
      return;
    }
    let live = true;
    fetch(`/api/giveaways/mine?address=${address}`)
      .then((r) => r.json())
      .then((j: { mine: MineRow[] }) => live && setRows(j.mine ?? []))
      .catch(() => live && setRows([]));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [address]);

  const open = (rows ?? []).filter((r) => r.status === "open");
  const won = (rows ?? []).filter((r) => r.won);
  const past = (rows ?? []).filter((r) => r.status !== "open" && !r.won);

  return (
    <main className={styles.wrap}>
      <header className={styles.hero}>
        <span className={styles.kicker}>🎟 Your trail on the wall</span>
        <h1 className={styles.title}>YOUR ENTRIES</h1>
        <p className={styles.lead}>What this wallet is in, what it won, and what passed it by.</p>
      </header>

      {!mounted ? null : !isConnected ? (
        <div className={styles.desk} style={{ textAlign: "center" }}>
          <p className={styles.prize} style={{ margin: "0 auto 1rem" }}>
            Connect to see your entries. Reading costs nothing — not even a signature.
          </p>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <ConnectButton chainStatus="none" showBalance={false} accountStatus="address" />
          </div>
        </div>
      ) : rows === null ? (
        <p className={styles.empty}>Reading the ledgers…</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>
          This wallet hasn&apos;t entered anything yet. <a href="/giveaways">The wall is that way →</a>
        </p>
      ) : (
        <>
          {won.length > 0 ? <Section k="🏆 Won" rows={won} now={now} /> : null}
          {open.length > 0 ? <Section k="Open — fingers crossed" rows={open} now={now} /> : null}
          {past.length > 0 ? <Section k="Past" rows={past} now={now} /> : null}
        </>
      )}

      <p className={styles.foot}>
        <a href="/giveaways">← Back to the wall</a>
      </p>
    </main>
  );
}

function Section({ k, rows, now }: { k: string; rows: MineRow[]; now: number }) {
  return (
    <div className={styles.desk}>
      <span className={styles.label}>{k}</span>
      <div className={styles.rows}>
        {rows.map((r) => (
          <div key={r.id} className={styles.row}>
            <span className={styles.rowTitle}>
              #{r.id} · {r.title}
            </span>
            <span className={styles.rowMeta}>
              {r.project}
              {r.status === "open"
                ? ` · closes in ${timeLeft(r.endsAt, now)}`
                : r.won
                  ? " · you won — the manager has your address"
                  : r.status === "drawn"
                    ? " · drawn, not this time"
                    : " · cancelled"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
