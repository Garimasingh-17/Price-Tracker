import { config } from '../config.js';
import { log } from '../lib/logger.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/128.0.0.0 Safari/537.36 INEPriceTracker/1.0 (assignment bot; contact via repo)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter, so retries never stampede. */
export function backoffDelay(attempt) {
  const { retryBaseDelayMs, retryMaxDelayMs } = config.scrape;
  const ceiling = Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** (attempt - 1));
  return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

export class FetchError extends Error {
  constructor(kind, message, meta = {}) {
    super(message);
    this.kind = kind; // timeout | http_error | network_error
    Object.assign(this, meta);
  }
}

/** Errors worth trying again. 4xx other than 408/429 are not. */
export function isRetryable(err) {
  if (!err) return false;
  if (err.kind === 'timeout' || err.kind === 'network_error') return true;
  if (err.kind === 'http_error') {
    const s = err.status || 0;
    return s === 408 || s === 425 || s === 429 || s >= 500;
  }
  // A parse failure can be a half-rendered page — one more try is cheap.
  return err.kind === 'parse_error';
}

/**
 * Single HTTP GET with a hard timeout.
 * Throws FetchError; never resolves with a non-2xx body.
 */
export async function fetchOnce(url, { timeoutMs = config.scrape.requestTimeoutMs, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        ...headers,
      },
    });
    const body = await res.text();
    const durationMs = Date.now() - startedAt;
    if (!res.ok) {
      throw new FetchError('http_error', `HTTP ${res.status} for ${url}`, {
        status: res.status,
        durationMs,
      });
    }
    return {
      status: res.status,
      body,
      durationMs,
      contentType: res.headers.get('content-type') || '',
      url: res.url || url,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    if (err instanceof FetchError) throw err;
    if (err.name === 'AbortError') {
      throw new FetchError('timeout', `Timed out after ${timeoutMs}ms: ${url}`, { durationMs });
    }
    throw new FetchError('network_error', `${err.code || err.name || 'Error'}: ${err.message}`, {
      durationMs,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retrying GET.
 * onAttempt is called with a record of every attempt so callers can write an
 * honest trail into the scrape log, including the attempts that failed.
 */
export async function fetchWithRetry(url, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? config.scrape.maxAttempts;
  const trail = [];
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Widen the timeout a little on each retry: the store is sometimes just slow,
    // and giving up at the same deadline every time guarantees the same failure.
    const timeoutMs = (opts.timeoutMs ?? config.scrape.requestTimeoutMs) * (1 + 0.5 * (attempt - 1));
    try {
      const res = await fetchOnce(url, { ...opts, timeoutMs });
      trail.push({ attempt, ok: true, status: res.status, ms: res.durationMs });
      opts.onAttempt?.({ attempt, ok: true, status: res.status, ms: res.durationMs });
      return { ...res, attempts: attempt, trail };
    } catch (err) {
      lastErr = err;
      const rec = {
        attempt,
        ok: false,
        kind: err.kind,
        status: err.status || null,
        ms: err.durationMs || null,
        error: err.message,
      };
      trail.push(rec);
      opts.onAttempt?.(rec);
      log.warn('fetch_attempt_failed', { url, ...rec });

      if (attempt === maxAttempts || !isRetryable(err)) break;
      const delay = backoffDelay(attempt);
      opts.onBackoff?.({ attempt, delay });
      await sleep(delay);
    }
  }

  lastErr.attempts = maxAttempts;
  lastErr.trail = trail;
  throw lastErr;
}
