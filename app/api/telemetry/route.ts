// Cubist Souls — front-end error telemetry sink (fire-and-forget buoy).
//
// Ported from pikkazo-burn/api/telemetry.js. Stores ONLY error msg/page/UA in
// Upstash Redis (REST) under cs:tele:*. No PII. IP used only as ephemeral
// rate-limit key (never stored). 204 on the happy path.
//
// Credentials are injected by the host (Vercel env); never inline them.

export const runtime = "nodejs";

const ENV = process.env;
const RL_MAX = 10;
const RL_WINDOW = 3600;
const LOG_KEY = "cs:tele:log";
const LOG_CAP = 500;

const MAX_MSG = 500;
const MAX_STACK = 2000;
const MAX_PAGE = 300;
const MAX_UA = 512;

// Same-origin allow-list. A request declaring a foreign Origin is refused; a
// request with NO Origin header (same-origin navigations often omit it) passes.
const ALLOW_EXACT = new Set([
  "https://cubistsouls.com",
  "https://www.cubistsouls.com",
  "https://cubistsouls.vercel.app",
  "https://pikkazo-burn.vercel.app",
]);
const ALLOW_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function originAllowed(origin: string | null): boolean {
  if (!origin) return true; // no Origin header → same-origin, allow
  return ALLOW_EXACT.has(origin) || ALLOW_LOCAL.test(origin);
}

// Single-command Upstash REST call (same shape as api/govern/*).
async function redis(cmd: any[]) {
  const r = await fetch(ENV.UPSTASH_REDIS_REST_URL as string, {
    method: "POST",
    headers: { Authorization: "Bearer " + ENV.UPSTASH_REDIS_REST_TOKEN, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  const j = await r.json();
  if (j.error) throw new Error("redis: " + j.error);
  return j.result;
}

// Pure validator. Returns {ok:true,record} or {ok:false,code,error}.
function validateTele(body: any) {
  if (!body || typeof body !== "object") return { ok: false as const, code: 400, error: "bad body" };

  const { page, msg, stack, ua } = body;

  if (typeof page !== "string" || page.length === 0 || page.length > MAX_PAGE)
    return { ok: false as const, code: 400, error: "bad page" };

  if (typeof msg !== "string" || msg.length === 0)
    return { ok: false as const, code: 400, error: "bad msg" };
  if (msg.length > MAX_MSG) return { ok: false as const, code: 413, error: "msg too large" };

  if (stack != null) {
    if (typeof stack !== "string") return { ok: false as const, code: 400, error: "bad stack" };
    if (stack.length > MAX_STACK) return { ok: false as const, code: 413, error: "stack too large" };
  }

  const record: Record<string, any> = {
    ts: Math.floor(Date.now() / 1000),
    page: page,
    msg: msg,
  };
  if (stack) record.stack = stack;
  if (typeof ua === "string" && ua) record.ua = ua.slice(0, MAX_UA);

  return { ok: true as const, record };
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {};
  if (originAllowed(origin) && origin) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "content-type";
  }
  return h;
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: originAllowed(origin) ? 204 : 403,
    headers: corsHeaders(origin),
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (!originAllowed(origin)) return new Response(null, { status: 403, headers });

  // Storage unconfigured → accept-and-drop. Telemetry must never surface an error.
  if (!ENV.UPSTASH_REDIS_REST_URL || !ENV.UPSTASH_REDIS_REST_TOKEN)
    return new Response(null, { status: 204, headers });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const v = validateTele(body);
  if (!v.ok) return new Response(null, { status: v.code, headers });

  // Light per-IP rate limit (best-effort). Error loops must not flood the log.
  try {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const key = "cs:tele:rl:" + ip;
    const n = await redis(["INCR", key]);
    if (n === 1) await redis(["EXPIRE", key, RL_WINDOW]);
    if (n > RL_MAX) return new Response(null, { status: 429, headers });
  } catch {
    /* rate-limit failure must not drop a report */
  }

  // Store + cap. Any failure is swallowed — the browser never learns.
  try {
    await redis(["LPUSH", LOG_KEY, JSON.stringify(v.record)]);
    await redis(["LTRIM", LOG_KEY, 0, LOG_CAP - 1]);
  } catch {
    /* fire-and-forget */
  }

  return new Response(null, { status: 204, headers: { ...headers, "Cache-Control": "no-store" } });
}

// The legacy handler returned 405 with Allow header for non-POST verbs.
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
