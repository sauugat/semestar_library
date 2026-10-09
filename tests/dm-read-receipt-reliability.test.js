'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../mobile/node_modules/typescript');

function loadService(file, imports = {}) {
  const code = fs.readFileSync(path.join(__dirname, '../mobile/services', file), 'utf8');
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => imports[name], module, module.exports);
  return module.exports;
}

const dmState = loadService('dm-state.ts');
const {
  createReadCoalescer,
  compareMessageCursors,
  isCursorNewer,
  getConversationReadCoalescer,
  clearConversationReadCoalescer,
} = dmState;

test('M2.2 - 1. Repeated scroll events do not generate duplicate read requests', async () => {
  let networkCalls = 0;
  const requestedIds = [];
  const coalescer = createReadCoalescer(async (id) => {
    networkCalls++;
    requestedIds.push(id);
  }, 10);

  // Simulate 50 rapid scroll events near bottom with message ID 42
  for (let i = 0; i < 50; i++) {
    coalescer.request(42);
  }

  await coalescer.flush();

  assert.equal(networkCalls, 1, 'Only 1 network request should be sent for 50 rapid scroll events');
  assert.deepEqual(requestedIds, [42]);
  assert.equal(coalescer.getLastAcknowledged(), 42);

  // Subsequent scroll events after acknowledgement must send 0 requests
  for (let i = 0; i < 20; i++) {
    coalescer.request(42);
  }
  await coalescer.flush();
  assert.equal(networkCalls, 1, 'Subsequent scrolls after acknowledgement must send 0 requests');
  coalescer.stop();
});

test('M2.2 - 2. Rerendering the composer does not resubmit an unchanged cursor', async () => {
  let networkCalls = 0;
  const coalescer = createReadCoalescer(async () => {
    networkCalls++;
  }, 10, { initialAcknowledged: 100 });

  // Simulate 15 component rerenders (keystrokes in composer, state updates) where newest message is still 100
  for (let i = 0; i < 15; i++) {
    coalescer.request(100);
  }

  await coalescer.flush();
  assert.equal(networkCalls, 0, 'No network requests should be sent when cursor is unchanged');
  coalescer.stop();
});

test('M2.2 - 3. Opening an already-read conversation does not cause a request storm', async () => {
  let networkCalls = 0;
  // Opening conversation with messages up to 250 already read according to server cache
  const coalescer = createReadCoalescer(async () => {
    networkCalls++;
  }, 10, { initialAcknowledged: 250 });

  // Message history returns messages [250, 249, 248...]
  const messages = [{ id: 250 }, { id: 249 }, { id: 248 }];
  for (const m of messages) {
    coalescer.request(m.id);
  }

  await coalescer.flush();
  assert.equal(networkCalls, 0, 'Opening already-read conversation must generate exactly 0 network requests');
  assert.equal(coalescer.getLastAcknowledged(), 250);
  coalescer.stop();
});

test('M2.2 - 4. A newly eligible message advances the read cursor correctly', async () => {
  const sent = [];
  const coalescer = createReadCoalescer(async (id) => {
    sent.push(id);
  }, 10, { initialAcknowledged: 50 });

  // New message arrives: 51
  coalescer.request(51);
  await coalescer.flush();
  assert.deepEqual(sent, [51]);
  assert.equal(coalescer.getLastAcknowledged(), 51);

  // Rapid burst of new messages: 52, 53, 54
  coalescer.request(52);
  coalescer.request(53);
  coalescer.request(54);
  await coalescer.flush();

  // Coalesced into a single request for the latest eligible cursor 54
  assert.deepEqual(sent, [51, 54]);
  assert.equal(coalescer.getLastAcknowledged(), 54);
  coalescer.stop();
});

test('M2.2 - 5. Failed requests can be retried safely with bounded backoff and newer cursor replacement', async () => {
  let attempts = 0;
  const attemptsLog = [];
  let shouldFail = true;

  const coalescer = createReadCoalescer(async (id) => {
    attempts++;
    attemptsLog.push(id);
    if (shouldFail) {
      const err = new Error('Network timeout (503)');
      err.status = 503;
      throw err;
    }
  }, 5, { maxRetries: 3 });

  // Request cursor 10
  coalescer.request(10);

  // First attempt fails
  await new Promise(r => setTimeout(r, 20));
  assert.equal(attemptsLog.length >= 1, true);
  assert.equal(coalescer.getLastAcknowledged(), 0, 'Cursor must not be acknowledged on failure');

  // While pending retry, a newer message 15 arrives
  coalescer.request(15);
  shouldFail = false;

  // Next retry sends the newer cursor 15 instead of stale 10
  await new Promise(r => setTimeout(r, 60));
  assert.equal(coalescer.getLastAcknowledged(), 15, 'Latest cursor must be acknowledged after retry succeeds');
  assert.equal(attemptsLog.includes(15), true, 'Retry must advance to the newer cursor');
  coalescer.stop();
});

test('M2.2 - 6. Realtime echoes do not create repeated read requests', async () => {
  let networkCalls = 0;
  const coalescer = createReadCoalescer(async (id) => {
    networkCalls++;
  }, 10);

  // Incoming message 80 read
  coalescer.request(80);
  await coalescer.flush();
  assert.equal(networkCalls, 1);
  assert.equal(coalescer.getLastAcknowledged(), 80);

  // Server broadcasts echo of read receipt: { lastReadMessageId: 80 }
  coalescer.setAcknowledged(80);

  // Realtime echo or subsequent update triggers check again
  coalescer.request(80);
  await coalescer.flush();

  assert.equal(networkCalls, 1, 'Realtime echo of own read receipt must not trigger network request');
  coalescer.stop();
});

test('M2.2 - 7. Background conversations do not send inappropriate read acknowledgements', async () => {
  let networkCalls = 0;
  const coalescer = createReadCoalescer(async () => {
    networkCalls++;
  }, 10);

  // Simulate conversation backgrounded / screen blurred
  coalescer.stop();

  // Messages downloaded in background
  coalescer.request(99);
  coalescer.request(100);

  await new Promise(r => setTimeout(r, 30));
  assert.equal(networkCalls, 0, 'Stopped / backgrounded coalescer must send 0 read requests');

  // Returning to foreground
  coalescer.start();
  await coalescer.flush();
  assert.equal(networkCalls, 1, 'Resuming foreground sends coalesced read request for latest cursor');
  assert.equal(coalescer.getLastAcknowledged(), 100);
  coalescer.stop();
});

test('M2.2 - 8. Conversation switching isolates cursors', async () => {
  clearConversationReadCoalescer();

  const conv1Calls = [];
  const conv2Calls = [];

  const coalescer1 = getConversationReadCoalescer('conv-alpha', async (id) => {
    conv1Calls.push(id);
  }, 5);

  const coalescer2 = getConversationReadCoalescer('conv-beta', async (id) => {
    conv2Calls.push(id);
  }, 5);

  // In conv-alpha, read up to 10
  coalescer1.request(10);
  await coalescer1.flush();
  assert.deepEqual(conv1Calls, [10]);
  assert.equal(coalescer1.getLastAcknowledged(), 10);
  assert.equal(coalescer2.getLastAcknowledged(), 0, 'Conv-beta must not be affected by conv-alpha');

  // In conv-beta, read up to 20
  coalescer2.request(20);
  await coalescer2.flush();
  assert.deepEqual(conv2Calls, [20]);
  assert.equal(coalescer2.getLastAcknowledged(), 20);

  // Switch back to conv-alpha: retrieve cached coalescer
  const reloaded1 = getConversationReadCoalescer('conv-alpha', async (id) => {
    conv1Calls.push(id);
  }, 5);

  assert.equal(reloaded1.getLastAcknowledged(), 10, 'Reloaded conv-alpha must preserve acknowledged cursor');
  reloaded1.request(10);
  await reloaded1.flush();
  assert.deepEqual(conv1Calls, [10], 'No duplicate request on re-entry');

  clearConversationReadCoalescer();
});

test('M2.2 - 9. Cohort read receipts remain correct and coalesce rapid events', async () => {
  let cohortNetworkCalls = 0;
  const cohortCursors = [];

  // Cohort group chat coalescer instance
  const cohortCoalescer = createReadCoalescer(async (id) => {
    cohortNetworkCalls++;
    cohortCursors.push(id);
  }, 10, { initialAcknowledged: 300 });

  // 10 reactions, 5 typing updates, and 3 scroll events with confirmed newest 305
  for (let i = 0; i < 18; i++) {
    cohortCoalescer.request(305);
  }

  await cohortCoalescer.flush();

  assert.equal(cohortNetworkCalls, 1, 'Rapid cohort chat events coalesced into exactly 1 network call');
  assert.deepEqual(cohortCursors, [305]);
  assert.equal(cohortCoalescer.getLastAcknowledged(), 305);
  cohortCoalescer.stop();
});

test('M2.2 - 10. Permanent authorization failures (401, 403, 404) stop retrying immediately', async () => {
  let attempts = 0;
  const coalescer = createReadCoalescer(async () => {
    attempts++;
    const err = new Error('Forbidden: Not a participant');
    err.status = 403;
    throw err;
  }, 5, { maxRetries: 5 });

  coalescer.request(77);

  await new Promise(r => setTimeout(r, 50));

  // Must not retry indefinitely on 403
  assert.equal(attempts, 1, 'Permanent authorization error must stop retrying immediately');
  assert.equal(coalescer.getLastAcknowledged(), 0);
  coalescer.stop();
});

test('M2.2 - Controlled Network Traffic Comparison: Naive vs Coalesced', async () => {
  // Scenario: A user receives 10 messages, scrolls 30 times, and composer re-renders 20 times.
  let naiveRequestCount = 0;
  let coalescedRequestCount = 0;

  // 1. Naive uncoalesced approach (previous behavior in chat / dm without gating)
  for (let i = 1; i <= 10; i++) {
    naiveRequestCount++; // on each message arrival
    for (let s = 0; s < 3; s++) naiveRequestCount++; // on scroll
    for (let r = 0; r < 2; r++) naiveRequestCount++; // on render / composer
  }
  // Total naive requests = 10 + 30 + 20 = 60 requests!

  // 2. Coalesced approach
  const coalescer = createReadCoalescer(async () => {
    coalescedRequestCount++;
  }, 5);

  for (let i = 1; i <= 10; i++) {
    coalescer.request(i);
    for (let s = 0; s < 3; s++) coalescer.request(i);
    for (let r = 0; r < 2; r++) coalescer.request(i);
  }

  await coalescer.flush();
  coalescer.stop();

  assert.equal(naiveRequestCount, 60, 'Naive pattern generates 60 requests');
  assert.equal(coalescedRequestCount, 1, 'Coalesced pattern generates 1 request');
  const reductionPercentage = ((naiveRequestCount - coalescedRequestCount) / naiveRequestCount) * 100;
  assert.ok(reductionPercentage >= 98, `Network request reduction must be >= 98%, got ${reductionPercentage.toFixed(1)}%`);
});
