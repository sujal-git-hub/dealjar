import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ImagePlus, Loader, Trash2 } from "lucide-react";
import { ApiError, api, imgUrl, sleep } from "@/lib/api";
import { ManualPay, useAuth, type Intent, type PayRequest, type PayStage } from "@/lib/auth";
import { useToast } from "@/components/toast";
import { Sheet } from "@/components/ui";
import { formatNim } from "@shared/units";

/** A round picture, or the person's initial on a marigold disc. */
export function Avatar({ imageKey, name, size = 56, className = "" }: { imageKey?: string | null; name: string; size?: number; className?: string }) {
  const src = imgUrl(imageKey);
  return src ? (
    <img src={src} alt="" width={size} height={size} className={`shrink-0 rounded-full border-2 border-[var(--ink)] object-cover ${className}`} style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden="true" className={`display grid shrink-0 place-items-center rounded-full border-2 border-[var(--ink)] bg-[var(--marigold)] ${className}`} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** A banner picture, or a quiet generated colour. */
export function Banner({ imageKey, hue = 40, className = "" }: { imageKey?: string | null; hue?: number; className?: string }) {
  const src = imgUrl(imageKey);
  return src ? (
    <img src={src} alt="" className={`w-full object-cover ${className}`} loading="lazy" />
  ) : (
    <div aria-hidden="true" className={`w-full ${className}`} style={{ background: `linear-gradient(135deg, oklch(0.88 0.13 ${hue}), oklch(0.74 0.17 ${(hue + 40) % 360}))` }} />
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked: the text is selectable on screen */
        }
      }}
    >
      {done ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />} {done ? "Copied" : label}
    </button>
  );
}

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Upload, replace or remove one picture. The server resizes and re-encodes it, so any phone photo is fine.
 * `path` is the API route (PUT uploads, DELETE removes).
 */
export function ImageField({ label, current, path, shape = "wide", hint, onChanged, children }: { label: string; current?: string | null; path: string; shape?: "round" | "wide"; hint?: string; onChanged?: () => void; children?: ReactNode }) {
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!ACCEPT.split(",").includes(file.type)) return void toast("Use a JPEG, PNG or WebP image.", "error");
    if (file.size > MAX_BYTES) return void toast("That image is over 5 MB. Pick a smaller one.", "error");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      await api(path, form, "PUT");
      toast(`${label} updated.`);
      await qc.invalidateQueries();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(path, undefined, "DELETE");
      toast(`${label} removed.`);
      await qc.invalidateQueries();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <span className="eyebrow">{label}</span>
      <div className={`overflow-hidden border-2 border-[var(--ink)] bg-[var(--paper-2)] ${shape === "round" ? "h-24 w-24 rounded-full" : "aspect-[3/1] w-full rounded-[18px]"}`}>
        {current ? <img src={imgUrl(current)} alt="" className="h-full w-full object-cover" /> : (children ?? <div className="grid h-full w-full place-items-center text-[var(--muted)]"><ImagePlus aria-hidden="true" /></div>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} id={id} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} />
        <label htmlFor={id} className={`btn btn-ghost btn-sm cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? <Loader aria-hidden="true" size={16} className="animate-spin" /> : <ImagePlus aria-hidden="true" size={16} />} {current ? "Replace" : "Upload"}
        </label>
        {current && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove()} disabled={busy}>
            <Trash2 aria-hidden="true" size={16} /> Remove
          </button>
        )}
        <span className="muted text-[13.5px]">{hint ?? "JPEG, PNG or WebP, up to 5 MB."}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ paying ------------------------------------------------------------------ */

const STAGE: Record<PayStage, string> = { preparing: "Getting ready…", wallet: "Confirm in Nimiq Pay…", verifying: "Checking the network…" };

/**
 * Starts a payment and shows what it needs. Inside Nimiq Pay the wallet opens by itself. In a normal browser there is
 * no wallet to call, so the person sends the payment by hand from any Nimiq wallet and the server finds it by its memo.
 */
export function usePay() {
  const { pay, paid } = useAuth();
  const toast = useToast();
  const [stage, setStage] = useState<PayStage | null>(null);
  const [manual, setManual] = useState<Intent | null>(null);
  const [error, setError] = useState("");
  const done = useRef<((i: Intent) => void) | undefined>(undefined);

  const start = useCallback(
    async (req: PayRequest, onDone?: (i: Intent) => void) => {
      setError("");
      setManual(null);
      done.current = onDone;
      try {
        const intent = await pay(req, setStage);
        setStage(null);
        onDone?.(intent);
      } catch (e) {
        setStage(null);
        if (e instanceof ManualPay) setManual(e.intent);
        else setError(e instanceof Error ? e.message : "The payment didn't go through.");
      }
    },
    [pay],
  );

  const dialog = (
    <ManualPaySheet
      key={manual?.id ?? "none"}
      intent={manual}
      onClose={() => setManual(null)}
      onConfirmed={() => {
        const i = manual;
        setManual(null);
        paid();
        toast("Payment confirmed.");
        if (i) done.current?.(i);
      }}
    />
  );
  return { start, busy: stage !== null, stage, stageText: stage ? STAGE[stage] : "", error, clearError: () => setError(""), dialog };
}

function ManualPaySheet({ intent, onClose, onConfirmed }: { intent: Intent | null; onClose: () => void; onConfirmed: () => void }) {
  const [state, setState] = useState<"waiting" | "failed">("waiting");
  const [why, setWhy] = useState("");
  const cb = useRef(onConfirmed);
  useEffect(() => {
    cb.current = onConfirmed;
  });
  useEffect(() => {
    if (!intent) return;
    let stop = false;
    void (async () => {
      for (let i = 0; i < 300 && !stop; i++) {
        await sleep(4000);
        if (stop) return;
        try {
          const r = await api<{ status: string; reason?: string }>(`/api/payments/check/${intent.id}`);
          if (r.status === "confirmed") return cb.current();
          if (r.status === "failed") {
            setState("failed");
            setWhy(r.reason ?? "It couldn't be verified.");
            return;
          }
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return;
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [intent]);

  return (
    <Sheet open={!!intent} onClose={onClose} title="Send the payment" label="From your wallet">
      {intent && (
        <div className="grid gap-4">
          <p>
            You're not inside Nimiq Pay, so there's no wallet to open from here. Send exactly <strong className="num">{formatNim(intent.amountLuna)}</strong> from any Nimiq wallet, to this address, with this message. DealJar finds it by the message.
          </p>
          <div>
            <p className="eyebrow">To</p>
            <p className="mt-1 break-all font-mono text-[14.5px]">{intent.recipient}</p>
            <div className="mt-2">
              <CopyButton text={intent.recipient} label="Copy address" />
            </div>
          </div>
          <div>
            <p className="eyebrow">Message (required)</p>
            <p className="mt-1 break-all font-mono text-[15px]">{intent.memo}</p>
            <div className="mt-2">
              <CopyButton text={intent.memo} label="Copy message" />
            </div>
          </div>
          {state === "waiting" ? (
            <p className="flex items-center gap-2 font-semibold" role="status">
              <Loader aria-hidden="true" size={18} className="animate-spin" /> Waiting for your payment…
            </p>
          ) : (
            <p role="alert" className="rounded-2xl bg-[var(--danger-bg)] p-4 text-[var(--danger)]">
              {why} Start again to get a new payment.
            </p>
          )}
          <p className="muted text-[14px]">You can close this and come back: the payment will still be found, as long as the message is on it.</p>
        </div>
      )}
    </Sheet>
  );
}
