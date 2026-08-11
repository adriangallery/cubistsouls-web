// Artwork upload for the desk — a collab manager drops a file instead of
// hunting for a hosted URL that will 404 in a month.
//
// The image is recompressed server-side (sharp is already in the app for
// /api/render) to a bounded webp and stored IN REDIS as base64, served back
// by /api/giveaways/img/[key]. Self-contained: no bucket, no CDN account,
// nothing new to operate. A giveaway card image at 900px is ~100-250KB webp —
// comfortably inside Upstash's request limits; the hard cap below refuses
// anything that still ends up huge.

import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { redis, sessionFrom, storageConfigured } from "@/lib/giveaways";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ~700KB of base64 → under Upstash's 1MB request ceiling with headroom. */
const MAX_STORED_B64 = 700_000;
const MAX_UPLOAD_BYTES = 8_000_000;

export async function POST(req: Request) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: "sign in with Discord first" }, { status: 401 });
  if (!s.manager) return Response.json({ error: "collab manager access required" }, { status: 403 });
  if (!storageConfigured()) return Response.json({ error: "storage not configured" }, { status: 500 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return Response.json({ error: "bad upload" }, { status: 400 });
  }
  if (!file) return Response.json({ error: "no file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "image too large (8MB max)" }, { status: 413 });
  }

  let b64: string;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    // 900px cap keeps Discord embeds crisp; second pass squeezes stubborn
    // sources (huge PNGs) rather than rejecting them outright.
    let out = await sharp(input).rotate().resize(900, 900, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    if (out.byteLength * 1.34 > MAX_STORED_B64) {
      out = await sharp(input).rotate().resize(640, 640, { fit: "inside", withoutEnlargement: true }).webp({ quality: 62 }).toBuffer();
    }
    b64 = out.toString("base64");
    if (b64.length > MAX_STORED_B64) {
      return Response.json({ error: "image would not compress small enough — try a simpler one" }, { status: 413 });
    }
  } catch {
    return Response.json({ error: "that file is not an image sharp can read" }, { status: 415 });
  }

  const key = randomBytes(12).toString("hex");
  try {
    await redis(["SET", `cs:ga:img:${key}`, b64]);
  } catch {
    return Response.json({ error: "store failed" }, { status: 502 });
  }
  // Absolute on purpose: Discord fetches embed images from wherever the feed
  // says, so a relative path would break the announcement.
  return Response.json(
    { ok: true, url: `https://cubistsouls.com/api/giveaways/img/${key}` },
    { headers: { "Cache-Control": "no-store" } },
  );
}
