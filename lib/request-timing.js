'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const context = new AsyncLocalStorage();
async function measure(name, operation) {
  const store = context.getStore();
  if (!store) return operation();
  const start = performance.now();
  try { return await operation(); } finally {
    store[name] = (store[name] || 0) + performance.now() - start;
    if (name === 'db') store.queries = (store.queries || 0) + 1;
  }
}
function messagingTiming(req, res, next) {
  if (!/^\/api\/(dm(?:\/|-status)|chat(?:\/|$))/.test(req.path)) return next();
  const store = { start: performance.now(), id: randomUUID() };
  res.setHeader('X-Request-ID', store.id);
  const end = res.end;
  res.end = function (...args) {
    if (!res.headersSent) {
      const metrics = ['auth', 'db', 'pool', 'tx', 'external', 'jwt'].filter(k => store[k] !== undefined)
        .map(k => `${k};dur=${store[k].toFixed(1)}`);
      metrics.push(`total;dur=${(performance.now() - store.start).toFixed(1)}`);
      metrics.push(`queries;desc="${store.queries || 0}"`);
      res.setHeader('Server-Timing', metrics.join(', '));
    }
    return end.apply(this, args);
  };
  context.run(store, next);
}
module.exports = { measure, messagingTiming };
