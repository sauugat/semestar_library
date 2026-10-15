#!/usr/bin/env node
'use strict';

/**
 * KYANA AI 3.0 — Real Data Coverage Audit Script
 *
 * Inspects all eligible records across 6 resource categories:
 *   1. Posts & Notices (active vs hidden/deleted vs indexed)
 *   2. Assignments (active vs indexed)
 *   3. Notes & Files (text-extracted vs scanned empty PDFs vs indexed)
 *   4. Exam Routines (schedules vs indexed)
 *   5. Post Comments (active vs moderated/deleted vs indexed)
 *   6. Gandaki University Notices (institutional Tier 1 synced)
 *
 * Reports exact coverage ratios, embedding readiness, and queued retry jobs.
 *
 * Usage:
 *   node scripts/audit-real-data-coverage.js
 *   node scripts/audit-real-data-coverage.js --db-url="postgresql://..."
 */

const { asKnowledgeDb } = require('../lib/knowledge-db');

function parseArgs() {
  const args = process.argv.slice(2);
  let dbUrl = null;
  for (const arg of args) {
    if (arg.startsWith('--db-url=')) {
      dbUrl = arg.slice('--db-url='.length).trim();
    }
  }
  return { dbUrl };
}

async function auditRealDataCoverage(db) {
  db = asKnowledgeDb(db);
  const isPg = Boolean(db.isPostgres || (db.query && !db.all));

  console.log('================================================================');
  console.log('KYANA AI 3.0 — REAL DATA COVERAGE & EXTRACTION AUDIT');
  console.log('================================================================');

  const report = {
    posts: { total: 0, active: 0, deleted: 0, indexed: 0, coveragePct: 0 },
    assignments: { total: 0, active: 0, indexed: 0, coveragePct: 0 },
    notes: { total: 0, textExtracted: 0, scannedEmpty: 0, indexed: 0, coveragePct: 0 },
    routines: { total: 0, active: 0, indexed: 0, coveragePct: 0 },
    comments: { total: 0, active: 0, deletedOrModerated: 0, indexed: 0, coveragePct: 0 },
    university: { totalIndexed: 0 },
    vectors: { totalChunks: 0, embeddedChunks: 0, unassignedChunks: 0, pendingJobs: 0, failedJobs: 0 }
  };

  // 1. Posts & Notices
  try {
    const postRows = isPg
      ? (await db.query('SELECT id, deleted_at, hidden_at FROM posts')).rows
      : await db.all('SELECT id, deleted_at, hidden_at FROM posts');
    report.posts.total = postRows.length;
    report.posts.active = postRows.filter(p => !p.deleted_at && !p.hidden_at).length;
    report.posts.deleted = report.posts.total - report.posts.active;

    const indexedPosts = isPg
      ? (await db.query("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type IN ('post', 'notice') AND deleted_at IS NULL")).rows[0].c
      : (await db.get("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type IN ('post', 'notice') AND deleted_at IS NULL")).c;
    report.posts.indexed = Number(indexedPosts);
    report.posts.coveragePct = report.posts.active > 0
      ? Math.round((report.posts.indexed / report.posts.active) * 100)
      : 100;
  } catch (err) {
    console.warn('[Audit] Posts check failed:', err.message);
  }

  // 2. Assignments
  try {
    const assignRows = isPg
      ? (await db.query('SELECT id FROM assignments')).rows
      : await db.all('SELECT id FROM assignments');
    report.assignments.total = assignRows.length;
    report.assignments.active = assignRows.length;

    const indexedAssign = isPg
      ? (await db.query("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type = 'assignment' AND deleted_at IS NULL")).rows[0].c
      : (await db.get("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type = 'assignment' AND deleted_at IS NULL")).c;
    report.assignments.indexed = Number(indexedAssign);
    report.assignments.coveragePct = report.assignments.active > 0
      ? Math.round((report.assignments.indexed / report.assignments.active) * 100)
      : 100;
  } catch (err) {
    console.warn('[Audit] Assignments check failed:', err.message);
  }

  // 3. Notes & Files (distinguishing extracted text vs scanned PDFs)
  try {
    const fileRows = isPg
      ? (await db.query(`
          SELECT f.id, f.title, f.originalname, d.content AS extracted_content
          FROM files f
          LEFT JOIN note_search_documents d ON d.id = f.id
        `)).rows
      : await db.all(`
          SELECT f.id, f.title, f.originalname, d.content AS extracted_content
          FROM files f
          LEFT JOIN note_search_documents d ON d.id = f.id
        `);
    report.notes.total = fileRows.length;
    report.notes.textExtracted = fileRows.filter(f => f.extracted_content && f.extracted_content.trim().length > 0).length;
    report.notes.scannedEmpty = report.notes.total - report.notes.textExtracted;

    const indexedNotes = isPg
      ? (await db.query("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type = 'note' AND deleted_at IS NULL")).rows[0].c
      : (await db.get("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type = 'note' AND deleted_at IS NULL")).c;
    report.notes.indexed = Number(indexedNotes);
    report.notes.coveragePct = report.notes.total > 0
      ? Math.round((report.notes.indexed / report.notes.total) * 100)
      : 100;
  } catch (err) {
    console.warn('[Audit] Notes check failed:', err.message);
  }

  // 4. Routines
  try {
    const routineRows = isPg
      ? (await db.query('SELECT id FROM routine')).rows
      : await db.all('SELECT id FROM routine');
    report.routines.total = routineRows.length;
    report.routines.active = routineRows.length;

    const indexedRoutines = isPg
      ? (await db.query("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type = 'routine' AND deleted_at IS NULL")).rows[0].c
      : (await db.get("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type = 'routine' AND deleted_at IS NULL")).c;
    report.routines.indexed = Number(indexedRoutines);
    report.routines.coveragePct = report.routines.active > 0
      ? Math.round((report.routines.indexed / report.routines.active) * 100)
      : 100;
  } catch (err) {
    console.warn('[Audit] Routines check failed:', err.message);
  }

  // 5. Comments
  try {
    const hasModCol = isPg
      ? (await db.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'post_comments' AND column_name = 'moderation_status'")).rows.length > 0
      : false;

    const commentQuery = hasModCol
      ? 'SELECT id, deleted_at, moderation_status FROM post_comments'
      : 'SELECT id, deleted_at FROM post_comments';

    const commentRows = isPg
      ? (await db.query(commentQuery)).rows
      : await db.all(commentQuery);
    report.comments.total = commentRows.length;
    report.comments.active = commentRows.filter(c => !c.deleted_at && (!c.moderation_status || c.moderation_status === 'active')).length;
    report.comments.deletedOrModerated = report.comments.total - report.comments.active;

    const indexedComments = isPg
      ? (await db.query("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type = 'comment' AND deleted_at IS NULL")).rows[0].c
      : (await db.get("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type = 'comment' AND deleted_at IS NULL")).c;
    report.comments.indexed = Number(indexedComments);
    report.comments.coveragePct = report.comments.active > 0
      ? Math.round((report.comments.indexed / report.comments.active) * 100)
      : 100;
  } catch (err) {
    console.warn('[Audit] Comments check failed:', err.message);
  }

  // 6. Gandaki University Notices
  try {
    const guCount = isPg
      ? (await db.query("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type = 'gu_official' AND deleted_at IS NULL")).rows[0].c
      : (await db.get("SELECT COUNT(*) AS c FROM knowledge_resources WHERE resource_type = 'gu_official' AND deleted_at IS NULL")).c;
    report.university.totalIndexed = Number(guCount);
  } catch (err) {
    console.warn('[Audit] University notices check failed:', err.message);
  }

  // 7. Chunks & Vector Readiness
  try {
    if (isPg) {
      const chunkStats = (await db.query(`
        SELECT
          COUNT(*) AS total_chunks,
          COUNT(embedding) AS embedded_chunks
        FROM knowledge_chunks
      `)).rows[0];
      report.vectors.totalChunks = Number(chunkStats.total_chunks || 0);
      report.vectors.embeddedChunks = Number(chunkStats.embedded_chunks || 0);
      report.vectors.unassignedChunks = report.vectors.totalChunks - report.vectors.embeddedChunks;

      const jobStats = (await db.query(`
        SELECT
          COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_jobs,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed_jobs
        FROM knowledge_jobs
      `)).rows[0];
      report.vectors.pendingJobs = Number(jobStats.pending_jobs || 0);
      report.vectors.failedJobs = Number(jobStats.failed_jobs || 0);
    }
  } catch (err) {
    console.warn('[Audit] Vector chunk check failed:', err.message);
  }

  // Pretty Print Output
  console.log('\nRESOURCE COVERAGE BREAKDOWN:');
  console.log('----------------------------------------------------------------');
  console.log(`Posts & Notices     : Total=${report.posts.total} | Active=${report.posts.active} | Deleted/Hidden=${report.posts.deleted} | Indexed=${report.posts.indexed} [${report.posts.coveragePct}% Coverage]`);
  console.log(`Assignments         : Total=${report.assignments.total} | Active=${report.assignments.active} | Indexed=${report.assignments.indexed} [${report.assignments.coveragePct}% Coverage]`);
  console.log(`Notes / Documents   : Total=${report.notes.total} | Text-Extracted=${report.notes.textExtracted} | Scanned/Empty=${report.notes.scannedEmpty} | Indexed=${report.notes.indexed} [${report.notes.coveragePct}% Coverage]`);
  if (report.notes.scannedEmpty > 0) {
    console.log(`  └─ Note: ${report.notes.scannedEmpty} files indexed by metadata only (scanned image PDFs require external OCR pipeline)`);
  }
  console.log(`Exam Routines       : Total=${report.routines.total} | Active=${report.routines.active} | Indexed=${report.routines.indexed} [${report.routines.coveragePct}% Coverage]`);
  console.log(`Post Comments       : Total=${report.comments.total} | Active=${report.comments.active} | Moderated/Deleted=${report.comments.deletedOrModerated} | Indexed=${report.comments.indexed} [${report.comments.coveragePct}% Coverage]`);
  console.log(`Gandaki University  : Total Official Synced=${report.university.totalIndexed} (Tier 1 Authority)`);
  console.log('----------------------------------------------------------------');
  console.log('VECTOR & CHUNK HEALTH:');
  console.log(`Total Chunks        : ${report.vectors.totalChunks}`);
  console.log(`Embedded Chunks     : ${report.vectors.embeddedChunks}`);
  console.log(`Pending Retry Jobs  : ${report.vectors.pendingJobs}`);
  console.log(`Failed Jobs         : ${report.vectors.failedJobs}`);
  console.log('================================================================');

  return report;
}

if (require.main === module) {
  const { dbUrl } = parseArgs();
  const targetUrl = dbUrl || process.env.STAGING_DATABASE_URL || process.env.KYANA_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';

  let pool = null;
  let db = null;

  async function run() {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: targetUrl });
    const masked = targetUrl.replace(/:[^@]+@/, ':****@');
    console.log(`[Audit] Connected to database: ${masked}`);
    db = pool;
    return auditRealDataCoverage(db);
  }

  run()
    .then(async () => {
      if (pool) {
        try { await pool.end(); } catch (_) {}
      }
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Audit fatal error:', err.message);
      if (pool) {
        try { await pool.end(); } catch (_) {}
      }
      process.exit(1);
    });
}

module.exports = {
  auditRealDataCoverage
};
