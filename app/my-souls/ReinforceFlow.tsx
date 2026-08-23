"use client";

// REINFORCE — put souls behind your reaper, or take them back.
//
// Said plainly wherever it appears, because both halves matter:
//   • this is NOT burning — the soul is not consumed and not spent; and
//   • the soul now belongs to the REAPER, not to the wallet. While you hold the
//     reaper you can pull it out at any time, but if you sell the reaper, every
//     soul standing behind it goes with the sale.
// Getting the second half wrong would cost somebody their collection.
//
// Both directions are one transaction, using the batch courier already on the
// diamond: in, the holder calls it; out, the vault calls it on the holder's
// order. No approvals either way.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { mainnet } from "wagmi/chains";
import { parseAbi } from "viem";
import { SOULS } from "@/lib/souls";
import { ORDER_ABI } from "@/lib/order";
import VaultAssets from "./VaultAssets";
import styles from "./reinforce.module.css";

// La rejilla dibuja sellos de ~60px: pedir el arte a resolucion completa eran
// 330 KB por alma, o sea DIEZ MEGAS para treinta. De ahi los diez segundos en
// blanco la primera vez que se abria.
const IMG = (id: number) => `/api/img?id=${id}&w=160`;

const BATCH_ABI = parseAbi(["function batchTransfer(address to, uint256[] tokenIds)"]);
const ACCOUNT_ABI = parseAbi([
  "function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)",
]);
const OWNED_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

type Phase = "idle" | "wallet" | "pending" | "done";

export default function ReinforceFlow({
  reaperId,
  vault,
  eligible,
  onDone,
  onClose,
}: {
  reaperId: number;
  vault: `0x${string}`;
  eligible: number[]; // souls in the holder's wallet, free to move
  onDone: () => void;
  onClose: () => void;
}) {
  const client = usePublicClient({ chainId: 1 });
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [tab, setTab] = useState<"in" | "out" | "vault">("in");
  // La explicacion completa arranca PLEGADA: quien ya sabe lo que hace no deberia
  // leer ochenta palabras antes de poder pulsar nada.
  const [how, setHow] = useState(false);
  const [kept, setKept] = useState<number[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [cap, setCap] = useState(30); // the museum's bonus ceiling, read on chain
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  // what the vault currently holds, read by asking the chain who owns what the
  // wallet once had plus what the draw reports as kept
  useEffect(() => {
    if (!client) return;
    let stale = false;
    (async () => {
      const count = await client.readContract({
        address: SOULS,
        abi: ORDER_ABI,
        functionName: "balanceOf",
        args: [vault],
      });
      if (Number(count) === 0) {
        if (!stale) setKept([]);
        return;
      }
      // the collection has no enumeration, so scan the ids the vault could hold:
      // every id the museum knows about is 1..10000, checked in one multicall pass
      const ids: number[] = [];
      for (let start = 1; start <= 10000; start += 1000) {
        const chunk = Array.from({ length: Math.min(1000, 10001 - start) }, (_, i) => start + i);
        const res = await client.multicall({
          allowFailure: true,
          contracts: chunk.map((id) => ({
            address: SOULS,
            abi: OWNED_ABI,
            functionName: "ownerOf" as const,
            args: [BigInt(id)] as const,
          })),
        });
        chunk.forEach((id, i) => {
          if (res[i]?.status === "success" && (res[i].result as string).toLowerCase() === vault.toLowerCase()) {
            ids.push(id);
          }
        });
        if (ids.length >= Number(count)) break;
      }
      if (!stale) setKept(ids);
    })().catch(() => !stale && setKept([]));
    return () => {
      stale = true;
    };
  }, [client, vault, phase]);

  // the ceiling comes from the contract, never from a number typed here
  useEffect(() => {
    if (!client) return;
    client
      .readContract({ address: SOULS, abi: ORDER_ABI, functionName: "weightParams" })
      .then((p) => setCap(Number((p as readonly [number, number])[1])))
      .catch(() => {});
  }, [client]);

  const list = tab === "in" ? eligible : (kept ?? []);

  const toggle = useCallback((id: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => setPicked(new Set()), [tab]);

  const send = useCallback(async () => {
    if (!walletClient || !client || !address || picked.size === 0) return;
    setErr(null);
    try {
      if (chainId !== mainnet.id) await switchChainAsync({ chainId: mainnet.id });
      const ids = [...picked].sort((a, b) => a - b).map(BigInt);
      setPhase("wallet");
      let tx: `0x${string}`;
      if (tab === "in") {
        tx = await walletClient.writeContract({
          address: SOULS,
          abi: BATCH_ABI,
          functionName: "batchTransfer",
          args: [vault, ids],
        });
      } else {
        // the vault moves them back, on its holder's order
        const inner = {
          abi: BATCH_ABI,
          functionName: "batchTransfer" as const,
          args: [address as `0x${string}`, ids] as const,
        };
        const { encodeFunctionData } = await import("viem");
        tx = await walletClient.writeContract({
          address: vault,
          abi: ACCOUNT_ABI,
          functionName: "execute",
          args: [SOULS, 0n, encodeFunctionData(inner), 0],
        });
      }
      setHash(tx);
      setPhase("pending");
      await client.waitForTransactionReceipt({ hash: tx });
      setPhase("done");
      onDone();
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || "failed";
      setErr(/reject|denied/i.test(m) ? "The wallet said no — nothing moved." : m);
      setPhase("idle");
    }
  }, [walletClient, client, address, picked, chainId, switchChainAsync, tab, vault, onDone]);

  const keptCount = kept?.length ?? 0;
  // how many more still buy odds — beyond this a soul is only stored, not counted
  const roomLeft = Math.max(0, cap - keptCount);
  const useless = tab === "in" ? Math.max(0, picked.size - roomLeft) : 0;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <span className={styles.title}>
            <span className={styles.mark}>⚱</span> Vault of Soul Reaper #{reaperId}
          </span>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Una linea, y el detalle a un clic. El aviso de propiedad NO se pliega:
            es el unico que puede costarle la coleccion a alguien. */}
        <p className={styles.lead}>
          Souls kept here are <b>not burned</b> and <b>not spent</b>. Put them in, take them out, whenever
          you like.{" "}
          <button className={styles.how} onClick={() => setHow((v) => !v)} aria-expanded={how}>
            {how ? "Hide details" : "How this works"}
          </button>
        </p>
        {how ? (
          <p className={styles.leadMore}>
            Each soul in the vault adds one ticket to this reaper&apos;s odds in the draw, up to {cap}. The
            vault is a real address of its own — <b>{`${reaperId}.cubistsouls.eth`}</b> — so anyone can send
            it souls, ether or any NFT, from any wallet. Only you can take things out, and only while the
            reaper is yours.
          </p>
        ) : null}
        <p className={styles.warn}>
          <b>They belong to the reaper, not to your wallet.</b> If you ever sell or send this reaper, every
          soul in its vault goes with it. Reapers of your own are never offered here — one reaper inside
          another would vanish from your panel and travel with that sale.
        </p>

        {/* Tres puertas del mismo peso visual: meter, sacar, y lo que no son almas.
            Antes "Take back" quedaba detras de un contador y parecia secundaria. */}
        <div className={styles.tabs}>
          <button className={`${styles.tab}${tab === "in" ? ` ${styles.tabOn}` : ""}`} onClick={() => setTab("in")}>
            ↓ Put souls in
          </button>
          <button className={`${styles.tab}${tab === "out" ? ` ${styles.tabOn}` : ""}`} onClick={() => setTab("out")}>
            ↑ Take souls out{keptCount > 0 ? ` (${keptCount})` : ""}
          </button>
          <button
            className={`${styles.tab}${tab === "vault" ? ` ${styles.tabOn}` : ""}`}
            onClick={() => setTab("vault")}
          >
            Ether &amp; other
          </button>
        </div>
        <p className={styles.room} hidden={tab === "vault"}>
          {keptCount}/{cap} in the vault
          {roomLeft > 0 ? ` · ${roomLeft} more still add odds` : " · at the ceiling, more are kept but add no odds"}
        </p>

        {tab === "vault" ? (
          <VaultAssets reaperId={reaperId} vault={vault} holder={(address ?? "0x0") as `0x${string}`} onDone={onDone} />
        ) : phase === "done" ? (
          <div className={styles.done}>
            <p>
              Done.{" "}
              {hash ? (
                <a href={`https://etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">
                  Etherscan ↗
                </a>
              ) : null}
            </p>
            <button className={styles.btn} onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            {tab === "out" && kept === null ? (
              <p className={styles.dim}>Reading what is in the vault…</p>
            ) : list.length === 0 ? (
              <p className={styles.dim}>
                {tab === "in"
                  ? "No free souls in your wallet right now."
                  : "This vault is empty — there is nothing to take out yet."}
              </p>
            ) : (
              <div className={styles.grid}>
                {list.map((id) => (
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

            {useless > 0 ? (
              <p className={styles.cap}>
                Only <b>{Math.min(picked.size, roomLeft)}</b> of these will add odds — a reaper counts at most{" "}
                <b>{cap}</b> souls, and this one already counts <b>{keptCount}</b>. The other{" "}
                <b>{useless}</b> would be kept safe behind it, but change nothing in the draw.
              </p>
            ) : null}
            {err ? <p className={styles.err}>{err}</p> : null}
            <button className={styles.btn} disabled={picked.size === 0 || phase !== "idle"} onClick={send}>
              {phase === "wallet"
                ? "Confirm in wallet…"
                : phase === "pending"
                  ? "Moving…"
                  : picked.size === 0
                    ? tab === "in"
                      ? "Pick the souls to put in"
                      : "Pick the souls to take out"
                    : tab === "in"
                      ? `Put ${picked.size} soul${picked.size === 1 ? "" : "s"} in the vault`
                      : `Take ${picked.size} soul${picked.size === 1 ? "" : "s"} out`}
            </button>
            <p className={styles.fine}>
              One transaction, no approvals.{" "}
              {tab === "in"
                ? "You can take them out again at any time — while the reaper is yours."
                : "They go straight back to your wallet."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
