# Interface design plan

**Subject.** Not a shopping app. This is a *reliability console* for a scraper —
the person looking at it wants to know two things: what the price did, and
whether the data is trustworthy. The brief says the scraping is the heart of the
assignment, so the interface should make the scraper's honesty visible rather
than hide it behind a pretty chart.

**Audience.** The reviewer of this assignment, and anyone operating the tracker.

**Primary job.** Show price and stock over time, and make failures as legible as
successes.

## Tokens

Color — a cool instrument palette, not warm-cream-and-terracotta:

| Token       | Hex       | Role                                   |
|-------------|-----------|----------------------------------------|
| `--paper`   | `#E9EEF3` | page ground, a pale blueprint blue-grey |
| `--panel`   | `#FBFCFD` | raised surfaces                         |
| `--ink`     | `#101F2B` | primary text                            |
| `--rule`    | `#C3D0DB` | hairlines, axes                         |
| `--steel`   | `#2B5F8A` | interactive accent                      |
| `--fall`    | `#0E7C6B` | price fell (good for the watcher)       |
| `--rise`    | `#A63D33` | price rose                              |
| `--warn`    | `#96690A` | retried                                 |

Failure states use `--rise`/`--warn` rather than a separate red, so the eye
learns one vocabulary: warm means something needs attention.

Type — two clearly distinct families:
- **Newsreader** (serif) for product names and the hero price. Gives the numbers
  weight and keeps them from reading like a SaaS metric card.
- **Archivo** (grotesque) for every label, control and table cell, with
  `font-variant-numeric: tabular-nums` so columns of prices and timestamps line
  up on the decimal.

Layout:

```
┌───────────────────────────────────────────────────────────┐
│  Price tracker              [ search the store ........ ] │
├───────────────┬───────────────────────────────────────────┤
│ tracked       │  Sennheiser HD 450BT                      │
│ ┌───────────┐ │  ₹8,490   ▼ 4.2% since first seen         │
│ │ name      │ │  last verified 14 minutes ago · in stock  │
│ │ ₹8,490 ▁▃▂│ │                                           │
│ │ ●●●○●     │ │  ┌─── price over time ────────────────┐   │
│ └───────────┘ │  │        ╱╲                          │   │
│ ┌───────────┐ │  │   ╱╲__╱  ╲___                      │   │
│ │ ...       │ │  │ ✕      ✕   (failed scrapes as ticks)│   │
│ └───────────┘ │  └────────────────────────────────────┘   │
│               │  every scrape attempt, newest first        │
│               │  14:02  success  4 attempts  jsonld  ₹8490 │
│               │  12:02  failed   timeout after 4 attempts  │
└───────────────┴───────────────────────────────────────────┘
```

Left aligned throughout; numbers right aligned in tables.

## Principles

1. **The gap is the message.** Failed scrapes are drawn on the chart's baseline
   as ticks, not omitted. A chart with holes in it is the honest chart.
2. **One bold thing.** The hero price, set large in the serif, is the only
   display-scale type on the page. Everything else stays quiet.
3. **Health is ambient.** Each tracked product carries a five-dot strip of its
   last five scrape outcomes, so reliability is visible without opening
   anything.
4. **No decoration that isn't data.** The sparkline, the dots and the rules all
   encode something.

## Review against the generic defaults

First pass reached for a card grid with rounded corners, a soft grey shadow on
each card, and a green/red badge — the SaaS-card kit. Revised: panels sit on a
single hairline with a 2px radius, and product health is expressed as the
outcome dot strip, which carries real information a badge would not. The
sparkline replaced a large "stat card" number because the trend matters more
than the instantaneous value. Labels are sentence case, not tracked-out caps.
