#!/usr/bin/env node
/**
 * Inspect the mock store and report what the scraper can see, without writing
 * anything. Run this first after cloning, and again whenever the store changes.
 *
 *   npm run probe
 *   npm run probe -- --url https://demo.inelabteamdev.com/product/1
 */
import { config } from '../src/config.js';
import { fetchWithRetry } from '../src/scraper/fetcher.js';
import { extractFromHtml } from '../src/scraper/extract.js';
import { loadCatalog } from '../src/scraper/catalog.js';
import { renderWithRetry } from '../src/scraper/browser.js';

const argv = process.argv.slice(2);
const i = argv.indexOf('--url');
const single = i > -1 ? argv[i + 1] : null;

async function report(url) {
  console.log(`\n=== ${url}`);
  let html = null;
  try {
    const res = await fetchWithRetry(url, { maxAttempts: 2 });
    html = res.body;
    console.log(`HTTP ${res.status} in ${res.durationMs}ms, ${html.length} bytes, ${res.attempts} attempt(s)`);
  } catch (e) {
    console.log(`HTTP failed: ${e.kind} ${e.message}`);
  }

  let reading = html ? extractFromHtml(html, { baseUrl: url }) : null;
  if (reading) {
    console.log('via HTTP ->', JSON.stringify(reading, null, 2));
    return;
  }
  console.log('HTTP parse found nothing. Trying a rendered page...');
  try {
    const res = await renderWithRetry(url, { maxAttempts: 1 });
    reading = extractFromHtml(res.html, { baseUrl: url });
    console.log('via browser ->', JSON.stringify(reading, null, 2));
    if (!reading) console.log('Still nothing — set PRICE_SELECTOR / STOCK_SELECTOR in .env.');
  } catch (e) {
    console.log(`Render failed: ${e.message}`);
  }
}

if (single) {
  await report(single);
} else {
  console.log(`Store: ${config.store.baseUrl}`);
  const { items, source } = await loadCatalog({ force: true });
  console.log(`Catalogue source: ${source} — ${items.length} products`);
  console.table(items.slice(0, 10).map((x) => ({ id: x.storeProductId, name: x.name, price: x.price, url: x.url })));
  for (const item of items.slice(0, 2)) await report(item.url);
}
process.exit(0);
