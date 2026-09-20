import React, { useState } from 'react';
import { money, clock } from '../lib/format.js';

const REASON = {
  timeout: 'Request timed out',
  http_error: 'Store returned an error status',
  network_error: 'Could not reach the store',
  parse_error: 'Page loaded but no price could be read',
  validation_error: 'A price was read but failed the sanity check',
  browser_error: 'Headless render failed',
};

function Trail({ trail }) {
  if (!Array.isArray(trail) || !trail.length) return null;
  return (
    <div className="trail">
      {trail.map((a, i) => (
        <span key={i}>
          {i > 0 && ' → '}
          {a.stage || 'http'} #{a.attempt}: {a.ok ? `${a.status} in ${a.ms}ms` : a.kind || 'error'}
        </span>
      ))}
    </div>
  );
}

export default function ScrapeLog({ logs, currency }) {
  const [expanded, setExpanded] = useState(null);

  if (!logs?.length) {
    return <p className="note">No scrape attempts recorded yet.</p>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Outcome</th>
            <th className="num">Attempts</th>
            <th className="num">Took</th>
            <th className="num">Price</th>
            <th>How it was read</th>
            <th>What happened</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="tabular">{clock(l.started_at)}</td>
              <td className={`outcome ${l.outcome}`}>{l.outcome}</td>
              <td className="num tabular">{l.attempts}</td>
              <td className="num tabular">{l.duration_ms ? `${(l.duration_ms / 1000).toFixed(1)}s` : '—'}</td>
              <td className="num tabular">{l.price != null ? money(l.price, currency) : '—'}</td>
              <td>{l.strategy ? `${l.strategy} · ${l.source}` : '—'}</td>
              <td className="why">
                {l.error_kind ? REASON[l.error_kind] || l.error_kind : l.message || '—'}
                {l.error_kind && l.message ? `: ${l.message}` : ''}
                {Array.isArray(l.attempt_trail) && l.attempt_trail.length > 1 && (
                  <>
                    {' '}
                    <button
                      className="btn quiet"
                      style={{ padding: '0 4px' }}
                      onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                    >
                      {expanded === l.id ? 'Hide attempts' : 'Show attempts'}
                    </button>
                    {expanded === l.id && <Trail trail={l.attempt_trail} />}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
