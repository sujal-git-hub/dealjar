import { Hono } from "hono";
import { z } from "zod";
import { body, rateLimit, requireUser } from "@srv/http";
import { cashoutsOf, convert, jarOf, requestCashout, JarError } from "@srv/jar";
import { claimReferral, referralSummary, ReferralError } from "@srv/referrals";
import { getRates } from "@srv/rates";
import { HttpError } from "@srv/http";

export const jar = new Hono();

const asset = z.enum(["USDT", "EURE", "XAUT0"]);

function wrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (e instanceof JarError || e instanceof ReferralError) throw new HttpError(e.message, e.status);
    throw e;
  });
}

jar.get("/jar", async (c) => {
  const user = await requireUser(c);
  const rates = await getRates();
  return c.json({ ...(await jarOf(user)), cashouts: await cashoutsOf(user.id), nimUsd: rates.nimUsd });
});

jar.post("/jar/convert", async (c) => {
  const user = await requireUser(c);
  rateLimit(`convert:${user.id}`, 30, 60_000);
  const b = z.object({ from: asset, to: asset, amount: z.number().int().positive() }).parse(await body(c));
  return c.json(await wrap(convert(user, b.from, b.to, b.amount)));
});

jar.post("/jar/cashout", async (c) => {
  const user = await requireUser(c);
  rateLimit(`cashout:${user.id}`, 10, 60_000);
  const b = z.object({ asset, amount: z.number().int().positive() }).parse(await body(c));
  return c.json(await wrap(requestCashout(user, b.asset, b.amount)));
});

jar.get("/referral", async (c) => {
  const user = await requireUser(c);
  return c.json(await referralSummary(user));
});

jar.post("/referral/claim", async (c) => {
  const user = await requireUser(c);
  rateLimit(`refclaim:${user.id}`, 10, 60_000);
  const b = z.object({ code: z.string().trim().min(6).max(20), deviceId: z.string().min(16).max(64) }).parse(await body(c));
  return c.json(await wrap(claimReferral(user, b.code, b.deviceId)));
});
