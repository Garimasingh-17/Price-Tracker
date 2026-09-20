import { config } from '../config.js';
import { log } from '../lib/logger.js';

let chromium = null;
let browserPromise = null;

async function loadPlaywright() {
  if (chromium) return chromium;

  try {
    ({ chromium } = await import('playwright'));
    return chromium;
  } catch {
    throw new Error(
      'Playwright is not installed. Install it (npm i playwright && npx playwright install chromium) ' +
      'or set USE_BROWSER_FALLBACK=false.'
    );
  }
}

/** One shared headless browser per process; cheaper than launching per product. */
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const c = await loadPlaywright();

      return c.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
    })().catch((e) => {
      browserPromise = null;
      throw e;
    });
  }

  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;

  try {
    const b = await browserPromise;
    await b.close();
  } catch {
    /* ignore */
  }

  browserPromise = null;
}

/**
 * Render a page and return its HTML after the price interaction.
 */
export async function renderPage(url, opts = {}) {
  const {
    headed = false,
    slowMo = 0,
    timeoutMs = config.scrape.browserTimeoutMs,
    chaos = null,
    onEvent = () => { },
  } = opts;

  const startedAt = Date.now();

  let browser;
  let ownBrowser = false;

  if (headed) {
    const c = await loadPlaywright();

    browser = await c.launch({
      headless: false,
      slowMo,
    });

    ownBrowser = true;
  } else {
    browser = await getBrowser();
  }

  const context = await browser.newContext({
    viewport: {
      width: 1280,
      height: 900,
    },

    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // Skip images/media/fonts in headless mode.
    if (!headed) {
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();

        if (['image', 'media', 'font'].includes(type)) {
          return route.abort();
        }

        return route.continue();
      });
    }

    // Chaos testing support.
    if (chaos) {
      await page.route('**/*', async (route) => {
        const isDoc = ['document', 'xhr', 'fetch'].includes(
          route.request().resourceType()
        );

        if (isDoc && Math.random() < (chaos.failRate ?? 0)) {
          onEvent({
            type: 'chaos_fail',
            url: route.request().url(),
          });

          return route.fulfill({
            status: 503,
            body: 'Service Unavailable (injected)',
          });
        }

        if (isDoc && chaos.delayMs) {
          onEvent({
            type: 'chaos_delay',
            ms: chaos.delayMs,
          });

          await new Promise((r) => setTimeout(r, chaos.delayMs));
        }

        return route.continue();
      });
    }

    // Navigate.
    onEvent({
      type: 'navigate',
      url,
    });

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });

    const status = response?.status() ?? 0;

    onEvent({
      type: 'response',
      status,
    });

    if (status && status >= 400) {
      const err = new Error(
        `HTTP ${status} while rendering ${url}`
      );

      err.kind = 'http_error';
      err.status = status;

      throw err;
    }

    // ---------------------------------------------------------
    // REMOVE COOKIE OVERLAY
    // ---------------------------------------------------------

    try {
      const cookieOverlay = page.locator('.cookie-overlay');

      if ((await cookieOverlay.count()) > 0) {
        await cookieOverlay.evaluateAll((elements) => {
          elements.forEach((el) => el.remove());
        });

        onEvent({
          type: 'cookie_overlay_removed',
        });
      }
    } catch (err) {
      onEvent({
        type: 'cookie_overlay_remove_failed',
        error: err.message,
      });
    }

    // ---------------------------------------------------------
    // REVEAL PRICE
    // ---------------------------------------------------------

    try {
      const revealBtn = page
        .locator('button[aria-label="Reveal price"]')
        .first();

      const priceBlock = page
        .locator('.price-block')
        .first();

      await revealBtn.waitFor({
        state: 'visible',
        timeout: 10000,
      });

      await priceBlock.waitFor({
        state: 'visible',
        timeout: 10000,
      });

      onEvent({
        type: 'reveal_block_found',
      });

      // Remove cookie overlay again in case it came back.
      await page
        .locator('.cookie-overlay')
        .evaluateAll((elements) => {
          elements.forEach((el) => el.remove());
        })
        .catch(() => { });

      const box = await priceBlock.boundingBox();

      if (!box) {
        throw new Error(
          'Could not get price block bounding box'
        );
      }

      // Simulate mouse interaction with price area.
      for (let i = 0; i < 12; i++) {
        await page.mouse.move(
          box.x + 20 + i * 8,
          box.y + 20 + (i % 3) * 8
        );

        await page.waitForTimeout(70);
      }

      await page.waitForTimeout(800);

      const disabled = await revealBtn.isDisabled();

      onEvent({
        type: 'reveal_button_state',
        disabled,
      });

      if (disabled) {
        throw new Error(
          'Reveal price button is still disabled'
        );
      }

      // Click Reveal Price.
      onEvent({
        type: 'reveal_click',
      });

      await revealBtn.click({
        timeout: 5000,
        force: true,
      });

      onEvent({
        type: 'reveal_clicked',
      });

      // Give page JavaScript time to reveal the price.
      await page.waitForTimeout(2500);

      // -------------------------------------------------------
      // DIAGNOSTIC: PRICE BLOCK AFTER CLICK
      // -------------------------------------------------------

      const priceBlockAfterClick = await page
        .locator('.price-block')
        .first()
        .evaluate((el) => ({
          className: el.className,
          text: el.innerText,
          html: el.innerHTML,
        }))
        .catch(() => null);

      onEvent({
        type: 'price_block_after_click',
        priceBlockAfterClick,
      });

      // -------------------------------------------------------
      // DIAGNOSTIC: PRICE FOUND IN HTML
      // -------------------------------------------------------

      const htmlAfterClick = await page.content();

      const priceMatch = htmlAfterClick.match(
        /(?:₹|Rs\.?|INR|\$|€|£)\s*[\d,]+(?:\.\d{1,2})?/
      );

      onEvent({
        type: 'price_after_click',
        price: priceMatch ? priceMatch[0] : null,
      });

      // -------------------------------------------------------
      // FLEXIBLE PRICE WAIT
      // -------------------------------------------------------
      //
      // IMPORTANT:
      // We DO NOT wait for:
      //
      // .price-block.price-success .price-current
      //
      // because that selector was causing the 15-second timeout.
      //
      // Instead, check whether any price exists in the page or
      // inside the price block.
      // -------------------------------------------------------

      await page
        .waitForFunction(
          () => {
            const body =
              document.body?.innerText || '';

            const block =
              document.querySelector('.price-block');

            const blockText =
              block?.innerText || '';

            const priceRegex =
              /(?:₹|Rs\.?|INR|\$|€|£)\s*[\d,]+(?:\.\d{1,2})?/;

            const blockHasPrice =
              priceRegex.test(blockText);

            const bodyHasPrice =
              priceRegex.test(body);

            const successClass =
              !!block &&
              block.classList.contains('price-success');

            return (
              blockHasPrice ||
              successClass ||
              bodyHasPrice
            );
          },
          undefined,
          {
            timeout: Math.min(timeoutMs, 5000),
          }
        )
        .catch((err) => {
          // Do not fail the whole scrape if the demo site's
          // CSS classes don't match our expected selector.
          onEvent({
            type: 'price_shape_wait_skipped',
            error: err.message,
          });
        });

      onEvent({
        type: 'price_revealed',
      });
    } catch (err) {
      onEvent({
        type: 'reveal_failed',
        error: err.message,
      });

      throw err;
    }

    // Small final wait for asynchronous DOM updates.
    await page.waitForTimeout(500);

    const html = await page.content();

    return {
      html,
      status,
      durationMs: Date.now() - startedAt,
      url: page.url(),
    };
  } finally {
    await page.close().catch(() => { });
    await context.close().catch(() => { });

    if (ownBrowser) {
      await browser.close().catch(() => { });
    }
  }
}

export async function renderWithRetry(url, opts = {}) {
  const maxAttempts =
    opts.maxAttempts ??
    Math.min(config.scrape.maxAttempts, 3);

  const trail = [];

  let lastErr;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    try {
      const res = await renderPage(url, opts);

      trail.push({
        attempt,
        ok: true,
        status: res.status,
        ms: res.durationMs,
      });

      opts.onAttempt?.({
        attempt,
        ok: true,
        status: res.status,
        ms: res.durationMs,
      });

      return {
        ...res,
        attempts: attempt,
        trail,
      };
    } catch (err) {
      lastErr = err;

      const rec = {
        attempt,
        ok: false,
        kind: err.kind || 'browser_error',
        error: err.message,
      };

      trail.push(rec);

      opts.onAttempt?.(rec);

      log.warn('render_attempt_failed', {
        url,
        ...rec,
      });

      if (attempt === maxAttempts) {
        break;
      }

      const delay =
        1000 * attempt +
        Math.random() * 500;

      opts.onBackoff?.({
        attempt,
        delay,
      });

      await new Promise((r) =>
        setTimeout(r, delay)
      );
    }
  }

  lastErr.attempts = maxAttempts;
  lastErr.trail = trail;

  throw lastErr;
}