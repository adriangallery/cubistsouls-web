// Reaper image compositor — the on-chain-aware artwork for a Soul.
//   /api/reaper-img?id=<id>
//
// A Soul that has forged one or more Reaper marks shows COMPOSED art: the token's
// own official vector stack (traits/index.json + the artist SVG set, in the real
// generator z-order — same engine as public/builder.html and lib/reaper.ts) with
// each forged mark SUBSTITUTING its category:
//   Orange → Art Background · Burning Soul → Base · Flame Crown → Head · Phoenix → FX top.
//
// A Soul with NO marks is indistinguishable from a normal Soul, so we redirect to
// the plain /api/img (its immutable Pikkazo artwork). api/meta only points `image`
// here once marks>0, so the redirect path is a safety net + the try-on/preview case.
//
// FAIL-OPEN: any RPC hiccup, missing layer data, or empty stack → redirect to
// /api/img. The image URL never 500s.
//
// Preview / try-on / test: `?marks=0,3` forces a mark set and SKIPS the chain read,
// so the compositor can be exercised without an on-chain reaper (used by the try-on
// carousel and by scripts/reaper-img-check.mjs).

import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";
import {
  bitmaskToMarkIds,
  baseLayersOf,
  composeFromBase,
  type LayerData,
  type TraitsIdx,
} from "@/lib/reaper";

export const runtime = "nodejs";
export const maxDuration = 60;

const SOULS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406";
const SEL_MARKS_OF = "0xfb115701"; // marksOf(uint256) -> uint256 bitmask
const SEL_SOULS_CONSUMED = "0x5b99ce59"; // soulsConsumed(uint256) -> uint256
const RPC = "https://gateway.tenderly.co/public/mainnet"; // only gateway that answers from a datacenter IP
const TRAITS_URL =
  "https://raw.githubusercontent.com/adriangallery/cubist-souls-assets/main/traits/index.json";
const PUBLIC_DIR = path.join(process.cwd(), "public");
const MANIFEST_PATH = path.join(PUBLIC_DIR, "assets/traits-svg/manifest.json");
const SIZE = 1536; // 2× the 768 viewBox — vectors scale for free (matches builder-test)
const INK = { r: 11, g: 9, b: 8, alpha: 1 }; // --ink, so any un-filled gap reads as the wall, never white

type Manifest = { categories: { label: string; options: { label: string; file: string }[] }[] };

// ---- warm-instance caches (layer data is stable; marks change, so no read cache) ----
let _layerData: LayerData | null = null;

async function loadLayerDataServer(): Promise<LayerData | null> {
  if (_layerData) return _layerData;
  try {
    const [traits, manifestRaw] = await Promise.all([
      fetch(TRAITS_URL, { signal: AbortSignal.timeout(15000) }).then(
        (r) => r.json() as Promise<TraitsIdx>,
      ),
      fs.readFile(MANIFEST_PATH, "utf8").then((s) => JSON.parse(s) as Manifest),
    ]);
    const fileFor = new Map<string, Map<string, string>>();
    for (const c of manifestRaw.categories) {
      const inner = new Map<string, string>();
      for (const o of c.options) inner.set(o.label, o.file);
      fileFor.set(c.label, inner);
    }
    _layerData = { traits, fileFor };
    return _layerData;
  } catch {
    return null;
  }
}

async function ethCall(data: string): Promise<bigint | null> {
  try {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: SOULS, data }, "latest"] }),
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    const j = await r.json();
    if (j?.error || !j?.result || j.result === "0x") return null;
    return BigInt(j.result);
  } catch {
    return null;
  }
}

// Worn marks under the MILESTONE economy (26-jul): unlocked by cumulative
// consumption — Orange@6, Flame Crown@12, Phoenix@18, Burning Soul@30 — unioned
// with any legacy forged bits on-chain. Null on total RPC failure (fail-open).
const MILESTONES = [6, 12, 18, 30];
async function readMarks(id: number): Promise<bigint | null> {
  const hexId = id.toString(16).padStart(64, "0");
  const [mask, consumed] = await Promise.all([
    ethCall(SEL_MARKS_OF + hexId),
    ethCall(SEL_SOULS_CONSUMED + hexId),
  ]);
  if (mask === null && consumed === null) return null;
  let m = mask ?? 0n;
  const c = Number(consumed ?? 0n);
  MILESTONES.forEach((t, i) => { if (c >= t) m |= 1n << BigInt(i); });
  return m;
}

function imgRedirect(origin: string, id: number): Response {
  return Response.redirect(`${origin}/api/img?id=${id}`, 307);
}

// Rasterize one 768-viewBox SVG (from the local public set) to a SIZE×SIZE PNG.
async function rasterLayer(src: string): Promise<Buffer | null> {
  try {
    const abs = path.join(PUBLIC_DIR, src.replace(/^\//, ""));
    const svg = await fs.readFile(abs);
    return await sharp(svg, { density: Math.round(72 * (SIZE / 768)) })
      .resize(SIZE, SIZE, { fit: "fill" })
      .png()
      .toBuffer();
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

  // Resolve worn marks. `?marks=` forces a set (preview/try-on/test) and skips chain.
  let markIds: number[];
  const forced = url.searchParams.get("marks");
  if (forced !== null) {
    markIds = forced
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 7);
  } else {
    const mask = await readMarks(id); // null = RPC failed → fail-open to plain art
    markIds = mask === null ? [] : bitmaskToMarkIds(mask);
  }

  // No marks (or RPC unavailable) → the plain immutable Pikkazo artwork.
  if (markIds.length === 0) return imgRedirect(origin, id);

  const data = await loadLayerDataServer();
  if (!data) return imgRedirect(origin, id); // layer data unavailable → fail-open

  const stack = composeFromBase(baseLayersOf(id, data), markIds);
  if (stack.length === 0) return imgRedirect(origin, id); // nothing to draw (e.g. 1/1 with no vector set)

  const layers = await Promise.all(stack.map(rasterLayer));
  const composites = layers
    .filter((b): b is Buffer => b !== null)
    .map((input) => ({ input, top: 0, left: 0 }));
  if (composites.length === 0) return imgRedirect(origin, id); // every layer failed to read → fail-open

  try {
    const png = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: INK } })
      .composite(composites)
      .png()
      .toBuffer();
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        // Short cache: on-chain marks can change; refresh reasonably fast.
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch {
    return imgRedirect(origin, id); // compose failed → fail-open to plain art
  }
}
