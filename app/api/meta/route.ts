// Per-token metadata for Cubist Souls. The diamond's on-chain renderer points
// tokenURI here (https://cubistsouls.com/api/meta?id=<id>) after the migration
// off Vercel — this endpoint is the canonical metadata TARGET.
//
// Ported byte-for-byte from pikkazo-burn/api/meta.js — same JSON shape/key order,
// same error codes, same Cache-Control, same fail-open semantics.
//
// Each Soul carries the ORIGINAL Pikkazo art + its 8 cubist traits, but under
// the Cubist Souls name/lore. Traits come from our durable GitHub mirror when
// the token has been copied there; otherwise we read them straight from
// Pikkazo's IPFS metadata so a freshly-burned Soul reveals instantly.

export const runtime = "nodejs";
export const maxDuration = 60;

import OG_FROZEN_LIST from "./og_frozen.json";

const META_CID = "QmPXUAzyddsQYPUjY2E7WDWedx7vMgdJGyj8a84rzFWmed";
const RAW = "https://raw.githubusercontent.com/adriangallery/cubist-souls-assets/main/meta";
const GATEWAYS = [
  (id: number) => `https://ipfs.io/ipfs/${META_CID}/${id}`,
  (id: number) => `https://gateway.pinata.cloud/ipfs/${META_CID}/${id}`,
  (id: number) => `https://${META_CID}.ipfs.dweb.link/${id}`,
  (id: number) => `https://4everland.io/ipfs/${META_CID}/${id}`,
];

const LORE =
  "Ten thousand cubist portraits were abandoned by their maker. Inside every canvas, a soul stayed trapped. " +
  "Each Cubist Soul exists because its holder burned the original canvas on Ethereum, an irreversible act of liberation. " +
  "The soul kept its number, and the face it wore in the canvas that held it.";

// Cohort (era in which the soul was freed) is read straight from the diamond.
// 0 = OG (the earliest movers, freed before the timed sale), 1..4 = Era I..IV.
const SOULS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406";
const COHORT_SELECTOR = "0xd5b0e035"; // cohortOf(uint256)
const RPCS = [
  "https://gateway.tenderly.co/public/mainnet",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
];
const COHORT_NAMES = ["OG", "Era I", "Era II", "Era III", "Era IV"];

// ---- Soul Reapers (ReaperFacet on this same diamond) --------------------------
// A soul consumes the souls of burned Pikkazos. We read its live consumed count
// and forged marks and reflect them in the metadata. markIds: 0=Orange 1=FlameCrown
// 2=Phoenix 3=BurningSoul. From a datacenter IP ONLY the Tenderly gateway answers
// (publicnode/llamarpc 403 datacenter IPs), so we read reaper state there.
//
// FAIL-OPEN ABSOLUTE: any RPC failure/timeout, or a soul with 0 consumed and 0
// marks, leaves the metadata EXACTLY as it was — byte-identical to the pre-reaper
// response. tokenURI must never break.
const TENDERLY = "https://gateway.tenderly.co/public/mainnet";
const SEL_SOULS_CONSUMED = "0x5b99ce59"; // soulsConsumed(uint256)
const SEL_MARKS_OF = "0xfb115701"; // marksOf(uint256) returns uint256 bitmask
const MARK_NAMES = ["Orange", "Flame Crown", "Phoenix", "Burning Soul"];
const ASCEND_AT = 30; // consumed >= 30 => renamed "Soul Reaper #id"

async function reaperCall(sel: string, id: number): Promise<string | null> {
  const data = sel + id.toString(16).padStart(64, "0");
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: SOULS, data }, "latest"] });
  const r = await fetch(TENDERLY, { method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: AbortSignal.timeout(3000) });
  const j = await r.json();
  if (j.error || !j.result || j.result === "0x") return null;
  return j.result;
}

// { consumed, marks[] } — always resolves; on ANY failure returns the neutral
// {0, []} so the caller emits the unchanged, byte-identical metadata.
async function reaperState(id: number): Promise<{ consumed: number; marks: number[] }> {
  try {
    const [cRes, mRes] = await Promise.all([
      reaperCall(SEL_SOULS_CONSUMED, id),
      reaperCall(SEL_MARKS_OF, id),
    ]);
    const consumed = cRes ? parseInt(cRes, 16) || 0 : 0;
    const marks: number[] = [];
    // Milestone economy (26-jul, Adrian): marks unlock by CUMULATIVE consumption —
    // Orange@6, Flame Crown@12, Phoenix@18, Burning Soul@30 (final prize: skin+name).
    // Union with any legacy on-chain forged bits (pre-milestone forges are a
    // consistent subset). The V3 facet will mirror this same derivation on-chain.
    const THRESHOLDS = [6, 12, 18, 30];
    let mask = mRes ? BigInt(mRes) : 0n;
    THRESHOLDS.forEach((t, i) => { if (consumed >= t) mask |= 1n << BigInt(i); });
    for (let i = 0; i < 8; i++) if ((mask >> BigInt(i)) & 1n) marks.push(i);
    return { consumed, marks };
  } catch {
    return { consumed: 0, marks: [] };
  }
}

// The OG cohort is FROZEN FOREVER: exactly the souls minted up to the ConvertV2
// cut (block 25565191) — 863 ids, embedded statically so deciding "OG" never
// touches the network. (The old fallback `return "OG"` on RPC failure mislabeled
// ~381 Era I souls on OpenSea whenever a crawl hit an RPC hiccup — 26-jul bug.)
const OG_FROZEN = new Set<number>(OG_FROZEN_LIST as number[]);

async function cohortName(id: number): Promise<string | null> {
  if (OG_FROZEN.has(id)) return "OG";
  const data = COHORT_SELECTOR + id.toString(16).padStart(64, "0");
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: SOULS, data }, "latest"] });
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      if (j && j.result && j.result !== "0x") {
        const c = parseInt(j.result, 16);
        // A non-frozen soul can never be OG; a 0 here would be a read glitch.
        if (c >= 1 && c < COHORT_NAMES.length) return COHORT_NAMES[c];
      }
    } catch {}
  }
  // Read failed: OMIT the trait rather than lie — OpenSea keeps its last cached
  // value and the next successful crawl corrects it. NEVER default to "OG".
  return null;
}

async function fetchJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// Our GitHub mirror first (durable, ours); fall back to Pikkazo IPFS so a
// just-burned token that isn't mirrored yet still reveals immediately.
async function originalMeta(id: number) {
  try {
    return await fetchJson(`${RAW}/${id}.json`);
  } catch {
    return await Promise.any(GATEWAYS.map((gw) => fetchJson(gw(id))));
  }
}

export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1 || id > 10000) {
    return Response.json({ error: "bad token id" }, { status: 400 });
  }

  let attributes: any[] = [];
  try {
    const orig = await originalMeta(id);
    if (Array.isArray(orig?.attributes)) attributes = orig.attributes;
  } catch {
    // traits unavailable this instant — still return valid metadata with the
    // image; OpenSea will pick up traits on its next refresh.
  }

  const cohort = await cohortName(id);
  attributes = [
    ...attributes,
    { trait_type: "Origin", value: `Pikkazo Canvas #${id}` },
    { trait_type: "Status", value: "Freed" },
    // cohort === null means the era read failed: omit the trait (never lie).
    ...(cohort ? [{ trait_type: "Cohort", value: cohort }] : []),
  ];

  // Reaper state. Defaults keep the response byte-identical to the pre-reaper era;
  // only a soul with real on-chain activity diverges.
  let name = `Cubist Soul #${id}`;
  let image = `https://cubistsouls.com/api/img?id=${id}`;
  const reaper = await reaperState(id);
  if (reaper.consumed > 0) {
    attributes.push({ trait_type: "Souls Consumed", value: reaper.consumed });
  }
  for (const markId of reaper.marks) {
    if (MARK_NAMES[markId]) attributes.push({ trait_type: "Reaper Mark", value: MARK_NAMES[markId] });
  }
  if (reaper.consumed >= ASCEND_AT) name = `Soul Reaper #${id}`;
  if (reaper.marks.length > 0) image = `https://cubistsouls.com/api/reaper-img?id=${id}`;

  const body = {
    name,
    description: LORE,
    image,
    external_url: "https://cubistsouls.com",
    attributes,
  };

  return Response.json(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
