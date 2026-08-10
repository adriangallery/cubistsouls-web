"use client";

// THE VESSELS — the wing of the unions.
//
// Design brief (Adrian, 03-ago): read the reapers page — hero says the whole
// thing in two lines, one chip carries the rule, then straight to the panel.
// And the ritual must be UNAMBIGUOUS: nothing of the holder's is burned. The
// canvas was burned long ago, by a reaper, feeding it. The forge therefore
// leads with a plain IN → OUT ledger and closes with a preview of the exact
// token you receive, so the complex transaction reads at a glance.
//
// All gating lives on-chain (VesselFacet); this client only mirrors it.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { mainnet } from "wagmi/chains";
import { formatEther } from "viem";
import { SOULS } from "@/lib/reaper";
import { loadSouls } from "@/lib/souls";
import {
  UNION_SIZE,
  VESSEL_ABI,
  RITE_ABI,
  getVessels,
  getAvailableCanvases,
  filterEligible,
  splitVessels,
  readRites,
  type VesselEntry,
  type RiteState,
} from "@/lib/vessel";
import styles from "./vessels.module.css";

const IMG = (id: number) => `/api/img?id=${id}`;
// The death mask every Memento Mori wears, over every other layer. Rendered here
// as the museum's preview; the on-chain renderer paints the same layer.
const MASK = "/assets/traits-svg/vessel-fx/memento-mori-a.svg"; // -a: the artist's placement (renamed to bust the immutable cache)
const short = (w: string) => (w && w.length >= 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w || "—");

// canvas art + the mask on top — what a Memento Mori actually looks like
function Masked({ id, className = "" }: { id: number; className?: string }) {
  return (
    <span className={`${styles.stack} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={IMG(id)} alt={`Memento Mori #${id}`} loading="lazy" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.maskLayer} src={MASK} alt="" aria-hidden="true" loading="lazy" />
    </span>
  );
}

export default function VesselsClient() {
  const client = usePublicClient();
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  // Dev harness (development only, same convention as /my-souls?as=0x…): render
  // the forge against a real wallet's collection without connecting one.
  const [devAs, setDevAs] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const p = new URLSearchParams(window.location.search).get("as");
    if (p && /^0x[0-9a-fA-F]{40}$/.test(p)) setDevAs(p);
  }, []);
  const account = devAs ?? address;
  const connected = !!devAs || isConnected;

  // THE RESURRECTION — private preview (Adrian 10-ago): the section only exists
  // behind ?rite=1, in any environment, until the museum announces the rite.
  // Same convention as the pre-launch ?reaper=1 gate.
  const [riteFlag, setRiteFlag] = useState(false);
  useEffect(() => {
    setRiteFlag(new URLSearchParams(window.location.search).get("rite") === "1");
  }, []);

  const [vessels, setVessels] = useState<VesselEntry[] | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [eligible, setEligible] = useState<number[] | null>(null);
  const [canvases, setCanvases] = useState<number[] | null>(null);
  const [readErr, setReadErr] = useState<{ souls?: boolean; canvases?: boolean }>({});
  const [reload, setReload] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [canvas, setCanvas] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "wallet" | "pending" | "done">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // rite state (only read behind the flag)
  const [myVessels, setMyVessels] = useState<number[] | null>(null);
  const [riteFee, setRiteFee] = useState<bigint | null>(null);
  const [ritePaused, setRitePaused] = useState(false);
  const [riteOnChain, setRiteOnChain] = useState<boolean | null>(null);
  const [rites, setRites] = useState<Map<number, RiteState>>(new Map());
  const [riteBusy, setRiteBusy] = useState<number | null>(null);
  const [riteErr, setRiteErr] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    getVessels(client).then(setVessels).catch(() => setVessels([]));
    client
      .readContract({ address: SOULS, abi: VESSEL_ABI, functionName: "vesselFee" })
      .then((f) => setFee(f as bigint))
      .catch(() => {});
    getAvailableCanvases(client)
      .then((c) => {
        setCanvases(c);
        setReadErr((e) => ({ ...e, canvases: false }));
      })
      .catch(() => {
        setCanvases([]);
        setReadErr((e) => ({ ...e, canvases: true }));
      });
  }, [client, reload]);

  useEffect(() => {
    if (!client || !account) {
      setEligible(null);
      return;
    }
    let stale = false;
    (async () => {
      const data = await loadSouls(client, account);
      const ok = await filterEligible(client, data.owned);
      if (!stale) {
        setEligible(ok);
        setReadErr((e) => ({ ...e, souls: false }));
      }
    })().catch(() => {
      if (stale) return;
      setEligible([]);
      setReadErr((e) => ({ ...e, souls: true }));
    });
    return () => {
      stale = true;
    };
  }, [client, account, reload]);

  // read the keeper's vessels + their rite state (fail-soft pre-cut)
  useEffect(() => {
    if (!riteFlag || !client || !account) {
      setMyVessels(null);
      return;
    }
    let stale = false;
    (async () => {
      const data = await loadSouls(client, account);
      const { vessels: mine } = await splitVessels(client, data.owned);
      const rite = await readRites(client, mine);
      if (stale) return;
      setMyVessels(mine);
      if (rite === null) {
        setRiteOnChain(false);
      } else {
        setRiteOnChain(true);
        setRiteFee(rite.fee);
        setRitePaused(rite.paused);
        setRites(rite.states);
      }
    })().catch(() => {
      if (!stale) setMyVessels([]);
    });
    return () => {
      stale = true;
    };
  }, [riteFlag, client, account, reload]);

  const resurrect = useCallback(
    async (vesselId: number) => {
      if (!walletClient || !client || riteFee === null || riteBusy !== null) return;
      setRiteErr(null);
      setRiteBusy(vesselId);
      try {
        if (chainId !== mainnet.id) await switchChainAsync({ chainId: mainnet.id });
        const hash = await walletClient.writeContract({
          address: SOULS,
          abi: RITE_ABI,
          functionName: "resurrect",
          args: [BigInt(vesselId)],
          value: riteFee,
        });
        await client.waitForTransactionReceipt({ hash });
        setReload((n) => n + 1);
      } catch (e: unknown) {
        const m =
          (e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || "failed";
        setRiteErr(/reject|denied/i.test(m) ? "The wallet said no — nothing moved." : m);
      } finally {
        setRiteBusy(null);
      }
    },
    [walletClient, client, riteFee, riteBusy, chainId, switchChainAsync],
  );

  const toggle = useCallback((id: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < UNION_SIZE) next.add(id);
      return next;
    });
  }, []);

  // The plaque is not the founder's to write: every union is named by the museum,
  // "Memento Mori #<id>", the moment it is fused.
  const autoName = canvas !== null ? `Memento Mori #${canvas}` : "";
  const pickedList = [...picked].sort((a, b) => a - b);
  const ready = picked.size === UNION_SIZE && canvas !== null;
  const priceLabel = fee !== null ? `Ξ${formatEther(fee)}` : "…";

  const fuse = useCallback(async () => {
    if (!ready || !walletClient || !client || fee === null || canvas === null) return;
    setErr(null);
    try {
      if (chainId !== mainnet.id) await switchChainAsync({ chainId: mainnet.id });
      setPhase("wallet");
      const hash = await walletClient.writeContract({
        address: SOULS,
        abi: VESSEL_ABI,
        functionName: "fuse",
        args: [BigInt(canvas), [...picked].sort((a, b) => a - b).map(BigInt), autoName],
        value: fee,
      });
      setTxHash(hash);
      setPhase("pending");
      await client.waitForTransactionReceipt({ hash });
      setPhase("done");
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || "failed";
      setErr(/reject|denied/i.test(m) ? "The wallet said no — nothing moved." : m);
      setPhase("idle");
    }
  }, [ready, walletClient, client, fee, canvas, picked, autoName, chainId, switchChainAsync]);

  return (
    <main className={styles.wrap}>
      {/* ---------- HERO — the whole page in two lines ---------- */}
      <header className={styles.hero}>
        <span className={styles.kick}>
          <span className={styles.kickMark}>⚱</span> The unions
        </span>
        <h1 className={styles.title}>
          MEMENTO <em>MORI</em>
        </h1>
        <p className={styles.mech}>
          Lock <b>30 Souls</b> together and mint a <b>Memento Mori</b>.
        </p>
        <p className={styles.mech}>
          It wears an <b>empty canvas</b> — one a reaper burned long ago — behind the <b>death mask</b>.
        </p>
        <span className={styles.ruleChip}>
          <span className={styles.ruleMark}>⚱</span> Nothing of yours is burned
        </span>
      </header>

      {/* ---------- THE FORGE — the center of the page ---------- */}
      <section className={styles.forge} id="forge" aria-label="The forge">
        <div className={styles.secHead}>
          <span className={styles.eyebrow}>Do it here</span>
          <h2>
            THE <span className={styles.hot}>FORGE</span>
          </h2>
        </div>

        {/* THE RITUAL, drawn: thirty slots fill as you pick, and the piece you
            get takes shape on the right. Text explains; this shows. */}
        <div className={styles.ledger}>
          <div className={styles.side}>
            <span className={styles.sideLabel}>You place</span>
            <b className={styles.sideBig}>
              30 Souls <span className={styles.sideCount}>{picked.size}/30 chosen</span>
            </b>
            <div className={styles.slots} aria-hidden="true">
              {Array.from({ length: UNION_SIZE }, (_, i) => {
                const id = pickedList[i];
                return id !== undefined ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.slotFilled} key={id} src={IMG(id)} alt="" loading="lazy" />
                ) : (
                  <span className={styles.slotEmpty} key={`empty-${i}`} />
                );
              })}
            </div>
            <span className={styles.sideNote}>
              They are <b>not burned</b>. They pass into the museum&apos;s custody, bound to the piece
              forever — sell it and all thirty travel with it.
            </span>
          </div>

          <span className={styles.arrow} aria-hidden="true">
            →
          </span>

          <div className={styles.side}>
            <span className={styles.sideLabel}>You receive</span>
            <b className={styles.sideBig}>
              1 Memento Mori <span className={styles.sideCount}>a new token</span>
            </b>
            <div className={styles.outcome}>
              {canvas !== null ? (
                <Masked id={canvas} className={styles.outcomeArt} />
              ) : (
                <span className={styles.outcomeBlank}>
                  <span>⚱</span>
                  <small>choose a face below</small>
                </span>
              )}
              <span className={styles.outcomeName}>{autoName || "Memento Mori #…"}</span>
            </div>
            <span className={styles.sideNote}>
              An empty canvas brought back to the wall under the death mask — with its own on-chain
              vault. Yours to keep and sell.
            </span>
          </div>
        </div>
        <p className={styles.cost}>
          Thirty in, one out · <b>{priceLabel}</b> + gas · one transaction · no approvals · cannot be undone
        </p>

        {!connected ? (
          <div className={styles.connect}>
            <ConnectButton />
          </div>
        ) : phase === "done" ? (
          <div className={styles.done}>
            <span className={styles.doneMark}>⚱</span>
            <p className={styles.doneLead}>The communion is sealed. Your Memento Mori hangs.</p>
            {txHash ? (
              <a className={styles.doneLink} href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">
                Etherscan ↗
              </a>
            ) : null}
            <button className={styles.btn} onClick={() => window.location.reload()}>
              See it hung →
            </button>
          </div>
        ) : (
          <>
            {/* step 1 — the thirty */}
            <div className={styles.stepHead}>
              <span className={styles.stepNum}>1</span>
              <span className={styles.stepTitle}>Pick thirty of your Souls</span>
              <span className={styles.count}>
                {picked.size}/{UNION_SIZE}
              </span>
            </div>
            {eligible === null ? (
              <p className={styles.dim}>Reading your collection…</p>
            ) : readErr.souls ? (
              <p className={styles.dim}>
                Couldn&apos;t read your collection just now — the chain didn&apos;t answer.{" "}
                <button className={styles.mini} onClick={() => setReload((n) => n + 1)}>
                  try again
                </button>
              </p>
            ) : eligible.length < UNION_SIZE ? (
              <p className={styles.dim}>
                You hold <b>{eligible.length}</b> eligible soul{eligible.length === 1 ? "" : "s"} — a union needs{" "}
                {UNION_SIZE}. Souls that carry the fire, or already rest inside a Memento Mori, cannot join.
              </p>
            ) : (
              <>
                <div className={styles.tools}>
                  <button className={styles.mini} onClick={() => setPicked(new Set(eligible.slice(0, UNION_SIZE)))}>
                    pick first thirty
                  </button>
                  {picked.size > 0 ? (
                    <button className={styles.mini} onClick={() => setPicked(new Set())}>
                      clear
                    </button>
                  ) : null}
                  <span className={styles.toolNote}>{eligible.length} eligible</span>
                </div>
                <div className={styles.pickGrid}>
                  {eligible.map((id) => (
                    <button
                      key={id}
                      className={`${styles.pick}${picked.has(id) ? ` ${styles.picked}` : ""}`}
                      onClick={() => toggle(id)}
                      aria-pressed={picked.has(id)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={IMG(id)} alt={`Soul #${id}`} loading="lazy" />
                      <span className={styles.tag}>#{id}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* step 2 — the face (NOT a burn: these canvases are already gone) */}
            <div className={styles.stepHead}>
              <span className={styles.stepNum}>2</span>
              <span className={styles.stepTitle}>Choose the face it will wear</span>
              {canvas !== null ? <span className={styles.count}>#{canvas}</span> : null}
            </div>
            <p className={styles.stepLead}>
              These canvases were burned long ago, feeding a reaper — <b>not by you, and not now</b>. Nobody
              holds them and nobody ever can. Your Memento Mori brings one back to the wall, wearing the
              death mask.
            </p>
            {canvases === null ? (
              <p className={styles.dim}>Reading the empty canvases…</p>
            ) : readErr.canvases ? (
              <p className={styles.dim}>
                Couldn&apos;t read the empty canvases just now — the chain didn&apos;t answer.{" "}
                <button className={styles.mini} onClick={() => setReload((n) => n + 1)}>
                  try again
                </button>
              </p>
            ) : canvases.length === 0 ? (
              <p className={styles.dim}>Every empty canvas has been claimed.</p>
            ) : (
              <>
                <div className={styles.tools}>
                  <span className={styles.toolNote}>{canvases.length} free · first come, first served</span>
                </div>
                <div className={`${styles.pickGrid} ${styles.canvasGrid}`}>
                  {canvases.map((id) => (
                    <button
                      key={id}
                      className={`${styles.pick} ${styles.empty}${canvas === id ? ` ${styles.picked}` : ""}`}
                      onClick={() => setCanvas(canvas === id ? null : id)}
                      aria-pressed={canvas === id}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={IMG(id)} alt={`Empty canvas #${id}`} loading="lazy" />
                      <span className={styles.tag}>#{id}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {err ? <p className={styles.err}>{err}</p> : null}
            <button className={styles.btn} disabled={!ready || phase !== "idle"} onClick={fuse}>
              {phase === "wallet"
                ? "Confirm in wallet…"
                : phase === "pending"
                  ? "Fusing…"
                  : `Fuse · ${priceLabel}`}
            </button>
            <p className={styles.fine}>
              One transaction: your thirty pass into the museum&apos;s custody, the Memento Mori is minted on
              the canvas you chose, and its vault is created. The museum writes the plaque — every union is
              named <b>Memento Mori #{canvas ?? "…"}</b>. There is no dissolution: a Memento Mori is forever
              thirty.
            </p>
          </>
        )}
      </section>

      {/* ---------- THE RESURRECTION — private preview, ?rite=1 only ---------- */}
      {riteFlag ? (
        <section className={styles.wing} aria-label="The resurrection">
          <div className={styles.secHead}>
            <span className={styles.eyebrow}>The wake rite</span>
            <h2>
              THE <span className={styles.hot}>RESURRECTION</span>
            </h2>
          </div>
          <p className={styles.stepLead}>
            A Memento Mori is born <b>dormant</b>. Its keeper may wake it —{" "}
            <b>{riteFee !== null ? `Ξ${formatEther(riteFee)}` : "…"}</b> to the museum, one transaction. The
            rite belongs to you and the piece together: <b>sell it and it falls dormant again</b> — the next
            keeper must perform their own.
          </p>
          {!connected ? (
            <div className={styles.connect}>
              <ConnectButton />
            </div>
          ) : riteOnChain === false ? (
            <p className={styles.dim}>The rite is not on-chain yet.</p>
          ) : ritePaused ? (
            <p className={styles.dim}>The rite is paused.</p>
          ) : myVessels === null ? (
            <p className={styles.dim}>Reading your vessels…</p>
          ) : myVessels.length === 0 ? (
            <p className={styles.dim}>You keep no Memento Mori yet — the rite waits for a vessel.</p>
          ) : (
            <div className={styles.grid}>
              {myVessels.map((id) => {
                const st = rites.get(id);
                const awake = st?.awake ?? false;
                return (
                  <article className={styles.card} key={id}>
                    <Masked id={id} className={styles.art} />
                    <div className={styles.body}>
                      <div className={styles.name}>
                        <span className={styles.mark}>{awake ? "☥" : "⚱"}</span> Memento Mori #{id}
                      </div>
                      <div className={styles.sub}>
                        {awake ? <b>awake — the rite holds while you do</b> : <b>dormant</b>}
                        {st && st.count > 0 ? <> · resurrected {st.count}×</> : null}
                      </div>
                      {awake ? null : (
                        <button
                          className={styles.btn}
                          disabled={riteBusy !== null || riteFee === null}
                          onClick={() => resurrect(id)}
                        >
                          {riteBusy === id
                            ? "Waking…"
                            : `Resurrect · ${riteFee !== null ? `Ξ${formatEther(riteFee)}` : "…"}`}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {riteErr ? <p className={styles.err}>{riteErr}</p> : null}
        </section>
      ) : null}

      {/* ---------- THE WING — vessels already fused ---------- */}
      <section className={styles.wing} aria-label="Fused vessels">
        <div className={styles.secHead}>
          <span className={styles.eyebrow}>Communions sealed</span>
          <h2>
            THE <span className={styles.hot}>WING</span>
          </h2>
        </div>
        {vessels === null ? (
          <p className={styles.dim}>Reading the wing…</p>
        ) : vessels.length === 0 ? (
          <div className={styles.emptyPlate}>
            <span className={styles.doneMark}>⚱</span>
            <p className={styles.doneLead}>The wing awaits its first Memento Mori.</p>
            <p className={styles.dim}>Thirty souls, one vessel.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {vessels.map((v) => (
              <article className={styles.card} key={v.id}>
                <Masked id={v.id} className={styles.art} />
                <div className={styles.body}>
                  <div className={styles.name}>
                    <span className={styles.mark}>⚱</span> {v.name || `Memento Mori #${v.id}`}
                  </div>
                  <div className={styles.sub}>
                    Memento Mori <b>#{v.id}</b> · {v.members.length} souls united
                  </div>
                  <Link className={styles.holder} href={`/curator/${v.founder}`}>
                    founded by {short(v.founder)} →
                  </Link>
                  <a
                    className={styles.holder}
                    href={`https://etherscan.io/address/${v.vault}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    vault {short(v.vault)} ↗
                  </a>
                  <details className={styles.members}>
                    <summary>the thirty</summary>
                    <div className={styles.chips}>
                      {v.members.map((m) => (
                        <span className={styles.chip} key={m}>
                          #{m}
                        </span>
                      ))}
                    </div>
                  </details>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
