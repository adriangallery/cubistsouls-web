# cubistsouls-web — migration notes (W0)

New, SEPARATE Next.js 14 project for the migration of cubistsouls.com. It does
NOT touch `pikkazo-burn` (prod). Prod keeps serving `cubistsouls.vercel.app/api/*`
(where the on-chain SoulRendererV2 points) forever; this project's API only
serves this site (behaviour parity, no external byte-a-byte obligation).

The whole site is `X-Robots-Tag: noindex, nofollow` until the final domain flip.

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

## Environment variables to configure in the Vercel dashboard (NOT committed)

The govern + telemetry endpoints read Upstash Redis (REST) credentials from env.
**The code uses these exact names** (NOT `KV_REST_API_URL` — that was a guess in
the task; the real code in pikkazo-burn uses the UPSTASH_* names):

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

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
| meta | JSON shape/key order/Cache-Control identical; Cohort read via RPC (tenderly→publicnode→llamarpc, 5s timeout, "OG" fallback) |
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

- `next.config.mjs`: global `X-Robots-Tag: noindex, nofollow` + security headers
  (X-Content-Type-Options, Referrer-Policy, HSTS) on every path; long immutable
  Cache-Control on static image/font assets (mirrors pikkazo-burn/vercel.json).
- **No host-based redirects** — those stay in the old project (pikkazo-burn).

## Verify parity

```
npm run build            # local build must be green
node scripts/api-diff.mjs https://<this-deploy-url>
```

api/meta compares the STABLE core (name/description/image/external_url)
byte-for-byte; `attributes` are reported informationally because Cohort is a live
on-chain read and the upstream trait mirror can differ transiently between hosts.
