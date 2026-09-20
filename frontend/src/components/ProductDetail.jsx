import React, { useState } from 'react';
import PriceChart from './PriceChart.jsx';
import ScrapeLog from './ScrapeLog.jsx';
import { api } from '../lib/api.js';
import { money, ago, clock, stockLabel } from '../lib/format.js';

const INTERVALS = [
  [30, 'Every 30 minutes'],
  [60, 'Every hour'],
  [120, 'Every 2 hours'],
  [360, 'Every 6 hours'],
  [1440, 'Once a day'],
];

export default function ProductDetail({ detail, onRefresh, onUntrack }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const { item, history, logs } = detail;
  const currency = item.currency || 'INR';
  const first = history[0];
  const latest = history.at(-1);
  const stock = stockLabel(item.last_in_stock);

  const delta =
    first && latest && Number(first.price) > 0
      ? ((Number(latest.price) - Number(first.price)) / Number(first.price)) * 100
      : null;
  const dir = delta === null ? 'flat' : delta < -0.05 ? 'fall' : delta > 0.05 ? 'rise' : 'flat';

  const failing = (item.consecutive_failures || 0) >= 2;
  const staleHours = item.last_success_at
    ? (Date.now() - new Date(item.last_success_at).getTime()) / 3_600_000
    : null;

  async function scrapeNow() {
    setBusy(true);
    setNote(null);
    try {
      const res = await api.scrapeNow(item.id);
      setNote(
        res.ok
          ? `Scraped successfully in ${res.attempts} attempt${res.attempts === 1 ? '' : 's'}.`
          : `Scrape failed after ${res.attempts} attempts: ${res.error}. Nothing was stored.`
      );
      await onRefresh();
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeInterval(minutes) {
    await api.updateProduct(item.id, { intervalMinutes: Number(minutes) });
    await onRefresh();
  }

  async function untrack() {
    if (!confirm(`Stop tracking ${item.name}? Its price history will be deleted too.`)) return;
    await api.untrack(item.id);
    onUntrack(item.id);
  }

  return (
    <>
      {failing && (
        <div className="banner">
          The last {item.consecutive_failures} scrapes of this product failed.
          {staleHours !== null
            ? ` The price below was last verified ${ago(item.last_success_at)} and may be out of date.`
            : ' Nothing has been verified yet.'}{' '}
          The log below says what went wrong.
        </div>
      )}
      {item.structure_changed_at && (
        <div className="banner">
          The store’s page structure changed on {clock(item.structure_changed_at)}. The scraper adapted and is
          now reading the price via <strong>{item.last_strategy}</strong>. Worth a look.
        </div>
      )}

      <section className="hero">
        <h2>{item.name}</h2>
        <div className="figure">
          <span className="price-now tabular">{money(item.last_price, currency)}</span>
          {delta !== null && (
            <span className={`delta ${dir}`}>
              {delta > 0 ? '+' : ''}
              {delta.toFixed(1)}% since first tracked
            </span>
          )}
          <span className={`stock-flag ${stock.cls}`}>{stock.text}</span>
        </div>
        <p className="verified">
          Last verified{' '}
          <span className={staleHours !== null && staleHours > 4 ? 'stale' : undefined}>
            {ago(item.last_success_at)}
          </span>
          {item.last_stock_text ? ` · store says “${item.last_stock_text}”` : ''}
          {' · '}
          <a href={item.url} target="_blank" rel="noreferrer">
            View on the store
          </a>
        </p>

        <div className="actions">
          <button className="btn primary" onClick={scrapeNow} disabled={busy}>
            {busy ? 'Scraping…' : 'Scrape now'}
          </button>
          <label>
            <span className="note" style={{ marginRight: 6 }}>Checks</span>
            <select value={item.interval_minutes} onChange={(e) => changeInterval(e.target.value)}>
              {INTERVALS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </label>
          <button className="btn quiet" onClick={untrack}>Stop tracking</button>
          {note && <span className="note">{note}</span>}
        </div>
      </section>

      <section className="panel">
        <h3>Price and stock over time</h3>
        <p className="note">
          Only readings that passed validation are plotted. Failed scrapes are marked on the baseline.
        </p>
        <PriceChart history={history} logs={logs} currency={currency} />
        <div className="stats tabular">
          <div><span>Readings</span>{history.length}</div>
          <div><span>Lowest</span>{money(item.min_price, currency)}</div>
          <div><span>Highest</span>{money(item.max_price, currency)}</div>
          <div><span>Average</span>{money(item.avg_price, currency)}</div>
          <div>
            <span>Scrape success</span>
            {item.success_count + item.failure_count > 0
              ? `${Math.round((item.success_count / (item.success_count + item.failure_count)) * 100)}% of ${
                  item.success_count + item.failure_count
                }`
              : '—'}
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Every scrape attempt</h3>
        <p className="note">
          Newest first. Failures are recorded in full, including the reason and each retry.
        </p>
        <ScrapeLog logs={logs} currency={currency} />
      </section>
    </>
  );
}
