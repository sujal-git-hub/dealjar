// The savings choices and their labels (an "Asset Passport": type, issuer, peg, contract, exit, who may hold).
//
// IMPORTANT: every passport here is a DRAFT (`reviewed: false`) written from public descriptions in the competition
// guide. Before launch, each line must be checked against the issuer's own documents and `reviewed` set to true.
// Prices and market depth are illustrative placeholders; the server will provide live values.
import type { Asset, AssetId } from "./types";

export const ASSETS: Record<AssetId, Asset> = {
  USDT: {
    id: "USDT",
    name: "US dollar (USDT)",
    short: "Dollars",
    priceUsd: 1,
    depthUsd: 5_000_000,
    color: "#0e9f6e",
    passport: {
      type: "Fiat-backed stablecoin",
      issuer: "A private company holds the reserves. It can freeze tokens.",
      peg: "Aims for 1 token = 1 US dollar. The price can drift in a crisis.",
      contract: "Widely used and long established. On Polygon it may be a bridged version.",
      exit: "Instant to swap or send. Cashing out to a bank depends on your exchange.",
      who: "Anyone, subject to the issuer's terms.",
      risk: "low",
      reviewed: false,
    },
  },
  EURE: {
    id: "EURE",
    name: "Euro (EURe)",
    short: "Euros",
    priceUsd: 1.09,
    depthUsd: 40_000,
    color: "#4f46e5",
    passport: {
      type: "Euro e-money token",
      issuer: "Issued by a regulated e-money institution that holds euros in bank accounts.",
      peg: "Redeemable 1 token = 1 euro with the issuer, which needs an account.",
      contract: "Native to Polygon. Check the contract address on the issuer's site.",
      exit: "Swapping back is quick for small amounts and costs more for large ones: liquidity is thin.",
      who: "Anyone for swaps. Redeeming to a bank needs an identity check.",
      risk: "medium",
      reviewed: false,
    },
  },
  XAUT0: {
    id: "XAUT0",
    name: "Gold (XAUt0)",
    short: "Gold",
    priceUsd: 2650,
    depthUsd: 250_000,
    color: "#d99a00",
    passport: {
      type: "Tokenized gold",
      issuer: "Each token represents gold held by the issuer. It can freeze tokens.",
      peg: "A market asset: its price follows gold and goes up and down.",
      contract: "A multi-chain version of an older gold token. Bridged and upgradeable, so it carries bridge risk.",
      exit: "Instant to swap while the pool is deep. Large sales move the price.",
      who: "Anyone for swaps. Some issuers restrict certain countries.",
      risk: "high",
      reviewed: false,
    },
  },
};

export const ASSET_LIST: Asset[] = [ASSETS.USDT, ASSETS.EURE, ASSETS.XAUT0];

/** The six rows of a passport, in the order they are shown. */
export const PASSPORT_ROWS: { key: keyof Asset["passport"]; label: string }[] = [
  { key: "type", label: "What it is" },
  { key: "issuer", label: "Who is behind it" },
  { key: "peg", label: "Its price" },
  { key: "contract", label: "How it's built" },
  { key: "exit", label: "Getting out" },
  { key: "who", label: "Who can hold it" },
];
