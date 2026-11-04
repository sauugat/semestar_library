'use strict';

/**
 * Semester-authorized search tools for Kyana AI.
 * 
 * SECURITY: Every query enforces the student's actual semester and cohort
 * as resolved server-side by getAcademicContext(). The AI model never
 * receives semester/cohort parameters — they are injected here.
 * 
 * Supports: posts, notices, assignments, notes (files), routines.
 */

const { buildAcademicContentFilter, parseSemesterNumber } = require('./academic-context');
const { resourceFilter } = require('./kyana-access');
const { normalizeSemester, semesterAliases } = require('./note-search');

/**
 * Builds a semester-authorization WHERE clause for the `files` table.
 * Files use legacy `semester` (text) column rather than integer semester_no.
 * Falls back to buildAcademicContentFilter for audience_scope/cohort filtering,
 * plus text-based semester matching for backward-compatible file queries.
 */
function buildFilesSemesterFilter(academicContext, { tableAlias = 'f' } = {}) {
  return resourceFilter(academicContext, 'note', tableAlias);
}

/**
 * Searches posts visible to the authenticated student.
 * Enforces semester and cohort authorization.
 *
 * @param {object} db
 * @param {object} academicContext - from getAcademicContext()
 * @param {object} opts
 * @param {string} opts.query - search query text
 * @param {string} [opts.type] - 'status', 'assignment', 'notice', or null for all
 * @param {number} [opts.limit=5]
 */
const NOTICE_SYNONYM_GROUPS = {
  resume: ['resume', 'resumption', 'resuming', 'resumed', 'start', 'starts', 'starting', 'started', 'reopen', 'reopens', 'reopening', 'begin', 'begins', 'suru', 'shuru', 'khulxa', 'khulcha', 'khulne', 'lagxa', 'lagne', 'sanchalan', 'schedule', 'timetable'],
  class: ['class', 'classes', 'kaksha', 'lecture', 'lectures', 'academic'],
  holiday: ['holiday', 'holidays', 'vacation', 'vacations', 'bida', 'chutti', 'dashain', 'tihar', 'closed', 'off'],
  vacation: ['vacation', 'vacations', 'holiday', 'holidays', 'dashain', 'tihar', 'bida', 'chutti'],
  dashain: ['dashain', 'tihar', 'vacation', 'holiday'],
  exam: ['exam', 'exams', 'examination', 'examinations', 'pariksha', 'midterm', 'preboard', 'final'],
  routine: ['routine', 'routines', 'timetable', 'schedule', 'schedules']
};

const ACADEMIC_NOTICE_PRIORITY_KEYWORDS = [
  'class', 'classes', 'resume', 'resumption', 'start', 'reopen', 'suru',
  'vacation', 'dashain', 'tihar', 'holiday', 'schedule', 'timetable'
];

const GENERIC_NOTICE_META_WORDS = new Set([
  'notice', 'notices', 'announcement', 'announcements', 'circular', 'circulars',
  'update', 'updates', 'suchana', 'suchanaa', 'official', 'campus', 'college'
]);

function expandConceptTerms(token) {
  const { ALIASES } = require('./knowledge-relevance');
  const canon = ALIASES[token] || token;
  const group = NOTICE_SYNONYM_GROUPS[canon] || NOTICE_SYNONYM_GROUPS[token];
  if (group) return [...new Set([token, canon, ...group])];
  return [...new Set([token, canon])];
}

function getAuthorAuthorityTier(role) {
  const r = String(role || 'student').trim().toLowerCase();
  if (r === 'admin') return 1;
  if (r === 'teacher') return 2;
  if (r === 'cr') return 3;
  return 4;
}

function resolveNoticeSupersession(items) {
  if (!Array.isArray(items) || items.length <= 1) return items;
  // Sort by createdAt descending so the newest notice on a topic is evaluated first
  const byNewest = [...items].sort((a, b) =>
    String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || ''))
  );
  for (const newer of byNewest) {
    const newerDate = String(newer.createdAt || newer.created_at || '');
    if (!newerDate) continue;
    const newerText = `${newer.title || ''} ${newer.content || ''}`;
    const hasExplicitUpdateSignal = /\b(updated?|revised?|rescheduled?|supersedes?|corrigendum|amendment|new\s+schedule|latest)\b/i.test(newerText);
    const newerTier = Number(newer.authorityTier || getAuthorAuthorityTier(newer.authorRole));
    for (const older of byNewest) {
      if (older.id === newer.id && older.type === newer.type) continue;
      if (older.superseded) continue;
      const olderDate = String(older.createdAt || older.created_at || '');
      if (!olderDate || newerDate <= olderDate) continue;
      const olderTier = Number(older.authorityTier || getAuthorAuthorityTier(older.authorRole));
      if (newerTier > olderTier) continue;
      const newerConcepts = newer._matchedConcepts || [];
      const olderConcepts = older._matchedConcepts || [];
      const shared = newerConcepts.filter(c => olderConcepts.includes(c));
      const coversOlderTopic = olderConcepts.length > 0
        ? olderConcepts.every(c => newerConcepts.includes(c))
        : (newerConcepts.length === 0);
      if (coversOlderTopic && (hasExplicitUpdateSignal || (shared.length > 0 && (newer._score || 0) >= (older._score || 0) - 12))) {
        older.superseded = true;
        older.supersededBy = newer.id;
        if ((newer._score || 0) <= (older._score || 0)) {
          newer._score = (older._score || 0) + 15;
        }
      }
    }
  }
  return items.sort((a, b) => (b._score || 0) - (a._score || 0) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

async function searchPosts(db, academicContext, { query = '', type = null, dateInfo = null, excludeIds = [], limit = 5 } = {}) {
  const { matchesDateFilter } = require('./nepali-dates');
  const { ALIASES } = require('./knowledge-relevance');
  const conditions = [];
  const params = [];
  const excludeSet = new Set(
    (Array.isArray(excludeIds) ? excludeIds : [])
      .map(id => Number(String(id).replace(/^(?:post|notice):/i, '')))
      .filter(n => Number.isFinite(n) && n > 0)
  );

  // Unified Notice & Type filter:
  // When type === 'notice', include both dedicated notice posts (LOWER(p.type) = 'notice')
  // and posts categorized as NOTICE (LOWER(p.category) = 'notice'), AND strictly verify
  // that the author's trusted database role in `students` is admin, teacher, or cr.
  // Regular student posts (s.role = 'student') are NEVER treated as official notices.
  if (type === 'notice') {
    conditions.push("(LOWER(TRIM(COALESCE(p.type, ''))) = 'notice' OR LOWER(TRIM(COALESCE(p.category, ''))) = 'notice')");
    conditions.push("LOWER(TRIM(COALESCE(s.role, 'student'))) IN ('admin', 'teacher', 'cr')");
  } else if (type && ['status', 'assignment'].includes(type)) {
    conditions.push('p.type = ?');
    params.push(type);
  }

  // Semester & cohort authorization
  const authFilter = buildPostSemesterFilter(academicContext, { tableAlias: 'p' });
  conditions.push(`(${authFilter.sql})`);
  params.push(...authFilter.params);

  conditions.push("(p.moderation_status IS NULL OR p.moderation_status = 'active')");

  if (excludeSet.size > 0) {
    const exList = [...excludeSet];
    conditions.push(`p.id NOT IN (${exList.map(() => '?').join(',')})`);
    params.push(...exList);
  }

  const baseConditions = [...conditions];
  const baseParams = [...params];

  // Text search on title + subject + category + content (strip date tokens when dateInfo is active)
  const DATE_STOP_TOKENS = new Set([
    'aaja', 'today', 'bholi', 'voli', 'tomorrow', 'hijo', 'yesterday', 'parsi', 'asti',
    'hapta', 'week', 'dekhi', 'samma', 'from', 'between', 'until',
    'baisakh', 'jestha', 'asar', 'shrawan', 'bhadra', 'asoj', 'kartik', 'mangsir', 'poush', 'magh', 'falgun', 'chaitra',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'
  ]);
  const rawTokens = extractSearchTokens(query);
  let tokens = dateInfo
    ? rawTokens.filter(t => !DATE_STOP_TOKENS.has(t) && !/^\d{1,4}$/.test(t) && !/^\d{4}-\d{2}-\d{2}$/.test(t))
    : rawTokens;

  // For notice searches, strip generic meta words ('notice', 'update', 'official') when topic tokens exist
  if (type === 'notice') {
    const nonMeta = tokens.filter(t => !GENERIC_NOTICE_META_WORDS.has(t));
    tokens = nonMeta;
  }

  // Group tokens by canonical concept so synonyms (e.g. start/suru -> resume, classes -> class)
  // match across English, Romanized Nepali, and Devanagari
  const conceptMap = new Map();
  for (const t of tokens) {
    const canon = ALIASES[t] || t;
    if (!conceptMap.has(canon)) {
      conceptMap.set(canon, expandConceptTerms(t));
    } else {
      const existing = conceptMap.get(canon);
      for (const syn of expandConceptTerms(t)) {
        if (!existing.includes(syn)) existing.push(syn);
      }
    }
  }
  const conceptEntries = [...conceptMap.entries()];

  if (conceptEntries.length > 0) {
    const allExpandedTerms = [...new Set(conceptEntries.flatMap(([, syns]) => syns))];
    const termOrClauses = allExpandedTerms.map(() =>
      `(LOWER(COALESCE(p.title, '')) LIKE ? OR LOWER(COALESCE(p.subject, '')) LIKE ? OR LOWER(COALESCE(p.category, '')) LIKE ? OR LOWER(COALESCE(p.content, '')) LIKE ?)`
    );
    const termOrParams = allExpandedTerms.flatMap(term => [`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`]);
    conditions.push(`(${termOrClauses.join(' OR ')})`);
    params.push(...termOrParams);
  }

  const fetchLimit = Math.max(limit * 8, 40);
  const sql = `
    SELECT p.id, p.title, p.content, p.type, p.category, p.subject, p.semester, p.semester_no,
           p.target_all_semesters, p.audience_scope, p.cohort_id, p.created_at,
           s.name AS author_name, s.role AS author_role, s.avatarUrl AS author_avatar
    FROM posts p
    JOIN students s ON s.studentId = p.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.created_at DESC
    LIMIT ?
  `;

  try {
    let rows = (await db.all(sql, ...params, fetchLimit)) || [];

    // Relevance & authority scoring across title, subject, category, and content
    rows = rows.map(r => {
      const titleText = `${r.title || ''} ${r.subject || ''}`.toLowerCase();
      const bodyText = `${r.content || ''}`.toLowerCase();
      const fullText = `${titleText} ${r.category || ''} ${bodyText}`.toLowerCase();
      const matchedConcepts = [];
      let titleConceptHits = 0;
      for (const [canon, syns] of conceptEntries) {
        if (syns.some(syn => fullText.includes(syn))) {
          matchedConcepts.push(canon);
        }
        if (syns.some(syn => titleText.includes(syn))) {
          titleConceptHits++;
        }
      }
      let priorityKeywordHits = 0;
      for (const kw of ACADEMIC_NOTICE_PRIORITY_KEYWORDS) {
        if (tokens.some(t => (ALIASES[t] || t) === (ALIASES[kw] || kw)) && fullText.includes(kw)) {
          priorityKeywordHits++;
        }
      }
      const role = String(r.author_role || 'student').trim().toLowerCase();
      const tier = getAuthorAuthorityTier(role);
      const authorityBonus = tier === 1 ? 15 : tier === 2 ? 10 : tier === 3 ? 6 : 0;
      const isAllSem = Number(r.target_all_semesters ?? 1) === 1 || /\ball\s+bit\s+students\b/i.test(fullText);
      const bitWideBonus = isAllSem ? 4 : 0;
      const score = (matchedConcepts.length * 20) + (titleConceptHits * 15) + (priorityKeywordHits * 4) + authorityBonus + bitWideBonus;
      return {
        ...r,
        _matchedConcepts: matchedConcepts,
        _titleConceptHits: titleConceptHits,
        _score: score,
        _authorityTier: tier
      };
    });

    // If query had specific topic concepts, keep rows that matched at least one concept
    if (conceptEntries.length > 0) {
      rows = rows.filter(r => r._matchedConcepts.length > 0);
    }

    // Date filter: NEVER discard a notice published yesterday/earlier about upcoming/resuming classes,
    // holidays, exams, or schedules simply because created_at !== the date in the user's question.
    if (dateInfo && !dateInfo.unresolvable && (dateInfo.date || (dateInfo.startDate && dateInfo.endDate))) {
      const { parseNepaliDateExpression } = require('./nepali-dates');
      const isRelativeInquiry = /\b(tomorrow|bholi|voli|today|aaja|parsi)\b|भोलि|आज|पर्सि/i.test(String(dateInfo.expression || query || ''));
      const dateMatched = rows.filter(r => {
        if (matchesDateFilter(r.created_at || r.createdAt, dateInfo, 'AD')) return true;
        const textDate = parseNepaliDateExpression(`${r.title || ''} ${r.content || ''}`);
        if (textDate && !textDate.unresolvable && textDate.date && matchesDateFilter(textDate.date, dateInfo, 'AD')) {
          return true;
        }
        // A notice about class resumption, schedule, holiday, or exam remains valid after its publication date
        const hasScheduleOrEventTopic = /\b(class|classes|resume|resumption|start\w*|reopen\w*|suru|vacation|dashain|tihar|holiday|bida|chutti|closed|off|postpon\w*|reschedul\w*|cancel\w*|exam|schedule|timetable|regular)\b|बिदा|छुट्टी|परीक्षा|कक्षा|सुरु/i.test(`${r.title || ''} ${r.content || ''}`);
        if ((r._matchedConcepts && r._matchedConcepts.length > 0 && hasScheduleOrEventTopic) || (isRelativeInquiry && hasScheduleOrEventTopic)) {
          return true;
        }
        return false;
      });
      if (dateMatched.length > 0 || conceptEntries.length === 0 || !isRelativeInquiry) {
        rows = dateMatched;
      }
    }

    const mapped = rows.map(row => {
      const authorRole = String(row.author_role || row.role || 'student').trim().toLowerCase();
      const isOfficialAuthor = ['admin', 'teacher', 'cr'].includes(authorRole);
      const isNoticeTypeOrCategory = String(row.type || '').trim().toLowerCase() === 'notice' ||
        String(row.category || '').trim().toLowerCase() === 'notice';
      const isOfficialNotice = isNoticeTypeOrCategory && isOfficialAuthor;
      const cardType = isOfficialNotice ? 'notice' : (row.type === 'assignment' ? 'post_assignment' : 'post');
      return {
        id: row.id,
        title: row.title || truncateContent(row.content, 80),
        content: truncateContent(row.content, isOfficialNotice ? 500 : 280),
        type: isOfficialNotice ? 'notice' : row.type,
        rawType: row.type,
        category: row.category,
        subject: row.subject || null,
        authorName: row.author_name || row.authorName,
        authorRole,
        authorityTier: row._authorityTier || getAuthorAuthorityTier(authorRole),
        isOfficialNotice,
        targetAllSemesters: Number(row.target_all_semesters ?? 1) === 1,
        createdAt: row.created_at || row.createdAt,
        _matchedConcepts: row._matchedConcepts || [],
        _score: row._score || 0,
        resourceCard: {
          type: cardType,
          id: row.id,
          title: row.title || truncateContent(row.content, 60),
          action: isOfficialNotice ? 'view_notice' : 'view_post',
          deepLink: `/posts/${row.id}`,
          mobileRoute: isOfficialNotice ? `/notice/${row.id}` : `/post/${row.id}`,
          mobileParams: { id: row.id }
        }
      };
    });

    const ranked = resolveNoticeSupersession(mapped);
    return ranked.slice(0, limit).map(item => {
      const clean = { ...item };
      delete clean._matchedConcepts;
      delete clean._score;
      return clean;
    });
  } catch (err) {
    console.error('[AI Search] searchPosts error:', err.message);
    if (db && db._throwOnSearchError) throw err;
    return [];
  }
}

/**
 * Searches all authorized notice sources:
 * A. Admin/Teacher/CR-authored posts categorized as NOTICE (`LOWER(p.category) = 'notice'`)
 * B. Official notices stored with `LOWER(p.type) = 'notice'` (or in `knowledge_resources` with `resource_type = 'notice'`)
 * C. Verified official Gandaki University notices (`gu_official`) when `includeOfficialUniversityNotices` is true.
 */
async function searchNotices(db, academicContext, { query = '', dateInfo = null, excludeIds = [], limit = 5, includeOfficialUniversityNotices = false } = {}) {
  const campusNotices = await searchPosts(db, academicContext, { query, type: 'notice', dateInfo, excludeIds, limit: Math.max(limit, 8) });
  if (!includeOfficialUniversityNotices || !academicContext?.authenticated) {
    return campusNotices.slice(0, limit);
  }

  try {
    const guNotices = await searchOfficialUniversityNotices(db, { query, dateInfo, excludeIds, limit });
    return [...guNotices, ...campusNotices].slice(0, Math.max(limit, 6));
  } catch (err) {
    console.error('[AI Search] searchOfficialUniversityNotices error:', err.message);
    return campusNotices.slice(0, limit);
  }
}

/**
 * Searches verified official Gandaki University notices (resource_type = 'gu_official')
 * stored in knowledge_resources / knowledge_chunks.
 */
async function searchOfficialUniversityNotices(db, { query = '', limit = 5 } = {}) {
  const rawTokens = extractSearchTokens(query).filter(
    t => !['gandaki', 'university', 'gu', 'official', 'notice', 'notices', 'announcement', 'announcements', 'portal', 'website'].includes(t)
  );

  try {
    const rows = await db.all(
      `SELECT r.id, r.canonical_id, r.title, r.web_url, r.mobile_route, r.mobile_params,
              r.source_authority_tier, r.created_at, c.content
       FROM knowledge_resources r
       LEFT JOIN knowledge_chunks c ON c.resource_id = r.id AND c.chunk_index = 0
       WHERE r.resource_type = 'gu_official'
         AND r.deleted_at IS NULL
         AND r.hidden_at IS NULL
       ORDER BY r.created_at DESC`
    );

    if (!Array.isArray(rows) || rows.length === 0) return [];

    const matched = rows.filter(row => {
      if (rawTokens.length === 0) return true;
      const hay = `${row.title || ''} ${row.content || ''}`.toLowerCase();
      return rawTokens.some(tok => hay.includes(tok));
    });

    const { resourceCard } = require('./kyana-access');
    return matched.slice(0, limit).map(row => {
      const canonicalId = Number(row.canonical_id || String(row.id).replace(/\D+/g, '') || 0);
      let mobileParams = row.mobile_params;
      if (typeof mobileParams === 'string') {
        try { mobileParams = JSON.parse(mobileParams); } catch (_) { mobileParams = { id: canonicalId, source: 'gandakiuniversity' }; }
      }
      const card = resourceCard('gu_official', {
        id: canonicalId,
        canonical_id: canonicalId,
        title: row.title,
        web_url: row.web_url,
        mobile_route: row.mobile_route,
        mobile_params: mobileParams
      });
      return {
        id: canonicalId || row.id,
        resourceId: row.id,
        title: row.title || 'Official Gandaki University Notice',
        content: truncateContent(row.content || row.title, 280),
        type: 'gu_official',
        category: 'official_university_notice',
        authorName: 'Gandaki University Official Portal',
        createdAt: row.created_at || row.createdAt,
        webUrl: row.web_url || 'https://www.gandakiuniversity.edu.np',
        isOfficialUniversityNotice: true,
        resourceCard: card
      };
    });
  } catch (_) {
    return [];
  }
}

const ASSIGNMENT_STATUS_STOP_WORDS = new Set([
  'assignment', 'assignments', 'homework', 'homeworks', 'task', 'tasks',
  'submit', 'submitted', 'submitting', 'submission', 'submissions', 'unsubmitted',
  'not', 'havent', 'haven', 'hasnt', 'hasn', 'dont', 'didnt', 'didn',
  'pending', 'remaining', 'left', 'incomplete', 'completed', 'complete', 'yet', 'still',
  'status', 'grade', 'graded', 'grades', 'grading', 'mark', 'marks',
  'score', 'scores', 'checked', 'check', 'released', 'release',
  'remark', 'remarks', 'feedback', 'question', 'questions', 'problem', 'problems',
  'description', 'descriptions', 'detail', 'details', 'did', 'have', 'has',
  'what', 'which', 'when', 'where', 'who', 'how', 'is', 'are', 'was', 'were', 'do', 'does',
  'my', 'mero', 'maile', 'vayo', 'bhayo', 'gare', 'gareko', 'garyo', 'nagareko', 'nabujhako',
  'baki', 'xaina', 'chaina', 'छैन', 'बाँकी',
  'aayo', 'aako', 'kati', 'kun', 'k', 'ke', 'xa', 'cha', 'chha', 'ho'
]);

/**
 * Searches assignments visible to the authenticated user.
 * Enriches with assignment_questions and caller-scoped submission status & released grades (for students/CRs)
 * or aggregate submission/grading counts (for teachers/admins).
 */
async function searchAssignments(db, academicContext, { query = '', subject = null, dateInfo = null, excludeIds = [], limit = 5 } = {}) {
  const { matchesDateFilter } = require('./nepali-dates');
  const conditions = [];
  const params = [];
  const excludeSet = new Set(
    (Array.isArray(excludeIds) ? excludeIds : [])
      .map(id => Number(String(id).replace(/^assignment:/i, '')))
      .filter(n => Number.isFinite(n) && n > 0)
  );

  // Semester & cohort authorization
  const authFilter = buildAssignmentSemesterFilter(academicContext, { tableAlias: 'a' });
  conditions.push(`(${authFilter.sql})`);
  params.push(...authFilter.params);

  if (excludeSet.size > 0) {
    const exList = [...excludeSet];
    conditions.push(`a.id NOT IN (${exList.map(() => '?').join(',')})`);
    params.push(...exList);
  }

  // Optional explicit subject filter
  if (subject) {
    const subjList = (Array.isArray(subject) ? subject : [subject])
      .map(s => String(s || '').trim().toLowerCase())
      .filter(Boolean);
    if (subjList.length > 0) {
      conditions.push(`LOWER(TRIM(COALESCE(a.subject, ''))) IN (${subjList.map(() => '?').join(',')})`);
      params.push(...subjList);
    }
  }

  const baseConditions = [...conditions];
  const baseParams = [...params];

  // Text search (strip generic status/grade/question/date inquiry words so status/date lookups still match assignments)
  const DATE_WORDS = new Set([
    'aaja', 'today', 'bholi', 'voli', 'tomorrow', 'hijo', 'yesterday', 'parsi', 'asti',
    'hapta', 'week', 'dekhi', 'samma', 'from', 'between', 'until', 'due', 'deadline', 'deadlines',
    'baisakh', 'jestha', 'asar', 'shrawan', 'bhadra', 'asoj', 'kartik', 'mangsir', 'poush', 'magh', 'falgun', 'chaitra',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'
  ]);
  const rawTokens = extractSearchTokens(query);
  const tokens = rawTokens.filter(t => {
    if (ASSIGNMENT_STATUS_STOP_WORDS.has(t)) return false;
    if (dateInfo && (DATE_WORDS.has(t) || /^\d{1,4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t))) return false;
    return true;
  });
  if (tokens.length > 0) {
    for (const token of tokens) {
      conditions.push(`(LOWER(COALESCE(a.title, '')) LIKE ? OR LOWER(COALESCE(a.description, '')) LIKE ? OR LOWER(COALESCE(a.subject, '')) LIKE ? OR LOWER(COALESCE(a.language, '')) LIKE ?)`);
      params.push(`%${token}%`, `%${token}%`, `%${token}%`, `%${token}%`);
    }
  }

  const fetchLimit = dateInfo ? Math.max(limit * 6, 30) : limit;
  const sql = `
    SELECT a.*, s.name AS teacher_name
    FROM assignments a
    LEFT JOIN students s ON s.studentId = a.createdBy
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.deadline DESC NULLS LAST, a.createdAt DESC
    LIMIT ?
  `;

  try {
    let rows = (await db.all(sql, ...params, fetchLimit)) || [];
    if (rows.length === 0 && tokens.length > 1) {
      const orClauses = tokens.map(() => `(LOWER(COALESCE(a.title, '')) LIKE ? OR LOWER(COALESCE(a.description, '')) LIKE ? OR LOWER(COALESCE(a.subject, '')) LIKE ? OR LOWER(COALESCE(a.language, '')) LIKE ?)`);
      const orParams = tokens.flatMap(t => [`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`]);
      const fallbackSql = `
        SELECT a.*, s.name AS teacher_name
        FROM assignments a
        LEFT JOIN students s ON s.studentId = a.createdBy
        WHERE ${[...baseConditions, `(${orClauses.join(' OR ')})`].join(' AND ')}
        ORDER BY a.deadline DESC NULLS LAST, a.createdAt DESC
        LIMIT ?
      `;
      const orRows = (await db.all(fallbackSql, ...baseParams, ...orParams, fetchLimit)) || [];
      rows = orRows
        .map(r => {
          const hay = `${r.title || ''} ${r.description || ''} ${r.subject || ''} ${r.language || ''}`.toLowerCase();
          return { ...r, _hitCount: tokens.filter(t => hay.includes(t)).length };
        })
        .sort((a, b) => b._hitCount - a._hitCount);
    }

    if (dateInfo && !dateInfo.unresolvable && (dateInfo.date || (dateInfo.startDate && dateInfo.endDate))) {
      const dateFiltered = rows.filter(r => r.deadline && matchesDateFilter(r.deadline, dateInfo, 'AD'));
      rows = dateFiltered;
    }

    rows = rows.slice(0, limit);
    if (rows.length === 0) return [];

    const assignmentIds = rows.map(r => r.id).filter(id => id !== undefined && id !== null);
    const placeholders = assignmentIds.map(() => '?').join(',');

    // 1. Load assignment questions for matched assignments
    let questionRows = [];
    if (assignmentIds.length > 0) {
      try {
        questionRows = (await db.all(
          `SELECT id, assignmentId, questionNumber, title, description, language, COALESCE(maxPoints, 10) AS maxPoints
           FROM assignment_questions
           WHERE assignmentId IN (${placeholders})
           ORDER BY assignmentId ASC, questionNumber ASC, id ASC`,
          ...assignmentIds
        )) || [];
      } catch (_) {
        questionRows = [];
      }
    }

    const questionsByAssignment = new Map();
    for (const q of questionRows) {
      const aId = Number(q.assignmentId ?? q.assignmentid);
      if (!questionsByAssignment.has(aId)) questionsByAssignment.set(aId, []);
      questionsByAssignment.get(aId).push({
        id: Number(q.id),
        questionNumber: Number(q.questionNumber ?? q.questionnumber ?? 1),
        title: q.title || `Question ${q.questionNumber ?? q.questionnumber ?? 1}`,
        description: q.description || '',
        language: q.language || null,
        maxPoints: Number(q.maxPoints ?? q.maxpoints ?? 10)
      });
    }

    // 2. Caller-scoped student submission & released grade enrichment (NEVER uses user/model-supplied ID)
    const isStudentOrCr = academicContext?.authenticated && ['student', 'cr'].includes(academicContext?.role);
    const callerStudentId = isStudentOrCr ? String(academicContext.studentId || '').trim() : null;
    const studentSubsByAssignment = new Map();

    if (callerStudentId && assignmentIds.length > 0) {
      let subRows = [];
      try {
        subRows = (await db.all(
          `SELECT sub.id, sub.assignmentId, sub.questionId, sub.questionTitle, sub.submittedAt,
                  aq.questionNumber, aq.title AS aqTitle, COALESCE(aq.maxPoints, 10) AS maxPoints,
                  sg.marksObtained, sg.remarks, sg.checked, sg.released
           FROM submissions sub
           LEFT JOIN assignment_questions aq ON aq.id = sub.questionId
           LEFT JOIN submission_grades sg ON sg.questionId = sub.questionId AND sg.studentId = sub.studentId
           WHERE sub.studentId = ? AND sub.assignmentId IN (${placeholders})
           ORDER BY sub.submittedAt DESC, sub.id DESC`,
          callerStudentId,
          ...assignmentIds
        )) || [];
      } catch (_) {
        // Fallback if submission_grades or assignment_questions is not present in a minimal test schema
        try {
          subRows = (await db.all(
            `SELECT id, assignmentId, questionId, questionTitle, submittedAt
             FROM submissions
             WHERE studentId = ? AND assignmentId IN (${placeholders})
             ORDER BY submittedAt DESC, id DESC`,
            callerStudentId,
            ...assignmentIds
          )) || [];
        } catch (__) {
          subRows = [];
        }
      }

      for (const s of subRows) {
        const aId = Number(s.assignmentId ?? s.assignmentid);
        if (!studentSubsByAssignment.has(aId)) studentSubsByAssignment.set(aId, []);
        const rawReleased = s.released;
        const isReleased = Boolean(
          rawReleased === true || rawReleased === 1 || rawReleased === '1' || rawReleased === 't'
        );
        const rawMarks = s.marksObtained ?? s.marksobtained;
        const marksObtained = isReleased && rawMarks !== null && rawMarks !== undefined && rawMarks !== ''
          ? Number(rawMarks)
          : null;
        const maxPoints = Number(s.maxPoints ?? s.maxpoints ?? 10);
        const remarks = isReleased && s.remarks ? String(s.remarks).trim() : null;

        studentSubsByAssignment.get(aId).push({
          submissionId: s.id,
          questionId: s.questionId ?? s.questionid ?? null,
          questionNumber: s.questionNumber ?? s.questionnumber ?? null,
          questionTitle: s.aqTitle || s.aqtitle || s.questionTitle || s.questiontitle || 'Question',
          submittedAt: s.submittedAt || s.submittedat || null,
          released: isReleased,
          checked: isReleased ? Boolean(s.checked) : false,
          marksObtained,
          maxPoints,
          remarks
        });
      }
    }

    return rows.map(row => {
      const aId = Number(row.id);
      const questions = questionsByAssignment.get(aId) || [];
      let studentSubmission = null;

      if (callerStudentId) {
        const subs = studentSubsByAssignment.get(aId) || [];
        const submitted = subs.length > 0;
        const totalQuestionsCount = questions.length;
        const submittedQuestionsCount = subs.length;
        const submissionStatus = !submitted
          ? 'not_submitted'
          : (totalQuestionsCount > 0 && submittedQuestionsCount < totalQuestionsCount
              ? 'partially_submitted'
              : 'submitted');
        const latestSubmittedAt = subs.map(s => s.submittedAt).filter(Boolean).sort().reverse()[0] || null;

        const releasedSubs = subs.filter(s => s.released);
        const releasedGrades = releasedSubs.map(s => ({
          questionId: s.questionId,
          questionNumber: s.questionNumber,
          questionTitle: s.questionTitle,
          marksObtained: s.marksObtained,
          maxPoints: s.maxPoints,
          remarks: s.remarks
        }));

        const hasReleasedGrades = releasedGrades.length > 0;
        const totalMarksObtained = hasReleasedGrades
          ? releasedGrades.reduce((acc, g) => acc + (Number.isFinite(g.marksObtained) ? g.marksObtained : 0), 0)
          : null;
        const totalMaxPoints = hasReleasedGrades
          ? releasedGrades.reduce((acc, g) => acc + (Number.isFinite(g.maxPoints) ? g.maxPoints : 0), 0)
          : null;

        studentSubmission = {
          submitted,
          submissionStatus,
          submittedQuestionsCount,
          totalQuestionsCount,
          submittedAt: latestSubmittedAt,
          hasReleasedGrades,
          releasedGradesCount: releasedGrades.length,
          unreleasedSubmissionsCount: Math.max(0, subs.length - releasedGrades.length),
          totalMarksObtained,
          totalMaxPoints,
          releasedGrades,
          submissions: subs
        };
      }

      return {
        id: row.id,
        title: row.title,
        description: truncateContent(row.description || row.instructions || '', 300),
        fullDescription: row.description || row.instructions || '',
        language: row.language,
        subject: row.subject,
        semester: row.semester || (row.semester_no ? `Semester ${row.semester_no}` : null),
        deadline: row.deadline,
        pdfUrl: row.pdfUrl || row.pdfurl || null,
        pdfName: row.pdfName || row.pdfname || null,
        teacherName: row.teacher_name || row.teacherName || 'Instructor',
        createdAt: row.createdAt || row.created_at,
        questionCount: questions.length,
        questions,
        studentSubmission,
        resourceCard: {
          type: 'assignment',
          id: row.id,
          title: row.title,
          subject: row.subject,
          action: 'view_assignment',
          deepLink: `/code-lab/assignment.html?id=${row.id}`,
          mobileRoute: `/assignments/${row.id}`,
          mobileParams: { assignmentId: row.id }
        }
      };
    });
  } catch (err) {
    console.error('[AI Search] searchAssignments error:', err.message);
    return [];
  }
}

/**
 * Searches notes/files visible to the authenticated student.
 * Wraps the existing note-search with semester authorization.
 */
async function searchAuthorizedNotes(db, academicContext, { query = '', subject, limit = 3, searchNotes } = {}) {
  // Determine authorized semester
  const semesterNo = academicContext?.cohort?.currentSemester
    || parseSemesterNumber(academicContext?.semester)
    || null;

  // If student is authenticated and has a semester, force the semester filter
  // regardless of what they typed in the message
  const semester = (academicContext?.authenticated && semesterNo) ? semesterNo : undefined;

  try {
    const files = await searchNotes(db, { query, semester, subject, academicContext });
    return files.slice(0, limit).map(f => ({
      ...f,
      resourceCard: {
        type: 'note',
        id: f.id,
        title: f.title || f.originalName,
        subject: f.subject,
        semester: f.semester,
        action: 'open_note',
        deepLink: `/material/${f.id}`,
        viewUrl: `/api/files/${f.id}/view`,
        downloadUrl: `/api/files/${f.id}/download`,
        mobileRoute: `/material/${f.id}`,
        mobileParams: { id: f.id }
      }
    }));
  } catch (err) {
    console.error('[AI Search] searchAuthorizedNotes error:', err.message);
    return [];
  }
}

// ── Helpers ──

/**
 * Builds an assignment semester authorization filter.
 * Supports both semester_no and legacy semester text aliases, plus teacher assignedSubjects.
 */
function buildAssignmentSemesterFilter(academicContext, { tableAlias = 'a' } = {}) {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  if (!academicContext || !academicContext.authenticated) {
    return { sql: `${prefix}audience_scope = 'all_students'`, params: [] };
  }

  const hasTeacherScope = academicContext.role === 'teacher' && (
    Array.isArray(academicContext.assignedSemesters) || Array.isArray(academicContext.assignedSubjects)
  );

  if (academicContext.role === 'admin' || (academicContext.canViewAllCohorts && !hasTeacherScope)) {
    return { sql: '1=1', params: [] };
  }

  if (academicContext.role === 'teacher') {
    const clauses = [];
    const params = [];
    if (Array.isArray(academicContext.assignedSemesters)) {
      if (academicContext.assignedSemesters.length === 0) {
        return { sql: `${prefix}createdBy = ?`, params: [academicContext.studentId || '__none__'] };
      }
      const sems = academicContext.assignedSemesters;
      const allAliases = sems.flatMap(sem => semesterAliases(sem));
      clauses.push(`(${prefix}semester_no IN (${sems.map(() => '?').join(',')}) OR LOWER(TRIM(COALESCE(${prefix}semester, ''))) IN (${allAliases.map(() => '?').join(',')}))`);
      params.push(...sems, ...allAliases);
    }
    const { teacherSubjectAliases } = require('./kyana-access');
    const allowedSubjects = teacherSubjectAliases(academicContext);
    if (allowedSubjects !== null) {
      const ownerParam = academicContext.studentId || '__none__';
      if (allowedSubjects.length > 0) {
        clauses.push(`(${prefix}createdBy = ? OR LOWER(TRIM(COALESCE(${prefix}subject, ''))) IN (${allowedSubjects.map(() => '?').join(',')}))`);
        params.push(ownerParam, ...allowedSubjects);
      } else {
        clauses.push(`(${prefix}createdBy = ?)`);
        params.push(ownerParam);
      }
    }
    if (clauses.length > 0) {
      return { sql: clauses.join(' AND '), params };
    }
    return { sql: '1=1', params: [] };
  }

  const cohortId = academicContext.cohort?.id || academicContext.cohortId || null;
  const semesterNo = academicContext.cohort?.currentSemester
    || academicContext.currentSemester
    || parseSemesterNumber(academicContext.semester)
    || null;

  if (!semesterNo) {
    return { sql: `${prefix}audience_scope = 'all_students'`, params: [] };
  }

  const aliases = semesterAliases(semesterNo);
  const semClause = `(${prefix}semester_no = ? OR LOWER(TRIM(COALESCE(${prefix}semester, ''))) IN (${aliases.map(() => '?').join(',')}))`;

  if (cohortId) {
    return {
      sql: `((${prefix}cohort_id = ? OR ${prefix}audience_scope = 'all_students') AND ${semClause})`,
      params: [cohortId, semesterNo, ...aliases]
    };
  }

  return {
    sql: `(${prefix}audience_scope = 'all_students' AND ${semClause})`,
    params: [semesterNo, ...aliases]
  };
}

/**
 * Builds a post-specific semester and visibility authorization filter.
 * Posts use post_target_semesters junction table + target_all_semesters flag.
 */
function buildPostSemesterFilter(academicContext, { tableAlias = 'p' } = {}) {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  if (!academicContext || !academicContext.authenticated) {
    return {
      sql: `${prefix}audience_scope = 'all_students' AND ${prefix}target_all_semesters = 1 AND COALESCE(${prefix}visibility, 'everyone') IN ('everyone', 'public')`,
      params: []
    };
  }

  const hasTeacherScope = academicContext.role === 'teacher' && (
    Array.isArray(academicContext.assignedSemesters) || Array.isArray(academicContext.assignedSubjects)
  );

  if (academicContext.role === 'admin') {
    if (academicContext.moderation) {
      return { sql: '1=1', params: [] };
    }
    const authorParam = academicContext.studentId || '__none__';
    return {
      sql: `(COALESCE(${prefix}visibility, 'everyone') NOT IN ('students_only', 'students-only', 'students') OR ${prefix}user_id = ?)`,
      params: [authorParam]
    };
  }

  if (academicContext.canViewAllCohorts && !hasTeacherScope) {
    const visClause = academicContext.role === 'teacher'
      ? `(COALESCE(${prefix}visibility, 'everyone') IN ('everyone', 'public', 'teachers_only', 'teachers-only') AND (${prefix}user_id = ? OR LOWER(TRIM(COALESCE(${prefix}type, ''))) = 'notice' OR LOWER(TRIM(COALESCE(${prefix}category, ''))) = 'notice' OR NOT EXISTS (SELECT 1 FROM students s_auth WHERE s_auth.studentId = ${prefix}user_id AND s_auth.role = 'teacher')))`
      : '1=1';
    const params = academicContext.role === 'teacher' ? [academicContext.studentId || '__none__'] : [];
    return { sql: visClause, params };
  }

  if (academicContext.role === 'teacher') {
    const authorParam = academicContext.studentId || '__none__';
    const visClause = `COALESCE(${prefix}visibility, 'everyone') IN ('everyone', 'public', 'teachers_only', 'teachers-only')`;
    const peerClause = `(LOWER(TRIM(COALESCE(${prefix}type, ''))) = 'notice' OR LOWER(TRIM(COALESCE(${prefix}category, ''))) = 'notice' OR NOT EXISTS (SELECT 1 FROM students s_auth WHERE s_auth.studentId = ${prefix}user_id AND s_auth.role = 'teacher'))`;
    const sems = Array.isArray(academicContext.assignedSemesters) ? academicContext.assignedSemesters : [];
    const semClause = sems.length > 0
      ? `(${prefix}target_all_semesters = 1 OR ${prefix}semester_no IN (${sems.map(() => '?').join(',')}) OR ${prefix}id IN (SELECT post_id FROM post_target_semesters WHERE semester IN (${sems.map(() => '?').join(',')})))`
      : `(${prefix}target_all_semesters = 1)`;
    return {
      sql: `(${prefix}user_id = ? OR (${visClause} AND ${peerClause} AND ${semClause}))`,
      params: [authorParam, ...sems, ...sems]
    };
  }

  const cohortId = academicContext.cohort?.id || academicContext.cohortId || null;
  const semesterNo = academicContext.cohort?.currentSemester
    || academicContext.currentSemester
    || parseSemesterNumber(academicContext.semester)
    || null;

  const studentVisClause = `(COALESCE(${prefix}visibility, 'everyone') IN ('everyone', 'public', 'students_only', 'students-only', 'students', 'cohort_only', 'cohort-only') OR ${prefix}user_id = ?)`;
  const studentVisParam = academicContext.studentId || '__none__';

  if (!semesterNo && !cohortId) {
    return {
      sql: `${studentVisClause} AND ${prefix}audience_scope = 'all_students' AND ${prefix}target_all_semesters = 1`,
      params: [studentVisParam]
    };
  }

  const parts = [];
  const params = [studentVisParam];

  // Global-audience posts for all semesters
  parts.push(`(${prefix}target_all_semesters = 1 AND ${prefix}audience_scope = 'all_students')`);

  if (cohortId) {
    // Cohort posts for all semesters
    parts.push(`(${prefix}target_all_semesters = 1 AND ${prefix}cohort_id = ?)`);
    params.push(cohortId);

    if (semesterNo) {
      // Cohort posts targeting this specific semester
      parts.push(`(${prefix}target_all_semesters = 0 AND ${prefix}cohort_id = ? AND (${prefix}id IN (SELECT post_id FROM post_target_semesters WHERE semester = ?) OR ${prefix}semester_no = ?))`);
      params.push(cohortId, semesterNo, semesterNo);

      // Global posts targeting this specific semester
      parts.push(`(${prefix}target_all_semesters = 0 AND ${prefix}audience_scope = 'all_students' AND (${prefix}id IN (SELECT post_id FROM post_target_semesters WHERE semester = ?) OR ${prefix}semester_no = ?))`);
      params.push(semesterNo, semesterNo);
    }
  } else if (semesterNo) {
    // No cohort, only global posts targeting this semester
    parts.push(`(${prefix}target_all_semesters = 0 AND ${prefix}audience_scope = 'all_students' AND (${prefix}id IN (SELECT post_id FROM post_target_semesters WHERE semester = ?) OR ${prefix}semester_no = ?))`);
    params.push(semesterNo, semesterNo);
  }

  return { sql: `${studentVisClause} AND (${parts.join(' OR ')})`, params };
}

/**
 * Extracts normalized search tokens from a query string.
 * Strips common filler words.
 */
function extractSearchTokens(query) {
  return require('./knowledge-relevance').queryTerms(query);
}

/**
 * Truncates text content for preview display.
 */
function truncateContent(text, maxLen = 200) {
  if (!text) return '';
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '…' : cleaned;
}

module.exports = {
  searchPosts,
  searchNotices,
  searchOfficialUniversityNotices,
  searchAssignments,
  searchAuthorizedNotes,
  buildPostSemesterFilter,
  buildAssignmentSemesterFilter,
  buildFilesSemesterFilter,
  extractSearchTokens
};
