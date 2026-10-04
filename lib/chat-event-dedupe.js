'use strict';
// Consumer contract utility; integration into mobile/web is intentionally later.
// Persist processed IDs with client cache transactions for dedupe across restarts.
function createEventConsumer({ has, applyAndRemember }) {
  let queue = Promise.resolve();
  return event => {
    const operation = queue.then(async () => {
      if (!event || typeof event.eventId !== 'string' || !event.eventId) throw new Error('Missing eventId');
      if (await has(event.eventId)) return false;
      await applyAndRemember(event); // State update + remembering ID must be atomic.
      return true;
    });
    queue = operation.catch(() => {});
    return operation;
  };
}
module.exports = { createEventConsumer };
