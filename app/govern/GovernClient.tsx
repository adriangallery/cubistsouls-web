"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
      <Cycle />
      <DemoBallot params={params} power={power} />
      <StandingVotes params={params} power={power} />
      <Ledger params={params} />
      <FinePrint params={params} />
      <div className={styles.paramTag}>
        {paramsLoaded ? (
          params.version > 0 ? (
            <>
              params <b>v{params.version}</b> · live
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

// ── HERO — the whole page in two lines ──────────────────────────────────────────
function Hero() {
  return (
    <header className={styles.hero}>
      <span className={styles.kicker}>
        <span className={styles.tri}>🜃</span> Soul-bound governance
      </span>
      <h1 className={styles.title}>THE PYRAMID</h1>
      <p className={styles.lead}>Your souls carry the power.</p>
      <p className={styles.lead2}>Reapers propose. The pyramid votes.</p>
    </header>
  );
}

// ── a. THE PYRAMID — the protagonist, explains itself ───────────────────────────
function Pyramid({ counts, params }: { counts: PyramidCounts; params: GovernParams }) {
  const erasTxt = counts.eras ? fmtK(counts.eras) : "—";
  const ogTxt = counts.og ? fmt(counts.og) : "—";
  return (
    <section className={styles.section}>
      <div className={styles.pyramid}>
        <div className={`${styles.tier} ${styles.tOrder}`} style={{ width: "64%" }}>
          <span className={styles.tierIco}>🜃</span>
          <div className={styles.tierTxt}>
            <b>The Order</b>
            <span>propose &amp; counsel</span>
          </div>
          <span className={styles.tierMeta}>{counts.reapers || "—"}</span>
        </div>
        <div className={`${styles.tier} ${styles.tCohort}`} style={{ width: "82%" }}>
          <span className={styles.tierIco}>◈</span>
          <div className={styles.tierTxt}>
            <b>Cohorts</b>
            <span>
              {ogTxt} OG · {erasTxt}
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
            <span>every hour held</span>
          </div>
          <span className={styles.tierMeta}>+5 max</span>
        </div>
      </div>
    </section>
  );
}

// ── b. YOUR POWER — one giant number + three chips ──────────────────────────────
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
      <span className={styles.eyebrow}>Your power</span>

      {!mounted || !connected ? (
        <div className={styles.connectCard}>
          <p className={styles.connectLead}>Connect to weigh your souls.</p>
          <ConnectButton chainStatus="none" showBalance={false} accountStatus="address" />
        </div>
      ) : phase === "loading" ? (
        <div className={styles.powerSkeleton}>Weighing your souls…</div>
      ) : phase === "error" ? (
        <p className={styles.note}>Couldn&apos;t reach the chain — try again.</p>
      ) : power && power.heldCount === 0 ? (
        <p className={styles.note}>No souls here yet — power travels with the token.</p>
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

          {/* three chips — the whole breakdown, no prose */}
          <div className={styles.chips}>
            <Chip label="cohorts" value={power.cohortBase} cls={styles.bCohort} />
            <Chip label="crowns" value={power.crownBonus} cls={styles.bOrder} plus />
            <Chip label="stars" value={power.starTotal} cls={styles.bSenior} plus />
          </div>

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

function Chip({
  label,
  value,
  cls,
  plus,
}: {
  label: string;
  value: number;
  cls: string;
  plus?: boolean;
}) {
  return (
    <div className={styles.chip}>
      <span className={`${styles.breakDot} ${cls}`} />
      <span className={styles.chipVal}>
        {plus ? "+" : ""}
        {fmt(value)}
      </span>
      <span className={styles.chipLabel}>{label}</span>
    </div>
  );
}

// ── c. THE CYCLE — one horizontal strip of icons ────────────────────────────────
function Cycle() {
  const steps = [
    { ic: "🜃", t: "propose" },
    { ic: "🤝", t: "second" },
    { ic: "🏛️", t: "salon" },
    { ic: "▦", t: "vote" },
    { ic: "✓", t: "execute" },
  ];
  return (
    <section className={styles.section}>
      <span className={styles.eyebrow}>The cycle</span>
      <ol className={styles.cycle}>
        {steps.map((s, i) => (
          <Fragment key={s.t}>
            <li className={styles.cycleStep}>
              <span className={styles.cycleIco}>{s.ic}</span>
              <span className={styles.cycleTxt}>{s.t}</span>
            </li>
            {i < steps.length - 1 && (
              <span className={styles.cycleArrow} aria-hidden>
                →
              </span>
            )}
          </Fragment>
        ))}
      </ol>
    </section>
  );
}

// ── d. DEMO BALLOT — teaches by doing, LOCAL only ───────────────────────────────
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
      <article className={styles.ballot}>
        <div className={styles.demoBadge}>DEMO</div>
        <h3 className={styles.ballotTitle}>Host a summer raffle?</h3>
        <div className={styles.ballotMeta}>
          <span className={styles.metaChip}>
            🜃 <b>Soul Reaper #8777</b>
          </span>
          <span className={styles.metaSeal}>
            seconded <b>{params.secondsRequired}/{params.secondsRequired}</b> ✓
          </span>
          <span className={styles.metaCouncil}>
            Order counsels <b>FOR</b> · 3/3
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
            You voted <b>{vote.toUpperCase()}</b>.{" "}
            <button className={styles.clearBtn} onClick={clear}>
              reset
            </button>
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
              {fmt(souls)} / {fmt(params.quorumSouls)} {quorumMet ? "· met ✓" : ""}
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

// ── e. STANDING VOTES — the recurring ones, over CLOSED options ─────────────────
//
// A proposal (above) is written by a reaper and is a one-off. A standing vote comes
// back on a cadence and asks the same question over a set of options the museum
// wrote. That distinction is the whole safety model: the pyramid picks BETWEEN
// options, it never writes a value, so no single bad night can break the museum.
//
// Adding one is an edit to govern-params.json in the assets repo — no redeploy, no
// contract change, no facet cut. Which is why this component renders whatever it
// finds there instead of anything hardcoded.
//
// Votes are LOCAL (localStorage) while the design is frozen, exactly like the demo
// ballot above — the EIP-191 engine lands with the first real Salón.
const STANDING_STORE = "cs-govern-standing";

function StandingVotes({ params, power }: { params: GovernParams; power: WalletPower | null }) {
  const [picks, setPicks] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STANDING_STORE);
      if (raw) setPicks(JSON.parse(raw) as Record<string, number>);
    } catch {}
  }, []);
  const pick = useCallback((key: string, idx: number) => {
    setPicks((prev) => {
      const next = prev[key] === idx ? { ...prev, [key]: -1 } : { ...prev, [key]: idx };
      try {
        localStorage.setItem(STANDING_STORE, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // What this wallet pours into whichever option it picks, split by pyramid layer.
  const mine = useMemo(
    () => ({
      order: power?.crownBonus ?? 0,
      cohort: power?.cohortBase ?? (power ? 0 : 12),
      senior: power?.starTotal ?? 0,
      souls: power?.heldCount ?? 1,
    }),
    [power],
  );

  if (!params.ballots.length) return null;

  return (
    <section className={styles.section}>
      <div className={styles.stHead}>
        <h2 className={styles.stTitle}>Standing votes</h2>
        <p className={styles.stLead}>
          The museum writes the options. The pyramid chooses between them — every time.
        </p>
      </div>

      {params.ballots.map((b) => {
        const chosen = picks[b.key] ?? -1;
        const tallies = b.options.map((o, i) => {
          const seed = o.seed ?? { order: 0, cohort: 0, senior: 0 };
          const t = { ...seed };
          if (chosen === i) {
            t.order += mine.order;
            t.cohort += mine.cohort;
            t.senior += mine.senior;
          }
          return t.order + t.cohort + t.senior;
        });
        const total = tallies.reduce((a, n) => a + n, 0) || 1;
        const top = Math.max(...tallies);
        const souls = (b.seedSouls ?? 0) + (chosen >= 0 ? mine.souls : 0);
        const quorumPct = Math.min(100, Math.round((souls / params.quorumSouls) * 100));
        const quorumMet = souls >= params.quorumSouls;

        return (
          <article className={styles.stBallot} key={b.key}>
            <div className={styles.stTop}>
              <span className={styles.stKey}>{b.key}</span>
              <span className={styles.stCadence}>{b.cadence}</span>
            </div>
            <h3 className={styles.ballotTitle}>{b.question}</h3>

            <div className={styles.stOpts}>
              {b.options.map((o, i) => {
                const pct = Math.round((tallies[i] / total) * 100);
                const leading = tallies[i] === top && top > 0;
                return (
                  <button
                    key={String(o.value)}
                    className={`${styles.stOpt} ${chosen === i ? styles.stOptOn : ""}`}
                    onClick={() => pick(b.key, i)}
                    aria-pressed={chosen === i}
                  >
                    <span
                      className={`${styles.stFill} ${leading ? styles.stFillLead : ""}`}
                      style={{ width: `${pct}%` }}
                      aria-hidden
                    />
                    <span className={styles.stOptTxt}>
                      <b>{o.label}</b>
                      {o.sub ? <em>{o.sub}</em> : null}
                    </span>
                    <span className={styles.stOptPct}>
                      {pct}%{chosen === i ? " ✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className={styles.quorum}>
              <div className={styles.quorumTop}>
                <span>Quorum</span>
                <span className={quorumMet ? styles.qMet : undefined}>
                  {fmt(souls)} / {fmt(params.quorumSouls)} {quorumMet ? "· met ✓" : ""}
                </span>
              </div>
              <div className={styles.quorumTrack}>
                <span
                  className={`${styles.quorumFill} ${quorumMet ? styles.quorumFillMet : ""}`}
                  style={{ width: `${quorumPct}%` }}
                />
              </div>
            </div>

            {b.applies && (
              <p className={styles.stApplies}>
                {b.onchain ? (
                  <>
                    If it wins, the museum calls <code>{b.applies}</code> — and the transaction
                    goes in the ledger below.
                  </>
                ) : (
                  <>
                    If it wins, the museum applies it: <code>{b.applies}</code>. Recorded in the
                    ledger below.
                  </>
                )}
              </p>
            )}
          </article>
        );
      })}

      <p className={styles.stGuard}>
        Off the table, permanently: royalty enforcement, the renderer, the treasury, the transfer
        validator, ownership, the pauses, and any diamond cut. That is the art and the safety of
        the collection, not policy.
      </p>
    </section>
  );
}

// ── f. LEDGER — what was voted, and the tx that applied it ──────────────────────
function Ledger({ params }: { params: GovernParams }) {
  return (
    <section className={styles.section}>
      <div className={styles.stHead}>
        <h2 className={styles.stTitle}>The ledger</h2>
        <p className={styles.stLead}>Every applied result, and the transaction that applied it.</p>
      </div>
      {params.ledger.length === 0 ? (
        <p className={styles.ledEmpty}>Nothing applied yet. The first Salon writes the first line.</p>
      ) : (
        <ul className={styles.ledList}>
          {params.ledger.map((e, i) => (
            <li className={styles.ledRow} key={`${e.key}-${i}`}>
              <span className={styles.ledDate}>{e.date}</span>
              <span className={styles.ledKey}>{e.key}</span>
              <span className={styles.ledWinner}>{e.winner}</span>
              {e.souls ? <span className={styles.ledSouls}>{fmt(e.souls)} souls</span> : null}
              {e.tx ? (
                <a
                  className={styles.ledTx}
                  href={`https://etherscan.io/tx/${e.tx}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  tx ↗
                </a>
              ) : (
                <span className={styles.ledTxNone}>no tx</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── g. FINE PRINT — everything else, closed by default ──────────────────────────
function FinePrint({ params }: { params: GovernParams }) {
  return (
    <section className={styles.section}>
      <details className={styles.fine}>
        <summary className={styles.fineSummary}>The fine print</summary>
        <ul className={styles.fineList}>
          <li>Power lives in the souls, never the wallet.</li>
          <li>Only reapers open a proposal.</li>
          <li>{params.secondsRequired} more reapers must second it.</li>
          <li>Quorum {fmt(params.quorumSouls)} souls — counted in souls.</li>
          <li>Power is frozen when the ballot opens.</li>
          <li>The Order may brake {params.brakeHours}h — one re-vote.</li>
          <li>Sell the soul, the power leaves with it.</li>
        </ul>
      </details>
    </section>
  );
}
