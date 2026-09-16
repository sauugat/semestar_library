#!/usr/bin/env node
'use strict';

// Sequential and resumable. Default: only notes that have never been indexed.
// --retry-failed includes extraction errors; --force re-extracts every note.
// --limit N caps the batch. Running again resumes unindexed notes automatically.
const db = require('../db');
const { ensureIndex, indexNote } = require('../lib/note-search');

async function main() {
  const args = new Set();
  let limit = Infinity;
  const supplied = process.argv.slice(2);
  for (let i = 0; i < supplied.length; i++) {
    const arg = supplied[i];
    if (arg === '--limit') {
      limit = Number(supplied[++i]);
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit requires a positive integer.');
    } else if (['--retry', '--retry-failed', '--force'].includes(arg)) {
      args.add(arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  await db.initSchema();
  await ensureIndex(db);
  const where = args.has('--force') ? '' : (args.has('--retry') || args.has('--retry-failed'))
    ? "AND (d.id IS NULL OR d.extraction_status = 'error')" : 'AND d.id IS NULL';
  const counts = {};
  let lastId = 0;
  let processed = 0;
  while (processed < limit) {
    const files = await db.all(`SELECT f.* FROM files f LEFT JOIN note_search_documents d ON d.id = f.id
      WHERE f.id > ? ${where} ORDER BY f.id LIMIT ?`, lastId, Math.min(25, limit - processed));
    if (!files.length) break;
    for (const file of files) {
      const result = await indexNote(db, file);
      counts[result.status] = (counts[result.status] || 0) + 1;
      processed++;
      lastId = Number(file.id);
      console.log(`File ${file.id}: ${result.status}, ${result.chars} characters${result.truncated ? ' (truncated)' : ''}${result.error ? ` — ${result.error}` : ''}`);
    }
  }
  console.log('Note indexing complete:', JSON.stringify({ processed, statuses: counts }));
}

main().then(async () => {
  if (db.pgPool) await db.pgPool.end();
}).catch(async error => {
  console.error('Note indexing failed:', error.message);
  if (db.pgPool) await db.pgPool.end();
  process.exitCode = 1;
});
