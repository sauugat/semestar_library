'use strict';

const crypto = require('crypto');

/**
 * Computes deterministic SHA-256 hash of text content.
 */
function computeContentHash(input) {
  return crypto.createHash('sha256').update(String(input).trim()).digest('hex');
}

function normalizeKnowledgeVisibility(vis) {
  if (!vis) return 'everyone';
  const v = String(vis).trim().toLowerCase();
  if (v === 'students_only' || v === 'students-only' || v === 'students') return 'students_only';
  if (v === 'teachers_only' || v === 'teachers-only' || v === 'teachers' || v === 'private') return 'teachers_only';
  if (v === 'cohort_only' || v === 'cohort-only') return 'cohort_only';
  return 'everyone';
}

function normalizeAudienceScope(scope) {
  if (!scope) return 'cohort';
  const s = String(scope).trim().toLowerCase();
  if (s === 'all_students' || s === 'all-students' || s === 'all' || s === 'public') return 'all_students';
  return 'cohort';
}

/**
 * Splits text into chunks of 600–800 characters with ~100 characters overlap.
 * Each chunk starts with a short contextual header.
 *
 * @param {string} header Short contextual header (e.g. "[Type: Post | Title: ...]")
 * @param {string} body The raw body text
 * @param {number} targetChunkSize Approx target size (default 750)
 * @param {number} overlap Characters of overlap (default 100)
 * @returns {Array<{ chunkIndex: number, content: string }>}
 */
function chunkText(header, body, targetChunkSize = 750, overlap = 100) {
  const cleanBody = (body || '').replace(/\r\n/g, '\n').trim();
  const cleanHeader = (header || '').trim();

  // If combined length is small (<= 800 chars), return exactly one chunk
  const fullText = cleanHeader ? `${cleanHeader}\n\n${cleanBody}` : cleanBody;
  if (fullText.length <= 800) {
    return [{ chunkIndex: 0, content: fullText }];
  }

  // Split into paragraphs or sentences where possible
  const chunks = [];
  let startIndex = 0;
  let chunkIdx = 0;

  while (startIndex < cleanBody.length) {
    let endIndex = startIndex + targetChunkSize;

    if (endIndex >= cleanBody.length) {
      endIndex = cleanBody.length;
    } else {
      // Find a clean boundary (newline, period, or space) near endIndex
      const slice = cleanBody.slice(startIndex, endIndex + 50);
      const lastNewline = slice.lastIndexOf('\n');
      const lastPeriod = slice.lastIndexOf('. ');
      const lastSpace = slice.lastIndexOf(' ');

      if (lastNewline > targetChunkSize * 0.7) {
        endIndex = startIndex + lastNewline;
      } else if (lastPeriod > targetChunkSize * 0.7) {
        endIndex = startIndex + lastPeriod + 1;
      } else if (lastSpace > targetChunkSize * 0.7) {
        endIndex = startIndex + lastSpace;
      }
    }

    const chunkBody = cleanBody.slice(startIndex, endIndex).trim();
    if (chunkBody.length > 0) {
      const chunkContent = cleanHeader ? `${cleanHeader}\n\n${chunkBody}` : chunkBody;
      chunks.push({ chunkIndex: chunkIdx++, content: chunkContent });
    }

    if (endIndex >= cleanBody.length) {
      break;
    }

    // Advance startIndex with overlap
    startIndex = Math.max(startIndex + 1, endIndex - overlap);
  }

  return chunks;
}

/**
 * Builds indexed knowledge resource metadata and chunks for a Post or Notice.
 *
 * @param {object} post Post row from database
 * @returns {object} Knowledge resource payload
 */
function buildPostKnowledge(post) {
  const isNotice = post.type === 'notice' || post.category === 'notice' || post.is_notice === 1 || post.isNotice;
  const resourceType = isNotice ? 'notice' : 'post';
  const resourceId = `post:${post.id}`;

  const title = (post.title || '').trim() || (isNotice ? 'Official Notice' : 'Campus Post');
  const subject = (post.subject || '').trim() || 'General';
  const semesterStr = post.semester ? `Semester ${post.semester}` : (post.target_all_semesters ? 'All Semesters' : 'General');

  const header = `[Type: ${isNotice ? 'Notice' : 'Post'} | Title: ${title} | Subject: ${subject} | Audience: ${semesterStr}]`;
  const rawBody = (post.content || post.body || '').trim();

  // Deterministic raw content string for change detection
  const canonicalContentString = JSON.stringify({
    title,
    content: rawBody,
    subject,
    semester: post.semester || null,
    semester_no: post.semester_no ?? null,
    cohort_id: post.cohort_id || null,
    attachment_url: post.attachment_url || null,
    target_all_semesters: post.target_all_semesters ? 1 : 0,
    audience_scope: post.audience_scope || 'cohort',
    visibility: post.visibility || 'public',
    category: post.category || 'general'
  });
  const contentHash = computeContentHash(canonicalContentString);

  // Authority Tier: Admin = 1, Teacher/CR = 3, Student = 4
  let authorityTier = 4;
  const authorRole = (post.author_role || post.role || '').toLowerCase();
  if (authorRole === 'admin') {
    authorityTier = 1;
  } else if (authorRole === 'teacher') {
    authorityTier = 2;
  } else if (authorRole === 'cr') {
    authorityTier = 3;
  }

  const chunks = chunkText(header, rawBody);

  return {
    resource: {
      id: resourceId,
      resource_type: resourceType,
      canonical_id: Number(post.id),
      canonical_code: null,
      title,
      source_authority_tier: authorityTier,
      author_id: post.user_id || post.author_id || post.authorId || null,
      author_role: authorRole || 'student',
      cohort_id: post.cohort_id || null,
      semester_no: (post.semester_no !== undefined && post.semester_no !== null) ? Number(post.semester_no) : (post.semester ? Number(post.semester) : null),
      audience_scope: normalizeAudienceScope(post.audience_scope),
      target_all_semesters: post.target_all_semesters ? 1 : 0,
      visibility: normalizeKnowledgeVisibility(post.visibility),
      web_url: isNotice ? `/notices.html?id=${post.id}` : `/dashboard.html?post=${post.id}`,
      mobile_route: isNotice ? `/notice/${post.id}` : `/post/${post.id}`,
      mobile_params: { id: post.id },
      content_hash: contentHash,
      hidden_at: post.hidden_at || null,
      deleted_at: post.deleted_at || null
    },
    chunks
  };
}

/**
 * Builds indexed knowledge resource metadata and chunks for an Assignment.
 *
 * NOTE: For assignments, title, subject, instructions, and deadline text are
 * embedded for vector/keyword retrieval, but student-facing UI title and deadline
 * must always be read LIVE from the assignments table at retrieval time.
 *
 * @param {object} assignment Assignment row from database
 * @returns {object} Knowledge resource payload
 */
function buildAssignmentKnowledge(assignment) {
  const resourceId = `assignment:${assignment.id}`;
  const title = (assignment.title || '').trim() || 'Assignment';
  const subject = (assignment.subject || '').trim() || 'Computer Science';
  const semesterStr = assignment.semester_no ? `Semester ${assignment.semester_no}` : (assignment.semester || 'General');

  // Format deadline text for vector indexing
  let deadlineText = 'No deadline specified';
  if (assignment.deadline) {
    const d = new Date(assignment.deadline);
    if (!isNaN(d.getTime())) {
      deadlineText = d.toISOString().replace('T', ' ').slice(0, 16);
    }
  }

  const header = `[Type: Assignment | Title: ${title} | Subject: ${subject} | Semester: ${semesterStr}]`;
  const rawDescription = (assignment.description || '').trim();
  const instructions = (assignment.instructions || '').trim();
  const fullBody = [
    rawDescription,
    instructions ? `Instructions: ${instructions}` : '',
    `Submission Deadline: ${deadlineText}`,
    assignment.language ? `Programming Language: ${assignment.language}` : ''
  ].filter(Boolean).join('\n\n');

  let normalizedDeadline = null;
  if (assignment.deadline) {
    const d = new Date(assignment.deadline);
    if (!isNaN(d.getTime())) {
      normalizedDeadline = d.toISOString();
    }
  }

  // Deterministic raw content string for change detection
  const canonicalContentString = JSON.stringify({
    title,
    description: rawDescription,
    instructions,
    subject,
    semester: assignment.semester || null,
    semester_no: assignment.semester_no || null,
    deadline: normalizedDeadline,
    language: assignment.language || null,
    pdfUrl: assignment.pdfUrl || assignment.pdfurl || null,
    cohort_id: assignment.cohort_id || null,
    audience_scope: assignment.audience_scope || 'cohort'
  });
  const contentHash = computeContentHash(canonicalContentString);

  const chunks = chunkText(header, fullBody);

  return {
    resource: {
      id: resourceId,
      resource_type: 'assignment',
      canonical_id: Number(assignment.id),
      canonical_code: null,
      title,
      source_authority_tier: 2, // Teacher assignments = Tier 2
      author_id: assignment.createdBy || assignment.createdby || assignment.created_by || null,
      author_role: 'teacher',
      cohort_id: assignment.cohort_id || null,
      semester_no: assignment.semester_no ? Number(assignment.semester_no) : (parseInt(assignment.semester, 10) || null),
      audience_scope: normalizeAudienceScope(assignment.audience_scope),
      target_all_semesters: 0,
      visibility: 'everyone',
      web_url: `/code-lab/assignment.html?id=${assignment.id}`,
      mobile_route: `/assignments/${assignment.id}`,
      mobile_params: { id: assignment.id },
      content_hash: contentHash,
      hidden_at: null,
      deleted_at: null
    },
    chunks
  };
}

function buildNoteKnowledge(file) {
  const { parseSemesterNumber } = require('./academic-context');
  const id = Number(file.id);
  const title = file.title || file.originalName || file.originalname || 'Study material';
  const version = { title, storedName: file.storedName || file.storedname, subject: file.subject,
    chapter: file.chapter, semester: file.semester, semester_no: file.semester_no,
    cohort_id: file.cohort_id, audience_scope: file.audience_scope,
    indexed_at: file.extraction_indexed_at || file.indexed_at || null };
  const resource = { id: `note:${id}`, resource_type: 'note', canonical_id: id, canonical_code: null,
    title, source_authority_tier: 5, author_id: file.uploadedBy || file.uploadedby || null,
    author_role: file.author_role || 'student', cohort_id: file.cohort_id || null,
    semester_no: parseSemesterNumber(file.semester_no ?? file.semester),
    audience_scope: normalizeAudienceScope(file.audience_scope), target_all_semesters: 0,
    visibility: 'everyone', web_url: `/api/files/${id}/view`, mobile_route: `/material/${id}`,
    mobile_params: { id }, hidden_at: null, deleted_at: null, content_hash: computeContentHash(JSON.stringify(version)) };
  const header = `[Type: Note | Title: ${title} | Subject: ${file.subject || ''} | Chapter: ${file.chapter || ''}]`;
  const pages = String(file.extracted_content || '').split('\f');
  const chunks = pages.flatMap((page, i) => chunkText(header, page).map(c => ({ ...c, pageNumber: pages.length > 1 ? i + 1 : null })));
  chunks.forEach((c, i) => { c.chunkIndex = i; });
  return { resource, chunks };
}
function buildRoutineKnowledge(row) {
  const title = `${row.subject_name} examination routine`;
  const body = `${row.subject_name} ${row.subject_code || ''} exam: ${row.exam_date} ${row.calendar || ''}, ${row.exam_time || ''}, room ${row.room || 'unconfirmed'}.`;
  return { resource: { id: `routine:${row.id}`, resource_type: 'routine', canonical_id: Number(row.id), canonical_code: null,
    title, source_authority_tier: 1, author_id: null, author_role: 'admin', cohort_id: null,
    semester_no: Number(row.semester), audience_scope: 'all_students', target_all_semesters: 0, visibility: 'everyone',
    web_url: `/routine?sem=${row.semester}`, mobile_route: '/routine', mobile_params: { semester: row.semester },
    content_hash: computeContentHash(JSON.stringify({ title, body, semester: row.semester })), hidden_at: null, deleted_at: null },
    chunks: chunkText(`[Type: Routine | Title: ${title}]`, body) };
}

/**
 * Builds indexed knowledge resource metadata and chunks for a Post Comment.
 *
 * @param {object} comment Comment row from database
 * @param {object} parentPost Parent Post row from database
 * @returns {object} Knowledge resource payload
 */
function buildCommentKnowledge(comment, parentPost) {
  const commentId = Number(comment.id);
  const postId = Number(comment.post_id || parentPost.id);
  const resourceId = `comment:${commentId}`;

  const parentTitle = (parentPost.title || '').trim() || 'Campus Post';
  const authorRole = (comment.author_role || comment.role || 'student').toLowerCase();
  const authorName = (comment.author_name || comment.name || 'User').trim();

  // Authority Tier: Teacher = 2, CR = 3, Student = 4, Admin = 1
  let authorityTier = 4;
  let authorityLabel = 'Student Discussion';
  if (authorRole === 'admin') {
    authorityTier = 1;
    authorityLabel = 'Official Notice';
  } else if (authorRole === 'teacher') {
    authorityTier = 2;
    authorityLabel = 'Teacher Clarification';
  } else if (authorRole === 'cr') {
    authorityTier = 3;
    authorityLabel = 'CR Clarification';
  }

  const title = `${authorityLabel} on "${parentTitle}"`;
  const rawBody = (comment.content || '').trim();
  const createdAt = comment.created_at || new Date().toISOString();

  const header = `[Type: Comment (${authorityLabel}) | Post: ${parentTitle} | Author: ${authorName} (${authorRole}) | Date: ${String(createdAt).slice(0, 10)}]`;

  const canonicalContentString = JSON.stringify({
    commentId,
    postId,
    content: rawBody,
    author_id: comment.user_id || comment.studentId || null,
    author_role: authorRole
  });
  const contentHash = computeContentHash(canonicalContentString);

  const chunks = chunkText(header, rawBody);

  return {
    resource: {
      id: resourceId,
      resource_type: 'comment',
      canonical_id: commentId,
      canonical_code: `post:${postId}`,
      title,
      source_authority_tier: authorityTier,
      author_id: comment.user_id || comment.studentId || null,
      author_role: authorRole,
      // Inherit parent post scoping and access control
      cohort_id: parentPost.cohort_id || null,
      semester_no: (parentPost.semester_no !== undefined && parentPost.semester_no !== null) ? Number(parentPost.semester_no) : (parentPost.semester ? Number(parentPost.semester) : null),
      audience_scope: normalizeAudienceScope(parentPost.audience_scope),
      target_all_semesters: parentPost.target_all_semesters ? 1 : 0,
      visibility: normalizeKnowledgeVisibility(parentPost.visibility),
      web_url: `/dashboard.html?post=${postId}&comment=${commentId}`,
      mobile_route: `/post/${postId}`,
      mobile_params: { id: postId, commentId },
      content_hash: contentHash,
      hidden_at: (comment.moderation_status === 'removed' || parentPost.hidden_at) ? (comment.moderated_at || new Date().toISOString()) : null,
      deleted_at: (comment.deleted_at || parentPost.deleted_at) ? (comment.deleted_at || new Date().toISOString()) : null
    },
    chunks
  };
}

/**
 * Builds indexed knowledge resource metadata and chunks for an official Gandaki University notice/page.
 *
 * @param {object} item Official university information item
 * @returns {object} Knowledge resource payload
 */
function buildGUKnowledge(item) {
  const id = item.id;
  const resourceId = `gu:${item.type || 'notice'}:${id}`;
  const title = (item.title || '').trim() || 'Gandaki University Official Notice';
  const url = item.link || item.url || 'https://www.gandakiuniversity.edu.np';
  const pubDate = item.date || item.created_at || new Date().toISOString();
  const pdfUrl = item.pdf_url || item.pdfUrl || null;
  const rawBody = (item.content || item.summary || item.body || '').trim() || (pdfUrl ? `Official PDF Attachment: ${pdfUrl}` : title);

  const header = `[Type: Gandaki University Official Notice | Title: ${title} | Source: Gandaki University Official Portal (${url}) | Date: ${String(pubDate).slice(0, 10)}]`;

  const canonicalContentString = JSON.stringify({
    id,
    title,
    content: rawBody,
    url,
    pdfUrl,
    date: pubDate
  });
  const contentHash = computeContentHash(canonicalContentString);
  const chunks = chunkText(header, rawBody);

  return {
    resource: {
      id: resourceId,
      resource_type: 'gu_official',
      canonical_id: Number(id) || null,
      canonical_code: `gu:${id}`,
      title,
      source_authority_tier: 1, // Tier 1 Institutional Authority
      author_id: null,
      author_role: 'admin',
      cohort_id: null,
      semester_no: null,
      audience_scope: 'all_students',
      target_all_semesters: 1,
      visibility: 'everyone',
      web_url: url,
      mobile_route: `/notice/gu-${id}`,
      mobile_params: { id, source: 'gandakiuniversity', webUrl: url },
      content_hash: contentHash,
      hidden_at: null,
      deleted_at: null
    },
    chunks
  };
}

module.exports = {
  computeContentHash,
  chunkText,
  buildPostKnowledge,
  buildAssignmentKnowledge,
  buildNoteKnowledge,
  buildRoutineKnowledge,
  buildCommentKnowledge,
  buildGUKnowledge
};
