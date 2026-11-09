import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@srv/db";
import { HttpError, body, rateLimit, requireUser } from "@srv/http";
import { getUser } from "@srv/session";
import { getRates } from "@srv/rates";
import { dealView, catalog, platformPool, publicLedger, sponsorPage, sponsorView } from "@srv/views";
import { earnedFromPool, poolShape } from "@srv/pools";
import { newId } from "@srv/ids";

export const catalogRoutes = new Hono();
const { deals, sponsors, pools, reports } = schema;

catalogRoutes.get("/catalog", async (c) => c.json(await catalog()));

catalogRoutes.get("/ledger", async (c) => c.json({ ledger: await publicLedger(), platform: await platformPool() }));

catalogRoutes.get("/rates", async (c) => {
  const r = await getRates();
  return c.json({ nimUsd: r.nimUsd, eurUsd: r.eurUsd, xauUsd: r.xauUsd, live: r.live, updatedAt: r.updatedAt });
});

/** One deal with its sponsor and its pot, and what the signed-in person has already earned from that pot. */
catalogRoutes.get("/deals/:id", async (c) => {
  const db = await getDb();
  const rates = await getRates();
  const [row] = await db.select().from(deals).where(eq(deals.id, c.req.param("id"))).limit(1);
  if (!row || row.status === "removed") throw new HttpError("Deal not found", 404);
  const [sp] = await db.select().from(sponsors).where(eq(sponsors.id, row.sponsorId)).limit(1);
  const viewer = await getUser(c);
  const isOwner = !!viewer && sp?.userId === viewer.id;
  // A hidden deal or an unapproved sponsor is only visible to its owner.
  if ((row.status !== "live" || sp?.status !== "active") && !isOwner && viewer?.role !== "admin") throw new HttpError("Deal not found", 404);
  const [pool] = await db.select().from(pools).where(eq(pools.id, row.poolId)).limit(1);
  const earned = viewer && pool ? await earnedFromPool(db, pool.id, viewer.id) : 0;
  return c.json({ deal: dealView(row, rates), sponsor: sp ? sponsorView(sp) : null, pool: pool ? poolShape(pool) : null, earned, nimUsd: rates.nimUsd });
});

/** A sponsor's public page: who they are, their live deals, and the pot behind them. */
catalogRoutes.get("/sponsors/:handle", async (c) => {
  const db = await getDb();
  const rates = await getRates();
  const handle = c.req.param("handle").toLowerCase();
  const [sp] = await db.select().from(sponsors).where(eq(sponsors.handle, handle)).limit(1);
  const viewer = await getUser(c);
  if (!sp || (sp.status !== "active" && viewer?.id !== sp.userId && viewer?.role !== "admin")) throw new HttpError("No sponsor here", 404);
  const dealRows = await db.select().from(deals).where(and(eq(deals.sponsorId, sp.id), eq(deals.status, "live")));
  const [pool] = await db.select().from(pools).where(eq(pools.sponsorId, sp.id)).limit(1);
  return c.json({ sponsor: sponsorPage(sp), status: sp.status, deals: dealRows.map((d) => dealView(d, rates)), pool: pool ? poolShape(pool) : null, isMine: viewer?.id === sp.userId });
});

/** Anyone signed in can flag a deal; an admin looks at the open reports. */
catalogRoutes.post("/deals/:id/report", async (c) => {
  const user = await requireUser(c);
  rateLimit(`report:${user.id}`, 10, 60 * 60_000);
  const { reason } = z.object({ reason: z.string().trim().min(5, "Tell us a little more").max(300, "Keep it under 300 characters") }).parse(await body(c));
  const db = await getDb();
  const [row] = await db.select({ id: deals.id }).from(deals).where(eq(deals.id, c.req.param("id"))).limit(1);
  if (!row) throw new HttpError("Deal not found", 404);
  await db.insert(reports).values({ id: newId(), userId: user.id, dealId: row.id, reason });
  return c.json({ ok: true });
});
