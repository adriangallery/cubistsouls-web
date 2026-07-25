#!/usr/bin/env node
// api-diff.mjs — parity check of the ported APIs against production.
//
//   node scripts/api-diff.mjs https://<preview-or-prod-url>
//
// Compares PROD (https://cubistsouls.com) vs a given BASE_URL for a set of
// representative token ids and honorarios:
//   - /api/meta       byte-diff of the JSON body
//   - /api/img        status + content-type + byte length
//   - /api/collection byte-diff of the JSON body
//
// govern/* and telemetry are excluded (they need Upstash env; not a diff target).
// Exit code 0 = all green, 1 = at least one mismatch.

const PROD = process.env.PROD_URL || "https://cubistsouls.com";
const BASE = process.argv[2];

if (!BASE) {
  console.error("usage: node scripts/api-diff.mjs https://<base-url>");
  process.exit(2);
}

// Representative ids: a live soul, a couple of freed ones, a non-minted id, and
// the honorarios (1/1 special tokens 90/163/294/600).
const IDS = [136, 1064, 8115, 9999, 90, 163, 294, 600];

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RST = "\x1b[0m";

let failures = 0;

async function getText(url) {
  const r = await fetch(url, { redirect: "follow" });
  const body = await r.text();
  return { status: r.status, ct: r.headers.get("content-type") || "", body };
}

async function getBin(url) {
  const r = await fetch(url, { redirect: "follow" });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct: r.headers.get("content-type") || "", len: buf.length };
}

function line(ok, label, detail) {
  const tag = ok ? `${GREEN}PASS${RST}` : `${RED}FAIL${RST}`;
  if (!ok) failures++;
  console.log(`  ${tag}  ${label}${detail ? `  ${DIM}${detail}${RST}` : ""}`);
}

// meta contains a live-read Cohort attribute + traits that may differ transiently
// between hosts. We compare the STABLE core (name/description/image/external_url)
// byte-for-byte, and report the attributes diff separately as informational.
function metaDiff(prodBody, baseBody) {
  let p, b;
  try {
    p = JSON.parse(prodBody);
    b = JSON.parse(baseBody);
  } catch {
    return { core: prodBody === baseBody, note: "unparseable JSON" };
  }
  const core = (o) => JSON.stringify({ name: o.name, description: o.description, image: o.image, external_url: o.external_url });
  const coreEqual = core(p) === core(b);
  const attrsEqual = JSON.stringify(p.attributes) === JSON.stringify(b.attributes);
  return { core: coreEqual, attrsEqual, byteEqual: prodBody === baseBody };
}

async function run() {
  console.log(`\nPROD = ${PROD}`);
  console.log(`BASE = ${BASE}\n`);

  // collection (id-independent)
  console.log("api/collection");
  try {
    const [p, b] = await Promise.all([getText(`${PROD}/api/collection`), getText(`${BASE}/api/collection`)]);
    line(p.status === b.status, `status ${p.status} == ${b.status}`);
    line(p.body === b.body, "body byte-identical", p.body === b.body ? "" : `prod=${p.body.length}b base=${b.body.length}b`);
  } catch (e) {
    line(false, "request error", String(e));
  }

  console.log("\napi/meta (core byte-diff; attributes informational — Cohort is a live on-chain read)");
  for (const id of IDS) {
    try {
      const [p, b] = await Promise.all([getText(`${PROD}/api/meta?id=${id}`), getText(`${BASE}/api/meta?id=${id}`)]);
      const okStatus = p.status === b.status;
      const d = metaDiff(p.body, b.body);
      line(okStatus && d.core, `id=${id} status ${p.status}/${b.status} · core`, d.byteEqual ? "byte-identical" : d.attrsEqual ? "core+attrs equal, byte diff" : "attrs differ (transient traits/cohort)");
    } catch (e) {
      line(false, `id=${id} request error`, String(e));
    }
  }

  console.log("\napi/img (status + content-type + byte length)");
  for (const id of IDS) {
    try {
      const [p, b] = await Promise.all([getBin(`${PROD}/api/img?id=${id}`), getBin(`${BASE}/api/img?id=${id}`)]);
      const ok = p.status === b.status && p.ct === b.ct && p.len === b.len;
      line(ok, `id=${id}`, `prod[${p.status} ${p.ct} ${p.len}b] base[${b.status} ${b.ct} ${b.len}b]`);
    } catch (e) {
      line(false, `id=${id} request error`, String(e));
    }
  }

  console.log(`\n${failures === 0 ? GREEN + "ALL GREEN" : RED + failures + " FAILURE(S)"}${RST}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
