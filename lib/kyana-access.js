'use strict';

// Kyana's current-semester policy is intentionally narrower than archive/manage
// access elsewhere in the application. Never infer global access from a NULL scope.
const { parseSemesterNumber } = require('./academic-context');
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

function canReadResource(context, row, type = 'post') {
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
  const scope = row.audience_scope || row.audienceScope;
  if (context.role !== 'teacher' && scope !== 'all_students' && (!cohort || cohort !== (context.cohort?.id || context.cohortId)) && !isAuthor) return false;

  const sems = semestersFor(context);
  const targets = (row.targetSemesters || row.target_semesters || []).map(parseSemesterNumber).filter(Boolean);
  const sem = parseSemesterNumber(row.semester_no ?? row.semesterNo ?? row.semester);

  if (type === 'post' || type === 'notice' || type === 'post_assignment') {
    if (context.role === 'teacher' && !isAuthor) {
      const isNoticeRow = type === 'notice' || row.type === 'notice' || row.category === 'notice' || Number(row.is_notice) === 1 || Boolean(row.isNotice);
      const authorRole = String(row.author_role || row.role || '').trim().toLowerCase();
      if (authorRole === 'teacher' && !isNoticeRow) {
        return false;
      }
    }
    if (isAuthor) return true;
    if (Number(row.target_all_semesters ?? row.targetAllSemesters) === 1) return true;
    return (targets.length ? targets : [sem]).some(n => sems.includes(n));
  }

  const semAllowed = isAuthor || (sem ? sems.includes(sem) : scope === 'all_students');
  if (!semAllowed) return false;

  if (context.role === 'teacher' && (type === 'note' || type === 'assignment') && !isAuthor) {
    const allowedSubjects = teacherSubjectAliases(context);
    if (allowedSubjects !== null) {
      if (!allowedSubjects.length) return false;
      const rowSubject = String(row.subject || '').trim().toLowerCase();
      if (!rowSubject || !allowedSubjects.includes(rowSubject)) return false;
    }
  }

  return true;
}

// SQL predicates use LIVE source tables before retrieving text or passages.
// Placeholders are adapted to PostgreSQL by the caller/standard DB adapter.
function resourceFilter(context, type, alias) {
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
    const visClause = context.role === 'teacher'
      ? `COALESCE(${p}visibility, 'everyone') IN ('everyone', 'public', 'teachers_only', 'teachers-only')`
      : `COALESCE(${p}visibility, 'everyone') IN ('everyone', 'public', 'students_only', 'students-only', 'students', 'cohort_only', 'cohort-only')`;
    const cohortClause = context.role === 'teacher' ? '1=1' : `(${p}audience_scope = 'all_students' OR ${p}cohort_id = ?)`;
    const teacherPeerClause = context.role === 'teacher'
      ? ` AND (${p}type = 'notice' OR COALESCE(${p}category, '') = 'notice' OR NOT EXISTS (SELECT 1 FROM students s_auth WHERE s_auth.studentId = ${p}user_id AND s_auth.role = 'teacher'))`
      : '';
    const semClause = `(${p}target_all_semesters = 1${sems.length ? ` OR (${p}target_all_semesters = 0 AND (EXISTS (SELECT 1 FROM post_target_semesters pts WHERE pts.post_id = ${p}id AND pts.semester IN (${placeholders})) OR (NOT EXISTS (SELECT 1 FROM post_target_semesters pts WHERE pts.post_id = ${p}id) AND ${p}semester_no IN (${placeholders}))))` : ''})`;

    clauses.push(`(${p}user_id = ? OR (${visClause} AND ${cohortClause}${teacherPeerClause} AND ${semClause}))`);
    params.push(authorParam);
    if (context.role !== 'teacher') params.push(context.cohort?.id || context.cohortId || '__unassigned__');
    if (sems.length) params.push(...sems, ...sems);
  } else {
    const { semesterAliases } = require('./note-search');
    const aliases = sems.flatMap(semesterAliases);
    const global = `(${p}semester_no IS NULL AND (${p}semester IS NULL OR TRIM(${p}semester) = '') AND ${p}audience_scope = 'all_students')`;
    const hasStudentCohort = Boolean(context.cohort?.id || context.cohortId);
    const cohortClause = (context.role !== 'teacher' && (type === 'note' || type === 'assignment') && hasStudentCohort)
      ? `(${p}cohort_id IS NULL OR ${p}audience_scope = 'all_students' OR ${p}cohort_id = ?)`
      : null;
    if (cohortClause) {
      clauses.push(cohortClause);
      params.push(context.cohort?.id || context.cohortId);
    }
    clauses.push(`(${global}${sems.length ? ` OR ${p}semester_no IN (${placeholders}) OR (${p}semester_no IS NULL AND LOWER(TRIM(${p}semester)) IN (${aliases.map(() => '?').join(',')}))` : ''})`);
    if (sems.length) params.push(...sems, ...aliases);

    if (context.role === 'teacher' && (type === 'note' || type === 'assignment')) {
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
  }
  return { sql: clauses.join(' AND '), params };
}

const { asKnowledgeDb } = require('./knowledge-db');

async function readResource(db, context, card) {
  db = asKnowledgeDb(db);
  const id = Number(card?.id ?? card?.canonicalId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const type = card?.resourceType === 'gu_official' ? 'gu_official' : (card.type || card.resourceType);
  if (!context?.authenticated) return null;

  if (type === 'comment') {
    const comment = await db.get('SELECT c.*, s.name, s.role FROM post_comments c JOIN students s ON s.studentId = c.user_id WHERE c.id = ?', id);
    if (!comment || comment.deleted_at || comment.moderation_status === 'removed') return null;
    const parentPost = await readResource(db, context, { type: 'post', id: comment.post_id });
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
    ? await db.get('SELECT p.*, s.role AS author_role FROM posts p LEFT JOIN students s ON s.studentId = p.user_id WHERE p.id = ?', id)
    : await db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) return null;
  if (table === 'posts') {
    row.targetSemesters = (await db.all('SELECT semester FROM post_target_semesters WHERE post_id = ?', id)).map(r => r.semester);
  }
  if (table === 'routine') row.audience_scope = 'all_students';
  if (!canReadResource(context, row, type)) return null;
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
      action: 'view_notice',
      deepLink: row.web_url || row.webUrl || 'https://www.gandakiuniversity.edu.np',
      mobileRoute: row.mobile_route || row.mobileRoute || `/notice/gu-${guId}`,
      mobileParams: row.mobile_params || row.mobileParams || { id: guId, source: 'gandakiuniversity' }
    };
  }
  const post = ['post', 'notice', 'post_assignment'].includes(type);
  if (post) type = row.type === 'notice' || row.category === 'notice' ? 'notice' : 'post';
  const mobileRoute = { post: `/post/${id}`, notice: `/notice/${id}`, assignment: `/assignments/${id}`, note: `/material/${id}`, routine: '/routine' }[type];
  if (!mobileRoute) return null;
  return { type, id, sourceVersion: sourceVersion(row), title: row.title || row.originalName || row.originalname || row.subject_name || String(row.content || '').slice(0, 80) || 'Resource',
    subject: row.subject, semester: row.semester_no ?? row.semester, deadline: row.deadline || null,
    action: { post: 'view_post', notice: 'view_notice', assignment: 'view_assignment', note: 'open_note', routine: 'view_routine' }[type],
    deepLink: (type === 'notice' || type === 'post') ? `/posts/${id}` : (type === 'assignment') ? `/code-lab/assignment.html?id=${id}` : (row.web_url || `/api/ai/resources/${type}/${id}/open`), mobileRoute,
    mobileParams: type === 'routine' ? { semester: row.semester } : { id },
    ...(type === 'note' ? { viewUrl: `/api/files/${id}/view`, downloadUrl: `/api/files/${id}/download` } : {}) };
}
async function revalidateCards(db, context, cards = []) {
  db = asKnowledgeDb(db);
  const results = [];
  for (const card of cards.slice(0, 12)) {
    const row = await readResource(db, context, card);
    const resolvedType = card?.resourceType === 'gu_official' ? 'gu_official' : (card.type || card.resourceType);
    if (row) results.push(resourceCard(resolvedType, row));
  }
  return results.filter(Boolean);
}
module.exports = { semestersFor, teacherSubjectAliases, canReadResource, resourceFilter, readResource, resourceCard, revalidateCards };
