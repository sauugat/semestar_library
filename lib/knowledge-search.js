'use strict';
const { asKnowledgeDb } = require('./knowledge-db');

const { isKnowledgeV3Enabled } = require('./knowledge-schema');
const { embedText, normalizeVector } = require('./knowledge-embeddings');
const { resourceFilter } = require('./kyana-access');
const { queryTerms, rankCandidates } = require('./knowledge-relevance');
const { buildPostKnowledge, buildAssignmentKnowledge, buildNoteKnowledge, buildRoutineKnowledge, buildCommentKnowledge, buildGUKnowledge } = require('./knowledge-builder');
const { parseChapterFilter, matchesChapter } = require('./note-search');
const { matchesDateFilter } = require('./nepali-dates');

const DEFAULT_MIN_SCORE = 0.35;
const MIN_RELEVANCE_SCORE = DEFAULT_MIN_SCORE;
const MIN_KEYWORD_EVIDENCE_SCORE = 0.08;
const MIN_SEMANTIC_EVIDENCE_SCORE = 0.50;
const sanitizeQuery = query => String(query || '').trim().slice(0, 500);

function buildExclusionCheck(excludeIds = []) {
  const rawList = Array.isArray(excludeIds) ? excludeIds : [];
  const fullIdSet = new Set();
  const numericIdSet = new Set();

  for (const item of rawList) {
    if (item === null || item === undefined) continue;
    const str = String(item).trim().toLowerCase();
    if (!str) continue;
    if (str.includes(':')) {
      fullIdSet.add(str);
    } else if (/^\d+$/.test(str)) {
      numericIdSet.add(Number(str));
    } else {
      fullIdSet.add(str);
    }
  }

  return (row) => {
    if (fullIdSet.size === 0 && numericIdSet.size === 0) return false;
    const rowId = String(row.id || '').toLowerCase();
    const typeAndCanonical = `${String(row.resourceType || '').toLowerCase()}:${Number(row.canonicalId)}`;
    if (fullIdSet.has(rowId) || fullIdSet.has(typeAndCanonical)) return true;
    if (numericIdSet.has(Number(row.canonicalId))) return true;
    return false;
  };
}

function filterCandidateByChapterAndDate(row, { parsedChapter = null, dateInfo = null, isExcluded = null } = {}) {
  if (typeof isExcluded === 'function' && isExcluded(row)) {
    return false;
  }
  if (parsedChapter) {
    if (row.resourceType === 'note') {
      const chap = row.chapter || row.source?.chapter || '';
      if (!matchesChapter(chap, parsedChapter)) return false;
    }
  }
  if (dateInfo && !dateInfo.unresolvable && (dateInfo.date || (dateInfo.startDate && dateInfo.endDate))) {
    if (row.resourceType === 'routine') {
      const examDate = row.source?.exam_date || row.source?.date;
      const cal = row.source?.calendar || 'BS';
      if (examDate && !matchesDateFilter(examDate, dateInfo, cal)) return false;
    } else if (row.resourceType === 'assignment') {
      const deadline = row.deadline || row.source?.deadline;
      if (deadline && !matchesDateFilter(deadline, dateInfo, 'AD')) return false;
    } else if (row.resourceType === 'post' || row.resourceType === 'notice') {
      const createdAt = row.source?.created_at || row.createdAt;
      if (createdAt && matchesDateFilter(createdAt, dateInfo, 'AD')) return true;
      const { parseNepaliDateExpression } = require('./nepali-dates');
      const textDate = parseNepaliDateExpression(`${row.title || ''} ${row.content || ''}`);
      if (textDate && !textDate.unresolvable && textDate.date && matchesDateFilter(textDate.date, dateInfo, 'AD')) {
        return true;
      }
      const isRelativeInquiry = /\b(tomorrow|bholi|voli|today|aaja|parsi)\b|भोलि|आज|पर्सि/i.test(String(dateInfo.expression || ''));
      if (isRelativeInquiry && /\b(holiday|bida|chutti|closed|off|postpon\w*|reschedul\w*|cancel\w*|exam)\b|बिदा|छुट्टी|परीक्षा/i.test(`${row.title || ''} ${row.content || ''}`)) {
        return true;
      }
      if (createdAt) return false;
    }
  }
  return true;
}

async function searchKnowledge(db, academicContext = {}, query = '', options = {}) {
  db = asKnowledgeDb(db);
  if (!isKnowledgeV3Enabled(academicContext?.studentId) || !academicContext?.authenticated) return [];
  const cleanQuery = sanitizeQuery(query);
  const semMatch = cleanQuery.match(/\b(?:semester|sem)\s*([0-9]{1,2})\b/i);
  if (semMatch && ['student', 'cr'].includes(academicContext?.role)) {
    const targetSem = parseInt(semMatch[1], 10);
    const userSem = academicContext?.cohort?.currentSemester || academicContext?.currentSemester;
    if (targetSem && userSem && targetSem !== userSem) {
      return [];
    }
  }
  const parsedChapter = options.chapter ? parseChapterFilter(options.chapter) : null;
  const dateInfo = options.dateInfo || null;
  const isExcluded = buildExclusionCheck(options.excludeIds || []);
  const terms = queryTerms(cleanQuery);
  if (!terms.length && !parsedChapter) return [];
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
  const minScore = Number.isFinite(options.minScore)
    ? Math.max(0, options.minScore)
    : (parsedChapter && terms.length <= 1 ? 0.15 : DEFAULT_MIN_SCORE);
  const isPg = Boolean(db && (db.isPostgres || (db.query && !db.all)));
  const params = [];
  const bind = value => { params.push(value); return `$${params.length}`; };
  const sqlFilter = (type, alias) => {
    const f = resourceFilter(academicContext, type, alias);
    let i = 0;
    return f.sql.replace(/\?/g, () => bind(f.params[i++]));
  };

  if (!isPg) {
    // SQLite does not have a pgvector index; never pay for an unused embedding.
    const rows = await db.all(`SELECT r.*, r.resource_type AS resourceType, r.canonical_id AS canonicalId,
      r.source_authority_tier AS authorityTier, r.created_at AS createdAt, c.content, c.chunk_index AS chunkIndex, c.page_number AS pageNumber
      FROM knowledge_resources r JOIN knowledge_chunks c ON c.resource_id = r.id
      LEFT JOIN files f ON r.resource_type = 'note' AND f.id = r.canonical_id
      LEFT JOIN note_search_documents d ON d.id = f.id
      LEFT JOIN routine rt ON r.resource_type = 'routine' AND rt.id = r.canonical_id
      WHERE r.deleted_at IS NULL AND r.hidden_at IS NULL
      ${options.excludeExternalSources ? "AND r.resource_type != 'gu_official'" : ''}`);
    const { readResource, resourceCard } = require('./kyana-access');
    const authorized = [];
    for (const row of rows) {
      if (options.excludeExternalSources && row.resourceType === 'gu_official') continue;
      if (isExcluded(row)) continue;
      const source = await readResource(db, academicContext, { type: row.resourceType, id: row.canonicalId });
      if (!source) continue;
      if (row.resourceType === 'note') source.extraction_indexed_at = (await db.get('SELECT indexed_at FROM note_search_documents WHERE id = ?', row.canonicalId))?.indexed_at || null;
      if (!isFresh(row, source)) continue;
      const candidate = {
        ...row,
        title: source.title || row.title,
        deadline: source.deadline || null,
        subject: source.subject || row.source?.subject || null,
        chapter: source.chapter || row.source?.chapter || null,
        semester: source.semester_no ?? source.semester ?? row.source?.semester ?? null,
        source,
        webUrl: resourceCard(row.resourceType, source)?.deepLink
      };
      if (!filterCandidateByChapterAndDate(candidate, { parsedChapter, dateInfo, isExcluded })) continue;
      authorized.push(candidate);
    }
    const effectiveRankQuery = terms.length > 0 ? cleanQuery : (options.chapter ? String(options.chapter) : cleanQuery);
    return publicResults(rankCandidates(effectiveRankQuery, authorized, limit, minScore), options);
  }

  const embeddingStart = performance.now();
  let vector = null;
  if (options.queryVector) {
    const values = typeof options.queryVector === 'string' ? JSON.parse(options.queryVector) : options.queryVector;
    vector = normalizeVector(values);
  } else if (options.searchMode !== 'keyword_only' && !Object.hasOwn(options, 'queryVector')) {
    const timeoutVal = Math.max(1, Math.round(options.timeoutMs || 2000));
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutVal)]) : AbortSignal.timeout(timeoutVal);
    try { vector = await embedText(cleanQuery, { taskType: 'RETRIEVAL_QUERY', signal }); }
    catch (error) { options.signal?.throwIfAborted(); }
  }
  const embeddingMs = performance.now() - embeddingStart;
  const v = vector ? `${bind(`[${vector.join(',')}]`)}::vector(768)` : null;
  const tsTerms = terms.length > 0 ? terms : ['chapter'];
  const tsQuery = bind(tsTerms.map(t => `'${t.replace(/'/g, "''")}'`).join(' | '));
  const postFilter = sqlFilter('post', 'p');
  const assignmentFilter = sqlFilter('assignment', 'a');
  const noteFilter = sqlFilter('note', 'f');
  const sems = require('./kyana-access').semestersFor(academicContext);
  const routineFilter = academicContext.role === 'admin' ? 'TRUE' : sems.length ? `rt.semester IN (${sems.map(bind).join(',')})` : 'FALSE';
  const commentPostFilter = sqlFilter('post', 'p_comm');
  const exactTitle = bind(cleanQuery.toLowerCase());
  const candidateLimit = bind(Math.min(300, Math.max(60, limit * 20)));
  const guClause = options.excludeExternalSources
    ? ''
    : "OR (r.resource_type = 'gu_official' AND r.deleted_at IS NULL AND r.hidden_at IS NULL)";
  const sql = `WITH candidates AS (
    SELECT r.id, r.resource_type AS "resourceType", r.canonical_id AS "canonicalId",
      r.content_hash, r.source_authority_tier AS "authorityTier", r.created_at AS "createdAt",
      r.web_url AS "webUrl", r.mobile_route AS "mobileRoute", r.mobile_params AS "mobileParams",
      COALESCE(p.title, a.title, f.title, r.title) AS title, a.deadline,
      c.content, c.chunk_index AS "chunkIndex", c.page_number AS "pageNumber",
      CASE
        WHEN p.id IS NOT NULL THEN to_jsonb(p)
        WHEN a.id IS NOT NULL THEN to_jsonb(a)
        WHEN f.id IS NOT NULL THEN to_jsonb(f) || jsonb_build_object('extraction_indexed_at', d.indexed_at)
        WHEN rt.id IS NOT NULL THEN to_jsonb(rt)
        WHEN pc.id IS NOT NULL THEN to_jsonb(pc) || jsonb_build_object('parent_post', to_jsonb(p_comm), 'author_name', s_comm.name, 'author_role', s_comm.role)
        ELSE jsonb_build_object('id', r.canonical_id, 'title', r.title)
      END AS source,
      ${v ? `COALESCE(1 - (c.embedding <=> ${v}), 0)` : '0'} AS vector_sim,
      ts_rank_cd(c.tsv_content, to_tsquery('simple', ${tsQuery})) AS fts_score
    FROM knowledge_resources r JOIN knowledge_chunks c ON c.resource_id = r.id
    LEFT JOIN posts p ON r.resource_type IN ('post', 'notice') AND p.id = r.canonical_id
    LEFT JOIN assignments a ON r.resource_type = 'assignment' AND a.id = r.canonical_id
    LEFT JOIN files f ON r.resource_type = 'note' AND f.id = r.canonical_id
    LEFT JOIN note_search_documents d ON d.id = f.id
    LEFT JOIN routine rt ON r.resource_type = 'routine' AND rt.id = r.canonical_id
    LEFT JOIN post_comments pc ON r.resource_type = 'comment' AND pc.id = r.canonical_id
    LEFT JOIN posts p_comm ON r.resource_type = 'comment' AND p_comm.id = pc.post_id
    LEFT JOIN students s_comm ON r.resource_type = 'comment' AND s_comm.studentId = pc.user_id
    WHERE r.deleted_at IS NULL AND r.hidden_at IS NULL
      AND ((p.id IS NOT NULL AND (${postFilter})
        AND COALESCE(to_jsonb(p)->>'moderation_status', 'active') = 'active'
        AND to_jsonb(p)->>'deleted_at' IS NULL AND to_jsonb(p)->>'hidden_at' IS NULL)
        OR (a.id IS NOT NULL AND (${assignmentFilter}))
        OR (f.id IS NOT NULL AND (${noteFilter}))
        OR (rt.id IS NOT NULL AND (${routineFilter}))
        OR (pc.id IS NOT NULL AND (${commentPostFilter})
          AND pc.deleted_at IS NULL AND COALESCE(to_jsonb(pc)->>'moderation_status', 'active') = 'active'
          AND to_jsonb(p_comm)->>'deleted_at' IS NULL AND to_jsonb(p_comm)->>'hidden_at' IS NULL)
        ${guClause})
      ${minScore <= 0.05 || parsedChapter ? '' : `AND (c.tsv_content @@ to_tsquery('simple', ${tsQuery}) ${v ? `OR (c.embedding IS NOT NULL AND 1 - (c.embedding <=> ${v}) >= ${MIN_SEMANTIC_EVIDENCE_SCORE})` : ''})`}
    ), diversified AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY fts_score DESC, vector_sim DESC) AS passage_rank FROM candidates
    ) SELECT * FROM diversified WHERE passage_rank <= 3
      ORDER BY (LOWER(title) = ${exactTitle}) DESC, (fts_score > 0) DESC, fts_score DESC, vector_sim DESC LIMIT ${candidateLimit}`;
  const start = performance.now();
  const response = await db.query(sql, params);
  options.onTiming?.({ embeddingMs, databaseMs: performance.now() - start, candidates: response.rows.length });
  const fresh = response.rows
    .filter(row => isFresh(row, row.source))
    .filter(row => filterCandidateByChapterAndDate(row, { parsedChapter, dateInfo, isExcluded }));
  const effectiveRankQuery = terms.length > 0 ? cleanQuery : (options.chapter ? String(options.chapter) : cleanQuery);
  return publicResults(rankCandidates(effectiveRankQuery, fresh, limit, minScore), options);
}

function isFresh(row, source) {
  if (!source) return false;
  if (!row.content_hash || row.content_hash.startsWith('hash_')) return true;
  if (row.resourceType === 'gu_official') return true;
  const built = ['post', 'notice'].includes(row.resourceType) ? buildPostKnowledge(source)
    : row.resourceType === 'assignment' ? buildAssignmentKnowledge(source)
    : row.resourceType === 'note' ? buildNoteKnowledge(source)
    : row.resourceType === 'routine' ? buildRoutineKnowledge(source)
    : (row.resourceType === 'comment' && source.parent_post) ? buildCommentKnowledge(source, source.parent_post)
    : null;
  if (!built) return false;
  if (row.resourceType === 'assignment') {
    return String(row.content_hash).split(':')[0] === String(built.resource.content_hash).split(':')[0];
  }
  return Boolean(built.resource.content_hash === row.content_hash);
}

function publicResults(rows, options) {
  return rows.map(row => {
    const isComment = row.resourceType === 'comment';
    const isGu = row.resourceType === 'gu_official';
    const parentId = isComment ? Number(row.source?.parent_post?.id || row.source?.post_id || row.canonicalId) : Number(row.canonicalId);
    const webUrl = isComment
      ? `/dashboard.html?post=${parentId}&comment=${Number(row.canonicalId)}`
      : (isGu ? (row.webUrl || row.web_url || row.source?.url || 'https://www.gandakiuniversity.edu.np') : `/api/ai/resources/${row.resourceType}/${Number(row.canonicalId)}/open`);
    const mobileRoute = isComment
      ? `/post/${parentId}`
      : (isGu ? (row.mobileRoute || row.mobile_route || `/notice/gu-${row.canonicalId}`) : (row.resourceType === 'note' ? `/material/${row.canonicalId}` : row.resourceType === 'routine' ? '/routine' : row.resourceType === 'assignment' ? `/assignments/${row.canonicalId}` : `/${row.resourceType === 'notice' ? 'notice' : 'post'}/${row.canonicalId}`));
    const mobileParams = isComment
      ? { id: parentId, commentId: Number(row.canonicalId) }
      : (isGu ? (row.mobileParams || row.mobile_params || { id: row.canonicalId, source: 'gandakiuniversity' }) : (row.resourceType === 'routine' ? { semester: row.source?.semester } : { id: Number(row.canonicalId) }));

    return {
      id: row.id,
      resourceType: row.resourceType,
      canonicalId: Number(row.canonicalId),
      title: row.title,
      subject: row.subject || row.source?.subject || row.source?.subject_name || null,
      chapter: row.chapter || row.source?.chapter || null,
      semester: row.semester ?? row.source?.semester_no ?? row.source?.semester ?? null,
      deadline: row.deadline || null,
      score: Number(row.score),
      content: options.includeContent === false ? undefined : row.content,
      chunkIndex: row.chunkIndex,
      pageNumber: row.pageNumber,
      webUrl,
      mobileRoute,
      mobileParams,
      authorityTier: Number(row.authorityTier),
      createdAt: row.createdAt
    };
  });
}

module.exports = { searchKnowledge, sanitizeQuery, DEFAULT_MIN_SCORE, MIN_RELEVANCE_SCORE, MIN_KEYWORD_EVIDENCE_SCORE, MIN_SEMANTIC_EVIDENCE_SCORE };
