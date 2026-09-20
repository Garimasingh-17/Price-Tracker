import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { fetchWithRetry } from './fetcher.js';
import { renderWithRetry } from './browser.js';
import { parseMoney, parseStock } from './extract.js';
import { log } from '../lib/logger.js';

const BASE = config.store.baseUrl;

/** Paths worth trying when looking for the full catalogue. */
const JSON_CANDIDATES = ['/api/products', '/api/v1/products', '/products.json', '/api/catalog'];
const HTML_CANDIDATES = ['/', '/products', '/shop', '/catalog', '/store'];

// Catalogue changes far more slowly than price. Cache it so a user typing in
// the search box does not hammer the store once per keystroke.
const cache = { at: 0, items: [], ttlMs: 5 * 60_000, source: null };

function abs(href) {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

/** Derive a stable id for a product from its URL. */
export function storeIdFromUrl(url) {
  try {
    const u = new URL(url, BASE);
    const q = u.searchParams.get('id') || u.searchParams.get('product') || u.searchParams.get('sku');
    if (q) return q;
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return seg || u.pathname;
  } catch {
    return url;
  }
}

function normalise(item) {
  const url = abs(item.url);
  if (!url || !item.name) return null;
  return {
    storeProductId: String(item.storeProductId || storeIdFromUrl(url)),
    name: String(item.name).replace(/\s+/g, ' ').trim().slice(0, 160),
    url,
    price: item.price ?? null,
    currency: item.currency ?? null,
    inStock: item.inStock ?? null,
    stockText: item.stockText ?? null,
    imageUrl: item.imageUrl ? abs(item.imageUrl) : null,
  };
}

/* ------------------------------------------------------------ JSON route */

function itemsFromJson(payload) {
  const arrays = [];
  const visit = (node, depth = 0) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) {
      if (node.length && typeof node[0] === 'object') arrays.push(node);
      node.slice(0, 50).forEach((n) => visit(n, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    Object.values(node).forEach((v) => visit(v, depth + 1));
  };
  visit(payload);

  for (const arr of arrays.sort((a, b) => b.length - a.length)) {
    const mapped = arr
      .map((n) => {
        const name = n.name || n.title || n.productName;
        if (!name) return null;
        const money = parseMoney(n.price ?? n.currentPrice ?? n.salePrice ?? n.amount);
        const id = n.id ?? n.sku ?? n.slug ?? n.productId;
        const url = n.url || n.link || n.href || (id != null ? `/product/${id}` : null);
        if (!url) return null;
        const stockRaw = n.stock ?? n.inStock ?? n.availability ?? n.quantity;
        let inStock = null;
        if (typeof stockRaw === 'boolean') inStock = stockRaw;
        else if (typeof stockRaw === 'number') inStock = stockRaw > 0;
        else if (typeof stockRaw === 'string') inStock = parseStock(stockRaw).inStock;
        return normalise({
          storeProductId: id != null ? String(id) : undefined,
          name,
          url,
          price: money?.price ?? null,
          currency: money?.currency ?? n.currency ?? null,
          inStock,
          stockText: stockRaw == null ? null : String(stockRaw).slice(0, 120),
          imageUrl: n.image || n.imageUrl || n.thumbnail || null,
        });
      })
      .filter(Boolean);
    if (mapped.length >= 2) return mapped;
  }
  return [];
}

/* ------------------------------------------------------------ HTML route */

function itemsFromHtml(html) {
  const $ = cheerio.load(html);
  const found = new Map();

  const addFromCard = ($card) => {
    const $link = $card.is('a') ? $card : $card.find('a[href]').first();
    const href = $link.attr('href');
    if (!href || /^(#|javascript:|mailto:)/i.test(href)) return;
    const url = abs(href);
    if (!url || !url.startsWith(BASE)) return;

    const name =
      $card.find('[class*="title" i], [class*="name" i], h1, h2, h3, h4').first().text().trim() ||
      $link.attr('title') ||
      $card.find('img').first().attr('alt') ||
      $link.text().trim();
    if (!name || name.length > 160) return;

    const priceText = $card.find('[class*="price" i], [data-price]').first().text();
    const money = parseMoney(priceText);
    const stock = parseStock($card.find('[class*="stock" i], [class*="availab" i]').first().text());
    const img = $card.find('img').first().attr('src');

    const item = normalise({
      name,
      url,
      price: money?.price ?? null,
      currency: money?.currency ?? null,
      inStock: stock.inStock,
      stockText: stock.stockText,
      imageUrl: img,
    });
    if (item && !found.has(item.storeProductId)) found.set(item.storeProductId, item);
  };

  // a) explicit card selector from env
  if (config.selectors.card) $(config.selectors.card).each((_, el) => addFromCard($(el)));

  // b) common card shapes
  if (found.size < 2) {
    $('[class*="product" i], [class*="card" i], li, article').each((_, el) => {
      const $el = $(el);
      if ($el.find('[class*="product" i]').length > 2) return; // skip the grid container
      if (!$el.find('a[href]').length) return;
      addFromCard($el);
    });
  }

  // c) fall back to any link that looks like a product detail page
  if (found.size < 2) {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!/\/(product|item|p|sku)s?[\/=]/i.test(href)) return;
      addFromCard($(el).closest('li, article, div').length ? $(el).closest('li, article, div') : $(el));
    });
  }

  return [...found.values()].filter((i) => i.name && i.name.length > 1);
}

/* ------------------------------------------------------------------ API */

async function tryJsonEndpoints() {
  for (const path of JSON_CANDIDATES) {
    try {
      const res = await fetchWithRetry(BASE + path, { maxAttempts: 2, timeoutMs: 8000 });
      if (!/json/i.test(res.contentType) && !res.body.trim().startsWith('[') && !res.body.trim().startsWith('{'))
        continue;
      const items = itemsFromJson(JSON.parse(res.body));
      if (items.length >= 2) {
        log.info('catalog_source_json', { path, count: items.length });
        return { items, source: `json:${path}` };
      }
    } catch (e) {
      log.debug('catalog_json_miss', { path, error: e.message });
    }
  }
  return null;
}

async function tryHtmlPages() {
  for (const path of HTML_CANDIDATES) {
    try {
      const res = await fetchWithRetry(BASE + path, { maxAttempts: 2, timeoutMs: 10000 });
      const items = itemsFromHtml(res.body);
      if (items.length >= 2) {
        log.info('catalog_source_html', { path, count: items.length });
        return { items, source: `html:${path}` };
      }
    } catch (e) {
      log.debug('catalog_html_miss', { path, error: e.message });
    }
  }
  return null;
}

async function tryRenderedPage() {
  if (!config.scrape.useBrowserFallback) return null;
  for (const path of HTML_CANDIDATES.slice(0, 3)) {
    try {
      const res = await renderWithRetry(BASE + path, { maxAttempts: 1 });
      const items = itemsFromHtml(res.html);
      if (items.length >= 2) {
        log.info('catalog_source_rendered', { path, count: items.length });
        return { items, source: `rendered:${path}` };
      }
    } catch (e) {
      log.debug('catalog_render_miss', { path, error: e.message });
    }
  }
  return null;
}

/** Load the catalogue, trying cheapest sources first. Cached for 5 minutes. */
export async function loadCatalog({ force = false } = {}) {
  if (!force && cache.items.length && Date.now() - cache.at < cache.ttlMs) {
    return { items: cache.items, source: cache.source, cached: true };
  }
  const found = (await tryJsonEndpoints()) || (await tryHtmlPages()) || (await tryRenderedPage());
  if (!found) {
    // Serve a stale cache rather than nothing if the store is having a moment.
    if (cache.items.length) return { items: cache.items, source: cache.source, cached: true, stale: true };
    throw new Error('Could not read the product catalogue from the store');
  }
  cache.items = found.items;
  cache.source = found.source;
  cache.at = Date.now();
  return { ...found, cached: false };
}

/** Partial or full name search, ranked by how well the name matches. */
export async function searchProducts(query, limit = 25) {
  const { items, source, stale } = await loadCatalog();
  const q = (query || '').trim().toLowerCase();
  if (!q) return { items: items.slice(0, limit), source, stale };

  const terms = q.split(/\s+/).filter(Boolean);
  const scored = items
    .map((item) => {
      const name = item.name.toLowerCase();
      let score = 0;
      if (name === q) score += 100;
      if (name.startsWith(q)) score += 50;
      if (name.includes(q)) score += 30;
      for (const t of terms) if (name.includes(t)) score += 10;
      if (score > 0) score -= Math.min(name.length / 40, 5); // prefer tighter matches
      return { item, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);

  return { items: scored, source, stale };
}
