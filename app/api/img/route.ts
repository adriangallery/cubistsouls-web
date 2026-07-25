// Image proxy for Cubist Souls / the burn page. Serves the original Pikkazo
// artwork for a token id.
//
// Ported from pikkazo-burn/api/img.js — behaviour identical: mirror first, then
// race IPFS gateways; same status codes, same Cache-Control.

export const runtime = "nodejs";
export const maxDuration = 60;

const CID = "QmVgPQtmUBVFK4YqiTQHSFuF1yWcWF3BKGvpXYwFFHfiBm";
const RAW = "https://raw.githubusercontent.com/adriangallery/cubist-souls-assets/main/img";
const GATEWAYS = [
  (id: number) => `https://ipfs.io/ipfs/${CID}/${id}`,
  (id: number) => `https://gateway.pinata.cloud/ipfs/${CID}/${id}`,
  (id: number) => `https://${CID}.ipfs.dweb.link/${id}`,
  (id: number) => `https://${CID}.ipfs.w3s.link/${id}`,
  (id: number) => `https://4everland.io/ipfs/${CID}/${id}`,
];

async function fetchFrom(url: string, timeout: number) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error("empty body");
  return { buf, type: r.headers.get("content-type") || "image/png" };
}

export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1 || id > 10000) {
    return Response.json({ error: "bad token id" }, { status: 400 });
  }

  let out;
  try {
    // Our mirror first.
    out = await fetchFrom(`${RAW}/${id}.png`, 15000);
  } catch {
    try {
      // Not mirrored yet — whichever IPFS gateway answers first wins.
      out = await Promise.any(GATEWAYS.map((gw) => fetchFrom(gw(id), 45000)));
    } catch {
      return Response.json({ error: "all sources failed" }, { status: 502 });
    }
  }

  return new Response(new Uint8Array(out.buf), {
    status: 200,
    headers: {
      "Content-Type": out.type,
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
    },
  });
}
