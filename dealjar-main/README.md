# DealJar

**Every deal fills a jar.** Take a deal from a sponsor, pay for it in NIM from your Nimiq wallet, and a cashback reward drops
into your jar. Keep it as dollars, or move it into euros or gold. Built for the Nimiq Mini Apps Competition, **Save** category.

The one rule the whole product is built around: **a reward is only ever promised out of money a sponsor has actually put
up, and only paid for a purchase the server can see on the Nimiq network.** Nothing is promised that can't be paid.

## What it does

- **Deals** from sponsors, each with a banner, a price in NIM, a cashback rate and a visible reward pot. A deal always tells
  you how much cashback is actually left, before you spend anything.
- **Sponsor pots.** A sponsor funds a pot with NIM; rewards come only from it. Reserving, paying and releasing a reward are
  single atomic statements, and the table itself refuses `committed + paid > funded`, so a pot can't be over-promised even
  by a bug. Everything is on a public **Funding** ledger.
- **Verified purchases.** The wallet pays the sponsor directly with a short memo (`DJ:…`). The server believes only the
  chain: right address, enough NIM, matching memo, confirmed. A payment the app never heard about is found by its memo.
- **The jar.** Rewards and referrals land as dollars. Moving value into euros or gold is tracked at the day's rates (not
  on-chain yet; see below). Goal, history, and cash-out requests paid in NIM to your own wallet.
- **Referrals** from a capped, public pot, paid to both sides after the friend's first verified deal, with a device guard
  (the host's `requestDeviceIdentifier` inside Nimiq Pay, hashed; a browser id otherwise).
- **Accounts without passwords.** Inside Nimiq Pay: share your address and sign a one-time message. In a normal browser:
  prove an address by sending 0.00001 NIM with a code, or approve a code from your phone. Then choose a public @username.
- **Profiles.** Avatar, banner, bio, links, goal; a public page that never shows addresses or purchases. Sponsors get a
  public page too, with their pot and deals.
- **Sponsor studio.** Create a sponsor page (an admin approves it), fund the pot, create deals, upload banners, hide or remove.
- **Admin.** Approve or suspend sponsors, review reports, pay cash-outs, top up the referral pot, set the NIM rate, run and
  read the scheduled jobs.
- **Account.** Receipts, a full data export, account deletion (blocked while money is in the jar or a payment is in flight).

## Stack

Vite 7 + React 19 + TypeScript, React Router 7, TanStack Query, GSAP, Matter.js (the jar is a real physics toy), Tailwind 4.
Server: Hono on Node, Drizzle + Postgres (Supabase in production, embedded PGlite locally), `@nimiq/core` for signature and
address checks, `sharp` for images, S3-compatible storage (Supabase Storage). Hosting: Render (web + cron). Tests: Vitest,
a self-contained API test with a mock Nimiq node and real key pairs, and a real-Chrome test that also emulates Nimiq Pay.

## Run it

```bash
npm install
cp .env.example .env.local     # for local use you can leave nearly everything empty
npm run dev                    # API on :8788 (embedded database, seeded with fictional sponsors) + Vite on :5174
```

For a quick demo without a wallet: `DEALJAR_DEMO=1 DEALJAR_DEMO_PAYMENTS=1 npm run dev`, then **Sign in** and choose a demo
persona (member, studio or admin). Demo payments skip the chain and are refused in production.

## Test it

```bash
npm run typecheck && npm run lint
npm test                       # unit tests: the reward rules, money, currencies
npm run test:api               # starts its own server + mock Nimiq node; ~150 checks across auth, money, referrals, cash-outs, cron
npm run test:browser           # real Chrome against a running dev stack (see the header of scripts/test-browser.mjs)
```

## Deploy

See [DEPLOY.md](DEPLOY.md): Supabase (database, images), Render (app and cron jobs), the Nimiq node, and a checklist for the
things only a real phone can prove.

## Honest limits

- The automated tests use a **mock Nimiq node** and an **emulated** Nimiq Pay (a script injects `window.nimiq` and signs with
  real keys). They prove our rules, not how the real host or a live node behave. DEPLOY.md §7 lists what to check by hand.
- **Euros and gold are tracked, not on-chain.** No swap provider is connected, and every Asset Passport label is a draft
  until someone has checked it against the issuer's own documents.
- **Pots are held at an operator address** and **cash-outs are paid by hand** from it, so the server never holds a key that
  can move money. That makes the operator a custodian of deposits; it isn't a smart contract.
- Non-dollar currency conversion for display uses illustrative rates; NIM, euro and gold prices come from a CoinGecko job
  that has not been run against the live API in testing.

MIT licensed.
