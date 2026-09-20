import { Router } from 'express';
import { config } from '../config.js';
import { runCycle } from '../scraper/runner.js';
import { log } from '../lib/logger.js';

export const cron = Router();

/**
 * cron-job.org hits this every 2 hours with the shared secret in a header.
 * GET is allowed too, because some free cron services only send GET.
 */
function authorise(req, res) {
  if (!config.cronSecret) {
    res.status(500).json({ error: 'CRON_SECRET is not configured on the server.' });
    return false;
  }
  const supplied =
    req.get('x-cron-secret') ||
    req.query.secret ||
    (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (supplied !== config.cronSecret) {
    log.warn('cron_unauthorised', { ip: req.ip });
    res.status(401).json({ error: 'Invalid or missing cron secret.' });
    return false;
  }
  return true;
}

let running = false;

async function handler(req, res) {
  if (!authorise(req, res)) return;

  // A slow cycle plus an eager cron must not stack up into overlapping runs.
  if (running) {
    log.warn('cron_overlap_skipped');
    return res.status(409).json({ skipped: true, reason: 'A scrape cycle is already running.' });
  }

  running = true;
  try {
    const summary = await runCycle();
    res.json(summary);
  } catch (err) {
    log.error('cron_cycle_error', { error: err.message });
    res.status(500).json({ error: err.message });
  } finally {
    running = false;
  }
}

cron.post('/scrape', handler);
cron.get('/scrape', handler);

/** Keep-warm ping for the Render free tier. Cheap and does no work. */
cron.get('/ping', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));
