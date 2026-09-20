# Design note

## The rule everything follows

A scraper that runs unattended for weeks will eventually read a page it does not
understand. The only question is what it does then. This one is built so that
the worst outcome is a **hole in the data**, never a wrong number. Every design
decision below falls out of that.

## How the scraping was made reliable

**Retries that actually change something.** Four attempts with exponential
backoff and full jitter, and the timeout widens 50% on each attempt. Retrying
against an identical deadline is close to pointless: if the store took 13s and
the timeout was 12s, the second attempt fails the same way. Jitter matters
because several products are scraped in the same cycle and a fixed delay makes
them retry in lockstep.

Only some errors are retried. Timeouts, network errors, 5xx, 408, 425 and 429
are; a 404 is not, because trying again will not conjure the page. A parse
failure *is* retried once, because a half-rendered page looks exactly like a
missing price.

**Seven extraction strategies, ranked by trust.** Rather than one CSS selector,
extraction tries, in order: operator-configured selectors, JSON-LD, embedded app
state (`__NEXT_DATA__` and friends), microdata/meta tags, `data-*` attributes,
class/id heuristics, and finally a labelled-price regex over the page text. The
first one that yields a positive number wins, and the rest still run so we can
count how many **agree**. Two independent strategies returning the same price is
strong evidence the page was read correctly; it is recorded with every data
point.

The class heuristic specifically demotes elements whose class or tag says
`old`, `was`, `compare`, `mrp`, `strike`, `<s>` or `<del>`. Storefronts love
putting the crossed-out price next to the real one, and a naive "first element
containing 'price'" grabs the wrong one.

**HTTP first, browser only on failure.** Every scrape starts as a plain `fetch`
plus Cheerio, which costs about 200ms and no memory. Playwright is launched
*only* when HTTP extraction or validation fails — which is exactly the case the
brief describes, content that arrives after a delay. On a free Render instance
this is the difference between comfortably fitting in memory and not.

**Waiting for content, not for a clock.** The browser path does not
`waitForTimeout(3000)`. It waits for a currency-shaped value to actually exist
in the DOM, with a ceiling. A fixed sleep is either too short on a slow run or
wasted time on a fast one, and it silently produces empty reads on exactly the
day the store is slowest.

**Validation before persistence.** A reading must be finite, positive, and below
an absurdity ceiling. It is then compared with the last known good price; a move
larger than 75% is not trusted on sight.

**Confirmation instead of rejection.** The brief says prices change frequently,
so rejecting every large move would throw away real data. Instead, a suspicious
move triggers a second independent read, and the value is stored only if both
reads agree. If they disagree, the attempt is logged as a `validation_error` and
nothing is written.

**Honest logging.** Every attempt writes exactly one `scrape_logs` row with the
outcome (`success`, `retried`, `failed`), the number of attempts, duration, HTTP
status, which strategy won, and a JSON trail of each individual attempt. A run
that succeeded on attempt three is logged as `retried`, not `success` — the
distinction is the whole point. `price_history` is only ever written on a
validated success, so the chart and the log can be cross-checked against each
other.

**Structure-change detection.** Because the winning strategy is stored per
reading, a product that has always resolved via `jsonld` and suddenly resolves
via `text-regex` is flagged: the markup changed under us. The scraper keeps
working, and the dashboard says so rather than pretending nothing happened.

**Scheduling within the free-tier constraint.** No always-on loop. cron-job.org
posts to `/api/cron/scrape` with a shared secret every two hours; a second job
pings `/api/cron/ping` every ten minutes so the scrape does not land on a cold
instance. The endpoint refuses overlapping runs with a 409, caps how many
products one invocation will process, and never throws out of the loop — one
product's failure cannot abort the rest of the cycle.

## Trade-offs

**Auto-detection over hard-coded selectors.** Selectors pinned to the store's
current markup would be simpler and marginally faster, but they break silently
the moment a class name changes — the exact failure the brief is testing for. The
layered approach costs more code and can, in principle, latch onto the wrong
number; the agreement count, the compare-at demotion and the deviation guard are
there to contain that. `PRICE_SELECTOR` exists as an override when a human knows
better.

**Polling, not events.** The frontend re-reads every 60 seconds. Websockets or
Supabase realtime would be tidier, but a dashboard whose data changes every two
hours does not justify a persistent connection on a sleeping free instance.

**Denormalised `last_price` on the product row.** It duplicates the newest
`price_history` row. It earns that by making the list view a single query, and
by giving validation a cheap baseline to compare against.

**Concurrency of two.** Higher would finish the cycle faster; two keeps memory
predictable when the browser fallback fires and stays polite to a mock store
that is deliberately fragile.

**Chart drawn by hand.** Recharts would have been fewer lines. It would not have
drawn failed scrapes as ticks on the baseline, which is the one thing this chart
has to do.

**Deleting history with the product.** `ON DELETE CASCADE` means untracking is
destructive. Soft-deletion would preserve the record, but the dashboard is
per-product and an archive nobody reads is not worth the extra state.

## What the AI tools got wrong first, and how it was corrected

**A money regex that silently truncated.** The first version matched numbers as
`\d{1,3}(?:[.,\s]\d{3})*`, thinking in thousands separators. Against `Rs. 89999`
— no separator — it matched only the first three digits and returned **899**.
This is the worst class of bug for this assignment: plausible, positive, passes
every type check, and would have written a wrong price into history every two
hours. It was caught by running a table of real-world price strings through the
parser before wiring anything up, and fixed by matching the greedy digit run
`\d[\d.,\s]*\d` and resolving the decimal separator afterwards. That test table
is now in `backend/tests/extract.test.js`.

**Reaching for Playwright by default.** The first plan rendered every product in
a headless browser because the brief mentions async content. That ignored the
brief's own steer toward lightweight fetching, and would have put a Chromium
process on a free 512MB instance for every scrape. Corrected to HTTP-first with
the browser as an escalation path — it now launches only when the cheap path
cannot produce a valid reading.

**`waitForTimeout` for late-loading content.** The first browser implementation
slept three seconds and then read the DOM. Replaced with `waitForFunction`
watching for a currency-shaped value, which is both faster on good runs and
correct on slow ones.

**Writing zeroes on failure.** The first data model let the scraper insert a row
with `price: null` when extraction failed, so the chart would have a point for
every scheduled run. That is dishonest history. Corrected to: failures write to
`scrape_logs` only, `price_history.price` is `NOT NULL CHECK (price > 0)`, and
the chart renders the gap with failure ticks under it.

**A single `catch` around the whole cycle.** The first runner wrapped the loop
over products in one try/catch, so one product throwing would abandon every
product after it — the "silently stop" failure the brief names. Corrected so
`scrapeProduct` never throws and the cycle always completes.

**Rejecting large price moves outright.** The deviation guard originally just
discarded anything that moved more than 75%. On a store that changes prices
aggressively that would have quietly dropped genuine data while reporting
success. Corrected to the confirming second read described above.

**Launching a browser per product.** Fixed to one shared browser per process,
closed at the end of the cycle.
