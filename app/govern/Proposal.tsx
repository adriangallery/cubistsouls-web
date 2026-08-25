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
// The TALLY, since the tally-scale work, is server-first: /api/govern/votes
// returns the ballots PLUS the weights the server already computed (each wallet
// weighed once, cached in Redis, shared by every visitor), and — once a vote
// closes — a FROZEN final tally that costs nothing to render. This component
// still verifies every signature locally (cheap CPU) and still knows how to
// weigh a wallet itself, but the chain reads only happen for voters the server
// has not weighed yet — the trustless audit path stayed, the per-visitor RPC
// storm did not. Quorum is counted in souls, per the plan.
//
// Honest limitation, on purpose: power is weighed LIVE during the count, not at
// the snapshot block (archive reads per wallet are not worth it for salon #1).
// The snapshot block in the message still pins WHEN the ballot opened.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { recoverMessageAddress } from "viem";
import { loadWalletPower, type GovernParams, type WalletPower } from "@/lib/govern";
import { ballotMessage } from "@/lib/govern-ballot";
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
type ServerWeight = { power: number; souls: number; at: number };
type FinalTally = {
  frozen: true;
  perOpt: { power: number; ballots: number }[];
  souls: number;
  powerSum: number;
  total: number;
  counted: number;
  bad: number;
};

const optLabel = (o: PropOption | string) => (typeof o === "string" ? o : o.label);
const optSub = (o: PropOption | string) => (typeof o === "string" ? undefined : o.sub);

// ── the two client caches ────────────────────────────────────────────────────
// POWER is a property of the ADDRESS, not of a proposal — one wallet voting on
// three ballots is weighed once. Persisted to localStorage with a TTL so an F5
// doesn't restart the count from zero. Signature verdicts are per proposal
// (same wallet can sign one ballot right and another wrong) and only the BAD
// ones are worth remembering — they can't get better.
const POWER_TTL_S = 6 * 3600;
const LS_KEY = "cs:gov:powercache:v1";
const powerCache = new Map<string, ServerWeight>();
const badSigCache = new Set<string>(); // `${propId}:${addr}`

let hydrated = false;
function hydratePowerCache() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    const cutoff = Date.now() / 1000 - POWER_TTL_S;
    for (const [addr, w] of Object.entries<any>(raw)) {
      if (w && Number.isFinite(w.power) && Number.isFinite(w.souls) && w.at > cutoff)
        powerCache.set(addr, { power: w.power, souls: w.souls, at: w.at });
    }
  } catch {
    /* storage unavailable / corrupt — render works without it */
  }
}
function rememberPower(addr: string, w: ServerWeight) {
  powerCache.set(addr, w);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(powerCache)));
  } catch {
    /* best-effort */
  }
}

export default function ProposalLive({
  params,
  power,
  burned,
  reloadToken = 0,
}: {
  params: GovernParams;
  power: WalletPower | null;
  burned: number;
  /** Bump to refetch — the propose form does after a proposal goes live. */
  reloadToken?: number;
}) {
  const [proposals, setProposals] = useState<LiveProposal[]>([]);
  useEffect(() => {
    // The MERGED feed: museum proposals (proposals.json) + reaper proposals
    // created live via /api/govern/propose. Server sorts open-first, newest-first.
    fetch("/api/govern/proposals", { cache: "no-store" })
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
  }, [reloadToken]);

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
  const [srvWeights, setSrvWeights] = useState<Record<string, ServerWeight>>({});
  const [final, setFinal] = useState<FinalTally | null>(null);
  const [signing, setSigning] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const closed = now >= Date.parse(prop.closesAt);

  // minute tick keeps the countdown honest without re-render churn
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(hydratePowerCache, []);

  // poll the ballot box. The response carries the server-computed weights, and
  // — once the vote has closed and the server froze it — the final tally, at
  // which point polling stops for good: frozen numbers never change.
  useEffect(() => {
    if (final) return;
    let live = true;
    const pull = () =>
      fetch(`/api/govern/votes?id=${prop.id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!live || !j) return;
          if (j.votes && typeof j.votes === "object") setVotes(j.votes);
          if (j.weights && typeof j.weights === "object")
            setSrvWeights((prev) => ({ ...prev, ...j.weights }));
          if (j.final && j.final.frozen === true && Array.isArray(j.final.perOpt))
            setFinal(j.final);
        })
        .catch(() => {});
    pull();
    const t = setInterval(pull, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [prop.id, final]);

  // weigh voters, one at a time: verify the signature locally (cheap CPU),
  // then take the power from the server's weights, then the local cache, and
  // only as a last resort read the chain — that fallback is what keeps the
  // count reproducible without the server. Transient failures are NOT cached
  // (the next poll retries); bad signatures ARE (they can't get better). A
  // frozen tally needs none of this.
  const weighing = useRef(false);
  useEffect(() => {
    if (final || weighing.current) return;
    const pending = Object.keys(votes).filter((a) => weights[a] === undefined);
    if (!pending.length) return;
    weighing.current = true;
    let stop = false;
    (async () => {
      for (const addr of pending) {
        if (stop) break;
        const v = votes[addr];
        const badKey = `${prop.id}:${addr}`;
        let ok = badSigCache.has(badKey) ? false : undefined;
        if (ok === undefined) {
          ok = false;
          try {
            const rec = await recoverMessageAddress({
              message: ballotMessage(prop.id, v.choice, prop.snapshotBlock, addr),
              signature: v.sig as `0x${string}`,
            });
            ok = rec.toLowerCase() === addr.toLowerCase();
          } catch {}
          if (!ok) badSigCache.add(badKey);
        }
        if (!ok) {
          if (!stop) setWeights((prev) => ({ ...prev, [addr]: { power: 0, souls: 0, ok: false } }));
          continue;
        }
        const known = srvWeights[addr] ?? powerCache.get(addr);
        if (known) {
          rememberPower(addr, known);
          if (!stop)
            setWeights((prev) => ({ ...prev, [addr]: { power: known.power, souls: known.souls, ok: true } }));
          continue;
        }
        if (!client) continue;
        try {
          const wp = await loadWalletPower(client, addr, params);
          const w = { power: wp.total, souls: wp.heldCount, at: Math.floor(Date.now() / 1000) };
          rememberPower(addr, w);
          if (!stop)
            setWeights((prev) => ({ ...prev, [addr]: { power: w.power, souls: w.souls, ok: true } }));
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
  }, [votes, weights, srvWeights, final, client, params, prop.id, prop.snapshotBlock]);

  const cast = useCallback(
    async (i: number) => {
      if (!address || closed || signing !== null) return;
      setErr(null);
      setSigning(i);
      try {
        const message = ballotMessage(prop.id, i, prop.snapshotBlock, address);
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
          rememberPower(me, {
            power: power.total,
            souls: power.heldCount,
            at: Math.floor(Date.now() / 1000),
          });
          setWeights((prev) => ({ ...prev, [me]: { power: power.total, souls: power.heldCount, ok: true } }));
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

  // ── tally ── (a frozen final wins outright: it's the server-sealed count)
  const tally = useMemo(() => {
    if (final) {
      const ballotSum = final.perOpt.reduce((a, o) => a + o.ballots, 0) || 1;
      return { ...final, ballotSum };
    }
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
  }, [votes, weights, final, prop.options.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
          {final ? " · count sealed" : ""}
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
