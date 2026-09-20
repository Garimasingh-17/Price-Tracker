#!/usr/bin/env node
/**
 * Observable (headed) run.
 *
 *   npm run scrape:headed -- --url https://demo.inelabteamdev.com/product/42
 *   npm run scrape:headed -- --tracked            # uses products from Supabase
 *   npm run scrape:headed -- --url <url> --chaos  # inject slow + failing responses
 *
 * A visible Chromium window shows the page being read while the terminal
 * narrates every attempt, retry, backoff and validation decision. --chaos makes
 * the store's responses fail and stall on purpose so the recovery path can be
 * demonstrated on camera without waiting for the real store to misbehave.
 */
import { renderPage } from '../src/scraper/browser.js';
import { extractFromHtml } from '../src/scraper/extract.js';
import { validateReading } from '../src/scraper/validate.js';
import { backoffDelay, sleep } from '../src/scraper/fetcher.js';
import { config } from '../src/config.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[36m', grey: '\x1b[90m',
};
const t0 = Date.now();
const stamp = () => C.grey + `[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]` + C.reset;
const say = (color, symbol, text) => console.log(`${stamp()} ${color}${symbol}${C.reset} ${text}`);
const rule = (title) =>
  console.log(`\n${C.bold}${'─'.repeat(6)} ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}${C.reset}`);

const NARRATION = {
  navigate: (e) => say(C.blue, '→', `Opening ${e.url}`),
  response: (e) => say(e.status < 400 ? C.green : C.red, '←', `Response ${e.status}`),
  await_content: () => say(C.dim, '·', 'Waiting for the price to appear in the DOM (not a fixed sleep)'),
  content_ready: () => say(C.green, '✓', 'Price-shaped content is present'),
  content_wait_timeout: () => say(C.yellow, '!', 'Content did not settle in time — falling back to network idle'),
  chaos_delay: (e) => say(C.yellow, '≈', `Injected slow response: stalling ${e.ms}ms`),
  chaos_fail: () => say(C.red, '×', 'Injected failure: responding 503'),
};

async function runOne(url, { chaos }) {
  rule(url.replace(config.store.baseUrl, '') || '/');

  const maxAttempts = config.scrape.maxAttempts;
  let reading = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    say(C.bold, '▸', `Attempt ${attempt} of ${maxAttempts}`);
    try {
      const res = await renderPage(url, {
        headed: true,
        slowMo: Number(value('slowmo', 120)),
        // Failure rate decays with each attempt so the demo recovers rather
        // than looping forever on camera.
        chaos: chaos ? { failRate: attempt === 1 ? 1 : 0.35, delayMs: attempt === 1 ? 6000 : 1500 } : null,
        onEvent: (e) => NARRATION[e.type]?.(e),
      });

      say(C.dim, '·', `Rendered in ${res.durationMs}ms — parsing`);
      reading = extractFromHtml(res.html, { baseUrl: url });

      if (!reading) {
        lastError = new Error('No price could be extracted');
        say(C.red, '×', 'Every extraction strategy came back empty');
      } else {
        say(
          C.green,
          '✓',
          `Extracted ${C.bold}${reading.price}${C.reset} via ${C.bold}${reading.strategy}${C.reset} ` +
            `(${reading.agreement} of ${reading.strategiesTried.length} strategies agreed) · stock: ${reading.inStock}`
        );
        const verdict = validateReading(reading, null);
        if (verdict.ok) {
          say(C.green, '✓', 'Validation passed — this is safe to write to price_history');
          return { ok: true, reading };
        }
        say(C.red, '×', `Validation rejected it: ${verdict.message}. Nothing will be stored.`);
        lastError = new Error(verdict.message);
      }
    } catch (err) {
      lastError = err;
      say(C.red, '×', `Attempt failed: ${err.message}`);
    }

    if (attempt < maxAttempts) {
      const delay = backoffDelay(attempt);
      say(C.yellow, '↺', `Backing off ${delay}ms before retrying (exponential + jitter)`);
      await sleep(delay);
    }
  }

  say(C.red, '■', `Giving up after ${maxAttempts} attempts. Logged as FAILED; no price written.`);
  return { ok: false, error: lastError?.message };
}

async function main() {
  const chaos = flag('chaos');
  console.log(`${C.bold}INE price tracker — headed run${C.reset}`);
  console.log(`${C.dim}store: ${config.store.baseUrl} · max attempts: ${config.scrape.maxAttempts} · chaos: ${chaos}${C.reset}`);

  let urls = [];
  const single = value('url');
  if (single) {
    urls = [single];
  } else if (flag('tracked')) {
    const db = await import('../src/db.js');
    const products = await db.listProducts();
    urls = products.map((p) => p.url);
    if (!urls.length) {
      console.error('No tracked products in the database. Pass --url instead.');
      process.exit(1);
    }
  } else {
    const { loadCatalog } = await import('../src/scraper/catalog.js');
    const { items } = await loadCatalog({ force: true });
    urls = items.slice(0, Number(value('limit', 2))).map((i) => i.url);
    say(C.dim, '·', `No --url given; using the first ${urls.length} products from the store catalogue`);
  }

  const results = [];
  for (const url of urls) results.push(await runOne(url, { chaos }));

  rule('summary');
  const ok = results.filter((r) => r.ok).length;
  console.log(`${ok} succeeded, ${results.length - ok} failed, in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
