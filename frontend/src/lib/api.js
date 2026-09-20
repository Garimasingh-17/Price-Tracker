const BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '');

async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`The API returned something that is not JSON (HTTP ${res.status}).`);
  }
  if (!res.ok) throw new Error(data?.error || `Request failed with HTTP ${res.status}.`);
  return data;
}

export const api = {
  base: BASE,
  searchStore: (q) => call(`/api/store/search?q=${encodeURIComponent(q)}`),
  listProducts: () => call('/api/products'),
  getProduct: (id) => call(`/api/products/${id}`),
  track: (product) => call('/api/products', { method: 'POST', body: product }),
  untrack: (id) => call(`/api/products/${id}`, { method: 'DELETE' }),
  updateProduct: (id, patch) => call(`/api/products/${id}`, { method: 'PATCH', body: patch }),
  scrapeNow: (id) => call(`/api/products/${id}/scrape`, { method: 'POST' }),
  recentLogs: () => call('/api/logs?limit=300'),
  alerts: () => call('/api/alerts'),
};
