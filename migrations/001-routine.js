const legacySeed = require('./data/routine-legacy.json');
const { ensureRoutineSchema, FIELDS, normalizeDate, semesterNumber } = require('../lib/routine');

const MIGRATION_ID = '001-routine';

async function tableExists(db, table) {
  const row = db.isPostgres
    ? await db.get('SELECT 1 AS found FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?', table)
    : await db.get("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?", table);
  return Boolean(row);
}

async function isApplied(db) {
  return await tableExists(db, 'schema_migrations') && Boolean(await db.get('SELECT id FROM schema_migrations WHERE id = ?', MIGRATION_ID));
}

async function previewRoutineMigration(db) {
  if (await isApplied(db)) return { applied: true, rows: [], warnings: [], source: 'already migrated' };
  const existing = await tableExists(db, 'exam_schedule') ? await db.all('SELECT * FROM exam_schedule ORDER BY id') : [];
  // This snapshot is the exact 18-row array extracted from db.js before removing
  // its automatic reseeding. routine.html already fetches data and has no rows.
  const source = existing.length ? 'exam_schedule' : 'migrations/data/routine-legacy.json';
  const warnings = [];
  const rows = (existing.length ? existing : legacySeed).map((old, index) => {
    const id = existing.length ? Number(old.id) : index + 1;
    const semester = semesterNumber(old.semester);
    const subject = old.subject;
    const date = old.examDate ?? old.examdate ?? old.date;
    if (!Number.isSafeInteger(id) || id < 1 || !semester || !subject || !date) {
      throw new Error(`Legacy exam ${old.id ?? index + 1} has a missing/invalid ID, semester, subject or date. Nothing was migrated; review that record first.`);
    }
    const normalized = normalizeDate(date, null);
    const knownSeed = legacySeed.some(seed => semesterNumber(seed.semester) === semester && seed.subject === subject && seed.date === normalized);
    // Only the identified original BS schedule is classified automatically.
    // Do not guess the calendar from a four-digit year in admin-created rows.
    const calendar = knownSeed ? 'BS' : null;
    const oldTime = old.time?.trim() || null;
    const isCode = /^(?:[A-Z]{2,5}\d{3,4}|Elective)$/i.test(oldTime || '');
    if (!calendar) warnings.push(`Exam ${id}: confirm its BS/AD calendar in the admin form.`);
    if (!normalized) warnings.push(`Exam ${id}: original date preserved; review its format in the admin form.`);
    return {
      id, semester, subject_name: subject, subject_code: isCode ? oldTime : null,
      exam_date: normalized || date, calendar, exam_time: isCode ? null : oldTime,
      room: old.room || null, weekday: old.day || null, exam_type: old.type || null
    };
  });
  return { applied: false, source, rows, warnings };
}

async function migrateRoutine(db) {
  return db.withTransaction(async tx => {
    // Serialize this migration across simultaneous PostgreSQL deploys/runs.
    if (tx.isPostgres) await tx.get('SELECT pg_advisory_xact_lock(741001)');
    await tx.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at ${tx.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const plan = await previewRoutineMigration(tx);
    if (plan.applied) return { ...plan, inserted: 0 };
    await ensureRoutineSchema(tx);
    if (tx.isPostgres) await tx.exec('LOCK TABLE routine IN EXCLUSIVE MODE');
    const count = await tx.get('SELECT COUNT(*) AS count FROM routine');
    if (Number(count.count) !== 0) throw new Error('Routine already contains data without a migration record. Stopped to avoid overwriting admin changes.');
    for (const row of plan.rows) {
      await tx.run(`INSERT INTO routine (id, ${FIELDS.join(', ')}) VALUES (${['id', ...FIELDS].map(() => '?').join(', ')})`, row.id, ...FIELDS.map(field => row[field]));
    }
    if (tx.isPostgres) {
      await tx.get("SELECT setval(pg_get_serial_sequence('routine', 'id'), COALESCE(MAX(id), 1), COUNT(*) > 0) FROM routine");
    }
    await tx.run('INSERT INTO schema_migrations (id) VALUES (?)', MIGRATION_ID);
    return { ...plan, inserted: plan.rows.length };
  });
}

module.exports = { MIGRATION_ID, previewRoutineMigration, migrateRoutine };
