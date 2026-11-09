import type { SessionUser } from "./session";

/**
  What the client is told about the signed-in user. `needsUsername` drives the setup screen: everyone needs a
  public @username before doing anything else.
*/
export function sessionUserView(u: SessionUser) {
  return {
    id: u.id,
    name: u.displayName,
    username: u.username,
    avatarKey: u.avatarKey,
    accent: u.accent,
    role: u.role as "member" | "admin",
    address: u.address,
    currency: u.currency,
    referralCode: u.referralCode,
    needsUsername: !u.username,
  };
}
