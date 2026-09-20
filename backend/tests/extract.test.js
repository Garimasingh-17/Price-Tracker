import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parseStock, extractFromHtml } from '../src/scraper/extract.js';
import { validateReading } from '../src/scraper/validate.js';

test('parseMoney handles the formats the store might use', () => {
  assert.equal(parseMoney('₹1,299.00').price, 1299);
  assert.equal(parseMoney('Rs. 89999').price, 89999);
  assert.equal(parseMoney('$49.99').price, 49.99);
  assert.equal(parseMoney('1.299,50 €').price, 1299.5);
  assert.equal(parseMoney('Price: INR 2,450').price, 2450);
  assert.equal(parseMoney('  '), null);
  assert.equal(parseMoney('Out of stock'), null);
  assert.equal(parseMoney('0'), null);
});

test('parseMoney reads the currency when it is present', () => {
  assert.equal(parseMoney('₹500').currency, 'INR');
  assert.equal(parseMoney('$500').currency, 'USD');
  assert.equal(parseMoney('500').currency, null);
});

test('parseStock distinguishes in, out and unknown', () => {
  assert.equal(parseStock('In Stock').inStock, true);
  assert.equal(parseStock('Out of Stock').inStock, false);
  assert.equal(parseStock('Sold out').inStock, false);
  assert.equal(parseStock('3 left in stock').inStock, true);
  assert.equal(parseStock('0 left in stock').inStock, false);
  assert.equal(parseStock('Ships from Mumbai').inStock, true);
  assert.equal(parseStock('Blue, 256GB').inStock, null);
});

test('JSON-LD wins over a struck-through price in the markup', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
        {"@type":"Product","name":"Widget",
         "offers":{"@type":"Offer","price":"1299.00","priceCurrency":"INR",
                   "availability":"https://schema.org/InStock"}}
      </script>
    </head><body>
      <span class="old-price"><s>₹2,499</s></span>
      <span class="price">₹1,299</span>
    </body></html>`;
  const r = extractFromHtml(html, { baseUrl: 'https://example.com/p/1' });
  assert.equal(r.price, 1299);
  assert.equal(r.strategy, 'jsonld');
  assert.equal(r.inStock, true);
  assert.ok(r.agreement >= 2, 'the visible price should agree with the structured data');
});

test('falls back to class heuristics and skips the compare-at price', () => {
  const html = `<body>
    <div class="product">
      <span class="compare-at-price">₹2,499</span>
      <span class="product-price">₹1,899</span>
      <div class="availability">Out of stock</div>
    </div></body>`;
  const r = extractFromHtml(html, { baseUrl: 'https://example.com' });
  assert.equal(r.price, 1899);
  assert.equal(r.inStock, false);
});

test('returns null rather than guessing when there is no price', () => {
  assert.equal(extractFromHtml('<body><h1>Loading…</h1></body>', {}), null);
});

test('validation refuses junk and flags large deviations for confirmation', () => {
  assert.equal(validateReading(null, null).ok, false);
  assert.equal(validateReading({ price: -5 }, null).ok, false);
  assert.equal(validateReading({ price: 1e9 }, null).ok, false);
  assert.equal(validateReading({ price: 1000 }, { last_price: 1100 }).ok, true);

  const v = validateReading({ price: 10 }, { last_price: 1000 });
  assert.equal(v.ok, false);
  assert.equal(v.needsConfirmation, true);
});
