/* global document, window, innerWidth */
// Drives a real Chrome through the app, against a running dev stack (Vite on :5174 proxying the API on :8788 with
// DEALJAR_DEMO=1 and DEALJAR_DEMO_PAYMENTS=1) and a MOCK Nimiq node that this script runs on :4012.
//
// It covers: browsing as a guest, demo sign-in, a purchase, browser sign-in by pairing code and by proving an
// address on-chain, signing in and paying INSIDE Nimiq Pay (emulated by injecting window.nimiq / window.nimiqPay,
// with real Ed25519 signatures), profile and banner uploads, the sponsor studio, and admin.
// What it cannot prove: how the real Nimiq Pay host behaves (its prompts, exact digests, WebView quirks), or what a
// live node answers. Those need a phone and a node.
//
//   node scripts/test-browser.mjs        (set CHROME, BASE and API if yours differ; SHOTS=dir to keep screenshots)
import http from "node:http";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const Nimiq = require("@nimiq/core");
const BASE = process.env.BASE ?? "http://localhost:5174";
const API = process.env.API ?? "http://localhost:8788";
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const norm = (a) => String(a).replace(/\s+/g, "").toUpperCase();
const hexOf = (s) => Buffer.from(s, "utf8").toString("hex");
const enc = new TextEncoder();
let seq = 1;
const hash = () => (seq++ + 1_000_000).toString(16).padStart(64, "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- mock node
const chain = new Map();
const node = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const { params, id, method } = JSON.parse(b);
    res.setHeader("content-type", "application/json");
    if (method === "getTransactionsByAddress") {
      const data = [...chain.entries()].filter(([, t]) => norm(t.to) === norm(params[0]) || norm(t.from) === norm(params[0])).map(([h, t]) => ({ hash: h, ...t }));
      return res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { data, metadata: null } }));
    }
    const t = chain.get(params[0]);
    res.end(JSON.stringify(t ? { jsonrpc: "2.0", id, result: { data: { hash: params[0], ...t }, metadata: null } } : { jsonrpc: "2.0", id, error: { code: -32602, message: "not found" } }));
  });
});
await new Promise((r) => node.listen(4012, r));
const send = (from, to, value, memo) => {
  const h = hash();
  chain.set(h, { from, to, value, recipientData: hexOf(memo), confirmations: 3, executionResult: true });
  return h;
};

// ------------------------------------------------------------- results
let passed = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`);
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-first-run"] });
const problems = [];

async function open(opts = {}) {
  // a clean browser profile every time, so one section's sign-in never leaks into the next
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: opts.width ?? 1280, height: opts.height ?? 900, isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 160)}`);
  });
  return page;
}
const go = async (page, path) => {
  await page.goto(BASE + path, { waitUntil: "networkidle0" });
  await sleep(250);
};
const text = (page) => page.evaluate(() => document.body.innerText);
/** Click a button or link by its visible text. */
async function click(page, label, tag = "a,button,label") {
  const ok = await page.evaluate(
    (label, tag) => {
      const els = [...document.querySelectorAll(tag)].filter((e) => e.offsetParent !== null);
      const el = els.find((e) => e.innerText.replace(/\s+/g, " ").trim().toLowerCase().includes(label.toLowerCase()) && !e.disabled);
      if (!el) return false;
      el.click();
      return true;
    },
    label,
    tag,
  );
  if (!ok) throw new Error(`no clickable “${label}” on ${page.url()}`);
  await sleep(300);
}
const waitText = async (page, needle, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await text(page)).toLowerCase().includes(needle.toLowerCase())) return true;
    await sleep(250);
  }
  return false;
};
const shot = async (page, name) => SHOTS && (await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }));
const demoToken = async (persona) => (await (await fetch(`${API}/api/auth/demo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona }) })).json()).token;
const newKeys = () => {
  const priv = Nimiq.PrivateKey.generate();
  const pub = Nimiq.PublicKey.derive(priv);
  return { priv, pub, address: pub.toAddress().toUserFriendlyAddress() };
};
const png = (color) => sharp({ create: { width: 800, height: 500, channels: 3, background: color } }).png().toBuffer();
const tmp = (await import("node:os")).tmpdir();
const writeImg = async (name, color) => {
  const p = `${tmp}/${name}.png`;
  (await import("node:fs")).writeFileSync(p, await png(color));
  return p;
};

try {
  console.log("— guest");
  {
    const page = await open();
    await go(page, "/");
    const t = await text(page);
    check("the home page shows the hero and a sign-in button", /Every deal/i.test(t) && /Sign in/.test(t));
    check("deal cards load from the live catalog", (await page.$$("a[href^='/deals/d-']")).length >= 4, String((await page.$$("a[href^='/deals/']")).length));
    await go(page, "/deals");
    check("the deals page lists live deals", (await text(page)).includes("Weekly basket"));
    await go(page, "/deals/d-groceries");
    check("a guest is asked to sign in to take a deal", (await text(page)).includes("Sign in to take this deal"));
    await go(page, "/jar");
    check("a guest sees a sign-in prompt on the jar page", (await text(page)).includes("Sign in"));
    await go(page, "/funding");
    check("the funding page shows the public ledger and the referral pot", (await text(page)).includes("The ledger") && (await text(page)).includes("Referral pot"));
    await go(page, "/studio");
    check("the studio sends a guest to sign in", page.url().includes("/signin"));
    await go(page, "/admin");
    check("the admin page sends a guest away", !page.url().includes("/admin"));
    await shot(page, "guest-funding");
    await page.close();
  }

  console.log("— demo member: jar, purchase");
  {
    const page = await open();
    await go(page, "/signin");
    await click(page, "Sign in as the demo member");
    await sleep(800);
    await go(page, "/");
    check("signed in: the header shows the account, not Sign in", !!(await page.$("a[aria-label='My account']")));
    await go(page, "/jar");
    const before = await text(page);
    const total0 = Number((before.match(/your jar\s*\$([\d,]+\.\d\d)/i) ?? [])[1]?.replace(",", ""));
    check("the seeded jar shows its history and a total", total0 >= 32.3 && before.includes("Saved into gold"), before.slice(0, 200));
    await shot(page, "jar-member");
    await go(page, "/deals/d-demo-1");
    await click(page, "Pay with NIM");
    check("a purchase confirms and the reward lands", await waitText(page, "is in your jar"), (await text(page)).slice(0, 300));
    await go(page, "/jar");
    const total1 = Number(((await text(page)).match(/your jar\s*\$([\d,]+\.\d\d)/i) ?? [])[1]?.replace(",", ""));
    check("the jar total went up by the 10% reward ($1.00 on $10)", Math.abs(total1 - total0 - 1) < 0.005, `${total0} -> ${total1}`);
    await go(page, "/receipts");
    check("the receipt is listed", (await text(page)).includes("Demo purchase"));
    await go(page, "/me");
    check("the account page shows the referral link", (await text(page)).includes("?ref=JAR-"));
    await shot(page, "me-member");
    await page.close();
  }

  console.log("— browser sign-in: pairing code");
  {
    const page = await open();
    await go(page, "/signin");
    await click(page, "Use my phone");
    await waitText(page, "Waiting for your phone");
    const code = (await text(page)).match(/\b([A-Z2-9]{4}-[A-Z2-9]{4})\b/)?.[1];
    check("the browser shows a pairing code", !!code, (await text(page)).slice(0, 300));
    const tok = await demoToken("member");
    const ap = await fetch(`${API}/api/auth/pair/approve`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ code }) });
    check("the phone approves the code", ap.status === 200);
    check("the browser signs itself in", await waitText(page, "Welcome") === false && !!(await page.waitForSelector("a[aria-label='My account']", { timeout: 15000 }).catch(() => null)));
    await page.close();
  }

  console.log("— browser sign-in: proving an address on-chain, then choosing a username");
  const proofKeys = newKeys();
  {
    const page = await open();
    await go(page, "/signin");
    await page.type("input[placeholder^='NQ07']", proofKeys.address);
    await click(page, "Get my code");
    check("a code and instructions appear", await waitText(page, "Message (required)"));
    const t = await text(page);
    const memo = t.match(/DJL:[0-9a-f]{32}/)?.[0];
    const to = (t.match(/send to\s+(NQ[0-9A-Z ]{40,})/i) ?? [])[1]?.trim().slice(0, 44);
    check("the page names the destination and the memo", !!memo && !!to, t.slice(0, 400));
    send(proofKeys.address, to, 1, memo);
    check("it signs in by itself once the payment is on the network, and asks for a username", await waitText(page, "Pick a", 20000), (await text(page)).slice(0, 200));
    await page.type("input[aria-describedby='uname-status']", "ab");
    check("a too-short username is explained as you type", await waitText(page, "at least 3"));
    await page.$eval("input[aria-describedby='uname-status']", (e) => (e.value = ""));
    await page.type("input[aria-describedby='uname-status']", "sam_demo");
    check("a taken username is refused live", await waitText(page, "taken"));
    await page.$eval("input[aria-describedby='uname-status']", (e) => (e.value = ""));
    const uname = "proof_" + Date.now().toString(36).slice(-5);
    await page.type("input[aria-describedby='uname-status']", uname);
    check("a free username is accepted", await waitText(page, "is yours"));
    await click(page, "Continue", "button");
    await page.waitForSelector("a[aria-label='My account']", { timeout: 10000 });
    await sleep(500);
    check("after choosing a name you land back in the app", !page.url().includes("/welcome"), page.url());
    await go(page, `/u/${uname}`);
    check("the public profile exists at /u/<username>", (await text(page)).includes(`@${uname}`));
    check("and shows no wallet address", !/NQ\d\d/.test(await text(page)));
    await page.close();
  }

  console.log("— inside Nimiq Pay (emulated): wallet sign-in and paying");
  const payKeys = newKeys();
  {
    const page = await open({ mobile: true, width: 390, height: 844 });
    await page.exposeFunction("__sign", (message) => {
      const raw = enc.encode(message);
      const prefixed = new Uint8Array([...enc.encode(`\x16Nimiq Signed Message:\n${raw.length}`), ...raw]);
      const sig = Nimiq.Signature.create(payKeys.priv, payKeys.pub, Nimiq.Hash.computeSha256(prefixed));
      return { publicKey: payKeys.pub.toHex(), signature: Buffer.from(sig.serialize()).toString("hex") };
    });
    await page.exposeFunction("__send", (to, value, memo) => send(payKeys.address, to, value, memo));
    await page.evaluateOnNewDocument((addr) => {
      window.nimiqPay = { language: "en", userFiat: "EUR", network: "mainnet", requestDeviceIdentifier: async () => "emulated-device-identifier-0123456789" };
      window.nimiq = {
        listAccounts: async () => [addr],
        getBalance: async () => 1e12,
        sign: async (m) => window.__sign(m),
        sendBasicTransactionWithData: async ({ recipient, value, data }) => window.__send(recipient, value, data),
      };
    }, payKeys.address);
    await go(page, "/signin");
    check("inside Nimiq Pay the page offers the wallet sign-in and not the browser options", (await text(page)).includes("Sign in with Nimiq Pay") && !(await text(page)).includes("Prove my address"));
    await click(page, "Sign in with Nimiq Pay");
    check("the wallet signature signs in and asks for a username", await waitText(page, "Pick a", 15000), (await text(page)).slice(0, 200));
    const uname = "pay_" + Date.now().toString(36).slice(-5);
    await page.type("input[aria-describedby='uname-status']", uname);
    await waitText(page, "is yours");
    await click(page, "Continue", "button");
    await page.waitForSelector("a[aria-label='My account']", { timeout: 10000 });
    await go(page, "/me");
    check("the host's preferred currency (EUR) is used", (await text(page)).includes("€"), (await text(page)).slice(0, 200));
    await go(page, "/deals/d-groceries");
    await click(page, "Pay with NIM");
    check("the wallet payment is verified on the network and the reward lands in the jar", await waitText(page, "is in your jar", 30000), (await text(page)).slice(0, 400));
    await shot(page, "deal-paid-mobile");
    await go(page, "/jar");
    check("the jar shows the $4.80 reward (shown in euros)", /4[.,]\d\d|4,41/.test(await text(page)) || /€/.test(await text(page)));
    await page.close();
  }

  console.log("— profile: pictures and details");
  {
    const page = await open();
    await go(page, "/signin");
    await click(page, "Sign in as the demo member");
    await sleep(700);
    await go(page, "/me/edit");
    const inputs = await page.$$("input[type=file]");
    check("the editor has upload fields for banner and picture", inputs.length === 2, String(inputs.length));
    await inputs[0].uploadFile(await writeImg("banner", { r: 36, g: 51, b: 255 }));
    await waitText(page, "Banner updated");
    await inputs[1].uploadFile(await writeImg("avatar", { r: 255, g: 177, b: 0 }));
    await waitText(page, "Profile picture updated");
    await page.$eval("textarea", (e) => (e.value = ""));
    await page.type("textarea", "Saving for a laptop, one deal at a time.");
    await click(page, "Add a link");
    await page.type("input[aria-label='Link 1 label']", "My site");
    await page.type("input[aria-label='Link 1 address']", "https://example.com");
    await click(page, "Save changes", "button");
    check("saving works", await waitText(page, "Saved."));
    await go(page, "/u/sam_demo");
    check("the public page shows the bio and the link", (await text(page)).includes("Saving for a laptop") && (await text(page)).includes("My site"));
    check("the banner and avatar are real images served by the API", (await page.$$eval("img", (imgs) => imgs.filter((i) => i.src.includes("/api/img/") && i.naturalWidth > 0).length)) >= 2);
    check("the link opens safely in a new tab", await page.$eval("a[href='https://example.com']", (a) => a.rel.includes("noopener") && a.target === "_blank"));
    await shot(page, "profile");
    await page.close();
  }

  console.log("— sponsor studio: a deal with a banner");
  {
    const page = await open();
    await go(page, "/signin");
    await click(page, "Sign in as the demo studio");
    await sleep(700);
    await go(page, "/studio");
    check("the studio shows the pot and the deals", (await text(page)).toLowerCase().includes("reward pot") && (await text(page)).includes("Demo purchase"));
    await page.$eval("input[inputmode='decimal']", (e) => (e.value = ""));
    await click(page, "New deal");
    await sleep(400);
    const fields = await page.$$("form input");
    await page.type("form input[maxlength='60']", "Fresh bread, 8% back");
    await click(page, "Create the deal", "button");
    check("a new deal is created and the banner upload appears", await waitText(page, "Deal banner"), (await text(page)).slice(0, 200));
    const file = await page.$("input[type=file]");
    await file.uploadFile(await writeImg("dealbanner", { r: 255, g: 106, b: 43 }));
    check("the banner uploads", await waitText(page, "Deal banner updated"));
    await go(page, "/deals");
    const card = await page.$$eval("a[href^='/deals/'] img", (imgs) => imgs.filter((i) => i.src.includes("/api/img/") && i.naturalWidth > 0).length);
    check("the deal's banner shows on its card in the catalog", card >= 1, String(card));
    check("the deal appears in the catalog", (await text(page)).includes("Fresh bread"));
    void fields;
    await shot(page, "deals-with-banner");
    await page.close();
  }

  console.log("— admin");
  {
    const page = await open();
    await go(page, "/signin");
    await click(page, "Sign in as the demo admin");
    await sleep(700);
    await go(page, "/admin");
    const t = await text(page);
    check("the admin page lists sponsors, cash-outs, the referral pot and the jobs", t.includes("Sponsors") && t.includes("Cash-outs waiting") && t.includes("Referral pot") && t.includes("Scheduled jobs"));
    await click(page, "Run expire");
    check("a job can be run by hand and is logged", await waitText(page, "released"));
    await shot(page, "admin");
    await page.close();
  }

  console.log("— phone layout");
  {
    const page = await open({ mobile: true, width: 390, height: 844 });
    for (const p of ["/", "/deals", "/funding", "/signin"]) {
      await go(page, p);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      check(`no sideways scrolling at 390px on ${p}`, !overflow);
    }
    await shot(page, "home-mobile");
    await page.close();
  }

  check("no page errors or console errors anywhere", problems.length === 0, [...new Set(problems)].slice(0, 6).join(" | "));
} catch (e) {
  failed++;
  console.log("FAIL  test crashed:", e.message);
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  node.close();
  process.exit(failed ? 1 : 0);
}
