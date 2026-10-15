'use strict';

// Kyana's current-semester policy is intentionally narrower than archive/manage
// access elsewhere in the application. Never infer global access from a NULL scope.
const { parseSemesterNumber } = require('./academic-context');
function semestersFor(context) {
  if (context?.role === 'teacher') return [...new Set((context.assignedSemesters || []).map(parseSemesterNumber).filter(Boolean))];
  const n = parseSemesterNumber(context?.cohort?.currentSemester || context?.currentSemester || context?.semester);
  return n ? [n] : [];
}
function canReadResource(context, row, type = 'post') {
  if (!context?.authenticated || !row || row.deleted_at || row.hidden_at || ['removed', 'hidden'].includes(row.moderation_status)) return false;
  if (context.role === 'admin') return true;
  if (!['student', 'cr', 'teacher'].includes(context.role)) return false;
  const isAuthor = Boolean(context.studentId && ((row.author_id && row.author_id === context.studentId) || (row.user_id && row.user_id === context.studentId)));
  const visibility = row.visibility || 'everyone';
  const allowedVisibility = context.role === 'teacher' ? ['everyone', 'public', 'teachers_only'] : ['everyone', 'public', 'students_only', 'cohort_only'];
  if (!allowedVisibility.includes(visibility) && !isAuthor) return false;
  const cohort = row.cohort_id || row.cohortId;
  const scope = row.audience_scope || row.audienceScope;
  if (context.role !== 'teacher' && scope !== 'all_students' && (!cohort || cohort !== (context.cohort?.id || context.cohortId)) && !isAuthor) return false;
  const sems = semestersFor(context);
  const targets = (row.targetSemesters || row.target_semesters || []).map(parseSemesterNumber).filter(Boolean);
  const sem = parseSemesterNumber(row.semester_no ?? row.semesterNo ?? row.semester);
  if (type === 'post' || type === 'notice' || type === 'post_assignment') {
    if (Number(row.target_all_semesters ?? row.targetAllSemesters) === 1) return true;
    return (targets.length ? targets : [sem]).some(n => sems.includes(n));
  }
  return sem ? sems.includes(sem) : scope === 'all_students';
}

// SQL predicates use LIVE source tables before retrieving text or passages.
// Placeholders are adapted to PostgreSQL by the caller/standard DB adapter.
function resourceFilter(context, type, alias) {
  if (!/^[a-z0-9_]+$/.test(alias)) throw new Error('Invalid SQL alias');
  if (!context?.authenticated || !['admin', 'teacher', 'student', 'cr'].includes(context.role)) return { sql: '1=0', params: [] };
  if (context.role === 'admin') return { sql: '1=1', params: [] };
  const p = `${alias}.`;
  const post = ['post', 'notice'].includes(type);
  const params = [];
  const clauses = [];
  const sems = semestersFor(context);
  const placeholders = sems.map(() => '?').join(',');

  if (post) {
    const authorParam = context.studentId || '__none__';
    const visClause = context.role === 'teacher'
      ? `COALESCE(${p}visibility, 'everyone') IN ('everyone', 'public', 'teachers_only')`
      : `COALESCE(${p}visibility, 'everyone') IN ('everyone', 'public', 'students_only', 'cohort_only')`;
    const cohortClause = context.role === 'teacher' ? '1=1' : `(${p}audience_scope = 'all_students' OR ${p}cohort_id = ?)`;
    const semClause = `(${p}target_all_semesters = 1${sems.length ? ` OR (${p}target_all_semesters = 0 AND (EXISTS (SELECT 1 FROM post_target_semesters pts WHERE pts.post_id = ${p}id AND pts.semester IN (${placeholders})) OR (NOT EXISTS (SELECT 1 FROM post_target_semesters pts WHERE pts.post_id = ${p}id) AND ${p}semester_no IN (${placeholders}))))` : ''})`;

    clauses.push(`((${p}user_id = ? OR (${visClause} AND ${cohortClause})) AND ${semClause})`);
    params.push(authorParam);
    if (context.role !== 'teacher') params.push(context.cohort?.id || context.cohortId || '__unassigned__');
    if (sems.length) params.push(...sems, ...sems);
  } else {
    const { semesterAliases } = require('./note-search');
    const aliases = sems.flatMap(semesterAliases);
    const global = `(${p}semester_no IS NULL AND (${p}semester IS NULL OR TRIM(${p}semester) = '') AND ${p}audience_scope = 'all_students')`;
    clauses.push(`(${global}${sems.length ? ` OR ${p}semester_no IN (${placeholders}) OR (${p}semester_no IS NULL AND LOWER(TRIM(${p}semester)) IN (${aliases.map(() => '?').join(',')}))` : ''})`);
    if (sems.length) params.push(...sems, ...aliases);
  }
  return { sql: clauses.join(' AND '), params };
}

const { asKnowledgeDb } = require('./knowledge-db');

async function readResource(db, context, card) {
  db = asKnowledgeDb(db);
  const id = Number(card?.id ?? card?.canonicalId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const type = card.type || card.resourceType;
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
  const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
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
    return {
      type: 'notice',
      id: row.canonical_id || id,
      title: row.title || 'Official Gandaki University Notice',
      action: 'view_notice',
      deepLink: row.web_url || 'https://www.gandakiuniversity.edu.np',
      mobileRoute: row.mobile_route || `/notice/gu-${id}`,
      mobileParams: row.mobile_params || { id, source: 'gandakiuniversity' }
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
    if (row) results.push(resourceCard(card.type || card.resourceType, row));
  }
  return results.filter(Boolean);
}
module.exports = { semestersFor, canReadResource, resourceFilter, readResource, resourceCard, revalidateCards };
