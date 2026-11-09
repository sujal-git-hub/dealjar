# Deploying DealJar

DealJar is one Node process: the Hono API plus the built React app, on one port. Hosting it needs an HTTPS URL (Nimiq Pay
won't load a plain `http://` app outside your local network), a Postgres database, somewhere to keep uploaded images, and
a Nimiq RPC node to verify payments. This guide uses **Supabase** (database and image storage) and **Render** (the app
and the scheduled jobs). Free tiers change: check each service's pricing page when you sign up.

## 0. Where values go

- **Local development:** `.env.local` in this folder (git-ignored). `npm run dev` and `npm start` read it.
- **Production:** the Render dashboard, under the service's **Environment** tab. Never commit secrets and never paste them
  into a chat or a ticket. `.env.example` lists every variable; this file explains where each one comes from.

## 1. Supabase: database

1. Create a project at supabase.com. Pick the region nearest your users and save the database password somewhere safe.
2. **Project Settings → Database → Connection string → Transaction pooler** (port 6543). Copy it and put your password in.
   That string is `DATABASE_URL`. Use the *pooler* string: Render's free tier doesn't have IPv6, which Supabase's direct
   connection needs. The app already disables prepared statements for the pooler, and creates its own tables on first start
   (no migration step).
3. Tables have **row-level security** off by default when created from SQL, and the app talks to Postgres directly with
   your connection string, never through Supabase's public API. Don't put the anon key anywhere in this app. If you turn on
   Supabase's data API for this project, enable RLS on every table first.

## 2. Supabase: image storage

Profile pictures, banners and deal banners are stored as WebP files in a bucket.

1. **Storage → New bucket**, e.g. `dealjar`. It can stay **private**: the server reads images with its own credentials and
   serves them at `/api/img/<key>` with long caching.
2. **Project Settings → Storage → S3 Connection**: create an access key. You need four values:
   - `S3_ENDPOINT` = `https://<project-ref>.storage.supabase.co/storage/v1/s3`
   - `S3_REGION` = the region shown there (e.g. `eu-central-1`)
   - `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (the secret is shown once)
   - `S3_BUCKET` = the bucket name
3. Without these, images go to local disk and are lost on every Render deploy.

## 3. Nimiq

- `NIMIQ_RPC_URL`: a Nimiq JSON-RPC node (https://nimiq.dev/rpc/open-servers lists open ones, which are for testing).
  Without it, real payments stay "pending" and nobody can sign in with the browser address proof.
- `ADMIN_ADDRESSES`: your own Nimiq Pay address (starts with `NQ`). Whoever signs in with it first becomes an admin.
- `POOL_ADDRESS`: the address that receives sponsors' pot deposits and referral-pot top-ups. **You hold its key.** You also
  pay members' cash-outs from it, from your wallet, then paste the transaction hash into the admin page (the server cannot
  sign payments, by design). It can be the same address as your admin address.

## 4. Render: the app

1. **New → Blueprint**, pick this repository. `render.yaml` creates the web service and the cron jobs.
2. Fill in the values it asks for:

| Variable | What |
|---|---|
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep it stable. |
| `DATABASE_URL` | §1 |
| `NIMIQ_RPC_URL`, `ADMIN_ADDRESSES`, `POOL_ADDRESS` | §3 |
| `S3_*` | §2 |
| `CRON_SECRET` | 16+ random characters, only needed if you call the cron endpoints from outside Render |
| `PRICE_API_KEY` | optional: a CoinGecko demo key |

3. The server refuses to start in production if `SESSION_SECRET` is missing or short, or if `DEALJAR_DEMO_PAYMENTS` or
   `DEALJAR_NO_RATE_LIMIT` is on. It warns, in the log, about anything that would quietly degrade it.
4. Health check: `/api/health`.

## 5. Scheduled jobs

| Job | When | What it does |
|---|---|---|
| `reconcile` | every 5 min | finds payments sent but never confirmed (matched by their memo) and pays referrals that were waiting for the pot |
| `expire` | every 10 min | gives reserved rewards back to their pots when the payment didn't arrive in time |
| `prices` | hourly | NIM, euro and gold prices from CoinGecko (sanity-checked, never throws) |
| `daily` | 03:30 | removes old sign-in codes and job logs; reports cash-outs waiting over a day |

Render cron jobs are separate services and are billed on their own. To avoid that, delete the `type: cron` blocks in
`render.yaml` and trigger the same jobs over HTTP from any free scheduler (Supabase's `pg_cron` + `pg_net`, cron-job.org,
a GitHub Actions schedule):

```bash
curl -X POST https://<your-app>.onrender.com/api/cron/reconcile -H "x-cron-secret: $CRON_SECRET"
```

Every run is logged in `job_runs` and shown on the admin page, where you can also run any job by hand.

## 6. First run

1. Open the app, **Sign in**, and sign in with the `ADMIN_ADDRESSES` wallet (inside Nimiq Pay, or from a browser).
2. **Me → Admin → Referral pot → Top up** if you want referrals to pay. The pot is public on the Funding page.
3. A sponsor signs in, opens **Me → Become a sponsor**, and you approve them under **Admin → Sponsors**. They then fund their
   pot (NIM paid to `POOL_ADDRESS`) and create deals with banners.
4. Set `DEALJAR_SEED=0` (the blueprint does) so no fictional demo sponsors appear on a real database.

## 7. Checking it works (do this on a real phone)

These are the things the automated tests cannot prove, because they need Nimiq Pay and a live node:

- [ ] Open the app inside Nimiq Pay → **Sign in with Nimiq Pay** → you reach the username step.
- [ ] Sign in from a normal browser with **Prove my address** (a real one-luna payment) and with **Use my phone**.
- [ ] Buy a small deal from a test sponsor inside Nimiq Pay: the reward appears in the jar after the payment confirms.
- [ ] Buy the same kind of deal from a browser and pay by hand with the memo.
- [ ] Top up a sponsor pot, then cash out a small amount and mark it paid.
- [ ] Open a referral link on a second phone and take a deal; both jars get the reward.
- [ ] `prices` job: **Admin → Run prices** reports real prices.

## 8. What is not live yet (and the app says so)

- **Euros and gold in the jar are tracked, not on-chain.** Moving value into them is bookkeeping at the day's rates. No swap
  provider is connected, and every Asset Passport label is a draft until checked against the issuer's own documents.
- **Cash-outs are paid by hand** from `POOL_ADDRESS`, so the server never holds a key that can move money.
- **Pots are held at `POOL_ADDRESS`**, which makes the operator a custodian of sponsors' deposits. A sponsor can see their
  pot and every movement on the public ledger, but this is not a smart contract.
