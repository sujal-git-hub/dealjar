// Artwork uploads. Every image is decoded, resized and re-encoded as WebP on the server, which:
//  - proves it really is an image (a renamed .exe or HTML file is rejected, not stored),
//  - strips EXIF (photos carry GPS locations) and any embedded payload,
//  - keeps files small enough for a phone on mobile data.
import sharp from "sharp";
import { HttpError } from "./http";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const OK_FORMATS = new Set(["jpeg", "png", "webp"]);

export type ArtKind = "avatar" | "banner" | "deal";
const SIZES: Record<ArtKind, { w: number; h: number }> = {
  avatar: { w: 512, h: 512 },
  banner: { w: 1200, h: 400 },
  deal: { w: 1200, h: 630 },
};

export async function processImage(input: Buffer, kind: ArtKind): Promise<Buffer> {
  if (input.length === 0) throw new HttpError("Choose an image");
  if (input.length > MAX_IMAGE_BYTES) throw new HttpError("Images must be under 5 MB");
  try {
    const img = sharp(input, { limitInputPixels: 40_000_000 });
    const meta = await img.metadata();
    if (!meta.format || !OK_FORMATS.has(meta.format)) throw new Error("format");
    const { w, h } = SIZES[kind];
    return await img.rotate().resize(w, h, { fit: "cover", position: "attention" }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw new HttpError("That isn't a usable image. Use a JPEG, PNG or WebP under 5 MB.");
  }
}
