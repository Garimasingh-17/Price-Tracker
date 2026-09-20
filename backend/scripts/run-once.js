#!/usr/bin/env node
/**
 * Run one scrape cycle from the command line, exactly as the cron endpoint
 * would. Useful for local testing and for GitHub Actions.
 *
 *   npm run scrape:once
 */
import { runCycle } from '../src/scraper/runner.js';
import { closeBrowser } from '../src/scraper/browser.js';

const summary = await runCycle({
  onEvent: (e) => process.env.VERBOSE && console.log(JSON.stringify(e)),
});
console.log(JSON.stringify(summary, null, 2));
await closeBrowser();
process.exit(summary.failed > 0 && summary.succeeded === 0 ? 1 : 0);
