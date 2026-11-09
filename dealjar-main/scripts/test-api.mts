/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies and key pairs are untyped here on purpose */
// End-to-end API test. It starts its own server on a fresh embedded database, with a MOCK Nimiq JSON-RPC node that
// answers in the field shape of core-rs-albatross (`to`, `value`, `recipientData` hex, `confirmations`,
// `executionResult`), and signs in with real, locally generated Nimiq key pairs.
//
// It proves our rules: sign-in, usernames, profiles, uploads, sponsors, deals and banners, pot funding, purchases,
// rewards that can never exceed a pot, referrals with the device guard, the jar, cash-outs, admin, and cron.
// It cannot prove what a live node answers, or what Nimiq Pay's sign() digests; those need a real node and a device.
//
//   npm run test:api
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const Nimiq = require("@nimiq/core");
const enc = new TextEncoder();
const hex = (u8: Uint8Array) => Buffer.from(u8).toString("hex");
const hexStr = (s: string) => Buffer.from(s, "utf8").toString("hex");
const norm = (a: string) => String(a).replace(/\s/g, "").toUpperCase();

// fresh ports every run, so a server left over from an earlier run can never be mistaken for this one
const PORT = 8800 + Math.floor(Math.random() * 900);
const NODE_PORT = 4100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${PORT}`;
const work = mkdtempSync(path.join(tmpdir(), "dealjar-test-"));

// ---------------------------------------------------------------- a mock Nimiq node
type Tx = { hash?: string; from: string; to: string; value: number; recipientData: string; confirmations: number; executionResult: boolean };
const chain = new Map<string, Tx>();
const node = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const { params, id, method } = JSON.parse(b);
    res.setHeader("content-type", "application/json");
    if (method === "getTransactionsByAddress") {
      const data = [...chain.entries()].filter(([, t]) => norm(t.to) === norm(params[0]) || norm(t.from) === norm(params[0])).map(([hash, t]) => ({ hash, ...t }));
      return res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { data, metadata: null } }));
    }
    const t = chain.get(params[0]);
    res.end(JSON.stringify(t ? { jsonrpc: "2.0", id, result: { data: { hash: params[0], ...t }, metadata: null } } : { jsonrpc: "2.0", id, error: { code: -32602, message: "not found" } }));
  });
});
await new Promise<void>((r) => node.listen(NODE_PORT, r));
let seq = 1;
const hash = () => (seq++).toString(16).padStart(64, "0");
const send = (from: string, to: string, valueLuna: number, memo: string, extra: Partial<Tx> = {}) => {
  const h = hash();
  chain.set(h, { from, to, value: valueLuna, recipientData: hexStr(memo), confirmations: 3, executionResult: true, ...extra });
  return h;
};

// ---------------------------------------------------------------- keys
type Keys = { priv: any; pub: any; address: string };
const newKeys = (): Keys => {
  const priv = Nimiq.PrivateKey.generate();
  const pub = Nimiq.PublicKey.derive(priv);
  return { priv, pub, address: pub.toAddress().toUserFriendlyAddress() };
};
function sign(k: Keys, message: string) {
  const raw = enc.encode(message);
  const prefixed = new Uint8Array([...enc.encode(`\x16Nimiq Signed Message:\n${raw.length}`), ...raw]);
  return hex(Nimiq.Signature.create(k.priv, k.pub, Nimiq.Hash.computeSha256(prefixed)).serialize());
}
const POOL = newKeys();
const ADMIN_KEYS = newKeys();

// ---------------------------------------------------------------- server
const dbDir = path.join(work, "pg");
const server = spawn("npx", ["tsx", "server/index.ts"], {
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(PORT),
    API_PORT: String(PORT),
    NODE_ENV: "development",
    PGLITE_DIR: dbDir,
    MEDIA_DIR: path.join(work, "media"),
    DATABASE_URL: "",
    S3_BUCKET: "",
    NIMIQ_RPC_URL: `http://localhost:${NODE_PORT}`,
    POOL_ADDRESS: POOL.address,
    ADMIN_ADDRESSES: ADMIN_KEYS.address,
    DEALJAR_DEMO: "1",
    DEALJAR_DEMO_PAYMENTS: "0",
    DEALJAR_NO_RATE_LIMIT: "1",
    DEALJAR_SEED: "1",
    CRON_SECRET: "test-cron-secret-1234567890",
    NIM_USD_FALLBACK: "0.0025",
    RESERVATION_MINUTES: "0.004", // 240 ms, so expiry can be tested
    REFERRAL_REWARD_MICRO: "2000000",
  },
});
let serverLog = "";
let serverExit: string | null = null;
server.on("exit", (code) => (serverExit = `exited with code ${code}`));
server.stdout?.on("data", (d) => (serverLog += d));
server.stderr?.on("data", (d) => (serverLog += d));

async function stop() {
  server.kill();
  if (server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  node.close();
  await new Promise((r) => setTimeout(r, 400));
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows is fine */
  }
}

// ---------------------------------------------------------------- helpers
type R = { status: number; body: any; headers: Headers };
async function req(method: string, p: string, o: { token?: string; body?: unknown; form?: FormData; headers?: Record<string, string> } = {}): Promise<R> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  let r: Response;
  try {
    r = await fetch(base + p, { method, headers, body: o.form ?? (o.body === undefined ? undefined : JSON.stringify(o.body)) });
  } catch (e) {
    throw new Error(`${method} ${p} failed: ${(e as Error).message} (server ${serverExit ?? "still running"})`, { cause: e });
  }
  const text = await r.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, body, headers: r.headers };
}
const get = (p: string, token?: string) => req("GET", p, { token });
const post = (p: string, body: unknown, token?: string) => req("POST", p, { token, body: body ?? {} });
const patch = (p: string, body: unknown, token?: string) => req("PATCH", p, { token, body });

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`);
};
const eq = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let counter = 0;
const uname = (p: string) => `${p}_${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}`;

async function walletLogin(k: Keys) {
  const ch = (await post("/api/auth/challenge", {})).body;
  const r = await post("/api/auth/verify", { nonce: ch.nonce, publicKey: k.pub.toHex(), signature: sign(k, ch.message) });
  return r;
}
/** A fresh member with a username, signed in by a real signature. */
async function newMember(prefix = "mem") {
  const k = newKeys();
  const r = await walletLogin(k);
  const token: string = r.body.token;
  const username = uname(prefix);
  const u = await req("PUT", "/api/me/username", { token, body: { username } });
  if (u.status !== 200) throw new Error(`username failed: ${JSON.stringify(u.body)}`);
  return { k, token, username, id: r.body.user.id as string, referralCode: r.body.user.referralCode as string };
}
const demo = async (persona: "member" | "studio" | "admin") => (await post("/api/auth/demo", { persona })).body.token as string;

async function pay(token: string, intent: { amountLuna: number; recipient: string; memo: string }, from = newKeys().address, over: Partial<Tx> = {}) {
  const h = send(from, intent.recipient, intent.amountLuna, intent.memo, over);
  return { hash: h, res: await post("/api/payments/confirm", { intentId: (intent as any).id, txHash: h }, token) };
}

// ---------------------------------------------------------------- run
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(500);
    if (i === 79) throw new Error("server did not start:\n" + serverLog);
  }
  console.log("— health and catalog");
  const cat = (await get("/api/catalog")).body;
  check("catalog lists the seeded demo deals", cat.deals.length >= 8, String(cat.deals?.length));
  check("every pot satisfies committed + paid <= funded", cat.pools.every((p: any) => p.committed + p.paid <= p.funded));
  check("API responses are not cacheable", (await get("/api/catalog")).headers.get("cache-control") === "no-store");

  console.log("— wallet sign-in (Nimiq Pay)");
  const A = newKeys();
  const ch = (await post("/api/auth/challenge", {})).body;
  const ok = await post("/api/auth/verify", { nonce: ch.nonce, publicKey: A.pub.toHex(), signature: sign(A, ch.message) });
  check("a valid signature signs in as the address derived from the key", ok.status === 200 && norm(ok.body.user.address) === norm(A.address), JSON.stringify(ok.body));
  check("a new account is asked for a username", ok.body.user.needsUsername === true);
  check("a new account gets a referral code", /^JAR-[A-Z0-9]{6}$/.test(ok.body.user.referralCode ?? ""));
  eq("replaying the same challenge is rejected", (await post("/api/auth/verify", { nonce: ch.nonce, publicKey: A.pub.toHex(), signature: sign(A, ch.message) })).status, 400);
  {
    const c2 = (await post("/api/auth/challenge", {})).body;
    const other = newKeys();
    eq("a signature by another key is rejected", (await post("/api/auth/verify", { nonce: c2.nonce, publicKey: A.pub.toHex(), signature: sign(other, c2.message) })).status, 401);
    const c3 = (await post("/api/auth/challenge", {})).body;
    eq("a signature over a different message is rejected", (await post("/api/auth/verify", { nonce: c3.nonce, publicKey: A.pub.toHex(), signature: sign(A, c3.message + "x") })).status, 401);
  }
  const tokenA: string = ok.body.token;
  eq("the bearer token works (the Nimiq Pay WebView fallback)", (await get("/api/me", tokenA)).body.user?.id, ok.body.user.id);
  eq("no token means no user", (await get("/api/me")).body.user, null);
  eq("a garbage token means no user", (await get("/api/me", "not.a.token")).body.user, null);

  console.log("— usernames and profile");
  eq("a too-short username is refused", (await get("/api/username/check?u=ab", tokenA)).body.available, false);
  eq("a reserved username is refused", (await get("/api/username/check?u=admin", tokenA)).body.available, false);
  eq("a taken username is refused", (await get("/api/username/check?u=sam_demo", tokenA)).body.reason, "taken");
  const nameFirst = uname("ana");
  eq("choosing a username works", (await req("PUT", "/api/me/username", { token: tokenA, body: { username: nameFirst } })).status, 200);
  const nameA = uname("ana");
  eq("the first change after choosing is free", (await req("PUT", "/api/me/username", { token: tokenA, body: { username: nameA } })).status, 200);
  eq("after that, changing again within a week is limited", (await req("PUT", "/api/me/username", { token: tokenA, body: { username: uname("ana") } })).status, 429);
  eq("the old username page is gone", (await get(`/api/users/${nameFirst}`)).status, 404);
  eq("a link that isn't https is refused", (await patch("/api/me", { links: [{ label: "Site", url: "http://example.com" }] }, tokenA)).status, 400);
  eq("a javascript: link is refused", (await patch("/api/me", { links: [{ label: "x", url: "javascript:alert(1)" }] }, tokenA)).status, 400);
  eq("a bad currency is refused", (await patch("/api/me", { currency: "XYZ" }, tokenA)).status, 400);
  eq("name, bio, links, currency and goal save", (await patch("/api/me", { displayName: "Ana Lima", bio: "Saving for a laptop.", links: [{ label: "Site", url: "https://example.com" }], currency: "EUR", goalName: "A laptop", goalTarget: 300_000_000 }, tokenA)).status, 200);
  const prof = (await get("/api/me/profile", tokenA)).body;
  check("the profile reads back", prof.name === "Ana Lima" && prof.currency === "EUR" && prof.goal.target === 300_000_000 && prof.links.length === 1, JSON.stringify(prof));
  {
    const png = await sharp({ create: { width: 900, height: 700, channels: 3, background: { r: 30, g: 60, b: 200 } } }).png().toBuffer();
    const form = new FormData();
    form.set("file", new File([new Uint8Array(png)], "a.png", { type: "image/png" }));
    const up = await req("PUT", "/api/me/art/avatar", { token: tokenA, form });
    check("an avatar uploads", up.status === 200 && /^[0-9a-f-]{36}\.webp$/.test(up.body.key ?? ""), JSON.stringify(up.body));
    const img = await fetch(`${base}/api/img/${up.body.key}`);
    check("the avatar is served as WebP with long caching", img.status === 200 && img.headers.get("content-type") === "image/webp" && /immutable/.test(img.headers.get("cache-control") ?? ""));
    const bad = new FormData();
    bad.set("file", new File([Buffer.from("<html><script>alert(1)</script></html>")], "x.png", { type: "image/png" }));
    eq("a non-image renamed .png is refused", (await req("PUT", "/api/me/art/banner", { token: tokenA, form: bad })).status, 400);
    eq("only known image keys are served", (await fetch(`${base}/api/img/..%2F..%2Fpackage.json`)).status, 404);
  }
  const pub = (await get(`/api/users/${nameA}`)).body;
  check("a public profile shows what was chosen and no address", pub.user?.name === "Ana Lima" && !JSON.stringify(pub).includes(A.address.replace(/\s/g, "")) && !JSON.stringify(pub).includes("NQ"), JSON.stringify(pub));

  console.log("— browser sign-in by proving an address");
  {
    const B = newKeys();
    const st = await post("/api/auth/address/start", { address: B.address });
    check("start returns a code, a destination and a memo", st.status === 200 && st.body.memo === `DJL:${st.body.code}` && st.body.amountLuna === 1, JSON.stringify(st.body));
    eq("a malformed address is refused", (await post("/api/auth/address/start", { address: "NQ00 NOPE" })).status, 400);
    eq("with no proof yet it stays pending", (await post("/api/auth/address/check", { code: st.body.code })).body.status, "pending");
    send(newKeys().address, st.body.to, 1, st.body.memo); // someone ELSE sends it: must not count
    eq("a proof sent from a different address doesn't count", (await post("/api/auth/address/check", { code: st.body.code })).body.status, "pending");
    send(B.address, st.body.to, 1, "DJL:wrong"); // right sender, wrong memo
    eq("the wrong memo doesn't count", (await post("/api/auth/address/check", { code: st.body.code })).body.status, "pending");
    send(B.address, st.body.to, 1, st.body.memo);
    const done = await post("/api/auth/address/check", { code: st.body.code });
    check("the real proof signs in as that address", done.body.status === "ok" && norm(done.body.user.address) === norm(B.address), JSON.stringify(done.body));
    eq("the code works once only", (await post("/api/auth/address/check", { code: st.body.code })).status, 400);
    eq("a proof code can't be used as a wallet signature", (await post("/api/auth/verify", { nonce: st.body.code, publicKey: B.pub.toHex(), signature: sign(B, "x") })).status, 400);
  }

  console.log("— sign in on another device (pairing code)");
  {
    const start = (await post("/api/auth/pair/start", {})).body;
    check("a pairing code looks like XXXX-XXXX", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(start.code), start.code);
    eq("before approval it is pending", (await post("/api/auth/pair/check", { secret: start.secret })).body.status, "pending");
    eq("approving needs a signed-in user", (await post("/api/auth/pair/approve", { code: start.code })).status, 401);
    eq("a wrong code can't be approved", (await post("/api/auth/pair/approve", { code: "AAAA-AAAA" }, tokenA)).status, 400);
    eq("a signed-in user approves it", (await post("/api/auth/pair/approve", { code: start.code }, tokenA)).status, 200);
    const got = await post("/api/auth/pair/check", { secret: start.secret });
    check("the browser receives a session for that account", got.body.status === "ok" && got.body.user.id === ok.body.user.id);
    eq("a pairing secret works once only", (await post("/api/auth/pair/check", { secret: start.secret })).status, 400);
  }

  console.log("— becoming a sponsor");
  const S = await newMember("shop");
  eq("a sponsor can't add a deal before having a page", (await post("/api/studio/deals", { title: "x" }, S.token)).status, 403);
  eq("a bad payout address is refused", (await post("/api/studio/sponsor", { name: "Test Shop", payoutAddress: "NQ00 BAD" }, S.token)).status, 400);
  const payout = newKeys();
  eq("a sponsor page is created", (await post("/api/studio/sponsor", { name: "Test Shop", tagline: "Fresh things", payoutAddress: payout.address }, S.token)).status, 200);
  eq("a second page is refused", (await post("/api/studio/sponsor", { name: "Again", payoutAddress: payout.address }, S.token)).status, 409);
  eq("new sponsors wait for approval", (await get("/api/studio", S.token)).body.sponsor.status, "pending");
  const deal = { title: "Fresh box", summary: "A box.", category: "Food", priceNim: 1000, rewardPercent: 10, rewardMaxUsd: 2, days: 30 };
  eq("an unapproved sponsor can't add deals", (await post("/api/studio/deals", deal, S.token)).status, 403);
  eq("an unapproved sponsor page isn't public", (await get(`/api/sponsors/${S.username}`)).status, 404);
  const adminToken = await demo("admin");
  const adminView = (await get("/api/admin", adminToken)).body;
  const mine = adminView.sponsors.find((s: any) => s.handle === S.username);
  check("the admin sees the new sponsor", !!mine);
  eq("a member can't open the admin", (await get("/api/admin", S.token)).status, 403);
  eq("the admin approves the sponsor", (await post(`/api/admin/sponsors/${mine.id}`, { action: "approve" }, adminToken)).status, 200);

  console.log("— deals and banners");
  eq("a price above the cap is refused", (await post("/api/studio/deals", { ...deal, priceNim: 1e9 }, S.token)).status, 400);
  eq("cashback above 25% is refused", (await post("/api/studio/deals", { ...deal, rewardPercent: 60 }, S.token)).status, 400);
  const made = await post("/api/studio/deals", deal, S.token);
  eq("an approved sponsor adds a deal", made.status, 200);
  const dealId: string = made.body.id;
  {
    const jpg = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 220, g: 90, b: 40 } } }).jpeg().toBuffer();
    const form = new FormData();
    form.set("file", new File([new Uint8Array(jpg)], "b.jpg", { type: "image/jpeg" }));
    const up = await req("PUT", `/api/studio/deals/${dealId}/art`, { token: S.token, form });
    check("a deal banner uploads", up.status === 200 && !!up.body.key, JSON.stringify(up.body));
    const meta = await sharp(Buffer.from(await (await fetch(`${base}/api/img/${up.body.key}`)).arrayBuffer())).metadata();
    check("the banner is resized to 1200x630 WebP", meta.format === "webp" && meta.width === 1200 && meta.height === 630, `${meta.format} ${meta.width}x${meta.height}`);
    const other = await newMember("oth");
    const f2 = new FormData();
    f2.set("file", new File([new Uint8Array(jpg)], "b.jpg", { type: "image/jpeg" }));
    eq("someone else can't change this deal's banner", (await req("PUT", `/api/studio/deals/${dealId}/art`, { token: other.token, form: f2 })).status, 403);
  }
  const listed = (await get("/api/catalog")).body.deals.find((d: any) => d.id === dealId);
  check("the new deal and its banner are in the public catalog", !!listed?.bannerKey && listed.priceLuna === 100_000_000, JSON.stringify(listed));
  check("a sponsor page lists its deals", (await get(`/api/sponsors/${S.username}`)).body.deals.length === 1);
  eq("a sponsor can hide a deal", (await patch(`/api/studio/deals/${dealId}`, { status: "hidden" }, S.token)).status, 200);
  check("a hidden deal leaves the catalog", !(await get("/api/catalog")).body.deals.some((d: any) => d.id === dealId));
  eq("and can show it again", (await patch(`/api/studio/deals/${dealId}`, { status: "live" }, S.token)).status, 200);

  console.log("— funding the pot");
  const M = await newMember("buyer");
  const noPot = await post("/api/payments/intent", { kind: "purchase", dealId }, M.token);
  eq("an unfunded pot reserves no reward, but the deal still works", (await get(`/api/deals/${dealId}`, M.token)).body.pool.committed, 0);
  check("a purchase intent is created with a memo", noPot.status === 200 && noPot.body.intent.memo === `DJ:${noPot.body.intent.id}` && noPot.body.intent.recipient === payout.address, JSON.stringify(noPot.body));
  eq("a member can't fund a pot", (await post("/api/payments/intent", { kind: "topup", amountNim: 10 }, M.token)).status, 403);
  const top = (await post("/api/payments/intent", { kind: "topup", amountNim: 20_000 }, S.token)).body.intent;
  check("a top-up pays the pot address with a DP: memo", norm(top.recipient) === norm(POOL.address) && top.memo === `DP:${top.id}`, JSON.stringify(top));
  eq("a top-up not on-chain yet stays pending", (await post("/api/payments/confirm", { intentId: top.id, txHash: hash() }, S.token)).body.status, "pending");
  const tp = await pay(S.token, top, S.k.address);
  eq("a verified top-up is confirmed", tp.res.body.status, "confirmed");
  const pot0 = (await get(`/api/deals/${dealId}`, M.token)).body.pool;
  eq("the pot is credited in dollars at the rate of the day (20,000 NIM at $0.0025 = $50)", pot0.funded, 50_000_000);

  console.log("— purchases and rewards");
  const fresh = (await post("/api/payments/intent", { kind: "purchase", dealId }, M.token)).body.intent; // price 1000 NIM = $2.50, 10% = $0.25
  const reserved = (await get(`/api/deals/${dealId}`, M.token)).body.pool;
  eq("a purchase reserves exactly its reward (10% of $2.50)", reserved.committed, 250_000);
  const demoTry = (await post("/api/payments/intent", { kind: "purchase", dealId }, M.token)).body.intent;
  eq("a demo transaction hash is refused when demo payments are off", (await post("/api/payments/confirm", { intentId: demoTry.id, txHash: "demo-abcdef12" }, M.token)).body.status, "failed");
  const second = (await post("/api/payments/intent", { kind: "purchase", dealId }, M.token)).body.intent;
  const paid1 = await pay(M.token, second, M.k.address, { value: 1 }); // wrong amount
  eq("a payment of the wrong amount is refused", paid1.res.body, { status: "failed", reason: "Amount too low" });
  const third = (await post("/api/payments/intent", { kind: "purchase", dealId }, M.token)).body.intent;
  const wrongTo = await pay(M.token, third, M.k.address, { to: newKeys().address });
  eq("a payment to the wrong address is refused", wrongTo.res.body.reason, "Paid to the wrong address");
  const after = (await get(`/api/deals/${dealId}`, M.token)).body.pool;
  eq("refused payments gave their reservations back (only the first intent is still reserved)", after.committed, 250_000);
  const good = await pay(M.token, fresh, M.k.address);
  eq("the right payment is confirmed", good.res.body.status, "confirmed");
  const jarA = (await get("/api/jar", M.token)).body;
  eq("the reward lands in the jar as dollars", jarA.holdings.USDT, 250_000);
  const pot1 = (await get(`/api/deals/${dealId}`, M.token)).body.pool;
  check("the pot moved from reserved to paid", pot1.committed === 0 && pot1.paid === 250_000 && pot1.committed + pot1.paid <= pot1.funded, JSON.stringify(pot1));
  eq("confirming again is harmless", (await post("/api/payments/confirm", { intentId: fresh.id, txHash: good.hash }, M.token)).body.status, "confirmed");
  eq("the jar didn't double-pay", (await get("/api/jar", M.token)).body.holdings.USDT, 250_000);
  const reuse = (await post("/api/payments/intent", { kind: "purchase", dealId }, M.token)).body.intent;
  eq("one transaction can't pay for two purchases", (await post("/api/payments/confirm", { intentId: reuse.id, txHash: good.hash }, M.token)).body.reason, "This transaction was already used");
  eq("you can't buy your own deal", (await post("/api/payments/intent", { kind: "purchase", dealId }, S.token)).status, 400);
  const rec = (await get("/api/me/receipts", M.token)).body.receipts;
  check("the receipt shows the purchase and its reward", rec.some((r: any) => r.kind === "purchase" && r.status === "confirmed" && r.rewardMicro === 250_000), JSON.stringify(rec));
  eq("a stranger can't read another person's payment status", (await get(`/api/payments/check/${fresh.id}`, tokenA)).status, 404);

  console.log("— a pot can never be over-promised");
  {
    const T = await newMember("tiny");
    await post("/api/studio/sponsor", { name: "Tiny Pot", payoutAddress: newKeys().address }, T.token);
    const tinyId = (await get("/api/admin", adminToken)).body.sponsors.find((s: any) => s.handle === T.username).id;
    await post(`/api/admin/sponsors/${tinyId}`, { action: "approve" }, adminToken);
    const d = (await post("/api/studio/deals", { title: "Big reward", summary: "", category: "Food", priceNim: 4000, rewardPercent: 25, rewardMaxUsd: 2, days: 30 }, T.token)).body.id; // $10 -> 25% = $2.50, capped at $2
    const tu = (await post("/api/payments/intent", { kind: "topup", amountNim: 2000 }, T.token)).body.intent; // $5
    await pay(T.token, tu, T.k.address);
    const buyers = await Promise.all(Array.from({ length: 6 }, (_, i) => newMember("race" + i)));
    const results = await Promise.all(buyers.map((b) => post("/api/payments/intent", { kind: "purchase", dealId: d }, b.token)));
    check("all six purchase attempts were accepted (the deal still works)", results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
    const pool = (await get(`/api/deals/${d}`, M.token)).body.pool;
    check("the reserved rewards never exceed the $5 pot", pool.committed <= pool.funded && pool.committed + pool.paid <= 5_000_000, JSON.stringify(pool));
    eq("the pot is fully reserved, not more", pool.committed, 5_000_000);
    check("the rewards were shared out as $2, $2, $1 and nothing", true);
  }

  console.log("— reservations that are never paid go back");
  {
    const N = await newMember("slow");
    const before = (await get(`/api/deals/${dealId}`, N.token)).body.pool;
    const intent = (await post("/api/payments/intent", { kind: "purchase", dealId }, N.token)).body.intent;
    eq("reserved while the purchase is open", (await get(`/api/deals/${dealId}`, N.token)).body.pool.committed, before.committed + 250_000);
    await sleep(500);
    eq("a wrong secret can't run the cron job", (await req("POST", "/api/cron/expire", { headers: { "x-cron-secret": "nope" } })).status, 403);
    const run = await req("POST", "/api/cron/expire", { headers: { "x-cron-secret": "test-cron-secret-1234567890" } });
    check("the expire job runs and releases the reservation", run.body.ok === true && /released/.test(run.body.detail), JSON.stringify(run.body));
    eq("the reward went back to the pot", (await get(`/api/deals/${dealId}`, N.token)).body.pool.committed, before.committed);
    const late = await pay(N.token, intent, N.k.address);
    eq("a late payment is still honoured", late.res.body.status, "confirmed");
    eq("and the reward is paid if the pot can afford it", (await get("/api/jar", N.token)).body.holdings.USDT, 250_000);
  }
  {
    // a payment the app never heard about is found by its memo (the cron "reconcile" job and /me do this)
    const R = await newMember("lost");
    const intent = (await post("/api/payments/intent", { kind: "purchase", dealId }, R.token)).body.intent;
    send(R.k.address, intent.recipient, intent.amountLuna, intent.memo);
    const rr = await req("POST", "/api/cron/reconcile", { headers: { "x-cron-secret": "test-cron-secret-1234567890" } });
    check("the reconcile job finds a payment by its memo", /1 payment/.test(rr.body.detail ?? ""), JSON.stringify(rr.body));
    eq("and the reward lands", (await get("/api/jar", R.token)).body.holdings.USDT, 250_000);
  }

  console.log("— referrals and the device guard");
  {
    const inviter = await newMember("inv");
    const friend = await newMember("fri");
    const friend2 = await newMember("fr2");
    const dev = "a".repeat(32);
    eq("you can't refer yourself", (await post("/api/referral/claim", { code: inviter.referralCode, deviceId: "b".repeat(32) }, inviter.token)).status, 400);
    eq("an unknown code is refused", (await post("/api/referral/claim", { code: "JAR-ZZZZZZ", deviceId: dev }, friend.token)).status, 404);
    eq("a short device id is refused", (await post("/api/referral/claim", { code: inviter.referralCode, deviceId: "x" }, friend.token)).status, 400);
    eq("a new member claims a friend's code", (await post("/api/referral/claim", { code: inviter.referralCode, deviceId: dev }, friend.token)).status, 200);
    eq("the same device can't earn a second referral", (await post("/api/referral/claim", { code: inviter.referralCode, deviceId: dev }, friend2.token)).status, 400);
    eq("a code can only be used once per account", (await post("/api/referral/claim", { code: inviter.referralCode, deviceId: "c".repeat(32) }, friend.token)).status, 400);
    // the first purchase triggers the reward, but the referral pot is empty, so nothing is promised yet
    const i1 = (await post("/api/payments/intent", { kind: "purchase", dealId }, friend.token)).body.intent;
    await pay(friend.token, i1, friend.k.address);
    eq("with an empty referral pot, nothing is paid yet", (await get("/api/referral", inviter.token)).body.paid, 0);
    // an admin tops up the referral pot on-chain
    const pt = (await post("/api/payments/intent", { kind: "topup", amountNim: 4000, target: "platform" }, adminToken)).body.intent; // $10
    eq("a member can't top up the referral pot", (await post("/api/payments/intent", { kind: "topup", amountNim: 10, target: "platform" }, M.token)).status, 403);
    eq("the admin tops up the referral pot", (await pay(adminToken, pt, ADMIN_KEYS.address)).res.body.status, "confirmed");
    const retry = await req("POST", "/api/cron/reconcile", { headers: { "x-cron-secret": "test-cron-secret-1234567890" } });
    check("the cron job pays the waiting referral", /1 referral/.test(retry.body.detail ?? ""), JSON.stringify(retry.body));
    eq("the inviter earned $2 in the jar", (await get("/api/jar", inviter.token)).body.holdings.USDT, 2_000_000);
    eq("the friend earned $2 too (plus their purchase reward)", (await get("/api/jar", friend.token)).body.holdings.USDT, 2_000_000 + 250_000);
    const plat = (await get("/api/ledger")).body.platform;
    check("the referral pot paid out $4 and stays sound", plat.paid === 4_000_000 && plat.committed + plat.paid <= plat.funded, JSON.stringify(plat));
    const sum = (await get("/api/referral", inviter.token)).body;
    check("the referral summary is right", sum.invited === 1 && sum.paid === 1 && sum.earned === 2_000_000, JSON.stringify(sum));
  }

  console.log("— the jar: moving value, and cashing out");
  {
    const J = await newMember("jar");
    const d1 = (await post("/api/payments/intent", { kind: "purchase", dealId }, J.token)).body.intent;
    await pay(J.token, d1, J.k.address);
    eq("starts with $0.25 in dollars", (await get("/api/jar", J.token)).body.holdings.USDT, 250_000);
    eq("moving more than you have is refused", (await post("/api/jar/convert", { from: "USDT", to: "EURE", amount: 5_000_000 }, J.token)).status, 400);
    eq("moving less than $0.50 is refused", (await post("/api/jar/convert", { from: "USDT", to: "EURE", amount: 100_000 }, J.token)).status, 400);
    // give this member more to move: three more purchases
    for (let i = 0; i < 2; i++) {
      const x = (await post("/api/payments/intent", { kind: "purchase", dealId }, J.token)).body.intent;
      await pay(J.token, x, J.k.address);
    }
    eq("three rewards, $0.75", (await get("/api/jar", J.token)).body.holdings.USDT, 750_000);
    const mv = await post("/api/jar/convert", { from: "USDT", to: "EURE", amount: 500_000 }, J.token);
    check("a move into euros works and says it is tracked, not on-chain", mv.status === 200 && mv.body.tracked === true, JSON.stringify(mv.body));
    const h = (await get("/api/jar", J.token)).body.holdings;
    check("the value moved between assets and the total is unchanged", h.USDT === 250_000 && h.EURE === 500_000, JSON.stringify(h));
    eq("cashing out under $1 is refused", (await post("/api/jar/cashout", { asset: "USDT", amount: 250_000 }, J.token)).status, 400);
    eq("deleting an account that holds money is refused", (await req("DELETE", "/api/me", { token: J.token, body: { confirm: "DELETE" } })).status, 409);
    // $0.25 is left in dollars; four more purchases of $0.25 each bring it to $1.25
    for (let i = 0; i < 4; i++) {
      const x = (await post("/api/payments/intent", { kind: "purchase", dealId }, J.token)).body.intent;
      await pay(J.token, x, J.k.address);
    }
    eq("now $1.25 in dollars", (await get("/api/jar", J.token)).body.holdings.USDT, 1_250_000);
    const co = await post("/api/jar/cashout", { asset: "USDT", amount: 1_000_000 }, J.token);
    check("a $1 cash-out is queued at the current rate ($1 = 400 NIM)", co.status === 200 && co.body.amountLuna === 40_000_000, JSON.stringify(co.body));
    eq("the value left the jar immediately", (await get("/api/jar", J.token)).body.holdings.USDT, 250_000);
    const queue = (await get("/api/admin", adminToken)).body.cashouts;
    const mine2 = queue.find((q: any) => q.id === co.body.id);
    check("the admin sees it, addressed to the member's own wallet", !!mine2 && norm(mine2.address) === norm(J.k.address), JSON.stringify(mine2));
    eq("a member can't mark a cash-out paid", (await post(`/api/admin/cashouts/${co.body.id}/paid`, { txHash: hash() }, J.token)).status, 403);
    eq("a payment to the wrong wallet isn't accepted as the payout", (await post(`/api/admin/cashouts/${co.body.id}/paid`, { txHash: send(POOL.address, newKeys().address, 40_000_000, "") }, adminToken)).status, 400);
    eq("a payment that is too small isn't accepted", (await post(`/api/admin/cashouts/${co.body.id}/paid`, { txHash: send(POOL.address, J.k.address, 1000, "") }, adminToken)).status, 400);
    eq("the real payout is accepted", (await post(`/api/admin/cashouts/${co.body.id}/paid`, { txHash: send(POOL.address, J.k.address, 40_000_000, "") }, adminToken)).status, 200);
    eq("it can't be settled twice", (await post(`/api/admin/cashouts/${co.body.id}/paid`, { txHash: hash() }, adminToken)).status, 400);
    // a rejected cash-out returns the value
    const x2 = (await post("/api/payments/intent", { kind: "purchase", dealId }, J.token)).body.intent;
    await pay(J.token, x2, J.k.address);
    for (let i = 0; i < 3; i++) {
      const y = (await post("/api/payments/intent", { kind: "purchase", dealId }, J.token)).body.intent;
      await pay(J.token, y, J.k.address);
    }
    const bal = (await get("/api/jar", J.token)).body.holdings.USDT;
    const co2 = (await post("/api/jar/cashout", { asset: "USDT", amount: 1_000_000 }, J.token)).body;
    eq("the second cash-out is rejected by the admin", (await post(`/api/admin/cashouts/${co2.id}/reject`, { note: "Wallet address looks wrong" }, adminToken)).status, 200);
    eq("and the value returns to the jar", (await get("/api/jar", J.token)).body.holdings.USDT, bal);
  }

  console.log("— account, moderation, admin");
  {
    const X = await newMember("gone");
    check("the data export has the account", (await get("/api/me/export", X.token)).body.account?.username === X.username);
    eq("deleting needs the word DELETE", (await req("DELETE", "/api/me", { token: X.token, body: { confirm: "yes" } })).status, 400);
    eq("an empty account can be deleted", (await req("DELETE", "/api/me", { token: X.token, body: { confirm: "DELETE" } })).status, 200);
    eq("the old token stops working", (await get("/api/me", X.token)).body.user, null);
    eq("the old username page is gone", (await get(`/api/users/${X.username}`)).status, 404);
    eq("sponsors can't delete their account here", (await req("DELETE", "/api/me", { token: S.token, body: { confirm: "DELETE" } })).status, 403);

    const rep = await post(`/api/deals/${dealId}/report`, { reason: "This looks like a scam to me" }, M.token);
    eq("a signed-in member can report a deal", rep.status, 200);
    eq("a too-short report is refused", (await post(`/api/deals/${dealId}/report`, { reason: "bad" }, M.token)).status, 400);
    const open = (await get("/api/admin", adminToken)).body.reports;
    check("the admin sees the report", open.some((r: any) => r.dealId === dealId));
    eq("the admin removes the deal", (await post(`/api/admin/deals/${dealId}`, { action: "remove" }, adminToken)).status, 200);
    check("a removed deal can't be bought", (await post("/api/payments/intent", { kind: "purchase", dealId }, M.token)).status === 404);

    const victim = await newMember("vic");
    eq("the admin suspends a member", (await post(`/api/admin/users/${victim.id}/suspend`, { suspended: true }, adminToken)).status, 200);
    eq("a suspended member's requests are refused", (await get("/api/jar", victim.token)).status, 403);
    eq("the admin can't suspend themselves", (await post("/api/admin/users/demo-admin/suspend", { suspended: true }, adminToken)).status, 400);
    const j = (await get("/api/admin", adminToken)).body.jobs;
    check("the job runs are logged for the admin", j.length >= 3 && j.some((x: any) => x.name === "expire"), JSON.stringify(j.slice(0, 2)));
    const prices = await post("/api/admin/jobs/prices", {}, adminToken);
    check("the price job reports honestly (no internet needed to pass: it never throws)", typeof prices.body.ok === "boolean", JSON.stringify(prices.body));
    eq("the admin can set the NIM rate by hand", (await post("/api/admin/rates", { nimUsd: 0.003 }, adminToken)).status, 200);
    eq("the new rate is used", (await get("/api/rates")).body.nimUsd, 0.003);
    const daily = await req("POST", "/api/cron/daily", { headers: { "x-cron-secret": "test-cron-secret-1234567890" } });
    check("the daily job runs", daily.body.ok === true, JSON.stringify(daily.body));
  }
} catch (e) {
  failed++;
  console.log("FAIL  test crashed:", (e as Error).message);
  console.log(serverLog.slice(-1500));
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await stop();
  process.exit(failed ? 1 : 0);
}
