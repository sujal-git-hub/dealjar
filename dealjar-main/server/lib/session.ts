import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { jwtVerify, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";

const COOKIE = "dj_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
  return new TextEncoder().encode("dealjar-dev-secret-change-me");
}

/**
  A session is a signed token. It normally travels in an httpOnly cookie. Some app WebViews (Nimiq Pay's, it
  seems) drop cookies when the app closes, so the same token is also returned to the client, which keeps it
  in localStorage and sends it as `Authorization: Bearer ...`. Either one signs you in.
*/
export async function setSession(c: Context, userId: string): Promise<string> {
  const token = await new SignJWT({ uid: userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret());
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });
  return token;
}

export function clearSession(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
}

export type SessionUser = typeof schema.users.$inferSelect;

async function userFromToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const uid = payload.uid;
    if (typeof uid !== "string") return null;
    const db = await getDb();
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, uid)).limit(1);
    // A deleted account (see DELETE /me) must not keep working on a token that is still out there.
    if (!user || user.address.startsWith("deleted-")) return null;
    return user;
  } catch {
    return null;
  }
}

/** Current user or null: the cookie, else a bearer token. Never throws on a bad token. */
export async function getUser(c: Context): Promise<SessionUser | null> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
  const token = getCookie(c, COOKIE) ?? bearer;
  return token ? userFromToken(token) : null;
}
