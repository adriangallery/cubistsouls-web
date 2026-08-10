"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { giveawayEntryMessage } from "@/lib/giveaways-client";
import styles from "./giveaways.module.css";

// The public wall. Each card is one partner draw; entering is a SIGNATURE,
// never a transaction — the same gasless discipline as /raffles, because the
// entry list only has to prove which wallets asked to be on it.

const fmt = (n: number) => n.toLocaleString("en-US");

export type GiveawayCard = {
  id: number;
  title: string;
  project: string;
  prize: string;
  imageUrl: string;
  projectUrl: string;
  winnersCount: number;
  endsAt: number;
  requireSouls: number;
  status: "open" | "drawn" | "cancelled";
  createdAt: number;
  createdBy: string;
  drawnAt: number | null;
  seed: string | null;
  winners: string[];
  entries: number;
};

export function timeLeft(endsAt: number, now: number): string {
  const s = endsAt - now;
  if (s <= 0) return "closed";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

export default function GiveawaysClient() {
  const [list, setList] = useState<GiveawayCard[] | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    fetch("/api/giveaways")
      .then((r) => r.json())
      .then((j: { giveaways: GiveawayCard[] }) => setList(j.giveaways ?? []))
      .catch(() => setList([]));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  const visible = (list ?? []).filter((g) => g.status !== "cancelled");

  return (
    <main className={styles.wrap}>
      <header className={styles.hero}>
        <span className={styles.kicker}>🤝 The museum lends its wall</span>
        <h1 className={styles.title}>GIVEAWAYS</h1>
        <p className={styles.lead}>
          Draws our collab managers run with partner collections — whitelist spots and mints,
          entered with nothing but a signature.
        </p>
      </header>

      {list === null ? (
        <p className={styles.empty}>Opening the room…</p>
      ) : visible.length === 0 ? (
        <p className={styles.empty}>Nothing on this wall right now. The next collab will hang here.</p>
      ) : (
        visible.map((g) => <Card key={g.id} g={g} now={now} />)
      )}

      <p className={styles.foot}>
        Holding a soul? The museum&apos;s own draws live at <a href="/raffles">the raffles</a>.
      </p>
    </main>
  );
}

function Card({ g, now }: { g: GiveawayCard; now: number }) {
  const open = g.status === "open" && now < g.endsAt;
  const ended = g.status === "open" && now >= g.endsAt;

  return (
    <article className={styles.card} id={`ga-${g.id}`}>
      <div className={styles.art}>
        {g.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={g.imageUrl} alt={g.title} loading="lazy" />
        ) : (
          <span className={styles.artEmpty}>no artwork</span>
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.top}>
          <span className={`${styles.stage} ${open ? styles.sOpen : g.status === "drawn" ? styles.sDone : styles.sOff}`}>
            {open ? "Open" : g.status === "drawn" ? "Drawn" : ended ? "Drawing" : "Closed"}
          </span>
          <span className={styles.count}>
            {g.winnersCount} winner{g.winnersCount === 1 ? "" : "s"}
          </span>
          {open ? <span className={styles.closes}>closes in {timeLeft(g.endsAt, now)}</span> : null}
        </div>

        <p className={styles.project}>
          {g.projectUrl ? (
            <a href={g.projectUrl} target="_blank" rel="noopener noreferrer">
              {g.project} ↗
            </a>
          ) : (
            g.project
          )}
        </p>
        <h2 className={styles.cardTitle}>{g.title}</h2>
        {g.prize ? <p className={styles.prize}>{g.prize}</p> : null}

        <dl className={styles.meta}>
          <div>
            <dt>Wallets in</dt>
            <dd>{fmt(g.entries)}</dd>
          </div>
          <div>
            <dt>To enter</dt>
            <dd>{g.requireSouls > 0 ? `hold ${g.requireSouls} soul${g.requireSouls > 1 ? "s" : ""}` : "a signature"}</dd>
          </div>
          <div>
            <dt>Curated by</dt>
            <dd>{g.createdBy}</dd>
          </div>
        </dl>

        {g.status === "drawn" ? (
          <div className={styles.winners}>
            <span className={styles.winnersK}>Won by</span>
            {g.winners.length === 0 ? (
              <p className={styles.prize}>Nobody entered. The wall stays bare.</p>
            ) : (
              g.winners.map((w) => (
                <span key={w} className={styles.winner}>
                  {w.slice(0, 6)}…{w.slice(-4)}
                </span>
              ))
            )}
            {g.seed ? <p className={styles.seed}>seed {g.seed} — the entry list + this seed always re-draws the same names</p> : null}
          </div>
        ) : null}

        {open ? <Enter g={g} /> : null}
        {ended ? <p className={styles.fine}>Entries closed — the draw is in the manager&apos;s hands now.</p> : null}
      </div>
    </article>
  );
}

type RegState = "idle" | "checking" | "out" | "signing" | "saving" | "in";

function Enter({ g }: { g: GiveawayCard }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [mounted, setMounted] = useState(false);
  const [reg, setReg] = useState<RegState>("idle");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!address) {
      setReg("idle");
      return;
    }
    let live = true;
    setReg("checking");
    fetch(`/api/giveaways/${g.id}?address=${address}`)
      .then((r) => r.json())
      .then((j: { entered?: boolean }) => live && setReg(j.entered ? "in" : "out"))
      .catch(() => live && setReg("out"));
    return () => {
      live = false;
    };
  }, [address, g.id]);

  const enter = useCallback(async () => {
    if (!address) return;
    setErr(null);
    try {
      setReg("signing");
      const sig = await signMessageAsync({ message: giveawayEntryMessage(g.id, address) });
      setReg("saving");
      const r = await fetch(`/api/giveaways/${g.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, sig }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "could not save");
      }
      setReg("in");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "something went wrong";
      // a dismissed wallet popup is a decision, not an error
      setErr(/rejected|denied|User rejected/i.test(msg) ? null : msg);
      setReg("out");
    }
  }, [address, g.id, signMessageAsync]);

  if (!mounted) return null;

  if (!isConnected) {
    return (
      <div className={styles.enterRow}>
        <ConnectButton chainStatus="none" showBalance={false} accountStatus="address" />
      </div>
    );
  }

  return (
    <>
      <div className={styles.enterRow}>
        {reg === "in" ? (
          <span className={styles.inChip}>✓ You&apos;re in</span>
        ) : (
          <button
            className={styles.enterBtn}
            onClick={enter}
            disabled={reg === "signing" || reg === "saving" || reg === "checking"}
          >
            {reg === "signing"
              ? "Sign in your wallet…"
              : reg === "saving"
                ? "Entering…"
                : "Enter — free, just a signature"}
          </button>
        )}
      </div>
      {err ? <p className={styles.err}>{err}</p> : null}
      <p className={styles.fine}>Signing costs nothing and sends no transaction — it only proves the wallet is yours.</p>
    </>
  );
}
