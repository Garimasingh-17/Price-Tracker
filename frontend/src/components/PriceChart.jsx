import React, { useMemo, useState } from 'react';
import { money, clock } from '../lib/format.js';

/**
 * The chart is drawn by hand rather than with a chart library for one reason:
 * it has to show what did NOT happen. Failed scrapes appear as ticks on the
 * baseline and out-of-stock periods as a shaded band, so a gap in the line is
 * explained rather than silently smoothed over.
 */
export default function PriceChart({ history, logs, currency = 'INR' }) {
  const [hover, setHover] = useState(null);

  const W = 760;
  const H = 260;
  const PAD = { top: 16, right: 16, bottom: 34, left: 62 };

  const model = useMemo(() => {
    const points = (history || [])
      .map((h) => ({ t: new Date(h.scraped_at).getTime(), price: Number(h.price), inStock: h.in_stock, raw: h }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.price))
      .sort((a, b) => a.t - b.t);

    const failures = (logs || [])
      .filter((l) => l.outcome === 'failed')
      .map((l) => ({ t: new Date(l.started_at).getTime(), raw: l }))
      .filter((f) => Number.isFinite(f.t));

    if (!points.length) return null;

    const times = [...points.map((p) => p.t), ...failures.map((f) => f.t)];
    let minT = Math.min(...times);
    let maxT = Math.max(...times);
    if (maxT === minT) {
      minT -= 30 * 60_000;
      maxT += 30 * 60_000;
    }

    const prices = points.map((p) => p.price);
    let minP = Math.min(...prices);
    let maxP = Math.max(...prices);
    const span = maxP - minP || Math.max(maxP * 0.05, 1);
    minP = Math.max(0, minP - span * 0.15);
    maxP = maxP + span * 0.15;

    const x = (t) => PAD.left + ((t - minT) / (maxT - minT)) * (W - PAD.left - PAD.right);
    const y = (p) => PAD.top + (1 - (p - minP) / (maxP - minP)) * (H - PAD.top - PAD.bottom);

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
    const base = H - PAD.bottom;
    const area = `${line} L${x(points.at(-1).t).toFixed(1)},${base} L${x(points[0].t).toFixed(1)},${base} Z`;

    // Contiguous out-of-stock stretches, drawn behind the line.
    const bands = [];
    let open = null;
    for (const p of points) {
      if (p.inStock === false && !open) open = p.t;
      if (p.inStock !== false && open) {
        bands.push([open, p.t]);
        open = null;
      }
    }
    if (open) bands.push([open, points.at(-1).t]);

    const ticks = [minP, (minP + maxP) / 2, maxP];
    return { points, failures, x, y, line, area, bands, ticks, minT, maxT, base };
  }, [history, logs]);

  if (!model) {
    return (
      <p className="note">
        No verified readings yet. The first scheduled scrape, or a manual one, will fill this in.
      </p>
    );
  }

  const { points, failures, x, y, line, area, bands, ticks, minT, maxT, base } = model;

  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Price history, ${points.length} readings and ${failures.length} failed scrapes`}
        onMouseLeave={() => setHover(null)}
      >
        {bands.map(([a, b], i) => (
          <rect key={i} className="oos" x={x(a)} y={PAD.top} width={Math.max(2, x(b) - x(a))} height={base - PAD.top} />
        ))}

        {ticks.map((p, i) => (
          <g key={i}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(p)} y2={y(p)} />
            <text x={PAD.left - 8} y={y(p) + 4} textAnchor="end">
              {money(p, currency)}
            </text>
          </g>
        ))}

        <path className="area" d={area} />
        <path className="line" d={line} />

        {points.map((p, i) => (
          <circle
            key={i}
            className="pt"
            cx={x(p.t)}
            cy={y(p.price)}
            r={hover?.kind === 'point' && hover.i === i ? 5 : 2.5}
            onMouseEnter={() => setHover({ kind: 'point', i, p })}
          />
        ))}

        {failures.map((f, i) => (
          <line
            key={i}
            className="fail-tick"
            x1={x(f.t)}
            x2={x(f.t)}
            y1={base - 9}
            y2={base + 5}
            onMouseEnter={() => setHover({ kind: 'fail', i, f })}
          />
        ))}

        <line className="axis" x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} />
        <text x={PAD.left} y={H - 10}>{clock(new Date(minT).toISOString())}</text>
        <text x={W - PAD.right} y={H - 10} textAnchor="end">{clock(new Date(maxT).toISOString())}</text>
      </svg>

      <div className="legend">
        <span><i className="l-price" />Verified price</span>
        <span><i className="l-fail" />Failed scrape, nothing stored</span>
        <span><i className="l-oos" />Out of stock</span>
      </div>

      {hover && (
        <p className="note tabular" style={{ marginTop: 8 }}>
          {hover.kind === 'point'
            ? `${clock(hover.p.raw.scraped_at)} — ${money(hover.p.price, currency)} via ${hover.p.raw.strategy} (${hover.p.raw.source})`
            : `${clock(hover.f.raw.started_at)} — scrape failed: ${hover.f.raw.error_kind || 'error'}`}
        </p>
      )}
    </>
  );
}
