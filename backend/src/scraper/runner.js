import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { fetchWithRetry } from './fetcher.js';
import { renderWithRetry, closeBrowser } from './browser.js';
import { extractFromHtml, extractFromJson } from './extract.js';
import { validateReading, detectStructureChange } from './validate.js';
import * as db from '../db.js';
import { raiseAlerts } from '../lib/alerts.js';

/**
 * Scrape one product.
 *
 * Pipeline, cheapest first:
 *   1. HTTP GET with retry/backoff  -> parse
 *   2. if parse or validation fails -> headless browser render -> parse
 *   3. validate                     -> write history + update product
 *   4. always                       -> write one scrape_log row
 *
 * The function never throws. A thrown error inside a cron cycle would abort the
 * remaining products, which is exactly the "silently stop" failure mode the
 * brief warns about.
 */
export async function scrapeProduct(product, opts = {}) {
  const { runId = randomUUID(), onEvent = () => {} } = opts;
  const startedAt = Date.now();
  const trail = [];
  let httpStatus = null;
  let source = 'http';
  let reading = null;
  let lastError = null;
  let attempts = 0;

  const record = (rec) => {
    trail.push(rec);
    onEvent({ type: 'attempt', ...rec });
  };

  /* ---------------------------- stage 1: HTTP ---------------------------- */
  try {
    onEvent({ type: 'stage', stage: 'http', url: product.url });
    const res = await fetchWithRetry(product.url, {
      onAttempt: (a) => record({ ...a, stage: 'http' }),
      onBackoff: (b) => onEvent({ type: 'backoff', ...b, stage: 'http' }),
    });
    attempts += res.attempts;
    httpStatus = res.status;

    const looksJson = /json/i.test(res.contentType) || /^\s*[[{]/.test(res.body);
    if (looksJson) {
      try {
        reading = extractFromJson(JSON.parse(res.body));
      } catch {
        reading = null;
      }
    }
    if (!reading) reading = extractFromHtml(res.body, { baseUrl: product.url });

    if (reading) onEvent({ type: 'extracted', ...reading, source: 'http' });
    else {
      lastError = { kind: 'parse_error', message: 'No price found in the HTTP response' };
      record({ attempt: attempts, ok: false, stage: 'http', kind: 'parse_error', error: lastError.message });
    }
  } catch (err) {
    attempts += err.attempts || 1;
    if (err.trail) trail.push(...err.trail.map((t) => ({ ...t, stage: 'http' })));
    httpStatus = err.status ?? null;
    lastError = { kind: err.kind || 'network_error', message: err.message };
    onEvent({ type: 'stage_failed', stage: 'http', error: err.message });
  }

  /* --------------- stage 1b: validate what HTTP gave us ------------------ */
  let verdict = reading ? validateReading(reading, product) : { ok: false, reason: 'no_data' };

  /* -------------------- stage 2: browser escalation ---------------------- */
  const needsBrowser = !verdict.ok && config.scrape.useBrowserFallback;
  if (needsBrowser) {
    onEvent({ type: 'escalate', reason: verdict.reason || lastError?.kind, stage: 'browser' });
    try {
      const res = await renderWithRetry(product.url, {
        onAttempt: (a) => record({ ...a, stage: 'browser' }),
        onBackoff: (b) => onEvent({ type: 'backoff', ...b, stage: 'browser' }),
        onEvent,
      });
      attempts += res.attempts;
      httpStatus = res.status || httpStatus;
      const rendered = extractFromHtml(res.html, { baseUrl: product.url });
      if (rendered) {
        reading = rendered;
        source = 'browser';
        verdict = validateReading(reading, product);
        onEvent({ type: 'extracted', ...reading, source: 'browser' });
      } else if (!lastError) {
        lastError = { kind: 'parse_error', message: 'No price found after rendering the page' };
      }
    } catch (err) {
      attempts += err.attempts || 1;
      if (err.trail) trail.push(...err.trail.map((t) => ({ ...t, stage: 'browser' })));
      lastError = { kind: err.kind || 'browser_error', message: err.message };
      onEvent({ type: 'stage_failed', stage: 'browser', error: err.message });
    }
  }

  /* ------- stage 3: confirm a suspicious-but-plausible price change ------- */
  // The store changes prices often, so a big jump is not automatically wrong.
  // Instead of discarding it or trusting it, we read the page a second time.
  if (!verdict.ok && verdict.needsConfirmation && reading) {
    onEvent({ type: 'confirming', price: reading.price, reason: verdict.message });
    try {
      const res = await fetchWithRetry(product.url, {
        maxAttempts: 2,
        onAttempt: (a) => record({ ...a, stage: 'confirm' }),
      });
      attempts += res.attempts;
      const second = extractFromHtml(res.body, { baseUrl: product.url });
      if (second && Math.abs(second.price - reading.price) < 0.01) {
        verdict = { ok: true, confirmed: true };
        onEvent({ type: 'confirmed', price: reading.price });
      } else {
        lastError = {
          kind: 'validation_error',
          message: `${verdict.message}; second read returned ${second ? second.price : 'nothing'}`,
        };
        onEvent({ type: 'confirm_failed', first: reading.price, second: second?.price ?? null });
      }
    } catch (err) {
      lastError = { kind: 'validation_error', message: `${verdict.message}; confirmation read failed` };
    }
  }

  /* ---------------------------- stage 4: persist ------------------------- */
  const durationMs = Date.now() - startedAt;
  const failedAttempts = trail.filter((t) => t.ok === false).length;
  const nowIso = new Date().toISOString();

  if (verdict.ok && reading) {
    const structureNote = detectStructureChange(product, reading);

    await db.insertPricePoint({
      product_id: product.id,
      price: reading.price,
      in_stock: reading.inStock,
      stock_text: reading.stockText,
      currency: reading.currency || product.currency || 'INR',
      strategy: reading.strategy,
      source,
      scraped_at: nowIso,
    });

    await db.updateProduct(product.id, {
      last_price: reading.price,
      last_in_stock: reading.inStock,
      last_stock_text: reading.stockText,
      last_success_at: nowIso,
      last_attempt_at: nowIso,
      consecutive_failures: 0,
      last_strategy: reading.strategy,
      currency: reading.currency || product.currency || 'INR',
      ...(structureNote ? { structure_changed_at: nowIso } : {}),
      ...(product.image_url ? {} : reading.imageUrl ? { image_url: reading.imageUrl } : {}),
    });

    await db.insertLog({
      product_id: product.id,
      run_id: runId,
      outcome: failedAttempts > 0 ? 'retried' : 'success',
      attempts,
      duration_ms: durationMs,
      http_status: httpStatus,
      source,
      strategy: reading.strategy,
      price: reading.price,
      in_stock: reading.inStock,
      message:
        failedAttempts > 0
          ? `Recovered after ${failedAttempts} failed attempt(s)`
          : `Read via ${reading.strategy} (${reading.agreement} strategies agreed)`,
      attempt_trail: trail,
      started_at: new Date(startedAt).toISOString(),
    });

    await raiseAlerts(product, reading, structureNote);

    onEvent({ type: 'done', outcome: failedAttempts > 0 ? 'retried' : 'success', price: reading.price });
    return { ok: true, outcome: failedAttempts > 0 ? 'retried' : 'success', price: reading.price, attempts };
  }

  /* ------------------------------ failure path --------------------------- */
  // Nothing is written to price_history. The gap is the honest answer.
  const err = lastError || {
    kind: verdict.reason === 'deviation' ? 'validation_error' : 'parse_error',
    message: verdict.message || 'Could not extract a trustworthy price',
  };

  await db.updateProduct(product.id, {
    last_attempt_at: nowIso,
    consecutive_failures: (product.consecutive_failures || 0) + 1,
  });

  await db.insertLog({
    product_id: product.id,
    run_id: runId,
    outcome: 'failed',
    attempts: attempts || 1,
    duration_ms: durationMs,
    http_status: httpStatus,
    source,
    strategy: reading?.strategy || null,
    price: null,
    in_stock: null,
    error_kind: err.kind,
    message: err.message?.slice(0, 500),
    attempt_trail: trail,
    started_at: new Date(startedAt).toISOString(),
  });

  log.error('scrape_failed', { product: product.name, kind: err.kind, message: err.message });
  onEvent({ type: 'done', outcome: 'failed', error: err.message });
  return { ok: false, outcome: 'failed', error: err.message, attempts };
}

/** Run one full cycle over every product that is due. */
export async function runCycle(opts = {}) {
  const runId = randomUUID();
  const started = Date.now();
  const products = opts.products || (await db.dueProducts(config.scrape.maxProductsPerRun));

  if (!products.length) {
    log.info('cycle_empty', { runId });
    return { runId, processed: 0, results: [], durationMs: Date.now() - started };
  }

  log.info('cycle_start', { runId, count: products.length });

  const results = [];
  const queue = [...products];
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift();
      const r = await scrapeProduct(p, { runId, onEvent: opts.onEvent });
      results.push({ product: p.name, id: p.id, ...r });
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(config.scrape.concurrency, queue.length)) }, worker)
  );

  if (!opts.keepBrowser) await closeBrowser();

  const summary = {
    runId,
    processed: results.length,
    succeeded: results.filter((r) => r.outcome === 'success').length,
    retried: results.filter((r) => r.outcome === 'retried').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    durationMs: Date.now() - started,
    results,
  };
  log.info('cycle_done', summary);
  return summary;
}
