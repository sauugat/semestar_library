'use strict';
const { asKnowledgeDb } = require('./knowledge-db');

const crypto = require('crypto');
const { persistKnowledgeResource } = require('./knowledge-sync');
const { buildPostKnowledge, buildAssignmentKnowledge, buildNoteKnowledge, buildRoutineKnowledge } = require('./knowledge-builder');

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function secureCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Processes pending or failed jobs with concurrency locking and retries.
 *
 * @param {object} db Database adapter
 * @param {object} [options]
 * @param {number} [options.batchSize=10]
 * @returns {Promise<{ processed: number, succeeded: number, failed: number }>}
 */
async function processPendingJobs(db, options = {}) {
  db = asKnowledgeDb(db);
  const batchSize = options.batchSize || 10;
  const isPg = Boolean(db.isPostgres || (db.query && !db.all));

  let lockedJobs = [];

  if (isPg) {
    // Acquire jobs with row-level locks using FOR UPDATE SKIP LOCKED
    const client = (db.pool && typeof db.pool.connect === 'function') ? await db.pool.connect() : null;
    const runner = client || db;

    try {
      if (client) await client.query('BEGIN');

      const lockRes = await runner.query(`
        UPDATE knowledge_jobs
        SET status = 'processing',
            locked_at = CURRENT_TIMESTAMP,
            attempts = attempts + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (
          SELECT id FROM knowledge_jobs
          WHERE (status IN ('pending', 'failed') OR (status = 'processing' AND locked_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'))
            AND attempts < max_attempts
            AND scheduled_at <= CURRENT_TIMESTAMP
          ORDER BY scheduled_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        RETURNING *
      `, [batchSize]);

      lockedJobs = lockRes.rows || [];
      if (client) await client.query('COMMIT');
    } catch (err) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('[KYANA Knowledge Worker] Job locking error:', err.message);
      return { processed: 0, succeeded: 0, failed: 0 };
    } finally {
      if (client) client.release();
    }
  } else {
    // SQLite locking for tests
    lockedJobs = await db.all(`
      SELECT * FROM knowledge_jobs
      WHERE status IN ('pending', 'failed')
        AND attempts < max_attempts
      ORDER BY scheduled_at ASC
      LIMIT ?
    `, batchSize);

    for (const job of lockedJobs) {
      await db.run(`
        UPDATE knowledge_jobs
        SET status = 'processing', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, job.id);
    }
  }

  let succeeded = 0;
  let failed = 0;

  for (const job of lockedJobs) {
    try {
      if (job.operation === 'delete') {
        if (isPg) {
          await db.query('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [job.resource_id]);
          await db.query("UPDATE knowledge_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1", [job.id]);
        } else {
          await db.run('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', job.resource_id);
          await db.run("UPDATE knowledge_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?", job.id);
        }
        succeeded++;
        continue;
      }

      // Handle 'index' or 'update' or 'sync'
      if (job.resource_type === 'post' || job.resource_type === 'notice') {
        const postId = job.resource_id.replace(/^post:/, '');
        let post = null;
        if (isPg) {
          const res = await db.query('SELECT p.*, s.role AS author_role FROM posts p JOIN students s ON s.studentId = p.user_id WHERE p.id = $1', [Number(postId)]);
          post = res.rows[0];
        } else {
          post = await db.get('SELECT p.*, s.role AS author_role FROM posts p JOIN students s ON s.studentId = p.user_id WHERE p.id = ?', Number(postId));
        }

        if (!post || post.deleted_at || post.moderation_status === 'removed') {
          // Source deleted or removed
          if (isPg) {
            await db.query('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [job.resource_id]);
            await db.query("UPDATE knowledge_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1", [job.id]);
          } else {
            await db.run('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', job.resource_id);
            await db.run("UPDATE knowledge_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?", job.id);
          }
          succeeded++;
          continue;
        }

        const built = buildPostKnowledge(post);
        await persistKnowledgeResource(db, built, options);
      } else if (job.resource_type === 'assignment') {
        const assignmentId = job.resource_id.replace(/^assignment:/, '');
        let assignment = null;
        if (isPg) {
          const res = await db.query('SELECT * FROM assignments WHERE id = $1', [Number(assignmentId)]);
          assignment = res.rows[0];
        } else {
          assignment = await db.get('SELECT * FROM assignments WHERE id = ?', Number(assignmentId));
        }

        if (!assignment) {
          if (isPg) {
            await db.query('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [job.resource_id]);
            await db.query("UPDATE knowledge_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1", [job.id]);
          } else {
            await db.run('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', job.resource_id);
            await db.run("UPDATE knowledge_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?", job.id);
          }
          succeeded++;
          continue;
        }

        const built = buildAssignmentKnowledge(assignment);
        await persistKnowledgeResource(db, built, options);
      }

      else if (job.resource_type === 'note' || job.resource_type === 'routine') {
        const id = Number(job.resource_id.split(':')[1]);
        const sql = job.resource_type === 'note'
          ? 'SELECT f.*, d.content AS extracted_content, d.indexed_at AS extraction_indexed_at FROM files f LEFT JOIN note_search_documents d ON d.id = f.id WHERE f.id = $1'
          : 'SELECT * FROM routine WHERE id = $1';
        const source = (await db.query(sql, [id])).rows[0];
        if (!source) await db.query('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [job.resource_id]);
        else await persistKnowledgeResource(db, job.resource_type === 'note' ? buildNoteKnowledge(source) : buildRoutineKnowledge(source), options);
      } else { throw new Error('Unsupported knowledge resource type'); }

      // Mark job completed
      if (isPg) {
        await db.query("UPDATE knowledge_jobs SET status = CASE WHEN revision = $2 THEN 'completed' ELSE 'pending' END, completed_at = CASE WHEN revision = $2 THEN CURRENT_TIMESTAMP ELSE NULL END, locked_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [job.id, job.revision]);
      } else {
        await db.run("UPDATE knowledge_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?", job.id);
      }
      succeeded++;
    } catch (err) {
      failed++;
      console.warn(`[KYANA Knowledge Worker] Job ${job.id} failed:`, err.message);
      // Exponential backoff for scheduled_at
      const backoffSec = Math.min(300, Math.pow(2, job.attempts) * 15);
      if (isPg) {
        await db.query(`
          UPDATE knowledge_jobs
          SET status = 'failed',
              last_error = $1,
              scheduled_at = CURRENT_TIMESTAMP + ($2 || ' seconds')::interval,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `, [err.message.slice(0, 500), `${backoffSec}`, job.id]);
      } else {
        await db.run(`
          UPDATE knowledge_jobs
          SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, err.message.slice(0, 500), job.id);
      }
    }
  }

  return { processed: lockedJobs.length, succeeded, failed };
}

/**
 * Reconciles knowledge resources against authoritative source tables:
 * - Detects and adds missing posts and assignments
 * - Identifies and removes orphans (source deleted)
 * - Detects stale content hashes
 *
 * @param {object} db Database adapter
 * @returns {Promise<{ missingEnqueued: number, orphansRemoved: number, staleEnqueued: number }>}
 */
async function reconcileKnowledge(db) {
  db = asKnowledgeDb(db);
  const isPg = Boolean(db.isPostgres || (db.query && !db.all));
  let missingEnqueued = 0;
  let orphansRemoved = 0;
  let staleEnqueued = 0;

  if (!isPg) {
    return { missingEnqueued: 0, orphansRemoved: 0, staleEnqueued: 0 };
  }

  // 1. Missing posts: Active posts that don't exist in knowledge_resources
  const missingPostsRes = await db.query(`
    SELECT p.*
    FROM posts p
    LEFT JOIN knowledge_resources r ON r.id = 'post:' || p.id
    WHERE r.id IS NULL
    LIMIT 100
  `);

  for (const post of missingPostsRes.rows) {
    const resourceId = `post:${post.id}`;
    const resourceType = post.category === 'notice' ? 'notice' : 'post';
    await db.query(`
      INSERT INTO knowledge_jobs (resource_id, resource_type, operation, status)
      VALUES ($1, $2, 'index', 'pending')
      ON CONFLICT (resource_id, operation) WHERE status IN ('pending', 'processing') DO NOTHING
    `, [resourceId, resourceType]);
    missingEnqueued++;
  }

  // 2. Missing assignments: Active assignments not in knowledge_resources
  const missingAssignmentsRes = await db.query(`
    SELECT a.*
    FROM assignments a
    LEFT JOIN knowledge_resources r ON r.id = 'assignment:' || a.id
    WHERE r.id IS NULL
    LIMIT 100
  `);

  for (const assignment of missingAssignmentsRes.rows) {
    const resourceId = `assignment:${assignment.id}`;
    await db.query(`
      INSERT INTO knowledge_jobs (resource_id, resource_type, operation, status)
      VALUES ($1, 'assignment', 'index', 'pending')
      ON CONFLICT (resource_id, operation) WHERE status IN ('pending', 'processing') DO NOTHING
    `, [resourceId]);
    missingEnqueued++;
  }

  // 3. Post orphans: knowledge_resources whose post was deleted
  const orphanPostsRes = await db.query(`
    SELECT r.id
    FROM knowledge_resources r
    LEFT JOIN posts p ON 'post:' || p.id = r.id
    WHERE r.resource_type IN ('post', 'notice')
      AND r.deleted_at IS NULL
      AND p.id IS NULL
    LIMIT 100
  `);

  for (const orphan of orphanPostsRes.rows) {
    await db.query('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [orphan.id]);
    orphansRemoved++;
  }

  // 4. Assignment orphans: knowledge_resources whose assignment was deleted
  const orphanAssignmentsRes = await db.query(`
    SELECT r.id
    FROM knowledge_resources r
    LEFT JOIN assignments a ON 'assignment:' || a.id = r.id
    WHERE r.resource_type = 'assignment'
      AND r.deleted_at IS NULL
      AND a.id IS NULL
    LIMIT 100
  `);

  for (const orphan of orphanAssignmentsRes.rows) {
    await db.query('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [orphan.id]);
    orphansRemoved++;
  }

  const { enqueueJob } = require('./knowledge-sync');
  for (const [type, table] of [['note', 'files'], ['routine', 'routine']]) {
    const missing = await db.query(`SELECT s.id FROM ${table} s LEFT JOIN knowledge_resources r ON r.id = $1 || ':' || s.id WHERE r.id IS NULL LIMIT 100`, [type]);
    for (const row of missing.rows) { await enqueueJob(db, `${type}:${row.id}`, type, 'index'); missingEnqueued++; }
    const removed = await db.query(`UPDATE knowledge_resources r SET deleted_at = CURRENT_TIMESTAMP WHERE r.resource_type = $1 AND r.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM ${table} s WHERE s.id = r.canonical_id) RETURNING r.id`, [type]);
    orphansRemoved += removed.rows.length;
  }
  const sources = await db.query(`SELECT r.id, r.resource_type, r.content_hash,
    CASE WHEN p.id IS NOT NULL THEN to_jsonb(p) WHEN a.id IS NOT NULL THEN to_jsonb(a) WHEN f.id IS NOT NULL THEN to_jsonb(f) || jsonb_build_object('extraction_indexed_at', d.indexed_at) ELSE to_jsonb(rt) END AS source
    FROM knowledge_resources r
    LEFT JOIN posts p ON r.resource_type IN ('post','notice') AND p.id = r.canonical_id
    LEFT JOIN assignments a ON r.resource_type = 'assignment' AND a.id = r.canonical_id
    LEFT JOIN files f ON r.resource_type = 'note' AND f.id = r.canonical_id
    LEFT JOIN note_search_documents d ON d.id = f.id
    LEFT JOIN routine rt ON r.resource_type = 'routine' AND rt.id = r.canonical_id
    WHERE r.deleted_at IS NULL AND (p.id IS NOT NULL OR a.id IS NOT NULL OR f.id IS NOT NULL OR rt.id IS NOT NULL)
    ORDER BY r.updated_at ASC LIMIT 100`);
  for (const row of sources.rows) {
    const build = { assignment: buildAssignmentKnowledge, post: buildPostKnowledge, notice: buildPostKnowledge, note: buildNoteKnowledge, routine: buildRoutineKnowledge }[row.resource_type];
    const built = build(row.source);
    if (built.resource.content_hash !== row.content_hash) {
      await enqueueJob(db, row.id, row.resource_type, 'sync'); staleEnqueued++;
    }
    await db.query('UPDATE knowledge_resources SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [row.id]);
  }
  return { missingEnqueued, orphansRemoved, staleEnqueued };
}

module.exports = {
  secureCompare,
  processPendingJobs,
  reconcileKnowledge
};
