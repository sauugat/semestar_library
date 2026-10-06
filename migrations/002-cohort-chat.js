'use strict';
const { randomUUID } = require('node:crypto');
const ID = '002-cohort-chat-local';
const CODES = ['MERCURY', 'VENUS', 'EARTH', 'MARS'];

// Explicitly invoked on disposable fixtures only; never imported by initSchema.
async function migrateCohortChat(db, { disposable = false } = {}) {
  if (!disposable || process.env.NODE_ENV !== 'test') throw new Error('Phase 2A migration requires NODE_ENV=test and an explicit disposable fixture');
  return db.withTransaction(async tx => {
    if (tx.isPostgres) await tx.get('SELECT pg_advisory_xact_lock(741002)');
    await tx.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    if (await tx.get('SELECT id FROM schema_migrations WHERE id=?', ID)) return { applied: false };
    if (tx.isPostgres) {
      await tx.exec(`
        CREATE TABLE IF NOT EXISTS cohorts (
          id TEXT PRIMARY KEY, intake_year INTEGER CHECK(intake_year BETWEEN 1900 AND 2300),
          group_code TEXT CHECK(group_code IN ('MERCURY','VENUS','EARTH','MARS')),
          current_semester INTEGER CHECK(current_semester BETWEEN 1 AND 8),
          status TEXT CHECK(status IN ('active','graduated','archived')), version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL, graduated_at TEXT
        );
        ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS group_code TEXT;
        ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
        UPDATE cohorts SET group_code = UPPER(slot_code) WHERE group_code IS NULL AND slot_code IS NOT NULL;
        CREATE TABLE IF NOT EXISTS chat_groups (
          id TEXT PRIMARY KEY, cohort_id TEXT UNIQUE REFERENCES cohorts(id),
          kind TEXT NOT NULL DEFAULT 'cohort' CHECK(kind IN ('cohort','legacy')),
          status TEXT NOT NULL CHECK(status IN ('active','closed','recycling','recycled','quarantined')),
          realtime_epoch INTEGER NOT NULL DEFAULT 1 CHECK(realtime_epoch>0),
          projection_status TEXT NOT NULL DEFAULT 'pending' CHECK(projection_status IN ('pending','ready','failed')),
          projection_epoch INTEGER, created_at TEXT NOT NULL, closed_at TEXT, recycled_at TEXT,
          CHECK ((kind='legacy' AND cohort_id IS NULL AND status='quarantined') OR
            (kind='cohort' AND cohort_id IS NOT NULL AND status<>'quarantined'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS chat_one_legacy_room ON chat_groups(kind) WHERE kind='legacy';
        CREATE TABLE IF NOT EXISTS chat_group_slots (
          group_code TEXT PRIMARY KEY CHECK(group_code IN ('MERCURY','VENUS','EARTH','MARS')),
          current_chat_group_id TEXT UNIQUE REFERENCES chat_groups(id), version INTEGER NOT NULL DEFAULT 1
        );
        ALTER TABLE students ADD COLUMN IF NOT EXISTS cohort_id TEXT REFERENCES cohorts(id);
        ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS chat_group_id TEXT REFERENCES chat_groups(id);
        ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS client_id TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS chat_send_identity ON chat_messages(chat_group_id,studentId,client_id);
        CREATE INDEX IF NOT EXISTS chat_room_history ON chat_messages(chat_group_id,id);
      `);
    } else {
      const tables = (await tx.all("SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name);
      if (!tables.includes('cohorts')) {
        await tx.exec(`
          CREATE TABLE cohorts (
            id TEXT PRIMARY KEY, intake_year INTEGER NOT NULL CHECK(intake_year BETWEEN 1900 AND 2300),
            group_code TEXT NOT NULL CHECK(group_code IN ('MERCURY','VENUS','EARTH','MARS')),
            current_semester INTEGER NOT NULL CHECK(current_semester BETWEEN 1 AND 8),
            status TEXT NOT NULL CHECK(status IN ('active','graduated')), version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL, graduated_at TEXT
          );
        `);
      } else {
        const cohortCols = (await tx.all('PRAGMA table_info(cohorts)')).map(c => c.name);
        if (!cohortCols.includes('group_code')) {
          await tx.exec('ALTER TABLE cohorts ADD COLUMN group_code TEXT;');
        }
        if (!cohortCols.includes('version')) {
          await tx.exec('ALTER TABLE cohorts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;');
        }
        if (cohortCols.includes('slot_code')) {
          await tx.exec('UPDATE cohorts SET group_code = UPPER(slot_code) WHERE group_code IS NULL AND slot_code IS NOT NULL;');
        }
      }
      await tx.exec(`
        CREATE TABLE IF NOT EXISTS chat_groups (
          id TEXT PRIMARY KEY, cohort_id TEXT UNIQUE REFERENCES cohorts(id),
          kind TEXT NOT NULL DEFAULT 'cohort' CHECK(kind IN ('cohort','legacy')),
          status TEXT NOT NULL CHECK(status IN ('active','closed','recycling','recycled','quarantined')),
          realtime_epoch INTEGER NOT NULL DEFAULT 1 CHECK(realtime_epoch>0),
          projection_status TEXT NOT NULL DEFAULT 'pending' CHECK(projection_status IN ('pending','ready','failed')),
          projection_epoch INTEGER, created_at TEXT NOT NULL, closed_at TEXT, recycled_at TEXT,
          CHECK ((kind='legacy' AND cohort_id IS NULL AND status='quarantined') OR
            (kind='cohort' AND cohort_id IS NOT NULL AND status<>'quarantined'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS chat_one_legacy_room ON chat_groups(kind) WHERE kind='legacy';
        CREATE TABLE IF NOT EXISTS chat_group_slots (
          group_code TEXT PRIMARY KEY CHECK(group_code IN ('MERCURY','VENUS','EARTH','MARS')),
          current_chat_group_id TEXT UNIQUE REFERENCES chat_groups(id), version INTEGER NOT NULL DEFAULT 1
        );
      `);
      const studentCols = (await tx.all('PRAGMA table_info(students)')).map(c => c.name);
      if (!studentCols.includes('cohort_id')) {
        await tx.exec('ALTER TABLE students ADD COLUMN cohort_id TEXT REFERENCES cohorts(id);');
      }
      const chatCols = (await tx.all('PRAGMA table_info(chat_messages)')).map(c => c.name);
      if (!chatCols.includes('chat_group_id')) {
        await tx.exec('ALTER TABLE chat_messages ADD COLUMN chat_group_id TEXT REFERENCES chat_groups(id);');
      }
      if (!chatCols.includes('client_id')) {
        await tx.exec('ALTER TABLE chat_messages ADD COLUMN client_id TEXT;');
      }
      await tx.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS chat_send_identity ON chat_messages(chat_group_id,studentId,client_id);
        CREATE INDEX IF NOT EXISTS chat_room_history ON chat_messages(chat_group_id,id);
      `);
    }
    await tx.exec(require('./cohort-chat-support-schema').cohortChatSupportSchema());
    for (const code of CODES) await tx.run('INSERT INTO chat_group_slots(group_code) VALUES (?) RETURNING group_code', code);
    const legacyRoomId = randomUUID();
    await tx.run("INSERT INTO chat_groups(id,kind,status,created_at) VALUES (?,'legacy','quarantined',?) RETURNING id", legacyRoomId, new Date().toISOString());
    await tx.run('INSERT INTO schema_migrations(id) VALUES (?) RETURNING id', ID);
    return { applied: true, legacyRoomId };
  });
}
module.exports = { migrateCohortChat, CODES };
