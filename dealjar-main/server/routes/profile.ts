import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@srv/db";
import { HttpError, body, clientIp, rateLimit, requireUser } from "@srv/http";
import { getUser } from "@srv/session";
import { processImage } from "@srv/images";
import { deleteMedia, saveMedia } from "@srv/storage";
import { memberStats } from "@srv/views";
import { ACCENT_KEYS, MAX_LINKS, isSafeLink, readLinks } from "@shared/profile";
import { USERNAME_MESSAGES, usernameProblem } from "@shared/username";
import { isCurrency } from "@shared/money";

export const profile = new Hono();
const { users, sponsors } = schema;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Taken = another account has it, or another sponsor page uses it as a handle. Case-insensitive. */
async function isTaken(name: string, exceptUserId?: string) {
  const db = await getDb();
  const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${name}`).limit(1);
  if (u && u.id !== exceptUserId) return true;
  const [s] = await db.select({ userId: sponsors.userId }).from(sponsors).where(sql`lower(${sponsors.handle}) = ${name}`).limit(1);
  return !!s && s.userId !== exceptUserId;
}

/** Your own profile, in full, for the editor. */
profile.get("/me/profile", async (c) => {
  const u = await requireUser(c);
  return c.json({
    username: u.username,
    name: u.displayName,
    bio: u.bio,
    avatarKey: u.avatarKey,
    bannerKey: u.bannerKey,
    accent: u.accent,
    links: readLinks(u.links),
    currency: u.currency,
    goal: { name: u.goalName, target: u.goalTarget },
    showStats: u.showStats,
    joinedAt: u.createdAt,
    nextUsernameChange: u.username && u.usernameChangedAt ? new Date(u.usernameChangedAt.getTime() + WEEK_MS) : null,
    canChangeUsername: !u.username || !u.usernameChangedAt || Date.now() - u.usernameChangedAt.getTime() >= WEEK_MS,
  });
});

/** Live availability check for the setup form. */
profile.get("/username/check", async (c) => {
  rateLimit(`ucheck:${clientIp(c)}`, 40, 60_000);
  const name = (c.req.query("u") ?? "").trim().toLowerCase();
  const problem = usernameProblem(name);
  if (problem) return c.json({ available: false, reason: problem, message: USERNAME_MESSAGES[problem] });
  const me = await getUser(c);
  if (await isTaken(name, me?.id)) return c.json({ available: false, reason: "taken", message: "That username is taken." });
  return c.json({ available: true });
});

/**
 * Set or change your username. The first time is free; after that, once a week, so names can't be flipped to
 * impersonate someone. For a sponsor it is also their page address, so it moves with it.
 */
profile.put("/me/username", async (c) => {
  const user = await requireUser(c);
  rateLimit(`uset:${user.id}`, 20, 60_000);
  const name = z.object({ username: z.string() }).parse(await body(c)).username.trim().toLowerCase();
  const problem = usernameProblem(name);
  if (problem) throw new HttpError(USERNAME_MESSAGES[problem]);
  if (user.username === name) return c.json({ username: name });
  if (user.username && user.usernameChangedAt && Date.now() - user.usernameChangedAt.getTime() < WEEK_MS) throw new HttpError("You can change your username once a week.", 429);
  if (await isTaken(name, user.id)) throw new HttpError("That username is taken.", 409);

  const db = await getDb();
  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ username: name, usernameChangedAt: user.username ? new Date() : null }).where(eq(users.id, user.id));
      await tx.update(sponsors).set({ handle: name }).where(eq(sponsors.userId, user.id));
    });
  } catch {
    throw new HttpError("That username is taken.", 409); // lost a race with someone choosing it at the same moment
  }
  return c.json({ username: name });
});

/** Name, bio, links, accent, currency and goal. */
profile.patch("/me", async (c) => {
  const user = await requireUser(c);
  rateLimit(`edit:${user.id}`, 30, 60_000);
  const b = z
    .object({
      displayName: z.string().trim().min(2, "Use at least 2 characters").max(30, "Use 30 characters or fewer").optional(),
      bio: z.string().trim().max(160, "Keep your bio under 160 characters").optional(),
      accent: z.enum([...ACCENT_KEYS, ""]).optional(),
      links: z
        .array(z.object({ label: z.string().trim().min(1, "Give each link a label").max(24, "Link labels are 24 characters at most"), url: z.string().trim().refine(isSafeLink, "Links must be full https:// addresses") }))
        .max(MAX_LINKS, `At most ${MAX_LINKS} links`)
        .optional(),
      currency: z.string().refine(isCurrency, "Choose USD, EUR, CRC or GMD").optional(),
      goalName: z.string().trim().min(1, "Give your goal a name").max(40, "Goal names are 40 characters at most").optional(),
      goalTarget: z.number().int().min(1_000_000, "A goal is at least $1").max(100_000_000_000, "That goal is too large").optional(),
      showStats: z.boolean().optional(),
    })
    .parse(await body(c));
  const patch: Partial<typeof users.$inferInsert> = {};
  if (b.displayName !== undefined) patch.displayName = b.displayName;
  if (b.bio !== undefined) patch.bio = b.bio;
  if (b.accent !== undefined) patch.accent = b.accent;
  if (b.links !== undefined) patch.links = JSON.stringify(b.links);
  if (b.currency !== undefined) patch.currency = b.currency;
  if (b.goalName !== undefined) patch.goalName = b.goalName;
  if (b.goalTarget !== undefined) patch.goalTarget = b.goalTarget;
  if (b.showStats !== undefined) patch.showStats = b.showStats;
  if (!Object.keys(patch).length) throw new HttpError("Nothing to change");
  const db = await getDb();
  await db.update(users).set(patch).where(eq(users.id, user.id));
  return c.json({ ok: true });
});

/** Profile picture and banner. */
profile.put("/me/art/:kind", async (c) => {
  const user = await requireUser(c);
  rateLimit(`uart:${user.id}`, 20, 10 * 60_000);
  const kind = c.req.param("kind");
  if (kind !== "avatar" && kind !== "banner") throw new HttpError("Unknown artwork type", 404);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new HttpError("Invalid upload");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError("Choose an image");
  const key = await saveMedia(await processImage(Buffer.from(await file.arrayBuffer()), kind), "webp");
  const old = kind === "avatar" ? user.avatarKey : user.bannerKey;
  const db = await getDb();
  await db.update(users).set(kind === "avatar" ? { avatarKey: key } : { bannerKey: key }).where(eq(users.id, user.id));
  if (old) void deleteMedia(old);
  return c.json({ key });
});

profile.delete("/me/art/:kind", async (c) => {
  const user = await requireUser(c);
  const kind = c.req.param("kind");
  if (kind !== "avatar" && kind !== "banner") throw new HttpError("Unknown artwork type", 404);
  const old = kind === "avatar" ? user.avatarKey : user.bannerKey;
  const db = await getDb();
  await db.update(users).set(kind === "avatar" ? { avatarKey: null } : { bannerKey: null }).where(eq(users.id, user.id));
  if (old) void deleteMedia(old);
  return c.json({ ok: true });
});

/**
 * A public profile: what the person chose to show. Name, picture, banner, bio, links, accent, and (unless hidden)
 * how many deals they have taken and how much they have earned. Never wallet addresses or individual purchases.
 * A sponsor's profile is their sponsor page, so those redirect there.
 */
profile.get("/users/:username", async (c) => {
  const name = c.req.param("username").toLowerCase();
  const db = await getDb();
  const [u] = await db.select().from(users).where(sql`lower(${users.username}) = ${name}`).limit(1);
  if (!u || u.address.startsWith("deleted-") || u.suspended) throw new HttpError("No one here", 404);
  const [sp] = await db.select().from(sponsors).where(eq(sponsors.userId, u.id)).limit(1);
  if (sp && sp.status === "active") return c.json({ sponsorHandle: sp.handle });
  const viewer = await getUser(c);
  return c.json({
    user: { username: u.username, name: u.displayName, bio: u.bio, avatarKey: u.avatarKey, bannerKey: u.bannerKey, accent: u.accent, links: readLinks(u.links), joinedAt: u.createdAt },
    stats: u.showStats ? await memberStats(u.id) : null,
    isMe: viewer?.id === u.id,
  });
});
