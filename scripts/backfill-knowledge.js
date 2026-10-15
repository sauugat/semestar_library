#!/usr/bin/env node
'use strict';
const { asKnowledgeDb } = require('../lib/knowledge-db');

/**
 * KYANA AI 3.0 — Comprehensive Knowledge Backfill Script
 *
 * Scans active posts, notices, assignments, notes (files), routines, comments,
 * and official Gandaki University notices. Computes canonical content hashes,
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

const {
  buildPostKnowledge,
  buildAssignmentKnowledge,
  buildNoteKnowledge,
  buildRoutineKnowledge,
  buildCommentKnowledge
} = require('../lib/knowledge-builder');
const { persistKnowledgeResource } = require('../lib/knowledge-sync');

function parseArgs() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = args.includes('--dry-run') || !isApply;
  const includeGu = args.includes('--include-gu') || args.includes('--with-gu');
  const allowProduction = args.includes('--allow-production');

  let batchSize = 50;
  let throttleMs = 200;
  let dbUrl = null;

  for (const arg of args) {
    if (arg.startsWith('--batch-size=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (!isNaN(val) && val > 0) batchSize = val;
    }
    if (arg.startsWith('--delay=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (!isNaN(val) && val >= 0) throttleMs = val;
    }
    if (arg.startsWith('--db-url=')) {
      dbUrl = arg.slice('--db-url='.length).trim();
    }
  }

  return { isDryRun, isApply, batchSize, throttleMs, includeGu, dbUrl, allowProduction };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBackfill(db, options = {}) {
  db = asKnowledgeDb(db);
  const { isDryRun = true, batchSize = 50, throttleMs = 200, includeGu = false } = options;
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
    assignments: { scanned: 0, skipped: 0, indexed: 0, failed: 0 },
    notes: { scanned: 0, skipped: 0, indexed: 0, failed: 0 },
    routines: { scanned: 0, skipped: 0, indexed: 0, failed: 0 },
    comments: { scanned: 0, skipped: 0, indexed: 0, failed: 0 },
    university: { scanned: 0, skipped: 0, indexed: 0, failed: 0 }
  };

  // 1. Process Posts & Notices
  console.log('[1/5] Scanning posts and notices...');
  let posts = [];
  if (isPg) {
    const res = await db.query('SELECT * FROM posts ORDER BY id ASC');
    posts = res.rows || [];
  } else {
    posts = await db.all('SELECT * FROM posts ORDER BY id ASC');
  }
  stats.posts.scanned = posts.length;
  console.log(`Found ${posts.length} posts/notices.`);

  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);
    for (const post of batch) {
      try {
        const built = buildPostKnowledge(post);
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
        }
        stats.posts.indexed++;
      } catch (err) {
        stats.posts.failed++;
        console.error(`[Backfill] Post ${post.id} indexing error:`, err.message);
      }
    }
    if (throttleMs > 0 && i + batchSize < posts.length) await sleep(throttleMs);
  }

  // 2. Process Assignments
  console.log('[2/5] Scanning assignments...');
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
        }
        stats.assignments.indexed++;
      } catch (err) {
        stats.assignments.failed++;
        console.error(`[Backfill] Assignment ${assignment.id} indexing error:`, err.message);
      }
    }
    if (throttleMs > 0 && i + batchSize < assignments.length) await sleep(throttleMs);
  }

  // 3. Process Notes (Files with extracted text)
  console.log('[3/5] Scanning notes and study materials...');
  let notes = [];
  try {
    if (isPg) {
      const res = await db.query(`
        SELECT f.*, d.content AS extracted_content, d.indexed_at AS extraction_indexed_at
        FROM files f
        LEFT JOIN note_search_documents d ON d.id = f.id
        ORDER BY f.id ASC
      `);
      notes = res.rows || [];
    } else {
      notes = await db.all(`
        SELECT f.*, d.content AS extracted_content, d.indexed_at AS extraction_indexed_at
        FROM files f
        LEFT JOIN note_search_documents d ON d.id = f.id
        ORDER BY f.id ASC
      `);
    }
  } catch (err) {
    console.warn('[Backfill] Notes table scan skipped:', err.message);
  }

  stats.notes.scanned = notes.length;
  console.log(`Found ${notes.length} note files.`);

  for (let i = 0; i < notes.length; i += batchSize) {
    const batch = notes.slice(i, i + batchSize);
    for (const file of batch) {
      try {
        const built = buildNoteKnowledge(file);
        let existing = null;
        if (isPg) {
          const exRes = await db.query('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = $1', [built.resource.id]);
          existing = exRes.rows[0];
        } else {
          existing = await db.get('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = ?', built.resource.id);
        }

        if (existing && existing.content_hash === built.resource.content_hash && !existing.deleted_at) {
          stats.notes.skipped++;
          continue;
        }

        if (!isDryRun) {
          await persistKnowledgeResource(db, built);
        }
        stats.notes.indexed++;
      } catch (err) {
        stats.notes.failed++;
        console.error(`[Backfill] Note ${file.id} indexing error:`, err.message);
      }
    }
    if (throttleMs > 0 && i + batchSize < notes.length) await sleep(throttleMs);
  }

  // 4. Process Routines
  console.log('[4/5] Scanning exam routines...');
  let routines = [];
  try {
    if (isPg) {
      const res = await db.query('SELECT * FROM routine ORDER BY id ASC');
      routines = res.rows || [];
    } else {
      routines = await db.all('SELECT * FROM routine ORDER BY id ASC');
    }
  } catch (err) {
    console.warn('[Backfill] Routine scan skipped:', err.message);
  }

  stats.routines.scanned = routines.length;
  console.log(`Found ${routines.length} routine schedules.`);

  for (let i = 0; i < routines.length; i += batchSize) {
    const batch = routines.slice(i, i + batchSize);
    for (const row of batch) {
      try {
        const built = buildRoutineKnowledge(row);
        let existing = null;
        if (isPg) {
          const exRes = await db.query('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = $1', [built.resource.id]);
          existing = exRes.rows[0];
        } else {
          existing = await db.get('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = ?', built.resource.id);
        }

        if (existing && existing.content_hash === built.resource.content_hash && !existing.deleted_at) {
          stats.routines.skipped++;
          continue;
        }

        if (!isDryRun) {
          await persistKnowledgeResource(db, built);
        }
        stats.routines.indexed++;
      } catch (err) {
        stats.routines.failed++;
        console.error(`[Backfill] Routine ${row.id} indexing error:`, err.message);
      }
    }
    if (throttleMs > 0 && i + batchSize < routines.length) await sleep(throttleMs);
  }

  // 5. Process Comments
  console.log('[5/5] Scanning post comments...');
  let comments = [];
  try {
    if (isPg) {
      let modFilter = '';
      try {
        const hasModCol = (await db.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'post_comments' AND column_name = 'moderation_status'")).rows.length > 0;
        if (hasModCol) {
          modFilter = "AND (c.moderation_status IS NULL OR c.moderation_status = 'active')";
        }
      } catch (_) {}

      const res = await db.query(`
        SELECT c.*, s.name AS author_name, s.role AS author_role,
               p.title AS post_title, p.cohort_id AS post_cohort_id, p.semester_no AS post_semester_no,
               p.audience_scope AS post_audience_scope, p.target_all_semesters AS post_target_all_semesters,
               p.visibility AS post_visibility, p.deleted_at AS post_deleted_at
        FROM post_comments c
        JOIN posts p ON p.id = c.post_id
        LEFT JOIN students s ON s.studentId = c.user_id
        WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL ${modFilter}
        ORDER BY c.id ASC
      `);
      comments = res.rows || [];
    } else {
      comments = await db.all(`
        SELECT c.*, s.name AS author_name, s.role AS author_role,
               p.title AS post_title, p.cohort_id AS post_cohort_id, p.semester_no AS post_semester_no,
               p.audience_scope AS post_audience_scope, p.target_all_semesters AS post_target_all_semesters,
               p.visibility AS post_visibility, p.deleted_at AS post_deleted_at
        FROM post_comments c
        JOIN posts p ON p.id = c.post_id
        LEFT JOIN students s ON s.studentId = c.user_id
        WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL
        ORDER BY c.id ASC
      `);
    }
  } catch (err) {
    console.warn('[Backfill] Comments scan skipped:', err.message);
  }

  stats.comments.scanned = comments.length;
  console.log(`Found ${comments.length} active post comments.`);

  for (let i = 0; i < comments.length; i += batchSize) {
    const batch = comments.slice(i, i + batchSize);
    for (const comment of batch) {
      try {
        const parentPost = {
          id: comment.post_id,
          title: comment.post_title,
          cohort_id: comment.post_cohort_id,
          semester_no: comment.post_semester_no,
          audience_scope: comment.post_audience_scope,
          target_all_semesters: comment.post_target_all_semesters,
          visibility: comment.post_visibility
        };
        const built = buildCommentKnowledge(comment, parentPost);
        let existing = null;
        if (isPg) {
          const exRes = await db.query('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = $1', [built.resource.id]);
          existing = exRes.rows[0];
        } else {
          existing = await db.get('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = ?', built.resource.id);
        }

        if (existing && existing.content_hash === built.resource.content_hash && !existing.deleted_at) {
          stats.comments.skipped++;
          continue;
        }

        if (!isDryRun) {
          await persistKnowledgeResource(db, built);
        }
        stats.comments.indexed++;
      } catch (err) {
        stats.comments.failed++;
        console.error(`[Backfill] Comment ${comment.id} indexing error:`, err.message);
      }
    }
    if (throttleMs > 0 && i + batchSize < comments.length) await sleep(throttleMs);
  }

  // 6. Optional: Gandaki University Sync
  if (includeGu) {
    console.log('[Bonus] Syncing Gandaki University official public notices...');
    try {
      const { syncGandakiUniversityNotices } = require('../lib/university-sync');
      const guStats = await syncGandakiUniversityNotices(db, { keywordOnly: isDryRun });
      stats.university = guStats;
    } catch (guErr) {
      console.warn('[Backfill] Gandaki University sync skipped:', guErr.message);
    }
  }

  console.log('----------------------------------------------------------------');
  console.log('BACKFILL SUMMARY:');
  console.log(`Posts       : Scanned=${stats.posts.scanned}, Indexed=${stats.posts.indexed}, Skipped(Unchanged)=${stats.posts.skipped}, Failed=${stats.posts.failed}`);
  console.log(`Assignments : Scanned=${stats.assignments.scanned}, Indexed=${stats.assignments.indexed}, Skipped(Unchanged)=${stats.assignments.skipped}, Failed=${stats.assignments.failed}`);
  console.log(`Notes       : Scanned=${stats.notes.scanned}, Indexed=${stats.notes.indexed}, Skipped(Unchanged)=${stats.notes.skipped}, Failed=${stats.notes.failed}`);
  console.log(`Routines    : Scanned=${stats.routines.scanned}, Indexed=${stats.routines.indexed}, Skipped(Unchanged)=${stats.routines.skipped}, Failed=${stats.routines.failed}`);
  console.log(`Comments    : Scanned=${stats.comments.scanned}, Indexed=${stats.comments.indexed}, Skipped(Unchanged)=${stats.comments.skipped}, Failed=${stats.comments.failed}`);
  if (includeGu) {
    console.log(`University  : Scanned=${stats.university.scanned}, Indexed=${stats.university.indexed}, Skipped=${stats.university.skipped}, Failed=${stats.university.failed}`);
  }
  console.log('================================================================');

  return stats;
}

if (require.main === module) {
  const { isDryRun, isApply, batchSize, throttleMs, includeGu, dbUrl, allowProduction } = parseArgs();

  // Safety resolution for target database
  let targetUrl = dbUrl || process.env.STAGING_DATABASE_URL || process.env.KYANA_TEST_DATABASE_URL;

  // Protect against accidental execution on production Neon
  const candidateUrl = targetUrl || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const isNeonProd = candidateUrl && (candidateUrl.includes('ep-fancy-mud') || candidateUrl.includes('neon.tech'));

  if (isNeonProd && isApply && !allowProduction) {
    console.error('================================================================');
    console.error('SAFETY BLOCKED: Target database appears to be production Neon!');
    console.error('Direct --apply on production is prohibited without explicit --allow-production.');
    console.error('For staging testing, use --db-url=<staging_url> or set STAGING_DATABASE_URL.');
    console.error('================================================================');
    process.exit(1);
  }

  // If no targetUrl provided and not in production, prefer local test postgres if available
  if (!targetUrl && process.env.NODE_ENV !== 'production' && !isNeonProd) {
    targetUrl = 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';
  }

  let pool = null;
  let db = null;

  async function execute() {
    if (targetUrl) {
      const { Pool } = require('pg');
      pool = new Pool({ connectionString: targetUrl });
      const masked = targetUrl.replace(/:[^@]+@/, ':****@');
      console.log(`[Backfill] Connected to targeted database: ${masked}`);
      db = pool;
    } else {
      db = require('../db');
    }

    return runBackfill(db, { isDryRun, batchSize, throttleMs, includeGu });
  }

  execute()
    .then(async () => {
      console.log('Backfill process completed successfully.');
      if (pool) {
        try { await pool.end(); } catch (_) {}
      }
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Backfill fatal error:', err.message);
      if (pool) {
        try { await pool.end(); } catch (_) {}
      }
      process.exit(1);
    });
}

module.exports = {
  runBackfill
};
