# Product price tracker

Tracks prices and stock on INE's mock storefront (`https://demo.inelabteamdev.com`)
on a fixed schedule, and keeps an honest record of every scrape attempt —
including the ones that failed.

- **Live site:** _add your Vercel URL_
- **API:** _add your Render URL_
- **Headed run recording:** _add your video link_

| Piece | Tech | Host |
|---|---|---|
| Frontend | React 18 + Vite | Vercel |
| Backend | Node 20 + Express | Render |
| Database | Supabase (PostgreSQL) | Supabase |
| Scraping | `fetch` + Cheerio, Playwright only when needed | — |
| Scheduling | cron-job.org hitting `POST /api/cron/scrape` | — |

## How it works

```
cron-job.org ──every 2h──▶ POST /api/cron/scrape
                               │
                               ├── pick products whose interval has elapsed
                               │
                               ▼
                        for each product
                               │
              ┌────────────────┴─────────────────┐
              │ 1. HTTP GET, up to 4 attempts    │
              │    exponential backoff + jitter  │
              │    widening timeout per attempt  │
              └────────────────┬─────────────────┘
                               ▼
              ┌──────────────────────────────────┐
              │ 2. extract: 7 strategies, in     │
              │    order of trustworthiness      │
              └────────────────┬─────────────────┘
                               ▼
              ┌──────────────────────────────────┐
              │ 3. validate. On failure →        │
              │    Playwright render → re-extract│
              └────────────────┬─────────────────┘
                               ▼
              ┌──────────────────────────────────┐
              │ 4. suspicious jump? read again   │
              │    and require agreement         │
              └────────────────┬─────────────────┘
                               ▼
         pass ──▶ price_history + scrape_logs(success|retried)
         fail ──▶ scrape_logs(failed) only. Nothing else is written.
```

The rule the whole thing is built around: **a gap in the chart is honest, a
wrong data point is not.** Nothing reaches `price_history` unless it survived
extraction, validation and — for large moves — a confirming second read.

## Scraping schedule

- Default: **once every 2 hours**, driven by cron-job.org.
- Per product, this is configurable in the UI (30 minutes to daily). The cron
  endpoint only scrapes products whose own interval has elapsed, so a
  2-hourly trigger can serve a mix of frequencies.
- A second cron job pings `GET /api/cron/ping` every 10 minutes to stop the
  Render free instance from cold-starting into the scrape.
- Overlapping runs are refused with HTTP 409 rather than queued.

## Setup

### 1. Database

Create a Supabase project, open the SQL editor, and run
[`supabase/schema.sql`](supabase/schema.sql). Copy the project URL and the
**service role** key from Project settings → API.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env      # fill in SUPABASE_*, CRON_SECRET
npm run probe             # check what the scraper can see on the store
npm run dev               # http://localhost:8080
```

`npm run probe` is worth running first. It reports how the catalogue was found,
which extraction strategy wins on a product page, and what price and stock it
read — without writing anything.

If the store turns out to need explicit selectors, set `PRICE_SELECTOR` and
`STOCK_SELECTOR` in `.env`; those take priority over auto-detection.

Playwright is an optional dependency. To enable the browser fallback locally:

```bash
npx playwright install chromium
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env      # set VITE_API_BASE to your backend URL
npm run dev               # http://localhost:5173
```

### 4. Deploy

**Render (backend)** — new Web Service from this repo:

- Root directory: `backend`
- Build command: `npm install && npx playwright install --with-deps chromium`
- Start command: `npm start`
- Add the environment variables below.
- If you would rather keep the free instance lean, set
  `USE_BROWSER_FALLBACK=false` and drop the Playwright install from the build.

**Vercel (frontend)** — new project from this repo:

- Root directory: `frontend`
- Framework preset: Vite
- Environment variable: `VITE_API_BASE=https://<your-render-service>.onrender.com`

**cron-job.org** — two jobs:

| Job | URL | Schedule | Headers |
|---|---|---|---|
| Scrape | `https://<render>/api/cron/scrape` | every 2 hours | `x-cron-secret: <CRON_SECRET>` |
| Keep warm | `https://<render>/api/cron/ping` | every 10 minutes | — |

Set the scrape job's request timeout to 60s or more.

## Environment variables

### Backend

| Variable | Required | Default | What it does |
|---|---|---|---|
| `SUPABASE_URL` | yes | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | — | Service-role key. Server only, never in the frontend |
| `CRON_SECRET` | yes | — | Shared secret the cron service must send as `x-cron-secret` |
| `STORE_BASE_URL` | no | `https://demo.inelabteamdev.com` | Target store |
| `CORS_ORIGINS` | no | `http://localhost:5173` | Comma-separated allowed origins |
| `PORT` | no | `8080` | Render sets this |
| `SCRAPE_INTERVAL_MINUTES` | no | `120` | Default per-product interval |
| `MAX_ATTEMPTS` | no | `4` | Attempts per HTTP stage before giving up |
| `REQUEST_TIMEOUT_MS` | no | `12000` | First-attempt timeout; widens 50% each retry |
| `RETRY_BASE_DELAY_MS` | no | `800` | Backoff base |
| `RETRY_MAX_DELAY_MS` | no | `8000` | Backoff ceiling |
| `PRICE_SANITY_DEVIATION` | no | `0.75` | Fractional move that triggers a confirming re-read. `0` disables |
| `USE_BROWSER_FALLBACK` | no | `true` | Allow escalating to Playwright |
| `BROWSER_TIMEOUT_MS` | no | `25000` | Render timeout |
| `MAX_PRODUCTS_PER_RUN` | no | `25` | Caps one cron invocation |
| `SCRAPE_CONCURRENCY` | no | `2` | Products scraped in parallel |
| `PRICE_SELECTOR` / `STOCK_SELECTOR` / `PRODUCT_CARD_SELECTOR` | no | — | Manual overrides if auto-detection needs help |
| `SENDGRID_API_KEY` / `ALERT_EMAIL_TO` / `ALERT_EMAIL_FROM` | no | — | Email alerts. All three or none |

### Frontend

| Variable | Required | What it does |
|---|---|---|
| `VITE_API_BASE` | yes | Backend base URL, no trailing slash |

## Observable (headed) run

```bash
cd backend
npx playwright install chromium

# watch it read a real product page
npm run scrape:headed -- --url https://demo.inelabteamdev.com/product/1

# inject a slow response and a 503 to show the recovery path
npm run scrape:headed -- --url https://demo.inelabteamdev.com/product/1 --chaos

# or run against everything currently tracked
npm run scrape:headed -- --tracked
```

A visible Chromium window shows the page loading while the terminal narrates
each attempt, each backoff delay, which extraction strategy won, and whether
validation accepted the reading. `--chaos` forces the first attempt to return
503 and stalls later ones, so the retry and recovery behaviour can be
demonstrated on camera without waiting for the store to misbehave on its own.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Liveness |
| `GET` | `/api/store/search?q=` | Search the mock store by partial or full name |
| `GET` | `/api/products` | Tracked products with rolled-up stats |
| `POST` | `/api/products` | Track a product (`{ url, name, storeProductId }`) |
| `PATCH` | `/api/products/:id` | Change `intervalMinutes` or `active` |
| `DELETE` | `/api/products/:id` | Stop tracking |
| `GET` | `/api/products/:id` | Product, full history and log |
| `POST` | `/api/products/:id/scrape` | Scrape now, same code path as the cron |
| `GET` | `/api/alerts` | Price-drop, stock and structure-change events |
| `POST/GET` | `/api/cron/scrape` | Scheduled cycle. Requires `x-cron-secret` |
| `GET` | `/api/cron/ping` | Keep-warm |

## Tests

```bash
cd backend && npm test
```

Covers money parsing across currency and separator formats, stock-phrase
classification, strategy precedence (structured data beating a struck-through
compare-at price), and the validation guards.

## Notes

- Only the INE mock store is ever fetched. `POST /api/products` rejects any URL
  outside `STORE_BASE_URL`.
- The service-role key bypasses row-level security, which is why RLS is enabled
  on every table and the key never leaves the backend.
- See [`docs/DESIGN_NOTE.md`](docs/DESIGN_NOTE.md) for the reliability
  trade-offs, and [`docs/design-plan.md`](docs/design-plan.md) for the interface
  reasoning.
