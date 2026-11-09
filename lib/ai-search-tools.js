'use strict';

/**
 * Semester-aware search tools for Kyana AI.
 *
 * SECURITY & ACCESS POLICY:
 * 1. General Academic Information (posts, notices, announcements):
 *    Discoverable across all semesters when visible under post visibility rules.
 *    Retains accurate source semester, author, verified role, and publication date.
 * 2. Academic Learning Resources (notes/files) & Assignments:
 *    Default to the student's assigned semester (`current_semester_learning`).
 *    Allow explicit cross-semester or all-semester retrieval (`explicit_cross_semester_learning`)
 *    when the student explicitly requests another semester, all semesters, or a subject from another semester.
 * 3. Personal Academic Records (attendance, marks/results, assignment submissions):
 *    Strictly caller-scoped (`personal_academic_records`). Never exposes another student's records.
 */

const { parseSemesterNumber } = require('./academic-context');
const { resourceFilter, formatResourceSemester } = require('./kyana-access');
const { normalizeSemester, semesterAliases } = require('./note-search');

/**
 * Builds a semester-authorization WHERE clause for the `files` table.
 */
function buildFilesSemesterFilter(academicContext, { tableAlias = 'f', requestedSemester = null, searchAllSemesters = false } = {}) {
  return resourceFilter(academicContext, 'note', tableAlias, { requestedSemester, searchAllSemesters });
}

const NOTICE_SYNONYM_GROUPS = {
  resume: ['resume', 'resumption', 'resuming', 'resumed', 'start', 'starts', 'starting', 'started', 'reopen', 'reopens', 'reopening', 'begin', 'begins', 'suru', 'shuru', 'khulxa', 'khulcha', 'khulne', 'lagxa', 'lagne', 'sanchalan', 'schedule', 'timetable', 'सुरु', 'शुरु', 'सञ्चालन', 'सुचारु', 'खुल्ने', 'खुल्छ'],
  class: ['class', 'classes', 'kaksha', 'lecture', 'lectures', 'academic', 'कक्षा', 'कक्षाहरू'],
  regular: ['regular', 'regularly', 'नियमित', 'नियम'],
  holiday: ['holiday', 'holidays', 'vacation', 'vacations', 'bida', 'chutti', 'dashain', 'tihar', 'closed', 'off', 'बिदा', 'छुट्टी'],
  vacation: ['vacation', 'vacations', 'holiday', 'holidays', 'dashain', 'tihar', 'bida', 'chutti', 'बिदा', 'छुट्टी'],
  dashain: ['dashain', 'tihar', 'vacation', 'holiday', 'दशैं', 'दशैँ'],
  exam: ['exam', 'exams', 'examination', 'examinations', 'pariksha', 'midterm', 'preboard', 'final', 'परीक्षा', 'जाँच'],
  routine: ['routine', 'routines', 'timetable', 'schedule', 'schedules', 'तालिका', 'रुटिन'],
  defense: ['defense', 'defence', 'viva', 'presentation', 'proposal', 'डिफेन्स', 'भाइभा'],
  defence: ['defense', 'defence', 'viva', 'presentation', 'proposal', 'डिफेन्स', 'भाइभा'],
  viva: ['viva', 'defense', 'defence', 'presentation', 'proposal', 'भाइभा'],
  presentation: ['presentation', 'defense', 'defence', 'proposal', 'प्रस्तुतिकरण'],
  proposal: ['proposal', 'defense', 'defence', 'presentation'],
  seminar: ['seminar', 'workshop', 'webinar', 'सेमिनार'],
  workshop: ['workshop', 'seminar', 'webinar', 'कार्यशाला'],
  orientation: ['orientation', 'induction', 'welcome']
};

const ACADEMIC_NOTICE_PRIORITY_KEYWORDS = [
  'class', 'classes', 'resume', 'resumption', 'start', 'reopen', 'suru',
  'vacation', 'dashain', 'tihar', 'holiday', 'schedule', 'timetable',
  'defense', 'defence', 'viva', 'presentation', 'proposal', 'seminar'
];

const GENERIC_NOTICE_META_WORDS = new Set([
  'notice', 'notices', 'announcement', 'announcements', 'circular', 'circulars',
  'update', 'updates', 'suchana', 'suchanaa', 'official', 'campus', 'college',
  'post', 'posts', 'another', 'other', 'different', 'arko', 'aru', 'kunai', 'sabai',
  'available', 'published', 'recent', 'latest', 'any', 'all', 'from', 'for',
  'semester', 'semesters', 'sem', 'admin', 'teacher', 'cr', 'departmental', 'department',
  'sir', 'mam', 'maam', 'professor', 'instructor', 'halnu', 'halyo', 'haleko', 'halya',
  'vako', 'bhako', 'bhaeko', 'vaeko', 'garnu', 'gareko', 'ke', 'k',
  'subject', 'subjects', 'kun', 'kasto', 'meaning', 'matlab', 'explain', 'gara', 'yo', 'tyo', 'this', 'that',
  'previous', 'history', 'purano', 'paila', 'earlier', 'superseded', 'purnao',
  'ho', 'haina', 'hoina', 'ki', 'bata', 'bataa', 'bataw', 'dekhi', 'kaile', 'kahile', 'kile', 'kaha', 'kata',
  'kasari', 'kina', 'kati', 'cha', 'xa', 'x', 'chha', 'chhan', 'xan', 'chan', 'chai', 'chaie',
  'chaina', 'xaina', 'chhaina', 'thiyo', 'thyo', 'thie',
  'hunxa', 'huncha', 'hune', 'huna', 'vayo', 'bhayo', 'vaye', 'bhaye',
  'garne', 'garyo', 'garda', 'bujha', 'bujhina', 'bujhaideu', 'vandai', 'vaneko', 'vane', 'vanya', 'bhanya',
  'barema', 'bare', 'vana', 'bhana', 'bhan', 'bataideu', 'vandinu', 'bhandinu', 'heram', 'hera', 'summary', 'details', 'kura', 'vivaran',
  'hamro', 'mero', 'timro', 'tapai', 'tapaiko', 'ni', 'ta', 'ani', 'pani', 'matra', 'samma', 'la',
  'सूचना', 'हो', 'हैन', 'होइन', 'कि', 'बाट', 'देखि', 'कहिले', 'थियो', 'छ', 'छैन', 'हुन्छ', 'बारेमा', 'भन'
]);

const ROLE_FILTER_WORDS = new Set(['admin', 'teacher', 'cr']);
const SEMESTER_TOKEN_WORDS = new Set([
  '1', '2', '3', '4', '5', '6', '7', '8',
  '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
  'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'
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

function extractPostTitle(content, explicitTitle) {
  if (explicitTitle && String(explicitTitle).trim()) {
    return String(explicitTitle).trim();
  }
  const match = String(content || '').match(/(?:^|\n|\r)\s*(?:Subject|Title)\s*:\s*([^\r\n]+)/i);
  if (match && match[1] && match[1].trim()) {
    return match[1].trim();
  }
  return '';
}

const postColumnsCache = new WeakMap();

async function getPostTableColumns(db) {
  if (db && typeof db === 'object') {
    const cached = postColumnsCache.get(db);
    if (cached) return cached;
  }
  let columnSet = null;
  try {
    if (db && typeof db.all === 'function') {
      const isPg = Boolean(db.isPostgres || (db.query && !db.run));
      if (isPg) {
        try {
          const rows = await db.all(
            "SELECT column_name FROM information_schema.columns WHERE LOWER(table_name) = 'posts'"
          );
          if (Array.isArray(rows) && rows.length > 0) {
            columnSet = new Set(
              rows
                .map(r => String(r.column_name || r.columnname || r.columnName || r.name || '').toLowerCase())
                .filter(Boolean)
            );
          }
        } catch (_) {}
      }
      if (!columnSet || columnSet.size === 0) {
        try {
          const cols = await db.all("PRAGMA table_info(posts)");
          if (Array.isArray(cols) && cols.length > 0) {
            columnSet = new Set(
              cols
                .map(c => String(c.name || c.column_name || c.columnname || '').toLowerCase())
                .filter(Boolean)
            );
          }
        } catch (_) {}
      }
      if (!columnSet || columnSet.size === 0) {
        try {
          const rows = await db.all(
            "SELECT column_name FROM information_schema.columns WHERE LOWER(table_name) = 'posts'"
          );
          if (Array.isArray(rows) && rows.length > 0) {
            columnSet = new Set(
              rows
                .map(r => String(r.column_name || r.columnname || r.columnName || r.name || '').toLowerCase())
                .filter(Boolean)
            );
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
  const fallback = new Set([
    'id', 'user_id', 'title', 'content', 'type', 'category', 'visibility',
    'target_all_semesters', 'semester_no', 'audience_scope', 'cohort_id', 'created_at'
  ]);
  const finalSet = (columnSet && columnSet.size > 0) ? columnSet : fallback;
  if (db && typeof db === 'object') {
    postColumnsCache.set(db, finalSet);
  }
  return finalSet;
}

function toIsoTimestampString(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? '' : val.toISOString();
  }
  return String(val);
}

function resolveNoticeSupersession(items) {
  if (!Array.isArray(items) || items.length <= 1) return items;
  // Sort by createdAt descending so the newest notice on a topic is evaluated first
  const byNewest = [...items].sort((a, b) =>
    toIsoTimestampString(b.createdAt || b.created_at).localeCompare(toIsoTimestampString(a.createdAt || a.created_at))
  );
  for (const newer of byNewest) {
    const newerDate = toIsoTimestampString(newer.createdAt || newer.created_at);
    if (!newerDate) continue;
    const newerText = `${newer.title || ''} ${newer.content || ''}`;
    const hasExplicitUpdateSignal = /\b(updated?|revised?|rescheduled?|supersedes?|corrigendum|amendment|new\s+schedule|latest)\b/i.test(newerText);
    const newerTier = Number(newer.authorityTier || getAuthorAuthorityTier(newer.authorRole));
    for (const older of byNewest) {
      if (older.id === newer.id && older.type === newer.type) continue;
      if (older.superseded) continue;
      const olderDate = toIsoTimestampString(older.createdAt || older.created_at);
      if (!olderDate || newerDate <= olderDate) continue;
      const olderTier = Number(older.authorityTier || getAuthorAuthorityTier(older.authorRole));
      const isStrictlyLaterDay = newerDate.slice(0, 10) > olderDate.slice(0, 10);
      const bothOfficial = newerTier <= 2 && olderTier <= 2;
      if (newerTier > olderTier && (!isStrictlyLaterDay || !bothOfficial)) continue;
      const newerConcepts = newer._matchedConcepts || [];
      const olderConcepts = older._matchedConcepts || [];
      const shared = newerConcepts.filter(c => olderConcepts.includes(c));

      const PRIMARY_TOPIC_CONCEPTS = new Set([
        'resume', 'class', 'holiday', 'vacation', 'dashain', 'tihar', 'exam',
        'routine', 'timetable', 'schedule', 'admission', 'fee', 'result', 'scholarship'
      ]);
      const sharesPrimaryConcept = shared.some(c => PRIMARY_TOPIC_CONCEPTS.has(c));
      const sharesSubject = Boolean(
        newer.subject && older.subject && String(newer.subject).trim().toLowerCase() === String(older.subject).trim().toLowerCase()
      );
      const coversOlderTopic = olderConcepts.length > 0
        ? (olderConcepts.every(c => newerConcepts.includes(c)) || (shared.length / olderConcepts.length >= 0.5))
        : (newerConcepts.length === 0);

      const isSameTopic = sharesSubject ||
        (sharesPrimaryConcept && (shared.length >= 2 || shared.includes('resume') || shared.includes('holiday') || shared.includes('exam'))) ||
        coversOlderTopic;

      if (isSameTopic && (hasExplicitUpdateSignal || (isStrictlyLaterDay && (shared.length > 0 || sharesSubject) && (newer._score || 0) >= (older._score || 0) - 20))) {
        older.superseded = true;
        older.supersededBy = newer.id;
        if ((newer._score || 0) <= (older._score || 0)) {
          newer._score = (older._score || 0) + 25;
        }
      }
    }
  }

  return items.sort((a, b) => {
    // 1. Active, non-superseded notices strictly before superseded notices
    if (Boolean(a.superseded) !== Boolean(b.superseded)) {
      return a.superseded ? 1 : -1;
    }
    // 2. Official authorities (Admin/Teacher/CR) before student posts
    const tierA = Number(a.authorityTier || a._authorityTier || getAuthorAuthorityTier(a.authorRole));
    const tierB = Number(b.authorityTier || b._authorityTier || getAuthorAuthorityTier(b.authorRole));
    const aOfficial = tierA <= 3;
    const bOfficial = tierB <= 3;
    if (aOfficial !== bOfficial) return aOfficial ? -1 : 1;

    // 3. Relevance to query: higher score first
    const scoreDiff = (Number(b._score || 0) - Number(a._score || 0));
    if (scoreDiff !== 0) return scoreDiff;

    // 4. LATEST publication/creation date strictly prioritized for equal relevance!
    const dateA = toIsoTimestampString(a.createdAt || a.created_at || a.publishedDate);
    const dateB = toIsoTimestampString(b.createdAt || b.created_at || b.publishedDate);
    if (dateA && dateB && dateA !== dateB) {
      return dateB.localeCompare(dateA);
    }

    return scoreDiff || (tierA - tierB);
  });
}

/**
 * Searches posts and notices visible to the authenticated user across semesters.
 * Enforces visibility, role authority for notices/announcements, and optional semester filters.
 *
 * @param {object} db
 * @param {object} academicContext - from getAcademicContext()
 * @param {object} opts
 * @param {string} [opts.query] - search query text
 * @param {string} [opts.type] - 'status', 'assignment', 'notice', or null for all
 * @param {number|string} [opts.semester] - optional explicit semester filter (1-8)
 * @param {boolean} [opts.otherSemesterOnly=false] - when true, filter to semesters other than the student's current semester
 * @param {object} [opts.dateInfo]
 * @param {Array} [opts.excludeIds]
 * @param {number} [opts.limit=5]
 */
async function searchPosts(db, academicContext, {
  query = '',
  type = null,
  semester = null,
  otherSemesterOnly = false,
  dateInfo = null,
  excludeIds = [],
  limit = 5
} = {}) {
  const { matchesDateFilter } = require('./nepali-dates');
  const { ALIASES } = require('./knowledge-relevance');
  const conditions = [];
  const params = [];
  const excludeSet = new Set(
    (Array.isArray(excludeIds) ? excludeIds : [])
      .map(id => Number(String(id).replace(/^(?:post|notice):/i, '')))
      .filter(n => Number.isFinite(n) && n > 0)
  );

  // Unified Notice & Announcement Type filter:
  // When type === 'notice', include dedicated notice posts (LOWER(p.type) IN ('notice', 'announcement'))
  // and posts categorized as NOTICE or ANNOUNCEMENT (LOWER(p.category) IN ('notice', 'announcement')),
  // AND strictly verify that the author's trusted database role in `students` is admin, teacher, or cr.
  // Regular student posts (s.role = 'student') are NEVER treated as official notices.
  if (type === 'notice') {
    conditions.push("(LOWER(TRIM(COALESCE(p.type, ''))) IN ('notice', 'announcement') OR LOWER(TRIM(COALESCE(p.category, ''))) IN ('notice', 'announcement'))");
    conditions.push("LOWER(TRIM(COALESCE(s.role, 'student'))) IN ('admin', 'teacher', 'cr')");
  } else if (type && ['status', 'assignment'].includes(type)) {
    conditions.push('p.type = ?');
    params.push(type);
  }

  const parsedRequestedSem = parseSemesterNumber(semester);
  const isOtherSemQuery = Boolean(
    otherSemesterOnly ||
    (!parsedRequestedSem && /\b(?:another|other|different|arko|aru)\s+semesters?\b|अर्को\s*सेमेस्टर/i.test(String(query || '')))
  );

  const postCols = await getPostTableColumns(db);

  // Visibility & optional semester filter (no mandatory restriction to student's own semester)
  const authFilter = buildPostSemesterFilter(academicContext, {
    tableAlias: 'p',
    requestedSemester: parsedRequestedSem,
    otherSemesterOnly: isOtherSemQuery,
    postColumns: postCols
  });
  conditions.push(`(${authFilter.sql})`);
  params.push(...authFilter.params);

  if (postCols.has('moderation_status')) {
    conditions.push("(p.moderation_status IS NULL OR p.moderation_status = 'active')");
  }
  if (postCols.has('deleted_at')) {
    conditions.push('p.deleted_at IS NULL');
  }
  if (postCols.has('hidden_at')) {
    conditions.push('p.hidden_at IS NULL');
  }

  if (excludeSet.size > 0) {
    const exList = [...excludeSet];
    conditions.push(`p.id NOT IN (${exList.map(() => '?').join(',')})`);
    params.push(...exList);
  }

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

  // Detect if query explicitly asks for a specific author role (e.g. "admin announcement", "teacher notice", "Sir le ke notice halnu vako cha?")
  let requestedRoles = rawTokens.filter(t => ROLE_FILTER_WORDS.has(t));
  if (requestedRoles.length === 0 && /\b(?:(?:sir|mam|ma'?am|professor|teacher)\s+le|(?:by|from)\s+(?:our\s+|the\s+)?(?:sir|mam|ma'?am|professor|teacher))\b|सरले|म्यामले|शिक्षकले/i.test(String(query || ''))) {
    requestedRoles = ['teacher'];
  }
  if (requestedRoles.length === 1) {
    conditions.push('LOWER(TRIM(COALESCE(s.role, \'\'))) = ?');
    params.push(requestedRoles[0]);
  }

  // Strip generic meta words ('notice', 'announcement', 'update', 'another', 'semester', etc.)
  // and discard single-letter non-digit tokens (e.g. 'x', 'a') which cause spurious wildcard matches
  tokens = tokens.filter(t => {
    if (!/^\d+$/.test(t) && t.length < 2) return false;
    if (GENERIC_NOTICE_META_WORDS.has(t)) return false;
    if ((parsedRequestedSem || isOtherSemQuery) && SEMESTER_TOKEN_WORDS.has(t)) return false;
    return true;
  });

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
    const searchFields = ['p.title', 'p.category', 'p.content', 's.name'];
    if (postCols.has('subject')) searchFields.push('p.subject');
    const termOrClauses = allExpandedTerms.map(() =>
      `(${searchFields.map(f => `LOWER(COALESCE(${f}, '')) LIKE ?`).join(' OR ')})`
    );
    const termOrParams = allExpandedTerms.flatMap(term => searchFields.map(() => `%${term}%`));
    conditions.push(`(${termOrClauses.join(' OR ')})`);
    params.push(...termOrParams);
  }

  const fetchLimit = Math.max(limit * 8, 40);
  const selectSubject = postCols.has('subject') ? 'p.subject' : 'NULL AS subject';
  const selectSemester = postCols.has('semester') ? 'p.semester' : 'NULL AS semester';
  const selectSemesterNo = postCols.has('semester_no') ? 'p.semester_no' : 'NULL AS semester_no';
  const selectTargetAll = postCols.has('target_all_semesters') ? 'p.target_all_semesters' : '1 AS target_all_semesters';
  const selectAudience = postCols.has('audience_scope') ? 'p.audience_scope' : "'all_students' AS audience_scope";
  const selectCohort = postCols.has('cohort_id') ? 'p.cohort_id' : 'NULL AS cohort_id';
  const selectVisibility = postCols.has('visibility') ? 'p.visibility' : "'everyone' AS visibility";
  const selectCreatedAt = postCols.has('created_at') ? 'p.created_at' : 'CURRENT_TIMESTAMP AS created_at';

  const sql = `
    SELECT p.id, p.title, p.content, p.type, p.category,
           ${selectSubject}, ${selectSemester}, ${selectSemesterNo},
           ${selectTargetAll}, ${selectAudience}, ${selectCohort}, ${selectVisibility}, ${selectCreatedAt},
           s.name AS author_name, s.role AS author_role, s.avatarurl AS author_avatar
    FROM posts p
    JOIN students s ON s.studentid = p.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.created_at DESC
    LIMIT ?
  `;

  try {
    let rows = (await db.all(sql, ...params, fetchLimit)) || [];

    // Verify and resolve author roles from trusted students table if missing from joined rows
    const unverifiedUserIds = [...new Set(
      rows
        .filter(r => !r.author_role && !r.role && (r.user_id || r.userId))
        .map(r => r.user_id || r.userId)
    )];
    if (unverifiedUserIds.length > 0 && typeof db.all === 'function') {
      try {
        const uRows = await db.all(
          `SELECT studentId, role, name FROM students WHERE studentId IN (${unverifiedUserIds.map(() => '?').join(',')})`,
          ...unverifiedUserIds
        );
        const roleMap = new Map();
        for (const u of (uRows || [])) {
          const sid = String(u.studentId || u.studentid || '');
          if (sid) {
            roleMap.set(sid, {
              role: u.role || 'student',
              name: u.name
            });
          }
        }
        for (const r of rows) {
          const sid = String(r.user_id || r.userId || '');
          if (roleMap.has(sid)) {
            const u = roleMap.get(sid);
            if (!r.author_role && !r.role) r.author_role = u.role;
            if (!r.author_name && !r.authorName) r.author_name = u.name;
          }
        }
      } catch (_) {}
    }

    // Load target semesters from post_target_semesters for accurate semester attribution
    const postIds = rows.map(r => Number(r.id)).filter(id => Number.isFinite(id) && id > 0);
    const targetSemMap = new Map();
    if (postIds.length > 0) {
      try {
        const ptRows = (await db.all(
          `SELECT post_id, semester FROM post_target_semesters WHERE post_id IN (${postIds.map(() => '?').join(',')}) ORDER BY semester ASC`,
          ...postIds
        )) || [];
        for (const pt of ptRows) {
          const pid = Number(pt.post_id);
          if (!targetSemMap.has(pid)) targetSemMap.set(pid, []);
          const sNum = parseSemesterNumber(pt.semester);
          if (sNum && !targetSemMap.get(pid).includes(sNum)) {
            targetSemMap.get(pid).push(sNum);
          }
        }
      } catch (_) {}
    }

    const userSem = parseSemesterNumber(
      academicContext?.cohort?.currentSemester || academicContext?.currentSemester || academicContext?.semester
    );

    // Relevance & authority scoring across title, subject, category, and content
    rows = rows.map(r => {
      const targetSems = targetSemMap.get(Number(r.id)) || [];
      const rowSemNo = parseSemesterNumber(r.semester_no ?? r.semester) || (targetSems.length === 1 ? targetSems[0] : null);
      const isAllSem = Number(r.target_all_semesters ?? 1) === 1 && !rowSemNo && targetSems.length === 0;

      const derivedTitle = extractPostTitle(r.content, r.title);
      const titleText = `${derivedTitle || ''} ${r.title || ''} ${r.subject || ''}`.toLowerCase();
      const bodyText = `${r.content || ''}`.toLowerCase();
      const authorText = `${r.author_name || r.authorName || ''}`.toLowerCase();
      const fullText = `${titleText} ${r.category || ''} ${bodyText} ${authorText}`.toLowerCase();
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
      const role = String(r.author_role || r.role || '').trim().toLowerCase();
      const tier = getAuthorAuthorityTier(role);
      const authorityBonus = tier === 1 ? 15 : tier === 2 ? 10 : tier === 3 ? 6 : 0;
      const bitWideBonus = (isAllSem || /\ball\s+bit\s+students\b/i.test(fullText)) ? 6 : 0;
      const ownSemesterBonus = (!parsedRequestedSem && !isOtherSemQuery && userSem && (rowSemNo === userSem || targetSems.includes(userSem))) ? 4 : 0;
      const requestedSemBonus = (parsedRequestedSem && (rowSemNo === parsedRequestedSem || targetSems.includes(parsedRequestedSem))) ? 12 : 0;
      const score = (matchedConcepts.length * 20) + (titleConceptHits * 15) + (priorityKeywordHits * 4) + authorityBonus + bitWideBonus + ownSemesterBonus + requestedSemBonus;
      return {
        ...r,
        _targetSemesters: targetSems,
        _semesterNo: rowSemNo,
        _isAllSemesters: isAllSem,
        _matchedConcepts: matchedConcepts,
        _titleConceptHits: titleConceptHits,
        _score: score,
        _authorityTier: tier
      };
    });

    // If query had specific topic concepts, keep rows that matched at least one concept
    // (and if non-generic subject/topic concepts are present beyond broad category words like exam/class/holiday,
    // require at least one specific topic concept match so unrelated notices aren't returned for non-existent topics).
    if (conceptEntries.length > 0) {
      const BROAD_CONCEPTS = new Set([
        'exam', 'class', 'resume', 'reopen', 'reopens', 'reopening', 'start', 'starts', 'starting', 'begin', 'begins',
        'holiday', 'vacation', 'dashain', 'tihar', 'routine', 'deadline',
        'regular', 'bit', 'gandaki', 'university', 'morning', 'day', 'evening', 'schedule', 'timetable',
        'mid', 'term', 'midterm', 'pre', 'board', 'preboard', 'final', 'internal', 'practical', 'viva', 'lab',
        'sakiyo', 'sakyo', 'sakiye', 'sakiyera', 'khulne', 'khulxa', 'khulcha', 'suru', 'shuru',
        'bholi', 'aaja', 'hijo', 'parsi', 'tomorrow', 'today', 'yesterday', 'thiyo', 'haina', 'hoina',
        'bata', 'bataa', 'bataw', 'dekhi', 'samma', 'kaile', 'kahile', 'kile', 'x', 'xa', 'cha', 'chha', 'ho', 'hunxa', 'huncha', 'chai',
        'नियमित', 'कक्षा', 'कक्षाहरू', 'सुरु', 'शुरु', 'दशैं', 'तिहार', 'बिदा', 'छुट्टी', 'खुल्ने', 'खुल्छ'
      ]);
      const specificConcepts = conceptEntries
        .map(([canon]) => canon)
        .filter(c => c.length >= 2 && !BROAD_CONCEPTS.has(c));
      rows = rows.filter(r => {
        if (r._matchedConcepts.length === 0) return false;
        if (specificConcepts.length > 0) {
          return r._matchedConcepts.some(c => specificConcepts.includes(c));
        }
        return true;
      });
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
      // Author role must be resolved strictly from trusted database user records.
      // NEVER infer admin, teacher, or CR authority from post type, category, title, or content.
      // If author identity or role cannot be verified from the database, do not classify as an official notice.
      const authorRole = String(row.author_role || row.role || '').trim().toLowerCase();
      const isOfficialAuthor = ['admin', 'teacher', 'cr'].includes(authorRole);
      const rawTypeLower = String(row.type || '').trim().toLowerCase();
      const rawCatLower = String(row.category || '').trim().toLowerCase();
      const isNoticeOrAnnouncement = ['notice', 'announcement'].includes(rawTypeLower) ||
        ['notice', 'announcement'].includes(rawCatLower);
      const isOfficialNotice = isNoticeOrAnnouncement && isOfficialAuthor;
      const cardType = isOfficialNotice ? 'notice' : (row.type === 'assignment' ? 'post_assignment' : 'post');
      const targetSemesters = row._targetSemesters || [];
      const semesterNo = row._semesterNo || null;
      const targetAllSemesters = Boolean(row._isAllSemesters);
      const semesterLabel = formatResourceSemester({
        ...row,
        targetSemesters,
        semester_no: semesterNo,
        target_all_semesters: targetAllSemesters ? 1 : 0
      }) || 'All Semesters';
      const rawCreatedAt = row.created_at || row.createdAt || null;
      const createdAt = rawCreatedAt ? toIsoTimestampString(rawCreatedAt) : null;
      const publishedDate = createdAt ? createdAt.slice(0, 10) : null;
      const deepLink = `/posts/${row.id}`;

      const derivedTitle = extractPostTitle(row.content, row.title);
      const displayTitle = derivedTitle || row.title || truncateContent(row.content, 80);
      const authorityLabel = isOfficialNotice
        ? (authorRole === 'admin' ? 'Official College Notice' : authorRole === 'teacher' ? 'Teacher Notice' : 'CR Announcement')
        : (authorRole === 'admin' ? 'Admin Post' : authorRole === 'teacher' ? 'Teacher Post' : authorRole === 'cr' ? 'CR Post' : 'Student Community Post');
      const excerpt = truncateContent(row.content, 180);

      return {
        id: row.id,
        title: displayTitle,
        content: truncateContent(row.content, isOfficialNotice ? 500 : 280),
        excerpt,
        type: isOfficialNotice ? 'notice' : row.type,
        resourceType: isOfficialNotice ? 'notice' : 'post',
        rawType: row.type,
        category: row.category,
        subject: row.subject || null,
        semester: semesterLabel,
        semesterNo,
        targetSemesters,
        targetAllSemesters,
        authorName: row.author_name || row.authorName,
        authorRole,
        authority: authorityLabel,
        authorityTier: row._authorityTier || getAuthorAuthorityTier(authorRole),
        isOfficialNotice,
        createdAt,
        publishedDate,
        originalReference: deepLink,
        _matchedConcepts: row._matchedConcepts || [],
        _score: row._score || 0,
        resourceCard: {
          type: cardType,
          id: row.id,
          title: displayTitle,
          semester: semesterLabel,
          authorName: row.author_name || row.authorName,
          authorRole,
          authority: authorityLabel,
          publishedDate,
          createdAt,
          excerpt,
          action: isOfficialNotice ? 'view_notice' : 'view_post',
          deepLink,
          mobileRoute: isOfficialNotice ? `/notice/${row.id}` : `/post/${row.id}`,
          mobileParams: { id: row.id }
        }
      };
    });

    const ranked = resolveNoticeSupersession(mapped);
    return ranked.slice(0, limit).map(item => {
      const clean = { ...item };
      delete clean._matchedConcepts;
      clean._score = item._score;
      clean.relevanceScore = item._score;
      return clean;
    });
  } catch (err) {
    console.error('[AI Search] searchPosts error:', err.message);
    if (db && db._throwOnSearchError) throw err;
    return [];
  }
}

/**
 * Searches all authorized notice & announcement sources across semesters:
 * A. Admin/Teacher/CR-authored posts categorized as NOTICE or ANNOUNCEMENT (`LOWER(p.category) IN ('notice', 'announcement')`)
 * B. Official notices stored with `LOWER(p.type) IN ('notice', 'announcement')`
 * C. Verified official Gandaki University notices (`gu_official`) when `includeOfficialUniversityNotices` is true.
 */
async function searchNotices(db, academicContext, {
  query = '',
  semester = null,
  otherSemesterOnly = false,
  dateInfo = null,
  excludeIds = [],
  limit = 5,
  includeOfficialUniversityNotices = false
} = {}) {
  const campusNotices = await searchPosts(db, academicContext, {
    query,
    type: 'notice',
    semester,
    otherSemesterOnly,
    dateInfo,
    excludeIds,
    limit: Math.max(limit, 8)
  });
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
      const createdAt = row.created_at || row.createdAt || null;
      return {
        id: canonicalId || row.id,
        resourceId: row.id,
        title: row.title || 'Official Gandaki University Notice',
        content: truncateContent(row.content || row.title, 280),
        type: 'gu_official',
        resourceType: 'gu_official',
        category: 'official_university_notice',
        semester: 'All Semesters',
        semesterNo: null,
        targetAllSemesters: true,
        authorName: 'Gandaki University Official Portal',
        authorRole: 'admin',
        createdAt,
        publishedDate: createdAt ? String(createdAt).slice(0, 10) : null,
        webUrl: row.web_url || 'https://www.gandakiuniversity.edu.np',
        originalReference: row.web_url || 'https://www.gandakiuniversity.edu.np',
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
  'aayo', 'aako', 'kati', 'kun', 'k', 'ke', 'xa', 'cha', 'chha', 'ho',
  'semester', 'semesters', 'sem', 'from', 'for', 'all', 'any', 'other', 'another',
  'deadline', 'deadlines', 'due', 'date', 'dates', 'last', 'kaile', 'kahile',
  'tesko', 'tyesko', 'yesko', 'yasko', 'yo', 'tyo', 'this', 'that', 'meaning', 'matlab', 'explain', 'gara', 'bujhaune'
]);

/**
 * Searches assignments visible to the authenticated user.
 * - Default: retrieves assignments for the student's current semester (`current_semester_learning`).
 * - Explicit cross-semester request (`semester` or `searchAllSemesters`): retrieves published assignment information
 *   from the requested semester (`explicit_cross_semester_learning`) without exposing any submission or grading records.
 */
async function searchAssignments(db, academicContext, {
  query = '',
  subject = null,
  semester = null,
  searchAllSemesters = false,
  dateInfo = null,
  excludeIds = [],
  limit = 5
} = {}) {
  const { matchesDateFilter } = require('./nepali-dates');
  const conditions = [];
  const params = [];
  const excludeSet = new Set(
    (Array.isArray(excludeIds) ? excludeIds : [])
      .map(id => Number(String(id).replace(/^assignment:/i, '')))
      .filter(n => Number.isFinite(n) && n > 0)
  );

  // Semester & cohort authorization with explicit cross-semester support
  const authFilter = buildAssignmentSemesterFilter(academicContext, {
    tableAlias: 'a',
    requestedSemester: semester,
    searchAllSemesters
  });
  conditions.push(`(${authFilter.sql})`);
  params.push(...authFilter.params);

  if (excludeSet.size > 0) {
    const exList = [...excludeSet];
    conditions.push(`a.id NOT IN (${exList.map(() => '?').join(',')})`);
    params.push(...exList);
  }

  // Optional explicit subject filter
  if (subject) {
    const { subjectAliases } = require('./chat-tools');
    const rawList = Array.isArray(subject) ? subject : [subject];
    const expandedSubjects = [...new Set(
      rawList.flatMap(s => [
        String(s || '').trim().toLowerCase(),
        ...subjectAliases(s).map(a => a.toLowerCase().trim())
      ]).filter(Boolean)
    )];
    if (expandedSubjects.length > 0) {
      conditions.push(`LOWER(TRIM(COALESCE(a.subject, ''))) IN (${expandedSubjects.map(() => '?').join(',')})`);
      params.push(...expandedSubjects);
    }
  }

  const baseConditions = [...conditions];
  const baseParams = [...params];

  // Text search (strip generic status/grade/question/date/semester inquiry words so lookups still match assignments)
  const DATE_WORDS = new Set([
    'aaja', 'today', 'bholi', 'voli', 'tomorrow', 'hijo', 'yesterday', 'parsi', 'asti',
    'hapta', 'week', 'dekhi', 'samma', 'from', 'between', 'until', 'due', 'deadline', 'deadlines',
    'baisakh', 'jestha', 'asar', 'shrawan', 'bhadra', 'asoj', 'kartik', 'mangsir', 'poush', 'magh', 'falgun', 'chaitra',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'
  ]);
  const { subjectAliases } = require('./chat-tools');
  const subjectTokenSet = new Set(
    subject
      ? (Array.isArray(subject) ? subject : [subject])
          .flatMap(s => [
            ...String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
            ...subjectAliases(s).map(a => a.toLowerCase().trim()).filter(Boolean)
          ])
      : []
  );
  const rawTokens = extractSearchTokens(query);
  const tokens = rawTokens.filter(t => {
    if (ASSIGNMENT_STATUS_STOP_WORDS.has(t)) return false;
    if (SEMESTER_TOKEN_WORDS.has(t)) return false;
    if (subjectTokenSet.has(t)) return false;
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

    // 2. Caller-scoped student submission & released grade enrichment (NEVER uses user/model-supplied ID).
    //    For cross-semester assignment requests, NEVER expose any submissions, grading records, or feedback.
    const isStudentOrCr = academicContext?.authenticated && ['student', 'cr'].includes(academicContext?.role);
    const callerStudentId = isStudentOrCr ? String(academicContext.studentId || '').trim() : null;
    const callerSemesterNo = isStudentOrCr
      ? (academicContext.cohort?.currentSemester || academicContext.currentSemester || parseSemesterNumber(academicContext.semester) || null)
      : null;
    const studentSubsByAssignment = new Map();

    // Only query submissions for assignments belonging to the student's own current semester
    const ownSemAssignmentIds = rows
      .filter(r => {
        const aSem = parseSemesterNumber(r.semester_no ?? r.semester);
        return !callerSemesterNo || !aSem || aSem === callerSemesterNo;
      })
      .map(r => r.id)
      .filter(id => id !== undefined && id !== null);

    if (callerStudentId && ownSemAssignmentIds.length > 0) {
      const ownPh = ownSemAssignmentIds.map(() => '?').join(',');
      let subRows = [];
      try {
        subRows = (await db.all(
          `SELECT sub.id, sub.assignmentId, sub.questionId, sub.questionTitle, sub.submittedAt,
                  aq.questionNumber, aq.title AS aqTitle, COALESCE(aq.maxPoints, 10) AS maxPoints,
                  sg.marksObtained, sg.remarks, sg.checked, sg.released
           FROM submissions sub
           LEFT JOIN assignment_questions aq ON aq.id = sub.questionId
           LEFT JOIN submission_grades sg ON sg.questionId = sub.questionId AND sg.studentId = sub.studentId
           WHERE sub.studentId = ? AND sub.assignmentId IN (${ownPh})
           ORDER BY sub.submittedAt DESC, sub.id DESC`,
          callerStudentId,
          ...ownSemAssignmentIds
        )) || [];
      } catch (_) {
        try {
          subRows = (await db.all(
            `SELECT id, assignmentId, questionId, questionTitle, submittedAt
             FROM submissions
             WHERE studentId = ? AND assignmentId IN (${ownPh})
             ORDER BY submittedAt DESC, id DESC`,
            callerStudentId,
            ...ownSemAssignmentIds
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
        const rawChecked = s.checked;
        const isChecked = Boolean(
          rawChecked === true || rawChecked === 1 || rawChecked === '1' || rawChecked === 't' || isReleased || (s.marksObtained !== null && s.marksObtained !== undefined)
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
          checked: isChecked,
          marksObtained,
          maxPoints,
          remarks
        });
      }
    }

    return rows.map(row => {
      const aId = Number(row.id);
      const rowSemNo = parseSemesterNumber(row.semester_no ?? row.semester);
      const isCrossSemester = Boolean(callerSemesterNo && rowSemNo && rowSemNo !== callerSemesterNo);
      const questions = questionsByAssignment.get(aId) || [];
      let studentSubmission = null;

      if (callerStudentId && !isCrossSemester) {
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

        const hasCheckedSubmissions = subs.some(s => s.checked);
        const allQuestionsChecked = questions.length > 0 && subs.length >= questions.length && subs.every(s => s.checked);
        const isChecked = hasCheckedSubmissions;
        const checkedStatus = hasReleasedGrades
          ? 'graded_and_released'
          : (isChecked ? 'checked_pending_release' : (submitted ? 'submitted_pending_review' : 'not_submitted'));

        studentSubmission = {
          submitted,
          submissionStatus,
          submittedQuestionsCount,
          totalQuestionsCount,
          submittedAt: latestSubmittedAt,
          checked: isChecked,
          checkedStatus,
          allQuestionsChecked,
          hasReleasedGrades,
          releasedGradesCount: releasedGrades.length,
          unreleasedSubmissionsCount: Math.max(0, subs.length - releasedGrades.length),
          totalMarksObtained,
          totalMaxPoints,
          releasedGrades,
          submissions: subs
        };
      }

      const semesterLabel = rowSemNo ? `Semester ${rowSemNo}` : (row.semester || 'All Semesters');
      const deepLink = `/code-lab/assignment.html?id=${row.id}`;
      const now = Date.now();
      const deadlineIso = row.deadline ? toIsoTimestampString(row.deadline) : null;
      const createdAtIso = (row.createdAt || row.created_at) ? toIsoTimestampString(row.createdAt || row.created_at) : null;
      const deadlineTime = deadlineIso ? new Date(deadlineIso).getTime() : null;
      const isOverdue = Boolean(deadlineTime && deadlineTime < now);
      const isMissed = Boolean(isOverdue && (!studentSubmission || !studentSubmission.submitted));
      const isUpcoming = Boolean(deadlineTime && deadlineTime >= now && (!studentSubmission || !studentSubmission.submitted));

      return {
        id: row.id,
        title: row.title,
        description: truncateContent(row.description || row.instructions || '', 300),
        fullDescription: row.description || row.instructions || '',
        language: row.language,
        subject: row.subject,
        semester: semesterLabel,
        semesterNo: rowSemNo || null,
        deadline: deadlineIso,
        pdfUrl: row.pdfUrl || row.pdfurl || null,
        pdfName: row.pdfName || row.pdfname || null,
        teacherName: row.teacher_name || row.teacherName || 'Instructor',
        authorName: row.teacher_name || row.teacherName || 'Instructor',
        authorRole: 'teacher',
        resourceType: 'assignment',
        createdAt: createdAtIso,
        originalReference: deepLink,
        questionCount: questions.length,
        questions,
        studentSubmission,
        isOverdue,
        isMissed,
        isUpcoming,
        resourceCard: {
          type: 'assignment',
          id: row.id,
          title: row.title,
          subject: row.subject,
          semester: semesterLabel,
          authorName: row.teacher_name || row.teacherName || 'Instructor',
          authorRole: 'teacher',
          authority: 'Teacher Assignment',
          publishedDate: createdAtIso ? createdAtIso.slice(0, 10) : null,
          excerpt: truncateContent(row.description || row.instructions || row.title || '', 160),
          deadline: deadlineIso,
          action: 'view_assignment',
          deepLink,
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
 * Defaults to the student's current semester, or allows explicit cross-semester / all-semester retrieval.
 */
async function searchAuthorizedNotes(db, academicContext, {
  query = '',
  subject,
  semester = null,
  searchAllSemesters = false,
  limit = 3,
  searchNotes = require('./note-search').searchNotes
} = {}) {
  const defaultSemesterNo = academicContext?.cohort?.currentSemester
    || academicContext?.currentSemester
    || parseSemesterNumber(academicContext?.semester)
    || null;

  const requestedSemNo = parseSemesterNumber(semester);
  const effectiveSemester = searchAllSemesters
    ? undefined
    : (requestedSemNo || ((academicContext?.authenticated && defaultSemesterNo) ? defaultSemesterNo : undefined));

  try {
    const files = await searchNotes(db, {
      query,
      semester: effectiveSemester,
      searchAllSemesters,
      subject,
      academicContext
    });
    return files.slice(0, limit).map(f => {
      const fSemNo = parseSemesterNumber(f.semester_no ?? f.semester);
      const semLabel = fSemNo ? `Semester ${fSemNo}` : (f.semester || null);
      return {
        ...f,
        semester: semLabel || f.semester,
        semesterNo: fSemNo || null,
        resourceType: 'note',
        originalReference: `/material/${f.id}`,
        resourceCard: {
          type: 'note',
          id: f.id,
          title: f.title || f.originalName,
          subject: f.subject,
          semester: semLabel || f.semester,
          action: 'open_note',
          deepLink: `/material/${f.id}`,
          viewUrl: `/api/files/${f.id}/view`,
          downloadUrl: `/api/files/${f.id}/download`,
          mobileRoute: `/material/${f.id}`,
          mobileParams: { id: f.id }
        }
      };
    });
  } catch (err) {
    console.error('[AI Search] searchAuthorizedNotes error:', err.message);
    return [];
  }
}

// ── Helpers ──

/**
 * Builds an assignment semester authorization filter.
 * - Default (`current_semester_learning`): restricts students to their current semester and cohort.
 * - Explicit cross-semester (`requestedSemester` or `searchAllSemesters`): allows retrieving published
 *   assignment metadata from the requested semester while respecting visibility rules.
 */
function buildAssignmentSemesterFilter(academicContext, {
  tableAlias = 'a',
  requestedSemester = null,
  searchAllSemesters = false
} = {}) {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  if (!academicContext || !academicContext.authenticated) {
    return { sql: `${prefix}audience_scope = 'all_students'`, params: [] };
  }

  const hasTeacherScope = academicContext.role === 'teacher' && (
    Array.isArray(academicContext.assignedSemesters) || Array.isArray(academicContext.assignedSubjects)
  );

  if (academicContext.role === 'admin' || (academicContext.canViewAllCohorts && !hasTeacherScope)) {
    const reqSem = parseSemesterNumber(requestedSemester);
    if (reqSem && !searchAllSemesters) {
      const aliases = semesterAliases(reqSem);
      return {
        sql: `(${prefix}semester_no = ? OR LOWER(TRIM(COALESCE(${prefix}semester, ''))) IN (${aliases.map(() => '?').join(',')}))`,
        params: [reqSem, ...aliases]
      };
    }
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
  const ownSemesterNo = academicContext.cohort?.currentSemester
    || academicContext.currentSemester
    || parseSemesterNumber(academicContext.semester)
    || null;
  const reqSemNo = parseSemesterNumber(requestedSemester);
  const nonPrivateScopeClause = `LOWER(TRIM(COALESCE(${prefix}audience_scope, 'all_students'))) NOT IN ('cohort_only', 'cohort-only', 'private')`;

  if (searchAllSemesters) {
    if (cohortId && ownSemesterNo) {
      const ownAliases = semesterAliases(ownSemesterNo);
      return {
        sql: `(CASE WHEN (${prefix}semester_no = ? OR LOWER(TRIM(COALESCE(${prefix}semester, ''))) IN (${ownAliases.map(() => '?').join(',')})) THEN (${prefix}cohort_id = ? OR ${prefix}audience_scope = 'all_students' OR ${prefix}cohort_id IS NULL) ELSE ${nonPrivateScopeClause} END)`,
        params: [ownSemesterNo, ...ownAliases, cohortId]
      };
    }
    return { sql: nonPrivateScopeClause, params: [] };
  }

  const targetSemNo = reqSemNo || ownSemesterNo;
  if (!targetSemNo) {
    return { sql: `${prefix}audience_scope = 'all_students'`, params: [] };
  }

  const aliases = semesterAliases(targetSemNo);
  const semClause = `(${prefix}semester_no = ? OR LOWER(TRIM(COALESCE(${prefix}semester, ''))) IN (${aliases.map(() => '?').join(',')}))`;

  // Explicit cross-semester assignment lookup: allow published assignments in targetSemNo unless marked cohort_only/private
  if (reqSemNo && ownSemesterNo && reqSemNo !== ownSemesterNo) {
    return {
      sql: `(${nonPrivateScopeClause} AND ${semClause})`,
      params: [targetSemNo, ...aliases]
    };
  }

  if (cohortId) {
    return {
      sql: `((${prefix}cohort_id = ? OR ${prefix}audience_scope = 'all_students' OR ${prefix}cohort_id IS NULL) AND ${semClause})`,
      params: [cohortId, targetSemNo, ...aliases]
    };
  }

  return {
    sql: `(${prefix}audience_scope = 'all_students' AND ${semClause})`,
    params: [targetSemNo, ...aliases]
  };
}

/**
 * Builds a post & notice visibility and optional semester filter.
 * General academic information (posts, notices, announcements) is discoverable across all semesters
 * for authenticated students/CRs when visible under post visibility rules.
 */
function buildPostSemesterFilter(academicContext, {
  tableAlias = 'p',
  requestedSemester = null,
  otherSemesterOnly = false,
  enforceStudentSemester = false,
  postColumns = null
} = {}) {
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
      ? `(COALESCE(${prefix}visibility, 'everyone') IN ('everyone', 'public', 'teachers_only', 'teachers-only') AND (${prefix}user_id = ? OR LOWER(TRIM(COALESCE(${prefix}type, ''))) IN ('notice', 'announcement') OR LOWER(TRIM(COALESCE(${prefix}category, ''))) IN ('notice', 'announcement') OR NOT EXISTS (SELECT 1 FROM students s_auth WHERE s_auth.studentId = ${prefix}user_id AND s_auth.role = 'teacher')))`
      : '1=1';
    const params = academicContext.role === 'teacher' ? [academicContext.studentId || '__none__'] : [];
    return { sql: visClause, params };
  }

  if (academicContext.role === 'teacher') {
    const authorParam = academicContext.studentId || '__none__';
    const visClause = `COALESCE(${prefix}visibility, 'everyone') IN ('everyone', 'public', 'teachers_only', 'teachers-only')`;
    const peerClause = `(LOWER(TRIM(COALESCE(${prefix}type, ''))) IN ('notice', 'announcement') OR LOWER(TRIM(COALESCE(${prefix}category, ''))) IN ('notice', 'announcement') OR NOT EXISTS (SELECT 1 FROM students s_auth WHERE s_auth.studentId = ${prefix}user_id AND s_auth.role = 'teacher'))`;
    const sems = Array.isArray(academicContext.assignedSemesters) ? academicContext.assignedSemesters : [];
    const semClause = sems.length > 0
      ? `(${prefix}target_all_semesters = 1 OR ${prefix}semester_no IN (${sems.map(() => '?').join(',')}) OR ${prefix}id IN (SELECT post_id FROM post_target_semesters WHERE semester IN (${sems.map(() => '?').join(',')})))`
      : `(${prefix}target_all_semesters = 1)`;
    return {
      sql: `(${prefix}user_id = ? OR (${visClause} AND ${peerClause} AND ${semClause}))`,
      params: [authorParam, ...sems, ...sems]
    };
  }

  // Student & CR:
  const cohortId = academicContext.cohort?.id || academicContext.cohortId || null;
  const semesterNo = academicContext.cohort?.currentSemester
    || academicContext.currentSemester
    || parseSemesterNumber(academicContext.semester)
    || null;
  const reqSemNo = parseSemesterNumber(requestedSemester);

  const studentVisClause = `(COALESCE(${prefix}visibility, 'everyone') IN ('everyone', 'public', 'students_only', 'students-only', 'students', 'cohort_only', 'cohort-only') OR ${prefix}user_id = ?)`;
  const studentVisParam = academicContext.studentId || '__none__';

  // Cohort restriction applies ONLY if a post is explicitly marked cohort_only or private audience_scope
  const cohortGuardClause = cohortId
    ? `(COALESCE(${prefix}visibility, 'everyone') NOT IN ('cohort_only', 'cohort-only') AND LOWER(TRIM(COALESCE(${prefix}audience_scope, 'all_students'))) NOT IN ('cohort_only', 'cohort-only', 'private') OR ${prefix}cohort_id = ? OR ${prefix}user_id = ?)`
    : `(COALESCE(${prefix}visibility, 'everyone') NOT IN ('cohort_only', 'cohort-only') AND LOWER(TRIM(COALESCE(${prefix}audience_scope, 'all_students'))) NOT IN ('cohort_only', 'cohort-only', 'private') OR ${prefix}user_id = ?)`;
  const cohortParams = cohortId ? [cohortId, studentVisParam] : [studentVisParam];

  if (otherSemesterOnly && semesterNo) {
    const otherSemSql = `((${prefix}semester_no IS NOT NULL AND ${prefix}semester_no != ?) OR ${prefix}id IN (SELECT post_id FROM post_target_semesters WHERE semester != ?))`;
    return {
      sql: `${studentVisClause} AND ${cohortGuardClause} AND ${otherSemSql}`,
      params: [studentVisParam, ...cohortParams, semesterNo, semesterNo]
    };
  }

  if (reqSemNo) {
    const reqAliases = semesterAliases(reqSemNo);
    const hasSemTextCol = postColumns ? postColumns.has('semester') : true;
    const reqSemSql = hasSemTextCol
      ? `(${prefix}target_all_semesters = 1 OR ${prefix}semester_no = ? OR LOWER(TRIM(COALESCE(${prefix}semester, ''))) IN (${reqAliases.map(() => '?').join(',')}) OR ${prefix}id IN (SELECT post_id FROM post_target_semesters WHERE semester = ?))`
      : `(${prefix}target_all_semesters = 1 OR ${prefix}semester_no = ? OR ${prefix}id IN (SELECT post_id FROM post_target_semesters WHERE semester = ?))`;
    return {
      sql: `${studentVisClause} AND ${cohortGuardClause} AND ${reqSemSql}`,
      params: hasSemTextCol
        ? [studentVisParam, ...cohortParams, reqSemNo, ...reqAliases, reqSemNo]
        : [studentVisParam, ...cohortParams, reqSemNo, reqSemNo]
    };
  }

  if (enforceStudentSemester && semesterNo) {
    const ownSemSql = `(${prefix}target_all_semesters = 1 OR ${prefix}semester_no = ? OR ${prefix}id IN (SELECT post_id FROM post_target_semesters WHERE semester = ?))`;
    return {
      sql: `${studentVisClause} AND ${cohortGuardClause} AND ${ownSemSql}`,
      params: [studentVisParam, ...cohortParams, semesterNo, semesterNo]
    };
  }

  return {
    sql: `${studentVisClause} AND ${cohortGuardClause}`,
    params: [studentVisParam, ...cohortParams]
  };
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

// ── Gandaki University Public Knowledge, Web Research, AI Identity & Social Guard ──

const GU_BASE_URL = 'https://www.gandakiuniversity.edu.np';

const VERIFIED_GU_INSTITUTIONAL_KNOWLEDGE = {
  name: 'Gandaki University',
  nepaliName: 'गण्डकी विश्वविद्यालय',
  establishedAd: 2019,
  establishedBs: 2076,
  establishingAct: 'Gandaki University Act, 2076 (2019 AD)',
  founder: 'Provincial Government of Gandaki Province, Nepal (first provincial university of Nepal)',
  location: {
    mainCampus: 'Khudi (Gyankunja), Pokhara-32, Kaski, Gandaki Province, Nepal',
    adminOffice: 'Mustachowk, Pokhara, Kaski, Gandaki Province, Nepal',
    city: 'Pokhara, Gandaki Province, Nepal'
  },
  officialWebsite: GU_BASE_URL,
  officialContactUrl: `${GU_BASE_URL}/contact-us/`,
  officialNoticesUrl: `${GU_BASE_URL}/category/notice/`,
  officialProgramsUrl: `${GU_BASE_URL}/academics/`,
  officialAdmissionUrl: `${GU_BASE_URL}/admission/`,
  officialAboutUrl: `${GU_BASE_URL}/about-us/`,
  officialEmail: 'info@gandakiuniversity.edu.np',
  schools: [
    {
      name: 'School of Science and Technology (SoST)',
      url: `${GU_BASE_URL}/school-of-science-and-technology/`,
      programmes: [
        'Bachelor of Information Technology (BIT) — 4 years (8 semesters, 126 credits)',
        'Bachelor of Pharmacy (B.Pharm) — 4 years (8 semesters)',
        'Bachelor of Technology in Artificial Intelligence (B.Tech AI)'
      ]
    },
    {
      name: 'School of Management, Law, and Social Sciences (SoMLSS)',
      url: `${GU_BASE_URL}/school-of-management/`,
      programmes: [
        'Bachelor of Business Administration (BBA) — 4 years (8 semesters)',
        'Bachelor in Sports Management (BSM) — 4 years (8 semesters, first in Nepal)',
        'Bachelor of Arts Bachelor of Laws (B.A. LL.B.) — 5 years (10 semesters)'
      ]
    },
    {
      name: 'Research and Innovation Center (RIC)',
      url: `${GU_BASE_URL}/research-and-innovation/`,
      programmes: [
        'Provincial research grants, innovation lab, and applied scientific research projects'
      ]
    }
  ],
  programmes: [
    {
      code: 'BIT',
      title: 'Bachelor of Information Technology (BIT)',
      school: 'School of Science and Technology (SoST)',
      duration: '4 years (8 semesters, 126 credit hours)',
      url: `${GU_BASE_URL}/bit/`,
      eligibility: 'Completed 10+2 (Higher Secondary) or equivalent from a recognized board with a minimum CGPA of 2.0 (or C grade / second division) including 100-marks Mathematics, plus passing the Gandaki University Entrance Examination.'
    },
    {
      code: 'B.Pharm',
      title: 'Bachelor of Pharmacy (B.Pharm)',
      school: 'School of Science and Technology (SoST)',
      duration: '4 years (8 semesters)',
      url: `${GU_BASE_URL}/b-pharma/`,
      eligibility: 'Completed 10+2 in Science (Physics, Chemistry, Biology) or Diploma in Pharmacy with at least 50% aggregate or CGPA 2.4, plus passing the Gandaki University Entrance Examination.'
    },
    {
      code: 'BBA',
      title: 'Bachelor of Business Administration (BBA)',
      school: 'School of Management, Law, and Social Sciences (SoMLSS)',
      duration: '4 years (8 semesters)',
      url: `${GU_BASE_URL}/bba/`,
      eligibility: 'Completed 10+2 or equivalent in any discipline with minimum CGPA 2.0 (or C grade / second division) and passing the Gandaki University Entrance Examination.'
    },
    {
      code: 'BSM',
      title: 'Bachelor in Sports Management (BSM)',
      school: 'School of Management, Law, and Social Sciences (SoMLSS)',
      duration: '4 years (8 semesters)',
      url: `${GU_BASE_URL}/bsm/`,
      eligibility: 'Completed 10+2 or equivalent in any stream with minimum CGPA 1.8 / second division and passing the Gandaki University Entrance Examination.'
    },
    {
      code: 'B.A. LL.B.',
      title: 'Bachelor of Arts Bachelor of Laws (B.A. LL.B.)',
      school: 'School of Management, Law, and Social Sciences (SoMLSS)',
      duration: '5 years (10 semesters)',
      url: `${GU_BASE_URL}/ba-llb/`,
      eligibility: 'Completed 10+2 or equivalent in any discipline with minimum CGPA 2.0 / second division and passing the Gandaki University Law Entrance Examination.'
    }
  ],
  governance: 'Governed by an autonomous Board of Trustees (BoT) under the Gandaki University Act, 2076, with the Chancellor, Vice-Chancellor (VC), Registrar, and Deans leading academic and administrative operations.'
};

const GOV_EDU_TRUSTED_DOMAINS = [
  'gandaki.gov.np',
  'moest.gov.np',
  'ugcnepal.edu.np',
  'mosd.gandaki.gov.np'
];

const SECONDARY_REPUTABLE_DOMAINS = [
  'edusanjal.com',
  'collegenp.com',
  'kathmandupost.com',
  'myrepublica.nagariknetwork.com',
  'risingnepaldaily.com',
  'en.wikipedia.org',
  'wikipedia.org'
];

const UNRELATED_UNIVERSITY_PATTERNS = /\b(tribhuvan\s+university|tu\s+iost|pokhara\s+university|kathmandu\s+university|purbanchal\s+university|mid[- ]?west(?:ern)?\s+university|far[- ]?west(?:ern)?\s+university|lumbini\s+buddhist\s+university|agriculture\s+and\s+forestry\s+university|harvard\s+university|stanford\s+university|mit\s+opencourseware|oxford\s+university|cambridge\s+university|delhi\s+university)\b/i;

const publicWebCache = new Map();
const PUBLIC_WEB_CACHE_TTL_MS = 15 * 60 * 1000;

function invalidateGuWebCache() {
  publicWebCache.clear();
}

/**
 * Detects whether the user is asking about Kyana's underlying AI model or backend architecture.
 */
function isAiIdentityQuery(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  return (
    /\b(which\s+(?:ai|llm|language\s+model|model)\s+(?:powers?|is\s+used|do\s+you\s+use|are\s+you\s+using|runs?|is\s+behind)|what\s+(?:ai|llm|model)\s+(?:powers?\s+kyana|are\s+you|is\s+kyana|is\s+used\s+in\s+backend)|kun\s+(?:ai|llm|model)\s+(?:use\s+(?:vaxa|bhaxa|vako|bhako|gareko|garxau|garchau|hunxa)|chaliraxa|power)|backend\s+ma\s+kun\s+(?:ai|llm|model)|timi\s+kun\s+(?:ai|model)\s+hau|are\s+you\s+(?:gpt|chatgpt|gemini|claude|llama|deepseek)|kyana\s+ko\s+backend\s+ma\s+kun\s+ai)\b/i.test(text) ||
    /(?:कुन\s*(?:एआई|AI|मोडेल)\s*प्रयोग|तिमी\s*कुन\s*(?:एआई|मोडेल)\s*हौ)/i.test(text)
  );
}

/**
 * Resolves the active AI provider and model configuration for transparent disclosure.
 */
function getConfiguredAiIdentity(config = {}) {
  const c = config || {};
  const configuredProviders = [
    {
      provider: 'Google Gemini',
      fastModel: c.GEMINI_MODEL || 'gemini-3-flash-preview',
      complexModel: c.GEMINI_COMPLEX_MODEL || 'gemini-3.1-pro-preview'
    },
    {
      provider: 'Groq',
      fastModel: c.GROQ_MODEL || 'llama-3.3-70b-versatile',
      complexModel: c.GROQ_COMPLEX_MODEL || 'llama-3.3-70b-versatile'
    },
    {
      provider: 'OpenRouter',
      fastModel: c.OPENROUTER_MODEL || 'google/gemini-3.1-flash-lite',
      complexModel: c.OPENROUTER_COMPLEX_MODEL || 'deepseek/deepseek-v3.2'
    },
    {
      provider: 'OpenAI',
      fastModel: c.OPENAI_MODEL || 'gpt-4o-mini',
      complexModel: c.OPENAI_COMPLEX_MODEL || 'gpt-4o-mini'
    },
    {
      provider: 'DeepSeek',
      fastModel: c.DEEPSEEK_MODEL || 'deepseek-chat',
      complexModel: c.DEEPSEEK_COMPLEX_MODEL || 'deepseek-chat'
    }
  ];

  const primary = configuredProviders[0];
  return {
    assistantName: 'Kyana AI',
    platform: 'Semester Library (Gandaki University)',
    primaryProvider: primary.provider,
    primaryFastModel: primary.fastModel,
    primaryComplexModel: primary.complexModel,
    configuredProviders
  };
}

function resolveAiIdentityReply(message, { config = {}, chatMode = 'roast' } = {}) {
  const { detectLanguage } = require('./chat-personality');
  const lang = detectLanguage(message);
  const info = getConfiguredAiIdentity(config);
  const fallbackSummary = info.configuredProviders.map(p => `${p.provider} (\`${p.fastModel}\`)`).join(' → ');

  if (lang === 'devanagari') {
    return `म **Kyana AI** हुँ — **Semester Library (Gandaki University)** को university-aware शैक्षिक सहायक। मेरो backend मा multi-provider AI router (${fallbackSummary}, जटिल प्रश्नका लागि \`${info.primaryComplexModel}\`) र Semester Library को आफ्नै deterministic academic, BS/AD calendar, र database verification इन्जिन प्रयोग भएको छ। म आफैं छुट्टै तालिमप्राप्त foundation model होइन, तर गण्डकी विश्वविद्यालयको आधिकारिक डाटा र पाठ्यक्रमसँग जोडिएको सहायक हुँ।`;
  }

  if (lang === 'roman_nepali' || lang === 'romanized_nepali' || lang === 'mixed' || /\b(kun|vaxa|bhaxa|use|gareko|timi|hau|bro|yrr)\b/i.test(String(message || ''))) {
    return `Ma **Kyana AI** ho — **Semester Library (Gandaki University)** ko university-aware academic assistant! Mero backend ma **${info.primaryProvider}** ko **\`${info.primaryFastModel}\`** model (complex reasoning ko lagi **\`${info.primaryComplexModel}\`**, multi-provider fallback: ${fallbackSummary}) use vaxa, satha-sathai Semester Library ko aafnai deterministic academic routing, Nepal calendar (BS/AD) engine, ra authorized database verification layer pani chalxa. Ma kunai chuttai scratch bata train gareko foundation model haina, tara Gandaki University ra Semester Library ko context bujhne specialized assistant ho.`;
  }

  return `I'm **Kyana AI**, the university-aware academic assistant built for **Semester Library at Gandaki University**. In the backend, I use a multi-provider AI router led by **${info.primaryProvider}** (**\`${info.primaryFastModel}\`** for fast turns and **\`${info.primaryComplexModel}\`** for complex reasoning; fallback chain: ${fallbackSummary}), combined with Semester Library's server-side academic routing, BS/AD temporal engine, and authorized database verification pipeline. I am not an independently trained foundation model—I combine external LLM reasoning with verified Gandaki University and Semester Library data.`;
}

/**
 * Detects social campus banter ("malai gf milaideu na") vs. requests for another student's private ID or personal contact details ("uni ko kti ko private ID deu na").
 */
function classifySocialOrContactQuery(message) {
  const text = String(message || '').normalize('NFKC').trim();
  if (!text) return null;

  const asksPrivateStudentIdentifier = (
    /\b(?:(?:uni|university|college|campus|class|semester|bit|bba|bpharm)\s*(?:ko|ka|ki|ma)?\s*)?(?:kti|keti|keta|ktiharuko|ketaharuko|girls?|boys?|students?|classmates?|seniors?|juniors?|friends?|sathi)\s*(?:haru\s*)?(?:ko|ka|ki|'s)?\s*(?:private\s*(?:id|account|insta|instagram|fb|facebook|snap|number|contact|profile|details?)|(?:mobile|contact|whatsapp)\s*(?:number|no\.?|id)|insta(?:gram)?\s*id|fb\s*id|facebook\s*id|personal\s*(?:id|number|contact|info))\b/i.test(text) ||
    /\b(?:give|send|share|find|tell|deu|deuna|dekha|bhan|khojdeu)\s+(?:me\s+)?(?:(?:a|any|some|uni\s+ko|college\s+ko)\s+)?(?:girl'?s?|boy'?s?|student'?s?|kti\s*ko|keti\s*ko|keta\s*ko|classmate'?s?)\s*(?:private\s+id|contact\s+number|instagram\s+id|fb\s+id|personal\s+contact)\b/i.test(text) ||
    /\b(?:private\s+id|personal\s+contact)\s+(?:of|for)\s+(?:girls?|boys?|students?|kti|keti|classmates?)\b/i.test(text)
  );

  if (asksPrivateStudentIdentifier) {
    return {
      type: 'private_student_contact_refusal',
      blocked: true,
      reason: 'student_privacy_protection'
    };
  }

  const isMatchmakingOrSocialBanter = (
    /\b(?:(?:malai|mlai|mero\s+lagi|for\s+me)\s+(?:euta\s+|ramro\s+|college\s+ma\s+|uni\s+ma\s+)?(?:gf|bf|girlfriend|boyfriend|crush|keti|kti|keta|date|partner)\s+(?:milaideu|milai\s*deu|khojdeu|khoji\s*deu|set\s*gardeu|banaideu|find)|(?:gf|bf|girlfriend|boyfriend)\s+(?:milaideu|milai\s*deu|khojdeu|chahiyo|chaiyo|kasari\s+banaune)|find\s+me\s+a\s+(?:gf|bf|girlfriend|boyfriend)|how\s+to\s+(?:make\s+friends|meet\s+people)\s+(?:in|at)\s+(?:gandaki\s+university|college|campus))\b/i.test(text) ||
    /(?:मलाई\s*(?:गर्लफ्रेन्ड|ब्वायफ्रेन्ड|केटी|केटा)\s*मिलाइदेऊ|कलेजमा\s*साथी\s*कसरी\s*बनाउने)/i.test(text)
  );

  if (isMatchmakingOrSocialBanter) {
    return {
      type: 'social_campus_banter',
      blocked: false,
      reason: 'friendly_social_redirect'
    };
  }

  return null;
}

function buildSocialOrContactReply(message, classification, { chatMode = 'roast' } = {}) {
  const { detectLanguage } = require('./chat-personality');
  const lang = detectLanguage(message);
  const isNepali = lang === 'roman_nepali' || lang === 'romanized_nepali' || lang === 'mixed' || /\b(malai|mlai|deu|na|ko|kti|keti|gf|bf|yrr|bro)\b/i.test(String(message || ''));
  const contactUrl = VERIFIED_GU_INSTITUTIONAL_KNOWLEDGE.officialContactUrl;

  if (classification?.type === 'private_student_contact_refusal') {
    if (lang === 'devanagari') {
      return `कुनै पनि विद्यार्थीको व्यक्तिगत आईडी (private ID) वा निजी सम्पर्क विवरण दिन मिल्दैन — विद्यार्थीको गोपनीयता (privacy) हाम्रो पहिलो प्राथमिकता हो। यदि तिमीलाई कलेजका साथीहरूसँग जोडिनु छ भने **Semester Library को Community Feed (\`/posts\`)** मा सार्वजनिक छलफलमा सहभागी हुन सक्छौ, वा आधिकारिक जानकारीका लागि गण्डकी विश्वविद्यालयको सम्पर्क पेज ([Gandaki University Contact](${contactUrl})) प्रयोग गर्न सक्छौ।`;
    }
    if (isNepali) {
      return `Kasaiko pani private ID, personal social account, wa private contact details dina mildaina bro — student privacy strictly protected hunxa. Sathi haru sanga connect huna man xa vane **Semester Library ko public Community Feed (\`/posts\`)** ma discussion join gara, wa official college inquiry ko lagi **Gandaki University ko official contact channel** ([Gandaki University Contact](${contactUrl})) use gara hai!`;
    }
    return `I can't share any student's private ID, personal social media account, or private contact information—student privacy is strictly protected. To connect with fellow students publicly, check out the **Semester Library Community Feed (\`/posts\`)** or campus clubs, or reach out to official university administration via the [Gandaki University Contact Page](${contactUrl}).`;
  }

  if (lang === 'devanagari') {
    return `हाहा, म त AI सहायक पो हुँ त यार, म्याचमेकर होइन! तर साथी बनाउन र नेटवर्क बढाउन गण्डकी विश्वविद्यालयका **ह्याकाथन (hackathons), स्पोर्ट्स सप्ताह, स्टुडेन्ट क्लबहरू**, र **Semester Library को Community Feed (\`/posts\`)** मा सक्रिय होऊ — कोडिङ र प्रोजेक्ट गर्दागर्दै मिल्ने साथी भेटिहाल्छ नि!`;
  }
  if (isNepali) {
    return chatMode === 'formal'
      ? `Ma academic AI assistant vako le matchmaking ta garna sakdina, tara Gandaki University ma naya sathi haru bhetna college ko **student clubs, hackathons, sports events, project exhibitions**, ra **Semester Library ko Community Feed (\`/posts\`)** ma active huna suggest garchu!`
      : `Haha bro, ma ta Kyana AI po ho ta, matchmaker haina ni! Tara college ma sathi banauna ra chinincha vane Gandaki University ko **hackathons, coding clubs, sports week**, ra **Semester Library ko Community Feed (\`/posts\`)** tira active huna thala — assignment ra project garda gardai milne sathi vetihalxa ni!`;
  }
  return `Haha, I'm your university AI companion, not a matchmaker! However, if you want to meet people and make great friends at Gandaki University, get involved in **campus hackathons, coding clubs, sports events, and group projects**, or join discussions on the **Semester Library Community Feed (\`/posts\`)**.`;
}

/**
 * Classifies whether a query (or multi-turn follow-up) is asking for public institutional
 * knowledge about Gandaki University (history, establishment, programmes, schools/faculties,
 * admission requirements, location, governance, public contact, or source provenance).
 */
function classifyUniversityPublicIntent(message, history = [], academicContext = {}) {
  const raw = String(message || '').trim();
  if (!raw) return null;
  const text = raw.toLowerCase();

  if (/\b(?:my|mero|mera|meri|maile)\s+(?:[a-z0-9_-]+\s+){0,3}(?:attendance|hajir|hazir|marks?|results?|grades?|submissions?|unsubmitted)\b/i.test(text)) {
    return null;
  }

  const isInternalResourceLookup = /\b(notes?\s+deu|pdf\s+deu|slides?\s+deu|my\s+routine|exam\s+routine\s+for\s+semester|unsubmitted\s+assignments?|submit\s+gareko)\b/i.test(text);
  if (isInternalResourceLookup) return null;

  const cleanHist = Array.isArray(history) ? history.filter(m => m && typeof m.content === 'string') : [];
  const lastUserTurn = [...cleanHist].reverse().find(m => m.role === 'user')?.content || '';
  const lastAssistantTurn = [...cleanHist].reverse().find(m => m.role === 'assistant')?.content || '';
  const hadGuPublicContext = (
    /\b(gandaki\s+university|2019\s+ad|2076\s+bs|pokhara-32|khudi|gyankunja|b\.?\s*pharm|bsm|sports\s+management|b\.?a\.?\s*ll\.?b|school\s+of\s+science\s+and\s+technology|school\s+of\s+management|gandakiuniversity\.edu\.np)\b/i.test(lastAssistantTurn) ||
    /\b(hamro\s+college|hamro\s+uni(?:versity)?|yo\s+university|gandaki\s+university|kun\s+kun\s+courses?|admission\s+ko\s+requirement)\b/i.test(lastUserTurn)
  );

  // 1. Source provenance follow-up ("yo information kaha bata payau?", "where did you get this information?")
  const asksSourceProvenance = (
    /\b(?:(?:yo|tyo|this|that)\s+(?:information|info|data|kura|vivaran)\s+(?:kaha|kata|kun\s+source)\s+bata\s+(?:payau|lyayau|aayo|khojyau|bhetyau)|kaha\s+bata\s+(?:payau|lyayau|thaha\s+payau)|where\s+did\s+you\s+(?:get|find)\s+(?:this|that)\s+(?:information|info|data)|what\s+is\s+(?:your|the)\s+source\s+(?:of|for)\s+(?:this|that)|source\s+(?:k\s+ho|deu|dekhauna|link\s+deu))\b/i.test(text) ||
    /(?:यो\s*जानकारी\s*कहाँबाट\s*पायौ|स्रोत\s*के\s*हो)/i.test(raw)
  );
  if (asksSourceProvenance && (hadGuPublicContext || cleanHist.length > 0)) {
    return {
      matched: true,
      subIntent: 'source_provenance',
      searchQuery: 'Gandaki University official website academic programmes notices',
      isFollowUp: true
    };
  }

  const hasUniversityRef = (
    /\b(gandaki\s+university|gandaki\s+uni|gu\b|hamro\s+(?:college|campus|university|uni)|our\s+(?:college|university|campus)|yo\s+(?:college|university|campus)|this\s+(?:university|college))\b/i.test(text) ||
    /गण्डकी\s*विश्वविद्यालय|हाम्रो\s*(?:कलेज|विश्वविद्यालय|क्याम्पस)/.test(raw)
  );

  // 2. Establishment & History
  const asksEstablishment = (
    (hasUniversityRef && /\b(establish\w*|founded|started|formed|created|history|origin|kaile\s+(?:baneko|stha?pना|sthapana|suru\s+vako|suru\s+bhako|khuleko)|kahile\s+(?:baneko|sthapana|suru|khuleko)|kati\s+sal\s+ma\s+baneko|baneko\s+(?:kaile|kahile|kati\s+sal))\b/i.test(text)) ||
    /\b(?:when\s+was\s+(?:it|gandaki\s+university|our\s+college|our\s+university)\s+(?:established|founded|started|created)|hamro\s+(?:college|university|uni|campus)\s+(?:kaile|kahile)\s+(?:baneko|sthapana\s+bhako|suru\s+vako|khuleko)(?:\s+ho)?)\b/i.test(text) ||
    /(?:गण्डकी\s*विश्वविद्यालय\s*कहिले\s*स्थापना|हाम्रो\s*कलेज\s*कहिले\s*बनेको)/.test(raw)
  );
  if (asksEstablishment) {
    return {
      matched: true,
      subIntent: 'establishment_history',
      searchQuery: 'Gandaki University establishment history 2019 2076 Gandaki University Act',
      isFollowUp: !hasUniversityRef && hadGuPublicContext
    };
  }

  // 3. Programmes & Courses Offered
  const asksOtherCoursesFollowUp = (
    /\b(?:(?:ani|and|tara|also)?\s*(?:bit\s+(?:bahek|bhanda\s+bahek|bayek)|besides?\s+bit|apart\s+from\s+bit|other\s+than\s+bit)\s*(?:aru|arko)?\s*(?:kun(?:\s+kun)?|k\s+k|what|which)\s+(?:courses?|program(?:me)?s?|degrees?|facult(?:y|ies)|subjects?)|(?:ani\s+)?aru\s+kun(?:\s+kun)?\s+(?:courses?|program(?:me)?s?|degrees?|facult(?:y|ies))\s*(?:xa|cha|chha|xan|chan|padhainxa|padhai\s+hunxa|offer\s+garxa)|what\s+other\s+(?:courses?|program(?:me)?s?|degrees?)\s+(?:are\s+there|does\s+it\s+offer))\b/i.test(text) ||
    /(?:अनि\s*BIT\s*बाहेक\s*अरु\s*कुन\s*कोर्स|अरु\s*कुन\s*कुन\s*कार्यक्रम)/.test(raw)
  );
  const asksProgrammes = asksOtherCoursesFollowUp || (
    (hasUniversityRef || hadGuPublicContext) &&
    !/\b(?:semester\s*[1-8]|[1-8](?:st|nd|rd|th)\s+semester)\b/i.test(text) &&
    (
      /\b(?:(?:what|which|kun(?:\s+kun)?|k\s+k|kati\s+wota)\s+(?:undergraduate\s+|bachelor'?s?\s+|academic\s+|degree\s+)?(?:program(?:me)?s?|courses?|degrees?|streams?)\s+(?:does\s+.*?\s+offer|are\s+(?:offered|available|taught)|padhainxa|padhai\s+hunxa|padhaunxa|xa|cha|chha|xan|chan)|(?:program(?:me)?s?|courses?|degrees?)\s+(?:offered|available|taught)\s+(?:at|in|by)\s+(?:gandaki\s+university|gu|our\s+college|hamro\s+college)|kun\s+kun\s+(?:courses?|program(?:me)?s?|vishaya|faculty)\s+(?:padhainxa|padhai\s+hunxa|xa|cha|xan))\b/i.test(text) ||
      /(?:कुन\s*कुन\s*(?:कोर्स|कार्यक्रम|विषय)\s*पढाइन्छ|कुन\s*कुन\s*स्नातक\s*कार्यक्रम)/.test(raw)
    )
  );
  if (asksProgrammes) {
    return {
      matched: true,
      subIntent: asksOtherCoursesFollowUp ? 'other_programmes_besides_bit' : 'programmes_offered',
      searchQuery: 'Gandaki University undergraduate academic programs BIT B.Pharm BBA BSM BA LLB',
      isFollowUp: asksOtherCoursesFollowUp || (!hasUniversityRef && hadGuPublicContext)
    };
  }

  // 4. Admission Requirements & Eligibility
  const asksAdmission = (
    /\b(?:admission\s*(?:requirements?|criteria|process|procedure|eligibility|guidelines?|kasari|k\s+ho|ko\s+requirement)|eligibility\s+(?:criteria|for\s+(?:bit|bba|b\.?pharm|bsm|admission))|how\s+to\s+(?:apply|get\s+admission)\s+(?:in|at|to|for)|entrance\s+exam\s+(?:requirements?|syllabus|pattern|criteria)|(?:bit|bba|b\.?pharm|bsm|college|university)\s+(?:ma\s+)?(?:admission|bherna|varna)\s+(?:ko\s+)?(?:requirement|eligibility|process|criteria|kasari\s+hune|k\s+chahinxa|k\s+ho)|admission\s+ko\s+lagi\s+k\s+(?:chahinxa|requirement\s+xa))\b/i.test(text) ||
    /(?:भर्नाको\s*लागि\s*योग्यता|एडमिसनको\s*लागि\s*के\s*चाहिन्छ)/.test(raw)
  );
  if (asksAdmission && (hasUniversityRef || hadGuPublicContext || /\b(bit|bba|b\.?pharm|bsm|ba\s*llb|admission\s+ko\s+requirement)\b/i.test(text))) {
    return {
      matched: true,
      subIntent: 'admission_requirements',
      searchQuery: 'Gandaki University BIT admission requirements eligibility criteria entrance examination',
      isFollowUp: !hasUniversityRef && hadGuPublicContext
    };
  }

  // 5. Schools, Faculties & Departments
  const asksSchoolsOrFaculties = (
    /\b(?:(?:what|which|kun(?:\s+kun)?|k\s+k|how\s+many|kati\s+wota)\s+(?:schools?|facult(?:y|ies)|departments?|deans?)(?:\s+(?:or|and|ra|wa)\s+(?:schools?|facult(?:y|ies)|departments?|deans?))?\s+(?:exist|are\s+there|does\s+.*?\s+have|le\s+padhaunxa|le\s+padhauxa|le\s+herxa|xa|cha|xan|chan)|kun\s+(?:faculty|school|department)\s+(?:le\s+padhaunxa|le\s+padhauxa|ma\s+parxa|antaragat\s+parxa)|which\s+(?:school|faculty|department)\s+(?:offers?|teaches|runs)\s+(?:bit|bba|b\.?pharm|bsm)|facult(?:y|ies)\s+(?:or|and)\s+schools?\s+(?:in|at|of|exist))/i.test(text) ||
    /(?:कुन\s*संकायले\s*पढाउँछ|कुन\s*कुन\s*स्कुल\s*र\s*संकाय\s*छन्)/.test(raw)
  );
  if (asksSchoolsOrFaculties && (hasUniversityRef || hadGuPublicContext || /\bkun\s+(?:faculty|school)\s+le\s+padhaun?xa\b/i.test(text))) {
    return {
      matched: true,
      subIntent: 'schools_and_faculties',
      searchQuery: 'Gandaki University schools faculties departments School of Science and Technology School of Management',
      isFollowUp: !hasUniversityRef && hadGuPublicContext
    };
  }

  // 6. Location & Campus Infrastructure
  const asksLocation = (
    (hasUniversityRef || hadGuPublicContext) &&
    /\b(where\s+is\s+.*?\s*located|location\s+of|address\s+of|campus\s+location|kata\s+(?:xa|cha|chha|parxa)|kaha\s+(?:xa|cha|chha|parxa)|kun\s+thau\s+ma\s+(?:xa|cha))\b/i.test(text)
  ) || /(?:गण्डकी\s*विश्वविद्यालय\s*कहाँ\s*छ|हाम्रो\s*कलेज\s*कता\s*छ)/.test(raw);
  if (asksLocation) {
    return {
      matched: true,
      subIntent: 'location_campus',
      searchQuery: 'Gandaki University location address Pokhara-32 Khudi Gyankunja Mustachowk',
      isFollowUp: !hasUniversityRef && hadGuPublicContext
    };
  }

  // 7. Governance, Leadership, VC, Registrar, Contact
  const asksGovernanceOrContact = (
    (hasUniversityRef || hadGuPublicContext) &&
    /\b(vice[- ]?chancellor|chancellor|registrar|board\s+of\s+trustees|leadership|governance|official\s+website|contact\s+(?:details|address|page|info)|email\s+of\s+gandaki\s+university)\b/i.test(text)
  );
  if (asksGovernanceOrContact) {
    return {
      matched: true,
      subIntent: 'governance_and_contact',
      searchQuery: 'Gandaki University governance leadership Vice-Chancellor Registrar official contact website',
      isFollowUp: !hasUniversityRef && hadGuPublicContext
    };
  }

  // 8. General Overview
  const asksGeneralOverview = (
    /\b(?:tell\s+me\s+about\s+gandaki\s+university|what\s+is\s+gandaki\s+university|overview\s+of\s+gandaki\s+university|gandaki\s+university\s+ko\s+barema\s+(?:vana|bhana|bataideu|jankari\s+deu)|hamro\s+(?:college|university)\s+ko\s+barema\s+(?:vana|bhana|bataideu))\b/i.test(text) ||
    (hadGuPublicContext && /^(?:(?:ani|and)\s+)?(?:tesko|tyesko|yesko|yo\s+university\s+ko)\s+barema(?:\s+aru)?\s*(?:vana|bhana|bataideu|k\s+xa)?[?.!।]*$/i.test(raw))
  );
  if (asksGeneralOverview) {
    return {
      matched: true,
      subIntent: 'general_overview',
      searchQuery: 'Gandaki University Pokhara overview establishment programs faculties',
      isFollowUp: !hasUniversityRef && hadGuPublicContext
    };
  }

  // 9. Other explicit Gandaki University public institutional questions
  if (hasUniversityRef && !/\b(attendance|hajir|marks?|results?|assignments?|notes?|routine)\b/i.test(text)) {
    return {
      matched: true,
      subIntent: 'general_public_query',
      searchQuery: `Gandaki University ${raw}`,
      isFollowUp: false
    };
  }

  return null;
}

/**
 * Parses and validates a URL, returning hostname and normalized domain.
 */
function parseSafeHttpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const domain = u.hostname.toLowerCase().replace(/^www\./, '');
    return {
      url: u.toString(),
      hostname: u.hostname.toLowerCase(),
      domain
    };
  } catch (_) {
    return null;
  }
}

/**
 * Classifies a domain into Authority Tiers for Gandaki University public research.
 */
function classifyWebDomainAuthority(domain) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (d === 'gandakiuniversity.edu.np' || d.endsWith('.gandakiuniversity.edu.np')) {
    return { tier: 1, isOfficialGu: true, trustLabel: 'Official Gandaki University Website' };
  }
  if (GOV_EDU_TRUSTED_DOMAINS.some(gov => d === gov || d.endsWith(`.${gov}`)) || d.endsWith('.gov.np')) {
    return { tier: 2, isOfficialGu: false, trustLabel: 'Official Government / Education Portal' };
  }
  if (SECONDARY_REPUTABLE_DOMAINS.some(sec => d === sec || d.endsWith(`.${sec}`))) {
    return { tier: 3, isOfficialGu: false, trustLabel: 'Secondary Education / News Source' };
  }
  return { tier: 4, isOfficialGu: false, trustLabel: 'External Secondary Web Source' };
}

/**
 * Filters, sanitizes, checks recency, and ranks raw external web search results for Gandaki University.
 */
function filterAndRankUniversityWebResults(rawResults = [], { query = '', referenceDate = new Date() } = {}) {
  const { sanitizeUntrustedRecordText } = require('./chat-security');
  const currentYear = (referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime()))
    ? referenceDate.getFullYear()
    : new Date().getFullYear();

  const accepted = [];
  const rejectedUnrelated = [];
  let sanitizedCount = 0;

  for (const item of (Array.isArray(rawResults) ? rawResults : [])) {
    if (!item || typeof item !== 'object') continue;
    const parsedUrl = parseSafeHttpUrl(item.url || item.link || item.href);
    if (!parsedUrl) continue;

    const rawTitle = String(item.title || '').trim();
    const rawSnippet = String(item.snippet || item.content || item.description || '').trim();
    const combinedRaw = `${rawTitle} ${rawSnippet} ${parsedUrl.url}`;

    const auth = classifyWebDomainAuthority(parsedUrl.domain);
    const mentionsGandakiUni = /\b(gandaki\s+university|gandakiuniversity)\b|गण्डकी\s*विश्वविद्यालय/i.test(combinedRaw);
    const mentionsUnrelatedUni = UNRELATED_UNIVERSITY_PATTERNS.test(combinedRaw);

    if (!auth.isOfficialGu && (!mentionsGandakiUni || (mentionsUnrelatedUni && !/\bgandaki\s+university\b/i.test(rawTitle)))) {
      rejectedUnrelated.push({
        title: rawTitle.slice(0, 120),
        url: parsedUrl.url,
        domain: parsedUrl.domain,
        reason: mentionsUnrelatedUni ? 'unrelated_university' : 'missing_gandaki_university_relevance'
      });
      continue;
    }

    const cleanTitle = sanitizeUntrustedRecordText(rawTitle).replace(/\s+/g, ' ').trim();
    const cleanSnippet = sanitizeUntrustedRecordText(rawSnippet).replace(/\s+/g, ' ').trim();
    const wasModified = (
      cleanTitle !== rawTitle.replace(/\s+/g, ' ').trim() ||
      cleanSnippet !== rawSnippet.replace(/\s+/g, ' ').trim()
    );
    if (wasModified) {
      sanitizedCount += 1;
    }

    const safeTitle = cleanTitle.replace(/\[[^\]]*-removed\]/g, '').trim() || 'Gandaki University Resource';
    const safeSnippet = cleanSnippet.replace(/\[[^\]]*-removed\]/g, '').trim();

    if (!safeSnippet && wasModified) {
      continue;
    }

    const rawDateStr = String(item.publishedDate || item.date || item.createdAt || '').trim();
    const yearMatch = (rawDateStr || safeSnippet || safeTitle).match(/\b(20[12]\d)\b/);
    const sourceYear = yearMatch ? Number(yearMatch[1]) : null;
    const isHistoricalFact = /\b(established|founded|act\s*,?\s*2076|2019\s*ad)\b/i.test(`${query} ${safeSnippet}`);
    const isOutdated = Boolean(sourceYear && (currentYear - sourceYear >= 2) && !isHistoricalFact);

    accepted.push({
      title: safeTitle,
      snippet: safeSnippet,
      url: parsedUrl.url,
      domain: parsedUrl.domain,
      authorityTier: auth.tier,
      isOfficialGu: auth.isOfficialGu,
      trustLabel: auth.trustLabel,
      publishedDate: rawDateStr ? rawDateStr.slice(0, 10) : (sourceYear ? String(sourceYear) : null),
      sourceYear,
      isOutdated,
      wasSanitized: wasModified
    });
  }

  accepted.sort((a, b) => {
    if (a.authorityTier !== b.authorityTier) return a.authorityTier - b.authorityTier;
    if (a.isOutdated !== b.isOutdated) return a.isOutdated ? 1 : -1;
    return (b.sourceYear || 0) - (a.sourceYear || 0);
  });

  let conflictDetected = false;
  let conflictSummary = null;
  const officialSources = accepted.filter(r => r.authorityTier === 1);
  const secondarySources = accepted.filter(r => r.authorityTier >= 3);

  if (officialSources.length > 0 && secondarySources.length > 0) {
    const offText = officialSources.map(s => s.snippet).join(' ');
    const secText = secondarySources.map(s => s.snippet).join(' ');
    const offYears = [...new Set((offText.match(/\b(19\d\d|20[0-2]\d)\b/g) || []))];
    const secYears = [...new Set((secText.match(/\b(19\d\d|20[0-2]\d)\b/g) || []))];
    const offCgpa = offText.match(/\b(?:cgpa|gpa)\s*(?:of\s*)?(\d+(?:\.\d+)?)/i)?.[1];
    const secCgpa = secText.match(/\b(?:cgpa|gpa)\s*(?:of\s*)?(\d+(?:\.\d+)?)/i)?.[1];

    if (
      (offYears.length > 0 && secYears.length > 0 && !secYears.some(y => offYears.includes(y))) ||
      (offCgpa && secCgpa && offCgpa !== secCgpa) ||
      officialSources[0].sourceYear !== secondarySources[0].sourceYear
    ) {
      conflictDetected = true;
      conflictSummary = `Official Gandaki University source (${officialSources[0].domain}) takes precedence over conflicting secondary source (${secondarySources[0].domain}).`;
    }
  }

  const hasOfficialSource = officialSources.length > 0;
  const hasSecondaryOnly = accepted.length > 0 && !hasOfficialSource;
  const hasOutdatedOnly = accepted.length > 0 && accepted.every(r => r.isOutdated);

  return {
    results: accepted,
    rejectedUnrelated,
    sanitizedCount,
    hasOfficialSource,
    hasSecondaryOnly,
    hasOutdatedOnly,
    conflictDetected,
    conflictSummary
  };
}

/**
 * Builds curated official Gandaki University web sources for known institutional intents.
 */
function getCuratedOfficialGuResults(subIntent, query = '') {
  const k = VERIFIED_GU_INSTITUTIONAL_KNOWLEDGE;
  const qLower = String(query || '').toLowerCase();

  if (subIntent === 'establishment_history') {
    return [
      {
        title: 'About Gandaki University — Establishment & History',
        url: k.officialAboutUrl,
        publishedDate: '2024-01-01',
        snippet: `Gandaki University was established in ${k.establishedAd} AD (${k.establishedBs} BS) by the ${k.founder} under the ${k.establishingAct}. Its main campus is in ${k.location.mainCampus}.`
      }
    ];
  }

  if (subIntent === 'programmes_offered' || subIntent === 'other_programmes_besides_bit') {
    return [
      {
        title: 'Academic Programmes — Gandaki University',
        url: k.officialProgramsUrl,
        publishedDate: '2025-01-01',
        snippet: `Gandaki University offers undergraduate programmes across its schools: Bachelor of Information Technology (BIT), Bachelor of Pharmacy (B.Pharm), Bachelor of Business Administration (BBA), Bachelor in Sports Management (BSM), and Bachelor of Arts Bachelor of Laws (B.A. LL.B.).`
      },
      {
        title: 'Bachelor of Information Technology (BIT) — Gandaki University',
        url: k.programmes[0].url,
        publishedDate: '2025-01-01',
        snippet: k.programmes[0].eligibility
      }
    ];
  }

  if (subIntent === 'admission_requirements') {
    return [
      {
        title: 'Admission Eligibility & Entrance Examination — Gandaki University',
        url: k.officialAdmissionUrl,
        publishedDate: '2025-01-01',
        snippet: `For BIT at Gandaki University: ${k.programmes[0].eligibility} For BBA, B.Pharm, BSM, and B.A. LL.B., applicants must complete 10+2 or equivalent with minimum required CGPA and pass the Gandaki University Entrance Examination.`
      }
    ];
  }

  if (subIntent === 'schools_and_faculties') {
    return [
      {
        title: 'Schools, Faculties & Research Center — Gandaki University',
        url: k.schools[0].url,
        publishedDate: '2025-01-01',
        snippet: `Gandaki University operates the School of Science and Technology (SoST — BIT, B.Pharm, B.Tech AI), the School of Management, Law, and Social Sciences (SoMLSS — BBA, BSM, B.A. LL.B.), and the Research and Innovation Center (RIC).`
      }
    ];
  }

  if (subIntent === 'location_campus') {
    return [
      {
        title: 'Campus Location & Contact — Gandaki University, Pokhara',
        url: k.officialContactUrl,
        publishedDate: '2025-01-01',
        snippet: `Gandaki University's main academic campus is located at ${k.location.mainCampus}, and its administrative office is at ${k.location.adminOffice}. Official email: ${k.officialEmail}.`
      }
    ];
  }

  if (subIntent === 'governance_and_contact' || subIntent === 'general_overview' || subIntent === 'source_provenance') {
    return [
      {
        title: 'Gandaki University — Official Institutional Portal',
        url: k.officialWebsite,
        publishedDate: '2025-01-01',
        snippet: `${k.name} (${k.nepaliName}), established in ${k.establishedAd} AD (${k.establishedBs} BS) in ${k.location.city}. ${k.governance}`
      },
      {
        title: 'Contact & Administration — Gandaki University',
        url: k.officialContactUrl,
        publishedDate: '2025-01-01',
        snippet: `Main Campus: ${k.location.mainCampus}. Administrative Office: ${k.location.adminOffice}. Email: ${k.officialEmail}.`
      }
    ];
  }

  if (/\b(establish|founded|2019|2076|bit|b\.?pharm|bba|bsm|ll\.?b|admission|eligibility|entrance|faculty|school|location|pokhara|khudi|gyankunja|mustachowk|vc|chancellor|registrar)\b/i.test(qLower)) {
    return [
      {
        title: 'Gandaki University — Official Portal',
        url: k.officialWebsite,
        publishedDate: '2025-01-01',
        snippet: `${k.name} (${k.establishedAd} AD / ${k.establishedBs} BS), Pokhara, Nepal. Offers BIT, B.Pharm, BBA, BSM, and B.A. LL.B. under SoST and SoMLSS.`
      }
    ];
  }

  return [];
}

/**
 * Executes a scoped public Gandaki University research lookup.
 */
async function searchGandakiUniversityPublic(query, {
  intentInfo = null,
  db = null,
  webSearchFn = null,
  referenceDate = new Date(),
  skipCache = false
} = {}) {
  const effectiveIntent = intentInfo || classifyUniversityPublicIntent(query) || {
    subIntent: 'general_public_query',
    searchQuery: `Gandaki University ${query}`
  };
  const cacheKey = `${effectiveIntent.subIntent}:${String(query || '').trim().toLowerCase()}`;

  if (!skipCache && !webSearchFn && publicWebCache.has(cacheKey)) {
    const cached = publicWebCache.get(cacheKey);
    if (cached.expiresAt > Date.now()) {
      return { ...structuredClone(cached.value), fromCache: true };
    }
    publicWebCache.delete(cacheKey);
  }

  let syncedGuNotices = [];
  if (db && typeof db.all === 'function') {
    try {
      syncedGuNotices = await searchOfficialUniversityNotices(db, { query, limit: 3 });
    } catch (_) {
      syncedGuNotices = [];
    }
  }

  let rawWebResults = [];
  let usedCustomWebSearch = false;
  if (typeof webSearchFn === 'function') {
    usedCustomWebSearch = true;
    try {
      const customOut = await webSearchFn(effectiveIntent.searchQuery || query, {
        university: 'Gandaki University',
        officialDomain: 'gandakiuniversity.edu.np'
      });
      if (Array.isArray(customOut)) {
        rawWebResults = customOut;
      } else if (customOut && Array.isArray(customOut.results)) {
        rawWebResults = customOut.results;
      }
    } catch (_) {
      rawWebResults = [];
    }
  } else {
    rawWebResults = getCuratedOfficialGuResults(effectiveIntent.subIntent, query);
  }

  for (const gn of syncedGuNotices) {
    rawWebResults.push({
      title: gn.title || 'Official Gandaki University Notice',
      url: gn.webUrl || VERIFIED_GU_INSTITUTIONAL_KNOWLEDGE.officialNoticesUrl,
      publishedDate: gn.publishedDate || '2025-01-01',
      snippet: gn.content || gn.title
    });
  }

  const filtered = filterAndRankUniversityWebResults(rawWebResults, {
    query,
    referenceDate
  });

  const webSources = filtered.results.slice(0, 5).map(r => ({
    title: r.title,
    url: r.url,
    domain: r.domain,
    authorityTier: r.authorityTier,
    trustLabel: r.trustLabel,
    publishedDate: r.publishedDate,
    isOutdated: r.isOutdated,
    snippet: r.snippet
  }));

  const output = {
    query: String(query || '').trim(),
    subIntent: effectiveIntent.subIntent,
    results: filtered.results,
    webSources,
    syncedGuNotices,
    rejectedUnrelated: filtered.rejectedUnrelated,
    sanitizedCount: filtered.sanitizedCount,
    hasOfficialSource: filtered.hasOfficialSource,
    hasSecondaryOnly: filtered.hasSecondaryOnly,
    hasOutdatedOnly: filtered.hasOutdatedOnly,
    conflictDetected: filtered.conflictDetected,
    conflictSummary: filtered.conflictSummary,
    usedCustomWebSearch,
    fromCache: false
  };

  if (!skipCache && !usedCustomWebSearch) {
    if (publicWebCache.size >= 200) {
      publicWebCache.delete(publicWebCache.keys().next().value);
    }
    publicWebCache.set(cacheKey, {
      value: structuredClone(output),
      expiresAt: Date.now() + PUBLIC_WEB_CACHE_TTL_MS
    });
  }

  return output;
}

/**
 * Synthesizes a natural, conversational, source-grounded response for public Gandaki University queries.
 */
function synthesizeUniversityPublicReply(message, researchResult, {
  intentInfo = null,
  history = [],
  chatMode = 'roast',
  internalRecords = null
} = {}) {
  const { detectLanguage } = require('./chat-personality');
  const lang = detectLanguage(message);
  const raw = String(message || '').trim();
  const isDevanagari = lang === 'devanagari' || /[\u0900-\u097F]/.test(raw);
  const isNepali = !isDevanagari && (
    lang === 'roman_nepali' ||
    lang === 'romanized_nepali' ||
    lang === 'mixed' ||
    /\b(hamro|kaile|kahile|baneko|kun|padhainxa|padhaunxa|bahek|aru|ko|ma|xa|cha|chha|ho|kaha|bata|payau|vana|bhana|yrr|bro)\b/i.test(raw)
  );

  const k = VERIFIED_GU_INSTITUTIONAL_KNOWLEDGE;
  const subIntent = intentInfo?.subIntent || researchResult?.subIntent || 'general_public_query';
  const results = Array.isArray(researchResult?.results) ? researchResult.results : [];
  const topSource = results[0] || null;

  const noticesAndWarnings = [];
  if (researchResult?.conflictDetected && researchResult?.conflictSummary) {
    noticesAndWarnings.push(
      isNepali
        ? `ℹ️ **Source Verification Note:** Official Gandaki University source (\`${topSource?.domain || 'gandakiuniversity.edu.np'}\`) ra secondary source bich kehi farak bhetiyeko le official university record lai prioritize gariyeko cha.`
        : `ℹ️ **Source Verification Note:** Conflicting details were found between an official Gandaki University page and a secondary source; the official Gandaki University record (${topSource?.domain || 'gandakiuniversity.edu.np'}) is prioritized below.`
    );
  }
  if (researchResult?.hasOutdatedOnly && topSource) {
    const yr = topSource.sourceYear || topSource.publishedDate || 'an earlier year';
    noticesAndWarnings.push(
      isNepali
        ? `⚠️ **Recency Warning:** Yo jankari purano source (${yr}) bata bhetiyeko ho ra naya academic session ma update bhayeko huna sakcha.`
        : `⚠️ **Recency Warning:** This information comes from an older source (${yr}) and may have been updated for the current academic session.`
    );
  } else if (researchResult?.hasSecondaryOnly && topSource) {
    noticesAndWarnings.push(
      isNepali
        ? `ℹ️ **Source Attribution:** Yo jankari secondary source (**${topSource.domain}** — *${topSource.trustLabel}*) bata liyeko ho.`
        : `ℹ️ **Source Attribution:** This information is sourced from a secondary publication (**${topSource.domain}** — *${topSource.trustLabel}*).`
    );
  }

  if (results.length === 0) {
    const unverifiedMsg = isDevanagari
      ? `गण्डकी विश्वविद्यालयको आधिकारिक वेबसाइट वा सार्वजनिक स्रोतहरूमा यस विषयको भरपर्दो विवरण फेला परेन। कृपया [Gandaki University Official Website](${k.officialWebsite}) मा हेर्नुहोस्।`
      : (isNepali
          ? `Gandaki University ko official website wa reliable public sources ma yo kura verify garna sakiyena bro. Thap official update ko lagi [Gandaki University Official Portal](${k.officialWebsite}) check gara hai.`
          : `I couldn't verify that specific detail from reliable official Gandaki University sources (unrelated or unverified results were excluded). You can check the [Gandaki University Official Website](${k.officialWebsite}) for the latest institutional updates.`);
    return unverifiedMsg;
  }

  let body = '';

  if (subIntent === 'source_provenance') {
    body = isDevanagari
      ? `यो जानकारी गण्डकी विश्वविद्यालयको आधिकारिक वेबसाइट ([Gandaki University Official Website](${k.officialWebsite}), [Academic Programmes](${k.officialProgramsUrl}), र [Admissions Portal](${k.officialAdmissionUrl})) तथा **Semester Library** को आधिकारिक पाठ्यक्रम रेकर्डबाट लिइएको हो।`
      : (isNepali
          ? `Yo jankari maile **Gandaki University ko official website** ([gandakiuniversity.edu.np](${k.officialWebsite}), [Academic Programmes](${k.officialProgramsUrl}), ra [Admission Portal](${k.officialAdmissionUrl})) tatha **Semester Library ko official BIT curriculum records** bata liyeko hu bro!`
          : `I retrieved this information from **Gandaki University's official website** ([gandakiuniversity.edu.np](${k.officialWebsite}), [Academic Programmes](${k.officialProgramsUrl}), and [Admission Portal](${k.officialAdmissionUrl})) alongside **Semester Library's verified BIT curriculum records**.`);
  } else if (subIntent === 'establishment_history') {
    const customSnippetNote = (researchResult?.usedCustomWebSearch && topSource?.snippet)
      ? `\n\n${topSource.snippet}`
      : '';
    body = isDevanagari
      ? `**गण्डकी विश्वविद्यालय (Gandaki University)** को स्थापना **सन् २०१९ (वि.सं. २०७६)** मा गण्डकी प्रदेश सरकारद्वारा *गण्डकी विश्वविद्यालय ऐन, २०७६ (Gandaki University Act, 2076)* अन्तर्गत नेपालको पहिलो प्रादेशिक विश्वविद्यालयको रूपमा भएको हो। यसको मुख्य शैक्षिक क्याम्पस **पोखरा-३२, खुदी (ज्ञानकुञ्ज)** र प्रशासनिक कार्यालय **मुस्ताङचोक, पोखरा** मा रहेको छ (${customSnippetNote ? '' : `[About Gandaki University](${k.officialAboutUrl})`}).${customSnippetNote}`
      : (isNepali
          ? `Hamro college (**Gandaki University**) **${k.establishedAd} AD (${k.establishedBs} BS)** ma **Gandaki Province Government** le *${k.establishingAct}* antargat Nepal ko pahilo provincial university ko rup ma sthapana gareko ho bro! Yesko main teaching campus **${k.location.mainCampus}** ra administrative office **${k.location.adminOffice}** ma xa ([About Gandaki University](${topSource?.url || k.officialAboutUrl})).${customSnippetNote}`
          : `**Gandaki University** was established in **${k.establishedAd} AD (${k.establishedBs} BS)** by the **${k.founder}** under the *${k.establishingAct}*. Its main teaching campus is located at **${k.location.mainCampus}**, with its administrative office at **${k.location.adminOffice}** ([About Gandaki University](${topSource?.url || k.officialAboutUrl})).${customSnippetNote}`);
  } else if (subIntent === 'other_programmes_besides_bit') {
    body = isDevanagari
      ? `**BIT (Bachelor of Information Technology)** बाहेक गण्डकी विश्वविद्यालयमा निम्न स्नातक कार्यक्रमहरू (undergraduate programmes) पढाइन्छ:\n- **Bachelor of Pharmacy (B.Pharm)** — ४ वर्षे (८ सेमेस्टर), *School of Science and Technology*\n- **Bachelor of Business Administration (BBA)** — ४ वर्षे (८ सेमेस्टर), *School of Management, Law, and Social Sciences*\n- **Bachelor in Sports Management (BSM)** — ४ वर्षे (८ सेमेस्टर, नेपालको पहिलो स्पोर्ट्स म्यानेजमेन्ट डिग्री)\n- **Bachelor of Arts Bachelor of Laws (B.A. LL.B.)** — ५ वर्षे (१० सेमेस्टर)\n- **B.Tech in Artificial Intelligence (B.Tech AI)**\n\nथप विवरण: [Gandaki University Academic Programmes](${topSource?.url || k.officialProgramsUrl})`
      : (isNepali
          ? `**BIT (Bachelor of Information Technology)** bahek hamro **Gandaki University** ma aru yo bachelor courses haru padhainxa bro:\n- **Bachelor of Pharmacy (B.Pharm)** — 4 years (8 semesters), *School of Science and Technology*\n- **Bachelor of Business Administration (BBA)** — 4 years (8 semesters), *School of Management, Law, and Social Sciences*\n- **Bachelor in Sports Management (BSM)** — 4 years (8 semesters, Nepal ko first Sports Management degree)\n- **Bachelor of Arts Bachelor of Laws (B.A. LL.B.)** — 5 years (10 semesters)\n- **B.Tech in Artificial Intelligence (B.Tech AI)**\n\nOfficial details herna: [Gandaki University Academic Programmes](${topSource?.url || k.officialProgramsUrl})`
          : `Besides **Bachelor of Information Technology (BIT)**, **Gandaki University** offers the following undergraduate degree programmes:\n- **Bachelor of Pharmacy (B.Pharm)** — 4 years (8 semesters), under the *School of Science and Technology*\n- **Bachelor of Business Administration (BBA)** — 4 years (8 semesters), under the *School of Management, Law, and Social Sciences*\n- **Bachelor in Sports Management (BSM)** — 4 years (8 semesters, Nepal's first sports management degree)\n- **Bachelor of Arts Bachelor of Laws (B.A. LL.B.)** — 5 years (10 semesters)\n- **B.Tech in Artificial Intelligence (B.Tech AI)**\n\nSource: [Gandaki University Academic Programmes](${topSource?.url || k.officialProgramsUrl})`);
  } else if (subIntent === 'programmes_offered') {
    const internalBitNote = internalRecords?.bitCourseCount
      ? (isNepali
          ? `\n\n*(Semester Library vitra BIT ko sabai 8 semesters ko ${internalRecords.bitCourseCount} subjects ko detailed syllabus ra study materials available xa!)*`
          : `\n\n*(Inside Semester Library, we also host the complete 8-semester BIT syllabus across ${internalRecords.bitCourseCount} courses and study materials.)*`)
      : '';
    body = isDevanagari
      ? `**गण्डकी विश्वविद्यालय (Gandaki University)** मा निम्न स्नातक (Undergraduate) कार्यक्रमहरू पढाइन्छ:\n- **Bachelor of Information Technology (BIT)** — ४ वर्षे (८ सेमेस्टर, १२६ क्रेडिट), *School of Science and Technology*\n- **Bachelor of Pharmacy (B.Pharm)** — ४ वर्षे (८ सेमेस्टर), *School of Science and Technology*\n- **Bachelor of Business Administration (BBA)** — ४ वर्षे (८ सेमेस्टर), *School of Management, Law, and Social Sciences*\n- **Bachelor in Sports Management (BSM)** — ४ वर्षे (८ सेमेस्टर), *School of Management, Law, and Social Sciences*\n- **Bachelor of Arts Bachelor of Laws (B.A. LL.B.)** — ५ वर्षे (१० सेमेस्टर), *School of Management, Law, and Social Sciences*\n- **B.Tech in Artificial Intelligence (B.Tech AI)**\n\nस्रोत: [Gandaki University Academic Programmes](${topSource?.url || k.officialProgramsUrl})${internalBitNote}`
      : (isNepali
          ? `Hamro **Gandaki University** ma padhai hune undergraduate courses / programmes haru yes prakar xan bro:\n- **Bachelor of Information Technology (BIT)** — 4 years (8 semesters, 126 credits), *School of Science and Technology*\n- **Bachelor of Pharmacy (B.Pharm)** — 4 years (8 semesters), *School of Science and Technology*\n- **Bachelor of Business Administration (BBA)** — 4 years (8 semesters), *School of Management, Law, and Social Sciences*\n- **Bachelor in Sports Management (BSM)** — 4 years (8 semesters), *School of Management, Law, and Social Sciences*\n- **Bachelor of Arts Bachelor of Laws (B.A. LL.B.)** — 5 years (10 semesters), *School of Management, Law, and Social Sciences*\n- **B.Tech in Artificial Intelligence (B.Tech AI)**\n\nSource: [Gandaki University Academic Programmes](${topSource?.url || k.officialProgramsUrl})${internalBitNote}`
          : `**Gandaki University** offers the following undergraduate degree programmes:\n- **Bachelor of Information Technology (BIT)** — 4 years (8 semesters, 126 credit hours), *School of Science and Technology*\n- **Bachelor of Pharmacy (B.Pharm)** — 4 years (8 semesters), *School of Science and Technology*\n- **Bachelor of Business Administration (BBA)** — 4 years (8 semesters), *School of Management, Law, and Social Sciences*\n- **Bachelor in Sports Management (BSM)** — 4 years (8 semesters), *School of Management, Law, and Social Sciences*\n- **Bachelor of Arts Bachelor of Laws (B.A. LL.B.)** — 5 years (10 semesters), *School of Management, Law, and Social Sciences*\n- **B.Tech in Artificial Intelligence (B.Tech AI)**\n\nSource: [Gandaki University Academic Programmes](${topSource?.url || k.officialProgramsUrl})${internalBitNote}`);
  } else if (subIntent === 'admission_requirements') {
    body = isDevanagari
      ? `**गण्डकी विश्वविद्यालय (Gandaki University)** मा **BIT** लगायत स्नातक भर्नाका मुख्य आवश्यकताहरू:\n- **शैक्षिक योग्यता (Academic Eligibility):** मान्यता प्राप्त बोर्डबाट **१०+२ (Higher Secondary) वा सो सरह** कम्तीमा **CGPA 2.0 (वा C ग्रेड / दोस्रो श्रेणी)** सहित उत्तीर्ण (BIT को लागि १०० पूर्णाङ्कको **गणित / Mathematics** विषय अनिवार्य)।\n- **प्रवेश परीक्षा (Entrance Examination):** गण्डकी विश्वविद्यालयले सञ्चालन गर्ने **Entrance Exam** र मेरिट अन्तर्वार्ता उत्तीर्ण गर्नुपर्नेछ।\n- **अन्य कार्यक्रमहरू:** B.Pharm का लागि १०+२ विज्ञान (PCB) वा डिप्लोमा इन फार्मेसीमा कम्तीमा ५०% / CGPA 2.4 आवश्यक पर्छ भने BBA र B.A. LL.B. का लागि जुनसुकै संकायमा न्यूनतम CGPA 2.0 र प्रवेश परीक्षा उत्तीर्ण हुनुपर्छ।\n\nआधिकारिक विवरण: [Gandaki University Admissions](${topSource?.url || k.officialAdmissionUrl})`
      : (isNepali
          ? `**Gandaki University** ma **BIT** ra undergraduate admission ko requirement yes prakar xa bro:\n- **Academic Qualification:** Recognized board bata **10+2 (+2) wa equivalent** ma minimum **CGPA 2.0 (or C grade / Second Division)** lyayeko hunu parxa (BIT ko lagi +2 ma **100-marks Mathematics** padheko hunu parxa).\n- **Entrance Examination:** Gandaki University le line **Entrance Exam** pass garera merit list ma parnu parxa.\n- **Other Programmes:** **BBA** ra **B.A. LL.B.** ko lagi kunai pani stream ma +2 (min CGPA 2.0) + Entrance Exam chahinxa, ra **B.Pharm** ko lagi +2 Science (Biology/Maths) wa Diploma in Pharmacy ma 50% / CGPA 2.4 + Entrance Exam chahinxa.\n\nOfficial details: [Gandaki University Admissions](${topSource?.url || k.officialAdmissionUrl})`
          : `Here are the **admission requirements** at **Gandaki University** (specifically for **BIT** and undergraduate programmes):\n- **Academic Eligibility (BIT):** Completion of **10+2 (Higher Secondary) or equivalent** from a recognized board with a minimum **CGPA of 2.0 (or C grade / Second Division)**, including **100-marks Mathematics**.\n- **Entrance Examination:** Applicants must pass the **Gandaki University Entrance Examination** and merit-based admission process.\n- **Other Programmes:** **BBA** and **B.A. LL.B.** require 10+2 in any stream with minimum CGPA 2.0 plus the entrance exam; **B.Pharm** requires 10+2 Science (PCB) or Diploma in Pharmacy with at least 50% aggregate (CGPA 2.4) plus the entrance exam.\n\nSource: [Gandaki University Admissions](${topSource?.url || k.officialAdmissionUrl})`);
  } else if (subIntent === 'schools_and_faculties') {
    body = isDevanagari
      ? `**गण्डकी विश्वविद्यालय (Gandaki University)** मा निम्न स्कुल, संकाय (Faculties/Schools) र अनुसन्धान केन्द्रहरू रहेका छन्:\n- **School of Science and Technology (SoST):** यस अन्तर्गत **BIT**, **B.Pharm**, र **B.Tech AI** पढाइ हुन्छ।\n- **School of Management, Law, and Social Sciences (SoMLSS):** यस अन्तर्गत **BBA**, **BSM (Sports Management)**, र **B.A. LL.B.** पढाइ हुन्छ।\n- **Research and Innovation Center (RIC):** विश्वविद्यालयको वैज्ञानिक अनुसन्धान र आविष्कार केन्द्र।\n\nआधिकारिक स्रोत: [School of Science and Technology — Gandaki University](${topSource?.url || k.schools[0].url})`
      : (isNepali
          ? `**Gandaki University** ma मुख्य गरी यी **Schools / Faculties** हरू छन् जसले विभिन्न कार्यक्रमहरू पढाउँछन्:\n- **School of Science and Technology (SoST):** Yesle **BIT (Bachelor of Information Technology)**, **B.Pharm**, ra **B.Tech AI** padhaunxa.\n- **School of Management, Law, and Social Sciences (SoMLSS):** Yesle **BBA**, **BSM (Bachelor in Sports Management)**, ra **B.A. LL.B.** padhaunxa.\n- **Research and Innovation Center (RIC):** Applied research ra innovation projects sanchalan garxa.\n\nOfficial link: [Gandaki University Schools & Faculties](${topSource?.url || k.schools[0].url})`
          : `**Gandaki University** organizes its academic programmes under the following schools and centers:\n- **School of Science and Technology (SoST):** Teaches **Bachelor of Information Technology (BIT)**, **Bachelor of Pharmacy (B.Pharm)**, and **B.Tech in Artificial Intelligence (B.Tech AI)**.\n- **School of Management, Law, and Social Sciences (SoMLSS):** Teaches **Bachelor of Business Administration (BBA)**, **Bachelor in Sports Management (BSM)**, and **Bachelor of Arts Bachelor of Laws (B.A. LL.B.)**.\n- **Research and Innovation Center (RIC):** Leads provincial research grants, innovation labs, and scientific research.\n\nSource: [Gandaki University Schools & Faculties](${topSource?.url || k.schools[0].url})`);
  } else if (subIntent === 'location_campus') {
    body = isDevanagari
      ? `**गण्डकी विश्वविद्यालय (Gandaki University)** को मुख्य शैक्षिक क्याम्पस **पोखरा-३२, खुदी (ज्ञानकुञ्ज), कास्की, गण्डकी प्रदेश** मा छ भने प्रशासनिक कार्यालय **मुस्ताङचोक, पोखरा** मा रहेको छ ([Gandaki University Contact & Location](${topSource?.url || k.officialContactUrl}))।`
      : (isNepali
          ? `Hamro **Gandaki University** ko main teaching campus **${k.location.mainCampus}** ma xa, ra administrative office **${k.location.adminOffice}** ma raheko xa ([Gandaki University Contact & Location](${topSource?.url || k.officialContactUrl})).`
          : `**Gandaki University's** main teaching campus is located at **${k.location.mainCampus}**, and its central administrative office is at **${k.location.adminOffice}** ([Gandaki University Contact & Location](${topSource?.url || k.officialContactUrl})).`);
  } else if (subIntent === 'governance_and_contact') {
    body = isNepali
      ? `**Gandaki University** *Gandaki University Act, 2076* antargat autonomous **Board of Trustees (BoT)**, **Chancellor**, **Vice-Chancellor (VC)**, **Registrar**, ra **Deans** bata sanchalit provincial public university ho. Official contact ko lagi email \`${k.officialEmail}\` wa [Gandaki University Contact Page](${topSource?.url || k.officialContactUrl}) herna sakxau.`
      : `**Gandaki University** is governed by an autonomous **Board of Trustees (BoT)** under the *Gandaki University Act, 2076*, led by the **Chancellor**, **Vice-Chancellor (VC)**, **Registrar**, and **Deans** of its academic schools. You can reach the university administration at \`${k.officialEmail}\` or via the [Gandaki University Contact Page](${topSource?.url || k.officialContactUrl}).`;
  } else {
    const topSnippets = results.slice(0, 2).map(r => `- **${r.title}** (${r.trustLabel}): ${r.snippet} ([Source](${r.url}))`).join('\n');
    body = isNepali
      ? `**Gandaki University** (${k.location.city}, established ${k.establishedAd} AD / ${k.establishedBs} BS) ko public records anusar:\n\n${topSnippets}`
      : `Based on verified **Gandaki University** public sources:\n\n${topSnippets}`;
  }

  return [...noticesAndWarnings, body].filter(Boolean).join('\n\n');
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
  extractSearchTokens,
  extractPostTitle,
  resolveNoticeSupersession,
  getPostTableColumns,
  VERIFIED_GU_INSTITUTIONAL_KNOWLEDGE,
  isAiIdentityQuery,
  getConfiguredAiIdentity,
  resolveAiIdentityReply,
  classifySocialOrContactQuery,
  buildSocialOrContactReply,
  classifyUniversityPublicIntent,
  filterAndRankUniversityWebResults,
  searchGandakiUniversityPublic,
  synthesizeUniversityPublicReply,
  invalidateGuWebCache
};
