"use client";

// THE VESSELS — gallery of fused unions + THE FORGE (fuse 30 of your souls
// into a sacrificed canvas of your choosing).
//
// Everything gating lives on-chain (VesselFacet): this client only mirrors it.
// The forge is a 3-step ritual: pick 30 souls -> choose the canvas -> name it.
// One transaction: fuse{value: rite fee}. The members pass into the museum's
// custody — permanently (no dissolution, by design). The vessel's 6551 vault is
// created inside the same tx.

import { useCallback, useEffect, useMemo, useState } from "react";
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
  getVessels,
  getAvailableCanvases,
  filterEligible,
  type VesselEntry,
} from "@/lib/vessel";
import styles from "./vessels.module.css";

const IMG = (id: number) => `/api/img?id=${id}`;
const short = (w: string) => (w && w.length >= 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w || "—");

export default function VesselsClient() {
  const client = usePublicClient();
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  // ---- the gallery -----------------------------------------------------------
  const [vessels, setVessels] = useState<VesselEntry[] | null>(null);
  useEffect(() => {
    if (!client) return;
    getVessels(client).then(setVessels).catch(() => setVessels([]));
  }, [client]);

  // ---- the forge -------------------------------------------------------------
  const [fee, setFee] = useState<bigint | null>(null);
  const [eligible, setEligible] = useState<number[] | null>(null);
  const [canvases, setCanvases] = useState<number[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [canvas, setCanvas] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<"idle" | "wallet" | "pending" | "done">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    client
      .readContract({ address: SOULS, abi: VESSEL_ABI, functionName: "vesselFee" })
      .then((f) => setFee(f as bigint))
      .catch(() => {});
    getAvailableCanvases(client).then(setCanvases).catch(() => setCanvases([]));
  }, [client]);

  useEffect(() => {
    if (!client || !address) {
      setEligible(null);
      return;
    }
    let stale = false;
    (async () => {
      const data = await loadSouls(client, address);
      const ok = await filterEligible(client, data.owned);
      if (!stale) setEligible(ok);
    })().catch(() => !stale && setEligible([]));
    return () => {
      stale = true;
    };
  }, [client, address]);

  const toggle = useCallback((id: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < UNION_SIZE) next.add(id);
      return next;
    });
  }, []);

  const autofill = useCallback(() => {
    if (!eligible) return;
    setPicked(new Set(eligible.slice(0, UNION_SIZE)));
  }, [eligible]);

  const ready =
    picked.size === UNION_SIZE && canvas !== null && name.trim().length > 0 && name.trim().length <= 64;

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
        args: [BigInt(canvas), [...picked].sort((a, b) => a - b).map(BigInt), name.trim()],
        value: fee,
      });
      setTxHash(hash);
      setPhase("pending");
      await client.waitForTransactionReceipt({ hash });
      setPhase("done");
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || "failed";
      setErr(/reject|denied/i.test(m) ? "The wallet said no — nothing fused." : m);
      setPhase("idle");
    }
  }, [ready, walletClient, client, fee, canvas, picked, name, chainId, switchChainAsync]);

  return (
    <main className={styles.wrap}>
      <header className={styles.head}>
        <p className={styles.kick}>The wing of the unions</p>
        <h1 className={styles.title}>The Vessels</h1>
        <p className={styles.lead}>
          Thirty souls join forces and pour themselves into a canvas that once fed a reaper. The
          sacrificed canvas hangs again — not as a soul, but as a vessel of communion. Its thirty
          rest in the museum&apos;s custody and travel with the vessel, wherever it hangs.
        </p>
      </header>

      {/* ------------------------------------------------ the gallery */}
      <section aria-label="Fused vessels">
        {vessels === null ? (
          <p className={styles.dim}>Reading the wing…</p>
        ) : vessels.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyMark}>⚱</span>
            <p className={styles.emptyLead}>The wing awaits its first communion.</p>
            <p className={styles.emptySub}>Thirty souls, one vessel. The forge is below.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {vessels.map((v) => (
              <article className={styles.card} key={v.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.art} src={IMG(v.id)} alt={`Vessel #${v.id}`} loading="lazy" />
                <div className={styles.body}>
                  <div className={styles.name}>
                    <span className={styles.mark}>⚱</span> {v.name || `Vessel #${v.id}`}
                  </div>
                  <div className={styles.sub}>
                    Vessel <b>#{v.id}</b> · {v.members.length} souls united
                  </div>
                  <Link className={styles.holder} href={`/curator/${v.founder}`}>
                    founded by {short(v.founder)} →
                  </Link>
                  <a
                    className={styles.vault}
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

      {/* ------------------------------------------------ the forge */}
      <section className={styles.forge} id="forge" aria-label="The forge">
        <h2 className={styles.forgeTitle}>The Forge</h2>
        <p className={styles.forgeLead}>
          Exactly thirty of your souls — none that carry the fire — fused in one transaction.
          The rite costs {fee !== null ? `Ξ${formatEther(fee)}` : "…"} and cannot be undone: there
          is no dissolution. The thirty pass into the museum&apos;s custody, forever bound to the
          vessel.
        </p>

        {!isConnected ? (
          <div className={styles.connect}>
            <ConnectButton />
          </div>
        ) : phase === "done" ? (
          <div className={styles.done}>
            <span className={styles.emptyMark}>⚱</span>
            <p>
              The communion is sealed.{" "}
              {txHash ? (
                <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">
                  Etherscan ↗
                </a>
              ) : null}
            </p>
            <button className={styles.btn} onClick={() => window.location.reload()}>
              See it hung →
            </button>
          </div>
        ) : (
          <>
            {/* step 1 — the thirty */}
            <div className={styles.stepHead}>
              <span className={styles.stepNum}>1</span> Choose the thirty
              <span className={styles.count}>
                {picked.size}/{UNION_SIZE}
              </span>
              {eligible && eligible.length >= UNION_SIZE ? (
                <button className={styles.mini} onClick={autofill}>
                  first thirty
                </button>
              ) : null}
            </div>
            {eligible === null ? (
              <p className={styles.dim}>Reading your collection…</p>
            ) : eligible.length < UNION_SIZE ? (
              <p className={styles.dim}>
                {eligible.length} eligible soul{eligible.length === 1 ? "" : "s"} — a union needs{" "}
                {UNION_SIZE}. Souls that carry the fire, or already rest in a vessel, cannot join.
              </p>
            ) : (
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
                    <span>#{id}</span>
                  </button>
                ))}
              </div>
            )}

            {/* step 2 — the canvas */}
            <div className={styles.stepHead}>
              <span className={styles.stepNum}>2</span> Choose the sacrificed canvas
              {canvas !== null ? <span className={styles.count}>#{canvas}</span> : null}
            </div>
            {canvases === null ? (
              <p className={styles.dim}>Reading the consumed…</p>
            ) : canvases.length === 0 ? (
              <p className={styles.dim}>No sacrificed canvas is free right now.</p>
            ) : (
              <div className={styles.pickGrid}>
                {canvases.map((id) => (
                  <button
                    key={id}
                    className={`${styles.pick}${canvas === id ? ` ${styles.picked}` : ""}`}
                    onClick={() => setCanvas(canvas === id ? null : id)}
                    aria-pressed={canvas === id}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={IMG(id)} alt={`Canvas #${id}`} loading="lazy" />
                    <span>#{id}</span>
                  </button>
                ))}
              </div>
            )}

            {/* step 3 — the plaque */}
            <div className={styles.stepHead}>
              <span className={styles.stepNum}>3</span> Name the vessel
            </div>
            <input
              className={styles.nameInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              placeholder="The plaque on the wall — on-chain, renamable by the holder"
            />

            {err ? <p className={styles.err}>{err}</p> : null}
            <button className={styles.btn} disabled={!ready || phase !== "idle"} onClick={fuse}>
              {phase === "wallet"
                ? "Confirm in wallet…"
                : phase === "pending"
                  ? "Fusing…"
                  : `Fuse the thirty${fee !== null ? ` · Ξ${formatEther(fee)}` : ""}`}
            </button>
            <p className={styles.fine}>
              One transaction: the thirty pass into custody, the vessel is minted over your chosen
              canvas, and its vault is created — on your gas. No approvals, no dissolution.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
