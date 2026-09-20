import * as cheerio from 'cheerio';
import { config } from '../config.js';

/**
 * Extraction is deliberately layered. Each strategy is tried in order of how
 * much it is a promise from the store (structured data) versus how much it is
 * a guess (text heuristics). The winning strategy name is recorded with every
 * data point, which is what makes structure-change detection possible: when a
 * product that has always resolved via `jsonld` suddenly resolves via
 * `text-regex`, the page changed under us and we say so.
 */

const CURRENCY_SYMBOLS = { '₹': 'INR', Rs: 'INR', INR: 'INR', $: 'USD', USD: 'USD', '€': 'EUR', '£': 'GBP' };

const OUT_WORDS = /\b(out[\s-]?of[\s-]?stock|sold[\s-]?out|unavailable|back[\s-]?order(ed)?|notify me)\b/i;
const IN_WORDS = /\b(in[\s-]?stock|available|add to (cart|bag)|buy now|ships?|left in stock)\b/i;

/* ---------------------------------------------------------------- helpers */

/** "₹ 1,299.00" -> { price: 1299, currency: 'INR' }. Rejects junk. */
export function parseMoney(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;

  let currency = null;
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(sym)) {
      currency = code;
      break;
    }
  }

  // Grab the first number-looking run, tolerating 1,299.00 / 1.299,00 / 89999.
  // Deliberately greedy: an earlier version anchored on groups of three and
  // silently read "Rs. 89999" as 899.
  const m = text.match(/\d[\d.,\s]*\d|\d/);
  if (!m) return null;
  let n = m[0].replace(/\s/g, '').replace(/^[.,]+|[.,]+$/g, '');

  const lastComma = n.lastIndexOf(',');
  const lastDot = n.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    if (lastComma > lastDot) n = n.replace(/\./g, '').replace(',', '.');
    else n = n.replace(/,/g, '');
  } else if (lastComma > -1) {
    // A single comma with exactly 2 trailing digits is a decimal comma.
    n = /,\d{2}$/.test(n) ? n.replace(',', '.') : n.replace(/,/g, '');
  }

  const price = Number(n);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price: Math.round(price * 100) / 100, currency };
}

export function parseStock(text) {
  if (!text) return { inStock: null, stockText: null };
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (OUT_WORDS.test(t)) return { inStock: false, stockText: t.slice(0, 120) };
  if (/\b(0)\s*(left|in stock|available|units?)\b/i.test(t)) return { inStock: false, stockText: t.slice(0, 120) };
  if (IN_WORDS.test(t) || /\b\d+\s*(left|in stock|available|units?)\b/i.test(t))
    return { inStock: true, stockText: t.slice(0, 120) };
  return { inStock: null, stockText: t.slice(0, 120) };
}

function walk(node, visit, depth = 0) {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit, depth + 1));
  if (typeof node !== 'object') return;
  visit(node);
  for (const v of Object.values(node)) walk(v, visit, depth + 1);
}

/* ------------------------------------------------------------ strategies */

/** 1. JSON-LD / schema.org Product — the store's own declaration. */
function fromJsonLd($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw?.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // malformed JSON-LD is common; ignore rather than fail the run
    }
    walk(parsed, (node) => {
      const type = node['@type'];
      const isOffer = type === 'Offer' || type === 'AggregateOffer' || node.price !== undefined;
      if (!isOffer) return;
      const money = parseMoney(node.price ?? node.lowPrice ?? node.highPrice);
      if (!money) return;
      const availability = String(node.availability || node.itemCondition || '');
      let inStock = null;
      if (/InStock|LimitedAvailability/i.test(availability)) inStock = true;
      if (/OutOfStock|SoldOut|Discontinued/i.test(availability)) inStock = false;
      out.push({
        price: money.price,
        currency: money.currency || node.priceCurrency || null,
        inStock,
        stockText: availability.split('/').pop() || null,
      });
    });
  });
  return out[0] || null;
}

/** 2. Embedded app state: __NEXT_DATA__, __NUXT__, window.__INITIAL_STATE__. */
function fromEmbeddedState($) {
  const blobs = [];
  $('script').each((_, el) => {
    const txt = $(el).contents().text();
    if (!txt) return;
    if ($(el).attr('id') === '__NEXT_DATA__' || $(el).attr('type') === 'application/json') {
      blobs.push(txt);
      return;
    }
    const m = txt.match(/(?:__NUXT__|__INITIAL_STATE__|__APP_STATE__)\s*=\s*(\{[\s\S]*?\})\s*[;<]/);
    if (m) blobs.push(m[1]);
  });

  for (const blob of blobs) {
    let parsed;
    try {
      parsed = JSON.parse(blob);
    } catch {
      continue;
    }
    let hit = null;
    walk(parsed, (node) => {
      if (hit) return;
      const priceKey = ['price', 'currentPrice', 'salePrice', 'amount', 'unitPrice'].find(
        (k) => node[k] !== undefined && node[k] !== null && typeof node[k] !== 'object'
      );
      if (!priceKey) return;
      const money = parseMoney(node[priceKey]);
      if (!money) return;
      const stockRaw =
        node.stock ?? node.inStock ?? node.availability ?? node.stockStatus ?? node.quantity;
      let inStock = null;
      if (typeof stockRaw === 'boolean') inStock = stockRaw;
      else if (typeof stockRaw === 'number') inStock = stockRaw > 0;
      else if (typeof stockRaw === 'string') inStock = parseStock(stockRaw).inStock;
      hit = {
        price: money.price,
        currency: money.currency || node.currency || node.priceCurrency || null,
        inStock,
        stockText: stockRaw === undefined ? null : String(stockRaw).slice(0, 120),
      };
    });
    if (hit) return hit;
  }
  return null;
}

/** 3. Microdata and meta tags. */
function fromMeta($) {
  const candidates = [
    $('meta[property="product:price:amount"]').attr('content'),
    $('meta[itemprop="price"]').attr('content'),
    $('[itemprop="price"]').attr('content') || $('[itemprop="price"]').first().text(),
    $('meta[name="twitter:data1"]').attr('content'),
  ].filter(Boolean);

  for (const c of candidates) {
    const money = parseMoney(c);
    if (!money) continue;
    const availability =
      $('meta[property="product:availability"]').attr('content') ||
      $('[itemprop="availability"]').attr('href') ||
      $('[itemprop="availability"]').attr('content') ||
      '';
    const stock = parseStock(availability);
    return {
      price: money.price,
      currency:
        money.currency ||
        $('meta[property="product:price:currency"]').attr('content') ||
        $('[itemprop="priceCurrency"]').attr('content') ||
        null,
      inStock: /instock|in_stock|available/i.test(availability) ? true : stock.inStock,
      stockText: availability || null,
    };
  }
  return null;
}

/** 4. data-* attributes the store uses for its own JS. */
function fromDataAttrs($) {
  const attrs = ['data-price', 'data-product-price', 'data-current-price', 'data-amount', 'data-value'];
  for (const a of attrs) {
    const el = $(`[${a}]`).first();
    if (!el.length) continue;
    const money = parseMoney(el.attr(a));
    if (!money) continue;
    const stockEl = $('[data-stock], [data-availability], [data-in-stock]').first();
    const stockRaw =
      stockEl.attr('data-stock') ?? stockEl.attr('data-availability') ?? stockEl.attr('data-in-stock');
    const stock = parseStock(stockRaw ?? stockEl.text());
    return { price: money.price, currency: money.currency, ...stock };
  }
  return null;
}

/** 5. Operator-supplied selectors (env override). Highest trust when present. */
function fromConfiguredSelectors($) {
  if (!config.selectors.price) return null;
  const el = $(config.selectors.price).first();
  if (!el.length) return null;
  const money = parseMoney(el.attr('content') || el.text());
  if (!money) return null;
  const stockText = config.selectors.stock ? $(config.selectors.stock).first().text() : '';
  return { price: money.price, currency: money.currency, ...parseStock(stockText) };
}

/** 6. Class/id heuristics — elements that call themselves a price. */
function fromClassHeuristics($) {
  const sel = [
    '[class*="price" i]',
    '[id*="price" i]',
    '[class*="amount" i]',
    '[class*="cost" i]',
  ].join(',');

  const hits = [];
  $(sel).each((_, el) => {
    const $el = $(el);
    if ($el.find(sel).length) return; // prefer the innermost element
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (!text || text.length > 40) return;
    const money = parseMoney(text);
    if (!money) return;
    const cls = `${$el.attr('class') || ''} ${$el.attr('id') || ''}`.toLowerCase();
    // Penalise struck-through "was" prices so we keep the price actually charged.
    const isOld = /(old|was|compare|strike|line-?through|mrp|original|regular)/.test(cls) ||
      ['s', 'del', 'strike'].includes(el.tagName?.toLowerCase());
    hits.push({ money, isOld, hasSymbol: /[₹$€£]|rs/i.test(text) });
  });

  if (!hits.length) return null;
  const preferred = hits.filter((h) => !h.isOld);
  const pool = preferred.length ? preferred : hits;
  pool.sort((a, b) => Number(b.hasSymbol) - Number(a.hasSymbol));
  const best = pool[0];
  return { price: best.money.price, currency: best.money.currency, ...stockFromBody($) };
}

/** 7. Last resort: a labelled price in the page text. */
function fromTextRegex($) {
  const body = $('body').text().replace(/\s+/g, ' ');
  const m =
    body.match(/(?:price|mrp|cost)\s*[:\-]?\s*((?:₹|rs\.?|inr|\$|€|£)\s*[\d.,]+)/i) ||
    body.match(/((?:₹|rs\.?|\$|€|£)\s*\d[\d.,]*)/i);
  if (!m) return null;
  const money = parseMoney(m[1]);
  if (!money) return null;
  return { price: money.price, currency: money.currency, ...stockFromBody($) };
}

function stockFromBody($) {
  const scoped = $('[class*="stock" i], [class*="availab" i], [id*="stock" i]').first().text();
  if (scoped?.trim()) return parseStock(scoped);
  const body = $('body').text().replace(/\s+/g, ' ').slice(0, 4000);
  const m = body.match(/.{0,40}(out of stock|sold out|in stock|available|unavailable).{0,40}/i);
  return parseStock(m ? m[0] : null);
}

/* ------------------------------------------------------------------ name */

function extractName($) {
  const candidates = [
    $('meta[property="og:title"]').attr('content'),
    $('[itemprop="name"]').first().attr('content'),
    $('h1').first().text(),
    $('title').text(),
  ];
  for (const c of candidates) {
    const v = (c || '').replace(/\s+/g, ' ').trim();
    if (v && v.length <= 160) return v;
  }
  return null;
}

function extractImage($, baseUrl) {
  const src =
    $('meta[property="og:image"]').attr('content') ||
    $('[itemprop="image"]').first().attr('src') ||
    $('img[class*="product" i]').first().attr('src') ||
    $('img').first().attr('src');
  if (!src) return null;
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- API */
function fromRevealedPrice($) {
  const el = $('.price-block.price-success .price-current').first();

  if (!el.length) return null;

  const money = parseMoney(el.text());

  if (!money) return null;

  return {
    price: money.price,
    currency: money.currency || 'INR',
    ...stockFromBody($)
  };
}

const STRATEGIES = [
  ['revealed-price', fromRevealedPrice],
  ['configured-selector', fromConfiguredSelectors],
  ['jsonld', fromJsonLd],
  ['embedded-state', fromEmbeddedState],
  ['meta', fromMeta],
  ['data-attr', fromDataAttrs],
  ['class-heuristic', fromClassHeuristics],
  ['text-regex', fromTextRegex],
];

/**
 * Extract from an HTML document.
 * Returns { price, currency, inStock, stockText, name, imageUrl, strategy,
 *           agreement } or null when nothing usable was found.
 *
 * `agreement` counts how many independent strategies produced the same price.
 * Two agreeing strategies is strong evidence we read the page correctly.
 */
export function extractFromHtml(html, { baseUrl } = {}) {
  const $ = cheerio.load(html);
  const results = [];

  for (const [name, fn] of STRATEGIES) {
    let r = null;
    try {
      r = fn($);
    } catch {
      r = null; // a broken strategy must not break the pipeline
    }
    if (r && Number.isFinite(r.price) && r.price > 0) results.push({ strategy: name, ...r });
  }

  if (!results.length) return null;

  const winner = results[0];
  const agreement = results.filter((r) => Math.abs(r.price - winner.price) < 0.01).length;

  // Stock: prefer the first strategy that actually decided one way or the other.
  const decided = results.find((r) => r.inStock !== null && r.inStock !== undefined);
  const bodyStock = stockFromBody($);

  return {
    price: winner.price,
    currency: winner.currency || results.find((r) => r.currency)?.currency || null,
    inStock: winner.inStock ?? decided?.inStock ?? bodyStock.inStock,
    stockText: winner.stockText || decided?.stockText || bodyStock.stockText || null,
    name: extractName($),
    imageUrl: baseUrl ? extractImage($, baseUrl) : null,
    strategy: winner.strategy,
    agreement,
    strategiesTried: results.map((r) => r.strategy),
  };
}

/** Extract from a JSON API response, if the store exposes one. */
export function extractFromJson(payload) {
  let hit = null;
  walk(payload, (node) => {
    if (hit) return;
    const key = ['price', 'currentPrice', 'salePrice', 'amount'].find(
      (k) => node[k] !== undefined && typeof node[k] !== 'object'
    );
    if (!key) return;
    const money = parseMoney(node[key]);
    if (!money) return;
    const stockRaw = node.stock ?? node.inStock ?? node.availability ?? node.quantity;
    let inStock = null;
    if (typeof stockRaw === 'boolean') inStock = stockRaw;
    else if (typeof stockRaw === 'number') inStock = stockRaw > 0;
    else if (typeof stockRaw === 'string') inStock = parseStock(stockRaw).inStock;
    hit = {
      price: money.price,
      currency: money.currency || node.currency || null,
      inStock,
      stockText: stockRaw === undefined ? null : String(stockRaw).slice(0, 120),
      name: node.name || node.title || null,
      imageUrl: node.image || node.imageUrl || node.thumbnail || null,
      strategy: 'json-api',
      agreement: 1,
      strategiesTried: ['json-api'],
    };
  });
  return hit;
}
