import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NimiqProvider } from "@nimiq/mini-app-sdk";
import { api, sleep } from "./api";
import { deviceId, forgetReferral, getToken, randomHex, setToken, takeReferral } from "./session";
import { isCurrency } from "@shared/money";
import type { Currency } from "@shared/types";

export type Me = {
  user: { id: string; name: string; username: string | null; avatarKey: string | null; accent: string; role: "member" | "admin"; address: string; currency: string; referralCode: string | null; needsUsername: boolean } | null;
  sponsor: { id: string; handle: string; name: string; status: string } | null;
  config: { demo: boolean; demoPayments: boolean; nimUsd: number; ratesLive: boolean; potAddress: string | null };
};

export type PayRequest = { kind: "purchase"; dealId: string } | { kind: "topup"; amountNim: number; target?: "mine" | "platform" };
export type PayStage = "preparing" | "wallet" | "verifying";
export type Intent = { id: string; amountLuna: number; recipient: string; memo: string };

/** Thrown by pay() outside Nimiq Pay: the payment is made by hand from any wallet, and this carries what to send. */
export class ManualPay extends Error {
  constructor(public intent: Intent) {
    super("Pay from your wallet");
  }
}

type Ctx = {
  me: Me | null;
  loading: boolean;
  /** true when running inside Nimiq Pay (the host injects window.nimiqPay). */
  inNimiqPay: boolean;
  signedIn: boolean;
  currency: Currency;
  setCurrency: (c: Currency) => Promise<void>;
  /** Sign in with the wallet inside Nimiq Pay: share the address, sign a one-time message. */
  connect: () => Promise<void>;
  demoLogin: (persona: "member" | "studio" | "admin") => Promise<void>;
  /** Take a session token from a sign-in that happened elsewhere (the address proof or a pairing code). */
  acceptToken: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  pay: (req: PayRequest, onStage?: (s: PayStage) => void) => Promise<Intent>;
  /** After a payment confirmed outside pay() (a manual payment). */
  paid: () => void;
  nimiq: () => Promise<NimiqProvider | null>;
};

const AuthCtx = createContext<Ctx | null>(null);
export const useAuth = () => {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
};

/** Plain-English messages for the wallet's normalized error types. */
function friendly(e: unknown): Error {
  const err = e as { type?: string; message?: string };
  if (err?.type === "PERMISSION_DENIED") return new Error("Cancelled in Nimiq Pay.");
  if (err?.type === "INVALID_TRANSACTION") return new Error("Nimiq Pay couldn't build that payment. Check your balance and try again.");
  if (err?.type === "NETWORK_ERROR") return new Error("Network hiccup. Check your wallet history before paying again.");
  return e instanceof Error ? e : new Error("Something went wrong.");
}

/**
 * Inside Nimiq Pay the host can name the phone (with the person's consent), which is much harder to fake than a value
 * kept in the browser. It is hashed here before it is sent, and again on the server before it is stored. Declined or
 * unavailable: fall back to a random id kept in this browser.
 */
async function hostDeviceId(): Promise<string> {
  if (typeof window !== "undefined" && "nimiqPay" in window) {
    try {
      const { requestDeviceIdentifier } = await import("@nimiq/mini-app-sdk");
      const raw = await requestDeviceIdentifier({ reason: "To make sure one phone can't claim many referral rewards. DealJar only keeps a scrambled version." });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    } catch {
      /* declined or not offered: use this browser's own id */
    }
  }
  return deviceId();
}

const GUEST_CURRENCY = "dj_currency";
const guestCurrency = (): Currency => {
  try {
    const v = localStorage.getItem(GUEST_CURRENCY) ?? (window as { nimiqPay?: { userFiat?: string } }).nimiqPay?.userFiat;
    return isCurrency(v) ? v : "USD";
  } catch {
    return "USD";
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [guest, setGuest] = useState<Currency>(guestCurrency);
  // The host injects window.nimiqPay before page scripts run, so this is known immediately.
  const inNimiqPay = useSyncExternalStore(
    () => () => {},
    () => "nimiqPay" in window,
    () => false,
  );
  const sdk = useRef<Promise<NimiqProvider | null> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<Me>("/api/me");
      setMe(data);
      if (!data.user && getToken()) setToken(null); // a stored token the server no longer accepts
    } catch {
      /* offline: keep what we had */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // load who is signed in, once, when the app opens
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const everything = useCallback(() => void qc.invalidateQueries(), [qc]);

  const provider = useCallback(() => {
    sdk.current ??= import("@nimiq/mini-app-sdk").then((m) => m.init({ timeout: 4000 })).catch(() => null);
    return sdk.current;
  }, []);

  /** A friend's referral link is claimed once, right after the account has a username. Failure is silent: it is a bonus. */
  const claimReferral = useCallback(async () => {
    const code = takeReferral();
    if (!code) return;
    try {
      await api("/api/referral/claim", { code, deviceId: await hostDeviceId() });
    } catch {
      /* not eligible (old account, same device, bad code): nothing to tell them */
    }
    forgetReferral();
  }, []);

  const acceptToken = useCallback(
    async (token: string) => {
      setToken(token);
      await refresh();
      everything();
    },
    [refresh, everything],
  );

  const connect = useCallback(async () => {
    const nimiq = await provider();
    if (!nimiq) throw new Error("Open DealJar inside Nimiq Pay to sign in with your wallet, or sign in from this browser.");
    try {
      await nimiq.listAccounts(); // asks the user to share their address
      const { nonce, message } = await api<{ nonce: string; message: string }>("/api/auth/challenge", {});
      const signed = await nimiq.sign(message);
      const r = await api<{ token?: string }>("/api/auth/verify", { nonce, publicKey: signed.publicKey, signature: signed.signature });
      setToken(r.token ?? null);
    } catch (e) {
      throw friendly(e);
    }
    await refresh();
    everything();
  }, [provider, refresh, everything]);

  const demoLogin = useCallback(
    async (persona: "member" | "studio" | "admin") => {
      const r = await api<{ token?: string }>("/api/auth/demo", { persona });
      setToken(r.token ?? null);
      await refresh();
      everything();
    },
    [refresh, everything],
  );

  const logout = useCallback(async () => {
    await api("/api/auth/logout", {}).catch(() => {});
    setToken(null);
    await refresh();
    everything();
  }, [refresh, everything]);

  const pay = useCallback(
    async (req: PayRequest, onStage?: (s: PayStage) => void): Promise<Intent> => {
      onStage?.("preparing");
      const { intent } = await api<{ intent: Intent }>("/api/payments/intent", req);
      const nimiq = inNimiqPay ? await provider() : null;
      let txHash: string;
      onStage?.("wallet");
      if (nimiq) {
        try {
          // The memo (<=64 bytes) goes on-chain so the server can match the payment to the purchase.
          txHash = await nimiq.sendBasicTransactionWithData({ recipient: intent.recipient, value: intent.amountLuna, data: intent.memo });
        } catch (e) {
          throw friendly(e);
        }
      } else if (me?.config.demoPayments) {
        await sleep(700);
        txHash = `demo-${randomHex(8)}`;
      } else {
        // A normal browser: no wallet to call. The buyer sends the payment by hand and the server finds it by its memo.
        throw new ManualPay(intent);
      }
      onStage?.("verifying");
      for (let i = 0; i < 25; i++) {
        const r = await api<{ status: "confirmed" | "pending" | "failed"; reason?: string }>("/api/payments/confirm", { intentId: intent.id, txHash });
        if (r.status === "confirmed") {
          everything();
          return intent;
        }
        if (r.status === "failed") throw new Error(r.reason ?? "Payment could not be verified.");
        await sleep(2000);
      }
      throw new Error("Still waiting for the network. Your reward will arrive as soon as the payment confirms.");
    },
    [inNimiqPay, me, provider, everything],
  );

  const currency: Currency = me?.user && isCurrency(me.user.currency) ? me.user.currency : guest;
  const setCurrency = useCallback(
    async (c: Currency) => {
      setGuest(c);
      try {
        localStorage.setItem(GUEST_CURRENCY, c);
      } catch {
        /* fine */
      }
      if (getToken()) {
        await api("/api/me", { currency: c }, "PATCH").catch(() => {});
        await refresh();
      }
    },
    [refresh],
  );

  // Once a username exists, use a saved referral link (if there is one).
  const username = me?.user?.username;
  useEffect(() => {
    if (username) void claimReferral();
  }, [username, claimReferral]);

  const value = useMemo<Ctx>(
    () => ({ me, loading, inNimiqPay, signedIn: !!me?.user, currency, setCurrency, connect, demoLogin, acceptToken, logout, refresh, pay, paid: everything, nimiq: provider }),
    [me, loading, inNimiqPay, currency, setCurrency, connect, demoLogin, acceptToken, logout, refresh, pay, everything, provider],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
