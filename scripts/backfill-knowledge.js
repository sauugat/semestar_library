#!/usr/bin/env node
'use strict';
const { asKnowledgeDb } = require('../lib/knowledge-db');

/**
 * KYANA AI 3.0 — Knowledge Backfill Script
 *
 * Scans active posts, notices, and assignments, computes canonical content hashes,
 * and indexes missing or modified resources into knowledge_resources and knowledge_chunks.
 *
 * Usage:
 *   node scripts/backfill-knowledge.js                 # DRY-RUN (no changes made)
 *   node scripts/backfill-knowledge.js --dry-run       # Explicit DRY-RUN
 *   node scripts/backfill-knowledge.js --apply         # Applies mutations to database
 *   node scripts/backfill-knowledge.js --apply --batch-size=25 --delay=300
 *
 * Rules:
 *   - Idempotent and resumable (skips unchanged content hashes)
 *   - Throttled batch processing with rate limiting
 *   - Progress logging with counts
 *   - NEVER logs raw content, SQL parameters, or secrets
 */

const { buildPostKnowledge, buildAssignmentKnowledge } = require('../lib/knowledge-builder');
const { persistKnowledgeResource } = require('../lib/knowledge-sync');

function parseArgs() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = args.includes('--dry-run') || !isApply;

  let batchSize = 50;
  let throttleMs = 200;

  for (const arg of args) {
    if (arg.startsWith('--batch-size=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (!isNaN(val) && val > 0) batchSize = val;
    }
    if (arg.startsWith('--delay=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (!isNaN(val) && val >= 0) throttleMs = val;
    }
  }

  return { isDryRun, isApply, batchSize, throttleMs };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBackfill(db, options = {}) {
  db = asKnowledgeDb(db);
  const { isDryRun = true, batchSize = 50, throttleMs = 200 } = options;
  const isPg = Boolean(db.isPostgres || (db.query && !db.all));

  console.log('================================================================');
  console.log('KYANA AI 3.0 — UNIFIED KNOWLEDGE BACKFILL');
  console.log('================================================================');
  console.log(`Mode        : ${isDryRun ? 'DRY-RUN (NO CHANGES)' : 'APPLY (MUTATING DATABASE)'}`);
  console.log(`Batch Size  : ${batchSize}`);
  console.log(`Throttle    : ${throttleMs}ms per batch`);
  console.log('----------------------------------------------------------------');

  const stats = {
    posts: { scanned: 0, skipped: 0, indexed: 0, failed: 0 },
    assignments: { scanned: 0, skipped: 0, indexed: 0, failed: 0 }
  };

  // 1. Process Posts & Notices
  console.log('[1/2] Scanning posts and notices...');
  let posts = [];
  if (isPg) {
    const res = await db.query(`
      SELECT * FROM posts
      ORDER BY id ASC
    `);
    posts = res.rows || [];
  } else {
    posts = await db.all(`
      SELECT * FROM posts
      ORDER BY id ASC
    `);
  }

  stats.posts.scanned = posts.length;
  console.log(`Found ${posts.length} active posts/notices.`);

  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);
    for (const post of batch) {
      try {
        const built = buildPostKnowledge(post);

        // Check existing hash
        let existing = null;
        if (isPg) {
          const exRes = await db.query('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = $1', [built.resource.id]);
          existing = exRes.rows[0];
        } else {
          existing = await db.get('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = ?', built.resource.id);
        }

        if (existing && existing.content_hash === built.resource.content_hash && !existing.deleted_at) {
          stats.posts.skipped++;
          continue;
        }

        if (!isDryRun) {
          await persistKnowledgeResource(db, built);
          stats.posts.indexed++;
        } else {
          stats.posts.indexed++;
        }
      } catch (err) {
        stats.posts.failed++;
        console.error(`[Backfill] Post ${post.id} indexing error:`, err.message);
      }
    }

    if (throttleMs > 0 && i + batchSize < posts.length) {
      await sleep(throttleMs);
    }
  }

  // 2. Process Assignments
  console.log('[2/2] Scanning assignments...');
  let assignments = [];
  if (isPg) {
    const res = await db.query('SELECT * FROM assignments ORDER BY id ASC');
    assignments = res.rows || [];
  } else {
    assignments = await db.all('SELECT * FROM assignments ORDER BY id ASC');
  }

  stats.assignments.scanned = assignments.length;
  console.log(`Found ${assignments.length} assignments.`);

  for (let i = 0; i < assignments.length; i += batchSize) {
    const batch = assignments.slice(i, i + batchSize);
    for (const assignment of batch) {
      try {
        const built = buildAssignmentKnowledge(assignment);

        let existing = null;
        if (isPg) {
          const exRes = await db.query('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = $1', [built.resource.id]);
          existing = exRes.rows[0];
        } else {
          existing = await db.get('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = ?', built.resource.id);
        }

        if (existing && existing.content_hash === built.resource.content_hash && !existing.deleted_at) {
          stats.assignments.skipped++;
          continue;
        }

        if (!isDryRun) {
          await persistKnowledgeResource(db, built);
          stats.assignments.indexed++;
        } else {
          stats.assignments.indexed++;
        }
      } catch (err) {
        stats.assignments.failed++;
        console.error(`[Backfill] Assignment ${assignment.id} indexing error:`, err.message);
      }
    }

    if (throttleMs > 0 && i + batchSize < assignments.length) {
      await sleep(throttleMs);
    }
  }

  console.log('----------------------------------------------------------------');
  console.log('BACKFILL SUMMARY:');
  console.log(`Posts       : Scanned=${stats.posts.scanned}, Indexed=${stats.posts.indexed}, Skipped(Unchanged)=${stats.posts.skipped}, Failed=${stats.posts.failed}`);
  console.log(`Assignments : Scanned=${stats.assignments.scanned}, Indexed=${stats.assignments.indexed}, Skipped(Unchanged)=${stats.assignments.skipped}, Failed=${stats.assignments.failed}`);
  console.log('================================================================');

  return stats;
}

if (require.main === module) {
  const { isDryRun, isApply, batchSize, throttleMs } = parseArgs();
  const db = require('../db');

  runBackfill(db, { isDryRun, batchSize, throttleMs })
    .then(() => {
      console.log('Backfill process completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Backfill fatal error:', err.message);
      process.exit(1);
    });
}

module.exports = {
  runBackfill
};
