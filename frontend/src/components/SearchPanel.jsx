import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';

export default function SearchPanel({ onTracked, trackedIds }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState({ status: 'idle', items: [], error: null });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (!q.trim()) { setState({ status: 'idle', items: [], error: null }); return; }
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    const id = setTimeout(async () => {
      try {
        const res = await api.searchStore(q);
        if (live) { setState({ status: 'done', items: res.items, error: null }); setOpen(true); }
      } catch (err) {
        if (live) setState({ status: 'error', items: [], error: err.message });
      }
    }, 280); // debounce: the store is the thing we are being careful with
    return () => { live = false; clearTimeout(id); };
  }, [q]);

  async function track(item) {
    setBusy(item.storeProductId);
    try {
      const res = await api.track({
        url: item.url,
        name: item.name,
        storeProductId: item.storeProductId,
        imageUrl: item.imageUrl,
      });
      onTracked(res.item);
      setQ('');
      setOpen(false);
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="search" ref={box}>
      <input
        type="search"
        value={q}
        placeholder="Search the store by product name"
        aria-label="Search the store by product name"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => state.items.length && setOpen(true)}
      />
      {open && (
        <div className="results">
          {state.status === 'loading' && <p className="hint">Searching the store…</p>}
          {state.error && <p className="hint">{state.error}</p>}
          {state.status === 'done' && !state.items.length && (
            <p className="hint">Nothing in the store matches “{q}”.</p>
          )}
          {state.items.map((item) => {
            const already = trackedIds.has(String(item.storeProductId));
            return (
              <button
                key={item.storeProductId}
                className="result"
                disabled={already || busy === item.storeProductId}
                onClick={() => track(item)}
              >
                <span className="rname">{item.name}</span>
                <span className="rprice tabular">{item.price != null ? money(item.price, item.currency || 'INR') : ''}</span>
                <span className="radd">
                  {already ? 'Tracked' : busy === item.storeProductId ? 'Adding…' : 'Track'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
