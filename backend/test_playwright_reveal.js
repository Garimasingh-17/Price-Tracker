import { chromium } from 'playwright';

async function testPlaywrightReveal() {
  console.log('Launching chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to product 175...');
  await page.goto('https://demo.inelabteamdev.com/product/175', { waitUntil: 'domcontentloaded' });

  // Remove or dismiss any cookie banner
  await page.evaluate(() => {
    document.querySelectorAll('.cookie-overlay').forEach(el => el.remove());
  });

  const btn = page.locator('button:has-text("Reveal price")').first();
  await btn.waitFor({ state: 'visible', timeout: 8000 });

  const block = page.locator('.price-block').first();
  const box = await block.boundingBox();
  console.log('Bounding box:', box);

  // Hover and perform moves spaced > 45ms apart
  console.log('Simulating realistic mouse movements across price-block...');
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(box.x + 30 + i * 8, box.y + 25 + (i % 3) * 5);
    await new Promise(r => setTimeout(r, 65));
  }
  await new Promise(r => setTimeout(r, 750));

  // Check again for cookie overlay and remove if it popped up late
  await page.evaluate(() => {
    document.querySelectorAll('.cookie-overlay').forEach(el => el.remove());
  });

  const isDisabled = await btn.isDisabled();
  console.log('Is Reveal button disabled?', isDisabled);

  if (!isDisabled) {
    console.log('Clicking Reveal price button...');
    await btn.click();
    console.log('Clicked! Waiting for price to render...');

    // Wait until .price-block has .price-success or has a currency symbol
    await page.waitForFunction(() => {
      const el = document.querySelector('.price-block');
      return el && (el.classList.contains('price-success') || el.classList.contains('price-error'));
    }, null, { timeout: 15000 });

    const html = await page.locator('.price-block').innerHTML();
    console.log('Revealed Price Block HTML:\n', html);
  } else {
    console.log('Button was still disabled! Substatus:', await page.locator('.price-substatus').innerText());
  }

  await browser.close();
}

testPlaywrightReveal().catch(console.error);
