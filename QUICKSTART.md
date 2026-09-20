# Quickstart — running this on your own machine

You will end up with three terminal windows open. That is normal.

---

## Step 0 — Install Node.js

Download the **LTS** installer from https://nodejs.org and run it.
Then open a terminal and check:

```bash
node -v
```

You need **v20 or higher**. npm comes with Node, you don't install it separately.

---

## Step 1 — Get into the folder

Unzip `ine-price-tracker.zip` somewhere easy, like your Desktop. Then:

```bash
cd Desktop/ine-price-tracker
```

`ls` (Mac/Linux) or `dir` (Windows) should show `backend`, `frontend`,
`supabase`, `docs`, `README.md`.

---

## Step 2 — Create the database

1. Go to https://supabase.com, sign up (free), create a new project.
2. Wait ~2 minutes for it to finish setting up.
3. Left sidebar → **SQL Editor** → **New query**.
4. Open `supabase/schema.sql` from this folder, copy **all** of it, paste it in,
   click **Run**. It should say success.
5. Left sidebar → **Project Settings** → **API**. Copy two things:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **service_role** key (click the eye icon to reveal it — the *long* one,
     NOT the `anon` key)

---

## Step 3 — Configure the backend

**Terminal 1:**

```bash
cd backend
cp .env.example .env          # Windows: copy .env.example .env
```

Open the new `.env` file in any text editor and fill in three lines:

```
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...        (the long service_role key)
CRON_SECRET=any-long-random-string-you-invent
```

Leave everything else alone. Save.

> `.env` holds secrets. It is already in `.gitignore` — never commit it.

---

## Step 4 — Start the backend

Still in **Terminal 1**, inside `backend/`:

```bash
npm install
npx playwright install chromium
npm run dev
```

- `npm install` takes about a minute.
- `npx playwright install chromium` downloads the browser used for the fallback
  path and for the headed demo. It's a few hundred MB.
- You should see a log line containing `server_started` and `"port":8080`.

**Leave this window running.** Ctrl+C stops it.

Check it works — open http://localhost:8080/healthz in a browser.
You should see `{"ok":true,...}`.

---

## Step 5 — Check the scraper can read the store

**Terminal 2:**

```bash
cd ine-price-tracker/backend
npm run probe
```

This reads the INE mock store and prints what it found, without saving anything.
You want to see a product table and extracted prices.

**If it finds nothing:** open https://demo.inelabteamdev.com in your browser,
right-click a price → Inspect, look at the element's `class`, then add to `.env`:

```
PRICE_SELECTOR=.the-class-you-saw
```

Restart Terminal 1 (Ctrl+C, then `npm run dev`) and probe again.

---

## Step 6 — Start the frontend

**Terminal 3:**

```bash
cd ine-price-tracker/frontend
cp .env.example .env          # Windows: copy .env.example .env
```

Edit that `.env` to point at your local backend:

```
VITE_API_BASE=http://localhost:8080
```

Then:

```bash
npm install
npm run dev
```

Open the URL it prints — usually http://localhost:5173

> Vite only reads `.env` when it starts. If you edit it, restart `npm run dev`.

---

## Step 7 — Use it

1. Type part of a product name in the search box at the top right.
2. Click a result to start tracking it. It scrapes immediately, so a price and a
   log row appear within a few seconds.
3. Click **Scrape now** to run another attempt and watch a new row land in the
   scrape log.

---

## Step 8 — Record the headed run (for your submission)

In **Terminal 2**:

```bash
cd ine-price-tracker/backend

# normal run against a real product page
npm run scrape:headed -- --url https://demo.inelabteamdev.com/product/1

# with an injected 503 and a 6-second stall, to show retry + recovery
npm run scrape:headed -- --url https://demo.inelabteamdev.com/product/1 --chaos
```

A visible Chromium window opens while the terminal narrates every attempt,
backoff delay, extraction strategy and validation decision. Record your screen
showing **both** the browser window and the terminal.

Use a real product URL from the store — get one from the `npm run probe` output.

---

## Common problems

| What you see | What it means |
|---|---|
| Frontend says "Could not reach the tracker API" | Backend isn't running, or `VITE_API_BASE` is wrong / has a trailing slash |
| `Missing required environment variables` | `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` not set in `backend/.env` |
| `relation "tracked_products" does not exist` | `supabase/schema.sql` wasn't run, or was run in the wrong project |
| Probe finds no prices | Set `PRICE_SELECTOR` in `.env` as in Step 5 |
| `playwright` errors | Run `npx playwright install chromium`, or set `USE_BROWSER_FALLBACK=false` |
| Port 8080 already in use | Change `PORT=8081` in `.env`, and update `VITE_API_BASE` to match |

---

## Run the tests

```bash
cd backend
npm test
```

---

## Next: deploying

Once it all works locally, follow **Setup → Deploy** in `README.md` for
Render (backend), Vercel (frontend) and cron-job.org (the 2-hourly trigger).
