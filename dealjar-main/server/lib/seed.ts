import { sql } from "drizzle-orm";
import { schema, type DB } from "./db";
import { newId } from "./ids";
import { newReferralCode } from "./referrals";
import { SINK_ADDRESS } from "./nimiq";
import { PLATFORM } from "./pools";
import { usd } from "@shared/money";

const { users, sponsors, pools, poolLedger, deals, prices, jarEntries } = schema;

const day = 86_400_000;
const FALLBACK_NIM_USD = () => Number(process.env.NIM_USD_FALLBACK) || 0.0025;
const nimFor = (dollars: number) => Math.round((dollars / FALLBACK_NIM_USD()) * 100_000);

type Demo = { handle: string; name: string; tagline: string; funded: number; paid: number; cap: number };
const SPONSORS: Demo[] = [
  { handle: "casa_verde", name: "Casa Verde Market", tagline: "A neighbourhood co-op for fresh groceries", funded: 300, paid: 112.25, cap: 12 },
  { handle: "sahel_mobile", name: "Sahel Mobile", tagline: "Data bundles and airtime top-ups", funded: 200, paid: 183, cap: 5 },
  { handle: "costa_cafe", name: "Costa Café Co-op", tagline: "Coffee grown and roasted by its farmers", funded: 150, paid: 150, cap: 8 },
  { handle: "aula_abierta", name: "Aula Abierta", tagline: "Short lessons you can finish on a bus", funded: 400, paid: 116, cap: 10 },
  { handle: "trailhead_stays", name: "Trailhead Stays", tagline: "Guesthouses on the walking routes", funded: 500, paid: 210, cap: 15 },
];

type DemoDeal = { id: string; s: string; title: string; summary: string; category: string; price: number; rate: number; max: number; days: number; community?: boolean; hue: number };
const DEALS: DemoDeal[] = [
  { id: "d-groceries", s: "casa_verde", title: "Weekly basket, 12% back", summary: "Fill a basket of staples from the co-op's weekly list and get 12% of the price back into your jar.", category: "Groceries", price: 40, rate: 0.12, max: 6, days: 21, hue: 160 },
  { id: "d-veg", s: "casa_verde", title: "Seasonal vegetable box", summary: "A box of whatever is in season from nearby growers, with 10% back.", category: "Groceries", price: 18, rate: 0.1, max: 3, days: 12, hue: 130 },
  { id: "d-data", s: "sahel_mobile", title: "5 GB data bundle", summary: "Thirty days of data for one payment, with 8% back.", category: "Airtime & data", price: 6, rate: 0.08, max: 1, days: 9, hue: 20 },
  { id: "d-airtime", s: "sahel_mobile", title: "Airtime top-up, any amount", summary: "Top up any phone on the network and get 5% back.", category: "Airtime & data", price: 10, rate: 0.05, max: 1, days: 7, hue: 350, community: true },
  { id: "d-coffee", s: "costa_cafe", title: "First bag of mountain coffee", summary: "Whole beans, roasted this week. 15% back for your first bag.", category: "Food", price: 12, rate: 0.15, max: 2, days: 14, hue: 40 },
  { id: "d-course", s: "aula_abierta", title: "Money basics, 4 short lessons", summary: "Four ten-minute lessons on saving, with 10% back when you finish paying.", category: "Learning", price: 15, rate: 0.1, max: 2.5, days: 30, hue: 280, community: true },
  { id: "d-stay", s: "trailhead_stays", title: "Trail guesthouse, one night", summary: "A bed, a hot meal and breakfast on the route. 6% back.", category: "Travel", price: 45, rate: 0.06, max: 4, days: 60, hue: 200 },
  { id: "d-class", s: "aula_abierta", title: "Spanish for travellers", summary: "An eight-week starter course. This offer has ended.", category: "Learning", price: 20, rate: 0.08, max: 2, days: -3, hue: 320 },
];

/** Creates the fictional sponsors, deals and demo people on an empty database. Real sponsors never see this: set DEALJAR_SEED=0. */
export async function seedIfEmpty(db: DB) {
  // Reference prices exist from the first moment so every price shows something sensible.
  await db.insert(prices).values([
    { key: "nim_usd", value: FALLBACK_NIM_USD(), source: "fallback" },
    { key: "eur_usd", value: Number(process.env.EUR_USD_FALLBACK) || 1.09, source: "fallback" },
    { key: "xau_usd", value: Number(process.env.XAU_USD_FALLBACK) || 2650, source: "fallback" },
  ]).onConflictDoNothing();

  // The referral pot exists even on a clean database: an admin tops it up.
  await db.insert(pools).values({ id: "pool-platform", sponsorId: PLATFORM, perPersonCap: usd(40) }).onConflictDoNothing();

  if (process.env.DEALJAR_SEED === "0") return;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(sponsors);
  if (n > 0) return;

  const mk = (id: string, name: string, role = "member", username: string | null = null) => ({ id, address: `demo-${id}`, displayName: name, role, username, referralCode: newReferralCode() });
  await db.insert(users).values([mk("demo-member", "Sam (demo)", "member", "sam_demo"), mk("demo-admin", "Admin (demo)", "admin", "admin_demo"), mk("demo-studio", "Demo Studio", "member", "demo_studio")]).onConflictDoNothing();

  // the demo member already has a little in the jar, so the app doesn't open empty
  const when = (d: number) => new Date(Date.now() - d * day);
  await db.insert(jarEntries).values([
    { id: newId(), userId: "demo-member", asset: "USDT", micro: usd(4.8), source: "reward", label: "Reward · Weekly basket, 12% back", createdAt: when(12) },
    { id: newId(), userId: "demo-member", asset: "USDT", micro: usd(1.5), source: "reward", label: "Reward · Money basics, 4 short lessons", createdAt: when(9) },
    { id: newId(), userId: "demo-member", asset: "USDT", micro: usd(-12), source: "swap", label: "Moved into euros", createdAt: when(6) },
    { id: newId(), userId: "demo-member", asset: "EURE", micro: usd(12), source: "swap", label: "Saved into euros", createdAt: when(6) },
    { id: newId(), userId: "demo-member", asset: "USDT", micro: usd(26), source: "referral", label: "Referral · a friend took their first deal", createdAt: when(3) },
    { id: newId(), userId: "demo-member", asset: "USDT", micro: usd(-20), source: "swap", label: "Moved into gold", createdAt: when(2) },
    { id: newId(), userId: "demo-member", asset: "XAUT0", micro: usd(20), source: "swap", label: "Saved into gold", createdAt: when(2) },
  ]);

  for (const s of SPONSORS) {
    const ownerId = `demo-owner-${s.handle}`;
    const sid = `sp-${s.handle}`;
    await db.insert(users).values({ id: ownerId, address: `demo-${ownerId}`, displayName: s.name, username: s.handle, referralCode: newReferralCode() }).onConflictDoNothing();
    await db.insert(sponsors).values({ id: sid, userId: ownerId, handle: s.handle, name: s.name, tagline: s.tagline, bio: s.tagline, payoutAddress: SINK_ADDRESS, verified: true, status: "active", demo: true }).onConflictDoNothing();
    const pid = `pool-${s.handle}`;
    await db.insert(pools).values({ id: pid, sponsorId: sid, funded: usd(s.funded), paid: usd(s.paid), perPersonCap: usd(s.cap) }).onConflictDoNothing();
    await db.insert(poolLedger).values([
      { id: newId(), poolId: pid, kind: "deposit", amount: usd(s.funded), note: `${s.name} funded the pot`, createdAt: new Date(Date.now() - 30 * day) },
      { id: newId(), poolId: pid, kind: "payout", amount: usd(s.paid), note: "Rewards paid so far", createdAt: new Date(Date.now() - 6 * day) },
    ]);
  }
  for (const d of DEALS) {
    await db.insert(deals).values({
      id: d.id,
      sponsorId: `sp-${d.s}`,
      poolId: `pool-${d.s}`,
      title: d.title,
      summary: d.summary,
      category: d.category,
      priceLuna: nimFor(d.price),
      rewardBps: Math.round(d.rate * 10_000),
      rewardMax: usd(d.max),
      expiresAt: new Date(Date.now() + d.days * day),
      community: !!d.community,
      hue: d.hue,
    }).onConflictDoNothing();
  }

  // A sponsor the demo "studio" persona owns, with a real flow behind it (used by the tests with demo payments on).
  await db.insert(sponsors).values({ id: "sp-demo-studio", userId: "demo-studio", handle: "demo_studio", name: "Demo Studio", tagline: "Where the test purchases happen", bio: "The demo sponsor used to try the whole flow.", payoutAddress: SINK_ADDRESS, verified: false, status: "active", demo: false }).onConflictDoNothing();
  await db.insert(pools).values({ id: "pool-demo-studio", sponsorId: "sp-demo-studio", funded: usd(100), perPersonCap: usd(10) }).onConflictDoNothing();
  await db.insert(poolLedger).values({ id: newId(), poolId: "pool-demo-studio", kind: "deposit", amount: usd(100), note: "Demo Studio funded the pot" });
  await db.insert(deals).values({ id: "d-demo-1", sponsorId: "sp-demo-studio", poolId: "pool-demo-studio", title: "Demo purchase, 10% back", summary: "A deal for trying the whole flow.", category: "Food", priceLuna: nimFor(10), rewardBps: 1000, rewardMax: usd(2), expiresAt: new Date(Date.now() + 90 * day), hue: 100 }).onConflictDoNothing();

}
