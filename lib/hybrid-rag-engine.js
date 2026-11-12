'use strict';

const crypto = require('crypto');
const { ensureRagSchema } = require('./rag-schema');
const {
  CONCEPT_TAXONOMY,
  normalizeText,
  parseSemesterNumber,
  inferAcademicContextForQuery
} = require('./academic-document-understanding');
const {
  generateQueryEmbedding,
  cosineSimilarity
} = require('./semantic-chunker');
const kyanaAccess = require('./kyana-access');

const RRF_K = 60;
const DEFAULT_MIN_RELEVANCE_SCORE = Number(process.env.KYANA_RAG_MIN_RELEVANCE) || 0.32;

// Romanized Nepali & Devanagari academic query lexicon
const NEPALI_QUERY_LEXICON = {
  barema: 'about',
  bhaneko: 'is defined as',
  भनेको: 'is defined as',
  बारेमा: 'about',
  कसरी: 'how',
  kasari: 'how',
  kina: 'why',
  किन: 'why',
  kaha: 'where',
  kata: 'where',
  कता: 'where',
  कहाँ: 'where',
  deu: 'give',
  dinus: 'give',
  दिनुहोस्: 'give',
  बुझाउ: 'explain',
  bujhau: 'explain',
  sikaunu: 'teach',
  sikau: 'teach',
  padhne: 'study',
  farack: 'difference',
  farak: 'difference',
  फरक: 'difference',
  ra: 'and',
  र: 'and',
  ko: 'of',
  को: 'of',
  note: 'notes',
  nots: 'notes',
  नोट: 'notes',
  नोट्स: 'notes',
  purai: 'complete',
  sampurna: 'complete'
};

const QUERY_STOP_WORDS = new Set([
  'give', 'me', 'notes', 'note', 'about', 'on', 'for', 'the', 'a', 'an', 'of',
  'in', 'to', 'and', 'or', 'is', 'are', 'what', 'where', 'when', 'how', 'why',
  'can', 'i', 'study', 'find', 'explain', 'teach', 'describe', 'define', 'show',
  'complete', 'full', 'detailed', 'summary', 'please', 'help', 'understand',
  'with', 'example', 'examples', 'from', 'library', 'semester', 'course',
  'subject', 'chapter', 'unit', 'pdf', 'doc', 'file', 'resource', 'resources',
  'ko', 'barema', 'bhaneko', 'ke', 'ho', 'deu', 'dinus', 'malai', 'kasari',
  'kata', 'kaha', 'cha', 'chha', 'padhne', 'bujhau', 'sikau', 'purai',
  'भनेको', 'के', 'हो', 'बारेमा', 'नोट', 'नोट्स', 'दिनुहोस्', 'मलाई', 'कसरी', 'कहाँ', 'कता'
]);

/**
 * Phase 4.1: Academic Query Understanding (English + Romanized Nepali + Devanagari).
 */
async function understandAcademicQuery(db, rawQuery = '') {
  const originalQuery = String(rawQuery || '').trim();
  const lower = originalQuery.toLowerCase();

  const hasDevanagari = /[\u0900-\u097F]/.test(originalQuery);
  const hasRomanizedNepali = /\b(?:barema|bhaneko|kasari|deu|dinus|malai|kata|kaha|padhne|bujhau|sikau|farak)\b/i.test(lower);
  const language = hasDevanagari
    ? 'nepali_devanagari'
    : hasRomanizedNepali
      ? 'romanized_nepali'
      : 'english';

  let userIntent = 'explain_concept';
  let requestedFormat = 'progressive_explanation';

  if (/\b(?:compare|comparison|difference\s+between|vs\.?|versus|distinguish|farak|फरक)\b/i.test(lower)) {
    userIntent = 'compare_concepts';
    requestedFormat = 'comparison';
  } else if (/\b(?:where\s+can\s+i\s+study|where\s+is|which\s+(?:subject|chapter|note|file)|find\s+(?:notes|resources)|kata\s+cha|kaha\s+cha|कहाँ|कता)\b/i.test(lower)) {
    userIntent = 'find_resource';
    requestedFormat = 'resource_locator';
  } else if (/\b(?:complete\s+notes|full\s+notes|give\s+me\s+notes|notes\s+(?:about|on|for)|notes?\s+deu|purai\s+note|नोट)\b/i.test(lower)) {
    userIntent = 'provide_notes';
    requestedFormat = 'complete_notes';
  } else if (/\b(?:teach\s+me|step\s+by\s+step|how\s+does|how\s+to|kasari|sikau)\b/i.test(lower)) {
    userIntent = 'teach_concept';
    requestedFormat = 'step_by_step_explanation';
  }

  const cleanedPhrase = originalQuery
    .replace(/[\u0900-\u097F]+/g, (m) => NEPALI_QUERY_LEXICON[m] || ' ')
    .replace(/\b(?:give\s+me\s+(?:complete\s+)?notes?\s+(?:about|on|for)|give\s+me\s+notes?|explain|what\s+is|what\s+are|teach\s+me|where\s+can\s+i\s+(?:study|find|learn)|show\s+me\s+notes?\s+(?:on|about)|tell\s+me\s+about)\b/gi, ' ')
    .replace(/\b(?:ko\s+barema\s+notes?\s+deu|ko\s+barema|bhaneko\s+ke\s+ho|ko\s+notes?\s+deu|malai\s+|notes?\s+deu|kata\s+cha|kaha\s+padhne)\b/gi, ' ')
    .replace(/[?!.;,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const subQuestions = decomposeMultiConceptQuery(originalQuery, cleanedPhrase);

  const rawTokens = normalizeText(cleanedPhrase || originalQuery)
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !QUERY_STOP_WORDS.has(t));

  const matchedConcepts = [];
  const topicAliases = new Set();
  const extraRelatedConcepts = new Set();
  const technicalTerms = new Set(rawTokens);

  const normQuery = normalizeText(originalQuery);
  const normCleaned = normalizeText(cleanedPhrase);

  for (const concept of CONCEPT_TAXONOMY) {
    const canonicalLower = concept.canonical.toLowerCase();
    const allForms = [canonicalLower, ...concept.aliases, ...(concept.nepaliAliases || [])];
    const matchedForms = allForms.filter((alias) => {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, 'i').test(normQuery);
    });
    if (matchedForms.length > 0) {
      matchedConcepts.push(concept);
      for (const mf of matchedForms) {
        topicAliases.add(mf);
        technicalTerms.add(mf);
      }
      const askedBroadConcept = matchedForms.some(
        (mf) => mf === canonicalLower || concept.aliases.slice(0, 3).includes(mf)
      );
      if (askedBroadConcept) {
        topicAliases.add(concept.canonical);
        for (const syn of concept.aliases.slice(0, 5)) {
          topicAliases.add(syn);
          technicalTerms.add(syn);
        }
        for (const sib of concept.aliases.slice(5)) {
          extraRelatedConcepts.add(sib);
        }
      } else {
        for (const sib of concept.aliases) {
          if (!matchedForms.includes(sib)) {
            extraRelatedConcepts.add(sib);
          }
        }
      }
    }
  }

  const parenMatch = originalQuery.match(/([A-Za-z][A-Za-z0-9\s-]{2,50})\s*\(([A-Za-z0-9+-]{2,10})\)/);
  if (parenMatch) {
    topicAliases.add(parenMatch[1].trim().toLowerCase());
    topicAliases.add(parenMatch[2].trim().toLowerCase());
    technicalTerms.add(parenMatch[1].trim().toLowerCase());
    technicalTerms.add(parenMatch[2].trim().toLowerCase());
  }

  const mainTopic = matchedConcepts.length > 0 && (!normCleaned || normCleaned.length <= 4)
    ? matchedConcepts.map((c) => c.canonical).join(' & ')
    : (cleanedPhrase || (matchedConcepts[0] && matchedConcepts[0].canonical) || rawTokens.join(' ') || originalQuery);

  const searchTerms = Array.from(new Set([
    normalizeText(cleanedPhrase),
    ...Array.from(topicAliases),
    ...rawTokens
  ])).filter((t) => t && t.length >= 2);

  const academicContext = await inferAcademicContextForQuery(db, searchTerms);
  const mergedRelated = Array.from(new Set([
    ...academicContext.relatedConcepts,
    ...Array.from(extraRelatedConcepts)
  ]));

  return {
    originalQuery,
    mainTopic,
    cleanedTopicPhrase: normalizeText(cleanedPhrase) || rawTokens.join(' '),
    tokens: rawTokens,
    topicAliases: Array.from(topicAliases),
    technicalTerms: Array.from(technicalTerms),
    userIntent,
    requestedFormat,
    language,
    subQuestions,
    isMultiHop: subQuestions.length > 1,
    relevantConcepts: mergedRelated,
    candidateSubjects: academicContext.candidateSubjects,
    candidateUnits: academicContext.candidateSubjects.flatMap((s) => s.units || []).slice(0, 6),
    candidateChapters: academicContext.candidateSubjects.flatMap((s) => s.chapters || []).slice(0, 6)
  };
}

function decomposeMultiConceptQuery(originalQuery, cleanedPhrase) {
  const q = String(originalQuery || '').trim();
  const subTopics = [];

  const compareMatch = q.match(/\b(?:compare|difference\s+between|distinguish\s+between)\s+([^,.?!]+?)\s+(?:and|vs\.?|versus)\s+([^,.?!]+?)(?:\s+and\s+(?:explain|describe|how)\s+([^.?!]+))?$/i);
  if (compareMatch) {
    if (compareMatch[1]) subTopics.push(cleanSubTopic(compareMatch[1]));
    if (compareMatch[2]) subTopics.push(cleanSubTopic(compareMatch[2]));
    if (compareMatch[3]) subTopics.push(cleanSubTopic(compareMatch[3]));
    return subTopics.filter(Boolean);
  }

  const vsMatch = cleanedPhrase.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i);
  if (vsMatch) {
    return [cleanSubTopic(vsMatch[1]), cleanSubTopic(vsMatch[2])].filter(Boolean);
  }

  const andMatch = cleanedPhrase.match(/^([a-z0-9\s-]{2,35})\s+and\s+([a-z0-9\s-]{2,45})$/i);
  if (andMatch) {
    const left = cleanSubTopic(andMatch[1]);
    const right = cleanSubTopic(andMatch[2]);
    const rightWords = right.split(/\s+/);
    if (left.split(/\s+/).length === 1 && rightWords.length >= 2) {
      const sharedTail = rightWords.slice(1).join(' ');
      return [`${left} ${sharedTail}`, right];
    }
    if (left && right && left !== right) {
      return [left, right];
    }
  }

  return cleanedPhrase ? [cleanedPhrase] : [];
}

function cleanSubTopic(str) {
  return String(str || '')
    .replace(/\b(?:explain|describe|how|does|work|uses|both|the|a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandAcademicQuery(queryAnalysis) {
  const primaryTerms = new Set();
  const expandedPhrases = new Set();
  const relatedTerms = new Set();

  if (queryAnalysis.cleanedTopicPhrase) {
    primaryTerms.add(queryAnalysis.cleanedTopicPhrase.toLowerCase());
  }
  for (const tok of queryAnalysis.tokens || []) {
    if (tok.length >= 2) primaryTerms.add(tok.toLowerCase());
  }
  for (const alias of queryAnalysis.topicAliases || []) {
    expandedPhrases.add(alias.toLowerCase());
  }
  for (const sub of queryAnalysis.subQuestions || []) {
    const normSub = normalizeText(sub);
    if (normSub) expandedPhrases.add(normSub);
  }
  for (const rel of (queryAnalysis.relevantConcepts || []).slice(0, 8)) {
    relatedTerms.add(normalizeText(rel));
  }

  return {
    primaryTerms: Array.from(primaryTerms).filter(Boolean),
    expandedPhrases: Array.from(expandedPhrases).filter(Boolean),
    relatedTerms: Array.from(relatedTerms).filter(Boolean),
    allSearchTerms: Array.from(new Set([
      ...primaryTerms,
      ...expandedPhrases
    ])).filter((t) => t && t.length >= 2)
  };
}

function isDocumentAuthorizedForUser(fileOrChunk, user, options = {}) {
  if (!user) return true;
  if (fileOrChunk.deleted_at || fileOrChunk.hidden_at || ['removed', 'hidden'].includes(fileOrChunk.moderation_status)) {
    return false;
  }
  const role = String(user.role || 'student').toLowerCase().trim();
  const authContext = user.authenticated !== undefined ? user : { ...user, authenticated: true };
  if (role === 'admin') return true;

  const cohortId = fileOrChunk.cohort_id ?? null;
  const hasCohortId = cohortId !== null && cohortId !== undefined && String(cohortId).trim() !== '';
  const rawScope = String(fileOrChunk.audience_scope || '').trim().toLowerCase();
  const normalizedScope = (!hasCohortId && (!rawScope || rawScope === 'cohort' || rawScope === 'general'))
    ? 'all_students'
    : (rawScope || (hasCohortId ? 'cohort' : 'all_students'));
  const rawVisibility = String(fileOrChunk.visibility || '').trim().toLowerCase();
  const normalizedVisibility = (!rawVisibility || (rawVisibility === 'students' && normalizedScope === 'all_students' && !hasCohortId))
    ? 'everyone'
    : rawVisibility;

  const resourceRecord = {
    id: fileOrChunk.file_id || fileOrChunk.id,
    subject: fileOrChunk.subject,
    semester: fileOrChunk.semester || fileOrChunk.semester_no,
    semester_no: fileOrChunk.semester_no ?? parseSemesterNumber(fileOrChunk.semester),
    cohort_id: cohortId,
    audience_scope: normalizedScope,
    visibility: normalizedVisibility,
    uploadedBy: fileOrChunk.uploadedBy || fileOrChunk.uploaded_by,
    deleted_at: fileOrChunk.deleted_at || null,
    hidden_at: fileOrChunk.hidden_at || null
  };

  if (role === 'teacher') {
    if (Array.isArray(authContext.assignedSubjects) && authContext.assignedSubjects.length > 0 && resourceRecord.subject) {
      const normSub = normalizeText(resourceRecord.subject);
      const allowed = authContext.assignedSubjects.some((s) => {
        const ns = normalizeText(typeof s === 'string' ? s : (s.title || s.name || s.code || ''));
        return ns && (ns === normSub || normSub.includes(ns) || ns.includes(normSub));
      });
      if (!allowed && resourceRecord.uploadedBy !== authContext.username && resourceRecord.uploadedBy !== authContext.studentId) {
        return false;
      }
    }
    if (Array.isArray(authContext.assignedSemesters) && authContext.assignedSemesters.length > 0 && resourceRecord.semester_no) {
      const allowedSem = authContext.assignedSemesters.map(parseSemesterNumber).includes(Number(resourceRecord.semester_no));
      if (!allowedSem && resourceRecord.uploadedBy !== authContext.username && resourceRecord.uploadedBy !== authContext.studentId) {
        return false;
      }
    }
    return kyanaAccess.canReadResource(authContext, resourceRecord, 'note', options);
  }

  return kyanaAccess.canReadResource(authContext, resourceRecord, 'note', options);
}

const ragCorpusCacheByDb = new WeakMap();
const compiledWordRegexCache = new Map();

function invalidateRagCorpusCache(db) {
  if (db) {
    ragCorpusCacheByDb.delete(db);
  }
}

function getWordBoundaryRegex(term, globalFlag = false) {
  const key = `${globalFlag ? 'g:' : 'i:'}${term}`;
  let re = compiledWordRegexCache.get(key);
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, globalFlag ? 'gi' : 'i');
    if (compiledWordRegexCache.size > 4000) {
      compiledWordRegexCache.clear();
    }
    compiledWordRegexCache.set(key, re);
  }
  return re;
}

/**
 * Loads or returns the cached, pre-normalized chunk, topic-metadata, and Float32Array embedding index for `db`,
 * optionally scoped in SQL by `(subjectCode, subject, semesterNo)`.
 * Automatically invalidates via a deterministic row-level digest whenever any matching `files`, `document_chunks`, or `document_topic_metadata` row changes.
 */
async function getOrLoadIndexedCorpus(db, scope = {}) {
  const cleanSubjectCode = scope && scope.subjectCode ? String(scope.subjectCode).trim().toUpperCase() : '';
  const cleanSubject = scope && scope.subject ? String(scope.subject).trim() : '';
  const cleanSemNo = (scope && scope.semesterNo !== null && scope.semesterNo !== undefined && scope.semesterNo !== '')
    ? parseSemesterNumber(scope.semesterNo)
    : null;

  const scopeKey = (cleanSubjectCode || cleanSubject || cleanSemNo)
    ? `${cleanSubjectCode}|${cleanSubject.toLowerCase()}|${cleanSemNo || ''}`
    : 'ALL';

  const scopeWhere = [`c.chunk_level = 'child'`];
  const scopeParams = [];
  if (cleanSemNo) {
    scopeWhere.push(`(f.semester_no = ? OR c.semester_no = ?)`);
    scopeParams.push(cleanSemNo, cleanSemNo);
  }
  if (cleanSubjectCode && cleanSubject) {
    scopeWhere.push(`(UPPER(COALESCE(c.subject_code, '')) = ? OR LOWER(COALESCE(f.subject, '')) LIKE ? OR LOWER(COALESCE(c.subject, '')) LIKE ?)`);
    scopeParams.push(cleanSubjectCode, `%${cleanSubject.toLowerCase()}%`, `%${cleanSubject.toLowerCase()}%`);
  } else if (cleanSubjectCode) {
    scopeWhere.push(`UPPER(COALESCE(c.subject_code, '')) = ?`);
    scopeParams.push(cleanSubjectCode);
  } else if (cleanSubject) {
    scopeWhere.push(`(LOWER(COALESCE(f.subject, '')) LIKE ? OR LOWER(COALESCE(c.subject, '')) LIKE ?)`);
    scopeParams.push(`%${cleanSubject.toLowerCase()}%`, `%${cleanSubject.toLowerCase()}%`);
  }
  const whereClause = scopeWhere.join(' AND ');

  let versionSig = '0:0:0';
  const fileMetaById = new Map();
  try {
    const fileSigRows = await db.all(
      `SELECT * FROM files ORDER BY id ASC`
    ).catch(() => []);
    for (const fr of fileSigRows || []) {
      fileMetaById.set(String(fr.id), fr);
    }
    const chunkSigRow = await db.get(
      `SELECT COUNT(*) AS cnt, COALESCE(MAX(c.id), '') AS maxId, COALESCE(SUM(c.doc_version), 0) AS verSum,
              COALESCE(MAX(c.subject), '') AS maxChunkSub, COALESCE(MAX(c.chapter), '') AS maxChunkChap,
              COALESCE(MAX(c.unit), '') AS maxChunkUnit
       FROM document_chunks c
       INNER JOIN files f ON ${db.isPostgres ? 'CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT)' : '(CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT) OR f.id = CAST(c.file_id AS INTEGER))'}
       WHERE ${whereClause}`,
      ...scopeParams
    ).catch(() => null);
    const tmSigRows = await db.all(
      `SELECT file_id, subject, subject_code, semester_no, unit, chapter, updated_at
       FROM document_topic_metadata
       ORDER BY file_id ASC`
    ).catch(() => []);

    const hash = crypto.createHash('sha1');
    hash.update(scopeKey);
    hash.update(JSON.stringify(fileSigRows || []));
    hash.update(JSON.stringify(chunkSigRow || {}));
    hash.update(JSON.stringify(tmSigRows || []));
    versionSig = `${scopeKey}|${hash.digest('hex')}`;
  } catch (_) {}

  let dbScopeMap = ragCorpusCacheByDb.get(db);
  if (!dbScopeMap) {
    dbScopeMap = new Map();
    ragCorpusCacheByDb.set(db, dbScopeMap);
  }
  const cached = dbScopeMap.get(scopeKey);
  if (cached && cached.versionSig === versionSig) {
    return { ...cached, cacheHit: true };
  }

  const rawChunks = await db.all(
    `SELECT c.*,
            f.title AS file_title,
            f.originalName AS file_original_name,
            f.storedName AS file_stored_name,
            f.subject AS file_subject,
            f.chapter AS file_chapter,
            f.semester AS file_semester,
            f.semester_no AS file_semester_no,
            f.cohort_id AS file_cohort_id,
            f.audience_scope AS file_audience_scope,
            f.visibility AS file_visibility,
            f.uploadedBy AS file_uploaded_by,
            f.uploadedAt AS file_uploaded_at
     FROM document_chunks c
     INNER JOIN files f ON ${db.isPostgres ? 'CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT)' : '(CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT) OR f.id = CAST(c.file_id AS INTEGER))'}
     WHERE ${whereClause}`,
    ...scopeParams
  );

  const allChunks = (rawChunks || []).filter((ch) => {
    const fRow = fileMetaById.get(String(ch.file_id || ch.fileId || '')) || {};
    if (fRow.deleted_at || fRow.hidden_at || ['removed', 'hidden'].includes(fRow.moderation_status)) {
      return false;
    }
    ch.file_resource_category = fRow.resource_category || fRow.resourceCategory || 'notes';
    ch.file_unit_number = fRow.unit_number ?? fRow.unitNumber ?? null;
    ch.file_deleted_at = fRow.deleted_at || null;
    ch.file_hidden_at = fRow.hidden_at || null;
    ch.file_moderation_status = fRow.moderation_status || null;
    return true;
  });

  if (!allChunks || allChunks.length === 0) {
    const emptyEntry = {
      scopeKey,
      versionSig,
      preparedChunks: [],
      topicByFileId: new Map(),
      extractedItemsByFileId: new Map(),
      embeddingByChunkId: new Map(),
      cacheHit: false
    };
    dbScopeMap.set(scopeKey, emptyEntry);
    return emptyEntry;
  }

  const scopedFileIds = Array.from(new Set(allChunks.map((ch) => String(ch.file_id || ch.fileId || '')).filter(Boolean)));
  const scopedChunkIds = allChunks.map((ch) => ch.id).filter(Boolean);

  const useScopedFileFilter = scopeKey !== 'ALL' && scopedFileIds.length > 0 && scopedFileIds.length <= 400;
  const filePlaceholders = useScopedFileFilter ? scopedFileIds.map(() => '?').join(',') : '';
  const useScopedChunkFilter = scopeKey !== 'ALL' && scopedChunkIds.length > 0 && scopedChunkIds.length <= 500;
  const chunkPlaceholders = useScopedChunkFilter ? scopedChunkIds.map(() => '?').join(',') : '';

  const topicRows = useScopedFileFilter
    ? await db.all(`SELECT * FROM document_topic_metadata WHERE CAST(file_id AS TEXT) IN (${filePlaceholders})`, ...scopedFileIds)
    : await db.all(`SELECT * FROM document_topic_metadata`);
  const topicByFileId = new Map();
  for (const r of topicRows || []) {
    topicByFileId.set(String(r.file_id || r.fileId), {
      ...r,
      parsedMainTopics: safeParseArray(r.main_topics_json || r.mainTopicsJson).map(normalizeText),
      parsedSubTopics: safeParseArray(r.subtopics_json || r.subtopicsJson).map(normalizeText),
      parsedTerms: safeParseArray(r.terminology_json || r.terminologyJson).map(normalizeText)
    });
  }

  const extractedItemRows = await (useScopedFileFilter
    ? db.all(`SELECT * FROM academic_extracted_items WHERE CAST(file_id AS TEXT) IN (${filePlaceholders})`, ...scopedFileIds)
    : db.all(`SELECT * FROM academic_extracted_items`)).catch(() => []);
  const extractedItemsByFileId = new Map();
  for (const item of extractedItemRows || []) {
    const fKey = String(item.file_id || item.fileId || '');
    if (!fKey) continue;
    if (!extractedItemsByFileId.has(fKey)) extractedItemsByFileId.set(fKey, []);
    extractedItemsByFileId.get(fKey).push({
      id: item.id,
      itemType: item.item_type || item.itemType,
      conceptKey: item.concept_key || item.conceptKey,
      title: item.title,
      contentText: item.content_text || item.contentText,
      pageStart: item.page_start ?? item.pageStart ?? 1,
      pageEnd: item.page_end ?? item.pageEnd ?? 1,
      chunkId: item.chunk_id || item.chunkId || null
    });
  }

  const embeddingRows = useScopedChunkFilter
    ? await db.all(`SELECT chunk_id, embedding_json FROM document_embeddings WHERE chunk_id IN (${chunkPlaceholders})`, ...scopedChunkIds)
    : await db.all(`SELECT chunk_id, embedding_json FROM document_embeddings`);
  const embeddingByChunkId = new Map();
  for (const er of embeddingRows || []) {
    try {
      const arr = JSON.parse(er.embedding_json || er.embeddingJson);
      if (Array.isArray(arr)) {
        embeddingByChunkId.set(er.chunk_id || er.chunkId, Float32Array.from(arr));
      }
    } catch (_) {}
  }

  const preparedChunks = (allChunks || []).map((ch) => ({
    ...ch,
    _normContent: normalizeText(ch.clean_content || ch.cleanContent || ch.content || ''),
    _normHeading: normalizeText(`${ch.section_heading || ch.sectionHeading || ''} ${ch.heading_path || ch.headingPath || ''}`),
    _normTitle: normalizeText(ch.file_title || ch.fileTitle || ch.file_original_name || ch.fileOriginalName || ''),
    _normChapter: normalizeText(`${ch.file_chapter || ch.fileChapter || ch.chapter || ''} ${ch.unit || ''}`),
    _normSubject: normalizeText(ch.file_subject || ch.fileSubject || ch.subject || ''),
    _chunkTopics: safeParseArray(ch.topics_json || ch.topicsJson).map(normalizeText),
    _chunkTerms: safeParseArray(ch.terminology_json || ch.terminologyJson).map(normalizeText),
    _extractedItems: (extractedItemsByFileId.get(String(ch.file_id || ch.fileId)) || []).filter(
      (it) => it.chunkId === ch.id || (it.pageStart >= (ch.page_start || 1) && it.pageStart <= (ch.page_end || ch.page_start || 1))
    )
  }));

  const entry = {
    scopeKey,
    versionSig,
    preparedChunks,
    topicByFileId,
    extractedItemsByFileId,
    embeddingByChunkId,
    cacheHit: false
  };
  dbScopeMap.set(scopeKey, entry);
  return entry;
}

/**
 * Phase 4.3: 7-Strategy Candidate Retrieval + Reciprocal Rank Fusion (RRF).
 */
async function runMultiStrategyRetrieval(db, queryAnalysis, queryExpansion, {
  user = null,
  subjectFilter = null,
  subjectCode = null,
  semesterFilter = null,
  allowedFileIds = null,
  excludedFileIds = null,
  allowCrossSemester = false
} = {}) {
  await ensureRagSchema(db);

  const semNoFilter = (semesterFilter !== null && semesterFilter !== undefined && semesterFilter !== '')
    ? parseSemesterNumber(semesterFilter)
    : null;
  const corpus = await getOrLoadIndexedCorpus(db, {
    subjectCode: subjectCode || null,
    subject: subjectFilter || null,
    semesterNo: semNoFilter
  });

  const normSubjectFilter = subjectFilter ? normalizeText(subjectFilter) : '';
  const normSubjectCode = subjectCode ? normalizeText(subjectCode) : '';
  const allowedIdSet = Array.isArray(allowedFileIds) && allowedFileIds.length > 0
    ? new Set(allowedFileIds.map((id) => String(id)))
    : null;
  const excludedIdSet = Array.isArray(excludedFileIds) && excludedFileIds.length > 0
    ? new Set(excludedFileIds.map((id) => String(id)))
    : null;

  const authorizedChunks = corpus.preparedChunks.filter((ch) => {
    const fIdStr = String(ch.file_id || ch.fileId || '');
    if (allowedIdSet && !allowedIdSet.has(fIdStr)) return false;
    if (excludedIdSet && excludedIdSet.has(fIdStr)) return false;

    if (semNoFilter) {
      const chSem = ch.file_semester_no ?? ch.semester_no ?? parseSemesterNumber(ch.file_semester);
      if (chSem !== semNoFilter) return false;
    }

    if (normSubjectFilter || normSubjectCode) {
      const chSubNorm = normalizeText(ch.file_subject || ch.subject || '');
      const chCodeNorm = normalizeText(ch.subject_code || '');
      const matchesSub = normSubjectFilter && chSubNorm && (
        chSubNorm === normSubjectFilter ||
        chSubNorm.includes(normSubjectFilter) ||
        normSubjectFilter.includes(chSubNorm)
      );
      const matchesCode = normSubjectCode && chCodeNorm && chCodeNorm === normSubjectCode;
      if (!matchesSub && !matchesCode) return false;
    }

    return isDocumentAuthorizedForUser({
      file_id: ch.file_id,
      subject: ch.file_subject || ch.subject,
      semester: ch.file_semester,
      semester_no: ch.file_semester_no ?? ch.semester_no,
      cohort_id: ch.file_cohort_id ?? ch.cohort_id,
      audience_scope: ch.file_audience_scope || ch.audience_scope,
      visibility: ch.file_visibility || ch.visibility,
      deleted_at: ch.file_deleted_at || ch.deleted_at,
      hidden_at: ch.file_hidden_at || ch.hidden_at,
      moderation_status: ch.file_moderation_status || ch.moderation_status,
      uploadedBy: ch.file_uploaded_by || ch.uploaded_by
    }, user, { allowCrossSemester: Boolean(allowCrossSemester) });
  });

  if (authorizedChunks.length === 0) {
    return {
      rankedChunks: [],
      cacheHit: corpus.cacheHit,
      strategyHits: { A_fts: 0, B_vector: 0, C_exact: 0, D_topic: 0, E_syllabus: 0, F_related: 0, G_heading: 0 }
    };
  }

  const { topicByFileId, embeddingByChunkId } = corpus;

  const queryEmbedText = [
    queryAnalysis.mainTopic,
    ...(queryExpansion.expandedPhrases || []).slice(0, 4),
    ...(queryExpansion.primaryTerms || [])
  ].filter(Boolean).join(' ');
  const queryEmbedding = await generateQueryEmbedding(queryEmbedText);

  const listA_fts = [];
  const listB_vector = [];
  const listC_exact = [];
  const listD_topic = [];
  const listE_syllabus = [];
  const listF_related = [];
  const listG_heading = [];

  const primaryTerms = queryExpansion.primaryTerms || [];
  const expandedPhrases = queryExpansion.expandedPhrases || [];
  const relatedTerms = queryExpansion.relatedTerms || [];
  const candidateSubjectNames = (queryAnalysis.candidateSubjects || []).map((s) => normalizeText(s.subject));
  const cleanTopic = queryAnalysis.cleanedTopicPhrase;

  for (const ch of authorizedChunks) {
    const normContent = ch._normContent;
    const normHeading = ch._normHeading;
    const normTitle = ch._normTitle;
    const normChapter = ch._normChapter;
    const normSubject = ch._normSubject;
    const topicMeta = topicByFileId.get(String(ch.file_id));

    let ftsScore = 0;
    for (const term of primaryTerms) {
      const count = countTermOccurrences(normContent, term);
      if (count > 0) {
        ftsScore += (1 + Math.log(count)) * (term.includes(' ') ? 3.0 : 1.5);
      }
    }
    for (const phrase of expandedPhrases) {
      const count = countTermOccurrences(normContent, phrase);
      if (count > 0) {
        ftsScore += (1 + Math.log(count)) * 2.5;
      }
    }
    if (ftsScore > 0) listA_fts.push({ chunk: ch, score: ftsScore });

    const chVec = embeddingByChunkId.get(ch.id);
    if (chVec && queryEmbedding.vector.length > 0) {
      const sim = cosineSimilarity(queryEmbedding.vector, chVec);
      if (sim > 0.18) {
        listB_vector.push({ chunk: ch, score: sim });
      }
    }

    let exactScore = 0;
    if (cleanTopic && cleanTopic.length >= 2 && hasWordBoundaryMatch(normContent, cleanTopic)) {
      exactScore += 6.0;
    }
    for (const alias of queryAnalysis.topicAliases || []) {
      const normAlias = normalizeText(alias);
      if (normAlias && hasWordBoundaryMatch(normContent, normAlias)) {
        exactScore += normAlias.includes(' ') ? 5.0 : 3.5;
      }
    }
    for (const tok of queryAnalysis.tokens || []) {
      if (tok.length >= 3 && hasWordBoundaryMatch(normContent, tok)) {
        exactScore += 2.0;
      }
    }
    if (exactScore > 0) listC_exact.push({ chunk: ch, score: exactScore });

    let topicScore = 0;
    const chunkTopics = ch._chunkTopics;
    const chunkTerms = ch._chunkTerms;
    for (const term of queryExpansion.allSearchTerms) {
      if (chunkTopics.some((t) => t === term || hasWordBoundaryMatch(t, term))) {
        topicScore += 4.5;
      }
      if (chunkTerms.some((t) => t === term || hasWordBoundaryMatch(t, term))) {
        topicScore += 3.0;
      }
    }
    if (topicMeta) {
      for (const term of queryExpansion.allSearchTerms) {
        if (topicMeta.parsedMainTopics.some((t) => t === term || hasWordBoundaryMatch(t, term))) topicScore += 2.5;
        if (topicMeta.parsedSubTopics.some((t) => t === term || hasWordBoundaryMatch(t, term))) topicScore += 1.8;
        if (topicMeta.parsedTerms.some((t) => t === term || hasWordBoundaryMatch(t, term))) topicScore += 1.5;
      }
    }
    if (topicScore > 0) listD_topic.push({ chunk: ch, score: topicScore });

    let syllabusScore = 0;
    for (const term of queryExpansion.allSearchTerms) {
      if (normChapter && hasWordBoundaryMatch(normChapter, term)) {
        syllabusScore += 3.5;
      }
    }
    if (candidateSubjectNames.includes(normSubject) && (ftsScore > 0 || exactScore > 0 || topicScore > 0)) {
      syllabusScore += 2.0;
    }
    if (syllabusScore > 0) listE_syllabus.push({ chunk: ch, score: syllabusScore });

    let relatedScore = 0;
    for (const rel of relatedTerms) {
      if (rel && hasWordBoundaryMatch(normContent, rel)) {
        relatedScore += 1.8;
      }
    }
    if (relatedScore > 0) listF_related.push({ chunk: ch, score: relatedScore });

    let headingScore = 0;
    if (cleanTopic && (hasWordBoundaryMatch(normHeading, cleanTopic) || hasWordBoundaryMatch(normTitle, cleanTopic))) {
      headingScore += 6.5;
    }
    for (const term of queryExpansion.allSearchTerms) {
      if (term.length >= 2) {
        if (hasWordBoundaryMatch(normHeading, term)) {
          headingScore += term.includes(' ') ? 4.5 : 3.0;
        }
        if (hasWordBoundaryMatch(normTitle, term)) {
          headingScore += term.includes(' ') ? 4.0 : 2.5;
        }
      }
    }
    if (headingScore > 0) listG_heading.push({ chunk: ch, score: headingScore });
  }

  const sortDesc = (arr) => arr.sort((a, b) => b.score - a.score);
  sortDesc(listA_fts);
  sortDesc(listB_vector);
  sortDesc(listC_exact);
  sortDesc(listD_topic);
  sortDesc(listE_syllabus);
  sortDesc(listF_related);
  sortDesc(listG_heading);

  const rrfMap = new Map();

  const applyRrfList = (list, strategyName, weight = 1.0) => {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const id = item.chunk.id;
      if (!rrfMap.has(id)) {
        rrfMap.set(id, {
          chunk: item.chunk,
          topicMetadata: topicByFileId.get(String(item.chunk.file_id)) || null,
          rrfScore: 0,
          strategies: {},
          rawScores: {}
        });
      }
      const entry = rrfMap.get(id);
      const contribution = weight / (RRF_K + rank + 1);
      entry.rrfScore += contribution;
      entry.strategies[strategyName] = rank + 1;
      entry.rawScores[strategyName] = Number(item.score.toFixed(4));
    }
  };

  applyRrfList(listA_fts, 'fts', 1.25);
  applyRrfList(listB_vector, 'vector', 1.15);
  applyRrfList(listC_exact, 'exact_term', 1.45);
  applyRrfList(listD_topic, 'topic_metadata', 1.30);
  applyRrfList(listE_syllabus, 'syllabus_chapter', 0.85);
  applyRrfList(listF_related, 'related_concept', 0.65);
  applyRrfList(listG_heading, 'section_heading', 1.40);

  const rankedChunks = Array.from(rrfMap.values()).sort((a, b) => b.rrfScore - a.rrfScore);

  return {
    rankedChunks,
    cacheHit: corpus.cacheHit,
    strategyHits: {
      A_fts: listA_fts.length,
      B_vector: listB_vector.length,
      C_exact: listC_exact.length,
      D_topic: listD_topic.length,
      E_syllabus: listE_syllabus.length,
      F_related: listF_related.length,
      G_heading: listG_heading.length
    }
  };
}

const GENERIC_ACADEMIC_MODIFIERS = new Set([
  'theory', 'system', 'systems', 'management', 'model', 'models', 'design',
  'architecture', 'analysis', 'method', 'methods', 'process', 'processing',
  'programming', 'language', 'concept', 'concepts', 'structure', 'structures',
  'introduction', 'overview', 'basic', 'basics', 'advanced', 'principle', 'principles',
  'prevention', 'avoidance', 'detection', 'recovery', 'compiler', 'database',
  'algorithm', 'algorithms', 'operating', 'network', 'networks', 'computer',
  'data', 'web', 'java', 'type', 'types', 'application', 'applications', 'definition',
  'class', 'classes', 'object', 'objects', 'function', 'functions', 'code'
]);

function rerankRetrievedCandidates(candidates = [], queryAnalysis, queryExpansion, options = {}) {
  const minRelevance = options.minRelevanceScore ?? DEFAULT_MIN_RELEVANCE_SCORE;
  const reranked = [];

  const allTopicTerms = queryExpansion.allSearchTerms || [];
  const cleanTopic = queryAnalysis.cleanedTopicPhrase || '';

  const specificQueryTokens = (queryAnalysis.tokens || []).filter(
    (t) => t.length >= 2 && !GENERIC_ACADEMIC_MODIFIERS.has(t)
  );
  const specificAliases = (queryAnalysis.topicAliases || [])
    .map(normalizeText)
    .filter((t) => t.length >= 2 && !GENERIC_ACADEMIC_MODIFIERS.has(t));

  const coreTargetTerms = Array.from(new Set([...specificQueryTokens, ...specificAliases]));

  for (const cand of candidates) {
    const ch = cand.chunk;
    const rawText = String(ch.content || ch.clean_content || '').trim();
    const normContent = ch._normContent || normalizeText(rawText);
    const normHeading = ch._normHeading || normalizeText(`${ch.section_heading || ''} ${ch.heading_path || ''}`);
    const normTitle = ch._normTitle || normalizeText(ch.file_title || ch.file_original_name || '');

    let directTermHits = 0;
    let specificHits = 0;
    let titleOrHeadingSpecificHits = 0;

    for (const term of allTopicTerms) {
      if (term.length >= 2 && (hasWordBoundaryMatch(normContent, term) || hasWordBoundaryMatch(normHeading, term) || hasWordBoundaryMatch(normTitle, term))) {
        directTermHits += 1;
      }
    }

    for (const spec of coreTargetTerms) {
      const inBody = hasWordBoundaryMatch(normContent, spec);
      const inHeadOrTitle = hasWordBoundaryMatch(normHeading, spec) || hasWordBoundaryMatch(normTitle, spec);
      if (inBody || inHeadOrTitle) {
        specificHits += 1;
      }
      if (inHeadOrTitle) {
        titleOrHeadingSpecificHits += 1;
      }
    }

    const hasExactPhrase = cleanTopic.length >= 2 && (
      hasWordBoundaryMatch(normContent, cleanTopic) ||
      hasWordBoundaryMatch(normHeading, cleanTopic) ||
      hasWordBoundaryMatch(normTitle, cleanTopic)
    );

    const vectorScore = Number(cand.rawScores.vector || 0);
    const hasHeadingMatch = Boolean(cand.rawScores.section_heading);
    const hasTopicMetaMatch = Boolean(cand.rawScores.topic_metadata);

    const minRequiredSpecificHits = (specificQueryTokens.length >= 2 && specificAliases.length === 0) ? 2 : 1;
    if (coreTargetTerms.length > 0 && specificHits < minRequiredSpecificHits && !hasExactPhrase) {
      continue;
    }

    if (directTermHits === 0 && !hasExactPhrase && vectorScore < 0.42) {
      continue;
    }

    const isTableOfContents = isTocSnippet(rawText, ch.section_heading);
    const wordCount = rawText.split(/\s+/).filter(Boolean).length;
    const isPassingMention = wordCount < 14 && !hasHeadingMatch && !ch.has_definition;

    let score = 0;

    if (hasExactPhrase) {
      score += 0.28;
    }
    score += Math.min(0.18, directTermHits * 0.06);

    if (cleanTopic && (hasWordBoundaryMatch(normHeading, cleanTopic) || hasWordBoundaryMatch(normTitle, cleanTopic))) {
      score += 0.22;
    } else if (titleOrHeadingSpecificHits > 0) {
      score += Math.min(0.18, titleOrHeadingSpecificHits * 0.09);
    } else if (hasHeadingMatch) {
      score += 0.08;
    }

    score += Math.min(0.20, Math.max(0, vectorScore) * 0.25);

    if (ch.has_definition) score += 0.09;
    if (ch.has_table) score += 0.05;
    if (wordCount >= 35) score += 0.08;
    else if (wordCount >= 18) score += 0.04;

    if (hasTopicMetaMatch) score += 0.06;
    const strategyCount = Object.keys(cand.strategies || {}).length;
    score += Math.min(0.08, strategyCount * 0.02);

    if (isTableOfContents) {
      score *= 0.35;
    } else if (isPassingMention) {
      score *= 0.55;
    }

    const finalScore = Number(Math.min(1.0, score).toFixed(4));
    if (finalScore < minRelevance) {
      continue;
    }

    reranked.push({
      ...cand,
      relevanceScore: finalScore,
      isTableOfContents,
      isPassingMention,
      directTermHits,
      specificHits,
      titleOrHeadingSpecificHits,
      hasExactPhrase,
      hasHeadingMatch
    });
  }

  reranked.sort((a, b) => {
    if (Math.abs(b.relevanceScore - a.relevanceScore) > 0.02) {
      return b.relevanceScore - a.relevanceScore;
    }
    if ((b.titleOrHeadingSpecificHits || 0) !== (a.titleOrHeadingSpecificHits || 0)) {
      return (b.titleOrHeadingSpecificHits || 0) - (a.titleOrHeadingSpecificHits || 0);
    }
    return b.rrfScore - a.rrfScore;
  });

  return reranked;
}

function isTocSnippet(text, heading = '') {
  const s = String(text || '').trim();
  const h = String(heading || '').trim().toLowerCase();
  if (/^(?:table of contents|contents|syllabus outline|index)$/i.test(h)) return true;
  const dotLeaderLines = (s.match(/\.{4,}\s*\d+/g) || []).length;
  if (dotLeaderLines >= 2) return true;
  return false;
}

function countTermOccurrences(normText, term) {
  if (!normText || !term) return 0;
  const matches = normText.match(getWordBoundaryRegex(term, true));
  return matches ? matches.length : 0;
}

function hasWordBoundaryMatch(normText, term) {
  if (!normText || !term) return false;
  return getWordBoundaryRegex(term, false).test(normText);
}

function safeParseArray(jsonStr) {
  if (Array.isArray(jsonStr)) return jsonStr;
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Phase 4.6: Multi-Hop Hybrid Retrieval Orchestrator.
 */
async function retrieveAcademicEvidence(db, {
  query,
  user = null,
  subject = null,
  subjectCode = null,
  semester = null,
  allowedFileIds = null,
  excludedFileIds = null,
  allowCrossSemester = false,
  maxChunks = 8,
  maxDocuments = 5,
  minRelevanceScore = DEFAULT_MIN_RELEVANCE_SCORE
} = {}) {
  const startTime = Date.now();
  await ensureRagSchema(db);

  const queryAnalysis = await understandAcademicQuery(db, query);
  const queryExpansion = expandAcademicQuery(queryAnalysis);

  if (queryExpansion.allSearchTerms.length === 0) {
    return {
      queryAnalysis,
      queryExpansion,
      passages: [],
      documents: [],
      hopsExecuted: 0,
      strategyHits: {},
      latencyMs: Date.now() - startTime
    };
  }

  const hop1 = await runMultiStrategyRetrieval(db, queryAnalysis, queryExpansion, {
    user,
    subjectFilter: subject,
    subjectCode,
    semesterFilter: semester,
    allowedFileIds,
    excludedFileIds,
    allowCrossSemester
  });

  let reranked = rerankRetrievedCandidates(hop1.rankedChunks, queryAnalysis, queryExpansion, {
    minRelevanceScore
  });

  let hopsExecuted = 1;

  if (queryAnalysis.subQuestions && queryAnalysis.subQuestions.length > 1) {
    const mergedByChunkId = new Map(reranked.map((r) => [r.chunk.id, r]));

    for (const subQ of queryAnalysis.subQuestions.slice(0, 3)) {
      const normSubQ = normalizeText(subQ);
      if (!normSubQ) continue;

      const coveredCount = Array.from(mergedByChunkId.values()).filter((r) => {
        const text = normalizeText(`${r.chunk.section_heading || ''} ${r.chunk.clean_content || ''}`);
        return hasWordBoundaryMatch(text, normSubQ);
      }).length;

      if (coveredCount === 0) {
        hopsExecuted += 1;
        const subAnalysis = await understandAcademicQuery(db, subQ);
        const subExpansion = expandAcademicQuery(subAnalysis);
        const subRetrieval = await runMultiStrategyRetrieval(db, subAnalysis, subExpansion, {
          user,
          subjectFilter: subject,
          subjectCode,
          semesterFilter: semester,
          allowedFileIds,
          excludedFileIds,
          allowCrossSemester
        });
        const subReranked = rerankRetrievedCandidates(subRetrieval.rankedChunks, subAnalysis, subExpansion, {
          minRelevanceScore: Math.max(0.26, minRelevanceScore - 0.04)
        });
        for (const item of subReranked.slice(0, 3)) {
          if (!mergedByChunkId.has(item.chunk.id)) {
            mergedByChunkId.set(item.chunk.id, { ...item, hopNumber: hopsExecuted, subQuestion: subQ });
          }
        }
      }
    }

    reranked = Array.from(mergedByChunkId.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  const topPassages = reranked.slice(0, maxChunks);
  const parentIds = Array.from(new Set(topPassages.map((p) => p.chunk.parent_chunk_id).filter(Boolean)));
  const parentById = new Map();
  if (parentIds.length > 0) {
    const pPlaceholders = parentIds.map(() => '?').join(', ');
    const parentRows = await db.all(
      `SELECT id, section_heading, heading_path, content, page_start, page_end FROM document_chunks WHERE id IN (${pPlaceholders})`,
      parentIds
    );
    for (const pr of parentRows || []) {
      parentById.set(pr.id, pr);
    }
  }

  const passages = topPassages.map((item) => {
    const ch = item.chunk;
    const parent = ch.parent_chunk_id ? parentById.get(ch.parent_chunk_id) : null;
    const pageLabel = ch.page_start && ch.page_end && ch.page_start !== ch.page_end
      ? `Pages ${ch.page_start}–${ch.page_end}`
      : `Page ${ch.page_start || 1}`;

    return {
      chunkId: ch.id,
      parentChunkId: ch.parent_chunk_id || null,
      fileId: String(ch.file_id),
      title: ch.file_title || ch.file_original_name || 'Untitled Document',
      originalName: ch.file_original_name || '',
      storedName: ch.file_stored_name || '',
      subject: ch.file_subject || ch.subject || 'General Academic',
      subjectCode: ch.subject_code || (item.topicMetadata && item.topicMetadata.subject_code) || null,
      semesterNo: ch.file_semester_no ?? ch.semester_no ?? null,
      chapter: ch.file_chapter || ch.chapter || (item.topicMetadata && item.topicMetadata.chapter) || null,
      unit: ch.unit || ch.file_unit_number || (item.topicMetadata && item.topicMetadata.unit) || null,
      resourceCategory: ch.file_resource_category || 'notes',
      sectionHeading: ch.section_heading || 'Document Section',
      headingPath: ch.heading_path || ch.section_heading || '',
      pageStart: ch.page_start || 1,
      pageEnd: ch.page_end || ch.page_start || 1,
      pageLabel,
      content: ch.content,
      parentContext: parent ? parent.content : null,
      relevanceScore: item.relevanceScore,
      rrfScore: Number(item.rrfScore.toFixed(5)),
      matchedStrategies: Object.keys(item.strategies || {}),
      hopNumber: item.hopNumber || 1,
      subQuestion: item.subQuestion || null,
      extractedItems: ch._extractedItems || [],
      citation: {
        documentTitle: ch.file_title || ch.file_original_name || 'Untitled Document',
        subject: ch.file_subject || ch.subject || 'General Academic',
        chapter: ch.file_chapter || ch.chapter || (item.topicMetadata && item.topicMetadata.chapter) || null,
        pageNumber: ch.page_start || 1,
        pageRange: pageLabel,
        sectionHeading: ch.section_heading || 'Main Section'
      }
    };
  });

  const docMap = new Map();
  for (const p of passages) {
    if (!docMap.has(p.fileId)) {
      docMap.set(p.fileId, {
        id: p.fileId,
        title: p.title,
        originalName: p.originalName,
        storedName: p.storedName,
        subject: p.subject,
        subjectCode: p.subjectCode,
        semesterNo: p.semesterNo,
        chapter: p.chapter,
        unit: p.unit,
        resourceCategory: p.resourceCategory,
        bestRelevanceScore: p.relevanceScore,
        passages: [],
        sectionsCovered: new Set(),
        pagesCovered: new Set()
      });
    }
    const d = docMap.get(p.fileId);
    if (p.relevanceScore > d.bestRelevanceScore) d.bestRelevanceScore = p.relevanceScore;
    d.passages.push(p);
    if (p.sectionHeading) d.sectionsCovered.add(p.sectionHeading);
    if (p.pageStart) d.pagesCovered.add(p.pageStart);
  }

  const documents = Array.from(docMap.values())
    .sort((a, b) => b.bestRelevanceScore - a.bestRelevanceScore)
    .slice(0, maxDocuments)
    .map((d) => ({
      ...d,
      sectionsCovered: Array.from(d.sectionsCovered),
      pagesCovered: Array.from(d.pagesCovered).sort((a, b) => a - b),
      snippet: d.passages.map((p) => `[${p.pageLabel} — ${p.sectionHeading}] ${p.content}`).join('\n\n').slice(0, 900)
    }));

  return {
    queryAnalysis,
    queryExpansion,
    passages,
    documents,
    hopsExecuted,
    cacheHit: hop1.cacheHit,
    strategyHits: hop1.strategyHits,
    latencyMs: Date.now() - startTime
  };
}

function synthesizeGroundedAcademicResponse(retrievalResult, options = {}) {
  const { queryAnalysis, passages = [], documents = [] } = retrievalResult || {};
  const topicTitle = (queryAnalysis && queryAnalysis.mainTopic) || 'Requested Topic';

  if (!passages || passages.length === 0) {
    const candidateSub = queryAnalysis && queryAnalysis.candidateSubjects && queryAnalysis.candidateSubjects[0]
      ? queryAnalysis.candidateSubjects[0]
      : null;

    const curriculumExplanation = buildSupplementaryCurriculumExplanation(queryAnalysis, candidateSub);
    return {
      groundedInLibrary: false,
      partialCoverage: false,
      answerText: `[Note: No specific course notes were found in Semester Library covering this topic. Here is the academic explanation from the curriculum:]\n\n${curriculumExplanation}`,
      citations: [],
      recommendedResources: [],
      llmContextBlock: `GROUNDING STATUS: NO_LIBRARY_DOCUMENTS_FOUND\nTopic: ${topicTitle}\nInstruction: State clearly that no uploaded notes in Semester Library currently cover "${topicTitle}", and provide a helpful academic explanation grounded in the university syllabus (${candidateSub ? `${candidateSub.subject}` : 'general curriculum'}). Do NOT fabricate document titles or page numbers.`
    };
  }

  const uniquePassages = deduplicatePassages(passages);
  const citations = uniquePassages.map((p) => p.citation);

  const uncoveredSubQuestions = [];
  if (queryAnalysis && Array.isArray(queryAnalysis.subQuestions) && queryAnalysis.subQuestions.length > 1) {
    for (const sq of queryAnalysis.subQuestions) {
      const normSq = normalizeText(sq);
      const hit = uniquePassages.some((p) =>
        hasWordBoundaryMatch(normalizeText(`${p.sectionHeading} ${p.content}`), normSq)
      );
      if (!hit) uncoveredSubQuestions.push(sq);
    }
  }

  const partialCoverage = uncoveredSubQuestions.length > 0;

  const lines = [];
  const primaryDoc = documents[0];

  if (queryAnalysis && queryAnalysis.userIntent === 'find_resource') {
    lines.push(`**${topicTitle}** is covered in the following Semester Library resources:`);
    for (const doc of documents) {
      const pagesStr = doc.pagesCovered.length > 0 ? `Page(s) ${doc.pagesCovered.join(', ')}` : 'Page 1';
      const sectionsStr = doc.sectionsCovered.slice(0, 3).join(', ');
      lines.push(
        `• **${doc.title}** — *${doc.subject}*${doc.chapter ? ` (${doc.chapter})` : ''}, ${pagesStr}${sectionsStr ? ` [Sections: ${sectionsStr}]` : ''}`
      );
    }
    lines.push('\n### Key Extracted Content');
  } else {
    lines.push(`### ${topicTitle} (From Semester Library Notes)`);
  }

  for (const p of uniquePassages.slice(0, 5)) {
    const citeBadge = `[Source: ${p.title} | ${p.subject}${p.chapter ? `, ${p.chapter}` : ''} | ${p.pageLabel} — ${p.sectionHeading}]`;
    lines.push(`${p.content}\n*${citeBadge}*`);
  }

  if (partialCoverage) {
    lines.push(
      `\n*Note on Coverage:* The uploaded library notes directly cover parts of your question, while specific details on **${uncoveredSubQuestions.join(', ')}** are supplemented from the standard curriculum.`
    );
  }

  const llmContextPassages = uniquePassages.slice(0, 6).map((p, idx) => [
    `--- PASSAGE ${idx + 1} (Relevance: ${p.relevanceScore}) ---`,
    `Document ID: ${p.fileId}`,
    `Document Title: ${p.title}`,
    `Subject: ${p.subject}${p.subjectCode ? ` (${p.subjectCode})` : ''}${p.semesterNo ? ` | Semester ${p.semesterNo}` : ''}`,
    `Chapter/Unit: ${p.chapter || p.unit || 'N/A'}`,
    `Page Reference: ${p.pageLabel}`,
    `Section Heading: ${p.sectionHeading}`,
    `Extracted Passage:\n${p.content}`
  ].join('\n')).join('\n\n');

  const llmContextBlock = [
    `GROUNDING STATUS: ${partialCoverage ? 'PARTIAL_LIBRARY_EVIDENCE' : 'VERIFIED_LIBRARY_EVIDENCE'}`,
    `Query Topic: ${topicTitle} | Intent: ${queryAnalysis ? queryAnalysis.userIntent : 'explain'}`,
    `Retrieved Documents: ${documents.length} | Verified Passages: ${uniquePassages.length}`,
    `CITATION INSTRUCTION: Base your explanation on the extracted passages below and cite the Document Title, Subject, Chapter, Page Number, and Section Heading. Do not fabricate citations.`,
    llmContextPassages
  ].join('\n\n');

  return {
    groundedInLibrary: true,
    partialCoverage,
    uncoveredSubQuestions,
    answerText: lines.join('\n\n'),
    citations,
    recommendedResources: documents.map((d) => ({
      id: d.id,
      title: d.title,
      subject: d.subject,
      chapter: d.chapter,
      semesterNo: d.semesterNo,
      pagesCovered: d.pagesCovered,
      sectionsCovered: d.sectionsCovered,
      relevanceScore: d.bestRelevanceScore
    })),
    primaryDocument: primaryDoc || null,
    llmContextBlock
  };
}

function deduplicatePassages(passages = []) {
  const result = [];
  const seenFingerprints = new Set();

  for (const p of passages) {
    const norm = normalizeText(p.content).slice(0, 180);
    if (!norm || seenFingerprints.has(norm)) continue;
    seenFingerprints.add(norm);
    result.push(p);
  }
  return result;
}

function buildSupplementaryCurriculumExplanation(queryAnalysis, candidateSubject) {
  const topic = (queryAnalysis && queryAnalysis.mainTopic) || 'this topic';
  const subjectInfo = candidateSubject
    ? `In the university curriculum, **${topic}** is studied under **${candidateSubject.subject}**${candidateSubject.subjectCode ? ` (${candidateSubject.subjectCode})` : ''}${candidateSubject.chapters && candidateSubject.chapters.length > 0 ? `, specifically in *${candidateSubject.chapters.slice(0, 2).join(', ')}*` : ''}.`
    : `**${topic}** is an academic concept in computer science and information technology.`;

  const related = queryAnalysis && Array.isArray(queryAnalysis.relevantConcepts) && queryAnalysis.relevantConcepts.length > 0
    ? `\n\n**Key Related Concepts in Curriculum:** ${queryAnalysis.relevantConcepts.slice(0, 6).join(', ')}.`
    : '';

  return `${subjectInfo}${related}`;
}

module.exports = {
  RRF_K,
  DEFAULT_MIN_RELEVANCE_SCORE,
  invalidateRagCorpusCache,
  getOrLoadIndexedCorpus,
  understandAcademicQuery,
  expandAcademicQuery,
  isDocumentAuthorizedForUser,
  runMultiStrategyRetrieval,
  rerankRetrievedCandidates,
  retrieveAcademicEvidence,
  synthesizeGroundedAcademicResponse
};
