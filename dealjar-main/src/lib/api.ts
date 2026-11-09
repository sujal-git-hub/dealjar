// Everything the screens read from the server. One fetch wrapper (it sends the bearer token the Nimiq Pay WebView
// needs, since cookies may not survive there) and one query hook per thing a screen shows.
import { useQuery } from "@tanstack/react-query";
import { getToken } from "./session";
import type { AssetId, Deal, JarEntry, LedgerEntry, Pool, Sponsor } from "@shared/types";
import type { ProfileLink } from "@shared/profile";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (!(body instanceof FormData) && body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), credentials: "same-origin" });
  } catch {
    throw new ApiError("Couldn't reach DealJar. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(data.error ?? "Something went wrong", res.status);
  return data;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const imgUrl = (key?: string | null) => (key ? `/api/img/${key}` : undefined);

/* ----------------------------------- types ----------------------------------- */

export type Catalog = { deals: Deal[]; pools: Pool[]; sponsors: Sponsor[]; rates: { nimUsd: number; live: boolean } };
export type DealPage = { deal: Deal; sponsor: Sponsor | null; pool: Pool | null; earned: number; nimUsd: number };
export type SponsorPageData = {
  sponsor: Sponsor & { bio: string; links: ProfileLink[]; joinedAt: string };
  status: string;
  deals: Deal[];
  pool: Pool | null;
  isMine: boolean;
};
export type JarData = {
  holdings: Record<AssetId, number>;
  goal: { name: string; target: number };
  entries: (JarEntry & { id: string })[];
  cashouts: { id: string; amount: number; amountLuna: number; status: "pending" | "paid" | "rejected"; txHash: string | null; note: string | null; at: string; paidAt: string | null }[];
  nimUsd: number;
};
export type ReferralData = { code: string | null; invited: number; paid: number; earned: number; perFriend: number; potFunded: number; potPaid: number; referredBy: boolean };
export type MyProfile = {
  username: string | null;
  name: string;
  bio: string;
  avatarKey: string | null;
  bannerKey: string | null;
  accent: string;
  links: ProfileLink[];
  currency: string;
  goal: { name: string; target: number };
  showStats: boolean;
  joinedAt: string;
  nextUsernameChange: string | null;
  canChangeUsername: boolean;
};
export type PublicUser = { sponsorHandle?: string; user?: { username: string; name: string; bio: string; avatarKey: string | null; bannerKey: string | null; links: ProfileLink[]; joinedAt: string }; stats: { dealsTaken: number; earnedMicro: number } | null; isMe?: boolean };
export type StudioData = {
  sponsor: null | (Sponsor & { bio: string; links: ProfileLink[]; joinedAt: string; status: string; payoutAddress: string });
  pool?: Pool | null;
  deals?: (Deal & { status: string; sold: number; soldLuna: number })[];
  topups?: { id: string; status: string; amountLuna: number; at: string }[];
  canFund?: boolean;
};
export type Receipt = { id: string; kind: string; status: "confirmed" | "pending"; item: string; sponsor: string; amountLuna: number; rewardMicro: number; rewardState: string; txHash: string | null; at: string };
export type AdminData = {
  sponsors: { id: string; handle: string; name: string; status: string; verified: boolean; demo: boolean; payoutAddress: string; createdAt: string }[];
  reports: { id: string; dealId: string; dealTitle: string; reason: string; at: string }[];
  cashouts: { id: string; amount: number; amountLuna: number; address: string; at: string }[];
  jobs: { id: string; name: string; ok: boolean; detail: string; at: string }[];
  jobNames: string[];
  blockedReferrals: { id: string; reason: string | null; at: string }[];
  platform: Pool | null;
  counts: { members: number; purchases: number; pending: number };
  rates: { nimUsd: number; live: boolean; updatedAt: string | null };
};

/* ----------------------------------- hooks ----------------------------------- */

export const useCatalog = () => useQuery({ queryKey: ["catalog"], queryFn: () => api<Catalog>("/api/catalog"), staleTime: 15_000 });
export const useLedger = () => useQuery({ queryKey: ["ledger"], queryFn: () => api<{ ledger: LedgerEntry[]; platform: Pool | null }>("/api/ledger"), staleTime: 15_000 });
export const useDeal = (id: string) => useQuery({ queryKey: ["deal", id], queryFn: () => api<DealPage>(`/api/deals/${id}`), retry: false });
export const useSponsorPage = (handle: string) => useQuery({ queryKey: ["sponsor", handle], queryFn: () => api<SponsorPageData>(`/api/sponsors/${handle}`), retry: false });
export const usePublicUser = (username: string) => useQuery({ queryKey: ["user", username], queryFn: () => api<PublicUser>(`/api/users/${username}`), retry: false });
export const useJar = (enabled: boolean) => useQuery({ queryKey: ["jar"], queryFn: () => api<JarData>("/api/jar"), enabled });
export const useReferral = (enabled: boolean) => useQuery({ queryKey: ["referral"], queryFn: () => api<ReferralData>("/api/referral"), enabled });
export const useMyProfile = (enabled: boolean) => useQuery({ queryKey: ["my-profile"], queryFn: () => api<MyProfile>("/api/me/profile"), enabled });
export const useStudio = (enabled: boolean) => useQuery({ queryKey: ["studio"], queryFn: () => api<StudioData>("/api/studio"), enabled });
export const useReceipts = (enabled: boolean) => useQuery({ queryKey: ["receipts"], queryFn: () => api<{ receipts: Receipt[] }>("/api/me/receipts"), enabled });
export const useAdmin = (enabled: boolean) => useQuery({ queryKey: ["admin"], queryFn: () => api<AdminData>("/api/admin"), enabled, retry: false });
