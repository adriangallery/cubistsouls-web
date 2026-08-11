// Serves an uploaded giveaway artwork out of Redis. Immutable: a key is
// random and written exactly once, so clients and Cloudflare may cache hard.

import { redis, storageConfigured } from "@/lib/giveaways";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { key: string } }) {
  const key = params.key;
  if (!/^[0-9a-f]{24}$/.test(key)) return new Response("bad key", { status: 400 });
  if (!storageConfigured()) return new Response("storage not configured", { status: 500 });

  const b64 = (await redis(["GET", `cs:ga:img:${key}`]).catch(() => null)) as string | null;
  if (!b64) return new Response("not found", { status: 404 });

  return new Response(Buffer.from(b64, "base64"), {
    headers: {
      "content-type": "image/webp",
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
    },
  });
}
