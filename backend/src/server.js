import express from 'express';
import cors from 'cors';
import { config, assertConfig } from './config.js';
import { api } from './routes/api.js';
import { cron } from './routes/cron.js';
import { log } from './lib/logger.js';

assertConfig();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

app.use(
  cors({
    origin(origin, cb) {
      // No origin: curl, cron services, server-to-server. Allow.
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      // Allow any Vercel preview deployment of this project.
      if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return cb(null, true);
      return cb(new Error(`Origin not allowed: ${origin}`));
    },
  })
);

app.get('/', (_req, res) =>
  res.json({
    service: 'ine-price-tracker',
    store: config.store.baseUrl,
    scheduleMinutes: config.scrape.intervalMinutes,
    docs: ['/healthz', '/api/store/search?q=', '/api/products', '/api/cron/scrape'],
  })
);

app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.use('/api', api);
app.use('/api/cron', cron);

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  log.error('request_failed', { error: err.message });
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong.' });
});

const server = app.listen(config.port, () =>
  log.info('server_started', { port: config.port, env: config.env, store: config.store.baseUrl })
);

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log.info('shutting_down', { sig });
    server.close(() => process.exit(0));
  });
}

// A crash inside an async scrape must not take the whole service down.
process.on('unhandledRejection', (reason) =>
  log.error('unhandled_rejection', { reason: String(reason) })
);
