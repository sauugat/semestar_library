'use strict';
// An in-memory PostgreSQL engine: never imports db.js, .env, or live credentials.
const { PGlite } = require('@electric-sql/pglite');
const { createTransactionAdapter } = require('../../lib/db-transaction');
const { migrateDirectMessaging } = require('../../migrations/005-direct-messaging-schema');

async function dmPostgresFixture() {
  const pg = new PGlite();
  let queryCount = 0;
  const formatRow = row => row && ({ ...row, ...(row.studentid ? { studentId: row.studentid } : {}) });
  const adapter = client => {
    const db = createTransactionAdapter({ query: async (sql, args) => {
      queryCount++;
      const result = args ? await client.query(sql, args) : (await client.exec(sql)).at(-1);
      return { ...result, rowCount: result.affectedRows };
    } }, true, formatRow, rows => rows.map(formatRow));
    return db;
  };
  const db = adapter(pg);
  db.withTransaction = fn => pg.transaction(tx => fn(adapter(tx)));
  await db.exec(`
    CREATE TABLE students (studentId TEXT PRIMARY KEY, name TEXT, username TEXT,
      role TEXT, avatarUrl TEXT, department TEXT, semester INTEGER,
      verification_status TEXT, supabase_uid TEXT);
    CREATE TABLE student_notification_preferences (student_id TEXT PRIMARY KEY,
      mute_chat INTEGER DEFAULT 0, hide_lockscreen_preview INTEGER DEFAULT 0,
      delivery_messages TEXT DEFAULT 'all');
    CREATE TABLE push_notification_outbox (id SERIAL PRIMARY KEY, event_type TEXT,
      event_id TEXT, recipient_student_id TEXT, payload_json JSONB, idempotency_key TEXT UNIQUE,
      status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0,
      next_attempt_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW());
    INSERT INTO students (studentId, name, username, role, verification_status)
      VALUES ('alice','Alice','alice','student','verified'),
             ('bob','Bob','bob','student','verified'),
             ('outsider','Outsider','outsider','student','verified');
  `);
  await migrateDirectMessaging(db, { disposable: true });
  return { db, queryCount: () => queryCount, close: () => pg.close() };
}
module.exports = { dmPostgresFixture };
