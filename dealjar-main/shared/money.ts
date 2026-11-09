// Money helpers: micro-units, the user's own currency, and how much a swap would move the price.
import { CURRENCIES, type Asset, type Currency } from "./types";

export const MICRO = 1_000_000;

/** Whole USD (or USDT) as micro-units. */
export const usd = (n: number): number => Math.round(n * MICRO);
export const toUnits = (micro: number): number => micro / MICRO;

/**
 * How much of each currency one US dollar buys. These are illustrative numbers for the demo; the server will
 * serve live rates, and every screen that shows a converted figure says so.
 */
export const FX: Record<Currency, number> = { USD: 1, EUR: 0.92, CRC: 505, GMD: 70 };

export const isCurrency = (s: unknown): s is Currency => typeof s === "string" && (CURRENCIES as string[]).includes(s);

/** Micro-USD to a number in the chosen currency. */
export const inCurrency = (microUsd: number, c: Currency): number => toUnits(microUsd) * FX[c];

const fractionDigits: Record<Currency, number> = { USD: 2, EUR: 2, CRC: 0, GMD: 0 };

export function formatMoney(microUsd: number, c: Currency, opts: { compact?: boolean } = {}): string {
  const value = inCurrency(microUsd, c);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: c,
    minimumFractionDigits: opts.compact && Math.abs(value) >= 1000 ? 0 : fractionDigits[c],
    maximumFractionDigits: opts.compact && Math.abs(value) >= 1000 ? 0 : fractionDigits[c],
    notation: opts.compact && Math.abs(value) >= 100_000 ? "compact" : "standard",
  }).format(value);
}

/** What a holding of `microUsd` worth of an asset is, as a count of that asset's tokens. */
export const tokensFor = (asset: Asset, microUsd: number): number => toUnits(microUsd) / asset.priceUsd;

/** Rough share by which a swap of `usdAmount` moves the price against the buyer (constant-product style). */
export function priceImpact(asset: Asset, usdAmount: number): number {
  if (usdAmount <= 0) return 0;
  return usdAmount / (asset.depthUsd + usdAmount);
}

/** The competition guide asks us to call an asset "thin" when a trade moves the price by more than about 1%. */
export const THIN_IMPACT = 0.01;
export const isThin = (asset: Asset, usdAmount: number): boolean => priceImpact(asset, usdAmount) > THIN_IMPACT;
