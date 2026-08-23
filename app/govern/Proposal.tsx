"use client";

// THE LIVE PROPOSAL — the first REAL vote on /govern.
//
// Reads /govern/proposals.json (same file the vote API validates against — one
// source of truth) and the ballot box at /api/govern/votes?id=. Votes are EIP-191
// personal_sign over the CANONICAL message (format is frozen — the API comment and
// the old govern preview both document it):
//
//   Cubist Souls Govern
//   Proposal: <id>
//   Choice: <optionIndex>
//   Snapshot: <snapshotBlock>
//   Voter: <address lowercase>
//
// The server is a dumb mailbox. The TALLY happens here, client-side and
// reproducible by anyone: recover each signature locally, drop the invalid ones,
// then weigh each voter with the same soul-bound power calculator the page uses
// for "your power" (loadWalletPower). Weighing reads the chain per wallet, so it
// fills in progressively — raw ballot counts show immediately, power percentages
// settle as wallets are weighed. Quorum is counted in souls, per the plan.
//
// Honest limitation, on purpose: power is weighed LIVE during the count, not at
// the snapshot block (archive reads per wallet are not worth it for salon #1).
// The snapshot block in the message still pins WHEN the ballot opened.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { recoverMessageAddress } from "viem";
import { loadWalletPower, type GovernParams, type WalletPower } from "@/lib/govern";
import styles from "./govern.module.css";

const fmt = (n: number) => n.toLocaleString("en-US");

type PropOption = { label: string; sub?: string };
export type LiveProposal = {
  id: string;
  title: string;
  body?: string;
  proposer?: string;
  options: (PropOption | string)[];
  applies?: string;
  snapshotBlock?: number;
  closesAt: string;
};
type BallotEntry = { choice: number; sig: string; ts: number };
type Weight = { power: number; souls: number; ok: boolean };

const msgOf = (id: string, choice: number, snapshot: number | undefined, addr: string) =>
  `Cubist Souls Govern\nProposal: ${id}\nChoice: ${choice}\nSnapshot: ${snapshot ?? 0}\nVoter: ${addr.toLowerCase()}`;

const optLabel = (o: PropOption | string) => (typeof o === "string" ? o : o.label);
const optSub = (o: PropOption | string) => (typeof o === "string" ? undefined : o.sub);

// Session-wide weight cache so re-polls never re-read the chain for a wallet
// already weighed. Keyed per proposal so a future ballot starts clean.
const weightCache = new Map<string, Weight>();

export default function ProposalLive({
  params,
  power,
  burned,
}: {
  params: GovernParams;
  power: WalletPower | null;
  burned: number;
}) {
  const [proposals, setProposals] = useState<LiveProposal[]>([]);
  useEffect(() => {
    fetch("/govern/proposals.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => {
        if (!Array.isArray(j)) return;
        setProposals(
          j.filter(
            (p) => p && typeof p.id === "string" && Array.isArray(p.options) && p.options.length >= 2,
          ),
        );
      })
      .catch(() => {});
  }, []);

  if (!proposals.length) return null;
  return (
    <>
      {proposals.map((p) => (
        <ProposalCard key={p.id} prop={p} params={params} power={power} burned={burned} />
      ))}
    </>
  );
}

function ProposalCard({
  prop,
  params,
  power,
  burned,
}: {
  prop: LiveProposal;
  params: GovernParams;
  power: WalletPower | null;
  burned: number;
}) {
  const client = usePublicClient({ chainId: 1 });
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [votes, setVotes] = useState<Record<string, BallotEntry>>({});
  const [weights, setWeights] = useState<Record<string, Weight>>({});
  const [signing, setSigning] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const closed = now >= Date.parse(prop.closesAt);

  // minute tick keeps the countdown honest without re-render churn
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // poll the ballot box
  useEffect(() => {
    let live = true;
    const pull = () =>
      fetch(`/api/govern/votes?id=${prop.id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (live && j && j.votes && typeof j.votes === "object") setVotes(j.votes);
        })
        .catch(() => {});
    pull();
    const t = setInterval(pull, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [prop.id]);

  // weigh voters, one at a time: verify the signature locally, then read the
  // wallet's soul-bound power. Failures are NOT cached (transient RPC) so the
  // next poll retries them; bad signatures ARE cached (they can't get better).
  const weighing = useRef(false);
  useEffect(() => {
    if (!client || weighing.current) return;
    const pending = Object.keys(votes).filter(
      (a) => !weightCache.has(`${prop.id}:${a}`) && weights[a] === undefined,
    );
    if (!pending.length) return;
    weighing.current = true;
    let stop = false;
    (async () => {
      for (const addr of pending) {
        if (stop) break;
        const v = votes[addr];
        const key = `${prop.id}:${addr}`;
        let ok = false;
        try {
          const rec = await recoverMessageAddress({
            message: msgOf(prop.id, v.choice, prop.snapshotBlock, addr),
            signature: v.sig as `0x${string}`,
          });
          ok = rec.toLowerCase() === addr.toLowerCase();
        } catch {}
        if (!ok) {
          const w = { power: 0, souls: 0, ok: false };
          weightCache.set(key, w);
          if (!stop) setWeights((prev) => ({ ...prev, [addr]: w }));
          continue;
        }
        try {
          const wp = await loadWalletPower(client, addr, params);
          const w = { power: wp.total, souls: wp.heldCount, ok: true };
          weightCache.set(key, w);
          if (!stop) setWeights((prev) => ({ ...prev, [addr]: w }));
        } catch {
          /* transient — retried on the next poll */
        }
      }
      weighing.current = false;
    })();
    return () => {
      stop = true;
      weighing.current = false;
    };
  }, [votes, weights, client, params, prop.id, prop.snapshotBlock]);

  // hydrate already-cached weights (e.g. after a remount)
  useEffect(() => {
    const cached: Record<string, Weight> = {};
    for (const a of Object.keys(votes)) {
      const w = weightCache.get(`${prop.id}:${a}`);
      if (w && weights[a] === undefined) cached[a] = w;
    }
    if (Object.keys(cached).length) setWeights((prev) => ({ ...prev, ...cached }));
  }, [votes, weights, prop.id]);

  const cast = useCallback(
    async (i: number) => {
      if (!address || closed || signing !== null) return;
      setErr(null);
      setSigning(i);
      try {
        const message = msgOf(prop.id, i, prop.snapshotBlock, address);
        const sig = await signMessageAsync({ message });
        const r = await fetch("/api/govern/vote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposalId: prop.id, choice: i, address, sig }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `vote failed (${r.status})`);
        const me = address.toLowerCase();
        setVotes((prev) => ({ ...prev, [me]: { choice: i, sig, ts: Math.floor(Date.now() / 1000) } }));
        // my own power is already on screen — seed my weight without an extra read
        if (power) {
          const w = { power: power.total, souls: power.heldCount, ok: true };
          weightCache.set(`${prop.id}:${me}`, w);
          setWeights((prev) => ({ ...prev, [me]: w }));
        }
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        if (!/rejected|denied/i.test(m)) setErr(m);
      } finally {
        setSigning(null);
      }
    },
    [address, closed, signing, prop.id, prop.snapshotBlock, signMessageAsync, power],
  );

  // ── tally ──
  const tally = useMemo(() => {
    const perOpt = prop.options.map(() => ({ power: 0, ballots: 0 }));
    let souls = 0;
    let counted = 0;
    let total = 0;
    let bad = 0;
    for (const [addr, v] of Object.entries(votes)) {
      if (!Number.isInteger(v.choice) || v.choice < 0 || v.choice >= prop.options.length) continue;
      total++;
      perOpt[v.choice].ballots++;
      const w = weights[addr];
      if (!w) continue;
      if (!w.ok) {
        bad++;
        continue;
      }
      counted++;
      souls += w.souls;
      perOpt[v.choice].power += w.power;
    }
    const powerSum = perOpt.reduce((a, o) => a + o.power, 0);
    const ballotSum = perOpt.reduce((a, o) => a + o.ballots, 0) || 1;
    return { perOpt, souls, counted, total, bad, powerSum, ballotSum };
  }, [votes, weights, prop.options.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const myVote = mounted && address ? votes[address.toLowerCase()] : undefined;
  const quorumPct = Math.min(100, Math.round((tally.souls / params.quorumSouls) * 100));
  const quorumMet = tally.souls >= params.quorumSouls;

  const msLeft = Date.parse(prop.closesAt) - now;
  const dLeft = Math.floor(msLeft / 86_400_000);
  const hLeft = Math.floor((msLeft % 86_400_000) / 3_600_000);
  const mLeft = Math.floor((msLeft % 3_600_000) / 60_000);
  const closesTxt = closed
    ? "voting closed"
    : dLeft > 0
      ? `closes in ${dLeft}d ${hLeft}h`
      : hLeft > 0
        ? `closes in ${hLeft}h ${mLeft}m`
        : `closes in ${mLeft}m`;

  const leadPower = Math.max(...tally.perOpt.map((o) => o.power));

  return (
    <section className={styles.section}>
      <article className={styles.ballot}>
        <div className={styles.propTop}>
          <span className={closed ? styles.closedBadge : styles.liveBadge}>
            {closed ? "CLOSED" : "● LIVE VOTE"}
          </span>
          <span className={styles.closesIn}>{closesTxt}</span>
        </div>

        <h3 className={styles.ballotTitle}>{prop.title}</h3>

        <div className={styles.ballotMeta}>
          {prop.proposer && (
            <span className={styles.metaChip}>
              🜃 <b>{prop.proposer}</b>
            </span>
          )}
          {burned > 0 && (
            <span className={styles.metaSeal}>
              <b>{fmt(burned)}</b> souls through the fire
            </span>
          )}
          {prop.snapshotBlock ? (
            <span className={styles.metaCouncil}>
              snapshot <b>#{fmt(prop.snapshotBlock)}</b>
            </span>
          ) : null}
        </div>

        {prop.body && <p className={styles.propBody}>{prop.body}</p>}

        {!mounted || isConnected ? null : (
          <div className={styles.connectRow}>
            <ConnectButton chainStatus="none" showBalance={false} accountStatus="address" />
            <span className={styles.connectHint}>connect to sign your ballot — voting is free</span>
          </div>
        )}

        <div className={styles.stOpts}>
          {prop.options.map((o, i) => {
            const pct = tally.powerSum
              ? Math.round((tally.perOpt[i].power / tally.powerSum) * 100)
              : Math.round((tally.perOpt[i].ballots / tally.ballotSum) * 100);
            const leading = tally.powerSum > 0 && tally.perOpt[i].power === leadPower && leadPower > 0;
            const isMine = myVote?.choice === i;
            return (
              <button
                key={i}
                className={`${styles.stOpt} ${isMine ? styles.stOptOn : ""}`}
                onClick={() => cast(i)}
                disabled={closed || !isConnected || signing !== null}
                aria-pressed={isMine}
              >
                <span
                  className={`${styles.stFill} ${leading ? styles.stFillLead : ""}`}
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
                <span className={styles.stOptTxt}>
                  <b>{optLabel(o)}</b>
                  {optSub(o) ? <em>{optSub(o)}</em> : null}
                </span>
                <span className={styles.stOptPct}>
                  {signing === i ? "sign…" : `${pct}%${isMine ? " ✓" : ""}`}
                </span>
              </button>
            );
          })}
        </div>

        {myVote && (
          <p className={styles.voteNote}>
            Your ballot is in: <b>{optLabel(prop.options[myVote.choice])}</b>
            {closed ? "." : " — you can re-sign to change it until the vote closes."}
          </p>
        )}
        {err && <p className={styles.errNote}>{err}</p>}

        <div className={styles.quorum}>
          <div className={styles.quorumTop}>
            <span>Quorum</span>
            <span className={quorumMet ? styles.qMet : undefined}>
              {fmt(tally.souls)} / {fmt(params.quorumSouls)} souls {quorumMet ? "· met ✓" : ""}
            </span>
          </div>
          <div className={styles.quorumTrack}>
            <span
              className={`${styles.quorumFill} ${quorumMet ? styles.quorumFillMet : ""}`}
              style={{ width: `${quorumPct}%` }}
            />
          </div>
        </div>

        <p className={styles.weighNote}>
          {fmt(tally.total)} ballot{tally.total === 1 ? "" : "s"}
          {tally.total > tally.counted + tally.bad
            ? ` · weighing ${fmt(tally.total - tally.counted - tally.bad)}…`
            : ` · ${fmt(tally.powerSum)} power counted`}
          {tally.bad > 0 ? ` · ${tally.bad} invalid signature${tally.bad === 1 ? "" : "s"} dropped` : ""}
        </p>

        {prop.applies && (
          <p className={styles.stApplies}>
            If it carries: <code>{prop.applies}</code>.
          </p>
        )}
      </article>
    </section>
  );
}
