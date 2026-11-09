import { getDb, schema } from "./db";

/*
  Exchange rates. Rewards are measured in micro-USD, payments in NIM, and the jar can hold dollars, euros or gold,
  so three numbers connect them: NIM in USD, EUR in USD and one troy ounce of gold in USD. A cron job refreshes them
  from CoinGecko's free API; until it has run, sensible fallbacks apply (overridable by env). Every payment records the
  NIM rate it was made at, so a later price move never changes what an old purchase was worth.
*/
export type Rates = { nimUsd: number; eurUsd: number; xauUsd: number; updatedAt: Date | null; live: boolean };

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const FALLBACK = () => ({ nimUsd: num(process.env.NIM_USD_FALLBACK, 0.0025), eurUsd: num(process.env.EUR_USD_FALLBACK, 1.09), xauUsd: num(process.env.XAU_USD_FALLBACK, 2650) });

let cache: { at: number; rates: Rates } | null = null;

export async function getRates(): Promise<Rates> {
  if (cache && Date.now() - cache.at < 60_000) return cache.rates;
  const db = await getDb();
  const rows = await db.select().from(schema.prices);
  const by = new Map(rows.map((r) => [r.key, r]));
  const f = FALLBACK();
  const pick = (k: string, d: number) => by.get(k)?.value ?? d;
  const stamps = rows.filter((r) => r.source !== "fallback").map((r) => r.updatedAt.getTime());
  const rates: Rates = {
    nimUsd: pick("nim_usd", f.nimUsd),
    eurUsd: pick("eur_usd", f.eurUsd),
    xauUsd: pick("xau_usd", f.xauUsd),
    updatedAt: stamps.length ? new Date(Math.max(...stamps)) : null,
    live: stamps.length === 3,
  };
  cache = { at: Date.now(), rates };
  return rates;
}

export const clearRates = () => {
  cache = null;
};

/** NIM paid, in Luna, to micro-USD at a rate. Rounds down so a pot is never over-promised. */
export const lunaToMicro = (luna: number, nimUsd: number) => Math.floor((luna / 100_000) * nimUsd * 1_000_000);
/** Micro-USD to Luna, rounded down. */
export const microToLuna = (micro: number, nimUsd: number) => Math.floor((micro / 1_000_000 / nimUsd) * 100_000);

async function put(key: string, value: number, source: string) {
  const db = await getDb();
  await db
    .insert(schema.prices)
    .values({ key, value, source })
    .onConflictDoUpdate({ target: schema.prices.key, set: { value, source, updatedAt: new Date() } });
}

/**
 * Pulls fresh prices. Never throws: a failed fetch keeps the last known rates and reports why, so a flaky
 * price API can't take payments down. Sanity-checked, so one absurd response can't move the rates.
 */
export async function refreshRates(): Promise<{ ok: boolean; detail: string }> {
  try {
    const url = process.env.PRICE_API_URL ?? "https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2,tether-gold&vs_currencies=usd,eur";
    const headers: Record<string, string> = { accept: "application/json" };
    if (process.env.PRICE_API_KEY) headers["x-cg-demo-api-key"] = process.env.PRICE_API_KEY;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, detail: `price API answered ${res.status}` };
    const j = (await res.json()) as Record<string, { usd?: number; eur?: number }>;
    const nim = j["nimiq-2"]?.usd;
    const eurPerUsd = j["nimiq-2"]?.eur && nim ? j["nimiq-2"].eur / nim : undefined;
    const gold = j["tether-gold"]?.usd;
    const before = await getRates();
    const sane = (v: number | undefined, prev: number, band: number) => typeof v === "number" && Number.isFinite(v) && v > 0 && v < prev * band && v > prev / band;
    const out: string[] = [];
    if (sane(nim, before.nimUsd, before.live ? 5 : 1000)) {
      await put("nim_usd", nim!, "coingecko");
      out.push(`NIM ${nim}`);
    }
    if (eurPerUsd && eurPerUsd > 0.5 && eurPerUsd < 2) {
      await put("eur_usd", 1 / eurPerUsd, "coingecko");
      out.push(`EUR ${(1 / eurPerUsd).toFixed(4)}`);
    }
    if (sane(gold, before.xauUsd, 2)) {
      await put("xau_usd", gold!, "coingecko");
      out.push(`gold ${gold}`);
    }
    clearRates();
    return out.length ? { ok: true, detail: out.join(", ") } : { ok: false, detail: "price API answered, but nothing usable in it" };
  } catch (e) {
    return { ok: false, detail: `price fetch failed: ${(e as Error).message}` };
  }
}

export async function setRate(key: "nim_usd" | "eur_usd" | "xau_usd", value: number, source = "admin") {
  await put(key, value, source);
  clearRates();
}

