'use strict';

const { parseSemesterNumber } = require('./academic-context');

const RETRIEVAL_POLICIES = Object.freeze({
  GLOBAL_INFORMATION: 'global_information',
  CURRENT_SEMESTER_LEARNING: 'current_semester_learning',
  EXPLICIT_CROSS_SEMESTER_LEARNING: 'explicit_cross_semester_learning',
  PERSONAL_ACADEMIC_RECORDS: 'personal_academic_records'
});

function semestersFor(context) {
  if (context?.role === 'teacher') {
    if (!Array.isArray(context.assignedSemesters) && !Array.isArray(context.assignedSubjects) && context.canViewAllCohorts) {
      return [1, 2, 3, 4, 5, 6, 7, 8];
    }
    return [...new Set((context.assignedSemesters || []).map(parseSemesterNumber).filter(Boolean))];
  }
  const n = parseSemesterNumber(context?.cohort?.currentSemester || context?.currentSemester || context?.semester);
  return n ? [n] : [];
}

/**
 * Resolves the explicit retrieval policy for a request based on resource type and user intent.
 *
 * Categories:
 * - global_information: posts, notices, announcements, syllabuses, academic directory (cross-semester discoverable)
 * - current_semester_learning: default notes and assignments searches (scoped to student's assigned semester)
 * - explicit_cross_semester_learning: notes or assignments when another semester, another semester's subject, or all semesters are explicitly requested
 * - personal_academic_records: attendance, marks/results, and personal assignment submissions/grades (strictly caller-only)
 */
function resolveRetrievalPolicy(context, {
  resourceType = null,
  type = null,
  intent = null,
  requestedSemester = null,
  requestedSubject = null,
  subjectSemester = null,
  searchAllSemesters = false,
  otherSemesterOnly = false,
  isPersonalRecord = false
} = {}) {
  const userSems = semestersFor(context);
  const userSemester = userSems[0] || null;
  const reqSem = parseSemesterNumber(requestedSemester);
  const subjSem = parseSemesterNumber(subjectSemester);
  const effectiveKind = String(resourceType || type || intent || '').toLowerCase();

  if (
    isPersonalRecord ||
    ['attendance', 'results', 'marks', 'submissions', 'personal_records', 'personal_academic_records'].includes(effectiveKind)
  ) {
    return {
      policy: RETRIEVAL_POLICIES.PERSONAL_ACADEMIC_RECORDS,
      userSemester,
      targetSemesters: reqSem ? [reqSem] : userSems,
      requestedSemester: reqSem,
      searchAllSemesters: false,
      otherSemesterOnly: false,
      allowCrossSemester: false,
      personalOnly: true
    };
  }

  if (
    ['post', 'posts', 'notice', 'notices', 'comment', 'gu_official', 'syllabus', 'academic_directory', 'general_information'].includes(effectiveKind)
  ) {
    const allSems = [1, 2, 3, 4, 5, 6, 7, 8];
    let targetSemesters = allSems;
    if (reqSem) {
      targetSemesters = [reqSem];
    } else if (otherSemesterOnly && userSemester) {
      targetSemesters = allSems.filter(s => s !== userSemester);
    }
    return {
      policy: RETRIEVAL_POLICIES.GLOBAL_INFORMATION,
      userSemester,
      targetSemesters,
      requestedSemester: reqSem,
      searchAllSemesters: !reqSem && !otherSemesterOnly,
      otherSemesterOnly: Boolean(otherSemesterOnly && !reqSem),
      allowCrossSemester: true,
      personalOnly: false
    };
  }

  if (['note', 'notes', 'assignment', 'assignments'].includes(effectiveKind)) {
    if (searchAllSemesters) {
      return {
        policy: RETRIEVAL_POLICIES.EXPLICIT_CROSS_SEMESTER_LEARNING,
        userSemester,
        targetSemesters: [1, 2, 3, 4, 5, 6, 7, 8],
        requestedSemester: null,
        searchAllSemesters: true,
        otherSemesterOnly: false,
        allowCrossSemester: true,
        personalOnly: false
      };
    }

    if (otherSemesterOnly && userSemester) {
      return {
        policy: RETRIEVAL_POLICIES.EXPLICIT_CROSS_SEMESTER_LEARNING,
        userSemester,
        targetSemesters: [1, 2, 3, 4, 5, 6, 7, 8].filter(s => s !== userSemester),
        requestedSemester: null,
        searchAllSemesters: false,
        otherSemesterOnly: true,
        allowCrossSemester: true,
        personalOnly: false
      };
    }

    if (reqSem && (!userSemester || reqSem !== userSemester)) {
      return {
        policy: RETRIEVAL_POLICIES.EXPLICIT_CROSS_SEMESTER_LEARNING,
        userSemester,
        targetSemesters: [reqSem],
        requestedSemester: reqSem,
        searchAllSemesters: false,
        otherSemesterOnly: false,
        allowCrossSemester: true,
        personalOnly: false
      };
    }

    if (!reqSem && subjSem && (!userSemester || subjSem !== userSemester)) {
      return {
        policy: RETRIEVAL_POLICIES.EXPLICIT_CROSS_SEMESTER_LEARNING,
        userSemester,
        targetSemesters: [subjSem],
        requestedSemester: subjSem,
         resolvedFromSubject: requestedSubject || null,
        searchAllSemesters: false,
        otherSemesterOnly: false,
        allowCrossSemester: true,
        personalOnly: false
      };
    }

    return {
      policy: RETRIEVAL_POLICIES.CURRENT_SEMESTER_LEARNING,
      userSemester,
      targetSemesters: reqSem ? [reqSem] : userSems,
      requestedSemester: reqSem || userSemester,
      searchAllSemesters: false,
      otherSemesterOnly: false,
      allowCrossSemester: false,
      personalOnly: false
    };
  }

  return {
    policy: RETRIEVAL_POLICIES.CURRENT_SEMESTER_LEARNING,
    userSemester,
    targetSemesters: reqSem ? [reqSem] : userSems,
    requestedSemester: reqSem || userSemester,
    searchAllSemesters: false,
    otherSemesterOnly: false,
    allowCrossSemester: false,
    personalOnly: false
  };
}

function formatResourceSemester(row) {
  if (!row) return null;
  const targets = (row.targetSemesters || row.target_semesters || [])
    .map(parseSemesterNumber)
    .filter(Boolean);
  const semNo = parseSemesterNumber(row.semester_no ?? row.semesterNo ?? row.semester);
  const rawAll = row.target_all_semesters ?? row.targetAllSemesters;
  const isExplicitAll = Number(rawAll) === 1 && !semNo && targets.length === 0;

  if (targets.length > 0 && targets.length < 8) {
    return `Semester ${targets.join(', ')}`;
  }
  if (semNo) {
    return `Semester ${semNo}`;
  }
  if (isExplicitAll || targets.length === 8) {
    return 'All Semesters';
  }
  if (row.semester && String(row.semester).trim()) {
    return String(row.semester).trim();
  }
  return null;
}

function teacherSubjectAliases(context) {
  if (!Array.isArray(context?.assignedSubjects)) return null;
  let courses = [];
  let subjectAliases = s => [s];
  try {
    const chatTools = require('./chat-tools');
    if (Array.isArray(chatTools.courses)) courses = chatTools.courses;
    if (typeof chatTools.subjectAliases === 'function') subjectAliases = chatTools.subjectAliases;
  } catch (_) {}

  const allowed = new Set();
  for (const entry of context.assignedSubjects) {
    const rawValues = typeof entry === 'string'
      ? [entry]
      : [entry?.code, entry?.name, entry?.title].filter(Boolean);
    for (const val of rawValues) {
      const clean = String(val).trim();
      if (!clean) continue;
      const lower = clean.toLowerCase();
      allowed.add(lower);
      for (const alias of subjectAliases(clean)) {
        if (alias) allowed.add(String(alias).trim().toLowerCase());
      }
      for (const course of courses) {
        if (
          String(course.code || '').trim().toLowerCase() === lower ||
          String(course.title || '').trim().toLowerCase() === lower
        ) {
          if (course.code) allowed.add(String(course.code).trim().toLowerCase());
          if (course.title) {
            allowed.add(String(course.title).trim().toLowerCase());
            for (const alias of subjectAliases(course.title)) {
              if (alias) allowed.add(String(alias).trim().toLowerCase());
            }
          }
        }
      }
    }
  }
  return [...allowed];
}

function canReadResource(context, row, type = 'post', options = {}) {
  if (!context?.authenticated || !row || row.deleted_at || row.hidden_at || ['removed', 'hidden'].includes(row.moderation_status)) return false;
  const isAuthor = Boolean(context.studentId && (
    (row.author_id && row.author_id === context.studentId) ||
    (row.user_id && row.user_id === context.studentId) ||
    (row.uploadedBy && row.uploadedBy === context.studentId) ||
    (row.uploadedby && row.uploadedby === context.studentId) ||
    (row.createdBy && row.createdBy === context.studentId) ||
    (row.createdby && row.createdby === context.studentId)
  ));
  const rawVisibility = String(row.visibility || 'everyone').trim().toLowerCase();
  const isStudentsOnly = ['students_only', 'students-only', 'students'].includes(rawVisibility);

  if (context.role === 'admin') {
    if (['post', 'notice', 'post_assignment'].includes(type) && isStudentsOnly && !context.moderation && !isAuthor) {
      return false;
    }
    return true;
  }
  if (!['student', 'cr', 'teacher'].includes(context.role)) return false;

  const visibility = isStudentsOnly
    ? 'students_only'
    : (['teachers_only', 'teachers-only', 'teachers', 'private'].includes(rawVisibility) ? 'teachers_only'
      : (['cohort_only', 'cohort-only'].includes(rawVisibility) ? 'cohort_only' : (rawVisibility || 'everyone')));
  const allowedVisibility = context.role === 'teacher'
    ? ['everyone', 'public', 'teachers_only']
    : ['everyone', 'public', 'students_only', 'cohort_only'];
  if (!allowedVisibility.includes(visibility) && !isAuthor) return false;

  const cohort = row.cohort_id || row.cohortId;
  const scope = String(row.audience_scope || row.audienceScope || '').trim().toLowerCase();
  const isCohortRestricted = visibility === 'cohort_only' || ['cohort_only', 'cohort-only', 'private'].includes(scope);
  const studentCohortId = context.cohort?.id || context.cohortId || null;

  if (context.role !== 'teacher' && isCohortRestricted && (!cohort || cohort !== studentCohortId) && !isAuthor) {
    return false;
  }

  const sems = semestersFor(context);
  const targets = (row.targetSemesters || row.target_semesters || []).map(parseSemesterNumber).filter(Boolean);
  const sem = parseSemesterNumber(row.semester_no ?? row.semesterNo ?? row.semester);

  if (type === 'post' || type === 'notice' || type === 'post_assignment') {
    const authorRole = String(row.author_role || row.role || '').trim().toLowerCase();
    const isNoticeOrAnnouncement = (
      type === 'notice' ||
      ['notice', 'announcement'].includes(String(row.type || '').trim().toLowerCase()) ||
      ['notice', 'announcement'].includes(String(row.category || '').trim().toLowerCase()) ||
      Number(row.is_notice) === 1 ||
      Boolean(row.isNotice)
    ) && ['admin', 'teacher', 'cr'].includes(authorRole);

    if (context.role === 'teacher' && !isAuthor) {
      if (authorRole === 'teacher' && !isNoticeOrAnnouncement) {
        return false;
      }
      if (Number(row.target_all_semesters ?? row.targetAllSemesters) === 1) return true;
      if (isNoticeOrAnnouncement && ['admin', 'cr', 'teacher'].includes(authorRole) && !Array.isArray(context.assignedSemesters)) {
        return true;
      }
      return (targets.length ? targets : [sem]).some(n => sems.includes(n));
    }

    if (isAuthor) return true;

    // General academic information (posts, notices, announcements):
    // Accessible across all semesters to students/CRs when visible under post visibility rules.
    if (options.enforceStudentSemester === true) {
      if (Number(row.target_all_semesters ?? row.targetAllSemesters) === 1) return true;
      return (targets.length ? targets : [sem]).some(n => sems.includes(n));
    }
    return true;
  }

  if (context.role === 'teacher') {
    const semAllowed = isAuthor || (sem ? sems.includes(sem) : scope === 'all_students');
    if (!semAllowed) return false;
    if ((type === 'note' || type === 'assignment') && !isAuthor) {
      const allowedSubjects = teacherSubjectAliases(context);
      if (allowedSubjects !== null) {
        if (!allowedSubjects.length) return false;
        const rowSubject = String(row.subject || '').trim().toLowerCase();
        if (!rowSubject || !allowedSubjects.includes(rowSubject)) return false;
      }
    }
    return true;
  }

  // Student / CR access for notes, assignments, and routines:
  if (isAuthor) return true;

  if (type === 'routine') {
    if (options.allowCrossSemester) return true;
    return sem ? sems.includes(sem) : true;
  }

  // Same-semester note or assignment: enforce cohort isolation when scoped to a specific cohort in the same semester
  const isOwnSemester = !sem || sems.includes(sem);
  if (isOwnSemester) {
    if (scope !== 'all_students' && cohort && studentCohortId && cohort !== studentCohortId) {
      return false;
    }
    return true;
  }

  // Cross-semester note or assignment: allowed unless policy explicitly restricts to current_semester_learning
  if (options.policy === RETRIEVAL_POLICIES.CURRENT_SEMESTER_LEARNING || options.allowCrossSemester === false) {
    return false;
  }

  return true;
}

// SQL predicates use LIVE source tables before retrieving text or passages.
// Placeholders are adapted to PostgreSQL by the caller/standard DB adapter.
function resourceFilter(context, type, alias, options = {}) {
  if (!/^[a-z0-9_]+$/.test(alias)) throw new Error('Invalid SQL alias');
  if (!context?.authenticated || !['admin', 'teacher', 'student', 'cr'].includes(context.role)) return { sql: '1=0', params: [] };
  const p = `${alias}.`;
  const post = ['post', 'notice'].includes(type);

  if (context.role === 'admin') {
    if (post && !context.moderation) {
      const authorParam = context.studentId || '__none__';
      return {
        sql: `(COALESCE(${p}visibility, 'everyone') NOT IN ('students_only', 'students-only', 'students') OR ${p}user_id = ?)`,
        params: [authorParam]
      };
    }
    return { sql: '1=1', params: [] };
  }

  const params = [];
  const clauses = [];
  const sems = semestersFor(context);
  const placeholders = sems.map(() => '?').join(',');

  if (post) {
    const authorParam = context.studentId || '__none__';
    if (context.role === 'teacher') {
      const visClause = `COALESCE(${p}visibility, 'everyone') IN ('everyone', 'public', 'teachers_only', 'teachers-only')`;
      const teacherPeerClause = `(LOWER(TRIM(COALESCE(${p}type, ''))) IN ('notice', 'announcement') OR LOWER(TRIM(COALESCE(${p}category, ''))) IN ('notice', 'announcement') OR NOT EXISTS (SELECT 1 FROM students s_auth WHERE s_auth.studentId = ${p}user_id AND s_auth.role = 'teacher'))`;
      const semClause = `(${p}target_all_semesters = 1${sems.length ? ` OR (${p}target_all_semesters = 0 AND (EXISTS (SELECT 1 FROM post_target_semesters pts WHERE pts.post_id = ${p}id AND pts.semester IN (${placeholders})) OR (NOT EXISTS (SELECT 1 FROM post_target_semesters pts WHERE pts.post_id = ${p}id) AND ${p}semester_no IN (${placeholders}))))` : ''})`;
      clauses.push(`(${p}user_id = ? OR (${visClause} AND ${teacherPeerClause} AND ${semClause}))`);
      params.push(authorParam);
      if (sems.length) params.push(...sems, ...sems);
      return { sql: clauses.join(' AND '), params };
    }

    // Student & CR: general academic information (posts, notices, announcements) is discoverable across all semesters
    // when visible under post visibility rules (excluding teachers_only/private and other cohorts' cohort_only posts).
    const visClause = `COALESCE(${p}visibility, 'everyone') IN ('everyone', 'public', 'students_only', 'students-only', 'students', 'cohort_only', 'cohort-only')`;
    const studentCohortId = context.cohort?.id || context.cohortId || '__unassigned__';
    const cohortClause = `(COALESCE(${p}visibility, 'everyone') NOT IN ('cohort_only', 'cohort-only') AND LOWER(TRIM(COALESCE(${p}audience_scope, 'all_students'))) NOT IN ('cohort_only', 'cohort-only', 'private') OR ${p}cohort_id = ?)`;

    const reqSem = parseSemesterNumber(options.requestedSemester);
    let semClause = '1=1';
    const semParams = [];

    if (options.otherSemesterOnly && sems.length > 0) {
      semClause = `((${p}semester_no IS NOT NULL AND ${p}semester_no NOT IN (${placeholders})) OR EXISTS (SELECT 1 FROM post_target_semesters pts WHERE pts.post_id = ${p}id AND pts.semester NOT IN (${placeholders})))`;
      semParams.push(...sems, ...sems);
    } else if (reqSem) {
      semClause = `(${p}semester_no = ? OR EXISTS (SELECT 1 FROM post_target_semesters pts WHERE pts.post_id = ${p}id AND pts.semester = ?)${options.includeAllSemesters ? ` OR ${p}target_all_semesters = 1` : ''})`;
      semParams.push(reqSem, reqSem);
    } else if (options.enforceStudentSemester && sems.length > 0) {
      semClause = `(${p}target_all_semesters = 1 OR EXISTS (SELECT 1 FROM post_target_semesters pts WHERE pts.post_id = ${p}id AND pts.semester IN (${placeholders})) OR ${p}semester_no IN (${placeholders}))`;
      semParams.push(...sems, ...sems);
    }

    clauses.push(`(${p}user_id = ? OR (${visClause} AND ${cohortClause} AND ${semClause}))`);
    params.push(authorParam, studentCohortId, ...semParams);
    return { sql: clauses.join(' AND '), params };
  }

  // Non-post resources (notes / files, assignments)
  const { semesterAliases } = require('./note-search');
  if (context.role === 'teacher') {
    const aliases = sems.flatMap(semesterAliases);
    const global = `(${p}semester_no IS NULL AND (${p}semester IS NULL OR TRIM(${p}semester) = '') AND ${p}audience_scope = 'all_students')`;
    clauses.push(`(${global}${sems.length ? ` OR ${p}semester_no IN (${placeholders}) OR (${p}semester_no IS NULL AND LOWER(TRIM(${p}semester)) IN (${aliases.map(() => '?').join(',')}))` : ''})`);
    if (sems.length) params.push(...sems, ...aliases);

    if (type === 'note' || type === 'assignment') {
      const allowedSubjects = teacherSubjectAliases(context);
      if (allowedSubjects !== null) {
        const ownerCol = type === 'assignment' ? `${p}createdBy` : `${p}uploadedBy`;
        const ownerParam = context.studentId || '__none__';
        if (allowedSubjects.length > 0) {
          clauses.push(`(${ownerCol} = ? OR LOWER(TRIM(COALESCE(${p}subject, ''))) IN (${allowedSubjects.map(() => '?').join(',')}))`);
          params.push(ownerParam, ...allowedSubjects);
        } else {
          clauses.push(`(${ownerCol} = ?)`);
          params.push(ownerParam);
        }
      }
    }
    return { sql: clauses.join(' AND '), params };
  }

  // Student / CR for notes & assignments:
  const studentCohortId = context.cohort?.id || context.cohortId || null;
  const reqSem = parseSemesterNumber(options.requestedSemester);
  const explicitSems = Array.isArray(options.semesters)
    ? options.semesters.map(parseSemesterNumber).filter(Boolean)
    : (reqSem ? [reqSem] : null);
  const allowAllSems = Boolean(options.searchAllSemesters || options.allowCrossSemester);

  // Protect restricted visibility on files/assignments if visibility column exists
  const nonCohortOnlyClause = `(LOWER(TRIM(COALESCE(${p}audience_scope, 'all_students'))) NOT IN ('cohort_only', 'cohort-only', 'private'))`;

  if (allowAllSems && !explicitSems) {
    // Search across all semesters while preserving cohort isolation within the student's own semester
    if (studentCohortId && sems.length > 0) {
      const ownAliases = sems.flatMap(semesterAliases);
      const isOwnSemSql = `(${p}semester_no IN (${placeholders}) OR (${p}semester_no IS NULL AND LOWER(TRIM(COALESCE(${p}semester, ''))) IN (${ownAliases.map(() => '?').join(',')})))`;
      clauses.push(`(CASE WHEN ${isOwnSemSql} THEN (${p}cohort_id IS NULL OR ${p}audience_scope = 'all_students' OR ${p}cohort_id = ?) ELSE ${nonCohortOnlyClause} END)`);
      params.push(...sems, ...ownAliases, studentCohortId);
    } else {
      clauses.push(nonCohortOnlyClause);
    }
    return { sql: clauses.join(' AND '), params };
  }

  const targetSems = explicitSems || sems;
  const targetPlaceholders = targetSems.map(() => '?').join(',');
  const targetAliases = targetSems.flatMap(semesterAliases);
  const isCrossSemesterRequest = Boolean(
    explicitSems &&
    sems.length > 0 &&
    explicitSems.some(s => !sems.includes(s))
  );

  if (!isCrossSemesterRequest && studentCohortId && (type === 'note' || type === 'assignment')) {
    clauses.push(`(${p}cohort_id IS NULL OR ${p}audience_scope = 'all_students' OR ${p}cohort_id = ?)`);
    params.push(studentCohortId);
  } else {
    clauses.push(nonCohortOnlyClause);
  }

  const global = `(${p}semester_no IS NULL AND (${p}semester IS NULL OR TRIM(${p}semester) = '') AND ${p}audience_scope = 'all_students')`;
  clauses.push(`(${global}${targetSems.length ? ` OR ${p}semester_no IN (${targetPlaceholders}) OR (${p}semester_no IS NULL AND LOWER(TRIM(${p}semester)) IN (${targetAliases.map(() => '?').join(',')}))` : ''})`);
  if (targetSems.length) params.push(...targetSems, ...targetAliases);

  return { sql: clauses.join(' AND '), params };
}

const { asKnowledgeDb } = require('./knowledge-db');

async function readResource(db, context, card, options = {}) {
  db = asKnowledgeDb(db);
  const id = Number(card?.id ?? card?.canonicalId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const type = card?.resourceType === 'gu_official' ? 'gu_official' : (card.type || card.resourceType);
  if (!context?.authenticated) return null;

  if (type === 'comment') {
    const comment = await db.get('SELECT c.*, s.name, s.role FROM post_comments c JOIN students s ON s.studentId = c.user_id WHERE c.id = ?', id);
    if (!comment || comment.deleted_at || comment.moderation_status === 'removed') return null;
    const parentPost = await readResource(db, context, { type: 'post', id: comment.post_id }, options);
    if (!parentPost) return null;
    comment.parent_post = parentPost;
    return comment;
  }
  if (type === 'gu_official') {
    const guItem = await db.get("SELECT * FROM knowledge_resources WHERE resource_type = 'gu_official' AND (canonical_id = ? OR id = ?)", id, String(card?.id));
    if (!guItem || guItem.deleted_at || guItem.hidden_at) return null;
    return guItem;
  }

  const table = { post: 'posts', notice: 'posts', post_assignment: 'posts', assignment: 'assignments', note: 'files', routine: 'routine' }[type];
  if (!table) return null;
  const row = table === 'posts'
    ? await db.get('SELECT p.*, s.role AS author_role, s.name AS author_name FROM posts p LEFT JOIN students s ON s.studentId = p.user_id WHERE p.id = ?', id)
    : await db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) return null;
  if (table === 'posts') {
    row.targetSemesters = (await db.all('SELECT semester FROM post_target_semesters WHERE post_id = ?', id)).map(r => r.semester);
  }
  if (table === 'routine') row.audience_scope = 'all_students';
  if (!canReadResource(context, row, type, options)) return null;
  if (card.sourceVersion && card.sourceVersion !== sourceVersion(row)) return null;
  return row;
}

function sourceVersion(row) {
  const values = [row.id, row.title, row.content, row.description, row.deadline,
    row.semester_no ?? row.semesterNo, row.semester, row.cohort_id || row.cohortId,
    row.audience_scope || row.audienceScope, row.visibility, row.target_all_semesters ?? row.targetAllSemesters,
    row.targetSemesters, row.edited_at || row.editedAt, row.updated_at || row.updatedAt,
    row.storedName || row.storedname, row.subject, row.chapter];
  return require('crypto').createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function resourceCard(type, row) {
  const id = Number(row.id);
  if (type === 'comment') {
    const parentId = Number(row.post_id || row.parent_post?.id);
    return {
      type: 'comment',
      id,
      title: `Comment by ${row.name || 'User'} on "${row.parent_post?.title || 'Campus Post'}"`,
      action: 'view_post',
      deepLink: `/dashboard.html?post=${parentId}&comment=${id}`,
      mobileRoute: `/post/${parentId}`,
      mobileParams: { id: parentId, commentId: id }
    };
  }
  if (type === 'gu_official') {
    const guId = Number(row.canonical_id || row.id || String(row.id || '').replace(/\D+/g, '') || 0);
    return {
      type: 'notice',
      resourceType: 'gu_official',
      id: guId,
      title: row.title || 'Official Gandaki University Notice',
      semester: 'All Semesters',
      action: 'view_notice',
      deepLink: row.web_url || row.webUrl || 'https://www.gandakiuniversity.edu.np',
      mobileRoute: row.mobile_route || row.mobileRoute || `/notice/gu-${guId}`,
      mobileParams: row.mobile_params || row.mobileParams || { id: guId, source: 'gandakiuniversity' }
    };
  }
  const post = ['post', 'notice', 'post_assignment'].includes(type);
  if (post) {
    const authorRole = String(row.author_role || row.role || '').trim().toLowerCase();
    const isNoticeRow = (
      ['notice', 'announcement'].includes(String(row.type || '').trim().toLowerCase()) ||
      ['notice', 'announcement'].includes(String(row.category || '').trim().toLowerCase())
    ) && ['admin', 'teacher', 'cr'].includes(authorRole);
    type = isNoticeRow ? 'notice' : 'post';
  }
  const mobileRoute = { post: `/post/${id}`, notice: `/notice/${id}`, assignment: `/assignments/${id}`, note: `/material/${id}`, routine: '/routine' }[type];
  if (!mobileRoute) return null;
  const resolvedSemester = formatResourceSemester(row);
  const derivedTitle = post ? (String(row.content || '').match(/(?:^|\n|\r)\s*(?:Subject|Title)\s*:\s*([^\r\n]+)/i)?.[1]?.trim() || '') : '';
  return {
    type,
    id,
    sourceVersion: sourceVersion(row),
    title: row.title || derivedTitle || row.originalName || row.originalname || row.subject_name || String(row.content || '').slice(0, 80) || 'Resource',
    subject: row.subject,
    semester: resolvedSemester ?? (row.semester_no ?? row.semester ?? null),
    ...(row.author_name || row.authorName ? { authorName: row.author_name || row.authorName } : {}),
    ...(row.author_role || row.role ? { authorRole: String(row.author_role || row.role).trim().toLowerCase() } : {}),
    ...(row.created_at || row.createdAt ? { createdAt: row.created_at || row.createdAt } : {}),
    deadline: row.deadline || null,
    action: { post: 'view_post', notice: 'view_notice', assignment: 'view_assignment', note: 'open_note', routine: 'view_routine' }[type],
    deepLink: (type === 'notice' || type === 'post') ? `/posts/${id}` : (type === 'assignment') ? `/code-lab/assignment.html?id=${id}` : (row.web_url || `/api/ai/resources/${type}/${id}/open`),
    mobileRoute,
    mobileParams: type === 'routine' ? { semester: row.semester } : { id },
    ...(type === 'note' ? { viewUrl: `/api/files/${id}/view`, downloadUrl: `/api/files/${id}/download` } : {})
  };
}

async function revalidateCards(db, context, cards = [], options = {}) {
  db = asKnowledgeDb(db);
  const results = [];
  for (const card of cards.slice(0, 12)) {
    const row = await readResource(db, context, card, options);
    const resolvedType = card?.resourceType === 'gu_official' ? 'gu_official' : (card.type || card.resourceType);
    if (row) results.push(resourceCard(resolvedType, row));
  }
  return results.filter(Boolean);
}

module.exports = {
  RETRIEVAL_POLICIES,
  semestersFor,
  resolveRetrievalPolicy,
  formatResourceSemester,
  teacherSubjectAliases,
  canReadResource,
  resourceFilter,
  readResource,
  resourceCard,
  revalidateCards
};
