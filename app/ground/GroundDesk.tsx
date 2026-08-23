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
  GROUND_RELAY,
  GROUND_CHAIN_ID,
  GROUND_EXPLORER,
  GROUND_ABI,
  RELAY_ABI,
  RELAY_GAS_LIMIT,
  RELAY_MAX_FEE_PER_GAS,
  GROUND_THRESHOLD,
  readPot,
  readRoster,
  readState,
  readingInFlight,
  fmtAsset,
  type PotAsset,
  type RosterEntry,
  type GroundState,
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
  const [gstate, setGstate] = useState<GroundState | null>(null);
  const [inFlight, setInFlight] = useState<{ sentAt: number } | null>(null);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [onChainSouls, setOnChainSouls] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const live = /^0x[0-9a-fA-F]{40}$/.test(GROUND_ROUTER);

  const refresh = useCallback(async () => {
    if (!live) return;
    const [p, r, st] = await Promise.all([
      readPot(GROUND_ROUTER),
      readRoster(GROUND_ROUTER),
      readState(GROUND_ROUTER),
    ]);
    setPot(p);
    setRoster(r);
    setGstate(st);
    // a reading newer than the router's, still crossing the bridge
    if (st) readingInFlight(Math.floor(st.expiresAt - 30 * 60)).then(setInFlight).catch(() => {});
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
        // Only record counts we actually READ. A failed read used to land here
        // as a zero and get compared against the posted roster, which reported
        // drift on a roster that was exactly right.
        const out: Record<number, number> = {};
        v.forEach((vault, id) => {
          if (vault.keptKnown) out[id] = vault.kept;
        });
        setOnChainSouls(out);
      })
      .catch(() => {});
  }, [roster, mainnetClient]);

  const eligible = (roster ?? []).filter((r) => r.souls >= GROUND_THRESHOLD);
  const stale = (roster ?? []).filter(
    (r) => onChainSouls[r.reaperId] !== undefined && onChainSouls[r.reaperId] !== r.souls,
  );

  /// PHASE ONE — read Ethereum and send it across. Runs on MAINNET: the relay
  /// lives where the truth lives. Whoever wants the split pays for it.
  async function refreshRoster() {
    if (chainId !== 1) {
      switchChain?.({ chainId: 1 });
      return;
    }
    setNote(null);
    setBusy("relay");
    try {
      const quoted = await mainnetClient!.readContract({
        address: GROUND_RELAY,
        abi: RELAY_ABI,
        functionName: "quote",
        args: [RELAY_GAS_LIMIT, RELAY_MAX_FEE_PER_GAS],
      });
      const hash = await writeContractAsync({
        address: GROUND_RELAY,
        abi: RELAY_ABI,
        functionName: "relay",
        args: [RELAY_GAS_LIMIT, RELAY_MAX_FEE_PER_GAS],
        value: (quoted[0] * 11n) / 10n, // headroom; the relay refunds the excess
        chainId: 1,
      });
      setNote(
        `Reading sent. ${hash.slice(0, 10)}… — the numbers cross in five to ten minutes; this page refreshes itself.`,
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setNote(/User rejected|denied/i.test(m) ? "Cancelled." : m.split("\n")[0].slice(0, 160));
    } finally {
      setBusy(null);
    }
  }

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
          : /RosterStale/.test(m)
            ? "The reading went stale while you looked — read Ethereum again (step 1)."
            : /NothingToSplit/.test(m)
              ? "Nothing in the pot to split."
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
        Everything here is split <b>equally between reapers holding {GROUND_THRESHOLD} souls or more</b> —
        checked against Ethereum <b>at the moment of the split</b>. One button does it all:{" "}
        <b>Read &amp; split</b> has a contract on Ethereum read the vaults and send the counts across, and{" "}
        <b>the split happens the instant they land</b>, five to ten minutes later, in the same transaction.
        Nobody posts anything and nobody is trusted — and nobody has to come back at the right moment.
      </div>

      {/* THE CLOCK — everything below obeys it */}
      {gstate && (
        <div className={styles.freshness} data-fresh={gstate.fresh}>
          {gstate.fresh ? (
            <>
              Reading is <b>{Math.round(gstate.age / 60)} min</b> old — splits allowed for another{" "}
              <b>{Math.max(0, Math.round((gstate.expiresAt - Date.now() / 1000) / 60))} min</b> ·{" "}
              {gstate.eligible} earthed
            </>
          ) : inFlight ? (
            <>
              A reading left Ethereum <b>{Math.max(0, Math.round((Date.now() / 1000 - inFlight.sentAt) / 60))} min
              ago</b> and is crossing the bridge. When it lands — five to ten minutes — <b>the split happens
              by itself</b> in the same transaction, and this page refreshes. Nothing else to press.
            </>
          ) : (
            <>
              The reading is <b>stale</b>
              {gstate.age < 86400 * 300 ? ` (${Math.round(gstate.age / 60)} min old)` : ""} — and that is
              fine: one press reads Ethereum and splits whatever is waiting, on landing.{" "}
              <button className={styles.relayBtn} disabled={busy !== null} onClick={refreshRoster}>
                {busy === "relay" ? "…" : chainId !== 1 ? "Switch to Ethereum" : "Read & split (~$0.30)"}
              </button>
            </>
          )}
        </div>
      )}

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
                disabled={empty || eligible.length === 0 || isPending || busy !== null || !gstate?.fresh}
                onClick={() => press(a)}
                title={!gstate?.fresh ? "The reading is stale — read Ethereum first (step 1 above)." : undefined}
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
          read from Ethereum by the relay · shown next to Ethereum live
        </span>
      </div>

      {stale.length > 0 && (
        <p className={styles.stale}>
          ⚠ {stale.length} {stale.length === 1 ? "entry has" : "entries have"} moved on Ethereum since the
          last reading. Step 1 picks that up.
        </p>
      )}

      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Reaper</th>
              <th>Last reading</th>
              <th>On Ethereum</th>
              <th>Paid to holder</th>
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
        Paid to whoever holds the reaper, at the same address they use on Ethereum. We tried paying the
        reaper&apos;s vault instead — it has the very same address on this chain, and the dividend would have
        travelled with a sale — but the only way to spend from there is a message sent across from Ethereum,
        and we are not shipping revenue on a path we have not watched work. It stays a parameter. Router:{" "}
        <a href={`${GROUND_EXPLORER}/address/${GROUND_ROUTER}`} target="_blank" rel="noreferrer">
          {short(GROUND_ROUTER)} ↗
        </a>
      </p>
    </div>
  );
}
