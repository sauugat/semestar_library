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
  const isNotice = post.category === 'notice' || post.is_notice === 1 || post.isNotice;
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
    target_all_semesters: post.target_all_semesters ? 1 : 0,
    audience_scope: post.audience_scope || 'cohort',
    visibility: post.visibility || 'public',
    category: post.category || 'general'
  });
  const contentHash = computeContentHash(canonicalContentString);

  // Authority Tier: Admin = 1, Teacher/CR = 3, Student = 4
  let authorityTier = 4;
  const authorRole = (post.author_role || post.role || '').toLowerCase();
  if (authorRole === 'admin' || isNotice) {
    authorityTier = 1;
  } else if (authorRole === 'teacher' || authorRole === 'cr') {
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

  // Deterministic raw content string for change detection
  const canonicalContentString = JSON.stringify({
    title,
    description: rawDescription,
    instructions,
    subject,
    semester: assignment.semester || null,
    semester_no: assignment.semester_no || null,
    deadline: assignment.deadline || null,
    language: assignment.language || null,
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
      author_id: assignment.createdBy || assignment.created_by || null,
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

module.exports = {
  computeContentHash,
  chunkText,
  buildPostKnowledge,
  buildAssignmentKnowledge
};
