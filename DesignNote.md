# Design Note — Reliable Price Scraping

### Approach

I made the scraper reliable by treating the product page as a **dynamic browser-rendered page**, rather than assuming the price would be present immediately in the initial HTML.

The scraping flow now:

1. Opens the product page using Playwright.
2. Waits for the product's `.price-block` and **"Reveal price"** button.
3. Removes the site's cookie overlay because it was intercepting clicks.
4. Simulates interaction with the price area before clicking the reveal button.
5. Uses a **forced Playwright click** to handle the overlay/interception issue.
6. Waits for the page JavaScript to update the price.
7. Captures the resulting HTML and passes it to the existing extraction pipeline.
8. Uses flexible price detection instead of depending on one exact CSS selector.
9. Keeps retry logic so transient browser/network failures can be retried.

The extraction layer already has multiple fallback strategies, including the revealed-price selector, configured selectors, JSON-LD, embedded state, metadata, data attributes, class heuristics, and text regex.

### Trade-offs

The main trade-off was between **strict selector validation and robustness**.

Initially, the scraper required:

```text
.price-block.price-success .price-current
```

This is precise, but it made the scraper fail whenever the website's DOM/class state differed from that exact expectation.

I replaced that hard dependency with broader checks for currency/price text and allowed the rendered HTML to reach the extraction layer. This makes the scraper more tolerant of DOM changes, but it also means that extraction relies more heavily on the existing layered extraction strategies to identify the correct price.

I also kept a short wait after clicking rather than using a very long fixed delay. This balances reliability with scraping speed.

### What the AI got wrong initially

The first implementation focused on clicking the **"Reveal price"** button but did not account for the site's cookie overlay intercepting pointer events. Playwright therefore produced an error indicating that the `.cookie-overlay` was receiving the click instead of the button.

The first correction was to remove the cookie overlay and use:

```js
await revealBtn.click({
  timeout: 5000,
  force: true
});
```

That fixed the click problem.

However, the next attempt exposed a second mistake: the scraper was still waiting for the overly specific selector:

```js
.price-block.price-success .price-current
```

The price was actually being extracted successfully, but the browser renderer timed out waiting for that particular CSS state.

The second correction removed that fragile wait and instead allowed the rendered HTML to proceed to the extraction layer, with a more general price-presence check.

### Result

After the correction, the scraper successfully extracted:

```text
Vantablack Mouse Mini
Price: ₹12,268
```

The browser-rendering failure was therefore resolved; the remaining `retried` status is separate from the actual price extraction and belongs to the subsequent scraping/retry workflow.
