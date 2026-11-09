import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@srv/db";
import { HttpError, body, requireAdmin } from "@srv/http";
import { markCashoutPaid, rejectCashout, JarError } from "@srv/jar";
import { JOBS, isJob, runJob } from "@srv/jobs";
import { getRates, setRate } from "@srv/rates";
import { platformPool } from "@srv/views";

export const admin = new Hono();
const { sponsors, deals, reports, cashouts, jobRuns, referrals, users } = schema;

admin.get("/admin", async (c) => {
  await requireAdmin(c);
  const db = await getDb();
  const [sp, rp, co, runs, blocked, counts] = await Promise.all([
    db.select().from(sponsors).orderBy(desc(sponsors.createdAt)).limit(100),
    db.select({ r: reports, title: deals.title }).from(reports).innerJoin(deals, eq(deals.id, reports.dealId)).where(eq(reports.status, "open")).orderBy(desc(reports.createdAt)).limit(50),
    db.select().from(cashouts).where(eq(cashouts.status, "pending")).orderBy(cashouts.createdAt).limit(100),
    db.select().from(jobRuns).orderBy(desc(jobRuns.ranAt)).limit(30),
    db.select().from(referrals).where(eq(referrals.status, "blocked")).orderBy(desc(referrals.createdAt)).limit(30),
    db.select({ members: sql<number>`(select count(*) from users)::int`, purchases: sql<number>`(select count(*) from payment_intents where kind = 'purchase' and status = 'confirmed')::int`, pending: sql<number>`(select count(*) from payment_intents where status = 'pending')::int` }).from(sql`(select 1) t`),
  ]);
  const rates = await getRates();
  return c.json({
    sponsors: sp.map((s) => ({ id: s.id, handle: s.handle, name: s.name, status: s.status, verified: s.verified, demo: s.demo, payoutAddress: s.payoutAddress, createdAt: s.createdAt })),
    reports: rp.map(({ r, title }) => ({ id: r.id, dealId: r.dealId, dealTitle: title, reason: r.reason, at: r.createdAt })),
    cashouts: co.map((x) => ({ id: x.id, amount: x.amount, amountLuna: x.amountLuna, address: x.address, at: x.createdAt })),
    jobs: runs.map((j) => ({ id: j.id, name: j.name, ok: j.ok, detail: j.detail, at: j.ranAt })),
    jobNames: Object.keys(JOBS),
    blockedReferrals: blocked.map((r) => ({ id: r.id, reason: r.reason, at: r.createdAt })),
    platform: await platformPool(),
    counts: counts[0],
    rates: { nimUsd: rates.nimUsd, live: rates.live, updatedAt: rates.updatedAt },
  });
});

admin.post("/admin/sponsors/:id", async (c) => {
  await requireAdmin(c);
  const { action } = z.object({ action: z.enum(["approve", "suspend", "verify", "unverify"]) }).parse(await body(c));
  const patch = action === "approve" ? { status: "active" } : action === "suspend" ? { status: "suspended" } : { verified: action === "verify" };
  const db = await getDb();
  const done = await db.update(sponsors).set(patch).where(eq(sponsors.id, c.req.param("id"))).returning({ id: sponsors.id });
  if (!done.length) throw new HttpError("Sponsor not found", 404);
  return c.json({ ok: true });
});

admin.post("/admin/deals/:id", async (c) => {
  await requireAdmin(c);
  const { action } = z.object({ action: z.enum(["hide", "remove", "restore"]) }).parse(await body(c));
  const db = await getDb();
  const done = await db.update(deals).set({ status: action === "hide" ? "hidden" : action === "remove" ? "removed" : "live" }).where(eq(deals.id, c.req.param("id"))).returning({ id: deals.id });
  if (!done.length) throw new HttpError("Deal not found", 404);
  return c.json({ ok: true });
});

admin.post("/admin/reports/:id", async (c) => {
  await requireAdmin(c);
  const { action } = z.object({ action: z.enum(["actioned", "dismissed"]) }).parse(await body(c));
  const db = await getDb();
  await db.update(reports).set({ status: action }).where(eq(reports.id, c.req.param("id")));
  return c.json({ ok: true });
});

admin.post("/admin/cashouts/:id/paid", async (c) => {
  await requireAdmin(c);
  const { txHash } = z.object({ txHash: z.string().min(8).max(128) }).parse(await body(c));
  try {
    return c.json(await markCashoutPaid(c.req.param("id"), txHash));
  } catch (e) {
    if (e instanceof JarError) throw new HttpError(e.message, e.status);
    throw e;
  }
});

admin.post("/admin/cashouts/:id/reject", async (c) => {
  await requireAdmin(c);
  const { note } = z.object({ note: z.string().trim().min(3).max(200) }).parse(await body(c));
  try {
    return c.json(await rejectCashout(c.req.param("id"), note));
  } catch (e) {
    if (e instanceof JarError) throw new HttpError(e.message, e.status);
    throw e;
  }
});

admin.post("/admin/users/:id/suspend", async (c) => {
  const me = await requireAdmin(c);
  const { suspended } = z.object({ suspended: z.boolean() }).parse(await body(c));
  if (c.req.param("id") === me.id) throw new HttpError("You can't suspend yourself");
  const db = await getDb();
  await db.update(users).set({ suspended }).where(eq(users.id, c.req.param("id")));
  return c.json({ ok: true });
});

admin.post("/admin/rates", async (c) => {
  await requireAdmin(c);
  const { nimUsd } = z.object({ nimUsd: z.number().positive().max(10) }).parse(await body(c));
  await setRate("nim_usd", nimUsd, "admin");
  return c.json({ ok: true });
});

admin.post("/admin/jobs/:name", async (c) => {
  await requireAdmin(c);
  const name = c.req.param("name");
  if (!isJob(name)) throw new HttpError("Unknown job", 404);
  return c.json(await runJob(name));
});

