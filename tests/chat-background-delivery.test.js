'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deferDelivery } = require('../lib/background-delivery');
const { fixture } = require('./helpers/cohort-fixture');
const { createProductionCohortRuntime } = require('../lib/cohort-chat-runtime');

test('delivery registers its promise before the request returns and contains provider failures', async () => {
  let registered, calls = 0, warnings = 0;
  const work = deferDelivery(async () => { calls++; throw Error('provider down'); }, {
    register: promise => { registered = promise; }, warn: () => { warnings++; },
  });
  assert.equal(registered, work); assert.equal(calls, 0);
  await work;
  assert.equal(calls, 1); assert.equal(warnings, 1);
});

test('cohort persistence and same-key retry finish while the delivery provider is stalled', async t => {
  const f = await fixture('sqlite'); t.after(f.close);
  const rooms = await f.seed();
  await f.service.syncProjection(rooms.MERCURY.chatGroupId);
  const jobs = [];
  const runtime = createProductionCohortRuntime(f.db, {
    providers: f.providers,
    deferDelivery: operation => { jobs.push(operation); return Promise.resolve(); },
  });
  const sent = await runtime.service.send('m1', { clientId: 'background-send', text: 'saved before delivery' });
  assert.equal((await f.service.history('m2')).messages[0].id, sent.messageId);
  assert.equal(f.broadcasts.length, 0);
  const retry = await runtime.service.send('m1', { clientId: 'background-send', text: 'saved before delivery' });
  assert.equal(retry.messageId, sent.messageId); assert.equal(retry.duplicate, true);
  assert.equal(jobs.length, 2, 'each request retains the shared delivery promise');
  await assert.rejects(runtime.service.send('v1', { chatGroupId: rooms.MERCURY.chatGroupId, clientId: 'wrong-room', text: 'blocked' }), { status: 404 });
  await jobs[0]();
  assert.equal(f.broadcasts.filter(event => event.event === 'new_message').length, 1);
});
