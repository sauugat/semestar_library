#!/usr/bin/env node
'use strict';

/**
 * Backfill Note Embeddings Script
 *
 * Scans local note files with extracted text, chunks them using page- & heading-aware
 * chunking, checks existing chunk content hashes in knowledge_chunks, and embeds
 * missing chunks in rate-limited batches.
 *
 * Safety:
 * - Runs in --dry-run mode by default. Pass --execute to write to the database.
 * - Strictly guarded against production Neon / Supabase environments.
 *
 * Usage:
 *   node scripts/backfill-note-embeddings.js [--dry-run] [--batch-size=10] [--limit=50]
 *   node scripts/backfill-note-embeddings.js --execute [--batch-size=10] [--limit=50] [--delay-ms=200]
 */

const fs = require('node:fs');
const path = require('node:path');

// Safety guard: prevent accidental execution against production databases
function verifyLocalEnvironment() {
  const dbUrl = process.env.DATABASE_URL || '';
  if (/neon\.tech|supabase\.co|aws\.neon|pooler\.supabase/i.test(dbUrl)) {
    console.error('FATAL: backfill-note-embeddings must NEVER run against production Neon or Supabase!');
    console.error('Target database URL points to a production cloud provider:', dbUrl.split('@')[1] || dbUrl);
    process.exit(1);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: true,
    batchSize: 10,
    limit: 100,
    delayMs: 200,
    fileId: null,
    model: process.env.EMBEDDING_MODEL || 'gemini-embedding-001'
  };

  for (const arg of args) {
    if (arg === '--execute' || arg === '--apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = Math.max(1, parseInt(arg.split('=')[1], 10) || 10);
    } else if (arg.startsWith('--limit=')) {
      options.limit = Math.max(1, parseInt(arg.split('=')[1], 10) || 100);
    } else if (arg.startsWith('--delay-ms=')) {
      options.delayMs = Math.max(0, parseInt(arg.split('=')[1], 10) || 200);
    } else if (arg.startsWith('--file-id=')) {
      options.fileId = parseInt(arg.split('=')[1], 10) || null;
    } else if (arg.startsWith('--model=')) {
      options.model = arg.split('=')[1] || options.model;
    }
  }

  return options;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  verifyLocalEnvironment();
  const options = parseArgs();

  console.log('====================================================');
  console.log('KYANA AI: Note Vector Embeddings Backfill');
  console.log(`Mode:       ${options.dryRun ? 'DRY-RUN (no database writes)' : 'EXECUTE (live writes)'}`);
  console.log(`Batch Size: ${options.batchSize}`);
  console.log(`Limit:      ${options.limit}`);
  console.log(`Delay:      ${options.delayMs}ms between notes`);
  console.log(`Model:      ${options.model}`);
  if (options.fileId) console.log(`Target:     Single file ID ${options.fileId}`);
  console.log('====================================================\n');

  // Load database adapter (local DB)
  let db;
  try {
    const dbModule = require('../lib/db');
    db = dbModule.db || dbModule;
  } catch (err) {
    console.error('Failed to load local db adapter:', err.message);
    process.exit(1);
  }

  const { buildNoteKnowledge, computeContentHash } = require('../lib/knowledge-builder');
  const { persistKnowledgeResource } = require('../lib/knowledge-sync');

  // Query candidate files that have extracted document content
  const isPg = Boolean(db.isPostgres || (db.query && !db.all));
  let files = [];

  const querySql = `
    SELECT f.id, f.title, f.originalName, f.storedName, f.subject, f.chapter,
           f.semester, f.semester_no, f.cohort_id, f.audience_scope, f.uploadedBy,
           d.content AS extracted_content, d.extraction_status, d.indexed_at AS extraction_indexed_at
    FROM files f
    JOIN note_search_documents d ON d.id = f.id
    WHERE d.content IS NOT NULL AND LENGTH(TRIM(d.content)) > 0
    ${options.fileId ? (isPg ? 'AND f.id = $1' : 'AND f.id = ?') : ''}
    ORDER BY f.id ASC
    ${isPg ? `LIMIT ${options.limit}` : `LIMIT ${options.limit}`}
  `;

  try {
    if (isPg) {
      const res = await db.query(querySql, options.fileId ? [options.fileId] : []);
      files = res.rows || [];
    } else {
      files = await db.all(querySql, ...(options.fileId ? [options.fileId] : []));
    }
  } catch (err) {
    console.error('Error querying note documents:', err.message);
    process.exit(1);
  }

  console.log(`Found ${files.length} candidate file(s) with extracted content.\n`);

  let totalFiles = 0;
  let totalChunks = 0;
  let embeddedChunks = 0;
  let skippedChunks = 0;

  for (const file of files) {
    totalFiles++;
    const built = buildNoteKnowledge(file);
    const chunks = built.chunks;
    totalChunks += chunks.length;

    // Check existing chunks in database
    const existingChunkEmbeddings = new Set();
    if (isPg) {
      try {
        const cRes = await db.query(
          'SELECT content_hash FROM knowledge_chunks WHERE resource_id = $1 AND embedding IS NOT NULL',
          [built.resource.id]
        );
        for (const row of cRes.rows) {
          if (row.content_hash) existingChunkEmbeddings.add(row.content_hash);
        }
      } catch (_) {}
    } else {
      try {
        const cRows = await db.all(
          'SELECT content_hash FROM knowledge_chunks WHERE resource_id = ?',
          built.resource.id
        );
        for (const row of (cRows || [])) {
          if (row.content_hash) existingChunkEmbeddings.add(row.content_hash);
        }
      } catch (_) {}
    }

    const missingChunks = chunks.filter(c => !existingChunkEmbeddings.has(c.contentHash));
    const toEmbedCount = missingChunks.length;
    const unchangedCount = chunks.length - toEmbedCount;
    skippedChunks += unchangedCount;

    if (toEmbedCount === 0) {
      console.log(`[File ${file.id}] "${file.title || file.originalName}": All ${chunks.length} chunks up to date. (Skipping)`);
      continue;
    }

    console.log(`[File ${file.id}] "${file.title || file.originalName}": ${chunks.length} total chunks, ${toEmbedCount} need embedding, ${unchangedCount} unchanged.`);

    if (options.dryRun) {
      console.log(`  [DRY-RUN] Would embed ${toEmbedCount} chunk(s) via ${options.model}.`);
    } else {
      console.log(`  [EXECUTE] Embedding and persisting ${toEmbedCount} chunk(s)...`);
      try {
        await persistKnowledgeResource(db, built, { model: options.model });
        embeddedChunks += toEmbedCount;
        console.log(`  [DONE] File ${file.id} successfully indexed.`);
      } catch (embErr) {
        console.error(`  [ERROR] Failed to embed file ${file.id}:`, embErr.message);
      }
      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }
  }

  console.log('\n====================================================');
  console.log('Backfill Summary');
  console.log(`Total Files Checked:    ${totalFiles}`);
  console.log(`Total Chunks Processed: ${totalChunks}`);
  console.log(`Chunks Embedded:        ${embeddedChunks} (mode: ${options.dryRun ? 'dry-run' : 'executed'})`);
  console.log(`Chunks Skipped (Hash):  ${skippedChunks}`);
  console.log('====================================================\n');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Backfill error:', err);
    process.exit(1);
  });
}

module.exports = { main, parseArgs, verifyLocalEnvironment };
