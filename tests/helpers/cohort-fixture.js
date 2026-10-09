'use strict';
const { randomUUID } = require('node:crypto');
const { createTransactionAdapter } = require('../../lib/db-transaction');
const { migrateCohortChat } = require('../../migrations/002-cohort-chat');
const { createCohortChat } = require('../../lib/cohort-chat');
const push = require('../../lib/push-notifications');

// No db.js/.env import, DATABASE_URL, Neon or Supabase. PG endpoint is fixed
// to the disposable Docker fixture documented in the Phase 2A report.
async function fixture(engine, { migrate = true } = {}) {
  let db, close;
  if (engine === 'pglite') {
    const { PGlite } = require('@electric-sql/pglite');
    const pg = new PGlite();
    const row = value => value && Object.fromEntries(Object.entries(value).map(([key, val]) => [key, val instanceof Date ? val.toISOString() : val]));
    const adapter = client => createTransactionAdapter({ query: async (sql, args) => {
      const result = args ? await client.query(sql, args) : (await client.exec(sql)).at(-1);
      return { ...result, rowCount: result.affectedRows };
    } }, true, row, rows => rows.map(row));
    db = adapter(pg);
    db.withTransaction = fn => pg.transaction(tx => fn(adapter(tx)));
    close = () => pg.close();
  } else if (engine === 'postgres') {
    const { Pool } = require('pg');
    const config = { host: '127.0.0.1', port: 55442, database: 'cohort_fixture', user: 'postgres', password: 'cohort-local-fixture', connectionTimeoutMillis: 5000 };
    const root = new Pool(config), schema = `cohort_${randomUUID().replaceAll('-', '')}`;
    await root.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ ...config, application_name: schema, options: `-c search_path=${schema} -c lock_timeout=10000 -c statement_timeout=15000`, max: 12 });
    db = createTransactionAdapter(pool, true);
    db.withTransaction = async fn => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(createTransactionAdapter(client, true));
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    };
    close = async () => { await pool.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); };
  } else {
    const { createClient } = require('@libsql/client');
    const fs = require('node:fs/promises');
    const dir = await fs.mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'cohort-fixture-'));
    const client = createClient({ url: `file:${dir}/fixture.db` });
    db = createTransactionAdapter(client, false);
    await db.exec('PRAGMA foreign_keys=ON');
    let queue = Promise.resolve();
    db.withTransaction = fn => {
      const operation = queue.then(async () => {
        const tx = await client.transaction('write');
        try { const result = await fn(createTransactionAdapter(tx, false)); await tx.commit(); return result; }
        catch (error) { await tx.rollback(); throw error; }
        finally { tx.close(); }
      });
      queue = operation.catch(() => {});
      return operation;
    };
    close = async () => { await queue; client.close(); await fs.rm(dir, { recursive: true, force: true }); };
  }
  try {
    const serial = db.isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const timestamp = db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT';
    await db.exec(`
      CREATE TABLE students(studentId TEXT PRIMARY KEY,name TEXT,username TEXT,avatarUrl TEXT,supabase_uid TEXT,role TEXT,department TEXT,semester INTEGER);
      CREATE TABLE chat_messages(id ${serial},studentId TEXT NOT NULL REFERENCES students(studentId),text TEXT,
        attachmentName TEXT,attachmentOriginalName TEXT,attachmentMimeType TEXT,replyToId INTEGER,createdAt ${timestamp} NOT NULL);
      CREATE TABLE chat_reactions(messageId INTEGER REFERENCES chat_messages(id),studentId TEXT REFERENCES students(studentId),emoji TEXT,PRIMARY KEY(messageId,studentId));
      CREATE TABLE file_blobs(id ${serial},filename TEXT UNIQUE,mimeType TEXT,fileData ${db.isPostgres ? 'BYTEA' : 'BLOB'},createdAt ${timestamp});
      CREATE TABLE chat_read_receipts(studentId TEXT PRIMARY KEY,lastReadMessageId INTEGER);
      CREATE TABLE chat_typing(studentId TEXT PRIMARY KEY,lastTypedAt ${timestamp});
      CREATE TABLE chat_pinned(id ${serial},messageId INTEGER);
      CREATE TABLE fixture_client_events(id TEXT PRIMARY KEY);
      CREATE TABLE cohort_semester_history(id TEXT PRIMARY KEY,cohort_id TEXT,semester_no INTEGER,started_at TEXT,created_at TEXT);
    `);
    await push.ensurePushNotificationSchema(db);
    const ids = ['admin','m1','m2','v1','v2','e1','s1','s2','new1','new2','none','outsider'];
    for (const id of ids) {
      await db.run('INSERT INTO students(studentId,name,username,role,department,semester,supabase_uid) VALUES (?,?,?,?,?,?,?) RETURNING studentId',
        id, id, id, id === 'admin' ? 'admin' : ['m1','s1'].includes(id) ? 'cr' : 'student', id === 'outsider' ? 'BCA' : 'BIT', 1, `subject-${id}`);
      await db.run('INSERT INTO student_device_tokens(student_id,expo_push_token,platform) VALUES (?,?,?) RETURNING student_id', id, `ExpoPushToken[local-${id}]`, 'android');
    }
    const legacy = await db.run("INSERT INTO chat_messages(studentId,text,createdAt) VALUES ('m1','legacy quarantine sentinel',CURRENT_TIMESTAMP) RETURNING id");
    if (migrate) await migrateCohortChat(db, { disposable: true });
    let time = Date.now();
    const broadcasts = [], pushes = [], erased = [], shared = new Set();
    const providers = {
      now: () => time,
      projection: { sync: async snapshot => snapshot },
      credentials: { subject: async member => member.supabase_uid, issue: async data => `fixture-only:${data.subject}:${data.realtimeEpoch}` },
      realtime: { send: async event => { broadcasts.push(event); } },
      push: { sendBatch: async messages => { pushes.push(...messages); return { tickets: messages.map(() => ({ status: 'ok', id: randomUUID() })), status: 200 }; } },
      attachments: { isReferencedElsewhere: async (_tx, name) => shared.has(name), eraseExternal: async name => { erased.push(name); } },
    };
    const service = createCohortChat(db, providers);
    return { db, service, providers, broadcasts, pushes, erased, shared, legacyId: legacy.lastInsertRowid, close,
      tick: ms => { time += ms; },
      seed: async () => {
        const rooms = {};
        for (const [code, semester, roster] of [['MERCURY',1,['m1','m2']],['VENUS',3,['v1','v2']],['EARTH',5,['e1']],['MARS',7,['s1','s2']]]) {
          rooms[code] = await service.createCohort('admin', { groupCode: code, intakeYear: 2026, currentSemester: semester, studentIds: roster });
        }
        return rooms;
      },
    };
  } catch (error) { await close(); throw error; }
}
module.exports = { fixture };
