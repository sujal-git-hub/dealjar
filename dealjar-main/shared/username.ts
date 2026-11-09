/**
  Usernames: the one public handle for every account. For artists it is also their page address
  (/s/<username>), so there is no separate "artist handle". Pure, shared by the server (which enforces it)
  and the setup form (which checks as you type).
*/
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

/** Words that would collide with a route, impersonate the platform, or read as staff. */
export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "mod", "moderator", "staff", "support", "official", "system", "root", "null", "undefined",
  "dealjar", "nimiq", "nimiqpay", "nim", "api", "app", "www",
  "studio", "me", "u", "s", "user", "users", "sponsor", "sponsors", "deal", "deals", "jar", "funding", "discover",
  "settings", "welcome", "signin", "signup", "signout", "login", "logout", "receipts", "cashout", "referral", "help", "about", "terms", "privacy", "policy",
]);

export type UsernameProblem = "empty" | "short" | "long" | "start" | "chars" | "reserved";

/** null = fine. Otherwise the first problem found (the order a person would fix them in). */
export function usernameProblem(raw: string): UsernameProblem | null {
  const u = raw.trim().toLowerCase();
  if (!u) return "empty";
  if (u.length < USERNAME_MIN) return "short";
  if (u.length > USERNAME_MAX) return "long";
  if (!/^[a-z0-9_]+$/.test(u)) return "chars"; // before "start": an accented first letter is a characters problem
  if (!/^[a-z]/.test(u)) return "start";
  if (RESERVED_USERNAMES.has(u) || u.startsWith("demo_")) return "reserved";
  return null;
}

export const USERNAME_MESSAGES: Record<UsernameProblem, string> = {
  empty: "Choose a username.",
  short: `Use at least ${USERNAME_MIN} characters.`,
  long: `Use ${USERNAME_MAX} characters or fewer.`,
  start: "Start with a letter.",
  chars: "Use only letters, numbers and underscores.",
  reserved: "That name is reserved. Try another.",
};

/** A starting suggestion from a display name or anything else typed: always passes the rules (except being taken). */
export function suggestUsername(from: string): string {
  let u = from
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, USERNAME_MAX);
  if (!/^[a-z]/.test(u)) u = `jar_${u}`.slice(0, USERNAME_MAX);
  while (u.length < USERNAME_MIN) u += "_";
  return usernameProblem(u) ? `jar_${u}`.slice(0, USERNAME_MAX) : u;
}

/** True for a display name that is really a wallet address in disguise (how accounts were named before usernames). */
export const looksLikeAddressName = (name: string) => /^NQ\d{2}\b/i.test(name.trim());

/**
  Should this person be sent to the setup screen before anything else? Everyone signed in needs a username.
  Reading pages that explain the app stay reachable, so you can read the terms before choosing.
*/
export function needsOnboarding(me: { user: { username: string | null } | null } | null, path: string): boolean {
  if (!me?.user || me.user.username) return false;
  return !/^\/(welcome|terms|privacy|help|about|policy)(\/|$)/.test(path);
}
