import { Hono } from "hono";
import { mediaSize, openMedia } from "@srv/storage";

export const images = new Hono();

// Artwork is public (it is the shop window) and every upload gets a fresh random key, so a URL's content
// never changes: it can be cached for a year. Only keys we generated (uuid.webp) are ever served.
images.get("/img/:key", async (c) => {
  const key = c.req.param("key");
  if (!/^[0-9a-f-]{36}\.webp$/.test(key)) return c.text("Not found", 404);
  const size = await mediaSize(key);
  if (!size) return c.text("Not found", 404);
  return new Response(await openMedia(key, 0, size - 1), {
    headers: {
      "content-type": "image/webp",
      "content-length": String(size),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
});
