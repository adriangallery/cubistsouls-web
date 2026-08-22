"use client";

// THE GROUND — the dividend desk.
//
// The point of the page is that the button is not ours. `distribute()` takes no
// arguments, picks no recipient and sets no amount: it pays every earthed reaper
// on the posted roster, equally, and anyone at all can be the one to press it.
// So the page shows exactly what pressing it would do, before it is pressed.
//
// It also shows the roster next to what Ethereum says right now, because the
// roster is the one trusted input in the design and a page that hid the
// comparison would be hiding the only thing worth checking.

import { useEffect, useState, useCallback } from "react";
import { useAccount, useChainId, useSwitchChain, useWriteContract, usePublicClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  GROUND_ROUTER,
  GROUND_CHAIN_ID,
  GROUND_EXPLORER,
  GROUND_ABI,
  GROUND_THRESHOLD,
  readPot,
  readRoster,
  fmtAsset,
  type PotAsset,
  type RosterEntry,
} from "@/lib/ground";
import { getReaperVaults } from "@/lib/reaper";
import styles from "./ground.module.css";

const short = (a: string) => (a && a.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "—");

export default function GroundDesk() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const mainnetClient = usePublicClient({ chainId: 1 });

  const [pot, setPot] = useState<PotAsset[] | null>(null);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [onChainSouls, setOnChainSouls] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const live = /^0x[0-9a-fA-F]{40}$/.test(GROUND_ROUTER);

  const refresh = useCallback(async () => {
    if (!live) return;
    const [p, r] = await Promise.all([readPot(GROUND_ROUTER), readRoster(GROUND_ROUTER)]);
    setPot(p);
    setRoster(r);
  }, [live]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  // What Ethereum says, so the posted roster can be checked rather than trusted.
  useEffect(() => {
    if (!roster || !mainnetClient) return;
    getReaperVaults(
      mainnetClient,
      roster.map((r) => r.reaperId),
    )
      .then((v) => {
        const out: Record<number, number> = {};
        v.forEach((vault, id) => (out[id] = vault.kept ?? 0));
        setOnChainSouls(out);
      })
      .catch(() => {});
  }, [roster, mainnetClient]);

  const eligible = (roster ?? []).filter((r) => r.souls >= GROUND_THRESHOLD);
  const stale = (roster ?? []).filter(
    (r) => onChainSouls[r.reaperId] !== undefined && onChainSouls[r.reaperId] !== r.souls,
  );

  async function press(asset: PotAsset) {
    if (chainId !== GROUND_CHAIN_ID) {
      switchChain?.({ chainId: GROUND_CHAIN_ID });
      return;
    }
    setNote(null);
    setBusy(asset.symbol);
    try {
      const hash = await writeContractAsync(
        asset.address
          ? {
              address: GROUND_ROUTER,
              abi: GROUND_ABI,
              functionName: "distributeToken",
              args: [asset.address],
              chainId: GROUND_CHAIN_ID,
            }
          : {
              address: GROUND_ROUTER,
              abi: GROUND_ABI,
              functionName: "distribute",
              chainId: GROUND_CHAIN_ID,
            },
      );
      setNote(`Sent. ${hash.slice(0, 10)}…`);
      setTimeout(refresh, 4000);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setNote(
        /NoneEligible/.test(m)
          ? "Nobody is earthed on the posted roster, so there is nothing to split."
          : /BelowMinimum/.test(m)
            ? "The pot is below the minimum a call is allowed to split."
            : /TooSoon/.test(m)
              ? "Too soon since the last distribution."
              : /User rejected|denied/i.test(m)
                ? "Cancelled."
                : m.split("\n")[0].slice(0, 160),
      );
    } finally {
      setBusy(null);
    }
  }

  if (!live) {
    return (
      <div className={styles.wrap}>
        <p className={styles.dim}>
          The router is not deployed yet. When it is, this page reads it directly from Robinhood Chain.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.rule}>
        <span className={styles.mark}>🜃</span>
        Everything here is split <b>equally between reapers holding {GROUND_THRESHOLD} souls or more</b>. The
        button is not ours — <b>anyone can press it</b>, and it can only do this one thing.
      </div>

      {/* THE POT — one row per asset, because a marketplace settles in whatever it likes */}
      <div className={styles.pot}>
        {(pot ?? []).map((a) => {
          const share = eligible.length ? a.balance / BigInt(eligible.length) : 0n;
          const empty = a.balance === 0n;
          return (
            <div className={styles.asset} key={a.symbol}>
              <div className={styles.assetHead}>
                <span className={styles.assetSym}>{a.symbol}</span>
                <b className={styles.assetAmt}>{fmtAsset(a.balance, a.decimals, "")}</b>
              </div>
              <div className={styles.assetSplit}>
                {empty
                  ? "nothing waiting"
                  : eligible.length === 0
                    ? "nobody earthed to receive it"
                    : `${fmtAsset(share, a.decimals, a.symbol)} each, to ${eligible.length}`}
              </div>
              <button
                className={styles.go}
                disabled={empty || eligible.length === 0 || isPending || busy !== null}
                onClick={() => press(a)}
              >
                {busy === a.symbol
                  ? "…"
                  : chainId !== GROUND_CHAIN_ID
                    ? "Switch network"
                    : `Distribute ${a.symbol}`}
              </button>
            </div>
          );
        })}
        {pot === null && <p className={styles.dim}>Reading the pot…</p>}
      </div>

      {!isConnected && (
        <div className={styles.connect}>
          <ConnectButton showBalance={false} />
        </div>
      )}
      {note && <p className={styles.note}>{note}</p>}

      {/* THE ROSTER — posted here, checked against Ethereum */}
      <div className={styles.rosterHead}>
        <span className={styles.rosterTitle}>The roster</span>
        <span className={styles.rosterSub}>
          posted on Robinhood Chain · checked against Ethereum live
        </span>
      </div>

      {stale.length > 0 && (
        <p className={styles.stale}>
          ⚠ {stale.length} {stale.length === 1 ? "entry has" : "entries have"} drifted from what Ethereum says.
          The posted roster is what pays until it is reposted.
        </p>
      )}

      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Reaper</th>
              <th>Posted</th>
              <th>On Ethereum</th>
              <th>Pays to</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(roster ?? []).map((r) => {
              const chain = onChainSouls[r.reaperId];
              const drift = chain !== undefined && chain !== r.souls;
              const ok = r.souls >= GROUND_THRESHOLD;
              return (
                <tr key={r.reaperId} className={ok ? styles.rowOk : undefined}>
                  <td className={styles.id}>#{r.reaperId}</td>
                  <td className={styles.num}>{r.souls}</td>
                  <td className={`${styles.num} ${drift ? styles.drift : ""}`}>{chain ?? "—"}</td>
                  <td className={styles.addr}>
                    <a href={`${GROUND_EXPLORER}/address/${r.payout}`} target="_blank" rel="noreferrer">
                      {short(r.payout)} ↗
                    </a>
                  </td>
                  <td className={styles.flag}>{ok ? <span className={styles.earthed}>earthed</span> : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {roster === null && <p className={styles.dim}>Reading the roster…</p>}

      <p className={styles.foot}>
        A reaper is paid into its own vault&apos;s address on this chain — the same address the vault has on
        Ethereum, because a 6551 account is keyed on its token&apos;s chain, not its own. Router:{" "}
        <a href={`${GROUND_EXPLORER}/address/${GROUND_ROUTER}`} target="_blank" rel="noreferrer">
          {short(GROUND_ROUTER)} ↗
        </a>
      </p>
    </div>
  );
}
