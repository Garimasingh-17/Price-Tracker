import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SearchPanel from './components/SearchPanel.jsx';
import ProductDetail from './components/ProductDetail.jsx';
import { api } from './lib/api.js';
import { money, ago, clock } from './lib/format.js';

const STORE = 'demo.inelabteamdev.com';

function Sparkline({ history }) {
  const pts = (history || []).slice(-24).map((h) => Number(h.price)).filter(Number.isFinite);
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const d = pts
    .map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * 60},${14 - ((p - min) / span) * 12}`)
    .join(' ');
  return (
    <svg width="60" height="16" aria-hidden="true">
      <path d={d} fill="none" stroke="var(--steel)" strokeWidth="1.5" />
    </svg>
  );
}

function Tile({ product, outcomes, selected, onSelect }) {
  return (
    <button className="tile" aria-current={selected} onClick={() => onSelect(product.id)}>
      <span className="tname">{product.name}</span>
      <span className="trow">
        <span className="tprice tabular">{money(product.last_price, product.currency)}</span>
        <Sparkline history={outcomes?.history} />
      </span>
      <span className="trow">
        <span className="tmeta">{ago(product.last_success_at)}</span>
        <span className="dots" aria-label="Recent scrape outcomes">
          {(outcomes?.recent || []).map((o, i) => (
            <span key={i} className={`dot ${o}`} title={o} />
          ))}
        </span>
      </span>
    </button>
  );
}

export default function App() {
  const [products, setProducts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProducts = useCallback(async () => {
    try {
      const res = await api.listProducts();
      setProducts(res.items);
      setError(null);
      setSelectedId((cur) => cur ?? res.items[0]?.id ?? null);
      return res.items;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSide = useCallback(() => {
    api.alerts().then((r) => setAlerts(r.items)).catch(() => {});
    api.recentLogs().then((r) => setRecentLogs(r.items)).catch(() => {});
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (!id) return setDetail(null);
    try {
      setDetail(await api.getProduct(id));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadProducts();
    loadSide();
  }, [loadProducts, loadSide]);

  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Refresh quietly every minute so a cron-triggered scrape shows up without
  // the person reloading the page.
  useEffect(() => {
    const id = setInterval(() => {
      loadProducts();
      loadDetail(selectedId);
      loadSide();
    }, 60_000);
    return () => clearInterval(id);
  }, [loadProducts, loadDetail, loadSide, selectedId]);

  const refresh = useCallback(async () => {
    await loadProducts();
    await loadDetail(selectedId);
    loadSide();
  }, [loadProducts, loadDetail, loadSide, selectedId]);

  const trackedIds = useMemo(
    () => new Set(products.map((p) => String(p.store_product_id))),
    [products]
  );

  // Outcome dots come from one recent-logs query so every tile shows its health,
  // not just the product that happens to be open.
  const tileData = useMemo(() => {
    const byProduct = {};
    for (const l of recentLogs) {
      (byProduct[l.product_id] ||= []).push(l.outcome);
    }
    const out = {};
    for (const [id, outcomes] of Object.entries(byProduct)) {
      out[id] = { recent: outcomes.slice(0, 5).reverse() };
    }
    if (detail) {
      out[detail.item.id] = {
        recent: out[detail.item.id]?.recent || detail.logs.slice(0, 5).reverse().map((l) => l.outcome),
        history: detail.history,
      };
    }
    return out;
  }, [recentLogs, detail]);

  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="wordmark">Price tracker</h1>
        <span className="store">watching {STORE}, every 2 hours</span>
        <span className="spacer" />
        <SearchPanel
          trackedIds={trackedIds}
          onTracked={async (item) => {
            await loadProducts();
            setSelectedId(item.id);
          }}
        />
      </header>

      <div className="columns">
        <aside className="rail">
          <h2>Tracked products</h2>
          {loading && <p className="note">Loading…</p>}
          {!loading && !products.length && (
            <p className="note">Nothing tracked yet. Search the store above to add a product.</p>
          )}
          {products.map((p) => (
            <Tile
              key={p.id}
              product={p}
              outcomes={tileData[p.id]}
              selected={p.id === selectedId}
              onSelect={setSelectedId}
            />
          ))}

          {alerts.length > 0 && (
            <>
              <h2 style={{ marginTop: 10 }}>Recent changes</h2>
              <div>
                {alerts.slice(0, 8).map((a) => (
                  <div className="alert-row" key={a.id}>
                    <time dateTime={a.created_at}>{clock(a.created_at)}</time>
                    <span>
                      <span className={`kind ${a.kind}`}>{a.kind.replace(/_/g, ' ')}</span> — {a.message}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>

        <main className="stage">
          {error && (
            <div className="banner">
              Could not reach the tracker API at {api.base}. {error}
            </div>
          )}

          {!error && !products.length && !loading && (
            <div className="empty">
              <h2>Pick something to watch</h2>
              <p>
                Search the mock store by name and track a product. From then on the scraper reads its price
                and stock every two hours, records every attempt it makes, and tells you when it could not
                get a trustworthy answer.
              </p>
            </div>
          )}

          {detail && <ProductDetail detail={detail} onRefresh={refresh} onUntrack={(id) => {
            setProducts((ps) => ps.filter((p) => p.id !== id));
            setSelectedId(null);
            setDetail(null);
            loadProducts();
          }} />}
        </main>
      </div>
    </div>
  );
}
