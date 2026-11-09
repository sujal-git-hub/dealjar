import { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@srv/db";
import { HttpError, body, rateLimit, requireUser } from "@srv/http";
import { clearSession } from "@srv/session";
import { reconcileSoon } from "@srv/payments";
import { deleteMedia } from "@srv/storage";
import { cashoutsOf, holdingsOf } from "@srv/jar";

export const account = new Hono();
const { users, paymentIntents, deals, sponsors, jarEntries, referrals, cashouts } = schema;

/** What this person paid, newest first: confirmed payments, plus ones still being checked. Failed attempts are not listed. */
async function receiptsFor(userId: string) {
  const db = await getDb();
  const rows = await db.select().from(paymentIntents).where(eq(paymentIntents.userId, userId)).orderBy(desc(paymentIntents.createdAt)).limit(200);
  const shown = rows.filter((r) => r.status === "confirmed" || (r.status === "pending" && Date.now() - r.createdAt.getTime() < 7 * 86_400_000));
  const dealIds = [...new Set(shown.map((r) => r.dealId).filter((x): x is string => !!x))];
  const sponsorIds = [...new Set(shown.map((r) => r.sponsorId))];
  const [dl, sp] = await Promise.all([
    dealIds.length ? db.select({ id: deals.id, title: deals.title }).from(deals).where(inArray(deals.id, dealIds)) : [],
    sponsorIds.length ? db.select({ id: sponsors.id, name: sponsors.name }).from(sponsors).where(inArray(sponsors.id, sponsorIds)) : [],
  ]);
  const title = new Map(dl.map((d) => [d.id, d.title]));
  const name = new Map(sp.map((s) => [s.id, s.name]));
  return shown.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status as "confirmed" | "pending",
    item: r.kind === "topup" ? "Reward pot deposit" : ((r.dealId && title.get(r.dealId)) || "Removed deal"),
    sponsor: name.get(r.sponsorId) ?? "Sponsor",
    amountLuna: r.amountLuna,
    rewardMicro: r.rewardState === "paid" ? r.rewardMicro : 0,
    rewardState: r.rewardState,
    txHash: r.txHash,
    at: (r.confirmedAt ?? r.createdAt).toISOString(),
  }));
}

account.get("/me/receipts", async (c) => {
  const user = await requireUser(c);
  await reconcileSoon({ userId: user.id });
  return c.json({ receipts: await receiptsFor(user.id) });
});

/** Everything DealJar holds about this account, as a download. */
account.get("/me/export", async (c) => {
  const user = await requireUser(c);
  rateLimit(`export:${user.id}`, 5, 60_000);
  const db = await getDb();
  const [jar, refs, receipts, outs] = await Promise.all([
    db.select().from(jarEntries).where(eq(jarEntries.userId, user.id)),
    db.select({ status: referrals.status, reward: referrals.reward, createdAt: referrals.createdAt }).from(referrals).where(eq(referrals.referrerId, user.id)),
    receiptsFor(user.id),
    cashoutsOf(user.id),
  ]);
  c.header("content-disposition", 'attachment; filename="dealjar-my-data.json"');
  return c.json({
    exportedAt: new Date().toISOString(),
    account: { id: user.id, name: user.displayName, username: user.username, bio: user.bio, address: user.address, role: user.role, currency: user.currency, createdAt: user.createdAt },
    jar,
    holdings: await holdingsOf(user.id),
    cashouts: outs,
    referrals: refs,
    receipts,
  });
});

/**
 * Deletes an account: personal details are removed and the account is anonymised. Payment records are kept (they are
 * financial history shared with the sponsor) but no longer point at a name or a wallet. Sponsors, admins, and anyone
 * with money in the jar or a payment in flight can't delete here, so nothing is lost or left dangling.
 */
account.delete("/me", async (c) => {
  const user = await requireUser(c);
  rateLimit(`delete:${user.id}`, 3, 60_000);
  z.object({ confirm: z.literal("DELETE", { error: "Type DELETE to confirm" }) }).parse(await body(c));
  const db = await getDb();
  const [sp] = await db.select({ id: sponsors.id }).from(sponsors).where(eq(sponsors.userId, user.id)).limit(1);
  if (user.role !== "member" || sp) throw new HttpError("Sponsor and admin accounts can't be deleted here. Ask an admin.", 403);
  const held = Object.values(await holdingsOf(user.id)).reduce((s, v) => s + v, 0);
  if (held > 0) throw new HttpError("Cash out or spend what's in your jar first, then delete your account.", 409);
  const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(paymentIntents).where(and(eq(paymentIntents.userId, user.id), eq(paymentIntents.status, "pending")));
  const [waiting] = await db.select({ n: sql<number>`count(*)::int` }).from(cashouts).where(and(eq(cashouts.userId, user.id), eq(cashouts.status, "pending")));
  if ((open?.n ?? 0) > 0 || (waiting?.n ?? 0) > 0) throw new HttpError("You have a payment or cash-out in progress. Try again once it has finished.", 409);
  await db.transaction(async (tx) => {
    await tx.delete(jarEntries).where(eq(jarEntries.userId, user.id));
    await tx
      .update(users)
      .set({ displayName: "Deleted account", address: `deleted-${user.id}`, username: null, avatarKey: null, bannerKey: null, bio: "", links: "[]", accent: "", referralCode: null })
      .where(eq(users.id, user.id));
  });
  for (const k of [user.avatarKey, user.bannerKey]) if (k) void deleteMedia(k);
  clearSession(c);
  return c.json({ ok: true });
});
