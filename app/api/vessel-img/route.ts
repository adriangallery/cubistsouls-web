// Memento Mori image compositor — the artwork of a union.
//   /api/vessel-img?id=<id>
//
// A Memento Mori is minted over a canvas a reaper burned long ago: it wears that
// canvas's recovered art with the DEATH MASK painted over every other layer.
// This route composites the two so marketplaces show the real piece from day one
// (the on-chain renderer paints the same layer once its cut lands).
//
// `?force=1` skips the chain read — used by the museum's preview, so a piece can
// be previewed before it is fused.
//
// FAIL-OPEN: bad id, RPC hiccup, missing mask, or a compose error → redirect to
// the plain /api/img. The image URL never 500s.

import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 60;

const SOULS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406";
const SEL_IS_VESSEL = "0x1afdd161"; // isVesselToken(uint256)
const RPC = "https://gateway.tenderly.co/public/mainnet"; // the gateway that answers datacenter IPs
const MASK_PATH = path.join(process.cwd(), "public/assets/traits-svg/vessel-fx/memento-mori-a.svg");
const SIZE = 1536; // 2× the 768 viewBox — vectors scale for free

function imgRedirect(origin: string, id: number) {
  return Response.redirect(`${origin}/api/img?id=${id}`, 302);
}

async function isVessel(id: number): Promise<boolean | null> {
  try {
    const data = SEL_IS_VESSEL + id.toString(16).padStart(64, "0");
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: SOULS, data }, "latest"] }),
      signal: AbortSignal.timeout(4000),
    });
    const j = await r.json();
    if (j.error || !j.result || j.result === "0x") return null;
    return BigInt(j.result) !== 0n;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1 || id > 10000) {
    return Response.json({ error: "bad token id" }, { status: 400 });
  }

  if (url.searchParams.get("force") !== "1") {
    const vessel = await isVessel(id);
    // not a union (or the chain didn't answer) → the plain artwork, never a lie
    if (vessel !== true) return imgRedirect(origin, id);
  }

  try {
    const [baseRes, maskSvg] = await Promise.all([
      fetch(`${origin}/api/img?id=${id}`, { signal: AbortSignal.timeout(20000) }),
      fs.readFile(MASK_PATH),
    ]);
    if (!baseRes.ok) return imgRedirect(origin, id);
    const base = Buffer.from(await baseRes.arrayBuffer());

    const [art, mask] = await Promise.all([
      sharp(base).resize(SIZE, SIZE, { fit: "fill" }).png().toBuffer(),
      sharp(maskSvg, { density: 200 }).resize(SIZE, SIZE, { fit: "fill" }).png().toBuffer(),
    ]);
    const png = await sharp(art).composite([{ input: mask, top: 0, left: 0 }]).png().toBuffer();

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return imgRedirect(origin, id);
  }
}
