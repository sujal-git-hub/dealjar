import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

/**
 * Image store. Two backends, chosen by env:
 *  - S3-compatible when S3_BUCKET is set. Supabase Storage has an S3 endpoint
 *    (https://<project>.storage.supabase.co/storage/v1/s3), and R2 or AWS S3 work the same way.
 *  - Local disk otherwise (./.data/media), which is for development.
 * Everything stored here has been decoded and re-encoded as WebP by images.ts, so it is always a safe image.
 */
const ROOT = path.resolve(process.env.MEDIA_DIR ?? "./.data/media");
const BUCKET = process.env.S3_BUCKET;

let s3Client: Promise<import("@aws-sdk/client-s3").S3Client> | undefined;
async function s3() {
  s3Client ??= import("@aws-sdk/client-s3").then(
    ({ S3Client }) =>
      new S3Client({
        region: process.env.S3_REGION ?? "auto",
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: true,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
      }),
  );
  return s3Client;
}

const safeKey = (key: string) => path.basename(key);

export async function saveMediaAs(key: string, data: Buffer): Promise<void> {
  const k = safeKey(key);
  if (BUCKET) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await s3()).send(new PutObjectCommand({ Bucket: BUCKET, Key: k, Body: data, ContentType: "image/webp" }));
    return;
  }
  await mkdir(ROOT, { recursive: true });
  await writeFile(path.join(ROOT, k), data);
}

export async function saveMedia(data: Buffer, ext = "webp"): Promise<string> {
  const key = `${randomUUID()}.${ext}`;
  await saveMediaAs(key, data);
  return key;
}

/** Best-effort removal (replaced or removed artwork). A missing file is fine. */
export async function deleteMedia(key: string): Promise<void> {
  const k = safeKey(key);
  try {
    if (BUCKET) {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      await (await s3()).send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k }));
    } else await unlink(path.join(ROOT, k));
  } catch {
    /* already gone */
  }
}

export async function mediaSize(key: string): Promise<number | null> {
  const k = safeKey(key);
  try {
    if (BUCKET) {
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
      const head = await (await s3()).send(new HeadObjectCommand({ Bucket: BUCKET, Key: k }));
      return head.ContentLength ?? null;
    }
    return (await stat(path.join(ROOT, k))).size;
  } catch {
    return null;
  }
}

/** Streams bytes [start, end] (inclusive) of a stored file. */
export async function openMedia(key: string, start: number, end: number): Promise<ReadableStream> {
  const k = safeKey(key);
  if (BUCKET) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (await s3()).send(new GetObjectCommand({ Bucket: BUCKET, Key: k, Range: `bytes=${start}-${end}` }));
    if (!res.Body) throw new Error("Empty media body");
    return res.Body.transformToWebStream();
  }
  return Readable.toWeb(createReadStream(path.join(ROOT, k), { start, end })) as unknown as ReadableStream;
}
