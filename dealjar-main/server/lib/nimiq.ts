import { normalizeAddress } from "@shared/units";

type Core = typeof import("@nimiq/core");
let corePromise: Promise<Core> | undefined;
const loadCore = () => (corePromise ??= import("@nimiq/core"));

const enc = new TextEncoder();

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Verifies a Nimiq Pay `sign()` result and returns the signer's address, or null.
 *
 * Nimiq's signed-message scheme hashes "\x16Nimiq Signed Message:\n" + length + message
 * with SHA-256 before signing. Because the exact digest Nimiq Pay uses could not be
 * checked against a device here, we accept the documented scheme first and fall back to
 * raw / sha256(raw). That is safe: every variant is still an Ed25519 signature by the
 * claimed key over a message containing our single-use, server-issued nonce.
 */
export async function verifyLoginSignature(
  message: string,
  publicKeyHex: string,
  signatureHex: string,
): Promise<string | null> {
  try {
    const { PublicKey, Signature, Hash } = await loadCore();
    const publicKey = PublicKey.fromHex(publicKeyHex);
    const signature = Signature.fromHex(signatureHex);
    const raw = enc.encode(message);
    const prefixed = concat(enc.encode(`\x16Nimiq Signed Message:\n${raw.length}`), raw);
    const candidates = [Hash.computeSha256(prefixed), raw, Hash.computeSha256(raw)];
    if (!candidates.some((data) => publicKey.verify(signature, data))) return null;
    return publicKey.toAddress().toUserFriendlyAddress();
  } catch {
    return null;
  }
}

/** Validates a Nimiq address (checksum included) and returns it in friendly form, or null. */
export async function parseAddress(input: string): Promise<string | null> {
  try {
    const { Address } = await loadCore();
    // addresses are upper-case by definition; people paste them in any case
    return Address.fromAny(input.trim().toUpperCase()).toUserFriendlyAddress();
  } catch {
    return null;
  }
}

export type ChainTx = {
  from: string;
  to: string;
  valueLuna: number;
  memo: string;
  executed: boolean;
  confirmations: number;
  hash?: string;
};

export type ChainLookup =
  | { ok: true; tx: ChainTx }
  | { ok: false; reason: "not_found" | "rpc_unavailable" | "rpc_error" };

/**
 * Reads a transaction from a Nimiq JSON-RPC node (NIMIQ_RPC_URL).
 * Field names follow core-rs-albatross `ExecutedTransaction`: to, value (Luna),
 * recipientData (hex), confirmations, executionResult.
 */
/** One transaction as the node reports it (field names follow core-rs-albatross). */
function parseTx(t: Record<string, unknown>): ChainTx | null {
  if (typeof t.to !== "string") return null;
  const hex = typeof t.recipientData === "string" ? t.recipientData : "";
  return {
    from: typeof t.from === "string" ? t.from : "",
    to: t.to,
    valueLuna: Number(t.value ?? 0),
    memo: hex ? Buffer.from(hex, "hex").toString("utf8") : "",
    executed: t.executionResult !== false,
    confirmations: Number(t.confirmations ?? 0),
    hash: typeof t.hash === "string" ? t.hash : undefined,
  };
}

export async function fetchChainTx(hash: string): Promise<ChainLookup> {
  const url = process.env.NIMIQ_RPC_URL;
  if (!url) return { ok: false, reason: "rpc_unavailable" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransactionByHash", params: [hash] }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: "rpc_error" };
    const json = (await res.json()) as {
      result?: { data?: Record<string, unknown> } & Record<string, unknown>;
      error?: unknown;
    };
    if (json.error || !json.result) return { ok: false, reason: "not_found" };
    const tx = parseTx((json.result.data ?? json.result) as Record<string, unknown>);
    return tx ? { ok: true, tx } : { ok: false, reason: "not_found" };
  } catch {
    return { ok: false, reason: "rpc_error" };
  }
}

/**
 * The most recent transactions involving an address. Used to find a payment by its memo when the app never
 * learned the transaction hash (the app closed or froze mid-payment, or the wallet didn't report back).
 */
export async function fetchAddressTxs(address: string, max = 40): Promise<{ ok: true; txs: ChainTx[] } | { ok: false; reason: "rpc_unavailable" | "rpc_error" }> {
  const url = process.env.NIMIQ_RPC_URL;
  if (!url) return { ok: false, reason: "rpc_unavailable" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransactionsByAddress", params: [address, max, null] }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, reason: "rpc_error" };
    const json = (await res.json()) as { result?: { data?: unknown }; error?: unknown };
    const list = json.result?.data;
    if (json.error || !Array.isArray(list)) return { ok: false, reason: "rpc_error" };
    const txs = list.map((t) => parseTx(t as Record<string, unknown>)).filter((t): t is ChainTx => !!t && !!t.hash);
    return { ok: true, txs };
  } catch {
    return { ok: false, reason: "rpc_error" };
  }
}

export const sameAddress = (a: string, b: string) => normalizeAddress(a) === normalizeAddress(b);

/** Where the one-luna "I own this address" transaction goes by default: an ordinary valid address that nobody holds the key for (the protocol's all-zeros null address is not one wallets will send to). Only dust moves; the sender is what matters. */
export const SINK_ADDRESS = "NQ82 C0PX LNFH CCAY KENQ 1CEV U2FX R2Y7 4YB2";
export function proofAddress(env: NodeJS.ProcessEnv = process.env): string {
  const firstAdmin = (env.ADMIN_ADDRESSES ?? "").split(",").map((a) => a.trim()).find(Boolean);
  return env.DEALJAR_PROOF_ADDRESS?.trim() || firstAdmin || SINK_ADDRESS;
}

/** The destination of the proof for this signer: never the signer's own address (wallets won't send to yourself). */
export function proofTarget(signer: string, env: NodeJS.ProcessEnv = process.env): string {
  const to = proofAddress(env);
  return sameAddress(to, signer) ? SINK_ADDRESS : to;
}

export type ProofResult = { status: "ok" } | { status: "pending"; reason?: string };

/**
 * Has `address` itself sent a transaction to `to` with this exact memo? A transaction's sender is fixed by its
 * signature, so this proves the person holds the address's key without any message-signing support in their wallet.
 */
export async function findAddressProof(address: string, to: string, memo: string): Promise<ProofResult> {
  const found = await fetchAddressTxs(address);
  if (!found.ok) return { status: "pending", reason: found.reason };
  const matches = found.txs.filter((t) => t.memo === memo && sameAddress(t.from, address) && sameAddress(t.to, to));
  if (!matches.length) return { status: "pending" };
  // Any one good transaction is enough; a failed or still-unconfirmed twin must not hide it.
  if (matches.some((t) => t.executed && t.valueLuna >= 1 && t.confirmations >= 1)) return { status: "ok" };
  return { status: "pending", reason: matches.some((t) => t.executed && t.valueLuna >= 1) ? "waiting_for_confirmation" : "failed_on_chain" };
}
