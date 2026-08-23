// Reaper proposals — the SHARED contract between the /govern propose form and
// POST /api/govern/propose. Client and server import the SAME validator and the
// SAME canonical message builder, so what the reaper signs in the wallet is,
// byte for byte, what the server recovers. No server-only imports here.
//
// CANONICAL MESSAGE the proposer signs (EIP-191 personal_sign) — frozen, like
// the vote message. Verification never parses this text back: the server (and
// any auditor) REBUILDS it from the stored fields and recovers the signer.
//
//   Cubist Souls Govern
//   Action: propose
//   Title: <title>
//   Option 1: <label>[ — <sub>]
//   Option N: ...
//   Window: <days> days
//   Reaper: <reaperId>
//   Author: <address lowercase>
//   Body:
//   <body — may span lines, which is why it goes last>

// The voting window is a CLOSED set — the proposer picks between these, never
// writes a number (same safety philosophy as the standing votes' options).
export const PROPOSAL_WINDOWS = [3, 7, 14] as const;
export const DEFAULT_WINDOW = 7;

export const PROPOSE_LIMITS = {
  title: 80,
  body: 1000,
  minOptions: 2,
  maxOptions: 4,
  label: 60,
  sub: 90,
} as const;

export type ProposeOption = { label: string; sub?: string };

export type ProposeFields = {
  title: string;
  body: string;
  options: ProposeOption[];
  windowDays: number;
  reaperId: number;
  address: string; // 0x…, lowercased by the validator
};

const oneLine = (s: string, max: number) => {
  const t = s.trim();
  return t.length > 0 && t.length <= max && !/[\r\n]/.test(t);
};

// Normalize + validate raw input (form state or a request body). Returns the
// CLEAN fields — trimmed, address lowercased — which are the ONLY thing the
// message is ever built from, so client and server can't drift on whitespace.
export function validatePropose(
  raw: unknown,
): { ok: true; fields: ProposeFields } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "bad body" };
  const r = raw as Record<string, unknown>;

  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!oneLine(title, PROPOSE_LIMITS.title) || title.length < 4)
    return { ok: false, error: `title must be 4–${PROPOSE_LIMITS.title} chars, one line` };

  const body = typeof r.body === "string" ? r.body.trim() : "";
  if (body.length > PROPOSE_LIMITS.body)
    return { ok: false, error: `description too long (max ${PROPOSE_LIMITS.body})` };

  if (!Array.isArray(r.options)) return { ok: false, error: "bad options" };
  const options: ProposeOption[] = [];
  for (const o of r.options) {
    if (!o || typeof o !== "object") return { ok: false, error: "bad option" };
    const label = typeof (o as any).label === "string" ? (o as any).label.trim() : "";
    const sub = typeof (o as any).sub === "string" ? (o as any).sub.trim() : "";
    if (!oneLine(label, PROPOSE_LIMITS.label))
      return { ok: false, error: `every option needs a label (max ${PROPOSE_LIMITS.label} chars)` };
    if (sub && !oneLine(sub, PROPOSE_LIMITS.sub))
      return { ok: false, error: `option subtitle too long (max ${PROPOSE_LIMITS.sub})` };
    options.push(sub ? { label, sub } : { label });
  }
  if (options.length < PROPOSE_LIMITS.minOptions || options.length > PROPOSE_LIMITS.maxOptions)
    return { ok: false, error: `${PROPOSE_LIMITS.minOptions}–${PROPOSE_LIMITS.maxOptions} options` };
  const labels = new Set(options.map((o) => o.label.toLowerCase()));
  if (labels.size !== options.length) return { ok: false, error: "options must be distinct" };

  const windowDays = Number(r.windowDays);
  if (!(PROPOSAL_WINDOWS as readonly number[]).includes(windowDays))
    return { ok: false, error: "bad voting window" };

  const reaperId = Number(r.reaperId);
  if (!Number.isInteger(reaperId) || reaperId < 1 || reaperId > 10000)
    return { ok: false, error: "bad reaperId" };

  const address = typeof r.address === "string" ? r.address : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { ok: false, error: "bad address" };

  return {
    ok: true,
    fields: { title, body, options, windowDays, reaperId, address: address.toLowerCase() },
  };
}

export function buildProposeMessage(f: ProposeFields): string {
  return [
    "Cubist Souls Govern",
    "Action: propose",
    `Title: ${f.title}`,
    ...f.options.map((o, i) => `Option ${i + 1}: ${o.label}${o.sub ? ` — ${o.sub}` : ""}`),
    `Window: ${f.windowDays} days`,
    `Reaper: ${f.reaperId}`,
    `Author: ${f.address.toLowerCase()}`,
    "Body:",
    f.body,
  ].join("\n");
}
