#!/usr/bin/env node
// Do not initialize unrelated tables or run legacy seeds from this command.
process.env.SEMESTER_DB_SKIP_INIT = '1';
const db = require('../db');
const { previewRoutineMigration, migrateRoutine } = require('../migrations/001-routine');

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--dry-run')) throw new Error('Usage: npm run migrate:routine -- [--dry-run]');
  const preview = args.includes('--dry-run');
  const result = preview ? await previewRoutineMigration(db) : await migrateRoutine(db);
  console.log(JSON.stringify({
    mode: preview ? 'dry-run (no changes)' : 'apply',
    database: db.isPostgres ? 'PostgreSQL' : db.isTurso ? 'Turso' : 'SQLite',
    alreadyApplied: result.applied,
    source: result.source,
    records: result.rows.length,
    inserted: result.inserted || 0,
    warnings: result.warnings
  }, null, 2));
}

main().catch(err => { console.error(`Routine migration failed: ${err.message}`); process.exitCode = 1; })
  .finally(() => db.close());
