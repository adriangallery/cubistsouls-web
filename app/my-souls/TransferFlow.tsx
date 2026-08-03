"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { mainnet } from "wagmi/chains";
import { isAddress, getAddress, parseAbi } from "viem";
import { normalize } from "viem/ens";
import { SOULS } from "@/lib/souls";

/* ================= the transfer tool =================
   The holder tool the community asked for: pick any number of your souls and
   send them to one address in ONE transaction — no approvals, no helper
   contract, the collection itself does the moving (SoulsBatchTransferFacet).

   The whole tool is gated ON-CHAIN: it only renders once the Diamond's loupe
   routes batchTransfer. Ship the web first, sign the cut later, and the tool
   lights up on its own — nothing to coordinate.
   ===================================================== */

const BATCH_SELECTOR = "0xac3c9952" as const; // batchTransfer(address,uint256[])

const LOUPE_ABI = [
  {
    type: "function",
    name: "facetAddress",
    stateMutability: "view",
    inputs: [{ name: "_functionSelector", type: "bytes4" }],
    outputs: [{ name: "facetAddress_", type: "address" }],
  },
] as const;

const BATCH_ABI = [
  {
    type: "function",
    name: "batchTransfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenIds", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

// Both vault kinds a shipped token might carry (reverts for regular souls —
// that's the on-chain gate, and multicall allowFailure treats it as "no vault").
const VAULT_LOOKUP_ABI = parseAbi([
  "function reaperAccount(uint256 reaperId) view returns (address account, bool deployed)",
  "function vesselVault(uint256 vesselId) view returns (address vault, bool deployed)",
]);

// Souls per transaction. A batch is ~55k gas per soul; 200 keeps the heaviest
// realistic send around ~11M gas, comfortably inside a block.
const MAX_PER_TX = 200;

const ZERO = "0x0000000000000000000000000000000000000000";
const PIKKAZO = "0x6478b94dfa32f3eab600970d04b34615ee97484e";

function toast(msg: string, ms = 6000) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = msg;
  document.body.appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// DEV-ONLY harness: ?tf=1 forces the tool visible (no signer, the tx itself
// still needs a real wallet). Same philosophy as the ?as= harness — gated to
// development so it is inert in every deployed build.
function useDevForce(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (new URLSearchParams(window.location.search).get("tf") === "1") setOn(true);
  }, []);
  return on;
}

/** True once the Diamond routes batchTransfer — i.e. the cut is live on mainnet. */
export function useBatchTransferLive(): boolean {
  const client = usePublicClient();
  const [live, setLive] = useState(false);
  const forced = useDevForce();
  useEffect(() => {
    if (!client) return;
    let gone = false;
    client
      .readContract({ address: SOULS, abi: LOUPE_ABI, functionName: "facetAddress", args: [BATCH_SELECTOR] })
      .then((facet) => { if (!gone && facet !== ZERO) setLive(true); })
      .catch(() => {});
    return () => { gone = true; };
  }, [client]);
  return live || forced;
}

type Dest =
  | { state: "empty" }
  | { state: "resolving" }
  | { state: "bad"; msg: string }
  | { state: "ok"; address: `0x${string}`; ens?: string; isContract: boolean };

type TxPhase = "form" | "wallet" | "pending" | "done";

export function TransferModal({
  ids,
  holder,
  onClose,
  onDone,
}: {
  ids: number[];
  holder: string;
  onClose: () => void;
  onDone: (sent: number[]) => void;
}) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [raw, setRaw] = useState("");
  const [dest, setDest] = useState<Dest>({ state: "empty" });
  const [phase, setPhase] = useState<TxPhase>("form");
  const [label, setLabel] = useState("");
  const [lastHash, setLastHash] = useState<string | null>(null);

  // Resolve what the holder typed: checksummed 0x…, or an ENS name.
  useEffect(() => {
    const input = raw.trim();
    if (!input) { setDest({ state: "empty" }); return; }
    let gone = false;
    const finish = (d: Dest) => { if (!gone) setDest(d); };

    const inspect = async (addr: `0x${string}`, ens?: string) => {
      if (addr.toLowerCase() === holder.toLowerCase())
        return finish({ state: "bad", msg: "That's this wallet — the souls are already home." });
      if (addr === ZERO) return finish({ state: "bad", msg: "The zero address burns nothing here — refused." });
      if (addr.toLowerCase() === SOULS.toLowerCase() || addr.toLowerCase() === PIKKAZO)
        return finish({ state: "bad", msg: "That's a collection contract — souls sent there would be lost. Refused." });
      // A token sent into its OWN token-bound vault is bricked forever: the
      // batch uses transferFrom (not safe), so AccountV3's ownership-cycle
      // guard never runs. Refuse any destination that is the vault of a token
      // in this shipment (reaper vaults and vessel vaults alike).
      try {
        if (publicClient) {
          const vaults = await publicClient.multicall({
            allowFailure: true,
            contracts: ids.flatMap((id) => [
              { address: SOULS, abi: VAULT_LOOKUP_ABI, functionName: "reaperAccount" as const, args: [BigInt(id)] as const },
              { address: SOULS, abi: VAULT_LOOKUP_ABI, functionName: "vesselVault" as const, args: [BigInt(id)] as const },
            ]),
          });
          for (const r of vaults) {
            if (r.status !== "success") continue; // regular souls revert: no vault
            const vaultAddr = (r.result as readonly [string, boolean])[0];
            if (vaultAddr.toLowerCase() === addr.toLowerCase())
              return finish({
                state: "bad",
                msg: "That is this token's own vault — it would be sealed inside itself forever. Refused.",
              });
          }
        }
      } catch {}
      let isContract = false;
      try {
        const code = await publicClient?.getCode({ address: addr });
        isContract = !!code && code !== "0x";
      } catch {}
      finish({ state: "ok", address: addr, ens, isContract });
    };

    if (isAddress(input)) {
      inspect(getAddress(input));
    } else if (/^[^\s.]+\.[^\s]+$/.test(input)) {
      setDest({ state: "resolving" });
      (async () => {
        try {
          const addr = await publicClient?.getEnsAddress({ name: normalize(input) });
          if (addr) await inspect(addr, input);
          else finish({ state: "bad", msg: "That name doesn't resolve to an address." });
        } catch {
          finish({ state: "bad", msg: "That name doesn't resolve to an address." });
        }
      })();
    } else {
      setDest({ state: "bad", msg: "Paste a 0x… address or an ENS name." });
    }
    return () => { gone = true; };
  }, [raw, holder, publicClient, ids]);

  const ensureMainnet = useCallback(async () => {
    if (chainId === mainnet.id) return true;
    try {
      await switchChainAsync({ chainId: mainnet.id });
      return true;
    } catch {
      toast("Please switch your wallet to Ethereum mainnet.");
      return false;
    }
  }, [chainId, switchChainAsync]);

  const send = useCallback(async () => {
    if (dest.state !== "ok" || !walletClient || !publicClient || !ids.length) return;
    if (!(await ensureMainnet())) return;

    const sorted = ids.slice().sort((a, b) => a - b);
    const chunks: number[][] = [];
    for (let i = 0; i < sorted.length; i += MAX_PER_TX) chunks.push(sorted.slice(i, i + MAX_PER_TX));

    try {
      let hash: `0x${string}` | undefined;
      for (let c = 0; c < chunks.length; c++) {
        const part = chunks[c];
        setPhase("wallet");
        setLabel(chunks.length > 1 ? `Confirm in wallet… (${c + 1}/${chunks.length})` : "Confirm in wallet…");
        hash = await walletClient.writeContract({
          address: SOULS,
          abi: BATCH_ABI,
          functionName: "batchTransfer",
          args: [dest.address, part.map((n) => BigInt(n))],
        });
        setLastHash(hash);
        setPhase("pending");
        setLabel(
          chunks.length > 1
            ? `Moving ${part.length} souls… (batch ${c + 1}/${chunks.length})`
            : `Moving ${part.length} soul${part.length > 1 ? "s" : ""}…`,
        );
        await publicClient.waitForTransactionReceipt({ hash });
      }
      setPhase("done");
      toast(
        `🖼️ ${sorted.length} soul${sorted.length > 1 ? "s" : ""} delivered to <b>${dest.ens ?? short(dest.address)}</b>` +
          (hash ? ` · <a href="https://etherscan.io/tx/${hash}" target="_blank" rel="noopener">Etherscan</a>` : ""),
        0,
      );
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      const msg = err?.shortMessage || err?.message || "Transaction failed";
      toast(/reject|denied|user rejected/i.test(msg) ? "Nothing moved — the wallet said no." : `Failed: ${msg}`);
      setPhase("form");
      setLabel("");
    }
  }, [dest, walletClient, publicClient, ids, ensureMainnet]);

  const shown = ids.slice(0, 12);
  const more = ids.length - shown.length;
  const batches = Math.ceil(ids.length / MAX_PER_TX);

  return (
    <div className="cx-modal" onClick={(e) => { if (e.target === e.currentTarget && phase !== "pending") onClose(); }}>
      <div className="cx-card" role="dialog" aria-modal="true">
        {phase !== "pending" ? (
          <button className="cx-close" aria-label="Close" onClick={onClose}>×</button>
        ) : null}

        <div className="cx-eyebrow">The courier</div>
        <div className="cx-title">
          Send {ids.length} soul{ids.length > 1 ? "s" : ""}
        </div>

        <div className="tf-chips">
          {shown.map((id) => (
            <span className="tf-chip" key={id}>№{String(id).padStart(4, "0")}</span>
          ))}
          {more > 0 ? <span className="tf-chip more">+{more} more</span> : null}
        </div>

        {phase === "form" || phase === "wallet" ? (
          <>
            <label className="tf-label" htmlFor="tf-dest">Deliver to</label>
            <input
              id="tf-dest"
              className="tf-input"
              placeholder="0x… address or ENS name"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              disabled={phase === "wallet"}
            />
            {dest.state === "resolving" ? <p className="tf-note">Resolving name…</p> : null}
            {dest.state === "bad" ? <p className="tf-note bad">{dest.msg}</p> : null}
            {dest.state === "ok" ? (
              <>
                <p className="tf-note ok">
                  {dest.ens ? <><b>{dest.ens}</b> · </> : null}<b>{short(dest.address)}</b> ✓
                </p>
                {dest.isContract ? (
                  <p className="tf-note warn">
                    This address is a contract. The transfer asks it to acknowledge each soul and fails safely if it
                    can&apos;t receive NFTs — but make sure it&apos;s really where you want them.
                  </p>
                ) : null}
              </>
            ) : null}

            <p className="tf-fine">
              One transaction{batches > 1 ? ` per ${MAX_PER_TX} souls (${batches} in total)` : ""}, no approvals.
              Marks and consumed souls travel with each token. Museum Hours run on keeping: a soul&apos;s clock
              restarts with its new keeper.
            </p>

            <button className="cx-fire" disabled={dest.state !== "ok" || phase === "wallet"} onClick={send}>
              {phase === "wallet" ? label : `Send ${ids.length} soul${ids.length > 1 ? "s" : ""} →`}
            </button>
          </>
        ) : null}

        {phase === "pending" ? (
          <div className="cx-oven">
            <div className="flames">✉ ✉ ✉</div>
            {label}
            {lastHash ? (
              <>
                <br />
                <a href={`https://etherscan.io/tx/${lastHash}`} target="_blank" rel="noopener noreferrer">
                  watch it on Etherscan →
                </a>
              </>
            ) : null}
          </div>
        ) : null}

        {phase === "done" ? (
          <>
            <div className="cx-copy">
              Delivered. {dest.state === "ok" ? (
                <>The souls now hang with <b>{dest.ens ?? short(dest.address)}</b>.</>
              ) : null}
            </div>
            <div className="cx-actions">
              {lastHash ? (
                <a href={`https://etherscan.io/tx/${lastHash}`} target="_blank" rel="noopener noreferrer">Proof</a>
              ) : null}
              <button className="cx-fire" style={{ maxWidth: 220 }} onClick={() => onDone(ids)}>Done</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Small helper: the connected signer really is the wallet on display. */
export function useCanTransfer(pageAddress: string): boolean {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const forced = useDevForce();
  return forced || (!!address && !!walletClient && address.toLowerCase() === pageAddress.toLowerCase());
}
