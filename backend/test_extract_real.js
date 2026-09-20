import { extractFromHtml } from './src/scraper/extract.js';

const html = `
<div class="price-block">
  <div class="price-main">
    <span class="price-value" aria-hidden="true" style="display: none;">₹1,10,636</span>
    <span class="mr-z6" style="text-decoration: line-through; opacity: 0.55; margin-right: 10px;">₹1,76,537</span>
    <span class="vxlnbjp pv-z6" style="font-family: var(--serif); font-size: 2.4rem; font-weight: 700; letter-spacing: -0.02em; opacity: 1;">₹1 20 045</span>
    <span class="bd-z6" style="margin-left: 10px; color: rgb(47, 133, 90); font-weight: 600;">24% off</span>
    <span class="amount" data-price="true" aria-hidden="true" style="display: none;">₹1,26,541</span>
  </div>
  <div class="price-facets">
    <div class="st-z6"><span class="stock-badge in-stock">Hurry, just 14 left</span></div>
  </div>
</div>
`;

const result = extractFromHtml(html, { baseUrl: 'https://demo.inelabteamdev.com/product/175' });
console.log('Extract result:', JSON.stringify(result, null, 2));
