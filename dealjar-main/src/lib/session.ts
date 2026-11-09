/**
  Client-side session fallback. The server sets an httpOnly cookie, but some app WebViews (Nimiq Pay's, it seems)
  don't keep cookies after the app closes. So the sign-in token is also kept here and sent as a bearer header;
  either one signs you in. If localStorage is unavailable it lives in memory for the visit.
*/
const KEY = "dj_token";
let memory: string | null = null;

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function setToken(token: string | null) {
  memory = token;
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode / blocked storage: the in-memory copy still works for this visit */
  }
}

/** A random id for this browser, only ever sent as a salted hash, to stop one device earning many referral rewards. */
export function deviceId(): string {
  const K = "dj_device";
  try {
    let v = localStorage.getItem(K);
    if (!v || !/^[0-9a-f]{32}$/.test(v)) {
      v = randomHex(16);
      localStorage.setItem(K, v);
    }
    return v;
  } catch {
    return "0".repeat(32);
  }
}

/** crypto.randomUUID() is unavailable in insecure contexts (e.g. http://LAN-IP in a WebView). */
export function randomHex(bytes = 8): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

const REF = "dj_ref";
export const rememberReferral = (code: string) => {
  try {
    localStorage.setItem(REF, code);
  } catch {
    /* fine */
  }
};
export const takeReferral = (): string | null => {
  try {
    return localStorage.getItem(REF);
  } catch {
    return null;
  }
};
export const forgetReferral = () => {
  try {
    localStorage.removeItem(REF);
  } catch {
    /* fine */
  }
};
