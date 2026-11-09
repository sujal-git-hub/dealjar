import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@srv/db";
import { HttpError, body, rateLimit, requireUser } from "@srv/http";
import { checkIntent, confirmIntent, createPurchase, createTopup } from "@srv/payments";
import { PLATFORM } from "@srv/pools";

export const payments = new Hono();

const view = (i: { id: string; amountLuna: number; recipient: string; memo: string }) => ({ id: i.id, amountLuna: i.amountLuna, recipient: i.recipient, memo: i.memo });

/**
 * Start a payment. A purchase reserves the reward from the sponsor's real pot first; a top-up is a sponsor (or an admin,
 * for the referral pot) paying NIM into the pot address. Either way the wallet pays with the memo, and the server
 * only believes the chain.
 */
payments.post("/payments/intent", async (c) => {
  const user = await requireUser(c);
  rateLimit(`intent:${user.id}`, 20, 60_000);
  const b = z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("purchase"), dealId: z.string().min(4).max(40) }),
      z.object({ kind: z.literal("topup"), amountNim: z.number().positive(), target: z.enum(["mine", "platform"]).default("mine") }),
    ])
    .parse(await body(c));
  if (b.kind === "purchase") return c.json({ intent: view(await createPurchase(user, b.dealId)) });

  const db = await getDb();
  if (b.target === "platform") {
    if (user.role !== "admin") throw new HttpError("Admins only", 403);
    return c.json({ intent: view(await createTopup(user, PLATFORM, b.amountNim)) });
  }
  const [sp] = await db.select().from(schema.sponsors).where(eq(schema.sponsors.userId, user.id)).limit(1);
  if (!sp || sp.status !== "active") throw new HttpError("Only approved sponsors can fund a pot", 403);
  return c.json({ intent: view(await createTopup(user, sp.id, b.amountNim)) });
});

payments.post("/payments/confirm", async (c) => {
  const user = await requireUser(c);
  rateLimit(`confirm:${user.id}`, 120, 60_000);
  const { intentId, txHash } = z.object({ intentId: z.string().min(4).max(40), txHash: z.string().min(8).max(128) }).parse(await body(c));
  return c.json(await confirmIntent(user, intentId, txHash));
});

/** For a payment made by hand from any wallet: poll this and the server finds it by its memo. */
payments.get("/payments/check/:id", async (c) => {
  const user = await requireUser(c);
  rateLimit(`check:${user.id}`, 120, 60_000);
  return c.json(await checkIntent(user, c.req.param("id")));
});
