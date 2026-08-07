// Image proxy for Cubist Souls / the burn page. Serves the original Pikkazo
// artwork for a token id.
//
// Ported from pikkazo-burn/api/img.js — behaviour identical: mirror first, then
// race IPFS gateways; same status codes, same Cache-Control.

export const runtime = "nodejs";
export const maxDuration = 60;

import sharp from "sharp";

// THUMBNAILS. The original art is ~330 KB at full resolution. A picker grid draws
// it at sixty pixels, so asking for thirty of them means downloading TEN MEGABYTES
// to paint a sheet of stamps — which is why that grid sat empty for ten seconds
// on a first visit.
//
// `?w=` serves a resized copy instead. Sizes are an ALLOWLIST, not a free number:
// an open parameter would let anyone mint unbounded cache entries and make the
// mini resize all day.
const THUMB_SIZES = new Set([96, 160, 256, 512]);

// Resized copies are kept in memory: the source art is immutable, so a given
// (id, width) can never mean a different picture. Bounded so it cannot grow into
// the container's memory — the museum has 10k tokens and this only ever holds the
// few hundred anyone actually browses.
const MAX_THUMBS = 600;
const thumbs = new Map<string, Buffer>();

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
  const params = new URL(req.url).searchParams;
  const id = Number(params.get("id"));
  if (!Number.isInteger(id) || id < 1 || id > 10000) {
    return Response.json({ error: "bad token id" }, { status: 400 });
  }
  const wRaw = Number(params.get("w"));
  const w = THUMB_SIZES.has(wRaw) ? wRaw : 0;

  if (w) {
    const hit = thumbs.get(`${id}:${w}`);
    if (hit) return thumbResponse(hit);
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

  if (w) {
    try {
      const small = await sharp(out.buf).resize(w, w, { fit: "inside" }).png({ quality: 90 }).toBuffer();
      // simple bound: once full, forget the oldest insertion
      if (thumbs.size >= MAX_THUMBS) thumbs.delete(thumbs.keys().next().value as string);
      thumbs.set(`${id}:${w}`, small);
      return thumbResponse(small);
    } catch {
      // a resize hiccup must not cost the caller its picture — fall through to
      // the original rather than returning nothing
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

function thumbResponse(buf: Buffer): Response {
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      // The URL names its own content (id + width, and the art never changes).
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
