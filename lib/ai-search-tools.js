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
async function searchPosts(db, academicContext, { query = '', type = null, dateInfo = null, excludeIds = [], limit = 5 } = {}) {
  const { matchesDateFilter } = require('./nepali-dates');
  const conditions = [];
  const params = [];
  const excludeSet = new Set(
    (Array.isArray(excludeIds) ? excludeIds : [])
      .map(id => Number(String(id).replace(/^(?:post|notice):/i, '')))
      .filter(n => Number.isFinite(n) && n > 0)
  );

  // Type filter
  if (type && ['status', 'assignment', 'notice'].includes(type)) {
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

  // Text search on title + content (strip date tokens when dateInfo is active)
  const DATE_STOP_TOKENS = new Set([
    'aaja', 'today', 'bholi', 'voli', 'tomorrow', 'hijo', 'yesterday', 'parsi', 'asti',
    'hapta', 'week', 'dekhi', 'samma', 'from', 'between', 'until',
    'baisakh', 'jestha', 'asar', 'shrawan', 'bhadra', 'asoj', 'kartik', 'mangsir', 'poush', 'magh', 'falgun', 'chaitra',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'
  ]);
  const rawTokens = extractSearchTokens(query);
  const tokens = dateInfo
    ? rawTokens.filter(t => !DATE_STOP_TOKENS.has(t) && !/^\d{1,4}$/.test(t) && !/^\d{4}-\d{2}-\d{2}$/.test(t))
    : rawTokens;

  if (tokens.length > 0) {
    for (const token of tokens) {
      conditions.push(`(LOWER(COALESCE(p.title, '')) LIKE ? OR LOWER(COALESCE(p.content, '')) LIKE ?)`);
      params.push(`%${token}%`, `%${token}%`);
    }
  }

  const fetchLimit = dateInfo ? Math.max(limit * 6, 30) : limit;
  const sql = `
    SELECT p.id, p.title, p.content, p.type, p.category, p.created_at,
           s.name AS author_name, s.avatarUrl AS author_avatar
    FROM posts p
    JOIN students s ON s.studentId = p.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.created_at DESC
    LIMIT ?
  `;

  try {
    let rows = (await db.all(sql, ...params, fetchLimit)) || [];
    // Non-fragile fallback: if strict AND across 2+ tokens returned 0 rows, fall back to OR matching scored by token overlap
    if (rows.length === 0 && tokens.length > 1) {
      const orClauses = tokens.map(() => `(LOWER(COALESCE(p.title, '')) LIKE ? OR LOWER(COALESCE(p.content, '')) LIKE ?)`);
      const orParams = tokens.flatMap(t => [`%${t}%`, `%${t}%`]);
      const fallbackSql = `
        SELECT p.id, p.title, p.content, p.type, p.category, p.created_at,
               s.name AS author_name, s.avatarUrl AS author_avatar
        FROM posts p
        JOIN students s ON s.studentId = p.user_id
        WHERE ${[...baseConditions, `(${orClauses.join(' OR ')})`].join(' AND ')}
        ORDER BY p.created_at DESC
        LIMIT ?
      `;
      const orRows = (await db.all(fallbackSql, ...baseParams, ...orParams, fetchLimit)) || [];
      rows = orRows
        .map(r => {
          const hay = `${r.title || ''} ${r.content || ''}`.toLowerCase();
          const hitCount = tokens.filter(t => hay.includes(t)).length;
          return { ...r, _hitCount: hitCount };
        })
        .sort((a, b) => b._hitCount - a._hitCount);
    }

    if (dateInfo && !dateInfo.unresolvable && (dateInfo.date || (dateInfo.startDate && dateInfo.endDate))) {
      rows = rows.filter(r => matchesDateFilter(r.created_at || r.createdAt, dateInfo, 'AD'));
    }

    return rows.slice(0, limit).map(row => ({
      id: row.id,
      title: row.title || truncateContent(row.content, 80),
      content: truncateContent(row.content, 200),
      type: row.type,
      category: row.category,
      authorName: row.author_name || row.authorName,
      createdAt: row.created_at || row.createdAt,
      resourceCard: {
        type: row.type === 'notice' ? 'notice' : row.type === 'assignment' ? 'post_assignment' : 'post',
        id: row.id,
        title: row.title || truncateContent(row.content, 60),
        action: row.type === 'notice' ? 'view_notice' : 'view_post',
        deepLink: `/posts/${row.id}`,
        mobileRoute: row.type === 'notice' ? `/notice/${row.id}` : `/post/${row.id}`,
        mobileParams: { id: row.id }
      }
    }));
  } catch (err) {
    console.error('[AI Search] searchPosts error:', err.message);
    return [];
  }
}

/**
 * Searches notices (posts with type='notice') visible to the student.
 * When includeOfficialUniversityNotices is true, also searches verified gu_official records.
 */
async function searchNotices(db, academicContext, { query = '', dateInfo = null, excludeIds = [], limit = 5, includeOfficialUniversityNotices = false } = {}) {
  const campusNotices = await searchPosts(db, academicContext, { query, type: 'notice', dateInfo, excludeIds, limit });
  if (!includeOfficialUniversityNotices || !academicContext?.authenticated) {
    return campusNotices;
  }

  try {
    const guNotices = await searchOfficialUniversityNotices(db, { query, dateInfo, excludeIds, limit });
    return [...guNotices, ...campusNotices].slice(0, Math.max(limit, 6));
  } catch (err) {
    console.error('[AI Search] searchOfficialUniversityNotices error:', err.message);
    return campusNotices;
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
  'submit', 'submitted', 'submitting', 'submission', 'submissions',
  'status', 'grade', 'graded', 'grades', 'grading', 'mark', 'marks',
  'score', 'scores', 'checked', 'check', 'released', 'release',
  'remark', 'remarks', 'feedback', 'question', 'questions', 'problem', 'problems',
  'description', 'descriptions', 'detail', 'details', 'did', 'have', 'has',
  'what', 'which', 'when', 'where', 'who', 'how', 'is', 'are', 'was', 'were', 'do', 'does',
  'my', 'mero', 'maile', 'vayo', 'bhayo', 'gare', 'gareko', 'garyo',
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
      ? `(COALESCE(${prefix}visibility, 'everyone') IN ('everyone', 'public', 'teachers_only', 'teachers-only') AND (${prefix}user_id = ? OR ${prefix}type = 'notice' OR COALESCE(${prefix}category, '') = 'notice' OR NOT EXISTS (SELECT 1 FROM students s_auth WHERE s_auth.studentId = ${prefix}user_id AND s_auth.role = 'teacher')))`
      : '1=1';
    const params = academicContext.role === 'teacher' ? [academicContext.studentId || '__none__'] : [];
    return { sql: visClause, params };
  }

  if (academicContext.role === 'teacher') {
    const authorParam = academicContext.studentId || '__none__';
    const visClause = `COALESCE(${prefix}visibility, 'everyone') IN ('everyone', 'public', 'teachers_only', 'teachers-only')`;
    const peerClause = `(${prefix}type = 'notice' OR COALESCE(${prefix}category, '') = 'notice' OR NOT EXISTS (SELECT 1 FROM students s_auth WHERE s_auth.studentId = ${prefix}user_id AND s_auth.role = 'teacher'))`;
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
