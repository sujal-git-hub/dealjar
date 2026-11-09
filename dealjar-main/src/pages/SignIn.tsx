import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Loader, Smartphone, Wallet } from "lucide-react";
import { ApiError, api, sleep } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CopyButton } from "@/components/account";
import { useToast } from "@/components/toast";
import { formatNim, shortAddress } from "@shared/units";

type Proof = { code: string; address: string; to: string; amountLuna: number; memo: string; minutes: number };
type Pair = { code: string; secret: string; minutes: number };

/*
  Three ways in, one account.
  - Inside Nimiq Pay: share your address and the wallet signs a one-time message. One tap.
  - In a normal browser, by proving the address: send 0.00001 NIM from it with a short code in the message. A
    transaction's sender can't be faked, so seeing it on the network proves you hold the key.
  - In a normal browser, with your phone: the browser shows a code, you approve it inside Nimiq Pay.
*/
export default function SignInPage() {
  const { me, inNimiqPay, connect, demoLogin, acceptToken } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = params.get("next") && params.get("next")!.startsWith("/") ? params.get("next")! : "/";
  const [how, setHow] = useState<"proof" | "phone">("proof");
  const [busy, setBusy] = useState(false);

  // once signed in, move on (to the username step first, if they still need one)
  useEffect(() => {
    if (me?.user) nav(me.user.needsUsername ? `/welcome?next=${encodeURIComponent(next)}` : next, { replace: true });
  }, [me, nav, next]);

  async function wallet() {
    setBusy(true);
    try {
      await connect();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap pt-4 md:pt-10">
      <p className="eyebrow">Sign in</p>
      <h1 className="display display-xl mt-2 !text-[clamp(40px,9vw,84px)]">
        Your jar, <span className="serif text-[var(--ember)]">your wallet.</span>
      </h1>
      <p className="lede mt-4">There's no password. Your Nimiq wallet is your account, and DealJar never holds your keys.</p>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1fr]">
        {inNimiqPay ? (
          <section className="card p-7 lg:col-span-2">
            <h2 className="display display-md">Continue with Nimiq Pay</h2>
            <p className="muted mt-2">Share your address and approve a one-time message. Nothing is paid.</p>
            <button type="button" className="btn btn-primary mt-6" disabled={busy} onClick={() => void wallet()}>
              {busy ? <Loader aria-hidden="true" size={18} className="animate-spin" /> : <Wallet aria-hidden="true" size={18} />} Sign in with Nimiq Pay
            </button>
          </section>
        ) : (
          <>
            <section className="card p-7 lg:col-span-2" aria-labelledby="how">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="how" className="display display-md">
                  Sign in from this browser
                </h2>
                <div role="group" aria-label="How to sign in" className="flex gap-2">
                  <button type="button" className="chip" aria-pressed={how === "proof"} onClick={() => setHow("proof")}>
                    <Wallet aria-hidden="true" size={16} className="mr-1.5" /> Prove my address
                  </button>
                  <button type="button" className="chip" aria-pressed={how === "phone"} onClick={() => setHow("phone")}>
                    <Smartphone aria-hidden="true" size={16} className="mr-1.5" /> Use my phone
                  </button>
                </div>
              </div>
              {how === "proof" ? <ProofFlow onDone={(t) => void acceptToken(t)} /> : <PhoneFlow onDone={(t) => void acceptToken(t)} />}
            </section>
          </>
        )}

        {me?.config.demo && (
          <section className="card p-6 lg:col-span-2" aria-label="Demo sign-in">
            <p className="eyebrow">Development only</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {(["member", "studio", "admin"] as const).map((p) => (
                <button key={p} type="button" className="btn btn-ghost btn-sm" onClick={() => void demoLogin(p)}>
                  Sign in as the demo {p}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** Paste your address, send one luna with a code, and the server sees it on the network. */
function ProofFlow({ onDone }: { onDone: (token: string) => void }) {
  const [address, setAddress] = useState("");
  const [proof, setProof] = useState<Proof | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function start() {
    setError("");
    setBusy(true);
    try {
      setProof(await api<Proof>("/api/auth/address/start", { address }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!proof) return;
    let stop = false;
    void (async () => {
      while (!stop) {
        await sleep(4000);
        if (stop) return;
        try {
          const r = await api<{ status: string; reason?: string; token?: string }>("/api/auth/address/check", { code: proof.code });
          if (r.status === "ok" && r.token) return onDone(r.token);
          setNote(r.reason === "waiting_for_confirmation" ? "Your payment is on the network. Waiting for it to confirm…" : r.reason === "rpc_unavailable" ? "The network can't be reached from the server right now. Still trying…" : "");
        } catch (e) {
          if (e instanceof ApiError && e.status === 400) {
            setProof(null);
            setError("That code expired. Start again to get a new one.");
            return;
          }
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [proof, onDone]);

  if (!proof) {
    return (
      <form
        className="mt-6 grid max-w-[620px] gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <label>
          <span className="eyebrow">Your Nimiq address</span>
          <input className="field mt-1.5 font-mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="NQ07 0000 0000 0000 0000 0000 0000 0000 0000" autoComplete="off" spellCheck={false} />
        </label>
        <p className="muted text-[15px]">
          To prove it's yours you'll send <strong>one tiny payment</strong> (0.00001 NIM) from it, with a short code. It costs next to nothing and DealJar can't spend from your wallet.
        </p>
        {error && (
          <p role="alert" className="text-[var(--danger)]">
            {error}
          </p>
        )}
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy || address.trim().length < 20}>
            {busy && <Loader aria-hidden="true" size={18} className="animate-spin" />} Get my code
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="mt-6 grid max-w-[640px] gap-5">
      <p>
        From <strong className="font-mono">{shortAddress(proof.address)}</strong>, send <strong className="num">{formatNim(proof.amountLuna)}</strong> (0.00001 NIM) to this address, and put this in the message:
      </p>
      <div>
        <p className="eyebrow">Send to</p>
        <p className="mt-1 break-all font-mono text-[14.5px]">{proof.to}</p>
        <div className="mt-2">
          <CopyButton text={proof.to} label="Copy address" />
        </div>
      </div>
      <div>
        <p className="eyebrow">Message (required)</p>
        <p className="mt-1 break-all rounded-2xl bg-[var(--paper-2)] p-4 font-mono text-[15px]">{proof.memo}</p>
        <div className="mt-2">
          <CopyButton text={proof.memo} label="Copy message" />
        </div>
      </div>
      <p className="flex items-center gap-2 font-semibold" role="status">
        <Loader aria-hidden="true" size={18} className="animate-spin" /> {note || "Waiting for your payment…"}
      </p>
      <p className="muted text-[14px]">The code works for {proof.minutes} minutes. This page signs you in by itself once the payment is confirmed.</p>
      <div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProof(null)}>
          Use a different address
        </button>
      </div>
    </div>
  );
}

/** The browser shows a code; someone signed in inside Nimiq Pay approves it. */
function PhoneFlow({ onDone }: { onDone: (token: string) => void }) {
  const [pair, setPair] = useState<Pair | null>(null);
  const [error, setError] = useState("");
  const started = useRef(false);

  async function start() {
    setError("");
    try {
      setPair(await api<Pair>("/api/auth/pair/start", {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, []);

  useEffect(() => {
    if (!pair) return;
    let stop = false;
    void (async () => {
      while (!stop) {
        await sleep(2500);
        if (stop) return;
        try {
          const r = await api<{ status: string; token?: string }>("/api/auth/pair/check", { secret: pair.secret });
          if (r.status === "ok" && r.token) return onDone(r.token);
        } catch (e) {
          if (e instanceof ApiError && e.status === 400) {
            setPair(null);
            setError("That code expired.");
            return;
          }
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [pair, onDone]);

  return (
    <div className="mt-6 grid max-w-[640px] gap-5">
      <ol className="grid gap-2">
        <li>
          <strong>1.</strong> Open DealJar inside <strong>Nimiq Pay</strong> on your phone.
        </li>
        <li>
          <strong>2.</strong> Go to <strong>Me</strong> and choose <strong>Sign in another device</strong>.
        </li>
        <li>
          <strong>3.</strong> Type this code:
        </li>
      </ol>
      {pair ? (
        <>
          <p className="display text-center text-[clamp(40px,10vw,72px)] tracking-[0.08em]" aria-label={`Code ${pair.code.split("").join(" ")}`}>
            {pair.code}
          </p>
          <p className="flex items-center justify-center gap-2 font-semibold" role="status">
            <Loader aria-hidden="true" size={18} className="animate-spin" /> Waiting for your phone…
          </p>
          <p className="muted text-center text-[14px]">The code works for {pair.minutes} minutes.</p>
        </>
      ) : (
        <div>
          {error && (
            <p role="alert" className="mb-3 text-[var(--danger)]">
              {error}
            </p>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void start()}>
            Get a new code
          </button>
        </div>
      )}
    </div>
  );
}
