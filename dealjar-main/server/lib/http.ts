import type { Context } from "hono";
import { getUser, type SessionUser } from "./session";

export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Parses a JSON body, turning malformed JSON into a clean 400 instead of a crash. */
export async function body<T = unknown>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HttpError("Invalid request body");
  }
}

export async function requireUser(c: Context): Promise<SessionUser> {
  const user = await getUser(c);
  if (!user) throw new HttpError("Sign in first", 401);
  if (user.suspended) throw new HttpError("This account is suspended", 403);
  return user;
}

export async function requireAdmin(c: Context) {
  const user = await requireUser(c);
  if (user.role !== "admin") throw new HttpError("Admins only", 403);
  return user;
}

export const clientIp = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";

/** Very small in-memory limiter (per instance). Good enough to blunt spam on a free tier. */
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number) {
  if (process.env.DEALJAR_NO_RATE_LIMIT === "1") return; // tests only: env.ts refuses this in production
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  if (++b.n > max) throw new HttpError("Slow down a little", 429);
}
