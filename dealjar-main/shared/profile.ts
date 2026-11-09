/**
  Profile extras, shared by the server (validation) and the client (display).
  The accent is a fixed palette, not a free colour picker: it is used only as decoration (glows, rings,
  borders), never as text, so any choice keeps text contrast intact.
*/
export const ACCENTS = {
  orange: "#fa5d29",
  blue: "#49b3fc",
  violet: "#b48cff",
  green: "#5be3a4",
  pink: "#ff7ab8",
  gold: "#ffc857",
} as const;
export type AccentKey = keyof typeof ACCENTS;
export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];
export const accentColor = (key: string | null | undefined): string | null => (key && key in ACCENTS ? ACCENTS[key as AccentKey] : null);

export type ProfileLink = { label: string; url: string };
export const MAX_LINKS = 4;

/** https only, a real URL, no credentials in it. Everything else (javascript:, data:, http:) is refused. */
export function isSafeLink(raw: string): boolean {
  if (raw.length > 200) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Reads the stored JSON, dropping anything that isn't a valid link, so a bad row can never break a page. */
export function readLinks(stored: string | null | undefined): ProfileLink[] {
  try {
    const v = JSON.parse(stored || "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is ProfileLink => !!x && typeof x.label === "string" && typeof x.url === "string" && x.label.trim().length > 0 && x.label.length <= 24 && isSafeLink(x.url))
      .slice(0, MAX_LINKS);
  } catch {
    return [];
  }
}
