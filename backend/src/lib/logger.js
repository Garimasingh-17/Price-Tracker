const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 20;

function emit(level, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const line = { t: new Date().toISOString(), level, msg, ...(meta || {}) };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else console.log(text);
}

export const log = {
  debug: (m, x) => emit('debug', m, x),
  info: (m, x) => emit('info', m, x),
  warn: (m, x) => emit('warn', m, x),
  error: (m, x) => emit('error', m, x),
};

/** Human-readable line for the headed/observable run. */
export function say(symbol, text) {
  process.stdout.write(`${symbol}  ${text}\n`);
}
