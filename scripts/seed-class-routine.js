#!/usr/bin/env node
'use strict';

process.env.SEMESTER_DB_SKIP_INIT = '1';
const db = require('../db');
const { seedClassRoutines } = require('../lib/routine');

async function main() {
  const result = await seedClassRoutines(db);
  console.log(JSON.stringify({
    database: db.isPostgres ? 'PostgreSQL' : db.isTurso ? 'Turso' : 'SQLite',
    ...result
  }, null, 2));
}

main()
  .catch(err => {
    console.error('Class routine seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.close());
