// Server-side compositor for the Soul Builder.
//   /api/render?combo=<hex16>
// Composes the 8 recovered trait plates (in zOrder) into a single 768x768 PNG.
//
// Ported from pikkazo-burn/api/render.js — same behaviour, same codes/headers.
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 60;

const RAW = "https://raw.githubusercontent.com/adriangallery/cubist-souls-assets/main";
const MANIFEST_URL = RAW + "/manifest.json";
const SIZE = 768;
const INK = { r: 11, g: 9, b: 8, alpha: 1 }; // --ink

// Cache the manifest in warm-instance module scope (it's tiny + stable).
let _manifest: any = null;
async function getManifest() {
  if (_manifest) return _manifest;
  const r = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("manifest " + r.status);
  _manifest = await r.json();
  return _manifest;
}

// combo = 16 hex chars, 1 byte per category in manifest.categories order,
// value = option index. Returns null if malformed or out of bounds.
function decodeCombo(hex: string | null, categories: any[]) {
  if (typeof hex !== "string") return null;
  hex = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(hex)) return null;
  const state: Record<string, any> = {};
  for (let i = 0; i < categories.length; i++) {
    const b = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const cat = categories[i];
    if (b >= cat.options.length) return null; // reject out-of-bounds
    state[cat.id] = cat.options[b];
  }
  return state;
}

async function fetchLayer(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function GET(req: Request) {
  let manifest;
  try {
    manifest = await getManifest();
  } catch {
    return Response.json({ error: "manifest unavailable" }, { status: 502 });
  }

  const { categories, zOrder } = manifest;
  const combo = new URL(req.url).searchParams.get("combo");
  const state = decodeCombo(combo, categories);
  if (!state) return Response.json({ error: "invalid combo" }, { status: 400 });

  try {
    // Fetch plates in zOrder (bottom → top).
    const buffers = await Promise.all(
      zOrder.map((id: string) => {
        const cat = categories.find((c: any) => c.id === id);
        return fetchLayer(`${RAW}/${cat.dir}/${state[id].file}`);
      })
    );

    const png = await sharp({
      create: { width: SIZE, height: SIZE, channels: 4, background: INK },
    })
      .composite(buffers.map((input) => ({ input, top: 0, left: 0 })))
      .png()
      .toBuffer();

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
      },
    });
  } catch {
    return Response.json({ error: "compose failed" }, { status: 502 });
  }
}
