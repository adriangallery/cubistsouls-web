# cubistsouls-web — migration notes

Next.js 14 project for cubistsouls.com.

## ⚠️ MIGRATION OFF VERCEL (2026-07-27) — now self-hosted on the mini/Dokku

Vercel paused the `adrianlab` team (HTTP 402 on everything), so
`cubistsouls.vercel.app` and `pikkazo-burn.vercel.app` are **DEAD**. This repo is
now the single source of truth for cubistsouls.com, deployed as a **Docker image
on the mini/Dokku** (see the Dockerfile + the "Docker / mini deploy" section
below). Nothing in the codebase may reference a `*.vercel.app` host anymore — all
self-references are relative (`/api/img?id=…`) or absolute on
`https://cubistsouls.com` (OG/Twitter images, contractURI, and the on-chain
metadata TARGET `/api/meta`).

**`/api/meta` is the on-chain renderer TARGET** post-migration: the diamond's
SoulRenderer tokenURI points at `https://cubistsouls.com/api/meta?id=<id>`. It is
ported byte-for-byte from `pikkazo-burn/api/meta.js` — verified locally against
the canonical handler for ids 136 (OG), 23 (Era I), 8777 (reaper, 18 consumed):
attributes byte-identical, name identical, full body identical once the dead
vercel.app host is swapped to cubistsouls.com. Key behaviours it now carries:
- **OG cohort is FROZEN** via `app/api/meta/og_frozen.json` (863 ids, copied from
  pikkazo-burn). OG is decided from that set only — **never by RPC**. A non-frozen
  soul reads its era (Era I..IV) from the diamond; on read failure the Cohort
  trait is **OMITTED** (never defaulted to "OG" — that was the 26-jul mislabel bug).
- **Reaper state** (soulsConsumed + marksOf on the diamond via Tenderly): marks
  unlock by cumulative consumption (Orange@6 · Flame Crown@12 · Phoenix@18 ·
  Burning Soul@30) ∪ legacy on-chain forged bits. Adds a `Souls Consumed` trait
  and one `Reaper Mark` trait per mark; renames to `Soul Reaper #id` at ≥30; and
  points `image` at `/api/reaper-img` (absolute cubistsouls.com) once marks>0.
- **FAIL-OPEN**: any RPC/IPFS failure leaves the metadata byte-identical to the
  pre-reaper response. tokenURI must never break.

## Stack versions (aligned with zerothetoken frontend)

Read from `ZEROtoken/zero-diamond/frontend/package.json` on 2026-07-25:

| pkg | zerothetoken | cubistsouls-web (W0) |
|---|---|---|
| next | 14.2.35 | **14.2.35** (pinned, installed) |
| react / react-dom | ^18 | ^18 (installed) |
| wagmi | ^2.19.5 | **2.19.5** (installed — W2) |
| viem | ^2.46.3 | **2.55.8** (installed — W2) |
| @rainbow-me/rainbowkit | ^2.2.10 | **2.2.11** (installed — W2) |
| @tanstack/react-query | ^5.90.21 | **5.90.21** (installed — W2) |

W0 installs only what the APIs + provisional home need: `next`, `react`,
`react-dom`, `sharp` (^0.33.5, for render/share), and TS dev deps.

WalletConnect projectId (from plan §2.5):
`21fef48091f12692cad574a6f7753643` — public, shipped in the client bundle by
design (same as zerothetoken; NOT a secret). It is hardcoded in `config/wagmi.ts`.
Add this deploy's domain to the WalletConnect Cloud allowlist if the modal ever
complains about the origin.

## W2 — wallet infrastructure + Your Souls (2026-07-25)

- **Providers** (`app/components/Providers.tsx`): `WagmiProvider` → React Query →
  `RainbowKitProvider`, wrapping the whole app in the root layout. Mainnet ONLY
  (chain id 1). Config in `config/wagmi.ts`: viem `fallback` transport =
  Tenderly public gateway → publicnode → llamarpc (client-side the fallbacks are
  real, unlike server). RainbowKit theme is customised to the Direction B tokens
  (oxblood modal, ember accent, gild border, Space Mono) so the modal reads as
  part of the museum, not a stock wallet sheet.
- **Home CTA** (`app/components/HomeCta.tsx`): W1's disabled "Light the fire"
  button now opens the RainbowKit connect modal when there's no wallet; once
  connected it points at `/my-souls` (real per-token burn selection is W3 — no
  fake burn flow here).
- **`/my-souls`** (`app/my-souls/`): client page with parity to the vanilla
  `my-souls.html`. Reads on viem: `Transfer(to=wallet)` → Multicall3 `ownerOf`
  = held; `Transfer(from=0)` tally = freed + rank + liberator count. Recognition
  plaque (rank / freed / held / tier), collection grid (W1 `SoulCard` → OpenSea
  item), share card (1200×630 canvas, ported, re-skinned to Direction B dark
  ember, same dimensions + data), and Museum Hours (`?mh=1`) with the formula
  ported 1:1 (constants + cohort/rarity/liberator multipliers identical). Without
  `?mh=1` the page shows nothing about MH (still a secret). Empty (no-wallet)
  state is a designed placeholder, not a "site down" screen.
- **Validated vs 0x4943…81C6**: on-chain reads (raw RPC cross-check) give
  held = 346, freed = 346, **rank #1** of 142 liberators, 2,335 total mints
  (matches the home counter). The task's "~246" was a stale snapshot; the
  collection grew — held==freed==346 is consistent (all minted, none sold) and
  rank #1 holds. MH figures are Δ=0 by construction (same formula, same on-chain
  sources; the exact live-connected number can't be captured headless).
- **Old wallet harness is gone.** `assets/wallet.js` (the custom WalletConnect /
  mobile deep-link sheet) is NOT used anymore — RainbowKit owns connect + the
  mobile handoff. The legacy `?wcforce=1` / `?mobileforce=1` query flags are now
  **no-ops** (RainbowKit has no equivalent hook; nothing reads them). The
  `public/assets/wallet.js` file stays on disk only for the still-legacy pages
  served in earlier waves; the Next pages never load it.
- **Build note**: wagmi 2.19 drags the Base Account connector →
  `@coinbase/cdp-sdk` with optional `@x402/*` payment sub-imports we never reach.
  `next.config.mjs` ignores them via `IgnorePlugin({resourceRegExp:/^@x402\//})`.
  The `@metamask/sdk` async-storage warning is a harmless optional RN dep.

## Runtime environment variables (set via `dokku config`, NOT committed)

The govern + telemetry endpoints read Upstash Redis (REST) credentials from env.
**The code uses these exact names** (the real pikkazo-burn code uses the UPSTASH_*
names, NOT `KV_REST_API_URL`):

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Set them on the mini with `dokku config:set <app> UPSTASH_REDIS_REST_URL=… UPSTASH_REDIS_REST_TOKEN=…`
(Dokku injects them into the container at runtime). They are the ONLY runtime env
vars the app needs. Everything else (WalletConnect projectId, RPC endpoints,
chain id) is baked into the client bundle at build time and is public by design.

Used by:
- `app/api/govern/vote/route.ts`   (HSET cs:gov:votes:*, INCR cs:gov:rl:*)
- `app/api/govern/votes/route.ts`  (HGETALL cs:gov:votes:*)
- `app/api/telemetry/route.ts`     (LPUSH/LTRIM cs:tele:log, INCR cs:tele:rl:*)

Behaviour when unset (matches prod):
- govern vote/votes → HTTP 500 `{ "error": "storage not configured" }`
- telemetry → 204 accept-and-drop (never surfaces an error)

**RULE: no secret is hardcoded or committed.** Copy the same values used by the
`pikkazo-burn` Vercel project into this new project's Environment Variables in
the Vercel dashboard (they can point at the SAME Upstash DB — keys are namespaced
`cs:gov:` / `cs:tele:`, so both projects share one ballot box / one telemetry log
cleanly, OR use a fresh DB if you want the new site isolated during testing).

## API port — behaviour preserved

All 8 endpoints ported to `app/api/*/route.ts` with `runtime = "nodejs"`:

| endpoint | notes |
|---|---|
| meta | JSON shape/key order/Cache-Control identical; OG frozen (og_frozen.json), else era via RPC (tenderly→publicnode→llamarpc, 5s) — omitted on failure, never "OG"; reaper state (consumed/marks); reaper-img image when marks>0; rename Soul Reaper #id at ≥30. Byte-verified vs pikkazo for 136/23/8777 |
| img | mirror-first then race IPFS gateways; 400/502; immutable cache |
| collection | static JSON; byte-identical |
| render | sharp composite 768×768; `maxDuration=60`; 400/502 |
| share | HTML OG landing + redirect to /builder; host/proto from headers |
| telemetry | POST + OPTIONS + GET(405); same-origin allow-list; Upstash |
| govern/vote | POST; loads /govern/proposals.json same-origin; Upstash |
| govern/votes | GET; HGETALL; s-maxage=10 swr=30 |

`public/govern/proposals.json` and `public/flags.json` copied as-is. `soul.jpg`
copied (collection.js references the absolute prod URL, but kept for parity).
`public/assets/*` copied verbatim (banner, logos QS, wall-lowpoly-red.svg,
wallet.js, tele.js, traits-svg, test-traits) for the future design/pages waves.

## Config

- `next.config.mjs`: `output: "standalone"` (for the Docker image); security
  headers (X-Content-Type-Options, Referrer-Policy, HSTS) on every path; long
  immutable Cache-Control on static image/font assets; clean-URL rewrites +
  redirects for the still-legacy /public HTML pages. The site is PUBLIC (no global
  noindex; only the legacy secret pages keep inline `<meta robots noindex>`).

## Caching dials (mini efficiency — Adrian 28-jul)

Two independent dials keep RPC pressure low on the single mini container. Tune them
here; they compose (ISR decides how often the HTML regenerates, the reader TTL
decides whether that regeneration actually touches RPC).

1. **ISR `revalidate` per page** (the `export const revalidate` in each `page.tsx`):
   - `app/page.tsx` (home) — **60s**. Kept short on purpose: the freed counter right
     after a burn is burn-flow UX (the ticker is also client-side).
   - `app/reapers/page.tsx` — **300s** (5 min). It's a museum; minute-fresh adds
     nothing and 5×'s RPC pressure.
   - `app/gallery/page.tsx` — **300s** (5 min).
2. **Reader TTL in `lib/chain.ts`** — `READER_TTL_MS = 240_000` (4 min). Every heavy
   reader (`getFreed`, `getReapers`, `getConsumed`, `getRising`, `getSupply`,
   `getPricing`) memoizes its last GOOD result with a timestamp: if it's younger than
   the TTL, it's served WITHOUT any RPC, even across concurrent regenerations. So
   home + gallery share one `getFreed` in practice, and back-to-back `/reapers`
   reloads don't fan out RPC bursts. TTL sits just under the 5-min ISR so a scheduled
   regen usually rides the memo.
   - The same memo is ALSO the last-good fallback: fresh (<TTL) → serve; stale → try
     RPC (with the multi-provider failover, Tenderly → drpc → publicnode); on total
     failure → serve the stored `.value`. A value is dropped only when a fresh read
     genuinely succeeds. No reader ever fabricates data (the old `/reapers` "flat art
     / HELD BY — / total 30" bug was a hardcoded `catch` return — now removed).

Verify after deploy: repeated `/reapers` reloads should NOT produce RPC bursts in
`sudo dokku logs cubistsouls-web` (the memo absorbs them within the TTL window).

## Docker / mini deploy

- **`Dockerfile`** — multi-stage `node:20-slim` (deps → builder → runner). Emits
  the Next standalone server; the runner carries only `.next/standalone` +
  `.next/static` + `public` + `sharp`/`@img`. Runs as non-root `nextjs`. Starts
  with `node server.js`.
- **PORT**: `ENV PORT=5000` + `EXPOSE 5000`. Dokku injects `PORT` for image
  deploys (5000 default); `server.js` honours `process.env.PORT`, so it works
  whatever Dokku sets. `HOSTNAME=0.0.0.0` so it binds all interfaces.
- **sharp**: `node:20-slim` (glibc), NOT alpine — sharp's default glibc prebuilt
  "just works"; alpine/musl needs the `@img/sharp-linuxmusl-*` variant and Next's
  file-tracing is flaky about copying optional native deps. The runner *also*
  copies `node_modules/sharp` + `node_modules/@img` from the builder explicitly as
  a belt-and-suspenders guarantee (verified: tracing DID include them, but the
  copy protects against a future tracing regression). `/api/render` and
  `/api/reaper-img` need it. If you ever switch to alpine and sharp errors at
  runtime with "Could not load the sharp module", that's the musl binary missing.
- **public/ at runtime**: `/api/reaper-img` reads SVGs from
  `process.cwd()/public/assets/...`, so the runner MUST have `public/` copied
  alongside `server.js` (it does). Do not prune it.
- **Secrets**: none baked into the image. `UPSTASH_*` come from `dokku config`.
- **No secrets in build args** either — nothing UPSTASH-related is a NEXT_PUBLIC
  build-time var, so a plain `docker build` (no build-args) is correct.
- Local sanity check of the built image contract:
  `PORT=5055 node .next/standalone/server.js` then `curl localhost:5055/api/meta?id=136`.

## Verify parity

```
npm run build            # local build must be green
node scripts/api-diff.mjs https://<this-deploy-url>
```

api/meta compares the STABLE core (name/description/image/external_url)
byte-for-byte; `attributes` are reported informationally because Cohort is a live
on-chain read and the upstream trait mirror can differ transiently between hosts.
