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
const { normalizeSemester, semesterAliases } = require('./note-search');

/**
 * Builds a semester-authorization WHERE clause for the `files` table.
 * Files use legacy `semester` (text) column rather than integer semester_no.
 * Falls back to buildAcademicContentFilter for audience_scope/cohort filtering,
 * plus text-based semester matching for backward-compatible file queries.
 */
function buildFilesSemesterFilter(academicContext, { tableAlias = 'f' } = {}) {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  if (!academicContext || !academicContext.authenticated) {
    return { sql: `${prefix}audience_scope = 'all_students'`, params: [] };
  }

  // Teachers/Admins can see all files
  if (academicContext.role === 'teacher' || academicContext.role === 'admin') {
    return { sql: '1=1', params: [] };
  }

  const cohortId = academicContext.cohort?.id || null;
  const semesterNo = academicContext.cohort?.currentSemester
    || parseSemesterNumber(academicContext.semester)
    || null;

  if (!semesterNo) {
    return { sql: `${prefix}audience_scope = 'all_students'`, params: [] };
  }

  // Files use text semester column — normalize to match all aliases
  const aliases = semesterAliases(semesterNo);
  const semClause = `LOWER(TRIM(${prefix}semester)) IN (${aliases.map(() => '?').join(',')})`;
  const params = [];

  if (cohortId) {
    // Own cohort files matching semester, OR all_students files matching semester
    params.push(cohortId, ...aliases, ...aliases);
    return {
      sql: `((${prefix}cohort_id = ? AND (${semClause} OR ${prefix}semester IS NULL OR TRIM(${prefix}semester) = '')))`
        + ` OR (${prefix}audience_scope = 'all_students' AND (${semClause} OR ${prefix}semester IS NULL OR TRIM(${prefix}semester) = ''))`,
      params
    };
  }

  // No cohort — only global content for their semester
  params.push(...aliases);
  return {
    sql: `(${prefix}audience_scope = 'all_students' AND (${semClause} OR ${prefix}semester IS NULL OR TRIM(${prefix}semester) = ''))`,
    params
  };
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
async function searchPosts(db, academicContext, { query = '', type = null, limit = 5 } = {}) {
  const conditions = [];
  const params = [];

  // Type filter
  if (type && ['status', 'assignment', 'notice'].includes(type)) {
    conditions.push('p.type = ?');
    params.push(type);
  }

  // Semester & cohort authorization
  const authFilter = buildPostSemesterFilter(academicContext, { tableAlias: 'p' });
  conditions.push(`(${authFilter.sql})`);
  params.push(...authFilter.params);

  // Text search on title + content
  const tokens = extractSearchTokens(query);
  if (tokens.length > 0) {
    for (const token of tokens) {
      conditions.push(`(LOWER(COALESCE(p.title, '')) LIKE ? OR LOWER(COALESCE(p.content, '')) LIKE ?)`);
      params.push(`%${token}%`, `%${token}%`);
    }
  }

  const sql = `
    SELECT p.id, p.title, p.content, p.type, p.category, p.created_at,
           s.name AS author_name, s.avatarUrl AS author_avatar
    FROM posts p
    JOIN students s ON s.studentId = p.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.created_at DESC
    LIMIT ?
  `;
  params.push(limit);

  try {
    const rows = await db.all(sql, ...params);
    return rows.map(row => ({
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
 */
async function searchNotices(db, academicContext, { query = '', limit = 5 } = {}) {
  return searchPosts(db, academicContext, { query, type: 'notice', limit });
}

/**
 * Searches assignments visible to the authenticated student.
 * Queries the `assignments` table (coding assignments with deadlines).
 */
async function searchAssignments(db, academicContext, { query = '', limit = 5 } = {}) {
  const conditions = [];
  const params = [];

  // Semester & cohort authorization
  const authFilter = buildAssignmentSemesterFilter(academicContext, { tableAlias: 'a' });
  conditions.push(`(${authFilter.sql})`);
  params.push(...authFilter.params);

  // Text search
  const tokens = extractSearchTokens(query);
  if (tokens.length > 0) {
    for (const token of tokens) {
      conditions.push(`(LOWER(COALESCE(a.title, '')) LIKE ? OR LOWER(COALESCE(a.description, '')) LIKE ? OR LOWER(COALESCE(a.subject, '')) LIKE ?)`);
      params.push(`%${token}%`, `%${token}%`, `%${token}%`);
    }
  }

  const sql = `
    SELECT a.id, a.title, a.description, a.language, a.subject, a.semester, a.deadline,
           a.createdAt, s.name AS teacher_name
    FROM assignments a
    JOIN students s ON s.studentId = a.createdBy
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.deadline DESC NULLS LAST, a.createdAt DESC
    LIMIT ?
  `;
  params.push(limit);

  try {
    const rows = await db.all(sql, ...params);
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      description: truncateContent(row.description, 200),
      language: row.language,
      subject: row.subject,
      deadline: row.deadline,
      teacherName: row.teacher_name || row.teacherName,
      createdAt: row.createdAt,
      resourceCard: {
        type: 'assignment',
        id: row.id,
        title: row.title,
        subject: row.subject,
        action: 'view_assignment',
        deepLink: `/assignments/${row.id}`,
        mobileRoute: `/assignments/${row.id}`,
        mobileParams: { assignmentId: row.id }
      }
    }));
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
    const files = await searchNotes(db, { query, semester, subject });
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
 * Supports both semester_no and legacy semester text aliases.
 */
function buildAssignmentSemesterFilter(academicContext, { tableAlias = 'a' } = {}) {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  if (!academicContext || !academicContext.authenticated) {
    return { sql: `${prefix}audience_scope = 'all_students'`, params: [] };
  }

  if (academicContext.role === 'teacher' || academicContext.role === 'admin') {
    return { sql: '1=1', params: [] };
  }

  const cohortId = academicContext.cohort?.id || null;
  const semesterNo = academicContext.cohort?.currentSemester
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
 * Builds a post-specific semester authorization filter.
 * Posts use post_target_semesters junction table + target_all_semesters flag.
 */
function buildPostSemesterFilter(academicContext, { tableAlias = 'p' } = {}) {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  if (!academicContext || !academicContext.authenticated) {
    return {
      sql: `${prefix}audience_scope = 'all_students' AND ${prefix}target_all_semesters = 1`,
      params: []
    };
  }

  if (academicContext.role === 'teacher' || academicContext.role === 'admin') {
    return { sql: '1=1', params: [] };
  }

  const cohortId = academicContext.cohort?.id || null;
  const semesterNo = academicContext.cohort?.currentSemester
    || parseSemesterNumber(academicContext.semester)
    || null;

  if (!semesterNo && !cohortId) {
    return {
      sql: `${prefix}audience_scope = 'all_students' AND ${prefix}target_all_semesters = 1`,
      params: []
    };
  }

  // A student sees a post if:
  //   1. target_all_semesters = 1 AND (audience_scope='all_students' OR cohort_id = own)
  //   2. target_all_semesters = 0 AND (post_id IN post_target_semesters for their semester OR semester_no = their semester)
  //      AND (audience_scope='all_students' OR cohort_id = own)
  const parts = [];
  const params = [];

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

  return { sql: parts.join(' OR '), params };
}

/**
 * Extracts normalized search tokens from a query string.
 * Strips common filler words.
 */
function extractSearchTokens(query) {
  const STOP = new Set('a an the please find search show give get me my us for of on about in and or not note notes pdf file files document documents lecture semester sem can could would you some any all have got do we is there are available want need'.split(' '));
  return [...new Set(
    String(query || '').slice(0, 400).toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || []
  )].filter(t => !STOP.has(t) && t.length > 1).slice(0, 12);
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
  searchAssignments,
  searchAuthorizedNotes,
  buildPostSemesterFilter,
  buildAssignmentSemesterFilter,
  buildFilesSemesterFilter,
  extractSearchTokens
};
