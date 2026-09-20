import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes)$/i.test(String(v)));

export const config = {
  port: num(process.env.PORT, 8080),
  env: process.env.NODE_ENV || 'development',

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  store: {
    baseUrl: (process.env.STORE_BASE_URL || 'https://demo.inelabteamdev.com').replace(/\/+$/, ''),
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  cronSecret: process.env.CRON_SECRET || '',

  scrape: {
    intervalMinutes: num(process.env.SCRAPE_INTERVAL_MINUTES, 120),
    maxAttempts: num(process.env.MAX_ATTEMPTS, 4),
    requestTimeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 12000),
    retryBaseDelayMs: num(process.env.RETRY_BASE_DELAY_MS, 800),
    retryMaxDelayMs: num(process.env.RETRY_MAX_DELAY_MS, 8000),
    priceSanityDeviation: num(process.env.PRICE_SANITY_DEVIATION, 0.75),
    useBrowserFallback: bool(process.env.USE_BROWSER_FALLBACK, true),
    browserTimeoutMs: num(process.env.BROWSER_TIMEOUT_MS, 25000),
    // Cap how many products one cron invocation will process, so a single
    // request can never exceed the platform's request timeout.
    maxProductsPerRun: num(process.env.MAX_PRODUCTS_PER_RUN, 25),
    concurrency: num(process.env.SCRAPE_CONCURRENCY, 2),
  },

  selectors: {
    price: process.env.PRICE_SELECTOR || null,
    stock: process.env.STOCK_SELECTOR || null,
    card: process.env.PRODUCT_CARD_SELECTOR || null,
  },

  alerts: {
    sendgridKey: process.env.SENDGRID_API_KEY || '',
    to: process.env.ALERT_EMAIL_TO || '',
    from: process.env.ALERT_EMAIL_FROM || '',
  },
};

export function assertConfig() {
  const missing = [];
  if (!config.supabase.url) missing.push('SUPABASE_URL');
  if (!config.supabase.serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
