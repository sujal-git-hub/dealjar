import { Hono } from "hono";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@srv/db";
import { HttpError, body, rateLimit, requireUser } from "@srv/http";
import { ensurePool, poolShape } from "@srv/pools";
import { getRates } from "@srv/rates";
import { dealView, sponsorPage } from "@srv/views";
import { parseAddress } from "@srv/nimiq";
import { processImage } from "@srv/images";
import { deleteMedia, saveMedia } from "@srv/storage";
import { newId } from "@srv/ids";
import { MAX_LINKS, isSafeLink } from "@shared/profile";
import { MAX_LUNA, nimToLuna } from "@shared/units";
import { usd } from "@shared/money";
import type { SessionUser } from "@srv/session";

export const studio = new Hono();
const { sponsors, deals, pools, paymentIntents } = schema;

const CATEGORIES = ["Airtime & data", "Groceries", "Food", "Travel", "Learning"] as const;
const MAX_DEALS = 30;
const MAX_RATE_BPS = 2500; // a sponsor can offer at most 25% back

async function mySponsor(user: SessionUser) {
  const db = await getDb();
  const [s] = await db.select().from(sponsors).where(eq(sponsors.userId, user.id)).limit(1);
  return s ?? null;
}
async function requireSponsor(user: SessionUser) {
  const s = await mySponsor(user);
  if (!s) throw new HttpError("Set up your sponsor page first", 403);
  if (s.status === "suspended") throw new HttpError("This sponsor is suspended", 403);
  return s;
}
const activeOnly = (s: { status: string }) => {
  if (s.status !== "active") throw new HttpError("Your sponsor page is waiting for approval. You can add deals as soon as it's approved.", 403);
};

/** Everything the studio screen needs. */
studio.get("/studio", async (c) => {
  const user = await requireUser(c);
  const sp = await mySponsor(user);
  if (!sp) return c.json({ sponsor: null });
  const db = await getDb();
  const rates = await getRates();
  const [pool] = await db.select().from(pools).where(eq(pools.sponsorId, sp.id)).limit(1);
  const mine = await db.select().from(deals).where(and(eq(deals.sponsorId, sp.id), ne(deals.status, "removed"))).orderBy(desc(deals.createdAt));
  const sales = await db
    .select({ dealId: paymentIntents.dealId, n: sql<number>`count(*)::int`, luna: sql<number>`coalesce(sum(${paymentIntents.amountLuna}), 0)::float8` })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.sponsorId, sp.id), eq(paymentIntents.kind, "purchase"), eq(paymentIntents.status, "confirmed")))
    .groupBy(paymentIntents.dealId);
  const by = new Map(sales.map((s) => [s.dealId, s]));
  const topups = await db.select().from(paymentIntents).where(and(eq(paymentIntents.sponsorId, sp.id), eq(paymentIntents.kind, "topup"))).orderBy(desc(paymentIntents.createdAt)).limit(10);
  return c.json({
    sponsor: { ...sponsorPage(sp), status: sp.status, payoutAddress: sp.payoutAddress },
    pool: pool ? poolShape(pool) : null,
    deals: mine.map((d) => ({ ...dealView(d, rates), status: d.status, sold: by.get(d.id)?.n ?? 0, soldLuna: Number(by.get(d.id)?.luna ?? 0) })),
    topups: topups.map((t) => ({ id: t.id, status: t.status, amountLuna: t.amountLuna, at: t.createdAt.toISOString() })),
    canFund: !!process.env.POOL_ADDRESS,
  });
});

const Setup = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters").max(40, "Use 40 characters or fewer"),
  tagline: z.string().trim().max(90, "Keep the tagline under 90 characters").default(""),
  bio: z.string().trim().max(400, "Keep the description under 400 characters").default(""),
  payoutAddress: z.string().trim().min(20, "Enter the Nimiq address that should receive payments").max(60),
});

/** Become a sponsor. Your username is your page address, so you need one first. A person approves new sponsors before deals go live. */
studio.post("/studio/sponsor", async (c) => {
  const user = await requireUser(c);
  rateLimit(`sponsor-new:${user.id}`, 5, 60_000);
  if (!user.username) throw new HttpError("Choose a username first: it becomes your sponsor page address.", 409);
  if (await mySponsor(user)) throw new HttpError("You already have a sponsor page", 409);
  const b = Setup.parse(await body(c));
  const friendly = await parseAddress(b.payoutAddress);
  if (!friendly) throw new HttpError("That doesn't look like a Nimiq address");
  const db = await getDb();
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(sponsors).values({ id, userId: user.id, handle: user.username!, name: b.name, tagline: b.tagline, bio: b.bio, payoutAddress: friendly, status: process.env.DEALJAR_AUTO_APPROVE === "1" ? "active" : "pending" });
    await ensurePool(tx, id);
  });
  return c.json({ id });
});

studio.patch("/studio/sponsor", async (c) => {
  const user = await requireUser(c);
  const sp = await requireSponsor(user);
  rateLimit(`sponsor-edit:${user.id}`, 30, 60_000);
  const b = z
    .object({
      name: Setup.shape.name.optional(),
      tagline: Setup.shape.tagline.optional(),
      bio: Setup.shape.bio.optional(),
      payoutAddress: z.string().trim().min(20).max(60).optional(),
      links: z
        .array(z.object({ label: z.string().trim().min(1).max(24), url: z.string().trim().refine(isSafeLink, "Links must be full https:// addresses") }))
        .max(MAX_LINKS)
        .optional(),
    })
    .parse(await body(c));
  const patch: Partial<typeof sponsors.$inferInsert> = {};
  if (b.name !== undefined) patch.name = b.name;
  if (b.tagline !== undefined) patch.tagline = b.tagline;
  if (b.bio !== undefined) patch.bio = b.bio;
  if (b.links !== undefined) patch.links = JSON.stringify(b.links);
  if (b.payoutAddress !== undefined) {
    const friendly = await parseAddress(b.payoutAddress);
    if (!friendly) throw new HttpError("That doesn't look like a Nimiq address");
    patch.payoutAddress = friendly;
  }
  if (!Object.keys(patch).length) throw new HttpError("Nothing to change");
  const db = await getDb();
  await db.update(sponsors).set(patch).where(eq(sponsors.id, sp.id));
  return c.json({ ok: true });
});

async function readImage(c: import("hono").Context, kind: "avatar" | "banner" | "deal") {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new HttpError("Invalid upload");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError("Choose an image");
  return saveMedia(await processImage(Buffer.from(await file.arrayBuffer()), kind), "webp");
}

studio.put("/studio/sponsor/art/:kind", async (c) => {
  const user = await requireUser(c);
  const sp = await requireSponsor(user);
  rateLimit(`sart:${user.id}`, 20, 10 * 60_000);
  const kind = c.req.param("kind");
  if (kind !== "avatar" && kind !== "banner") throw new HttpError("Unknown artwork type", 404);
  const key = await readImage(c, kind);
  const db = await getDb();
  await db.update(sponsors).set(kind === "avatar" ? { avatarKey: key } : { bannerKey: key }).where(eq(sponsors.id, sp.id));
  const old = kind === "avatar" ? sp.avatarKey : sp.bannerKey;
  if (old) void deleteMedia(old);
  return c.json({ key });
});

studio.delete("/studio/sponsor/art/:kind", async (c) => {
  const user = await requireUser(c);
  const sp = await requireSponsor(user);
  const kind = c.req.param("kind");
  if (kind !== "avatar" && kind !== "banner") throw new HttpError("Unknown artwork type", 404);
  const db = await getDb();
  await db.update(sponsors).set(kind === "avatar" ? { avatarKey: null } : { bannerKey: null }).where(eq(sponsors.id, sp.id));
  const old = kind === "avatar" ? sp.avatarKey : sp.bannerKey;
  if (old) void deleteMedia(old);
  return c.json({ ok: true });
});

const DealBody = z.object({
  title: z.string().trim().min(3, "Give the deal a title").max(60, "Titles are 60 characters at most"),
  summary: z.string().trim().max(300, "Keep the description under 300 characters").default(""),
  category: z.enum(CATEGORIES),
  priceNim: z.number().positive("Set a price").max(MAX_LUNA / 100_000, "That price is above what DealJar allows"),
  rewardPercent: z.number().min(0, "Cashback can't be negative").max(MAX_RATE_BPS / 100, `Cashback is at most ${MAX_RATE_BPS / 100}%`),
  rewardMaxUsd: z.number().min(0).max(1000, "Keep the cap under $1,000"),
  days: z.number().int().min(1, "A deal lasts at least a day").max(180, "A deal lasts at most 180 days"),
  hue: z.number().int().min(0).max(360).optional(),
});

studio.post("/studio/deals", async (c) => {
  const user = await requireUser(c);
  const sp = await requireSponsor(user);
  activeOnly(sp);
  rateLimit(`deal-new:${user.id}`, 20, 60 * 60_000);
  const b = DealBody.parse(await body(c));
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(deals).where(and(eq(deals.sponsorId, sp.id), ne(deals.status, "removed")));
  if (n >= MAX_DEALS) throw new HttpError(`You can have ${MAX_DEALS} deals at a time. Remove one first.`);
  const [pool] = await db.select().from(pools).where(eq(pools.sponsorId, sp.id)).limit(1);
  if (!pool) throw new HttpError("Your reward pot is missing. Contact support.", 500);
  const id = newId();
  await db.insert(deals).values({
    id,
    sponsorId: sp.id,
    poolId: pool.id,
    title: b.title,
    summary: b.summary,
    category: b.category,
    priceLuna: nimToLuna(b.priceNim),
    rewardBps: Math.round(b.rewardPercent * 100),
    rewardMax: usd(b.rewardMaxUsd),
    expiresAt: new Date(Date.now() + b.days * 86_400_000),
    hue: b.hue ?? Math.floor(Math.random() * 360),
  });
  return c.json({ id });
});

async function myDeal(user: SessionUser, id: string) {
  const sp = await requireSponsor(user);
  const db = await getDb();
  const [d] = await db.select().from(deals).where(and(eq(deals.id, id), eq(deals.sponsorId, sp.id))).limit(1);
  if (!d || d.status === "removed") throw new HttpError("Deal not found", 404);
  return d;
}

studio.patch("/studio/deals/:id", async (c) => {
  const user = await requireUser(c);
  const d = await myDeal(user, c.req.param("id"));
  rateLimit(`deal-edit:${user.id}`, 60, 60_000);
  const b = DealBody.partial().extend({ status: z.enum(["live", "hidden"]).optional() }).parse(await body(c));
  const patch: Partial<typeof deals.$inferInsert> = {};
  if (b.title !== undefined) patch.title = b.title;
  if (b.summary !== undefined) patch.summary = b.summary;
  if (b.category !== undefined) patch.category = b.category;
  if (b.priceNim !== undefined) patch.priceLuna = nimToLuna(b.priceNim);
  if (b.rewardPercent !== undefined) patch.rewardBps = Math.round(b.rewardPercent * 100);
  if (b.rewardMaxUsd !== undefined) patch.rewardMax = usd(b.rewardMaxUsd);
  if (b.days !== undefined) patch.expiresAt = new Date(Date.now() + b.days * 86_400_000);
  if (b.hue !== undefined) patch.hue = b.hue;
  if (b.status !== undefined) patch.status = b.status;
  if (!Object.keys(patch).length) throw new HttpError("Nothing to change");
  const db = await getDb();
  await db.update(deals).set(patch).where(eq(deals.id, d.id));
  return c.json({ ok: true });
});

studio.delete("/studio/deals/:id", async (c) => {
  const user = await requireUser(c);
  const d = await myDeal(user, c.req.param("id"));
  const db = await getDb();
  await db.update(deals).set({ status: "removed" }).where(eq(deals.id, d.id));
  return c.json({ ok: true });
});

/** The deal's banner: shown on its card and page. Without one the card is a generated colour. */
studio.put("/studio/deals/:id/art", async (c) => {
  const user = await requireUser(c);
  const d = await myDeal(user, c.req.param("id"));
  rateLimit(`dart:${user.id}`, 30, 10 * 60_000);
  const key = await readImage(c, "deal");
  const db = await getDb();
  await db.update(deals).set({ bannerKey: key }).where(eq(deals.id, d.id));
  if (d.bannerKey) void deleteMedia(d.bannerKey);
  return c.json({ key });
});

studio.delete("/studio/deals/:id/art", async (c) => {
  const user = await requireUser(c);
  const d = await myDeal(user, c.req.param("id"));
  const db = await getDb();
  await db.update(deals).set({ bannerKey: null }).where(eq(deals.id, d.id));
  if (d.bannerKey) void deleteMedia(d.bannerKey);
  return c.json({ ok: true });
});

/** How much one person can earn from the pot, in dollars. */
studio.patch("/studio/pool", async (c) => {
  const user = await requireUser(c);
  const sp = await requireSponsor(user);
  const { perPersonCapUsd } = z.object({ perPersonCapUsd: z.number().min(0.5, "At least $0.50").max(1000, "At most $1,000") }).parse(await body(c));
  const db = await getDb();
  await db.update(pools).set({ perPersonCap: usd(perPersonCapUsd) }).where(eq(pools.sponsorId, sp.id));
  return c.json({ ok: true });
});

