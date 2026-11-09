'use strict';

/**
 * KYANA UNIVERSAL APPLICATION-WIDE RETRIEVAL ENGINE
 *
 * Coordinates existing retrieval functions across all authorized academic sources:
 * - Notices & Announcements (posts with type/category in notice, announcement)
 * - Community & Teacher Posts (posts table)
 * - Assignments (assignments table, deadlines, tasks, questions)
 * - Notes & Uploaded Files (files table, chapters, study materials)
 * - Routines & Examination Schedules (routine table)
 * - Syllabus & Course Catalog (courses from syllabus-data.json, canonical subjects)
 * - Knowledge Resources (university facts, knowledge_resources if present)
 *
 * Design principles:
 * 1. Independent of specific intent regexes (discovers relevant records by query understanding).
 * 2. Weighted query expansion (spelling variants = 1.0; related concepts = 0.65; exact phrase = strongest).
 * 3. Concurrent bounded searches with graceful failure isolation.
 * 4. Strict server-side security & authorization enforcement before returning evidence.
 * 5. Structured evidence contract for seamless LLM & UI consumption.
 */

const {
  searchPosts,
  searchNotices,
  searchAssignments,
  searchAuthorizedNotes,
  extractSearchTokens
} = require('./ai-search-tools');
const { searchNotes } = require('./note-search');
const { parseNepaliDateExpression, matchesDateFilter, normalizeDevanagariDigits } = require('./nepali-dates');
const { explicitSubjects, courses, semesterNumber, subjectAliases } = require('./chat-tools');
const { parseSemesterNumber } = require('./academic-context');

// Exact spelling variants share full weight (1.0)
const EXACT_SPELLING_VARIANTS = new Map([
  ['defense', ['defense', 'defence']],
  ['defence', ['defense', 'defence']],
  ['routine', ['routine', 'timetable', 'schedule']],
  ['timetable', ['routine', 'timetable', 'schedule']],
  ['schedule', ['routine', 'timetable', 'schedule']],
  ['assignment', ['assignment', 'homework', 'task']],
  ['homework', ['assignment', 'homework', 'task']],
  ['task', ['assignment', 'homework', 'task']],
  ['syllabus', ['syllabus', 'curriculum']],
  ['curriculum', ['syllabus', 'curriculum']],
  ['viva', ['viva', 'viva-voce', 'oral']],
  ['marks', ['marks', 'score', 'grades', 'result']],
  ['grades', ['marks', 'score', 'grades', 'result']],
  ['result', ['marks', 'score', 'grades', 'result']]
]);

// Related academic concepts receive reduced weight (~0.65) to preserve precision
const RELATED_CONCEPT_EXPANSIONS = {
  defense: [
    { term: 'viva', weight: 0.70 },
    { term: 'presentation', weight: 0.65 }
  ],
  defence: [
    { term: 'viva', weight: 0.70 },
    { term: 'presentation', weight: 0.65 }
  ],
  viva: [
    { term: 'defense', weight: 0.70 },
    { term: 'defence', weight: 0.70 },
    { term: 'practical', weight: 0.65 },
    { term: 'presentation', weight: 0.65 }
  ],
  proposal: [
    { term: 'synopsis', weight: 0.80 },
    { term: 'presentation', weight: 0.65 },
    { term: 'project', weight: 0.60 }
  ],
  presentation: [
    { term: 'proposal', weight: 0.65 },
    { term: 'defense', weight: 0.65 },
    { term: 'viva', weight: 0.65 }
  ],
  exam: [
    { term: 'routine', weight: 0.75 },
    { term: 'test', weight: 0.70 },
    { term: 'assessment', weight: 0.70 }
  ],
  routine: [
    { term: 'exam', weight: 0.75 },
    { term: 'schedule', weight: 0.80 }
  ],
  class: [
    { term: 'lecture', weight: 0.70 },
    { term: 'resumption', weight: 0.75 }
  ],
  lab: [
    { term: 'practical', weight: 0.80 }
  ]
};

const ROMAN_SEMESTERS = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8
};

const ORDINAL_SEMESTERS = {
  first: 1, second: 2, third: 3, fourth: 4,
  fifth: 5, sixth: 6, seventh: 7, eighth: 8
};

/**
 * Normalizes query text:
 * - Lowercases and trims whitespace
 * - Standardizes Romanized Nepali spelling variations
 * - Normalizes Devanagari digits
 */
function normalizeQueryText(query) {
  if (!query || typeof query !== 'string') return '';
  let text = normalizeDevanagariDigits(query.trim()).toLowerCase();

  // Romanized Nepali phonetic normalization
  text = text
    .replace(/\b(?:kahile|kile)\b/g, 'kaile')
    .replace(/\b(?:bataa|bataw)\b/g, 'bata')
    .replace(/\b(?:voli)\b/g, 'bholi')
    .replace(/\b(?:shuru)\b/g, 'suru')
    .replace(/\b(?:chha|xa)\b/g, 'cha')
    .replace(/\b(?:chhan|xan)\b/g, 'chan')
    .replace(/\b(?:chhaina|xaina)\b/g, 'chaina')
    .replace(/\b(?:hunxa)\b/g, 'huncha')
    .replace(/\b(?:vako|vaeko|bhaeko)\b/g, 'bhako')
    .replace(/\b(?:vayo)\b/g, 'bhayo')
    .replace(/\b(?:bida|chutti)\b/g, 'holiday')
    .replace(/\b(?:kaksha|padhai)\b/g, 'class')
    .replace(/\b(?:bujaune|bujhaune)\b/g, 'submit')
    .replace(/\b(?:defence)\b/g, 'defense');

  return text;
}

/**
 * Extracts entities (semester, subject, roles, dates, keywords) from user query.
 */
function extractQueryEntities(rawQuery, academicContext = {}) {
  const norm = normalizeQueryText(rawQuery);
  const rawTokens = extractSearchTokens(rawQuery);

  // 1. Detect semester (explicit in query vs context)
  let extractedSem = null;
  const semNumMatch = norm.match(/\b(?:semester|sem)\s*([1-8])\b/) || norm.match(/\b([1-8])(?:st|nd|rd|th)?\s*(?:semester|sem)\b/);
  if (semNumMatch) {
    extractedSem = Number(semNumMatch[1]);
  } else {
    for (const [word, num] of Object.entries(ORDINAL_SEMESTERS)) {
      if (new RegExp(`\\b${word}\\s+(?:semester|sem)\\b`).test(norm)) {
        extractedSem = num;
        break;
      }
    }
    if (!extractedSem) {
      for (const [rom, num] of Object.entries(ROMAN_SEMESTERS)) {
        if (new RegExp(`\\b(?:semester|sem)\\s+${rom}\\b`).test(norm)) {
          extractedSem = num;
          break;
        }
      }
    }
  }

  const effectiveSemester = extractedSem || parseSemesterNumber(
    academicContext?.cohort?.currentSemester || academicContext?.currentSemester || academicContext?.semester
  );

  // 2. Detect subject
  let extractedSubject = null;
  const detectedSubjects = explicitSubjects(rawQuery);
  if (detectedSubjects.length > 0) {
    extractedSubject = detectedSubjects[0];
  } else {
    // Check syllabus course codes or titles
    for (const c of courses) {
      const code = c.code ? c.code.toLowerCase() : '';
      const title = c.title ? c.title.toLowerCase() : '';
      if (code && new RegExp(`\\b${code}\\b`, 'i').test(norm)) {
        extractedSubject = c.title;
        break;
      }
      if (title && norm.includes(title)) {
        extractedSubject = c.title;
        break;
      }
    }
  }

  // 3. Detect roles & author names
  const roles = [];
  if (/\b(?:sir|mam|ma'?am|teacher|professor|instructor|शिक्षक|सर|म्याम)\b/i.test(rawQuery)) {
    roles.push('teacher');
  }
  if (/\b(?:admin|administration|college|university|कार्यालय)\b/i.test(rawQuery)) {
    roles.push('admin');
  }
  if (/\b(?:cr|class\s+representative)\b/i.test(rawQuery)) {
    roles.push('cr');
  }
  if (/\b(?:student|sathi)\b/i.test(rawQuery)) {
    roles.push('student');
  }

  // Detect specific author names (e.g. "newton", "saugat")
  const authorNames = [];
  if (/\bnewton\b/i.test(rawQuery)) authorNames.push('newton');
  if (/\bsaugat\b/i.test(rawQuery)) authorNames.push('saugat');

  // 4. Detect dates
  const dateInfo = parseNepaliDateExpression(rawQuery);

  // 5. Query scope signals
  const isAllSemesters = Boolean(
    /\b(?:all\s+(?:available\s+|published\s+|bit\s+|8\s+|eight\s+)?(?:semesters?|notes?|notices?|posts?|assignments?)|across\s+(?:all\s+)?semesters?|every\s+semester|sabai\s+semester)\b|सबै\s*सेमेस्टर/i.test(norm)
  );
  const isCrossSemester = Boolean(
    extractedSem && academicContext?.semester && extractedSem !== parseSemesterNumber(academicContext.semester)
  );
  const isSubmissionInquiry = /\b(?:submit|submission|deadline|due|homework|assignment|unsubmitted)\b/i.test(norm);
  const isRoutineInquiry = /\b(?:routine|timetable|exam\s+date|schedule|when\s+is\s+(?:the\s+)?exam|pariksha)\b/i.test(norm);
  const isTeacherPostInquiry = roles.includes('teacher') || authorNames.includes('newton');

  return {
    rawQuery,
    normalizedQuery: norm,
    rawTokens,
    extractedSemester: extractedSem,
    effectiveSemester,
    subject: extractedSubject,
    roles,
    authorNames,
    dateInfo,
    isAllSemesters,
    isCrossSemester,
    isSubmissionInquiry,
    isRoutineInquiry,
    isTeacherPostInquiry
  };
}

/**
 * Expands query tokens into weighted terms.
 * Exact terms and spelling variants have weight 1.0.
 * Related concepts receive weight ~0.65.
 */
function expandWeightedTerms(rawTokens) {
  const termMap = new Map();

  for (const token of rawTokens) {
    const t = token.toLowerCase();
    // 1. Add exact term with weight 1.0
    if (!termMap.has(t)) {
      termMap.set(t, { term: t, weight: 1.0, isExactVariant: true });
    }

    // 2. Add spelling variants with weight 1.0
    const variants = EXACT_SPELLING_VARIANTS.get(t);
    if (variants) {
      for (const v of variants) {
        if (!termMap.has(v) || termMap.get(v).weight < 1.0) {
          termMap.set(v, { term: v, weight: 1.0, isExactVariant: true });
        }
      }
    }

    // 3. Add related academic concepts with reduced weight
    const related = RELATED_CONCEPT_EXPANSIONS[t];
    if (related) {
      for (const { term: relTerm, weight } of related) {
        if (!termMap.has(relTerm)) {
          termMap.set(relTerm, { term: relTerm, weight, isExactVariant: false });
        }
      }
    }
  }

  return [...termMap.values()];
}

/**
 * Executes a single retrieval source with a hard timeout and error boundary.
 */
async function runBoundedSourceSearch(sourceName, searchFn, timeoutMs = 8000) {
  const startTime = Date.now();
  try {
    const result = await Promise.race([
      searchFn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Source '${sourceName}' timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
    const durationMs = Date.now() - startTime;
    return {
      sourceName,
      status: 'fulfilled',
      records: Array.isArray(result) ? result : [],
      durationMs
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    return {
      sourceName,
      status: 'rejected',
      records: [],
      error: err.message,
      durationMs
    };
  }
}

/**
 * Performs concurrent bounded queries across all authorized academic sources.
 */
async function fetchFromSources(db, academicContext, queryInfo, options = {}) {
  const {
    normalizedQuery,
    rawQuery,
    extractedSemester,
    effectiveSemester,
    subject,
    dateInfo,
    isAllSemesters,
    isTeacherPostInquiry
  } = queryInfo;

  const explicitSem = options.semester ? parseSemesterNumber(options.semester) : extractedSemester;
  const limitPerSource = Math.max(1, Math.min(Number(options.limitPerSource) || 8, 20));

  const sourceTasks = [];

  // Source 1: Notices & Announcements
  sourceTasks.push(
    runBoundedSourceSearch('notices', async () => {
      return searchNotices(db, academicContext, {
        query: rawQuery,
        semester: explicitSem,
        dateInfo,
        limit: limitPerSource,
        includeOfficialUniversityNotices: true
      });
    })
  );

  // Source 2: General & Teacher Community Posts
  sourceTasks.push(
    runBoundedSourceSearch('posts', async () => {
      // If query is specifically about teacher posts, search without forcing notice type
      const postResults = await searchPosts(db, academicContext, {
        query: rawQuery,
        semester: explicitSem,
        dateInfo: dateInfo && !dateInfo.unresolvable ? dateInfo : null,
        limit: limitPerSource
      });
      // If dateInfo was relative (e.g. hijo) and returned 0, fallback to recent teacher posts
      if (postResults.length === 0 && isTeacherPostInquiry && dateInfo) {
        return searchPosts(db, academicContext, {
          query: rawQuery.replace(/\b(?:hijo|yesterday|aaja|today)\b/gi, '').trim() || 'teacher post',
          semester: explicitSem,
          limit: limitPerSource
        });
      }
      return postResults;
    })
  );

  // Source 3: Assignments & Coursework
  sourceTasks.push(
    runBoundedSourceSearch('assignments', async () => {
      return searchAssignments(db, academicContext, {
        query: rawQuery,
        subject,
        semester: effectiveSemester,
        searchAllSemesters: isAllSemesters,
        dateInfo,
        limit: limitPerSource
      });
    })
  );

  // Source 4: Notes & Study Materials
  sourceTasks.push(
    runBoundedSourceSearch('notes', async () => {
      return searchAuthorizedNotes(db, academicContext, {
        query: rawQuery,
        subject,
        semester: effectiveSemester,
        searchAllSemesters: isAllSemesters,
        limit: limitPerSource
      });
    })
  );

  // Source 5: Uploaded Files (Direct DB search in files table)
  sourceTasks.push(
    runBoundedSourceSearch('files', async () => {
      if (!db || typeof db.all !== 'function') return [];
      const where = [];
      const params = [];

      // Authorization guard
      if (!academicContext?.authenticated) {
        where.push("COALESCE(audience_scope, 'all_students') = 'all_students'");
      } else if (academicContext.role === 'student' && effectiveSemester && !isAllSemesters) {
        where.push("(semester_no = ? OR semester = ? OR audience_scope = 'all_students' OR semester_no IS NULL)");
        params.push(effectiveSemester, String(effectiveSemester));
      }

      // Keyword matching on originalName, title, chapter, subject
      const tokens = extractSearchTokens(rawQuery).filter(t => t.length >= 2);
      if (tokens.length > 0) {
        const tokenClauses = tokens.map(() =>
          "(LOWER(COALESCE(title, '')) LIKE ? OR LOWER(COALESCE(originalname, '')) LIKE ? OR LOWER(COALESCE(subject, '')) LIKE ? OR LOWER(COALESCE(chapter, '')) LIKE ?)"
        );
        where.push(`(${tokenClauses.join(' OR ')})`);
        for (const t of tokens) {
          const p = `%${t}%`;
          params.push(p, p, p, p);
        }
      }

      const sql = `
        SELECT id, title, originalname, storedname, subject, chapter, semester_no, semester, uploadedat, uploadedby
        FROM files
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY uploadedat DESC NULLS LAST, id DESC
        LIMIT ?
      `;
      params.push(limitPerSource);

      const rows = await db.all(sql, ...params);
      return (rows || []).map(r => ({
        id: r.id,
        title: r.title || r.originalname,
        originalName: r.originalname,
        subject: r.subject || null,
        chapter: r.chapter || null,
        semester: r.semester || (r.semester_no ? `Semester ${r.semester_no}` : null),
        semesterNo: r.semester_no || null,
        uploadedAt: r.uploadedat,
        resourceType: 'file',
        resourceCard: {
          type: 'note',
          id: r.id,
          title: r.title || r.originalname,
          subject: r.subject,
          semester: r.semester || (r.semester_no ? `Semester ${r.semester_no}` : null),
          action: 'open_note',
          deepLink: `/material/${r.id}`,
          viewUrl: `/api/files/${r.id}/view`,
          downloadUrl: `/api/files/${r.id}/download`,
          mobileRoute: `/material/${r.id}`,
          mobileParams: { id: r.id }
        }
      }));
    })
  );

  // Source 6: Routine & Examination Schedules
  sourceTasks.push(
    runBoundedSourceSearch('routine', async () => {
      if (!db || typeof db.all !== 'function') return [];
      const where = [];
      const params = [];

      // Routine authorization: student can strictly access their own semester routine
      if (effectiveSemester) {
        where.push('semester = ?');
        params.push(effectiveSemester);
      } else if (academicContext?.role === 'student' && academicContext.semester) {
        where.push('semester = ?');
        params.push(academicContext.semester);
      }

      if (subject) {
        const aliases = subjectAliases(subject).map(s => s.toLowerCase());
        where.push(`LOWER(TRIM(subject_name)) IN (${aliases.map(() => '?').join(',')})`);
        params.push(...aliases);
      }

      const sql = `
        SELECT id, semester, subject_name, subject_code, exam_date, calendar, exam_time, room, weekday, exam_type
        FROM routine
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY calendar ASC, exam_date ASC, id ASC
        LIMIT ?
      `;
      params.push(limitPerSource);

      const rows = await db.all(sql, ...params);
      return (rows || []).map(r => ({
        id: r.id,
        title: `${r.subject_name} (${r.subject_code || ''}) - ${r.exam_type || 'Exam'}`,
        subject: r.subject_name,
        subjectCode: r.subject_code,
        examDate: r.exam_date,
        calendar: r.calendar || 'BS',
        examTime: r.exam_time,
        room: r.room,
        weekday: r.weekday,
        examType: r.exam_type,
        semester: `Semester ${r.semester}`,
        semesterNo: Number(r.semester),
        resourceType: 'routine',
        resourceCard: {
          type: 'routine',
          id: r.id,
          title: `${r.subject_name} Exam`,
          subject: r.subject_name,
          examDate: r.exam_date,
          calendar: r.calendar || 'BS',
          room: r.room,
          examTime: r.exam_time,
          semester: `Semester ${r.semester}`,
          action: 'view_routine',
          deepLink: '/routine',
          mobileRoute: '/routine',
          mobileParams: { semester: r.semester }
        }
      }));
    })
  );

  // Source 7: Syllabus & Course Objectives
  sourceTasks.push(
    runBoundedSourceSearch('syllabus', async () => {
      const tokens = extractSearchTokens(rawQuery).filter(t => t.length >= 2);
      if (tokens.length === 0 && !subject) return [];

      const filtered = courses.filter(c => {
        const semNo = semesterNumber(c.semester);
        if (effectiveSemester && semNo && semNo !== effectiveSemester && !isAllSemesters) {
          return false;
        }
        if (subject) {
          return c.title?.toLowerCase() === subject.toLowerCase();
        }
        const text = `${c.title || ''} ${c.code || ''} ${c.objectives || ''} ${c.contents || ''}`.toLowerCase();
        return tokens.some(t => text.includes(t));
      });

      return filtered.slice(0, limitPerSource).map(c => ({
        id: c.code || c.title,
        title: `${c.title} (${c.code || ''}) Syllabus`,
        code: c.code,
        subject: c.title,
        credit: c.credit,
        nature: c.nature,
        semester: c.semester ? `Semester ${c.semester}` : null,
        semesterNo: semesterNumber(c.semester),
        objectives: c.objectives,
        contents: c.contents,
        resourceType: 'syllabus',
        resourceCard: {
          type: 'syllabus',
          id: c.code || c.title,
          title: `${c.title} Syllabus`,
          subject: c.title,
          code: c.code,
          credit: c.credit,
          semester: c.semester ? `Semester ${c.semester}` : null,
          action: 'view_syllabus',
          deepLink: '/syllabus',
          mobileRoute: '/syllabus',
          mobileParams: { code: c.code }
        }
      }));
    })
  );

  const outcomes = await Promise.allSettled(sourceTasks);

  const sourcesSearched = [];
  const sourcesSucceeded = [];
  const sourcesFailed = [];
  const allRawRecords = [];
  const perSourceLatency = {};

  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') {
      const res = outcome.value;
      sourcesSearched.push(res.sourceName);
      perSourceLatency[res.sourceName] = res.durationMs;
      if (res.status === 'fulfilled') {
        sourcesSucceeded.push(res.sourceName);
        for (const item of res.records) {
          allRawRecords.push({ ...item, _discoveredSource: res.sourceName });
        }
      } else {
        sourcesFailed.push(res.sourceName);
      }
    }
  }

  return {
    rawRecords: allRawRecords,
    sourcesSearched,
    sourcesSucceeded,
    sourcesFailed,
    perSourceLatency
  };
}

/**
 * Calculates unified relevance score for a record across all sources.
 *
 * Scoring model:
 * 1. Exact phrase match: massive boost (+120 for title, +60 for content).
 * 2. Exact token matches: +25 for title, +10 for content.
 * 3. Related concepts: multiplied by concept weight (e.g. viva when query is defense gets ~16).
 * 4. Author authority: Admin (+20), Teacher (+15), CR (+8).
 * 5. Semester match: +15 for enrolled semester, +10 for all semesters.
 * 6. Controlled recency: up to +15 for records from the last 7 days.
 *    (Crucial: Unrelated recent posts (+15) CANNOT outrank an older relevant notice (+100+)).
 */
function scoreUniversalEvidence(record, queryInfo, weightedTerms) {
  const normQuery = queryInfo.normalizedQuery;
  const userSem = queryInfo.effectiveSemester;

  const title = String(record.title || record.originalName || '').toLowerCase().replace(/(\d+)/g, ' $1 ');
  const subject = String(record.subject || '').toLowerCase();
  const chapter = String(record.chapter || '').toLowerCase().replace(/(\d+)/g, ' $1 ');
  const content = String(record.content || record.description || record.contents || record.objectives || '').toLowerCase();
  const authorName = String(record.authorName || record.author_name || record.teacherName || '').toLowerCase();
  const fullText = `${title} ${subject} ${chapter} ${content} ${authorName}`.toLowerCase();

  let score = 0;
  let hasExactPhrase = false;

  // 1. Exact phrase match
  // Check full query phrase
  if (normQuery.length >= 4) {
    if (title.includes(normQuery)) {
      score += 120;
      hasExactPhrase = true;
    } else if (chapter.includes(normQuery) || subject.includes(normQuery)) {
      score += 80;
      hasExactPhrase = true;
    } else if (content.includes(normQuery)) {
      score += 60;
      hasExactPhrase = true;
    }
  }

  // Check multi-word entities (e.g. "project defense", "web technology")
  const keyPhrases = ['project defense', 'class resumption', 'mid term', 'pre board', 'final exam', 'web technology'];
  for (const kp of keyPhrases) {
    if (normQuery.includes(kp)) {
      if (title.includes(kp)) {
        score += 100;
        hasExactPhrase = true;
      } else if (subject.includes(kp) || chapter.includes(kp)) {
        score += 70;
        hasExactPhrase = true;
      } else if (content.includes(kp)) {
        score += 50;
        hasExactPhrase = true;
      }
    }
  }

  // 2. Weighted token matches
  for (const { term, weight, isExactVariant } of weightedTerms) {
    if (term.length < 2 && !/^\d+$/.test(term)) continue;
    let termHits = 0;
    if (title.includes(term)) {
      termHits += 25 * weight;
    }
    if (chapter.includes(term)) {
      termHits += 20 * weight;
    }
    if (subject.includes(term)) {
      termHits += 20 * weight;
    }
    if (content.includes(term)) {
      termHits += 10 * weight;
    }
    if (authorName.includes(term)) {
      termHits += 20 * weight;
    }
    score += termHits;
  }

  // 3. Author authority tier
  const role = String(record.authorRole || record.author_role || '').toLowerCase();
  if (role === 'admin') score += 20;
  else if (role === 'teacher') score += 15;
  else if (role === 'cr') score += 8;
  else if (record.resourceType === 'notice' || record.isOfficialNotice) score += 15;

  // Superseded notices receive a significant penalty so newer official notices rank first
  if (record.superseded) {
    score -= 40;
  }

  // 4. Semester relevance
  const recSemNo = record.semesterNo || parseSemesterNumber(record.semester);
  if (userSem && recSemNo === userSem) {
    score += 15;
  } else if (record.targetAllSemesters || record.isAllSemesters) {
    score += 10;
  }

  // 5. Controlled freshness / recency decay
  const rawDate = record.createdAt || record.created_at || record.publishedDate || record.uploadedAt;
  if (rawDate) {
    try {
      const recTime = new Date(rawDate).getTime();
      const now = Date.now();
      const ageDays = (now - recTime) / (1000 * 60 * 60 * 24);
      if (ageDays >= 0 && ageDays <= 7) {
        // Linear scale from +15 down to +2 over 7 days
        score += Math.max(2, Math.round(15 - (ageDays * 1.8)));
      } else if (ageDays > 7 && ageDays <= 30) {
        score += 2;
      }
    } catch (_) {}
  }

  return {
    score: Math.round(score),
    hasExactPhrase
  };
}

/**
 * Deduplicates records and merges richer representations.
 */
function deduplicateRecords(records) {
  const byKey = new Map();

  for (const r of records) {
    const rawType = String(r.resourceType || r.type || 'unknown').toLowerCase();
    const id = r.id;
    let universalKey = `${rawType}:${id}`;
    if (rawType === 'post' || rawType === 'notice') {
      universalKey = `post:${id}`;
    } else if (rawType === 'note' || rawType === 'file') {
      universalKey = `file:${id}`;
    }

    if (!byKey.has(universalKey)) {
      byKey.set(universalKey, r);
    } else {
      const existing = byKey.get(universalKey);
      // If one is official notice and the other is a generic post, keep the official notice
      if (r.isOfficialNotice || rawType === 'notice') {
        byKey.set(universalKey, { ...existing, ...r });
      } else if (rawType === 'note' && existing.resourceType === 'file') {
        byKey.set(universalKey, { ...existing, ...r, resourceType: 'note' });
      } else if ((r.relevanceScore || 0) > (existing.relevanceScore || 0)) {
        byKey.set(universalKey, r);
      }
    }
  }

  return [...byKey.values()];
}

/**
 * Enforces server-side security, student privacy, and teacher permission boundaries.
 * Must run before any evidence reaches the LLM or chat caller.
 */
function enforceSecurityAuthorization(records, academicContext) {
  if (!academicContext) return [];

  const isAuthenticated = Boolean(academicContext.authenticated);
  const userRole = String(academicContext.role || 'guest').toLowerCase();
  const callerStudentId = academicContext.studentId || null;
  const callerSemesterNo = parseSemesterNumber(academicContext.semester || academicContext.cohort?.currentSemester);

  return records.filter(r => {
    const resType = String(r.resourceType || r.type || '').toLowerCase();

    // RULE 1: Never leak unpublished examination marks or draft summaries
    if (r.status && ['draft', 'unpublished', 'hidden'].includes(String(r.status).toLowerCase())) {
      return false;
    }
    if (r.released === false) {
      return false;
    }

    // RULE 2: Teacher permission boundaries
    if (userRole === 'teacher') {
      const assignedSemesters = Array.isArray(academicContext.assignedSemesters)
        ? academicContext.assignedSemesters.map(parseSemesterNumber)
        : [];
      const assignedSubjects = Array.isArray(academicContext.assignedSubjects)
        ? academicContext.assignedSubjects.map(s => String(s).toLowerCase().trim())
        : [];

      // If record specifies a semester and teacher has assigned semesters:
      const recSem = r.semesterNo || parseSemesterNumber(r.semester);
      if (recSem && assignedSemesters.length > 0 && !assignedSemesters.includes(recSem) && !r.targetAllSemesters) {
        // Teacher cannot access materials outside assigned semesters unless all_semesters post
        return false;
      }
      // If record specifies a subject and teacher has assigned subjects:
      if (r.subject && assignedSubjects.length > 0) {
        const subNorm = String(r.subject).toLowerCase().trim();
        if (!assignedSubjects.some(as => subNorm.includes(as) || as.includes(subNorm))) {
          // If it's a private assignment or material, restrict to assigned subject
          if (resType === 'assignment' || resType === 'note') {
            return false;
          }
        }
      }
      return true;
    }

    // RULE 3: Student permission boundaries
    if (userRole === 'student') {
      // Personal submission privacy: never expose another student's submission
      if (r.studentSubmission && r.studentSubmission.studentId && r.studentSubmission.studentId !== callerStudentId) {
        return false;
      }

      // Routine isolation: student can only view routine for their authorized semester
      if (resType === 'routine' && callerSemesterNo && r.semesterNo && r.semesterNo !== callerSemesterNo) {
        return false;
      }

      // Audience scope: private or cohort-restricted items must match student's cohort
      const audScope = String(r.audience_scope || r.audienceScope || 'all_students').toLowerCase();
      if (audScope === 'private' && r.userId !== callerStudentId && r.uploadedby !== callerStudentId) {
        return false;
      }

      return true;
    }

    // RULE 4: Unauthenticated / Guest access
    if (!isAuthenticated) {
      // Guests only see public announcements, curriculum, and public posts
      if (['routine', 'assignment'].includes(resType)) {
        return false;
      }
      const audScope = String(r.audience_scope || r.audienceScope || 'all_students').toLowerCase();
      if (audScope !== 'all_students' && audScope !== 'public') {
        return false;
      }
      return true;
    }

    return true;
  });
}

/**
 * Standardizes each evidence record into a consistent contract.
 */
function formatEvidenceRecord(raw) {
  const resType = String(raw.resourceType || raw.type || 'post').toLowerCase();
  const id = raw.id;

  let navigationUrl = raw.deepLink || raw.originalReference || null;
  if (!navigationUrl) {
    if (resType === 'notice') navigationUrl = `/notice/${id}`;
    else if (resType === 'post') navigationUrl = `/post/${id}`;
    else if (resType === 'assignment') navigationUrl = `/assignments/${id}`;
    else if (resType === 'note' || resType === 'file') navigationUrl = `/material/${id}`;
    else if (resType === 'routine') navigationUrl = '/routine';
    else if (resType === 'syllabus') navigationUrl = '/syllabus';
  }

  const title = raw.title || raw.subject || raw.originalName || 'Untitled Record';
  const content = raw.content || raw.description || raw.fullDescription || raw.excerpt || raw.contents || raw.objectives || '';
  const authorName = raw.authorName || raw.author_name || raw.teacherName || null;
  const authorRole = raw.authorRole || raw.author_role || null;
  const publishedAt = raw.createdAt || raw.created_at || raw.publishedDate || raw.uploadedAt || null;

  return {
    source: resType,
    id,
    title,
    content: typeof content === 'string' ? content.trim() : '',
    excerpt: raw.excerpt || (typeof content === 'string' ? content.slice(0, 180) : ''),
    authorName,
    authorRole,
    authority: raw.authority || (authorRole === 'teacher' ? 'Faculty/Teacher' : authorRole === 'admin' ? 'Administration' : 'Community'),
    publishedAt,
    date: raw.examDate || raw.deadline || (publishedAt ? String(publishedAt).slice(0, 10) : null),
    subject: raw.subject || null,
    semester: raw.semester || (raw.semesterNo ? `Semester ${raw.semesterNo}` : null),
    semesterNo: raw.semesterNo || null,
    relevanceScore: raw.relevanceScore || 0,
    isExactMatch: Boolean(raw.isExactMatch),
    navigationUrl,
    resourceCard: raw.resourceCard || null
  };
}

/**
 * Universal Search Entry Point.
 *
 * @param {object} db - Database client (PostgreSQL / Neon)
 * @param {object} academicContext - Authenticated user context
 * @param {object} options
 * @param {string} options.query - Search query string
 * @param {number} [options.semester] - Optional semester filter
 * @param {string} [options.subject] - Optional subject filter
 * @param {Date} [options.referenceDate] - Temporal anchor
 * @param {number} [options.limit] - Max overall results to return (default 10)
 * @returns {Promise<{ results: Array, metadata: object }>}
 */
async function universalSearch(db, academicContext, options = {}) {
  const startTime = Date.now();
  const rawQuery = String(options.query || '').trim();
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 30));

  if (!rawQuery) {
    return {
      results: [],
      metadata: {
        query: '',
        normalizedQuery: '',
        extractedEntities: {},
        sourcesSearched: [],
        sourcesSucceeded: [],
        sourcesFailed: [],
        totalRecordsFound: 0,
        isComplete: true,
        latencyMs: 0,
        perSourceLatency: {}
      }
    };
  }

  // 1. Analyze query & extract entities
  const queryInfo = extractQueryEntities(rawQuery, academicContext);
  if (options.semester) {
    queryInfo.effectiveSemester = parseSemesterNumber(options.semester);
  }
  if (options.subject) {
    queryInfo.subject = options.subject;
  }

  // 2. Expand terms with weights
  const weightedTerms = expandWeightedTerms(queryInfo.rawTokens);

  // 3. Concurrent source search
  const {
    rawRecords,
    sourcesSearched,
    sourcesSucceeded,
    sourcesFailed,
    perSourceLatency
  } = await fetchFromSources(db, academicContext, queryInfo, options);

  // 4. Score each record
  const scoredRecords = rawRecords.map(record => {
    const { score, hasExactPhrase } = scoreUniversalEvidence(record, queryInfo, weightedTerms);
    return {
      ...record,
      relevanceScore: score,
      isExactMatch: hasExactPhrase
    };
  });

  // 5. Deduplicate
  const deduplicated = deduplicateRecords(scoredRecords);

  // 6. Enforce server-side security & authorization boundaries
  const authorized = enforceSecurityAuthorization(deduplicated, academicContext);

  // 7. Sort by relevance:
  //    - Exact matches first
  //    - Score descending
  //    - Recency / Creation date descending for equal score
  authorized.sort((a, b) => {
    if (a.isExactMatch !== b.isExactMatch) {
      return a.isExactMatch ? -1 : 1;
    }
    const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
    if (scoreDiff !== 0) return scoreDiff;

    const dateA = String(a.createdAt || a.created_at || a.publishedAt || a.uploadedAt || '');
    const dateB = String(b.createdAt || b.created_at || b.publishedAt || b.uploadedAt || '');
    return dateB.localeCompare(dateA);
  });

  // 8. Format structured evidence contract (filter zero-relevance noise)
  const relevantRecords = authorized.filter(r => (r.relevanceScore || 0) > 0);
  const finalResults = relevantRecords.slice(0, limit).map(formatEvidenceRecord);
  const totalDurationMs = Date.now() - startTime;

  return {
    results: finalResults,
    metadata: {
      query: rawQuery,
      normalizedQuery: queryInfo.normalizedQuery,
      extractedEntities: {
        semester: queryInfo.effectiveSemester,
        subject: queryInfo.subject,
        roles: queryInfo.roles,
        authorNames: queryInfo.authorNames,
        dateInfo: queryInfo.dateInfo ? { date: queryInfo.dateInfo.date, label: queryInfo.dateInfo.label } : null
      },
      sourcesSearched,
      sourcesSucceeded,
      sourcesFailed,
      totalRecordsFound: finalResults.length,
      isComplete: sourcesFailed.length === 0,
      latencyMs: totalDurationMs,
      perSourceLatency
    }
  };
}

module.exports = {
  universalSearch,
  normalizeQueryText,
  extractQueryEntities,
  expandWeightedTerms,
  scoreUniversalEvidence,
  deduplicateRecords,
  enforceSecurityAuthorization,
  EXACT_SPELLING_VARIANTS,
  RELATED_CONCEPT_EXPANSIONS
};
