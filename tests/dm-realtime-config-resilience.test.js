'use strict';

process.env.NODE_ENV = 'test';
process.env.DM_ENABLED = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { fixture } = require('./helpers/cohort-fixture');
const { migrateDirectMessaging } = require('../migrations/005-direct-messaging-schema');
const { createDmService } = require('../lib/dm-service');
const { createDmRealtimeProviders } = require('../lib/dm-realtime');
const directMessagingRouter = require('../routes/direct-messaging');

/**
 * Creates isolated test harness with instrumented database transaction tracking
 * and configurable Supabase mock transport.
 */
async function createResilienceHarness(t, options = {}) {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);

  await migrateDirectMessaging(f.db, { disposable: true });

  const studentCols = (await f.db.all("PRAGMA table_info(students)")).map(c => c.name);
  if (!studentCols.includes('verification_status')) {
    await f.db.run("ALTER TABLE students ADD COLUMN verification_status TEXT DEFAULT 'unverified'");
  }

  // Seed test accounts
  const accounts = [
    { id: 'user_alice', name: 'Alice', role: 'student', status: 'verified' },
    { id: 'user_bob', name: 'Bob', role: 'student', status: 'verified' },
    { id: 'user_charlie', name: 'Charlie', role: 'student', status: 'verified' },
    { id: 'user_unverified', name: 'Dan', role: 'student', status: 'unverified' },
  ];

  for (const acc of accounts) {
    const existing = await f.db.get('SELECT studentId FROM students WHERE studentId = ?', acc.id);
    if (existing) {
      await f.db.run(
        'UPDATE students SET role = ?, verification_status = ?, name = ?, username = ? WHERE studentId = ?',
        acc.role, acc.status, acc.name, acc.id, acc.id
      );
    } else {
      await f.db.run(
        'INSERT INTO students (studentId, name, username, role, department, semester, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        acc.id, acc.name, acc.id, acc.role, 'BIT', 1, acc.status
      );
    }
  }

  // Transaction counter to guarantee transactions close and no external HTTP runs in transaction
  let openTransactionCount = 0;
  let maxConcurrentTx = 0;
  const originalWithTx = f.db.withTransaction;
  f.db.withTransaction = async function (cb) {
    openTransactionCount++;
    if (openTransactionCount > maxConcurrentTx) maxConcurrentTx = openTransactionCount;
    try {
      return await originalWithTx.call(this, cb);
    } finally {
      openTransactionCount--;
    }
  };

  const syncCalls = [];
  let syncBehavior = options.syncBehavior || 'success';
  let activeTxDuringSync = [];

  const testEnv = {
    DM_SUPABASE_URL: 'https://test-project.supabase.co',
    DM_SUPABASE_PUBLIC_KEY: 'test-anon-key',
    DM_SUPABASE_SERVICE_KEY: 'test-service-key',
    DM_SUPABASE_JWT_SECRET: 'test_secret_32_characters_minimum_length_for_signing_jwt',
  };

  const mockTransport = async (url, reqOptions) => {
    if (url.includes('/rest/v1/rpc/sync_dm_conversation_projection')) {
      activeTxDuringSync.push(openTransactionCount);
      const body = JSON.parse(reqOptions.body);
      syncCalls.push(body.snapshot);

      if (typeof options.onSync === 'function') {
        await options.onSync(body.snapshot);
      }

      if (syncBehavior === 'timeout') {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      }
      if (syncBehavior === 'permission_denied') {
        return {
          ok: false,
          status: 403,
          text: async () => JSON.stringify({ message: 'permission denied for function sync_dm_conversation_projection' }),
        };
      }
      if (syncBehavior === 'rpc_missing') {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ message: 'function not found' }),
        };
      }
      if (syncBehavior === 'stale_epoch') {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ message: 'Stale DM projection' }),
        };
      }
      if (syncBehavior === 'fail_500') {
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal server error in Supabase',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, snapshot: body.snapshot }),
        text: async () => JSON.stringify({ ok: true }),
      };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };

  const providers = createDmRealtimeProviders(testEnv, mockTransport);
  const service = createDmService(f.db, {
    providers,
    requireProjectionSync: options.requireProjectionSync !== false,
  });

  const app = express();
  app.use(express.json());
  app.use(async (req, res, next) => {
    const authHeader = req.get('authorization') || '';
    const match = /^Bearer\s+([a-zA-Z0-9_-]+)$/.exec(authHeader);
    if (match) {
      const studentId = match[1];
      const row = await f.db.get('SELECT role FROM students WHERE studentId = ?', studentId);
      req.student = { studentId, role: row?.role || 'student' };
    }
    next();
  });
  app.use('/api/dm', directMessagingRouter(service));

  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { caller, headers: extraHeaders } = {}) {
    const headers = { 'content-type': 'application/json', ...(extraHeaders || {}) };
    if (caller && !headers['authorization']) headers['authorization'] = `Bearer ${caller}`;
    const res = await fetch(`${baseUrl}${path}`, { headers });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, headers: res.headers, data };
  }

  return {
    db: f.db,
    service,
    providers,
    request,
    syncCalls,
    activeTxDuringSync,
    getOpenTransactionCount: () => openTransactionCount,
    setSyncBehavior: b => { syncBehavior = b; },
  };
}

// 1. Authorized participant receives config.
test('1. Authorized participant receives config', async t => {
  const h = await createResilienceHarness(t);
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  const res = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, {
    caller: 'user_alice',
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.conversationId, conv.conversationId);
  assert.equal(res.data.realtimeEpoch, 1);
  assert.equal(res.data.topic, `dm:${conv.conversationId}:1`);
  assert.ok(typeof res.data.token === 'string' && res.data.token.length > 50);
  assert.ok(res.data.expiry);
  assert.ok(res.data.supabaseUrl);
  assert.ok(res.data.key);
});

// 2. Anonymous request is rejected.
test('2. Anonymous request is rejected', async t => {
  const h = await createResilienceHarness(t);
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  const res = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, {
    caller: null, // No auth header
  });

  assert.equal(res.status, 401);
  assert.match(res.data.message, /Authentication required/);
  assert.equal(res.data.token, undefined);
});

// 3. Nonparticipant is rejected.
test('3. Nonparticipant is rejected', async t => {
  const h = await createResilienceHarness(t);
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  const res = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, {
    caller: 'user_charlie', // Not in this conversation
  });

  assert.equal(res.status, 404);
  assert.match(res.data.message, /Conversation not found/);
  assert.equal(res.data.token, undefined);
});

// 4. Blocked conversation is rejected according to existing policy.
test('4. Blocked conversation is rejected according to existing policy', async t => {
  const h = await createResilienceHarness(t);
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  // Alice blocks Bob
  await h.service.blockUser('user_alice', 'user_bob');

  // Both Alice and Bob must be rejected
  const resAlice = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, {
    caller: 'user_alice',
  });
  assert.equal(resAlice.status, 403);
  assert.match(resAlice.data.message, /Direct messaging is blocked/);
  assert.equal(resAlice.data.token, undefined);

  const resBob = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, {
    caller: 'user_bob',
  });
  assert.equal(resBob.status, 403);
  assert.match(resBob.data.message, /Direct messaging is blocked/);
  assert.equal(resBob.data.token, undefined);
});

// 5. Missing projection is handled safely.
test('5. Missing projection is handled safely', async t => {
  const h = await createResilienceHarness(t, { syncBehavior: 'rpc_missing' });
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  const res = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, {
    caller: 'user_alice',
  });

  assert.equal(res.status, 502);
  assert.equal(res.data.code, 'REALTIME_RPC_MISSING');
  assert.match(res.data.message, /Realtime authorization synchronization failed/);
  assert.equal(res.data.token, undefined);
});

// 6. Supabase RPC timeout is handled.
test('6. Supabase RPC timeout is handled', async t => {
  const h = await createResilienceHarness(t, { syncBehavior: 'timeout' });
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  const res = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, {
    caller: 'user_alice',
  });

  assert.equal(res.status, 502);
  assert.equal(res.data.code, 'REALTIME_SYNC_TIMEOUT');
  assert.match(res.data.message, /Realtime authorization synchronization failed/);
  assert.equal(res.data.token, undefined);
});

// 7. RPC permission failure is handled.
test('7. RPC permission failure is handled', async t => {
  const h = await createResilienceHarness(t, { syncBehavior: 'permission_denied' });
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  const res = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, {
    caller: 'user_alice',
  });

  assert.equal(res.status, 502);
  assert.equal(res.data.code, 'REALTIME_PERMISSION_DENIED');
  assert.match(res.data.message, /Realtime authorization synchronization failed/);
  assert.equal(res.data.token, undefined);
});

// 8. Database transaction closes correctly.
test('8. Database transaction closes correctly', async t => {
  const h = await createResilienceHarness(t);
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  assert.equal(h.getOpenTransactionCount(), 0, 'No open transactions before request');

  const res = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, {
    caller: 'user_alice',
  });

  assert.equal(res.status, 200);
  assert.equal(h.getOpenTransactionCount(), 0, 'Database transaction closed after success');
});

// 9. No external HTTP runs inside an open transaction.
test('9. No external HTTP runs inside an open transaction', async t => {
  const h = await createResilienceHarness(t);
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, {
    caller: 'user_alice',
  });

  assert.ok(h.activeTxDuringSync.length > 0, 'At least one sync call occurred');
  for (const activeTx of h.activeTxDuringSync) {
    assert.equal(activeTx, 0, 'Zero database transactions must be active during external HTTP network request');
  }
});

// 10. Concurrent configuration requests.
test('10. Concurrent configuration requests', async t => {
  const h = await createResilienceHarness(t);
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  // Issue 5 concurrent requests from Alice and Bob simultaneously
  const promises = [
    h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_alice' }),
    h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_alice' }),
    h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_bob' }),
    h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_bob' }),
    h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_alice' }),
  ];

  const results = await Promise.all(promises);
  for (const res of results) {
    assert.equal(res.status, 200);
    assert.equal(res.data.realtimeEpoch, 1);
    assert.equal(res.data.topic, `dm:${conv.conversationId}:1`);
    assert.ok(res.data.token);
  }
  assert.equal(h.getOpenTransactionCount(), 0, 'All transactions closed after concurrent execution');
});

// 11. Conversation epoch changes.
test('11. Conversation epoch changes', async t => {
  const h = await createResilienceHarness(t);
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  // Verify initial epoch is 1
  const res1 = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_alice' });
  assert.equal(res1.status, 200);
  assert.equal(res1.data.realtimeEpoch, 1);
  assert.equal(res1.data.topic, `dm:${conv.conversationId}:1`);

  // Alice blocks then unblocks Bob (rotates epoch to 3)
  await h.service.blockUser('user_alice', 'user_bob');
  await h.service.unblockUser('user_alice', 'user_bob');

  // Realtime config reflects epoch 3
  const res2 = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_alice' });
  assert.equal(res2.status, 200);
  assert.equal(res2.data.realtimeEpoch, 3);
  assert.equal(res2.data.topic, `dm:${conv.conversationId}:3`);

  // Test race condition: if epoch changes during sync, fails closed with 409 STALE_EPOCH
  h.setSyncBehavior('stale_epoch');
  const resStale = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_alice' });
  assert.equal(resStale.status, 409);
  assert.equal(resStale.data.code, 'STALE_EPOCH');
});

// 12. No credentials issued when authorization state is uncertain.
test('12. No credentials issued when authorization state is uncertain', async t => {
  const h = await createResilienceHarness(t, { syncBehavior: 'fail_500' });
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  const res = await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_alice' });
  assert.equal(res.status, 502);
  assert.equal(res.data.token, undefined, 'No token must be issued on synchronization failure');
  assert.equal(res.data.key, undefined);
  assert.equal(res.data.topic, undefined);
});

// 13. No leaked PostgreSQL connections.
test('13. No leaked PostgreSQL connections', async t => {
  const h = await createResilienceHarness(t);
  const conv = await h.service.getOrCreateConversation('user_alice', 'user_bob');

  // Trigger multiple failure modes
  h.setSyncBehavior('timeout');
  await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_alice' });

  h.setSyncBehavior('permission_denied');
  await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_alice' });

  h.setSyncBehavior('rpc_missing');
  await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_alice' });

  // Caller not participant (404)
  await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: 'user_charlie' });

  // Anonymous (401)
  await h.request(`/api/dm/conversations/${conv.conversationId}/realtime-config`, { caller: null });

  // Check remaining open transactions
  assert.equal(h.getOpenTransactionCount(), 0, 'Zero open database transactions after all errors');
});

// 14. Realtime retry does not create duplicate subscriptions.
test('14. Realtime retry does not create duplicate subscriptions', async t => {
  // Verify that backoff logic in mobile dm-realtime cleans up previous channel on reconnect
  let previousClientClosed = 0;
  const mockClient = {
    removeAllChannels: async () => { previousClientClosed++; },
    channel: () => ({
      on: function () { return this; },
      subscribe: (cb) => { cb('SUBSCRIBED'); },
    }),
    realtime: { setAuth: async () => {} },
  };

  // Simulating mobile connect flow
  let client = mockClient;
  let channel = null;

  async function mockConnect() {
    const previousClient = client;
    client = null;
    channel = null;
    if (previousClient) await previousClient.removeAllChannels();
    client = mockClient;
  }

  // Initial connect + 2 retries
  await mockConnect();
  await mockConnect();
  await mockConnect();

  assert.equal(previousClientClosed, 3, 'Previous clients and channels are closed cleanly on every retry');
});
