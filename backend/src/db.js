import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

/* ------------------------------ products ------------------------------ */

export async function listProducts() {
  return unwrap(
    await supabase.from('product_dashboard').select('*').order('created_at', { ascending: false })
  );
}

export async function getProduct(id) {
  return unwrap(await supabase.from('product_dashboard').select('*').eq('id', id).maybeSingle());
}

export async function findByStoreId(storeProductId) {
  return unwrap(
    await supabase
      .from('tracked_products')
      .select('*')
      .eq('store_product_id', storeProductId)
      .maybeSingle()
  );
}

export async function insertProduct(row) {
  return unwrap(await supabase.from('tracked_products').insert(row).select().single());
}

export async function updateProduct(id, patch) {
  return unwrap(await supabase.from('tracked_products').update(patch).eq('id', id).select().single());
}

export async function deleteProduct(id) {
  unwrap(await supabase.from('tracked_products').delete().eq('id', id));
  return true;
}

/** Products whose next scrape is due, honouring per-product interval_minutes. */
export async function dueProducts(limit) {
  const rows = unwrap(
    await supabase.from('tracked_products').select('*').eq('active', true)
  );
  const now = Date.now();
  return rows
    .filter((p) => {
      if (!p.last_attempt_at) return true;
      const due = new Date(p.last_attempt_at).getTime() + (p.interval_minutes || 120) * 60_000;
      // 60s of slack so a cron that fires a few seconds early still counts.
      return now >= due - 60_000;
    })
    .sort((a, b) => new Date(a.last_attempt_at || 0) - new Date(b.last_attempt_at || 0))
    .slice(0, limit);
}

/* ------------------------------- history ------------------------------- */

export async function insertPricePoint(row) {
  return unwrap(await supabase.from('price_history').insert(row).select().single());
}

export async function getHistory(productId, limit = 500) {
  return unwrap(
    await supabase
      .from('price_history')
      .select('*')
      .eq('product_id', productId)
      .order('scraped_at', { ascending: true })
      .limit(limit)
  );
}

/* --------------------------------- logs -------------------------------- */

export async function insertLog(row) {
  const { error } = await supabase.from('scrape_logs').insert(row);
  // A log write must never take down a scrape run.
  if (error) console.error(JSON.stringify({ level: 'error', msg: 'log_write_failed', error: error.message }));
}

export async function getLogs(productId, limit = 100) {
  return unwrap(
    await supabase
      .from('scrape_logs')
      .select('*')
      .eq('product_id', productId)
      .order('started_at', { ascending: false })
      .limit(limit)
  );
}

export async function getRecentLogs(limit = 100) {
  return unwrap(
    await supabase
      .from('scrape_logs')
      .select('*, tracked_products(name)')
      .order('started_at', { ascending: false })
      .limit(limit)
  );
}

/* -------------------------------- alerts ------------------------------- */

export async function insertAlert(row) {
  const { error } = await supabase.from('alerts').insert(row);
  if (error) console.error(JSON.stringify({ level: 'error', msg: 'alert_write_failed', error: error.message }));
}

export async function getAlerts(limit = 50) {
  return unwrap(
    await supabase
      .from('alerts')
      .select('*, tracked_products(name)')
      .order('created_at', { ascending: false })
      .limit(limit)
  );
}

export async function markAlertsRead() {
  unwrap(await supabase.from('alerts').update({ read: true }).eq('read', false));
  return true;
}
