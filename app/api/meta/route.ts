// Per-token metadata for Cubist Souls. The diamond's renderer points tokenURI
// here (https://cubistsouls.vercel.app/api/meta?id=<id>).
//
// Ported from pikkazo-burn/api/meta.js — behaviour byte-identical: same JSON
// shape/key order, same error codes, same Cache-Control.

export const runtime = "nodejs";
export const maxDuration = 60;

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
const SOULS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406";
const COHORT_SELECTOR = "0xd5b0e035"; // cohortOf(uint256)
const RPCS = [
  "https://gateway.tenderly.co/public/mainnet",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
];
const COHORT_NAMES = ["OG", "Era I", "Era II", "Era III", "Era IV"];

async function cohortName(id: number): Promise<string> {
  const data = COHORT_SELECTOR + id.toString(16).padStart(64, "0");
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: SOULS, data }, "latest"] });
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      if (j && j.result && j.result !== "0x") return COHORT_NAMES[parseInt(j.result, 16)] || "OG";
    } catch {}
  }
  return "OG"; // facet not live yet, or RPC unavailable — every current soul is an OG
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
    { trait_type: "Cohort", value: cohort },
  ];

  const body = {
    name: `Cubist Soul #${id}`,
    description: LORE,
    image: `https://cubistsouls.vercel.app/api/img?id=${id}`,
    external_url: "https://cubistsouls.vercel.app",
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
