"use client";

// THE ROSTRUM — where a reaper opens a proposal, live, no deploy.
//
// Flow: fill the form → validatePropose (the SAME validator the API runs) →
// sign the canonical EIP-191 message (the SAME builder the API recovers with)
// → POST /api/govern/propose → the proposal is on the wall; the page refetches
// the merged feed via onCreated.
//
// Gate mirrors the server: the form only unlocks for a wallet whose power
// breakdown shows a crowned soul (isReaper). The server re-checks on-chain, so
// this is UX, not security. The voting window is a CLOSED selector
// (PROPOSAL_WINDOWS) — a reaper picks between windows, never writes one.

import { useMemo, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import {
  buildProposeMessage,
  validatePropose,
  DEFAULT_WINDOW,
  PROPOSAL_WINDOWS,
  PROPOSE_LIMITS,
} from "@/lib/govern-propose";
import type { WalletPower } from "@/lib/govern";
import styles from "./govern.module.css";

type Opt = { label: string; sub: string };
const emptyOpt = (): Opt => ({ label: "", sub: "" });

export default function ProposeDesk({
  power,
  onCreated,
}: {
  power: WalletPower | null;
  onCreated: () => void;
}) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  // Only reapers held DIRECTLY can author: the server checks ownerOf(reaperId)
  // against the signer, and a reaper sitting inside a vault is owned by the
  // vault contract. Its power still counts — it just doesn't hold the pen.
  const reapers = useMemo(
    () => (power?.souls ?? []).filter((s) => s.isReaper && s.viaVault === undefined),
    [power],
  );

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [opts, setOpts] = useState<Opt[]>([emptyOpt(), emptyOpt()]);
  const [windowDays, setWindowDays] = useState<number>(DEFAULT_WINDOW);
  const [reaperId, setReaperId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [liveId, setLiveId] = useState<string | null>(null);

  const chosenReaper = reaperId ?? reapers[0]?.id ?? null;

  const setOpt = (i: number, patch: Partial<Opt>) =>
    setOpts((prev) => prev.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const submit = async () => {
    if (!address || chosenReaper === null || busy) return;
    setErr(null);
    const v = validatePropose({
      title,
      body,
      options: opts.map((o) => ({ label: o.label, sub: o.sub || undefined })),
      windowDays,
      reaperId: chosenReaper,
      address,
    });
    if (!v.ok) {
      setErr(v.error);
      return;
    }
    setBusy(true);
    try {
      const sig = await signMessageAsync({ message: buildProposeMessage(v.fields) });
      const r = await fetch("/api/govern/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...v.fields, sig }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `propose failed (${r.status})`);
      setLiveId(j.id);
      setTitle("");
      setBody("");
      setOpts([emptyOpt(), emptyOpt()]);
      setWindowDays(DEFAULT_WINDOW);
      onCreated();
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      if (!/rejected|denied/i.test(m)) setErr(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section}>
      <details className={styles.fine}>
        <summary className={styles.fineSummary}>🜃 Open a proposal</summary>
        <div className={styles.foldBody}>
          {!isConnected ? (
            <p className={styles.note}>Connect above — the crown speaks first.</p>
          ) : !power ? (
            <p className={styles.note}>Weighing your souls…</p>
          ) : reapers.length === 0 ? (
            <p className={styles.note}>
              Only reapers open a proposal. The crown is earned in the rite —{" "}
              <a className={styles.deskLink} href="/reapers">
                the fire is this way →
              </a>
            </p>
          ) : (
            <div className={styles.deskForm}>
              {liveId && (
                <p className={styles.deskLive}>
                  Your proposal is <b>LIVE</b> — it&apos;s on the wall above, and the pyramid can
                  vote now.
                </p>
              )}

              {reapers.length > 1 && (
                <label className={styles.deskField}>
                  <span className={styles.deskLabel}>Speaking as</span>
                  <select
                    className={styles.deskSelect}
                    value={chosenReaper ?? undefined}
                    onChange={(e) => setReaperId(Number(e.target.value))}
                  >
                    {reapers.map((s) => (
                      <option key={s.id} value={s.id}>
                        Soul Reaper #{s.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {reapers.length === 1 && (
                <p className={styles.deskAs}>
                  Speaking as <b>Soul Reaper #{reapers[0].id}</b> 🜃
                </p>
              )}

              <label className={styles.deskField}>
                <span className={styles.deskLabel}>Title</span>
                <input
                  className={styles.deskInput}
                  value={title}
                  maxLength={PROPOSE_LIMITS.title}
                  placeholder="One line the pyramid votes on"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>

              <label className={styles.deskField}>
                <span className={styles.deskLabel}>Description</span>
                <textarea
                  className={styles.deskArea}
                  value={body}
                  maxLength={PROPOSE_LIMITS.body}
                  rows={4}
                  placeholder="Why this, why now. The pyramid reads before it votes."
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>

              <div className={styles.deskField}>
                <span className={styles.deskLabel}>
                  Options <em className={styles.deskHint}>2–{PROPOSE_LIMITS.maxOptions}</em>
                </span>
                {opts.map((o, i) => (
                  <div className={styles.deskOptRow} key={i}>
                    <input
                      className={styles.deskInput}
                      value={o.label}
                      maxLength={PROPOSE_LIMITS.label}
                      placeholder={`Option ${i + 1}`}
                      onChange={(e) => setOpt(i, { label: e.target.value })}
                    />
                    <input
                      className={`${styles.deskInput} ${styles.deskSub}`}
                      value={o.sub}
                      maxLength={PROPOSE_LIMITS.sub}
                      placeholder="subtitle (optional)"
                      onChange={(e) => setOpt(i, { sub: e.target.value })}
                    />
                    {opts.length > PROPOSE_LIMITS.minOptions && (
                      <button
                        type="button"
                        className={styles.deskDrop}
                        aria-label={`Remove option ${i + 1}`}
                        onClick={() => setOpts((prev) => prev.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {opts.length < PROPOSE_LIMITS.maxOptions && (
                  <button
                    type="button"
                    className={styles.deskAdd}
                    onClick={() => setOpts((prev) => [...prev, emptyOpt()])}
                  >
                    + add option
                  </button>
                )}
              </div>

              <div className={styles.deskField}>
                <span className={styles.deskLabel}>Voting window</span>
                <div className={styles.deskWindows} role="radiogroup" aria-label="Voting window">
                  {PROPOSAL_WINDOWS.map((d) => (
                    <button
                      type="button"
                      key={d}
                      className={`${styles.deskWin} ${windowDays === d ? styles.deskWinOn : ""}`}
                      aria-pressed={windowDays === d}
                      onClick={() => setWindowDays(d)}
                    >
                      {d} days
                    </button>
                  ))}
                </div>
              </div>

              {err && <p className={styles.errNote}>{err}</p>}

              <button className={styles.deskSubmit} onClick={submit} disabled={busy}>
                {busy ? "sign in your wallet…" : "Sign & open the vote"}
              </button>
              <p className={styles.deskFine}>
                Free — one signature, no gas. It goes live immediately, closes on its own, and one
                proposal per reaper may stand at a time.
              </p>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
