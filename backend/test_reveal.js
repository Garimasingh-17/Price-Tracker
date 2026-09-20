import { chromium } from 'playwright';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('requestfailed', req => console.log('REQ FAILED:', req.url(), req.failure()?.errorText));

  console.log('Navigating to product 175...');
  await page.goto('https://demo.inelabteamdev.com/product/175', { waitUntil: 'networkidle' });
  console.log('Title:', await page.title());

  // Find price block
  const block = page.locator('.price-block').first();
  await block.waitFor({ state: 'visible', timeout: 5000 });
  const box = await block.boundingBox();
  console.log('Price block box:', box);

  // Move mouse across the price block to trigger hover & moves
  for (let i = 0; i < 15; i++) {
    await page.mouse.move(box.x + 20 + i * 10, box.y + 20 + (i % 4) * 8);
    await new Promise(r => setTimeout(r, 60));
  }
  await new Promise(r => setTimeout(r, 800));

  const btn = page.locator('button:has-text("Reveal price")').first();
  const isDisabled = await btn.isDisabled();
  console.log('Is Reveal button disabled after hover?', isDisabled);

  if (!isDisabled) {
    console.log('Clicking button with real mouse click...');
    await btn.click();
    console.log('Clicked. Waiting for quote to render...');
    
    // Wait for the price block to transition from loading to success or error
    await page.waitForFunction(() => {
      const el = document.querySelector('.price-block');
      return el && !el.classList.contains('price-idle') && !el.querySelector('.spinner');
    }, null, { timeout: 15000 }).catch(e => console.log('Wait timeout:', e.message));

    const blockText = await page.locator('.price-block').innerText();
    console.log('Price block innerText:\n', blockText);

    const fullHtml = await page.locator('.price-block').innerHTML();
    console.log('Price block innerHTML:\n', fullHtml);
  }

  await browser.close();
}

main().catch(console.error);
