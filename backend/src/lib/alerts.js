import { config } from './../config.js';
import { insertAlert } from '../db.js';
import { log } from './logger.js';

const fmt = (n, cur = 'INR') => `${cur === 'INR' ? '₹' : ''}${Number(n).toLocaleString('en-IN')}`;

/**
 * Compare a fresh reading against the product's previous known-good state and
 * record anything a user would want to be told about.
 */
export async function raiseAlerts(product, reading, structureNote) {
  const events = [];
  const cur = reading.currency || product.currency || 'INR';
  const prevPrice = product.last_price != null ? Number(product.last_price) : null;

  if (prevPrice && reading.price < prevPrice) {
    const pct = (((prevPrice - reading.price) / prevPrice) * 100).toFixed(1);
    events.push({
      kind: 'price_drop',
      old_value: String(prevPrice),
      new_value: String(reading.price),
      message: `${product.name} dropped ${pct}% to ${fmt(reading.price, cur)} (was ${fmt(prevPrice, cur)})`,
    });
  } else if (prevPrice && reading.price > prevPrice) {
    const pct = (((reading.price - prevPrice) / prevPrice) * 100).toFixed(1);
    events.push({
      kind: 'price_rise',
      old_value: String(prevPrice),
      new_value: String(reading.price),
      message: `${product.name} rose ${pct}% to ${fmt(reading.price, cur)}`,
    });
  }

  if (product.last_in_stock === false && reading.inStock === true) {
    events.push({
      kind: 'back_in_stock',
      old_value: 'out of stock',
      new_value: 'in stock',
      message: `${product.name} is back in stock`,
    });
  } else if (product.last_in_stock === true && reading.inStock === false) {
    events.push({
      kind: 'out_of_stock',
      old_value: 'in stock',
      new_value: 'out of stock',
      message: `${product.name} is now out of stock`,
    });
  }

  if (structureNote) {
    events.push({
      kind: 'structure_change',
      old_value: product.last_strategy,
      new_value: reading.strategy,
      message: `${product.name}: ${structureNote}`,
    });
  }

  for (const e of events) {
    await insertAlert({ product_id: product.id, ...e });
    // Email is opt-in; price_rise is noise, so it stays in-app only.
    if (e.kind !== 'price_rise') await sendEmail(e.message).catch(() => {});
  }
  return events;
}

/** Optional SendGrid delivery. No-ops unless all three env vars are set. */
async function sendEmail(message) {
  const { sendgridKey, to, from } = config.alerts;
  if (!sendgridKey || !to || !from) return;
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sendgridKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject: 'Price tracker alert',
      content: [{ type: 'text/plain', value: message }],
    }),
  });
  if (!res.ok) log.warn('sendgrid_failed', { status: res.status });
}
