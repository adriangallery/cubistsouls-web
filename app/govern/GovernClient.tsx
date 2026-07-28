"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  fetchGovernParams,
  loadWalletPower,
  DEFAULT_PARAMS,
  type GovernParams,
  type WalletPower,
} from "@/lib/govern";
import type { PyramidCounts } from "./page";
import styles from "./govern.module.css";

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString("en-US");
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const stars = (n: number) => "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);

// DEV-ONLY read-only harness: ?as=0x… renders another wallet's power (reads only,
// no signer) so we can verify/screenshot a specific wallet. Inert in every deployed
// build (gated to development), exactly like /my-souls.
function useDevAs(): string | undefined {
  const [as, setAs] = useState<string>();
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const v = new URLSearchParams(window.location.search).get("as");
    if (v && /^0x[0-9a-fA-F]{40}$/.test(v)) setAs(v.toLowerCase());
  }, []);
  return as;
}

export default function GovernClient({ counts }: { counts: PyramidCounts }) {
  // Hot params — fetched CLIENT-SIDE, cache-busted (see lib/govern). Editing the
  // JSON in the assets repo + push changes this page in seconds, no redeploy.
  const [params, setParams] = useState<GovernParams>(DEFAULT_PARAMS);
  const [paramsLoaded, setParamsLoaded] = useState(false);
  useEffect(() => {
    fetchGovernParams()
      .then(setParams)
      .finally(() => setParamsLoaded(true));
  }, []);

  // Wallet power is lifted here so the demo ballot can pour it into the layer bars.
  const [power, setPower] = useState<WalletPower | null>(null);

  return (
    <main className={styles.wrap}>
      <Hero />
      <Pyramid counts={counts} params={params} />
      <PowerPanel params={params} onPower={setPower} />
      <HowItWorks params={params} />
      <DemoBallot params={params} power={power} />
      <FinePrint params={params} />
      <div className={styles.paramTag}>
        {paramsLoaded ? (
          params.version > 0 ? (
            <>
              params <b>v{params.version}</b> · live from the museum ledger
            </>
          ) : (
            <>params <b>defaults</b> · ledger unreachable</>
          )
        ) : (
          <>loading params…</>
        )}
      </div>
    </main>
  );
}

// ── HERO ───────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <header className={styles.hero}>
      <span className={styles.kicker}>
        <span className={styles.tri}>🜃</span> Soul-bound governance
      </span>
      <h1 className={styles.title}>THE PYRAMID</h1>
      <p className={styles.lead}>Power lives in the souls — not the wallet.</p>
    </header>
  );
}

// ── a. THE PYRAMID, drawn ───────────────────────────────────────────────────────
function Pyramid({ counts, params }: { counts: PyramidCounts; params: GovernParams }) {
  const erasTxt = counts.eras ? fmtK(counts.eras) : "—";
  const ogTxt = counts.og ? fmt(counts.og) : "—";
  return (
    <section className={styles.section}>
      <div className={styles.pyramid}>
        <div className={`${styles.tier} ${styles.tOrder}`} style={{ width: "62%" }}>
          <span className={styles.tierIco}>🜃</span>
          <div className={styles.tierTxt}>
            <b>The Order</b>
            <span>
              {counts.reapers} soul{counts.reapers === 1 ? "" : "s"} · reapers rule
            </span>
          </div>
          <span className={styles.tierMeta}>×{params.reaperCrown}</span>
        </div>
        <div className={`${styles.tier} ${styles.tCohort}`} style={{ width: "82%" }}>
          <span className={styles.tierIco}>◈</span>
          <div className={styles.tierTxt}>
            <b>Cohorts</b>
            <span>
              {ogTxt} OG · {erasTxt} Eras
            </span>
          </div>
          <span className={styles.tierMeta}>
            {params.cohortPts.og}·{params.cohortPts.eraI}·{params.cohortPts.eraII}
          </span>
        </div>
        <div className={`${styles.tier} ${styles.tSenior}`} style={{ width: "100%" }}>
          <span className={styles.tierIco}>★</span>
          <div className={styles.tierTxt}>
            <b>Seniority</b>
            <span>every hour counts</span>
          </div>
          <span className={styles.tierMeta}>0–5</span>
        </div>
      </div>
    </section>
  );
}

// ── b. YOUR POWER ───────────────────────────────────────────────────────────────
type Phase = "idle" | "loading" | "loaded" | "error";

function PowerPanel({
  params,
  onPower,
}: {
  params: GovernParams;
  onPower: (p: WalletPower | null) => void;
}) {
  const client = usePublicClient();
  const { address, isConnected } = useAccount();
  const devAs = useDevAs();
  const account = devAs ?? address;
  const connected = !!devAs || isConnected;

  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [power, setPower] = useState<WalletPower | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !connected || !account || !client) {
      setPower(null);
      onPower(null);
      setPhase("idle");
      return;
    }
    let live = true;
    setPhase("loading");
    loadWalletPower(client, account, params)
      .then((wp) => {
        if (!live) return;
        setPower(wp);
        onPower(wp);
        setPhase("loaded");
      })
      .catch(() => live && setPhase("error"));
    return () => {
      live = false;
    };
    // Re-run when the crown/points/tiers change (hot params) so the number is live.
  }, [mounted, connected, account, client, params, onPower]);

  return (
    <section className={styles.section}>
      <div className={styles.secHead}>
        <span className={styles.eyebrow}>Your power</span>
        <h2>WHAT YOUR SOULS CARRY</h2>
      </div>

      {!mounted || !connected ? (
        <div className={styles.connectCard}>
          <p className={styles.connectLead}>Connect to weigh the souls in this wallet.</p>
          <ConnectButton chainStatus="none" showBalance={false} accountStatus="address" />
        </div>
      ) : phase === "loading" ? (
        <div className={styles.powerSkeleton}>Weighing your souls…</div>
      ) : phase === "error" ? (
        <p className={styles.note}>Couldn&apos;t reach the chain — try again in a moment.</p>
      ) : power && power.heldCount === 0 ? (
        <p className={styles.note}>
          No souls in this wallet yet — power travels with the token, so you hold none.
        </p>
      ) : power ? (
        <>
          <div className={styles.powerHero}>
            <div className={styles.powerBig}>
              <span className={styles.powerNum}>{fmt(power.total)}</span>
              <span className={styles.powerUnit}>voting power</span>
            </div>
            <div className={styles.powerFrom}>
              across <b>{power.heldCount}</b> soul{power.heldCount === 1 ? "" : "s"}
              {power.reaperCount > 0 ? (
                <>
                  {" "}
                  · <b>{power.reaperCount}</b> crowned 🜃
                </>
              ) : null}
            </div>
          </div>

          {/* simple additive breakdown — the three layers that sum to the total */}
          <ul className={styles.breakdown}>
            <BreakRow
              label="Cohort points"
              sub={cohortSub(power)}
              value={power.cohortBase}
              cls={styles.bCohort}
            />
            {power.crownBonus > 0 && (
              <BreakRow
                label="Reaper crowns"
                sub={`${power.reaperCount} reaper × ${params.reaperCrown}`}
                value={power.crownBonus}
                cls={styles.bOrder}
                plus
              />
            )}
            <BreakRow
              label="Seniority stars"
              sub={`hours held, per soul (cap 5)`}
              value={power.starTotal}
              cls={styles.bSenior}
              plus
            />
          </ul>

          <button className={styles.seeSoul} onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Hide per-soul" : "See per-soul →"}
          </button>
          {expanded && (
            <div className={styles.soulGrid}>
              {power.souls.map((s) => (
                <div className={styles.soulCard} key={s.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={styles.soulArt} src={`/api/img?id=${s.id}`} alt={`Soul #${s.id}`} loading="lazy" />
                  <div className={styles.soulBody}>
                    <div className={styles.soulTop}>
                      <b>#{s.id}</b>
                      <span className={styles.soulPow}>{s.power}</span>
                    </div>
                    <div className={styles.soulMeta}>
                      <span className={s.cohortKey === "og" ? styles.ogTag : styles.eraTag}>
                        {s.cohortName}
                      </span>
                      {s.isReaper && <span className={styles.crownTag}>🜃 reaper</span>}
                    </div>
                    <div className={styles.soulStars} title={`${fmt(Math.round(s.soulMH))} MH`}>
                      {stars(s.stars)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function cohortSub(p: WalletPower): string {
  const parts: string[] = [];
  if (p.byCohort.og) parts.push(`${p.byCohort.og} OG`);
  if (p.byCohort.eraI) parts.push(`${p.byCohort.eraI} Era I`);
  if (p.byCohort.eraII) parts.push(`${p.byCohort.eraII} Era II+`);
  return parts.join(" · ") || "—";
}

function BreakRow({
  label,
  sub,
  value,
  cls,
  plus,
}: {
  label: string;
  sub: string;
  value: number;
  cls: string;
  plus?: boolean;
}) {
  return (
    <li className={styles.breakRow}>
      <span className={`${styles.breakDot} ${cls}`} />
      <div className={styles.breakTxt}>
        <b>{label}</b>
        <span>{sub}</span>
      </div>
      <span className={styles.breakVal}>
        {plus ? "+" : ""}
        {fmt(value)}
      </span>
    </li>
  );
}

// ── c. HOW IT WORKS — the cycle in 5 steps ──────────────────────────────────────
function HowItWorks({ params }: { params: GovernParams }) {
  const steps = [
    { ic: "🜃", t: "A reaper proposes", d: "Only the Order can open a proposal." },
    { ic: "🤝", t: `${params.secondsRequired} second it`, d: `${params.secondsRequired} other reapers must back it.` },
    { ic: "🏛️", t: "The Salon", d: `It goes to the ${params.salonCadence} vote.` },
    { ic: "▦", t: "The pyramid votes", d: `Quorum ${fmt(params.quorumSouls)} souls · majority of power.` },
    { ic: "⏸️", t: `Order may brake ${params.brakeHours}h`, d: "One pause forces a re-vote." },
    { ic: "✓", t: "It executes", d: "The result ships, in the open." },
  ];
  return (
    <section className={styles.section}>
      <div className={styles.secHead}>
        <span className={styles.eyebrow}>The cycle</span>
        <h2>HOW IT WORKS</h2>
      </div>
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li className={styles.step} key={i}>
            <span className={styles.stepNum}>{i + 1}</span>
            <span className={styles.stepIco}>{s.ic}</span>
            <b className={styles.stepTitle}>{s.t}</b>
            <span className={styles.stepDesc}>{s.d}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── d. DEMO BALLOT — a fake vote, clearly marked, LOCAL only ─────────────────────
type Vote = "for" | "against" | "abstain";
const VOTE_STORE = "cs-govern-demo-vote";

// Seed tally (mock power by pyramid layer). The connected wallet's real power is
// poured into the matching layers when it votes — the "data theatre" of the plan.
const SEED = {
  for: { order: 9, cohort: 286, senior: 71 },
  against: { order: 0, cohort: 74, senior: 18 },
  seedSouls: 312,
};

function DemoBallot({ params, power }: { params: GovernParams; power: WalletPower | null }) {
  const [vote, setVote] = useState<Vote | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(VOTE_STORE) as Vote | null;
      if (v === "for" || v === "against" || v === "abstain") setVote(v);
    } catch {}
  }, []);
  const cast = useCallback((v: Vote) => {
    setVote(v);
    try {
      localStorage.setItem(VOTE_STORE, v);
    } catch {}
  }, []);
  const clear = useCallback(() => {
    setVote(null);
    try {
      localStorage.removeItem(VOTE_STORE);
    } catch {}
  }, []);

  // My contribution, decomposed by layer (crown→Order, cohort→Cohorts, stars→Seniority).
  const mine = useMemo(
    () => ({
      order: power?.crownBonus ?? 0,
      cohort: power?.cohortBase ?? (power ? 0 : 12),
      senior: power?.starTotal ?? 0,
      souls: power?.heldCount ?? 1,
    }),
    [power],
  );

  const forT = { ...SEED.for };
  const againstT = { ...SEED.against };
  let souls = SEED.seedSouls;
  if (vote === "for") {
    forT.order += mine.order;
    forT.cohort += mine.cohort;
    forT.senior += mine.senior;
    souls += mine.souls;
  } else if (vote === "against") {
    againstT.order += mine.order;
    againstT.cohort += mine.cohort;
    againstT.senior += mine.senior;
    souls += mine.souls;
  } else if (vote === "abstain") {
    souls += mine.souls;
  }
  const forSum = forT.order + forT.cohort + forT.senior;
  const againstSum = againstT.order + againstT.cohort + againstT.senior;
  const total = forSum + againstSum || 1;
  const forPct = Math.round((forSum / total) * 100);
  const quorumPct = Math.min(100, Math.round((souls / params.quorumSouls) * 100));
  const quorumMet = souls >= params.quorumSouls;

  return (
    <section className={styles.section}>
      <div className={styles.secHead}>
        <span className={styles.eyebrow}>See it vote</span>
        <h2>A BALLOT</h2>
      </div>

      <article className={styles.ballot}>
        <div className={styles.demoBadge}>DEMO — not a real vote</div>
        <h3 className={styles.ballotTitle}>Should the museum host a summer raffle?</h3>
        <div className={styles.ballotMeta}>
          <span className={styles.metaChip}>
            🜃 proposed by <b>Soul Reaper #8777</b>
          </span>
          <span className={styles.metaSeal}>
            seconded <b>{params.secondsRequired}/{params.secondsRequired}</b> ✓
          </span>
          <span className={styles.metaCouncil}>
            The Order counsels: <b>FOR</b> · 3/3
          </span>
        </div>

        {/* vote buttons — functional locally, persisted in localStorage */}
        <div className={styles.voteRow}>
          {(["for", "against", "abstain"] as Vote[]).map((v) => (
            <button
              key={v}
              className={`${styles.voteBtn} ${vote === v ? styles.voteOn : ""} ${styles["v_" + v]}`}
              onClick={() => cast(v)}
            >
              {v === "for" ? "Vote FOR" : v === "against" ? "Vote AGAINST" : "Abstain"}
              {vote === v ? " ✓" : ""}
            </button>
          ))}
        </div>
        {vote && (
          <div className={styles.voteNote}>
            You voted <b>{vote.toUpperCase()}</b>
            {power ? (
              <>
                {" "}
                with <b>{fmt(power.total)}</b> power
              </>
            ) : (
              <> (connect a wallet above to add your real power)</>
            )}
            . <button className={styles.clearBtn} onClick={clear}>reset</button>
          </div>
        )}

        {/* headline split */}
        <div className={styles.splitBar}>
          <span className={styles.splitFor} style={{ width: `${forPct}%` }}>
            {forPct >= 12 ? `FOR ${forPct}%` : ""}
          </span>
          <span className={styles.splitAgainst}>{100 - forPct >= 12 ? `AGAINST ${100 - forPct}%` : ""}</span>
        </div>

        {/* the pyramid votes — power contributed by each layer (FOR vs AGAINST) */}
        <div className={styles.tallyHead}>How the pyramid voted</div>
        <div className={styles.layerTally}>
          {(
            [
              ["The Order", styles.bOrder, forT.order, againstT.order],
              ["Cohorts", styles.bCohort, forT.cohort, againstT.cohort],
              ["Seniority", styles.bSenior, forT.senior, againstT.senior],
            ] as [string, string, number, number][]
          ).map(([name, cls, f, a]) => {
            const rowMax = Math.max(1, forSum, againstSum);
            return (
              <div className={styles.layerRow} key={name}>
                <span className={styles.layerName}>
                  <span className={`${styles.breakDot} ${cls}`} /> {name}
                </span>
                <span className={styles.layerBars}>
                  <span className={styles.layerFor} style={{ width: `${(f / rowMax) * 100}%` }} />
                  <span className={styles.layerAgainst} style={{ width: `${(a / rowMax) * 100}%` }} />
                </span>
                <span className={styles.layerVal}>{fmt(f + a)}</span>
              </div>
            );
          })}
        </div>

        {/* quorum meter */}
        <div className={styles.quorum}>
          <div className={styles.quorumTop}>
            <span>Quorum</span>
            <span className={quorumMet ? styles.qMet : undefined}>
              {fmt(souls)} / {fmt(params.quorumSouls)} souls {quorumMet ? "· met ✓" : ""}
            </span>
          </div>
          <div className={styles.quorumTrack}>
            <span
              className={`${styles.quorumFill} ${quorumMet ? styles.quorumFillMet : ""}`}
              style={{ width: `${quorumPct}%` }}
            />
          </div>
        </div>
      </article>
    </section>
  );
}

// ── e. FINE PRINT ────────────────────────────────────────────────────────────────
function FinePrint({ params }: { params: GovernParams }) {
  return (
    <section className={styles.section}>
      <ul className={styles.fine}>
        <li>
          <b>Quorum {fmt(params.quorumSouls)} souls</b> — counted in souls, never wallets.
        </li>
        <li>
          <b>Snapshot at proposal</b> — power is frozen the moment a ballot opens.
        </li>
        <li>Your souls carry the power — not your wallet.</li>
      </ul>
    </section>
  );
}
