"use client";

// THE VAULT — what a reaper carries beyond souls, and how to take it out.
//
// The account is a plain address: anyone can send it ETH, an NFT from any
// collection, a token. Getting things OUT is the part that needs a hand — it
// takes an `execute` call that only the reaper's holder can make, with the
// inner call encoded. This does that encoding.
//
// Two doors, on purpose:
//   • ETH, which is what the draw pays and therefore what will actually be in
//     there almost every time — one button, no typing;
//   • and a manual rescue for anything else. We do not index other collections,
//     so instead of pretending we can find their assets, we give holders the
//     tool to pull out anything they know is there. Nothing can get stranded.

import { useCallback, useEffect, useState } from "react";
import { useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { mainnet } from "wagmi/chains";
import { encodeFunctionData, formatEther, parseEther, isAddress, getAddress, parseAbi } from "viem";
import { ensNameOf } from "@/lib/reaper";
import { rhBalance } from "@/lib/ground";
import styles from "./reinforce.module.css";

const ACCOUNT_ABI = parseAbi([
  "function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)",
]);
const ERC721_ABI = parseAbi(["function transferFrom(address from, address to, uint256 tokenId)"]);
const ERC1155_ABI = parseAbi([
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
]);
const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
]);

type Kind = "erc721" | "erc1155" | "erc20";
type Phase = "idle" | "wallet" | "pending" | "done";

export default function VaultAssets({
  reaperId,
  vault,
  holder,
  onDone,
}: {
  reaperId: number;
  vault: `0x${string}`;
  holder: `0x${string}`;
  onDone?: () => void;
}) {
  const client = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [eth, setEth] = useState<bigint | null>(null);
  /// The same vault, on Robinhood Chain — where the ground dividend is paid.
  const [groundEth, setGroundEth] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<Kind>("erc721");
  const [contract, setContract] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [qty, setQty] = useState("");
  const [probe, setProbe] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stale = false;
    rhBalance(vault)
      .then((b) => !stale && setGroundEth(b))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [vault]);

  useEffect(() => {
    if (!client) return;
    client
      .getBalance({ address: vault })
      .then((b) => {
        setEth(b);
        setAmount(b > 0n ? formatEther(b) : "");
      })
      .catch(() => setEth(0n));
  }, [client, vault, phase]);

  // when a contract is pasted, say what the vault actually holds there — so the
  // holder is not typing into the dark
  useEffect(() => {
    setProbe(null);
    if (!client || !isAddress(contract)) return;
    let stale = false;
    (async () => {
      const addr = getAddress(contract);
      if (kind === "erc20") {
        const [bal, dec, sym] = await Promise.all([
          client.readContract({ address: addr, abi: ERC20_ABI, functionName: "balanceOf", args: [vault] }),
          client.readContract({ address: addr, abi: ERC20_ABI, functionName: "decimals" }).catch(() => 18),
          client.readContract({ address: addr, abi: ERC20_ABI, functionName: "symbol" }).catch(() => "tokens"),
        ]);
        const d = Number(dec);
        const human = Number(bal as bigint) / 10 ** d;
        if (!stale) setProbe(`vault holds ${human.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${sym}`);
      } else if (kind === "erc721" && tokenId.trim()) {
        const owner = await client.readContract({
          address: addr,
          abi: parseAbi(["function ownerOf(uint256) view returns (address)"]),
          functionName: "ownerOf",
          args: [BigInt(tokenId)],
        });
        if (!stale) {
          setProbe(
            (owner as string).toLowerCase() === vault.toLowerCase()
              ? "this reaper holds that token ✓"
              : "that token is NOT in this vault",
          );
        }
      }
    })().catch(() => !stale && setProbe(null));
    return () => {
      stale = true;
    };
  }, [client, contract, kind, tokenId, vault]);

  const run = useCallback(
    async (to: `0x${string}`, value: bigint, data: `0x${string}`) => {
      if (!walletClient || !client) return;
      setErr(null);
      try {
        if (chainId !== mainnet.id) await switchChainAsync({ chainId: mainnet.id });
        setPhase("wallet");
        const tx = await walletClient.writeContract({
          address: vault,
          abi: ACCOUNT_ABI,
          functionName: "execute",
          args: [to, value, data, 0],
        });
        setHash(tx);
        setPhase("pending");
        await client.waitForTransactionReceipt({ hash: tx });
        setPhase("done");
        onDone?.();
        setTimeout(() => setPhase("idle"), 400);
      } catch (e: unknown) {
        const m =
          (e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || "failed";
        setErr(/reject|denied/i.test(m) ? "The wallet said no — nothing moved." : m);
        setPhase("idle");
      }
    },
    [walletClient, client, chainId, switchChainAsync, vault, onDone],
  );

  const withdrawEth = useCallback(() => {
    let wei: bigint;
    try {
      wei = parseEther(amount || "0");
    } catch {
      setErr("That is not an amount.");
      return;
    }
    if (wei <= 0n || (eth !== null && wei > eth)) {
      setErr("More than the vault holds.");
      return;
    }
    run(holder, wei, "0x");
  }, [amount, eth, holder, run]);

  const rescue = useCallback(() => {
    if (!isAddress(contract)) {
      setErr("Paste a valid contract address.");
      return;
    }
    const addr = getAddress(contract);
    try {
      if (kind === "erc721") {
        const data = encodeFunctionData({
          abi: ERC721_ABI,
          functionName: "transferFrom",
          args: [vault, holder, BigInt(tokenId)],
        });
        run(addr, 0n, data);
      } else if (kind === "erc1155") {
        const data = encodeFunctionData({
          abi: ERC1155_ABI,
          functionName: "safeTransferFrom",
          args: [vault, holder, BigInt(tokenId), BigInt(qty || "1"), "0x"],
        });
        run(addr, 0n, data);
      } else {
        const data = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [holder, BigInt(qty)],
        });
        run(addr, 0n, data);
      }
    } catch {
      setErr("Check the id and the amount.");
    }
  }, [contract, kind, tokenId, qty, vault, holder, run]);

  const busy = phase === "wallet" || phase === "pending";

  return (
    <div className={styles.vaultTab}>
      <p className={styles.lead}>
        Besides souls, this vault can hold ether and NFTs from any collection. Anyone can send to it;
        only you can take things out, and only while the reaper is yours.
      </p>

      {/* THE NAME. This is the half a holder actually needs to hand out, so it
          is the thing set in type rather than a 42-character address. */}
      <div className={styles.ensRow}>
        <span className={styles.ensLabel}>Send to</span>
        <button
          className={styles.ensName}
          onClick={() => {
            navigator.clipboard?.writeText(ensNameOf(reaperId));
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          title="Copy this name"
        >
          {copied ? "copied ✓" : ensNameOf(reaperId)}
        </button>
      </div>
      <p className={styles.fine}>
        A real ENS name for this vault — paste it into any wallet instead of the address. Nothing was
        registered for it: the museum&apos;s resolver works it out from the chain, so every reaper has had
        one since the moment it ascended.
      </p>

      {/* ETH — what the draw pays, and what will be in here most of the time */}
      <div className={styles.assetRow}>
        <div>
          <span className={styles.assetLabel}>Ether held</span>
          <b className={styles.assetValue}>{eth === null ? "…" : `Ξ${formatEther(eth)}`}</b>
        </div>
        <div className={styles.assetActions}>
          <input
            className={styles.small}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            inputMode="decimal"
          />
          <button className={styles.mini} onClick={() => eth && setAmount(formatEther(eth))}>
            all
          </button>
          <button className={styles.btnSmall} disabled={busy || !eth || eth === 0n} onClick={withdrawEth}>
            Withdraw
          </button>
        </div>
      </div>

      {/* THE SAME VAULT, ON THE OTHER CHAIN. A 6551 account is keyed on its
          token's chain, not its own, so this vault has one address on Ethereum
          AND on Robinhood Chain — and the ground dividend is paid there. Showing
          only the Ethereum side made a holder who had just been paid conclude
          the money never arrived. */}
      {groundEth !== null && groundEth > 0n && (
        <div className={styles.assetRow}>
          <div>
            <span className={styles.assetLabel}>Held on Robinhood Chain</span>
            <b className={styles.assetValue} style={{ color: "#c8a05a" }}>Ξ{formatEther(groundEth)}</b>
          </div>
          <div className={styles.assetActions}>
            <a
              className={styles.mini}
              href={`https://explorer.mainnet.chain.robinhood.com/address/${vault}`}
              target="_blank"
              rel="noreferrer"
            >
              view ↗
            </a>
          </div>
        </div>
      )}
      {groundEth !== null && groundEth > 0n && (
        <p className={styles.fine}>
          This is the ground dividend. It is <b>in the vault</b>, at the very same address — so it travels with
          the reaper if it sells, exactly like the souls behind it. Taking it out is not wired up yet: the vault
          is driven from Ethereum, so a withdrawal has to be sent across as a message from the mainnet side.
          Nothing is stranded and nobody else can touch it.
        </p>
      )}

      {/* anything else — we do not index other collections, so we hand over the key */}
      <div className={styles.rescue}>
        <span className={styles.assetLabel}>Anything else in here</span>
        <p className={styles.fine}>
          We do not index other collections, so nothing is listed here automatically. If you know something is
          in this vault, take it out with its contract address — nothing can get stranded.
        </p>
        <div className={styles.kinds}>
          {(["erc721", "erc1155", "erc20"] as Kind[]).map((k) => (
            <button
              key={k}
              className={`${styles.tab}${kind === k ? ` ${styles.tabOn}` : ""}`}
              onClick={() => setKind(k)}
            >
              {k === "erc721" ? "NFT" : k === "erc1155" ? "Edition" : "Token"}
            </button>
          ))}
        </div>
        <input
          className={styles.nameInput}
          value={contract}
          onChange={(e) => setContract(e.target.value)}
          placeholder="Contract address (0x…)"
          spellCheck={false}
        />
        <div className={styles.pair}>
          {kind !== "erc20" ? (
            <input
              className={styles.small}
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
              placeholder="Token id"
              inputMode="numeric"
            />
          ) : null}
          {kind !== "erc721" ? (
            <input
              className={styles.small}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={kind === "erc20" ? "Amount (raw units)" : "How many"}
              inputMode="numeric"
            />
          ) : null}
          <button className={styles.btnSmall} disabled={busy} onClick={rescue}>
            Take it out
          </button>
        </div>
        {probe ? <p className={styles.probe}>{probe}</p> : null}
      </div>

      {err ? <p className={styles.err}>{err}</p> : null}
      {busy ? <p className={styles.dim}>{phase === "wallet" ? "Confirm in wallet…" : "Moving…"}</p> : null}
      {hash && phase === "idle" ? (
        <p className={styles.dim}>
          Done ·{" "}
          <a href={`https://etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">
            Etherscan ↗
          </a>
        </p>
      ) : null}

      <p className={styles.warnSmall}>
        Everything in this vault — ether included — travels with the reaper if you sell or send it.
      </p>
    </div>
  );
}
