import { config } from '../config.js';

/**
 * The last line of defence before anything is written to price_history.
 *
 * Rule: it is always better to record a failure than to record a number we are
 * not sure about. A gap in the chart is honest; a wrong point is not.
 */
export function validateReading(reading, product) {
  if (!reading) {
    return { ok: false, reason: 'no_data', message: 'No price could be extracted from the page' };
  }

  const { price } = reading;

  if (!Number.isFinite(price)) {
    return { ok: false, reason: 'not_a_number', message: `Extracted price is not a number: ${price}` };
  }
  if (price <= 0) {
    return { ok: false, reason: 'non_positive', message: `Extracted price is not positive: ${price}` };
  }
  // A price with more than 2 decimals, or absurdly large, is a parse artefact
  // (e.g. a phone number or an SKU picked up by a loose selector).
  if (price > 100_000_000) {
    return { ok: false, reason: 'implausible', message: `Extracted price is implausibly large: ${price}` };
  }

  // Deviation guard against the last known good price.
  const dev = config.scrape.priceSanityDeviation;
  const last = product?.last_price != null ? Number(product.last_price) : null;
  if (dev > 0 && last && last > 0) {
    const delta = Math.abs(price - last) / last;
    if (delta > dev) {
      return {
        ok: false,
        reason: 'deviation',
        needsConfirmation: true,
        message: `Price ${price} deviates ${(delta * 100).toFixed(0)}% from last known ${last}`,
      };
    }
  }

  return { ok: true };
}

/**
 * Did the page structure change? We know the strategy that produced every past
 * reading, so a downgrade from structured data to a text guess is a signal.
 */
const RANK = {
  'configured-selector': 0,
  'json-api': 1,
  jsonld: 2,
  'embedded-state': 3,
  meta: 4,
  'data-attr': 5,
  'class-heuristic': 6,
  'text-regex': 7,
};

export function detectStructureChange(product, reading) {
  const prev = product?.last_strategy;
  if (!prev || !reading?.strategy || prev === reading.strategy) return null;
  const before = RANK[prev] ?? 9;
  const after = RANK[reading.strategy] ?? 9;
  if (after > before) {
    return `Extraction fell back from "${prev}" to "${reading.strategy}" — the page markup likely changed.`;
  }
  return `Extraction moved from "${prev}" to "${reading.strategy}".`;
}
