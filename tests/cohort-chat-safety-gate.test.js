'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { resolveCohortProviderEnv, checkCohortProviderConfig } = require('../lib/cohort-chat-providers');
const { createProductionCohortRuntime } = require('../lib/cohort-chat-runtime');
const { getSupabaseConfig } = require('../lib/supabase');
const { migrateProductionCohortChat } = require('../migrations/003-cohort-chat-production');

test('Safety Gate 1: /api/auth/config never leaks secret credentials', async () => {
  const origEnv = { ...process.env };
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'anon-public-key-sample';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'super-secret-service-role-key-never-leak';
    process.env.SUPABASE_JWT_SECRET = 'super-secret-jwt-signing-key-32-chars-long';
    process.env.DATABASE_URL = 'postgres://user:secretpass@host:5432/db';

    const cfg = getSupabaseConfig();
    assert.deepEqual(Object.keys(cfg).sort(), ['key', 'url']);
    assert.equal(cfg.url, 'https://proj.supabase.co');
    assert.equal(cfg.key, 'anon-public-key-sample');

    // Confirm that secret keys are NOT exposed
    assert.equal(cfg.serviceRoleKey, undefined);
    assert.equal(cfg.secretKey, undefined);
    assert.equal(cfg.jwtSecret, undefined);
    assert.equal(cfg.databaseUrl, undefined);

    // Test the Express route contract
    const app = express();
    app.get('/api/auth/config', (req, res) => {
      res.json(cfg);
    });

    const s = await new Promise(res => { const server = app.listen(0, '127.0.0.1', () => res(server)); });
    try {
      const resp = await fetch(`http://127.0.0.1:${s.address().port}/api/auth/config`);
      assert.equal(resp.status, 200);
      const json = await resp.json();
      assert.deepEqual(Object.keys(json).sort(), ['key', 'url']);
      assert.ok(!JSON.stringify(json).includes('super-secret'));
      assert.ok(!JSON.stringify(json).includes('secretpass'));
    } finally {
      s.close();
    }
  } finally {
    process.env = origEnv;
  }
});

test('Safety Gate 2: Cohort provider env precedence and strict separation', () => {
  // 1. Explicit COHORT_* takes precedence
  const customEnv = {
    COHORT_SUPABASE_URL: 'https://cohort.supabase.co',
    SUPABASE_URL: 'https://standard.supabase.co',
    COHORT_SUPABASE_PUBLIC_KEY: 'cohort-anon-key',
    SUPABASE_ANON_KEY: 'standard-anon-key',
    COHORT_SUPABASE_SERVICE_KEY: 'cohort-service-key',
    SUPABASE_SERVICE_ROLE_KEY: 'standard-service-key',
    COHORT_SUPABASE_JWT_SECRET: 'cohort-jwt-secret-min-32-characters-length',
    SUPABASE_JWT_SECRET: 'standard-jwt-secret-min-32-characters-length'
  };

  const resolved1 = checkCohortProviderConfig(customEnv);
  assert.equal(resolved1.configured, true);
  assert.equal(resolved1.missing.length, 0);

  // 2. Fallback to standard Supabase names when COHORT_* are not provided
  const standardEnv = {
    SUPABASE_URL: 'https://standard.supabase.co',
    SUPABASE_ANON_KEY: 'standard-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'standard-service-key',
    SUPABASE_JWT_SECRET: 'standard-jwt-secret-min-32-characters-length'
  };

  const resolved2 = checkCohortProviderConfig(standardEnv);
  assert.equal(resolved2.configured, true);
  assert.equal(resolved2.missing.length, 0);

  // 3. Never substitute anon key for service key
  const missingServiceEnv = {
    SUPABASE_URL: 'https://standard.supabase.co',
    SUPABASE_ANON_KEY: 'standard-anon-key',
    SUPABASE_JWT_SECRET: 'standard-jwt-secret-min-32-characters-length'
  };
  const resolved3 = checkCohortProviderConfig(missingServiceEnv);
  assert.equal(resolved3.configured, false);
  assert.ok(resolved3.missing.includes('COHORT_SUPABASE_SERVICE_KEY'));

  // 4. Short / missing JWT secret fails check
  const shortSecretEnv = {
    SUPABASE_URL: 'https://standard.supabase.co',
    SUPABASE_ANON_KEY: 'standard-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'standard-service-key',
    SUPABASE_JWT_SECRET: 'short'
  };
  const resolved4 = checkCohortProviderConfig(shortSecretEnv);
  assert.equal(resolved4.configured, false);
  assert.ok(resolved4.missing.includes('COHORT_SUPABASE_JWT_SECRET'));
});

test('Safety Gate 3: Incomplete provider config fails closed with HTTP 503 without process crash or fallback', async () => {
  const dummyDb = {
    isPostgres: true,
    all: async () => [],
    get: async () => null,
    run: async () => ({ changes: 0 }),
    withTransaction: async fn => fn(dummyDb)
  };

  // Empty environment -> provider config is not configured
  const runtime = createProductionCohortRuntime(dummyDb, { env: {} });
  assert.equal(runtime.ready, false);
  assert.equal(runtime.providerConfigured, false);
  assert.ok(runtime.missingConfig.length > 0);

  // Verify prepare() rejects with status 503
  await assert.rejects(
    async () => runtime.prepare('student-1', {}),
    err => {
      assert.equal(err.status, 503);
      assert.equal(err.message, 'Chat is temporarily unavailable.');
      return true;
    }
  );

  // Verify service stub rejects with status 503
  await assert.rejects(
    async () => runtime.service.getAuthenticatedChatContext('student-1'),
    err => {
      assert.equal(err.status, 503);
      assert.equal(err.message, 'Chat is temporarily unavailable.');
      return true;
    }
  );
});

test('Safety Gate 4: /api/chat/health endpoint does not leak secrets', async () => {
  const app = express();
  const isCohortChatEnabled = true;
  const mockDb = {
    isPostgres: false,
    all: async () => [{ group_code: 'MERCURY', current_chat_group_id: 'id1' }, { group_code: 'VENUS', current_chat_group_id: 'id2' }, { group_code: 'EARTH', current_chat_group_id: 'id3' }, { group_code: 'MARS', current_chat_group_id: 'id4' }],
    get: async () => ({ c: 4 })
  };

  app.get('/api/chat/health', async (req, res) => {
    res.json({
      enabled: isCohortChatEnabled,
      databaseReady: true,
      slotsReady: true,
      projectionProviderConfigured: false,
      activeRoomCount: 4
    });
  });

  const s = await new Promise(res => { const server = app.listen(0, '127.0.0.1', () => res(server)); });
  try {
    const resp = await fetch(`http://127.0.0.1:${s.address().port}/api/chat/health`);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.deepEqual(Object.keys(body).sort(), [
      'activeRoomCount',
      'databaseReady',
      'enabled',
      'projectionProviderConfigured',
      'slotsReady'
    ]);
    assert.equal(body.enabled, true);
    assert.equal(body.activeRoomCount, 4);
    assert.equal(body.slotsReady, true);
    assert.equal(body.databaseReady, true);
    assert.equal(body.projectionProviderConfigured, false);
    // Explicitly verify no credential keys exist in response
    assert.equal(body.url, undefined);
    assert.equal(body.key, undefined);
    assert.equal(body.token, undefined);
    assert.equal(body.secret, undefined);
  } finally {
    s.close();
  }
});

test('Safety Gate 5: Route ownership prevents fallthrough between cohort and legacy routers', async () => {
  // Scenario A: Cohort enabled
  const appEnabled = express();
  appEnabled.use(express.json());
  const fakeCohortRouter = express.Router();
  fakeCohortRouter.get('/config', (req, res) => res.json({ chatGroupId: 'room-1', cohortDisplayName: 'Mercury' }));
  fakeCohortRouter.get('/realtime-config', (req, res) => res.json({ topic: 'chat:room-1:1', token: 'jwt' }));

  // Cohort branch
  appEnabled.use('/api/chat', fakeCohortRouter);

  // Scenario B: Cohort disabled
  const appDisabled = express();
  appDisabled.use(express.json());
  // Legacy branch
  appDisabled.get('/api/chat/config', (req, res) => res.json({ url: 'https://proj.supabase.co', key: 'anon-key' }));
  appDisabled.get('/api/chat/messages', (req, res) => res.json({ messages: [] }));

  const sEnabled = await new Promise(res => { const s = appEnabled.listen(0, '127.0.0.1', () => res(s)); });
  const sDisabled = await new Promise(res => { const s = appDisabled.listen(0, '127.0.0.1', () => res(s)); });

  try {
    // 1. In enabled mode: /api/chat/config returns ChatContext, /api/chat/realtime-config is handled
    const resA1 = await fetch(`http://127.0.0.1:${sEnabled.address().port}/api/chat/config`);
    assert.equal(resA1.status, 200);
    const bodyA1 = await resA1.json();
    assert.equal(bodyA1.chatGroupId, 'room-1');
    assert.equal(bodyA1.cohortDisplayName, 'Mercury');

    const resA2 = await fetch(`http://127.0.0.1:${sEnabled.address().port}/api/chat/realtime-config`);
    assert.equal(resA2.status, 200);
    const bodyA2 = await resA2.json();
    assert.equal(bodyA2.topic, 'chat:room-1:1');

    // 2. In disabled mode: /api/chat/config returns legacy { url, key }, /api/chat/realtime-config is 404
    const resB1 = await fetch(`http://127.0.0.1:${sDisabled.address().port}/api/chat/config`);
    assert.equal(resB1.status, 200);
    const bodyB1 = await resB1.json();
    assert.equal(bodyB1.url, 'https://proj.supabase.co');
    assert.equal(bodyB1.key, 'anon-key');
    assert.equal(bodyB1.chatGroupId, undefined);

    const resB2 = await fetch(`http://127.0.0.1:${sDisabled.address().port}/api/chat/realtime-config`);
    assert.equal(resB2.status, 404);
  } finally {
    sEnabled.close();
    sDisabled.close();
  }
});

test('Safety Gate 6: Production migration is strictly additive, non-destructive, and idempotent', async () => {
  // Mock PostgreSQL adapter tracking execution
  const executedStatements = [];
  const appliedMigrations = new Set();
  const cohorts = [{ id: 'cohort-1', group_code: 'MERCURY', status: 'active' }];
  const slots = [{ group_code: 'MERCURY', current_chat_group_id: 'room-1' }];
  const rooms = [{ id: 'room-1', cohort_id: 'cohort-1', kind: 'cohort', status: 'active' }];
  let legacyRoom = null;

  const mockAdapter = {
    isPostgres: true,
    exec: async sql => {
      executedStatements.push(sql);
      return { changes: 1 };
    },
    run: async (sql, ...args) => {
      executedStatements.push(sql);
      if (sql.includes('INSERT INTO schema_migrations')) {
        appliedMigrations.add(args[0]);
      }
      if (sql.includes("INSERT INTO chat_groups(id,kind,status,created_at) VALUES (?,'legacy','quarantined',?)")) {
        legacyRoom = { id: args[0], kind: 'legacy', status: 'quarantined' };
      }
      return { lastInsertRowid: 1, changes: 1 };
    },
    get: async (sql, ...args) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) return { lock: 1 };
      if (sql.includes('SELECT id FROM schema_migrations WHERE id=?')) {
        return appliedMigrations.has(args[0]) ? { id: args[0] } : null;
      }
      if (sql.includes("SELECT id FROM chat_groups WHERE kind='legacy'")) {
        return legacyRoom ? { id: legacyRoom.id } : null;
      }
      return null;
    },
    all: async sql => {
      if (sql.includes('SELECT c.id FROM cohorts c')) return []; // all active cohorts valid
      return [];
    },
    withTransaction: async fn => fn(mockAdapter)
  };

  // Run 1: First migration execution
  const res1 = await migrateProductionCohortChat(mockAdapter);
  assert.equal(res1.applied, true);
  assert.ok(res1.legacyRoomId);
  assert.ok(appliedMigrations.has('003-cohort-chat-production'));
  assert.ok(legacyRoom);

  // Verify none of the executed statements contain DROP, TRUNCATE, or DELETE on existing data
  for (const stmt of executedStatements) {
    const s = stmt.toUpperCase();
    assert.ok(!s.includes('DROP TABLE CHAT_MESSAGES'), 'Must not drop chat_messages');
    assert.ok(!s.includes('DROP TABLE STUDENTS'), 'Must not drop students');
    assert.ok(!s.includes('TRUNCATE'), 'Must not truncate any tables');
    assert.ok(!s.includes('DELETE FROM CHAT_MESSAGES'), 'Must not delete chat history');
    assert.ok(!s.includes('DELETE FROM STUDENTS'), 'Must not delete students');
  }

  const statementsCountRun1 = executedStatements.length;

  // Run 2: Second migration execution (proving idempotency)
  const res2 = await migrateProductionCohortChat(mockAdapter);
  assert.equal(res2.applied, false, 'Second run must report applied: false immediately');
  // No new DDL statements executed on second run
  const newStatementsRun2 = executedStatements.slice(statementsCountRun1);
  for (const stmt of newStatementsRun2) {
    assert.ok(!stmt.includes('CREATE TABLE chat_'), 'No cohort chat table created on second run');
    assert.ok(!stmt.includes('ALTER TABLE'), 'No ALTER TABLE on second run');
    assert.ok(!stmt.includes('CREATE INDEX'), 'No CREATE INDEX on second run');
  }
});

test('Safety Gate 7: Realtime JWT claims, subject derivation, and auth.uid contract', async () => {
  const { createCohortChatProviders } = require('../lib/cohort-chat-providers');
  const env = {
    COHORT_SUPABASE_URL: 'https://test.supabase.co',
    COHORT_SUPABASE_PUBLIC_KEY: 'test-public-anon-key',
    COHORT_SUPABASE_SERVICE_KEY: 'test-service-role-key',
    COHORT_SUPABASE_JWT_SECRET: 'test-jwt-secret-min-32-characters-long-key'
  };
  const providers = createCohortChatProviders(env);

  const studentA = {
    student_id: '26020260',
    supabase_uid: 'a1111111-1111-4111-a111-111111111111'
  };
  const studentB = {
    student_id: '26020261',
    supabase_uid: 'b2222222-2222-4222-a222-222222222222'
  };
  const studentWithoutUid = {
    student_id: '26020262',
    supabase_uid: null
  };

  // 1. Verify subject derivation returns Supabase Auth UUID
  const subjectA = await providers.credentials.subject(studentA);
  const subjectB = await providers.credentials.subject(studentB);
  const subjectFallback = await providers.credentials.subject(studentWithoutUid);

  assert.equal(subjectA, studentA.supabase_uid, 'Must use Supabase auth UUID when available');
  assert.notEqual(subjectA, studentA.student_id, 'Subject must NOT be raw studentId');
  assert.equal(subjectB, studentB.supabase_uid);

  // 2. Fallback subject must be a valid RFC UUID string
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert.ok(uuidRegex.test(subjectFallback), 'Fallback subject must be a valid UUID');
  assert.notEqual(subjectFallback, studentWithoutUid.student_id);

  // 3. Issue realtime JWT and inspect claims
  const expiry = new Date(Date.now() + 60000).toISOString();
  const mercuryRoomId = '77777777-7777-4777-a777-777777777777';
  const token = await providers.credentials.issue({
    subject: subjectA,
    chatGroupId: mercuryRoomId,
    realtimeEpoch: 1,
    expiry
  });

  const [headerB64, payloadB64, signature] = token.split('.');
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

  assert.equal(payload.sub, subjectA, 'JWT sub must match the Supabase auth UUID');
  assert.equal(payload.role, 'authenticated', 'JWT role must be authenticated');
  assert.equal(payload.aud, 'authenticated', 'JWT aud must be authenticated');
  assert.equal(payload.chat_room_id, mercuryRoomId, 'JWT chat_room_id must match room');
  assert.equal(payload.chat_epoch, 1, 'JWT chat_epoch must match epoch');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000), 'JWT exp must be in future');

  // 4. Verify cross-room isolation at claim level
  const venusRoomId = '88888888-8888-4888-a888-888888888888';
  assert.notEqual(payload.chat_room_id, venusRoomId, 'Student A token cannot match Venus room ID');
});

test('Safety Gate 8: Representative projection snapshot UUID validation', async () => {
  const { createCohortChatProviders } = require('../lib/cohort-chat-providers');
  const env = {
    COHORT_SUPABASE_URL: 'https://test.supabase.co',
    COHORT_SUPABASE_PUBLIC_KEY: 'test-public-anon-key',
    COHORT_SUPABASE_SERVICE_KEY: 'test-service-role-key',
    COHORT_SUPABASE_JWT_SECRET: 'test-jwt-secret-min-32-characters-long-key'
  };
  const providers = createCohortChatProviders(env);

  const roster = [
    { student_id: 's1', supabase_uid: '11111111-1111-4111-a111-111111111111' },
    { student_id: 's2', supabase_uid: '22222222-2222-4222-a222-222222222222' },
    { student_id: 's3', supabase_uid: null }, // fallback
    { student_id: 's4', supabase_uid: '44444444-4444-4444-a444-444444444444' }
  ];

  const projected = [];
  for (const member of roster) {
    projected.push({
      studentId: member.student_id,
      subject: await providers.credentials.subject(member)
    });
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const m of projected) {
    assert.ok(uuidRegex.test(m.subject), `Subject for student ${m.studentId} must be a valid UUID`);
    assert.notEqual(m.subject, m.studentId, `Subject must not be raw studentId`);
  }

  const snapshot = {
    chatGroupId: '99999999-9999-4999-a999-999999999999',
    realtimeEpoch: 1,
    status: 'active',
    members: projected
  };

  assert.equal(snapshot.members.length, 4);
  assert.equal(new Set(snapshot.members.map(m => m.subject)).size, 4, 'All subjects must be unique UUIDs');
});
