import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { HttpError } from "@srv/http";
import { isJob, runJob } from "@srv/jobs";

export const cron = new Hono();

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** For an external scheduler (or a curl in a Render cron job): POST /api/cron/<job> with the x-cron-secret header. */
cron.post("/cron/:name", async (c) => {
  const secret = process.env.CRON_SECRET;
  const given = c.req.header("x-cron-secret") ?? "";
  if (!secret || secret.length < 16 || !same(secret, given)) throw new HttpError("Not allowed", 403);
  const name = c.req.param("name");
  if (!isJob(name)) throw new HttpError("Unknown job", 404);
  return c.json(await runJob(name));
});
