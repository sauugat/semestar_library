'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const TEST_DB_PATH = path.join('/tmp', `qa_guard_seed_c2_${Date.now()}.db`);
process.env.QA_MODE = 'true';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = TEST_DB_PATH;
process.env.EXPO_PUSH_DISABLED = 'true';
process.env.TEACHER_ONBOARDING_ENABLED = 'false';
process.env.DM_ENABLED = 'false';
process.env.COHORT_CHAT_LOCAL = '1';
process.env.DM_TEST_USER_IDS = '99000001,99000002,99000003,99000004';

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.DIRECT_URL;
delete process.env.PGHOST;
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.COHORT_SUPABASE_URL;
delete process.env.DM_SUPABASE_URL;

const {
  validateQaEnvironment,
  assertSafeQaEnvironment,
  isVerifiedQaEnvironment,
  isSafeLocalDbPath,
} = require('../lib/qa-guard');
const db = require('../db');
const { seedQa } = require('../scripts/seed-qa');
const { migrateCohortChat } = require('../migrations/002-cohort-chat');
const { migrateDirectMessaging } = require('../migrations/005-direct-messaging-schema');
const { isDmAllowedForUser } = require('../lib/dm-config');
const { createDmService } = require('../lib/dm-service');
const { createAuthMiddleware } = require('../lib/auth-middleware');

test.after(async () => {
  await db.close().catch(() => {});
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  }
});

test('A3.1: QA guard refuses when NODE_ENV=production even if QA_MODE=true', () => {
  assert.throws(
    () => assertSafeQaEnvironment({ QA_MODE: 'true', NODE_ENV: 'production', DB_PATH: '/tmp/qa.db' }),
    (err) => err.code === 'QA_GUARD_VIOLATION' && /NODE_ENV cannot be "production"/i.test(err.message)
  );
  assert.equal(isVerifiedQaEnvironment({ QA_MODE: 'true', NODE_ENV: 'production', DB_PATH: '/tmp/qa.db' }), false);
});

test('A3.2: QA guard refuses any non-local DB_PATH, Postgres URL, or Supabase URL', () => {
  assert.equal(isSafeLocalDbPath('/tmp/database.qa.db'), true);
  assert.equal(isSafeLocalDbPath(':memory:'), true);
  assert.equal(isSafeLocalDbPath('postgres://localhost:5432/db'), false);
  assert.equal(isSafeLocalDbPath('https://turso.io/db'), false);

  for (const badEnv of [
    { QA_MODE: 'true', NODE_ENV: 'qa', DATABASE_URL: 'postgres://user:pass@ep-test.us-east-1.aws.neon.tech/db' },
    { QA_MODE: 'true', NODE_ENV: 'qa', DIRECT_URL: 'postgres://user:pass@localhost:5432/prod' },
    { QA_MODE: 'true', NODE_ENV: 'qa', DB_PATH: 'postgres://127.0.0.1:5432/db' },
    { QA_MODE: 'true', NODE_ENV: 'qa', SUPABASE_URL: 'https://ahcccqsyvpxacnsttzeh.supabase.co' },
    { QA_MODE: 'true', NODE_ENV: 'qa', COHORT_SUPABASE_URL: 'https://custom.supabase.co' },
    { QA_MODE: 'true', NODE_ENV: 'qa', DM_SUPABASE_URL: 'https://custom.supabase.co' },
  ]) {
    assert.throws(
      () => assertSafeQaEnvironment(badEnv),
      (err) => err.code === 'QA_GUARD_VIOLATION'
    );
  }

  // Re-verify safe environment
  assert.equal(assertSafeQaEnvironment(process.env), true);
  assert.equal(isVerifiedQaEnvironment(process.env), true);
});

test('A3.3: Migrations 002 and 005 refuse when NODE_ENV=production + QA_MODE=true, and 005 allows NODE_ENV=production + DM_MIGRATION_ALLOWED=1', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAllowed = process.env.DM_MIGRATION_ALLOWED;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.DM_MIGRATION_ALLOWED;

    await assert.rejects(
      () => migrateCohortChat(db, { disposable: true }),
      /Phase 2A migration requires NODE_ENV=test/
    );
    await assert.rejects(
      () => migrateDirectMessaging(db),
      /Direct messaging migration requires explicit authorization/
    );

    // Original production behavior preserved when DM_MIGRATION_ALLOWED=1
    process.env.DM_MIGRATION_ALLOWED = '1';
    const res = await migrateDirectMessaging(db);
    assert.equal(typeof res.applied, 'boolean');
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevAllowed === undefined) delete process.env.DM_MIGRATION_ALLOWED;
    else process.env.DM_MIGRATION_ALLOWED = prevAllowed;
  }
});

test('A2 & Follow-up #6: seedQa runs idempotently, numeric QA account signs in like the app, isDmAllowedForUser is true, and DM is created between 99000002 and 99000003', async () => {
  await seedQa(db);
  // Second run proves idempotency
  await seedQa(db);

  const chatCols = (await db.all('PRAGMA table_info(chat_messages)')).map(c => c.name);
  assert.ok(chatCols.includes('chat_group_id'), 'chat_messages.chat_group_id must exist');
  assert.ok(chatCols.includes('client_id'), 'chat_messages.client_id must exist');

  const tables = (await db.all("SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name);
  const expectedTables = [
    'chat_send_keys',
    'chat_realtime_outbox',
    'chat_room_read_receipts',
    'chat_room_typing',
    'chat_pinned_announcements',
    'chat_online_sessions',
    'chat_group_slots',
    'dm_conversations',
    'dm_participants',
    'dm_messages',
    'dm_message_deletions',
    'dm_blocks',
    'dm_reports',
    'dm_rate_limits',
    'dm_realtime_outbox',
  ];
  for (const t of expectedTables) {
    assert.ok(tables.includes(t), `Expected table ${t} in QA database`);
  }

  const slots = await db.all('SELECT group_code FROM chat_group_slots ORDER BY group_code');
  assert.equal(slots.length, 4, 'All 4 cohort slots must exist');

  // Verify synthetic fake numeric accounts (99000001-99000004) are seeded and verified
  for (const id of ['99000001', '99000002', '99000003', '99000004']) {
    const row = await db.get('SELECT studentId, verification_status FROM students WHERE studentId = ?', id);
    assert.ok(row, `Synthetic numeric account ${id} must exist`);
    assert.equal(row.verification_status, 'verified', `Synthetic numeric account ${id} must be verified`);
  }

  // Sign in as numeric QA account 99000002 (qa_student_num / QaStudent123!) the exact way /api/mobile/login does
  const identifier = 'qa_student_num';
  const student = await db.get(
    'SELECT * FROM students WHERE LOWER(username) = ? OR LOWER(studentId) = ?',
    identifier.toLowerCase(),
    identifier.toLowerCase()
  );
  assert.ok(student, 'Student 99000002 must be resolved by username/studentId');
  assert.equal(student.studentId, '99000002');
  assert.equal(bcrypt.compareSync('QaStudent123!', student.passwordHash), true, 'Password must match seeded QA hash');

  const mobileToken = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    mobileToken,
    student.studentId,
    now.toISOString(),
    new Date(now.getTime() + 86400000).toISOString()
  );

  // Authenticate request via real auth-middleware using the issued mobile bearer token
  const auth = createAuthMiddleware(db);
  const req = {
    headers: { authorization: `Bearer ${mobileToken}` },
    get(h) { return this.headers[h.toLowerCase()]; },
  };
  await new Promise((resolve, reject) => {
    auth.authenticate(req, {}, (err) => (err ? reject(err) : resolve()));
  });
  assert.ok(req.user, 'createAuthMiddleware must populate req.user from mobile_tokens');
  assert.equal(req.user.studentId, '99000002');

  // Assert isDmAllowedForUser is true when DM_ENABLED=false and DM_TEST_USER_IDS=99000001,99000002,99000003,99000004
  assert.equal(process.env.DM_ENABLED, 'false');
  assert.equal(isDmAllowedForUser(req.user.studentId), true, 'isDmAllowedForUser must be true for signed-in numeric QA account 99000002');
  assert.equal(isDmAllowedForUser('99000003'), true, 'isDmAllowedForUser must be true for numeric QA account 99000003');
  assert.equal(isDmAllowedForUser('qa_student'), false, 'Non-numeric qa_student is not in DM_TEST_USER_IDS');

  // Create a DM conversation between 99000002 and 99000003 and send a message
  const dmService = createDmService(db);
  const conv = await dmService.getOrCreateConversation(req.user.studentId, '99000003');
  assert.ok(conv.conversationId, 'Conversation ID must be returned');
  assert.equal(conv.conversation.id, conv.conversationId);
  assert.equal(conv.participant.studentId, '99000003');

  const sent = await dmService.sendMessage(req.user.studentId, conv.conversationId, {
    clientId: crypto.randomUUID(),
    text: 'Hello from 99000002 to 99000003 in QA!',
  });
  assert.equal(sent.message.senderId, '99000002');
  assert.equal(sent.message.text, 'Hello from 99000002 to 99000003 in QA!');
});
