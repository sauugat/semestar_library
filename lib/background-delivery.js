'use strict';
const { waitUntil } = require('@vercel/functions');

// Register work while the request context is alive. A timer alone cannot keep a
// serverless invocation alive after its response. Durable outboxes own retries.
function deferDelivery(operation, { register = waitUntil, warn = console.warn } = {}) {
  const work = Promise.resolve().then(operation).catch(error => {
    warn('[chat-delivery] Deferred; durable outbox will retry.', error.code || error.name || 'Error');
  });
  try { register(work); } catch { warn('[chat-delivery] Background registration unavailable.'); }
  return work;
}
module.exports = { deferDelivery };
