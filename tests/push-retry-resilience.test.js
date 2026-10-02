const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const pushNotifications = require('../lib/push-notifications');

async function createTestDb() {
  const client = createClient({ url: ':memory:' });
  const db = {
    isPostgres: false,
    exec: sql => client.executeMultiple(sql),
    all: async (sql, ...args) => {
      const res = await client.execute({ sql, args: args.flat() });
      return res.rows;
    },
    get: async (sql, ...args) => {
      const res = await client.execute({ sql, args: args.flat() });
      return res.rows[0];
    },
    run: async (sql, ...args) => {
      const res = await client.execute({ sql, args: args.flat() });
      return { lastInsertRowid: Number(res.lastInsertRowid), changes: res.rowsAffected };
    },
    close: () => client.close()
  };

  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT,
      semester TEXT
    );

    CREATE TABLE student_device_tokens (
      expo_push_token TEXT PRIMARY KEY,
      student_id TEXT,
      platform TEXT,
      device_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE student_notification_preferences (
      student_id TEXT PRIMARY KEY,
      mute_chat INTEGER DEFAULT 0,
      notify_notes INTEGER DEFAULT 1,
      notify_posts INTEGER DEFAULT 1,
      notify_notices INTEGER DEFAULT 1,
      hide_lockscreen_preview INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE push_notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      event_id TEXT,
      recipient_student_id TEXT,
      payload_json TEXT,
      idempotency_key TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      next_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE push_receipt_tickets (
      ticket_id TEXT PRIMARY KEY,
      expo_push_token TEXT NOT NULL,
      outbox_id INTEGER,
      status TEXT DEFAULT 'pending',
      details_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.run("INSERT INTO students VALUES ('stu_resilient', 'Resilient Student', 'student', 'Semester 1')");
  await db.run("INSERT INTO student_device_tokens (expo_push_token, student_id, platform, device_name) VALUES ('ExponentPushToken[resilient_token_123]', 'stu_resilient', 'android', 'Samsung Galaxy')");
  await db.run("INSERT INTO student_notification_preferences (student_id) VALUES ('stu_resilient')");

  return db;
}

test('PUSH RETRY RESILIENCE: Immediate failure sets backoff and recovers on subsequent sweep without daily cron', async (t) => {
  const db = await createTestDb();
  t.after(() => db.close());

  // 1. Enqueue a new high-priority notice push event
  const enqueueResult = await pushNotifications.enqueuePushForRecipients(db, {
    eventType: 'notice',
    eventId: 'notice_999',
    recipientStudentIds: ['stu_resilient'],
    payload: {
      title: 'Exam Rescheduled',
      body: 'Midterms will start next Wednesday at 9:00 AM.',
      data: { type: 'notice', eventId: 'notice_999' }
    }
  });

  assert.equal(enqueueResult.enqueuedCount, 1, 'Enqueued exactly 1 outbox item');

  // Verify initial outbox row
  const initialRow = await db.get("SELECT * FROM push_notification_outbox WHERE event_id = 'notice_999'");
  assert.equal(initialRow.status, 'pending');
  assert.equal(initialRow.attempts, 0);

  // 2. Simulate Expo HTTP 503 / Network Failure on the first dispatch attempt
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  let fetchCallCount = 0;
  global.fetch = async (url, options) => {
    fetchCallCount++;
    if (url.includes('exp.host')) {
      // Simulate Expo API outage / 503 Service Unavailable
      return {
        ok: false,
        status: 503,
        json: async () => ({ errors: [{ code: 'SERVICE_UNAVAILABLE', message: 'Expo Push Service temporarily unavailable' }] })
      };
    }
    return originalFetch(url, options);
  };

  // Run dispatch (this simulates immediate dispatch failure during event creation)
  const failDispatchResult = await pushNotifications.dispatchImmediateOutbox(db, {
    eventType: 'notice',
    eventId: 'notice_999'
  });

  assert.equal(failDispatchResult.failed, 1, 'Dispatch recorded 1 failure as expected');
  assert.equal(failDispatchResult.sent, 0, 'Zero messages sent during failure');

  // Verify the row was not lost and was updated with backoff
  const failedRow = await db.get("SELECT * FROM push_notification_outbox WHERE event_id = 'notice_999'");
  assert.equal(failedRow.status, 'pending', 'Status remains pending for retry');
  assert.equal(failedRow.attempts, 1, 'Attempts incremented to 1');
  assert.ok(failedRow.next_attempt_at, 'next_attempt_at is set for backoff');

  // 3. Simulate recovery: Expo service restored
  global.fetch = async (url, options) => {
    fetchCallCount++;
    if (url.includes('exp.host')) {
      // Expo is back online and accepts the notification ticket
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ status: 'ok', id: '01a0-recovered-ticket-456' }]
        })
      };
    }
    return originalFetch(url, options);
  };

  // Simulate arrival of next attempt window (set next_attempt_at to now)
  await db.run("UPDATE push_notification_outbox SET next_attempt_at = datetime('now', '-1 second') WHERE event_id = 'notice_999'");

  // 4. Trigger opportunistic outbox processing (simulating the sweeper / next request)
  const recoveryResult = await pushNotifications.processPushOutbox(db, { limit: 10 });

  assert.equal(recoveryResult.sent, 1, 'Recovery sent the previously failed notification');
  assert.equal(recoveryResult.failed, 0, 'Zero failures during recovery');

  // 5. Verify final outbox row has transitioned to sent
  const recoveredRow = await db.get("SELECT * FROM push_notification_outbox WHERE event_id = 'notice_999'");
  assert.equal(recoveredRow.status, 'sent', 'Outbox row transitioned to sent upon recovery');
  assert.ok(recoveredRow.sent_at, 'sent_at timestamp is populated');

  // 6. Verify ticket was recorded for receipt tracking
  const ticket = await db.get("SELECT * FROM push_receipt_tickets WHERE outbox_id = ?", recoveredRow.id);
  assert.ok(ticket, 'Receipt ticket recorded in database');
  assert.equal(ticket.ticket_id, '01a0-recovered-ticket-456');
  assert.equal(ticket.status, 'pending');
});
