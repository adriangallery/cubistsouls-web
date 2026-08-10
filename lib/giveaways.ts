// Collab giveaways — the museum lends its wall to friends.
//
// This is NOT /raffles. The raffles are the on-chain occasions (RaffleFacet,
// tickets earned by burning); a GIVEAWAY is an off-chain whitelist draw that a
// collab manager runs for a partner collection — "50 WL spots for X's mint".
// Alphabot / Atlas3 territory. The prize leaves the museum, so nothing here
// touches the diamond: the entry list is wallets, the draw is a seeded shuffle,
// and the seed is published so a list + seed always re-derives the same winners.
//
// Storage (Upstash Redis REST, same instance as govern/telemetry/raffle-reg):
//   INCR cs:ga:seq                       — id mint
//   LPUSH cs:ga:ids <id>                 — newest-first index
//   SET  cs:ga:item:<id> <json>          — the giveaway document
//   HSET cs:ga:entries:<id> <addr> json  — one field per wallet: {"sig","ts"}
//   INCR cs:ga:rl:<ip> (TTL 3600)        — entry-spam brake, same as raffles
//
// Who may manage: a Discord session cookie (see session helpers below) marked
// manager=true. Manager status is decided ONCE at login — allowlisted Discord id
// or the Collab Manager role in the guild — and travels signed in the cookie.

import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ENV = process.env;

// ─── Redis (Upstash REST) ────────────────────────────────────────────────

export function storageConfigured(): boolean {
  return Boolean(ENV.UPSTASH_REDIS_REST_URL && ENV.UPSTASH_REDIS_REST_TOKEN);
}

export async function redis(cmd: unknown[]): Promise<unknown> {
  const r = await fetch(ENV.UPSTASH_REDIS_REST_URL as string, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + ENV.UPSTASH_REDIS_REST_TOKEN,
      "content-type": "application/json",
    },
    body: JSON.stringify(cmd),
    // Next patches fetch inside route handlers and will happily FREEZE a
    // POST's first response in its Data Cache — the deployed feed served the
    // pre-seed empty list forever while the store had data (10-ago). Redis
    // commands are state reads, never cacheable.
    cache: "no-store",
  });
  if (!r.ok) throw new Error("redis " + r.status);
  const j = await r.json();
  if (j.error) throw new Error("redis: " + j.error);
  return j.result;
}

// ─── The document ────────────────────────────────────────────────────────

export type GiveawayStatus = "open" | "drawn" | "cancelled";

export type Giveaway = {
  id: number;
  /** What the card says on top — usually the partner collection's name. */
  title: string;
  /** The partner project, shown as the kicker. */
  project: string;
  /** What winning actually gets you ("WL spot for the mint on Aug 20"). */
  prize: string;
  /** Optional artwork; any https image URL the manager pastes. */
  imageUrl: string;
  /** Optional link out to the partner (site or X profile). */
  projectUrl: string;
  winnersCount: number;
  /** Unix seconds. Entries close here; the draw happens after. */
  endsAt: number;
  /** ≥1 → the wallet must hold that many souls when it enters. 0 = anyone. */
  requireSouls: number;
  /** When true the bot's poller settles the draw the moment the close passes —
   *  no manager click needed. Off by default: some collabs want the drama. */
  autoDraw?: boolean;
  status: GiveawayStatus;
  createdAt: number;
  createdBy: { discordId: string; username: string };
  /** Set on draw. The seed makes the shuffle reproducible from the entry list. */
  drawnAt: number | null;
  seed: string | null;
  winners: string[];
  /** Replacements made after the draw (a winner unreachable, a partner rule).
   *  Each re-roll is itself seeded off the original seed, so the whole chain
   *  stays replayable from the entry list. */
  rerolls?: { out: string; in: string | null; ts: number }[];
};

const ITEM = (id: number) => `cs:ga:item:${id}`;
const ENTRIES = (id: number) => `cs:ga:entries:${id}`;

export async function getGiveaway(id: number): Promise<Giveaway | null> {
  const raw = (await redis(["GET", ITEM(id)])) as string | null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Giveaway;
  } catch {
    return null;
  }
}

export async function saveGiveaway(g: Giveaway): Promise<void> {
  await redis(["SET", ITEM(g.id), JSON.stringify(g)]);
}

export async function createGiveaway(
  fields: Omit<Giveaway, "id" | "status" | "createdAt" | "drawnAt" | "seed" | "winners">,
): Promise<Giveaway> {
  const id = Number(await redis(["INCR", "cs:ga:seq"]));
  const g: Giveaway = {
    ...fields,
    id,
    status: "open",
    createdAt: Math.floor(Date.now() / 1000),
    drawnAt: null,
    seed: null,
    winners: [],
  };
  await saveGiveaway(g);
  await redis(["LPUSH", "cs:ga:ids", String(id)]);
  return g;
}

/** Newest first. The list is small (collabs are a trickle, not a firehose). */
export async function listGiveaways(limit = 100): Promise<Giveaway[]> {
  const ids = ((await redis(["LRANGE", "cs:ga:ids", 0, limit - 1])) as string[]) ?? [];
  if (ids.length === 0) return [];
  const raws = (await redis(["MGET", ...ids.map((i) => ITEM(Number(i)))])) as (string | null)[];
  const out: Giveaway[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as Giveaway);
    } catch {
      /* a corrupt document hides itself, it does not break the wall */
    }
  }
  return out;
}

export async function entryCount(id: number): Promise<number> {
  return Number((await redis(["HLEN", ENTRIES(id)])) ?? 0);
}

export async function hasEntered(id: number, address: string): Promise<boolean> {
  return (await redis(["HGET", ENTRIES(id), address.toLowerCase()])) != null;
}

/** One row per wallet. `src` records how it came in (web signature vs the
 *  Discord button); `d` carries the Discord identity when one is known, so
 *  winner lists can show a handle next to the address. */
export async function addEntry(
  id: number,
  address: string,
  sig: string,
  src: "web" | "discord" = "web",
  d?: { id: string; username: string },
): Promise<void> {
  await redis([
    "HSET",
    ENTRIES(id),
    address.toLowerCase(),
    JSON.stringify({ sig, ts: Math.floor(Date.now() / 1000), src, ...(d ? { d } : {}) }),
  ]);
}

export async function listEntries(id: number): Promise<{ address: string; ts: number }[]> {
  const flat = ((await redis(["HGETALL", ENTRIES(id)])) as string[]) ?? [];
  const out: { address: string; ts: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    let ts = 0;
    try {
      ts = Number(JSON.parse(flat[i + 1]).ts) || 0;
    } catch {
      /* an unparsable value still keeps its address in the draw */
    }
    out.push({ address: flat[i], ts });
  }
  return out;
}

// ─── The signature holders give to enter ─────────────────────────────────

// Lives in giveaways-client.ts (client-bundle safe); re-exported here so the
// API routes keep importing everything giveaway from one place.
export { giveawayEntryMessage } from "./giveaways-client";

// ─── The draw ────────────────────────────────────────────────────────────

/**
 * Deterministic winners from (entry list, seed): sort the addresses, then
 * Fisher-Yates where step i's randomness is sha256(seed:i). Publish the seed
 * next to the winners and anyone holding the entry list can replay the draw —
 * the same honesty argument the on-chain raffles make, scaled down to a WL.
 */
export function drawWinners(addresses: string[], seed: string, count: number): string[] {
  const pool = [...addresses].map((a) => a.toLowerCase()).sort();
  for (let i = pool.length - 1; i > 0; i--) {
    const h = createHash("sha256").update(`${seed}:${i}`).digest();
    const j = Number(h.readBigUInt64BE(0) % BigInt(i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

export function makeSeed(): string {
  return "0x" + randomBytes(32).toString("hex");
}

/** The draw, executed and persisted — one definition shared by the desk's
 *  button and the bot's auto-draw, so they can never disagree. Caller has
 *  already decided the draw is allowed. */
export async function drawAndSave(g: Giveaway): Promise<Giveaway> {
  const entries = await listEntries(g.id);
  const seed = makeSeed();
  const now = Math.floor(Date.now() / 1000);
  g.winners = drawWinners(entries.map((e) => e.address), seed, g.winnersCount);
  g.seed = seed;
  g.drawnAt = now;
  g.status = "drawn";
  // an early draw also closes entries — endsAt is what the entry route checks
  if (g.endsAt > now) g.endsAt = now;
  await saveGiveaway(g);
  return g;
}

/**
 * Replace one winner. The substitute comes from the entrants NOT currently
 * holding a seat and not previously rolled out, shuffled with a seed derived
 * from the original — `${seed}:reroll:${n}` — so the nth re-roll is as
 * replayable as the draw itself. Returns null substitute when the pool is dry
 * (the seat is simply vacated).
 */
export async function rerollWinner(g: Giveaway, outAddress: string): Promise<Giveaway | null> {
  const out = outAddress.toLowerCase();
  const idx = g.winners.indexOf(out);
  if (idx === -1 || !g.seed) return null;

  const entries = await listEntries(g.id);
  const excluded = new Set([...g.winners, ...(g.rerolls ?? []).map((r) => r.out)]);
  const pool = entries.map((e) => e.address.toLowerCase()).filter((a) => !excluded.has(a));

  const n = (g.rerolls ?? []).length + 1;
  const sub = pool.length > 0 ? drawWinners(pool, `${g.seed}:reroll:${n}`, 1)[0] : null;

  if (sub) g.winners[idx] = sub;
  else g.winners.splice(idx, 1);
  g.rerolls = [...(g.rerolls ?? []), { out, in: sub, ts: Math.floor(Date.now() / 1000) }];
  await saveGiveaway(g);
  return g;
}

// ─── Wallet ↔ Discord links (the one-click Enter button) ─────────────────
//
// Two keys, both directions, always written together: the button needs
// discord→wallet, the winner list needs wallet→handle.

const LINK_D = (discordId: string) => `cs:link:d:${discordId}`;
const LINK_W = (wallet: string) => `cs:link:w:${wallet.toLowerCase()}`;

export type WalletLink = { wallet: string; discordId: string; username: string; ts: number };

export async function getLinkByDiscord(discordId: string): Promise<WalletLink | null> {
  const raw = (await redis(["GET", LINK_D(discordId)])) as string | null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WalletLink;
  } catch {
    return null;
  }
}

export async function setLink(discordId: string, username: string, wallet: string): Promise<void> {
  const w = wallet.toLowerCase();
  // a wallet moving between accounts, or an account changing wallets, must
  // never leave a stale half-link pointing back at the old pairing
  const [prevOfAccount, prevOfWallet] = await Promise.all([
    getLinkByDiscord(discordId),
    redis(["GET", LINK_W(w)]) as Promise<string | null>,
  ]);
  const cmds: unknown[][] = [];
  if (prevOfAccount && prevOfAccount.wallet !== w) cmds.push(["DEL", LINK_W(prevOfAccount.wallet)]);
  if (prevOfWallet) {
    try {
      const p = JSON.parse(prevOfWallet) as WalletLink;
      if (p.discordId !== discordId) cmds.push(["DEL", LINK_D(p.discordId)]);
    } catch {
      /* corrupt reverse row gets overwritten below anyway */
    }
  }
  const value = JSON.stringify({ wallet: w, discordId, username, ts: Math.floor(Date.now() / 1000) });
  cmds.push(["SET", LINK_D(discordId), value]);
  cmds.push(["SET", LINK_W(w), value]);
  for (const c of cmds) await redis(c);
}

export async function clearLink(discordId: string): Promise<void> {
  const prev = await getLinkByDiscord(discordId);
  if (prev) await redis(["DEL", LINK_W(prev.wallet)]);
  await redis(["DEL", LINK_D(discordId)]);
}

export async function getLinkByWallet(wallet: string): Promise<WalletLink | null> {
  const raw = (await redis(["GET", LINK_W(wallet)])) as string | null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WalletLink;
  } catch {
    return null;
  }
}

/** wallet → full link (or null), batched. */
export async function linksFor(wallets: string[]): Promise<(WalletLink | null)[]> {
  if (wallets.length === 0) return [];
  const raws = (await redis(["MGET", ...wallets.map((w) => LINK_W(w))])) as (string | null)[];
  return raws.map((raw) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as WalletLink;
    } catch {
      return null;
    }
  });
}

/** wallet → "@username" (or null), batched for winner lists. */
export async function handlesFor(wallets: string[]): Promise<(string | null)[]> {
  return (await linksFor(wallets)).map((l) => l?.username ?? null);
}

/** The winner list as the feed and the wall publish it. The discordId is
 *  there so SoulWatcher can TAG the winners in the drawn announcement —
 *  the one moment the museum does call people out. */
export async function winnersInfoFor(
  winners: string[],
): Promise<{ address: string; username: string | null; discordId: string | null }[]> {
  const links = await linksFor(winners).catch(() => winners.map(() => null));
  return winners.map((address, i) => ({
    address,
    username: links[i]?.username ?? null,
    discordId: links[i]?.discordId ?? null,
  }));
}

// ─── Bot-to-site auth (S2S) ──────────────────────────────────────────────

/** SoulWatcher's server-to-server key. The bot is the ONLY caller that may
 *  enter a wallet without a fresh signature (it acts on a stored link), so
 *  its requests carry a shared secret set on both dokku apps. */
export function botKeyOk(req: Request): boolean {
  const expect = (ENV.CS_BOT_API_KEY ?? "").trim();
  if (!expect) return false;
  const got = (req.headers.get("x-cs-bot-key") ?? "").trim();
  if (got.length !== expect.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expect));
}

// ─── Discord session (collab managers) ───────────────────────────────────
//
// A signed, HttpOnly cookie — no session store. Payload is tiny and public-ish
// (Discord id + username + the manager verdict); the HMAC is what makes it
// unforgeable. CS_SESSION_SECRET must be set alongside the OAuth client vars.

export type Session = {
  discordId: string;
  username: string;
  avatar: string | null;
  manager: boolean;
  /** Unix seconds. */
  exp: number;
};

export const SESSION_COOKIE = "cs_cm";
export const SESSION_TTL_S = 7 * 24 * 3600;

export function authConfigured(): boolean {
  return Boolean(ENV.DISCORD_CLIENT_ID && ENV.DISCORD_CLIENT_SECRET && ENV.CS_SESSION_SECRET);
}

const b64u = (b: Buffer) => b.toString("base64url");

function hmac(data: string): string {
  return b64u(createHmac("sha256", ENV.CS_SESSION_SECRET as string).update(data).digest());
}

export function sealSession(s: Session): string {
  const payload = b64u(Buffer.from(JSON.stringify(s), "utf8"));
  return `${payload}.${hmac(payload)}`;
}

export function openSession(cookie: string | undefined | null): Session | null {
  if (!cookie || !ENV.CS_SESSION_SECRET) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);
  const expect = hmac(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!s.discordId || typeof s.exp !== "number") return null;
    if (s.exp < Math.floor(Date.now() / 1000)) return null;
    return s;
  } catch {
    return null;
  }
}

/** The session from a Request's Cookie header, or null. */
export function sessionFrom(req: Request): Session | null {
  const header = req.headers.get("cookie") ?? "";
  const m = header.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return openSession(m ? decodeURIComponent(m[1]) : null);
}

/** Manager verdict at login time: allowlisted id, or the Collab Manager role. */
export function isManagerByAllowlist(discordId: string): boolean {
  const raw = ENV.CS_COLLAB_MANAGER_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(discordId);
}

export function managerRoleId(): string {
  return (ENV.CS_COLLAB_MANAGER_ROLE_ID ?? "").trim();
}

export function guildId(): string {
  return (ENV.CS_GUILD_ID ?? "").trim();
}

/** Must byte-match a redirect registered on the SoulWatcher app in the
 *  Discord developer portal. Canonical prod value, overridable for dev. */
export function oauthRedirectUri(): string {
  return ENV.CS_OAUTH_REDIRECT || "https://cubistsouls.com/api/auth/discord/callback";
}
