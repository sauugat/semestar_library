'use strict';

/**
 * KYANA AI 3.0 — Unified Knowledge Retrieval Engine
 *
 * Implements searchKnowledge(db, academicContext, query, options)
 *
 * Features:
 *   1. Academic authorization filtered directly in SQL:
 *      - Server-authoritative isolation matching assertContentAccess & buildAcademicContentFilter
 *      - Scoped by current semester, cohort, visibility, and audience scope
 *      - Authors always see own content; Admins see all non-deleted records
 *      - Filters out soft-deleted and hidden records (deleted_at IS NULL AND hidden_at IS NULL)
 *   2. Real-time freshness:
 *      - Joins live source tables (posts, assignments) to fetch live title & deadline
 *      - Drops orphaned indexed rows where source record was hard deleted
 *   3. Hybrid search scoring:
 *      - Vector cosine similarity (pgvector <=> operator)
 *      - Full-text search rank (ts_rank_cd on 'simple' text search)
 *      - Source authority tier boost (tiers 1–5)
 *      - Exponential recency decay
 *   4. Graceful degradation:
 *      - Embeds query with 2-second timeout
 *      - If embedding times out or fails, falls back cleanly to keyword/FTS search
 *      - Zero 500s on upstream AI outages
 */

const { isKnowledgeV3Enabled } = require('./knowledge-schema');
const { embedText, EMBEDDING_DIM } = require('./knowledge-embeddings');

const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_SCORE = 0.40;
const MIN_RELEVANCE_SCORE = 0.40;
const MIN_KEYWORD_EVIDENCE_SCORE = 0.08;
const MIN_SEMANTIC_EVIDENCE_SCORE = 0.50;
const EMBED_TIMEOUT_MS = 2000;

/**
 * Normalizes query string for PostgreSQL plainto_tsquery or ILIKE fallback.
 */
function sanitizeQuery(query) {
  return String(query || '').trim().slice(0, 500);
}

/**
 * Executes a promise with a hard timeout.
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const err = new Error(`Query embedding timed out after ${ms}ms`);
      err.name = 'TimeoutError';
      setTimeout(() => reject(err), ms);
    })
  ]);
}

/**
 * Main search function for KYANA AI 3.0 knowledge base.
 *
 * @param {object} db Database client/pool
 * @param {object} academicContext Authoritative user context
 * @param {string} query Search query string
 * @param {object} [options] Search options
 * @param {number} [options.limit=10] Max items to return
 * @param {number} [options.minScore=0.3] Minimum relevance score threshold
 * @param {boolean} [options.includeContent=true] Whether to include chunk content
 * @param {number} [options.timeoutMs=2000] Timeout for query embedding
 * @returns {Promise<Array<object>>} Ranked, authorized knowledge results
 */
async function searchKnowledge(db, academicContext = {}, query = '', options = {}) {
  if (!isKnowledgeV3Enabled()) {
    return [];
  }

  const cleanQuery = sanitizeQuery(query);
  if (!cleanQuery) {
    return [];
  }

  const limit = Math.max(1, Math.min(options.limit || DEFAULT_LIMIT, 50));
  const minScore = typeof options.minScore === 'number' ? options.minScore : DEFAULT_MIN_SCORE;
  const includeContent = options.includeContent !== false;
  const timeoutMs = options.timeoutMs || EMBED_TIMEOUT_MS;

  const isPg = Boolean(db && (db.isPostgres || (db.query && !db.all)));

  const searchMode = options.searchMode || 'hybrid';

  // 1. Parallel query embedding with graceful timeout fallback (skipped in keyword_only mode)
  let queryVector = null;
  if (options.queryVector) {
    queryVector = options.queryVector;
  } else if (searchMode !== 'keyword_only') {
    try {
      const rawVector = await withTimeout(
        embedText(cleanQuery, { taskType: 'RETRIEVAL_QUERY' }),
        timeoutMs
      );
      if (Array.isArray(rawVector) && rawVector.length === EMBEDDING_DIM) {
        queryVector = '[' + rawVector.join(',') + ']';
      }
    } catch (embedErr) {
      console.warn(`[KYANA Knowledge Search] Embedding fallback triggered: ${embedErr.message}`);
      queryVector = null;
    }
  }

  // If running in SQLite / non-pg test environment, execute fallback
  if (!isPg) {
    return searchKnowledgeSQLite(db, academicContext, cleanQuery, { limit, minScore, includeContent });
  }

  // 2. Build PostgreSQL Query with In-SQL Academic Authorization
  const params = [];

  // Query vector parameter
  let vectorParamClause = 'NULL';
  if (queryVector) {
    params.push(queryVector);
    vectorParamClause = `$${params.length}::vector(768)`;
  }

  // Text query parameter for FTS
  params.push(cleanQuery);
  const textQueryParam = `$${params.length}`;

  // Academic Context Parameters
  const studentId = academicContext.studentId || null;
  const role = academicContext.role || 'student';
  const isAdmin = role === 'admin';
  const isTeacher = role === 'teacher';

  const cohortId = academicContext.cohortId || (academicContext.cohort && academicContext.cohort.id) || null;
  const currentSemester = academicContext.currentSemester ||
    (academicContext.cohort && academicContext.cohort.currentSemester) ||
    academicContext.semester_no || null;
  const assignedSemesters = Array.isArray(academicContext.assignedSemesters) ? academicContext.assignedSemesters : [];

  // 3. Authorization SQL Clause
  let authClause = '';
  if (isAdmin) {
    authClause = 'TRUE';
  } else if (isTeacher) {
    params.push(studentId);
    const studentIdParam = `$${params.length}`;
    params.push(assignedSemesters);
    const assignedSemestersParam = `$${params.length}`;

    const authorCondition = `(r.author_id IS NOT NULL AND r.author_id = ${studentIdParam})`;
    authClause = `(
      ${authorCondition}
      OR (
        r.visibility IN ('everyone', 'teachers_only')
        AND (
          CARDINALITY(${assignedSemestersParam}::integer[]) = 0
          OR r.target_all_semesters = 1
          OR r.semester_no IS NULL
          OR r.semester_no = ANY(${assignedSemestersParam}::integer[])
          OR EXISTS (
            SELECT 1 FROM post_target_semesters pts
            WHERE pts.post_id = p.id AND pts.semester = ANY(${assignedSemestersParam}::integer[])
          )
        )
      )
    )`;
  } else {
    // Student / CR authorization
    params.push(studentId);
    const studentIdParam = `$${params.length}`;
    params.push(cohortId);
    const cohortIdParam = `$${params.length}`;
    params.push(currentSemester ? Number(currentSemester) : null);
    const semesterParam = `$${params.length}`;

    const authorCondition = `(r.author_id IS NOT NULL AND r.author_id = ${studentIdParam})`;
    const visibilityCondition = `r.visibility IN ('everyone', 'students_only', 'cohort_only')`;

    // Historical Semester Access (G3):
    // 1. Own cohort content: strictly restricted to student's own cohort_id AND semester_no <= currentSemester
    // 2. All-students / universal content: audience_scope = 'all_students' AND semester_no <= currentSemester
    // 3. Never future semesters (> currentSemester)
    // 4. Other cohort's content is strictly hidden even if semester <= currentSemester
    const accessScopeCondition = `(
      (
        (r.audience_scope = 'all_students' OR r.cohort_id IS NULL)
        AND (
          r.target_all_semesters = 1
          OR ${semesterParam}::integer IS NULL
          OR r.semester_no IS NULL
          OR r.semester_no <= ${semesterParam}::integer
          OR EXISTS (
            SELECT 1 FROM post_target_semesters pts
            WHERE pts.post_id = p.id AND pts.semester <= ${semesterParam}::integer
          )
        )
      )
      OR (
        r.cohort_id IS NOT NULL
        AND ${cohortIdParam}::text IS NOT NULL
        AND r.cohort_id = ${cohortIdParam}::text
        AND (
          r.target_all_semesters = 1
          OR ${semesterParam}::integer IS NULL
          OR r.semester_no IS NULL
          OR r.semester_no <= ${semesterParam}::integer
          OR EXISTS (
            SELECT 1 FROM post_target_semesters pts
            WHERE pts.post_id = p.id AND pts.semester <= ${semesterParam}::integer
          )
        )
      )
    )`;

    authClause = `(
      ${authorCondition}
      OR (
        ${visibilityCondition}
        AND ${accessScopeCondition}
      )
    )`;
  }

  // 4. Construct Full Unified Search Query
  params.push(limit);
  const limitParam = `$${params.length}`;

  const hasVector = Boolean(queryVector);

  let combinedScoreFormula;
  let evidenceCondition;
  if (searchMode === 'vector_only' && hasVector) {
    combinedScoreFormula = '(0.85 * vector_sim) + (0.10 * authority_boost) + (0.05 * recency_boost)';
    evidenceCondition = `vector_sim >= ${MIN_SEMANTIC_EVIDENCE_SCORE}`;
  } else if (searchMode === 'keyword_only' || !hasVector) {
    combinedScoreFormula = '(0.85 * fts_score) + (0.10 * authority_boost) + (0.05 * recency_boost)';
    evidenceCondition = `fts_score >= ${MIN_KEYWORD_EVIDENCE_SCORE}`;
  } else {
    // Hybrid mode (default)
    combinedScoreFormula = '(0.50 * vector_sim) + (0.35 * fts_score) + (0.10 * authority_boost) + (0.05 * recency_boost)';
    evidenceCondition = `(fts_score >= ${MIN_KEYWORD_EVIDENCE_SCORE} OR vector_sim >= ${MIN_SEMANTIC_EVIDENCE_SCORE})`;
  }

  const sql = `
    WITH ranked_chunks AS (
      SELECT
        r.id AS resource_id,
        r.resource_type,
        r.canonical_id,
        r.source_authority_tier,
        r.web_url,
        r.mobile_route,
        r.mobile_params,
        r.created_at,
        c.content AS chunk_content,
        COALESCE(p.title, a.title, r.title) AS live_title,
        a.deadline AS live_deadline,

        -- Vector cosine similarity
        ${hasVector ? `GREATEST(0.0, 1.0 - (c.embedding <=> ${vectorParamClause}))` : '0.0'} AS vector_sim,

        -- Full-text search score
        LEAST(1.0, ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', ${textQueryParam})) * 2.0) AS fts_score,

        -- Authority boost: Tier 1 -> 1.0, Tier 5 -> 0.2
        ((6 - r.source_authority_tier) / 5.0) AS authority_boost,

        -- Exponential recency decay (60-day half-life)
        EXP(-GREATEST(0.0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - r.created_at)) / 86400.0) / 60.0) AS recency_boost

      FROM knowledge_resources r
      JOIN knowledge_chunks c ON c.resource_id = r.id
      LEFT JOIN posts p ON r.resource_type IN ('post', 'notice') AND p.id = r.canonical_id
      LEFT JOIN assignments a ON r.resource_type = 'assignment' AND a.id = r.canonical_id
      WHERE
        -- Freshness & Isolation: Exclude soft-deleted and hidden
        r.deleted_at IS NULL
        AND r.hidden_at IS NULL

        -- Source existence: Post or assignment must still exist in base table
        AND (
          (r.resource_type IN ('post', 'notice') AND p.id IS NOT NULL)
          OR (r.resource_type = 'assignment' AND a.id IS NOT NULL)
        )

        -- In-SQL Academic Authorization
        AND ${authClause}
    ),
    scored AS (
      SELECT
        resource_id,
        resource_type,
        canonical_id,
        live_title,
        live_deadline,
        chunk_content,
        source_authority_tier,
        web_url,
        mobile_route,
        mobile_params,
        created_at,
        vector_sim,
        fts_score,
        ${combinedScoreFormula} AS combined_score,
        ROW_NUMBER() OVER (
          PARTITION BY resource_id
          ORDER BY ${combinedScoreFormula} DESC
        ) AS rank_in_resource
      FROM ranked_chunks
    )
    SELECT
      resource_id AS id,
      resource_type AS "resourceType",
      canonical_id AS "canonicalId",
      live_title AS title,
      live_deadline AS deadline,
      chunk_content AS content,
      ROUND(combined_score::numeric, 4) AS score,
      web_url AS "webUrl",
      mobile_route AS "mobileRoute",
      mobile_params AS "mobileParams",
      source_authority_tier AS "authorityTier",
      created_at AS "createdAt"
    FROM scored
    WHERE rank_in_resource = 1
      AND combined_score >= ${minScore}
      -- Minimum Evidence Rule (G4)
      AND (${evidenceCondition})
    ORDER BY combined_score DESC
    LIMIT ${limitParam};
  `;

  const result = await db.query(sql, params);

  return result.rows.map(row => ({
    id: row.id,
    resourceType: row.resourceType,
    canonicalId: Number(row.canonicalId),
    title: row.title,
    deadline: row.deadline || null,
    content: includeContent ? row.content : undefined,
    score: Number(row.score),
    webUrl: row.webUrl,
    mobileRoute: row.mobileRoute,
    mobileParams: typeof row.mobileParams === 'string' ? JSON.parse(row.mobileParams) : (row.mobileParams || {}),
    authorityTier: Number(row.authorityTier),
    createdAt: row.createdAt
  }));
}

/**
 * SQLite fallback implementation for offline test environments.
 */
async function searchKnowledgeSQLite(db, academicContext, cleanQuery, options) {
  const { limit, minScore, includeContent } = options;
  const studentId = academicContext.studentId || null;
  const role = academicContext.role || 'student';
  const isAdmin = role === 'admin';
  const cohortId = academicContext.cohortId || null;
  const currentSemester = academicContext.currentSemester || null;

  const rows = await db.all(`
    SELECT
      r.id,
      r.resource_type AS resourceType,
      r.canonical_id AS canonicalId,
      r.title,
      r.author_id,
      r.cohort_id,
      r.semester_no,
      r.audience_scope,
      r.target_all_semesters,
      r.visibility,
      r.source_authority_tier AS authorityTier,
      r.web_url AS webUrl,
      r.mobile_route AS mobileRoute,
      r.mobile_params AS mobileParams,
      r.created_at AS createdAt,
      c.content
    FROM knowledge_resources r
    JOIN knowledge_chunks c ON c.resource_id = r.id
    WHERE r.deleted_at IS NULL AND r.hidden_at IS NULL
  `);

  const results = [];
  const queryLower = cleanQuery.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(Boolean);

  for (const row of rows) {
    // 1. Authorization check
    let authorized = false;
    if (isAdmin || (studentId && row.author_id === studentId)) {
      authorized = true;
    } else if (role === 'student' || role === 'cr') {
      const visOk = ['public', 'students-only', 'everyone', 'students_only', 'cohort_only'].includes(row.visibility);
      const cohortOk = row.audience_scope !== 'cohort' || !row.cohort_id || row.cohort_id === cohortId;
      const semOk = row.target_all_semesters === 1 || !row.semester_no || row.semester_no === currentSemester;
      authorized = visOk && cohortOk && semOk;
    } else if (role === 'teacher') {
      authorized = ['public', 'private', 'teachers_only', 'everyone'].includes(row.visibility);
    }

    if (!authorized) continue;

    // 2. Keyword relevance scoring
    const contentLower = (row.content || '').toLowerCase();
    const titleLower = (row.title || '').toLowerCase();
    let matches = 0;
    for (const term of queryTerms) {
      if (titleLower.includes(term)) matches += 2;
      if (contentLower.includes(term)) matches += 1;
    }

    if (matches === 0 && queryTerms.length > 0) continue;

    const baseScore = queryTerms.length > 0 ? Math.min(1.0, matches / (queryTerms.length * 2)) : 0.5;
    const authBoost = (6 - Number(row.authorityTier || 5)) / 5.0;
    const finalScore = Number(((0.75 * baseScore) + (0.25 * authBoost)).toFixed(4));

    if (finalScore >= minScore) {
      results.push({
        id: row.id,
        resourceType: row.resourceType,
        canonicalId: Number(row.canonicalId),
        title: row.title,
        deadline: null,
        content: includeContent ? row.content : undefined,
        score: finalScore,
        webUrl: row.webUrl,
        mobileRoute: row.mobileRoute,
        mobileParams: typeof row.mobileParams === 'string' ? JSON.parse(row.mobileParams) : (row.mobileParams || {}),
        authorityTier: Number(row.authorityTier),
        createdAt: row.createdAt
      });
    }
  }

  // Deduplicate by id and sort descending
  const seen = new Set();
  const deduped = [];
  results.sort((a, b) => b.score - a.score);
  for (const r of results) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      deduped.push(r);
    }
  }

  return deduped.slice(0, limit);
}

module.exports = {
  searchKnowledge,
  sanitizeQuery,
  DEFAULT_MIN_SCORE,
  MIN_RELEVANCE_SCORE,
  MIN_KEYWORD_EVIDENCE_SCORE,
  MIN_SEMANTIC_EVIDENCE_SCORE
};
