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
| wagmi | ^2.19.5 | NOT installed yet — W2 |
| viem | ^2.46.3 | NOT installed yet — W2 |
| @rainbow-me/rainbowkit | ^2.2.10 | NOT installed yet — W2 |
| @tanstack/react-query | ^5.90.21 | NOT installed yet — W2 |

W0 installs only what the APIs + provisional home need: `next`, `react`,
`react-dom`, `sharp` (^0.33.5, for render/share), and TS dev deps. The wallet
stack (wagmi/viem/rainbowkit/react-query) is deliberately left for W2, per plan.

WalletConnect projectId to reuse in W2 (from plan §2.5):
`21fef48091f12692cad574a6f7753643` — add this deploy's domain to the
WalletConnect Cloud allowlist when wallet lands.

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
