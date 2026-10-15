'use strict';
const { asKnowledgeDb } = require('./knowledge-db');

const { isKnowledgeIndexingEnabled, isKnowledgeV3Enabled } = require('./knowledge-schema');
const { buildPostKnowledge, buildAssignmentKnowledge } = require('./knowledge-builder');
const { batchEmbedTexts, EMBEDDING_MODEL } = require('./knowledge-embeddings');

const HOOK_TIMEOUT_MS = Number(process.env.KYANA_HOOK_TIMEOUT_MS) || 8000;

/**
 * Executes a promise with a hard timeout.
 */
function withTimeout(promise, ms = HOOK_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Indexing timed out after ${ms}ms`)), ms))
  ]);
}

/**
 * Enqueues a retry job into knowledge_jobs safely.
 * Uses ON CONFLICT DO NOTHING to satisfy uq_kj_pending_resource_op.
 */
async function enqueueJob(db, resourceId, resourceType, operation, errorMsg = null) {
  db = asKnowledgeDb(db);
  try {
    const isPg = Boolean(db.isPostgres || (db.query && !db.all));
    const now = new Date().toISOString();
    const cleanError = errorMsg ? String(errorMsg).slice(0, 500) : null;

    if (isPg) {
      await db.query(`
        INSERT INTO knowledge_jobs (
          resource_id, resource_type, operation, status, last_error, scheduled_at, created_at, updated_at
        ) VALUES ($1, $2, $3, 'pending', $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (resource_id, operation) WHERE status IN ('pending', 'processing')
        DO UPDATE SET last_error = EXCLUDED.last_error, revision = knowledge_jobs.revision + 1, updated_at = CURRENT_TIMESTAMP
      `, [resourceId, resourceType, operation, cleanError]);
    } else {
      // SQLite fallback for local unit tests without pgvector
      await db.run(`
        INSERT OR REPLACE INTO knowledge_jobs (
          resource_id, resource_type, operation, status, last_error, scheduled_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
      `, resourceId, resourceType, operation, cleanError, now, now, now);
    }
  } catch (err) {
    console.error('[KYANA Knowledge Sync] Error enqueuing job:', err.message);
  }
}

/**
 * Indexes or updates a resource and its chunks in the unified knowledge database.
 * If content_hash is identical, skips re-embedding.
 *
 * @param {object} db Database adapter
 * @param {object} built Built knowledge object ({ resource, chunks })
 * @param {object} [options]
 * @returns {Promise<boolean>} True if indexed or skipped unchanged, false if queued
 */
async function persistKnowledgeResource(db, built, options = {}) {
  db = asKnowledgeDb(db);
  const { resource, chunks } = built;
  const isPg = Boolean(db.isPostgres || (db.query && !db.all));

  // 1. Check existing record to avoid redundant re-embedding
  let existing = null;
  if (isPg) {
    const res = await db.query('SELECT content_hash, deleted_at, hidden_at FROM knowledge_resources WHERE id = $1', [resource.id]);
    existing = res.rows[0] || null;
  } else {
    existing = await db.get('SELECT content_hash, deleted_at, hidden_at FROM knowledge_resources WHERE id = ?', resource.id);
  }

  // If content hash matches and not restored from soft delete, update scoping metadata only and return
  if (existing && existing.content_hash === resource.content_hash && !existing.deleted_at) {
    if (isPg) {
      await db.query(`
        UPDATE knowledge_resources
        SET source_authority_tier = ${Number(resource.source_authority_tier)}, hidden_at = ${resource.hidden_at ? 'CURRENT_TIMESTAMP' : 'NULL'}, title = $1,
            author_id = $2,
            author_role = $3,
            cohort_id = $4,
            semester_no = $5,
            audience_scope = $6,
            target_all_semesters = $7,
            visibility = $8,
            web_url = $9,
            mobile_route = $10,
            mobile_params = $11,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $12
      `, [
        resource.title, resource.author_id, resource.author_role, resource.cohort_id,
        resource.semester_no, resource.audience_scope, resource.target_all_semesters,
        resource.visibility, resource.web_url, resource.mobile_route, JSON.stringify(resource.mobile_params),
        resource.id
      ]);
    }
    return true;
  }

  // 2. Generate embeddings for all chunks in batch
  const texts = chunks.map(c => c.content);
  let vectors = options.vectors;
  if (!vectors) {
    if (options.keywordOnly) {
      vectors = texts.map(() => null);
    } else {
      try {
        vectors = await batchEmbedTexts(texts, { taskType: 'RETRIEVAL_DOCUMENT', ...options });
      } catch (embErr) {
        if (options.forceEmbedError) throw embErr;
        console.warn(`[KYANA Knowledge Sync] Embedding failed (${embErr.message}), indexing keywords and queuing vector retry.`);
        vectors = texts.map(() => null);
        if (process.env.NODE_ENV !== 'test') {
          try { await enqueueJob(db, resource.id, resource.resource_type, 'index', embErr.message); } catch (_) {}
        }
      }
    }
  }

  if (isPg && !options.inTransaction) {
    const nextOptions = { ...options, vectors, inTransaction: true };
    if (typeof db.withTransaction === 'function') {
      return db.withTransaction(tx => persistKnowledgeResource({ ...tx, query: async (sql, params = []) => ({ rows: await tx.all(sql, ...params) }) }, built, nextOptions));
    }
    const isPool = typeof db.connect === 'function' && db.totalCount !== undefined;
    if (isPool) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const clientDb = {
          ...client,
          isPostgres: true,
          query: (sql, params = []) => client.query(sql, params)
        };
        const result = await persistKnowledgeResource(clientDb, built, nextOptions);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw error;
      } finally {
        if (typeof client.release === 'function') client.release();
      }
    }
    if (typeof db.query === 'function') {
      await db.query('BEGIN');
      try {
        const result = await persistKnowledgeResource(db, built, nextOptions);
        await db.query('COMMIT');
        return result;
      } catch (error) {
        try { await db.query('ROLLBACK'); } catch (_) {}
        throw error;
      }
    }
    throw new Error('Knowledge writes require a transaction-capable PostgreSQL adapter');
  }

  // 3. Upsert resource
  if (isPg) {
    await db.query(`
      INSERT INTO knowledge_resources (
        id, resource_type, canonical_id, canonical_code, title, source_authority_tier,
        author_id, author_role, cohort_id, semester_no, audience_scope, target_all_semesters,
        visibility, web_url, mobile_route, mobile_params, created_at, updated_at, deleted_at,
        hidden_at, content_hash
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, $17, $18
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        source_authority_tier = EXCLUDED.source_authority_tier,
        author_id = EXCLUDED.author_id,
        author_role = EXCLUDED.author_role,
        cohort_id = EXCLUDED.cohort_id,
        semester_no = EXCLUDED.semester_no,
        audience_scope = EXCLUDED.audience_scope,
        target_all_semesters = EXCLUDED.target_all_semesters,
        visibility = EXCLUDED.visibility,
        web_url = EXCLUDED.web_url,
        mobile_route = EXCLUDED.mobile_route,
        mobile_params = EXCLUDED.mobile_params,
        updated_at = CURRENT_TIMESTAMP,
        deleted_at = NULL,
        hidden_at = EXCLUDED.hidden_at,
        content_hash = EXCLUDED.content_hash
    `, [
      resource.id, resource.resource_type, resource.canonical_id, resource.canonical_code,
      resource.title, resource.source_authority_tier, resource.author_id, resource.author_role,
      resource.cohort_id, resource.semester_no, resource.audience_scope, resource.target_all_semesters,
      resource.visibility, resource.web_url, resource.mobile_route, JSON.stringify(resource.mobile_params),
      resource.hidden_at, resource.content_hash
    ]);

    // 4. Delete existing chunks & re-insert fresh vector chunks
    await db.query('DELETE FROM knowledge_chunks WHERE resource_id = $1', [resource.id]);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = vectors[i];
      const chunkId = `${resource.id}:c${chunk.chunkIndex}`;
      const vectorStr = vector ? `[${vector.join(',')}]` : null;

      await db.query(`
        INSERT INTO knowledge_chunks (
          id, resource_id, chunk_index, content, embedding_model, embedding, page_number, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6::vector(768), $7, CURRENT_TIMESTAMP)
      `, [chunkId, resource.id, chunk.chunkIndex, chunk.content, EMBEDDING_MODEL, vectorStr, chunk.pageNumber || null]);
    }
  }

  return true;
}

/**
 * Hook: On Post / Notice created or updated.
 * Non-blocking for the student: awaits up to 2.5s, enqueues on failure.
 */
async function onPostSaved(db, post, options = {}) {
  db = asKnowledgeDb(db);
  if (!isKnowledgeIndexingEnabled()) return;
  const built = buildPostKnowledge(post);
  const authorId = post.user_id || post.author_id || post.authorId;
  const immediateAllowed = isKnowledgeV3Enabled(authorId) && !options.queueOnly;

  if (!immediateAllowed) {
    await enqueueJob(db, built.resource.id, built.resource.resource_type, 'index');
    return;
  }

  try {
    await withTimeout(persistKnowledgeResource(db, built, options), HOOK_TIMEOUT_MS);
  } catch (err) {
    console.warn(`[KYANA Knowledge Sync] Immediate post indexing failed (${err.message}). Enqueuing retry job.`);
    await enqueueJob(db, built.resource.id, built.resource.resource_type, 'index', err.message);
  }
}

/**
 * Hook: On Post deleted.
 * Must execute SYNCHRONOUSLY before request returns.
 */
async function onPostDeleted(db, postId) {
  db = asKnowledgeDb(db);
  if (!isKnowledgeIndexingEnabled()) return;
  const resourceId = `post:${postId}`;
  try {
    const isPg = Boolean(db.isPostgres || (db.query && !db.all));
    if (isPg) {
      await db.query('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [resourceId]);
      await db.query("UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE resource_type = 'comment' AND canonical_code = $1", [resourceId]);
    } else {
      await db.run('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', resourceId);
      await db.run("UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE resource_type = 'comment' AND canonical_code = ?", resourceId);
    }
  } catch (err) {
    console.error(`[KYANA Knowledge Sync] Error soft-deleting post index ${resourceId}:`, err.message);
    await enqueueJob(db, resourceId, 'post', 'delete', err.message);
  }
}

/**
 * Hook: On Post moderation status change (e.g. 3 reports reached -> hidden_at, or dismissed -> unhide).
 * Must execute SYNCHRONOUSLY before request returns.
 */
async function onPostModerationChanged(db, postId, { isHidden }) {
  db = asKnowledgeDb(db);
  if (!isKnowledgeIndexingEnabled()) return;
  const resourceId = `post:${postId}`;
  try {
    const isPg = Boolean(db.isPostgres || (db.query && !db.all));
    if (isPg) {
      if (isHidden) {
        await db.query('UPDATE knowledge_resources SET hidden_at = CURRENT_TIMESTAMP WHERE id = $1', [resourceId]);
        await db.query("UPDATE knowledge_resources SET hidden_at = CURRENT_TIMESTAMP WHERE resource_type = 'comment' AND canonical_code = $1", [resourceId]);
      } else {
        await db.query('UPDATE knowledge_resources SET hidden_at = NULL WHERE id = $1', [resourceId]);
        await db.query("UPDATE knowledge_resources SET hidden_at = NULL WHERE resource_type = 'comment' AND canonical_code = $1", [resourceId]);
      }
    } else {
      if (isHidden) {
        await db.run('UPDATE knowledge_resources SET hidden_at = CURRENT_TIMESTAMP WHERE id = ?', resourceId);
        await db.run("UPDATE knowledge_resources SET hidden_at = CURRENT_TIMESTAMP WHERE resource_type = 'comment' AND canonical_code = ?", resourceId);
      } else {
        await db.run('UPDATE knowledge_resources SET hidden_at = NULL WHERE id = ?', resourceId);
        await db.run("UPDATE knowledge_resources SET hidden_at = NULL WHERE resource_type = 'comment' AND canonical_code = ?", resourceId);
      }
    }
  } catch (err) {
    console.error(`[KYANA Knowledge Sync] Error updating post moderation status ${resourceId}:`, err.message);
  }
}

/**
 * Hook: On Comment created or updated.
 * Non-blocking for student/teacher: awaits up to HOOK_TIMEOUT_MS, enqueues on failure.
 */
async function onCommentSaved(db, comment, parentPost = null, options = {}) {
  db = asKnowledgeDb(db);
  if (!isKnowledgeIndexingEnabled()) return;

  const isPg = Boolean(db.isPostgres || (db.query && !db.all));
  let loadedParent = parentPost;
  let loadedComment = comment;

  if (typeof comment === 'number' || typeof comment === 'string') {
    const cid = Number(comment);
    if (isPg) {
      const res = await db.query(`
        SELECT c.*, s.name AS author_name, s.role AS author_role
        FROM post_comments c
        JOIN students s ON s.studentId = c.user_id
        WHERE c.id = $1
      `, [cid]);
      loadedComment = res.rows[0];
    } else {
      loadedComment = await db.get(`
        SELECT c.*, s.name AS author_name, s.role AS author_role
        FROM post_comments c
        JOIN students s ON s.studentId = c.user_id
        WHERE c.id = ?
      `, cid);
    }
  }

  if (!loadedComment) return;

  if (!loadedComment.author_role || !loadedComment.author_name) {
    const uid = loadedComment.user_id || loadedComment.studentId;
    if (uid) {
      const sRow = isPg
        ? (await db.query('SELECT role, name FROM students WHERE studentId = $1', [uid])).rows[0]
        : await db.get('SELECT role, name FROM students WHERE studentId = ?', uid);
      if (sRow) {
        loadedComment.author_role = loadedComment.author_role || sRow.role;
        loadedComment.author_name = loadedComment.author_name || sRow.name;
      }
    }
  }

  if (!loadedParent) {
    const pid = Number(loadedComment.post_id);
    if (isPg) {
      const pRes = await db.query('SELECT * FROM posts WHERE id = $1', [pid]);
      loadedParent = pRes.rows[0];
    } else {
      loadedParent = await db.get('SELECT * FROM posts WHERE id = ?', pid);
    }
  }

  if (!loadedParent || loadedParent.deleted_at || loadedParent.moderation_status === 'removed') {
    return;
  }

  const { buildCommentKnowledge } = require('./knowledge-builder');
  const built = buildCommentKnowledge(loadedComment, loadedParent);
  const authorId = loadedComment.user_id || loadedComment.studentId;
  const immediateAllowed = isKnowledgeV3Enabled(authorId) && !options.queueOnly;

  if (!immediateAllowed) {
    await enqueueJob(db, built.resource.id, 'comment', 'index');
    return;
  }

  try {
    await withTimeout(persistKnowledgeResource(db, built, options), HOOK_TIMEOUT_MS);
  } catch (err) {
    console.warn(`[KYANA Knowledge Sync] Immediate comment indexing failed (${err.message}). Enqueuing retry job.`);
    await enqueueJob(db, built.resource.id, 'comment', 'index', err.message);
  }
}

/**
 * Hook: On Comment deleted.
 * Must execute SYNCHRONOUSLY before request returns.
 */
async function onCommentDeleted(db, commentId) {
  db = asKnowledgeDb(db);
  if (!isKnowledgeIndexingEnabled()) return;
  const resourceId = `comment:${commentId}`;
  try {
    const isPg = Boolean(db.isPostgres || (db.query && !db.all));
    if (isPg) {
      await db.query('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [resourceId]);
    } else {
      await db.run('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', resourceId);
    }
  } catch (err) {
    console.error(`[KYANA Knowledge Sync] Error soft-deleting comment index ${resourceId}:`, err.message);
    await enqueueJob(db, resourceId, 'comment', 'delete', err.message);
  }
}

/**
 * Hook: On Comment moderation status change.
 * Must execute SYNCHRONOUSLY before request returns.
 */
async function onCommentModerationChanged(db, commentId, { isHidden }) {
  db = asKnowledgeDb(db);
  if (!isKnowledgeIndexingEnabled()) return;
  const resourceId = `comment:${commentId}`;
  try {
    const isPg = Boolean(db.isPostgres || (db.query && !db.all));
    if (isPg) {
      if (isHidden) {
        await db.query('UPDATE knowledge_resources SET hidden_at = CURRENT_TIMESTAMP WHERE id = $1', [resourceId]);
      } else {
        await db.query('UPDATE knowledge_resources SET hidden_at = NULL WHERE id = $1', [resourceId]);
      }
    } else {
      if (isHidden) {
        await db.run('UPDATE knowledge_resources SET hidden_at = CURRENT_TIMESTAMP WHERE id = ?', resourceId);
      } else {
        await db.run('UPDATE knowledge_resources SET hidden_at = NULL WHERE id = ?', resourceId);
      }
    }
  } catch (err) {
    console.error(`[KYANA Knowledge Sync] Error updating comment moderation status ${resourceId}:`, err.message);
  }
}

/**
 * Hook: On Assignment created or updated.
 * Non-blocking for teacher/student: awaits up to 2.5s, enqueues on failure.
 */
async function onAssignmentSaved(db, assignment, options = {}) {
  db = asKnowledgeDb(db);
  if (!isKnowledgeIndexingEnabled()) return;
  const built = buildAssignmentKnowledge(assignment);
  const authorId = assignment.createdBy || assignment.createdby || assignment.created_by;
  const immediateAllowed = isKnowledgeV3Enabled(authorId) && !options.queueOnly;

  if (!immediateAllowed) {
    await enqueueJob(db, built.resource.id, 'assignment', 'index');
    return;
  }

  try {
    await withTimeout(persistKnowledgeResource(db, built, options), HOOK_TIMEOUT_MS);
  } catch (err) {
    console.warn(`[KYANA Knowledge Sync] Immediate assignment indexing failed (${err.message}). Enqueuing retry job.`);
    await enqueueJob(db, built.resource.id, 'assignment', 'index', err.message);
  }
}

/**
 * Hook: On Assignment deleted.
 * Must execute SYNCHRONOUSLY before request returns.
 */
async function onAssignmentDeleted(db, assignmentId) {
  db = asKnowledgeDb(db);
  if (!isKnowledgeIndexingEnabled()) return;
  const resourceId = `assignment:${assignmentId}`;
  try {
    const isPg = Boolean(db.isPostgres || (db.query && !db.all));
    if (isPg) {
      await db.query('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [resourceId]);
    } else {
      await db.run('UPDATE knowledge_resources SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', resourceId);
    }
  } catch (err) {
    console.error(`[KYANA Knowledge Sync] Error soft-deleting assignment index ${resourceId}:`, err.message);
    await enqueueJob(db, resourceId, 'assignment', 'delete', err.message);
  }
}

module.exports = {
  persistKnowledgeResource,
  enqueueJob,
  onPostSaved,
  onPostDeleted,
  onPostModerationChanged,
  onPostStatusChanged: (db, id, { hidden }) => onPostModerationChanged(db, id, { isHidden: hidden }),
  onAssignmentSaved,
  onAssignmentDeleted,
  onCommentSaved,
  onCommentDeleted,
  onCommentModerationChanged
};
