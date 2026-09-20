#!/usr/bin/env node
/**
 * One-off diagnostic. Loads the page and does nothing except watch the
 * Reveal button's disabled state for 30 seconds, to see if it ever becomes
 * enabled on its own without any interaction. Not part of the app.
 *
 *   node scripts/debug-reveal.js --url https://demo.inelabteamdev.com/product/173
 */
import { config } from '../src/config.js';

const argv = process.argv.slice(2);
const i = argv.indexOf('--url');
const url = i > -1 ? argv[i + 1] : 'https://demo.inelabteamdev.com/product/173';

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const t0 = Date.now();
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

console.log('Target:', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.scrape.browserTimeoutMs });

const btn = page.locator('button:has-text("reveal price")').first();
await btn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
console.log(`[${since()}] button visible`);

// Also grab the outer HTML of the whole price block, so we can see any data
// attributes or countdown text we might be missing.
const blockHtml = await page.locator('text=Price hidden').first().locator('xpath=ancestor::*[self::div][1]').innerHTML().catch((e) => `(failed: ${e.message})`);
console.log('\n--- price block HTML (immediate container) ---\n' + blockHtml.slice(0, 1500));

console.log('\nWatching disabled state and visible text for 30s, no interaction...');
for (let s = 1; s <= 30; s++) {
    await new Promise((r) => setTimeout(r, 1000));
    const disabled = await btn.isDisabled().catch(() => 'unknown');
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    const hasPrice = /₹\s*[\d,]+/.test(text);
    if (s % 3 === 0 || !disabled || hasPrice) {
        console.log(`[${since()}] +${s}s — disabled=${disabled} — hasPrice=${hasPrice}`);
    }
    if (hasPrice) {
        console.log('  price context:', text.match(/.{0,30}₹\s*[\d,]+.{0,10}/)?.[0]);
        break;
    }
}

await browser.close();
process.exit(0);