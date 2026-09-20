import { Router } from 'express';
import { config } from '../config.js';
import * as db from '../db.js';
import { searchProducts, loadCatalog, storeIdFromUrl } from '../scraper/catalog.js';
import { scrapeProduct } from '../scraper/runner.js';
import { log } from '../lib/logger.js';

export const api = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------ store search --------------------------- */

api.get(
  '/store/search',
  wrap(async (req, res) => {
    const q = String(req.query.q || '');
    const limit = Math.min(Number(req.query.limit) || 25, 50);
    const { items, source, stale } = await searchProducts(q, limit);
    res.json({ query: q, count: items.length, source, stale: !!stale, items });
  })
);

api.post(
  '/store/refresh',
  wrap(async (_req, res) => {
    const { items, source } = await loadCatalog({ force: true });
    res.json({ count: items.length, source });
  })
);

/* --------------------------- tracked products -------------------------- */

api.get(
  '/products',
  wrap(async (_req, res) => {
    res.json({ items: await db.listProducts() });
  })
);

api.post(
  '/products',
  wrap(async (req, res) => {
    const { url, name, storeProductId, imageUrl, intervalMinutes } = req.body || {};
    if (!url || !name) {
      return res.status(400).json({ error: 'Both "url" and "name" are required to track a product.' });
    }
    if (!String(url).startsWith(config.store.baseUrl)) {
      return res
        .status(400)
        .json({ error: `Only products on ${config.store.baseUrl} can be tracked.` });
    }

    const storeId = String(storeProductId || storeIdFromUrl(url));
    const existing = await db.findByStoreId(storeId);
    if (existing) return res.status(200).json({ item: existing, alreadyTracked: true });

    const item = await db.insertProduct({
      store_product_id: storeId,
      name: String(name).slice(0, 160),
      url,
      image_url: imageUrl || null,
      interval_minutes: Math.max(5, Number(intervalMinutes) || config.scrape.intervalMinutes),
    });

    // First reading straight away, so the dashboard is never empty on arrival.
    scrapeProduct(item).catch((e) => log.error('initial_scrape_failed', { error: e.message }));

    res.status(201).json({ item });
  })
);

api.patch(
  '/products/:id',
  wrap(async (req, res) => {
    const patch = {};
    if (req.body.intervalMinutes !== undefined)
      patch.interval_minutes = Math.max(5, Number(req.body.intervalMinutes));
    if (req.body.active !== undefined) patch.active = !!req.body.active;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });
    res.json({ item: await db.updateProduct(req.params.id, patch) });
  })
);

api.delete(
  '/products/:id',
  wrap(async (req, res) => {
    await db.deleteProduct(req.params.id);
    res.json({ deleted: true });
  })
);

api.get(
  '/products/:id',
  wrap(async (req, res) => {
    const item = await db.getProduct(req.params.id);
    if (!item) return res.status(404).json({ error: 'Product not found.' });
    const [history, logs] = await Promise.all([
      db.getHistory(req.params.id),
      db.getLogs(req.params.id, 100),
    ]);
    res.json({ item, history, logs });
  })
);

api.get(
  '/products/:id/history',
  wrap(async (req, res) => {
    res.json({ items: await db.getHistory(req.params.id, Math.min(Number(req.query.limit) || 500, 2000)) });
  })
);

api.get(
  '/products/:id/logs',
  wrap(async (req, res) => {
    res.json({ items: await db.getLogs(req.params.id, Math.min(Number(req.query.limit) || 100, 500)) });
  })
);

/** Manual "scrape now" — same code path as the cron, so the demo is honest. */
api.post(
  '/products/:id/scrape',
  wrap(async (req, res) => {
    const product = await db.getProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json(await scrapeProduct(product));
  })
);

/* --------------------------------- logs -------------------------------- */

api.get(
  '/logs',
  wrap(async (req, res) => {
    res.json({ items: await db.getRecentLogs(Math.min(Number(req.query.limit) || 100, 300)) });
  })
);

/* -------------------------------- alerts ------------------------------- */

api.get(
  '/alerts',
  wrap(async (_req, res) => {
    res.json({ items: await db.getAlerts() });
  })
);

api.post(
  '/alerts/read',
  wrap(async (_req, res) => {
    await db.markAlertsRead();
    res.json({ ok: true });
  })
);
