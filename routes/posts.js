const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  fetchPostComments,
  fetchCommentReplies,
  createCommentOrReply,
  editComment,
  deleteComment,
  addCommentReaction,
  removeCommentReaction,
  toggleCommentReaction
} = require('../lib/comments');
const {
  ensurePostsSchema,
  cleanupAbandonedStagedAttachments,
  VALID_POST_CATEGORIES,
  DEFAULT_POST_CATEGORY,
  CATEGORY_LABELS,
  VALID_SEMESTERS,
  VALID_POST_VISIBILITIES,
  DEFAULT_POST_VISIBILITY,
  normalizeCategory,
  normalizeVisibility,
  parseAndValidateTargetSemesters,
  formatSemesterDisplay,
  isModerationSchemaAvailable,
  isContentReportsAvailable
} = require('../lib/posts');
const {
  getAcademicContext,
  buildAcademicContentFilter,
  resolvePublishScope,
  assertContentAccess,
  parseSemesterNumber
} = require('../lib/academic-context');

const POST_UPLOAD_DIR = process.env.VERCEL
  ? path.join('/tmp', 'uploads', 'posts')
  : path.join(__dirname, '..', 'public', 'uploads', 'posts');
const imageExtensions = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/avif': '.avif', 'image/apng': '.apng',
  'image/svg+xml': '.svg', 'image/bmp': '.bmp', 'image/tiff': '.tiff',
  'image/heic': '.heic', 'image/heif': '.heif', 'image/x-icon': '.ico'
};

const MAX_ATTACHMENT_BYTES_PER_FILE = 4 * 1024 * 1024; // 4.0 MB per attachment (individual request limit)

const documentExtensions = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip'
};

function getSafeFileExtension(file) {
  if (file.mimetype && imageExtensions[file.mimetype]) return imageExtensions[file.mimetype];
  if (file.mimetype && documentExtensions[file.mimetype]) return documentExtensions[file.mimetype];
  const origExt = path.extname(file.originalname || '').toLowerCase();
  if (['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.txt', '.zip', '.csv', '.rtf', '.md', '.json', '.jpg', '.jpeg', '.png', '.webp'].includes(origExt)) {
    return origExt;
  }
  return file.mimetype?.startsWith('image/') ? '.jpg' : '.bin';
}

async function removeUploadedImage(filename) {
  try {
    await fs.promises.unlink(filename);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[Post Image Cleanup Error]:', err.message);
  }
}

function positiveId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

async function getTeacherAssignedSemesters(db, teacherUserId) {
  if (!teacherUserId) return [];
  try {
    const query = db.isPostgres
      ? `SELECT DISTINCT s.semester
         FROM teacher_subjects ts
         JOIN subjects s ON s.id = ts.subject_id
         LEFT JOIN teachers t ON t.id = ts.teacher_id
         WHERE (ts.teacher_id = $1 OR t.user_id = $1 OR t.id = $1)`
      : `SELECT DISTINCT s.semester
         FROM teacher_subjects ts
         JOIN subjects s ON s.id = ts.subject_id
         LEFT JOIN teachers t ON t.id = ts.teacher_id
         WHERE (ts.teacher_id = ? OR t.user_id = ? OR t.id = ?)`;
    const rows = db.isPostgres
      ? await db.all(query, teacherUserId)
      : await db.all(query, teacherUserId, teacherUserId, teacherUserId);
    if (rows && rows.length > 0) {
      return [...new Set(
        rows
          .map(r => Number(r.semester))
          .filter(sem => Number.isInteger(sem) && sem >= 1 && sem <= 8)
      )];
    }
  } catch (_) {}

  try {
    const { getTeacherSubjects } = require('../lib/teacher-service');
    const subjects = await getTeacherSubjects(db, teacherUserId);
    return [...new Set(
      (subjects || [])
        .map(s => Number(s.semester))
        .filter(sem => Number.isInteger(sem) && sem >= 1 && sem <= 8)
    )];
  } catch (_) {
    return [];
  }
}

module.exports = function createPostsRouter(db, requireLogin, { uploadDir = POST_UPLOAD_DIR } = {}) {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        try {
          fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        } catch (err) {
          cb(err);
        }
      },
      // Use a server-generated name and safe extension, never arbitrary unsanitized filenames.
      filename: (req, file, cb) => cb(null, crypto.randomUUID() + getSafeFileExtension(file))
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 15, fields: 30, fieldSize: 64 * 1024 },
    fileFilter: (req, file, cb) => {
      const isImg = file.mimetype && file.mimetype.startsWith('image/');
      if (file.fieldname === 'image' || file.fieldname === 'images') {
        if (isImg) return cb(null, true);
        const err = new Error('Please choose an image file.');
        err.code = 'INVALID_IMAGE_TYPE';
        return cb(err);
      }
      const origExt = path.extname(file.originalname || '').toLowerCase();
      const isDoc = (file.mimetype && Boolean(documentExtensions[file.mimetype])) ||
        ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.txt', '.zip', '.csv', '.rtf', '.md', '.json'].includes(origExt);
      if (isImg || isDoc) return cb(null, true);
      const err = new Error('Please choose an image or document (PDF, Word, PPTX, Excel, TXT, ZIP).');
      err.code = 'INVALID_FILE_TYPE';
      cb(err);
    }
  });
  const router = express.Router();
  router.use(requireLogin);
  router.use(async (req, res, next) => {
    try {
      if (typeof db.initSchema === 'function') {
        await db.initSchema();
      }
      const callerId = req.student?.studentId || req.user?.studentId || req.session?.studentId;
      req.postUser = req.student || req.user || (callerId ? await db.get('SELECT * FROM students WHERE studentId = ?', callerId) : null);
      if (!req.postUser && req.method !== 'GET') {
        return res.status(403).json({ message: 'Sign in with a student account to post or like.' });
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  function buildSelectPosts(modAvail = true) {
    const commentFilter = modAvail
      ? "WHERE deleted_at IS NULL AND (moderation_status IS NULL OR moderation_status = 'active')"
      : "WHERE deleted_at IS NULL";
    return `
      SELECT p.*, s.name, s.role, s.avatarUrl AS "avatarUrl", s.studentId AS "studentId",
        COALESCE(l.like_count, 0) AS like_count,
        COALESCE(c.comment_count, 0) AS comment_count,
        COALESCE(sub.submission_count, 0) AS submission_count,
        (mine.user_id IS NOT NULL) AS liked_by_me
      FROM posts p
      LEFT JOIN students s ON s.studentId = p.user_id
      LEFT JOIN (SELECT post_id, COUNT(*) AS like_count FROM post_likes GROUP BY post_id) l
        ON l.post_id = p.id
      LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM post_comments ${commentFilter} GROUP BY post_id) c
        ON c.post_id = p.id
      LEFT JOIN post_likes mine ON mine.post_id = p.id AND mine.user_id = ?
      LEFT JOIN (SELECT post_id, COUNT(*) AS submission_count FROM post_submissions GROUP BY post_id) sub
        ON sub.post_id = p.id AND p.type = 'assignment'`;
  }

  const runTransaction = typeof db.withTransaction === 'function'
    ? (fn) => db.withTransaction(fn)
    : async (fn) => {
        if (typeof db.run === 'function') {
          try {
            await db.run('BEGIN');
            const res = await fn(db);
            await db.run('COMMIT');
            return res;
          } catch (err) {
            try { await db.run('ROLLBACK'); } catch (_) {}
            throw err;
          }
        }
        return await fn(db);
      };

  async function cleanupUnattachedBlobs(blobsToCheck) {
    if (!Array.isArray(blobsToCheck) || blobsToCheck.length === 0) return;
    for (const item of blobsToCheck) {
      const url = typeof item === 'string' ? item : (item?.url || '');
      let filename = item?.filename || '';
      if (!filename && url && typeof url === 'string') {
        const cleanUrl = url.split('?')[0].split('#')[0];
        filename = path.basename(cleanUrl);
      }
      if (!filename || !/^[a-f0-9-]+\.[a-z0-9]+$/i.test(filename)) continue;

      const fullUrl = `/uploads/posts/${filename}`;
      const altUrl = `uploads/posts/${filename}`;

      try {
        const inPosts = await db.get('SELECT COUNT(*) AS c FROM posts WHERE attachment_url = ? OR attachment_url = ?', fullUrl, altUrl);
        const inMedia = await db.get('SELECT COUNT(*) AS c FROM post_media WHERE url = ? OR url = ?', fullUrl, altUrl);
        if ((Number(inPosts?.c || 0) + Number(inMedia?.c || 0)) === 0) {
          await db.deleteFileBlob(filename);
          await removeUploadedImage(path.join(uploadDir, filename));
          try {
            await db.run('DELETE FROM post_attachment_staging WHERE filename = ? AND is_committed = 0', filename);
          } catch (_) {}
        }
      } catch (err) {
        console.error('[Unattached Blob Cleanup Error]:', err.message);
      }
    }
  }

  async function resolveAndValidateAttachments(rawList, studentId, { allowCommittedForPostId = null } = {}) {
    if (!Array.isArray(rawList) || rawList.length === 0) return [];

    // Deduplicate by key (id, filename, or clean URL basename)
    const seenKeys = new Set();
    const dedupedRaw = [];
    for (const item of rawList) {
      if (!item) continue;
      let key = null;
      if (typeof item === 'string') {
        const clean = item.split('?')[0].split('#')[0];
        key = path.basename(clean);
      } else {
        key = item.id || item.filename || (item.url ? path.basename(String(item.url).split('?')[0].split('#')[0]) : null);
      }
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      dedupedRaw.push(item);
    }

    const validated = [];
    for (const item of dedupedRaw) {
      let key = null;
      let urlStr = null;
      if (typeof item === 'string') {
        urlStr = item;
        key = path.basename(item.split('?')[0].split('#')[0]);
      } else {
        urlStr = item.url ? String(item.url) : null;
        key = item.id || item.filename || (item.url ? path.basename(String(item.url).split('?')[0].split('#')[0]) : null);
      }

      if (!key) {
        const err = new Error('Invalid attachment reference.');
        err.status = 400;
        throw err;
      }

      const cleanUrl = urlStr ? urlStr.split('?')[0].split('#')[0] : null;
      const staging = await db.get(
        `SELECT * FROM post_attachment_staging 
         WHERE id = ? OR filename = ? OR url = ?`,
        key, key, (cleanUrl || key)
      );

      if (!staging) {
        const err = new Error('Invalid or expired attachment reference.');
        err.status = 400;
        throw err;
      }

      if (staging.uploader_student_id !== studentId) {
        const err = new Error('You do not own this attachment.');
        err.status = 403;
        throw err;
      }

      if (Number(staging.is_committed) === 1) {
        if (allowCommittedForPostId && Number(staging.post_id) === Number(allowCommittedForPostId)) {
          // Allowed: already belongs to this post being edited
        } else {
          const err = new Error('Attachment has already been committed to another post.');
          err.status = 409;
          throw err;
        }
      }

      // Authoritative metadata loaded from server storage, NOT trusting client JSON!
      validated.push({
        stagingId: staging.id,
        filename: staging.filename,
        url: staging.url,
        media_type: staging.media_type || 'image',
        mime_type: staging.mime_type || null,
        file_name: staging.file_name || null,
        file_size: staging.file_size ? Number(staging.file_size) : null
      });
    }

    return validated;
  }


  async function attachMediaToPosts(posts) {
    if (!Array.isArray(posts) || posts.length === 0) return posts;
    const postIds = posts.map(p => Number(p.id)).filter(id => Number.isInteger(id) && id > 0);
    if (postIds.length === 0) return posts;

    const placeholders = postIds.map(() => '?').join(',');
    let mediaRows = [];
    try {
      mediaRows = await db.all(
        `SELECT id, post_id, media_type, url, mime_type, file_name, file_size, sort_order, created_at
         FROM post_media
         WHERE post_id IN (${placeholders})
         ORDER BY sort_order ASC, id ASC`,
        ...postIds
      );
    } catch (err) {
      // Table may not have been queried yet
      console.warn('[Post Media Fetch Warning]:', err.message);
    }

    const mediaByPost = new Map();
    for (const row of mediaRows) {
      const pid = Number(row.post_id);
      if (!mediaByPost.has(pid)) mediaByPost.set(pid, []);
      mediaByPost.get(pid).push({
        id: Number(row.id),
        post_id: pid,
        media_type: row.media_type || 'image',
        type: row.media_type || 'image',
        url: row.url,
        mime_type: row.mime_type || null,
        file_name: row.file_name || (row.media_type === 'image' ? path.basename(row.url) : null),
        file_size: row.file_size ? Number(row.file_size) : null,
        sort_order: Number(row.sort_order || 0),
        created_at: row.created_at
      });
    }

    for (const post of posts) {
      const pid = Number(post.id);
      const mediaList = mediaByPost.get(pid) || [];
      if (mediaList.length > 0) {
        post.media = mediaList;
        if (!post.attachment_url) {
          const firstImg = mediaList.find(m => m.media_type === 'image') || mediaList[0];
          post.attachment_url = firstImg?.url || null;
        }
      } else if (post.attachment_url) {
        const cleanUrl = String(post.attachment_url).split('?')[0].split('#')[0];
        const ext = path.extname(cleanUrl).toLowerCase();
        const isDoc = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.zip'].includes(ext);
        const mediaType = isDoc ? 'file' : 'image';
        post.media = [{
          id: 0,
          post_id: pid,
          media_type: mediaType,
          type: mediaType,
          url: post.attachment_url,
          mime_type: isDoc ? (documentExtensions[ext] || 'application/octet-stream') : (imageExtensions[ext] || 'image/jpeg'),
          file_name: path.basename(cleanUrl),
          file_size: null,
          sort_order: 0,
          created_at: post.created_at
        }];
      } else {
        post.media = [];
      }
    }
    return posts;
  }

  async function attachTargetSemestersToPosts(posts) {
    if (!Array.isArray(posts) || posts.length === 0) return posts;
    const postIds = posts.map(p => Number(p.id)).filter(id => Number.isInteger(id) && id > 0);
    if (postIds.length === 0) return posts;

    const placeholders = postIds.map(() => '?').join(',');
    let semesterRows = [];
    try {
      semesterRows = await db.all(
        `SELECT post_id, semester FROM post_target_semesters WHERE post_id IN (${placeholders}) ORDER BY semester ASC`,
        ...postIds
      );
    } catch (_) { }

    const semestersByPost = new Map();
    for (const row of semesterRows) {
      const pid = Number(row.post_id);
      if (!semestersByPost.has(pid)) semestersByPost.set(pid, []);
      semestersByPost.get(pid).push(Number(row.semester));
    }

    for (const post of posts) {
      const pid = Number(post.id);
      const isAllSem = post.target_all_semesters === undefined || post.target_all_semesters === null || Number(post.target_all_semesters) === 1;
      const sems = isAllSem ? [] : (semestersByPost.get(pid) || []);
      post.targetSemesters = sems;
      post.target_semesters = sems;
      post.allSemesters = isAllSem;
      post.target_all_semesters = isAllSem ? 1 : 0;
      post.category = post.category || DEFAULT_POST_CATEGORY;
      post.category_label = CATEGORY_LABELS[post.category] || 'General';
      post.semester_display = formatSemesterDisplay(sems, isAllSem);
    }
    return posts;
  }

  function formatPost(post, req) {
    const isOfficialNotice = post.type === 'notice' && ['admin', 'cr', 'teacher'].includes(post.role);
    const isAuthor = post.user_id === req.postUser?.studentId;
    const isAdmin = req.postUser?.role === 'admin';
    const categoryKey = post.category || DEFAULT_POST_CATEGORY;
    const visibilityKey = post.visibility || DEFAULT_POST_VISIBILITY;
    const isAllSemesters = post.target_all_semesters === undefined || post.target_all_semesters === null || Number(post.target_all_semesters) === 1;
    const targetSemesters = Array.isArray(post.targetSemesters) ? post.targetSemesters : (Array.isArray(post.target_semesters) ? post.target_semesters : []);

    return {
      ...post,
      id: Number(post.id),
      title: categoryKey === 'general' ? null : (post.title || null),
      category: categoryKey,
      category_label: CATEGORY_LABELS[categoryKey] || 'General',
      visibility: visibilityKey,
      audience: visibilityKey,
      targetSemesters: isAllSemesters ? [] : targetSemesters,
      target_semesters: isAllSemesters ? [] : targetSemesters,
      allSemesters: isAllSemesters,
      target_all_semesters: isAllSemesters ? 1 : 0,
      semester_display: formatSemesterDisplay(targetSemesters, isAllSemesters),
      edited_at: post.edited_at || null,
      edited: Boolean(post.edited_at),
      like_count: Number(post.like_count),
      comment_count: Number(post.comment_count || 0),
      submission_count: Number(post.submission_count),
      liked_by_me: Boolean(post.liked_by_me),
      // Keep the original response fields for already-open dashboard clients.
      likeCount: Number(post.like_count),
      commentCount: Number(post.comment_count || 0),
      submittedCount: Number(post.submission_count),
      liked: Boolean(post.liked_by_me),
      cohortId: post.cohort_id || post.cohortId || null,
      cohort_id: post.cohort_id || post.cohortId || null,
      semesterNo: post.semester_no !== undefined ? post.semester_no : (post.semesterNo !== undefined ? post.semesterNo : null),
      semester_no: post.semester_no !== undefined ? post.semester_no : (post.semesterNo !== undefined ? post.semesterNo : null),
      audienceScope: post.audience_scope || post.audienceScope || 'all_students',
      audience_scope: post.audience_scope || post.audienceScope || 'all_students',
      is_official: isOfficialNotice,
      moderation_status: post.moderation_status || 'active',
      is_removed: post.moderation_status === 'removed',
      moderated_at: post.moderated_at || null,
      moderation_reason: post.moderation_status === 'removed' ? (isAdmin ? (post.moderation_reason || null) : null) : null,
      canDelete: isAuthor || isAdmin,
      canEdit: isAuthor || isAdmin,
      media: Array.isArray(post.media) ? post.media : []
    };
  }

  function assertAudienceAccess(req, post) {
    if (!post) return false;
    const visibility = post.visibility || DEFAULT_POST_VISIBILITY;
    if (visibility === 'everyone') return true;

    if (visibility === 'students_only') {
      const viewerId = req.postUser?.studentId || req.student?.studentId || req.user?.studentId || req.session?.studentId;
      if (!viewerId) return false;

      // Author can always see their own post
      if (post.user_id === viewerId) return true;

      const viewerRole = req.postUser?.role || req.student?.role || req.user?.role || 'student';

      // Audited moderation path for authorized administrators
      if (viewerRole === 'admin' && (req.query?.moderation === 'true' || req.query?.moderation === '1')) {
        return true;
      }

      // Teachers are blocked from students_only posts in normal feeds and direct links
      if (viewerRole === 'teacher') return false;

      // Admins in normal feed / direct link without explicit ?moderation=true are blocked
      if (viewerRole === 'admin') return false;

      // Eligible students and CRs are allowed
      if (['student', 'cr'].includes(viewerRole) || (!['admin', 'teacher'].includes(viewerRole))) {
        return true;
      }

      return false;
    }

    return true;
  }

  router.get('/meta', (req, res) => {
    const userRole = req.postUser?.role || 'student';
    const canPostNotice = ['admin', 'cr', 'teacher'].includes(userRole);
    const canSelectAudience = ['student', 'cr'].includes(userRole) || (!['admin', 'teacher'].includes(userRole));
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json({
      categories: VALID_POST_CATEGORIES.map(cat => ({
        id: cat,
        label: CATEGORY_LABELS[cat]
      })),
      defaultCategory: DEFAULT_POST_CATEGORY,
      semesters: VALID_SEMESTERS,
      defaultTargetSemesters: 'all',
      visibilities: VALID_POST_VISIBILITIES,
      defaultVisibility: DEFAULT_POST_VISIBILITY,
      canPostNotice,
      canSelectAudience
    });
  });

  router.get('/', async (req, res, next) => {
    try {
      const { limit = '20', before, type, official, studentId, authorStudentId, category, semester, targetSemester } = req.query;
      if (!positiveId(limit) || Number(limit) > 100 || (before !== undefined && !positiveId(before))) {
        return res.status(400).json({ message: 'Use a limit from 1 to 100 and a positive before ID.' });
      }
      if (type !== undefined && !['status', 'assignment', 'notice'].includes(type)) {
        return res.status(400).json({ message: 'Invalid post type filter.' });
      }
      const viewerStudentId = req.session?.studentId || req.user?.studentId || req.postUser?.studentId || null;
      const params = [viewerStudentId];
      const whereConditions = [];

      // Server-authoritative academic & cohort filtering
      const context = await getAcademicContext(db, req);
      const academicFilter = buildAcademicContentFilter(context, {
        tableAlias: 'p',
        requestedCohortId: req.query.cohortId || req.query.cohort_id
      });
      whereConditions.push(academicFilter.sql);
      params.push(...academicFilter.params);

      // Moderation filter: removed posts are hidden from all feeds, search, and list endpoints
      const modAvail = await isModerationSchemaAvailable(db);
      if (modAvail) {
        whereConditions.push("(p.moderation_status IS NULL OR p.moderation_status = 'active')");
      }

      // Category filter
      if (category !== undefined && category !== 'all' && category !== '') {
        const cat = normalizeCategory(category);
        if (!cat) {
          return res.status(400).json({ message: 'Invalid category filter. Choose Notice, General, Announcement, News, Complaints, or Feedback.' });
        }
        whereConditions.push('p.category = ?');
        params.push(cat);
      }

      // Parse any requested semester filter from query params
      const requestedSemesterParam = semester || req.query.semester_no || targetSemester || req.query.target_semester;
      const parsedReqSem = (requestedSemesterParam && requestedSemesterParam !== 'all')
        ? parseSemesterNumber(requestedSemesterParam)
        : null;

      const viewerRole = req.postUser?.role || 'student';
      if (viewerRole === 'admin') {
        // Admins can manage posts across all semesters.
        // Optional semester filtering narrows the view if requested.
        if (parsedReqSem) {
          whereConditions.push('(p.target_all_semesters = 1 OR EXISTS (SELECT 1 FROM post_target_semesters pts WHERE pts.post_id = p.id AND pts.semester = ?))');
          params.push(parsedReqSem);
        }
      } else if (viewerRole === 'teacher') {
        // Teacher visibility:
        // 1. Posts authored by that teacher (always visible, even if targeting another semester)
        // 2. Official university notices
        // 3. Relevant authorized announcements (targeting teacher's semesters or all semesters)
        // 4. Student posts targeting semesters where teacher has an assigned class (or all semesters)
        // Hidden from teachers:
        // - Ordinary posts from other teachers
        // - Student posts unrelated to teacher's assigned semesters
        // - Student-only posts restricted from teachers (enforced in audience filtering)
        const teacherAssignedSemesters = await getTeacherAssignedSemesters(db, viewerStudentId);
        if (teacherAssignedSemesters.length > 0) {
          const placeholders = teacherAssignedSemesters.map(() => '?').join(',');
          whereConditions.push(`(
            p.user_id = ?
            OR ((p.type = 'notice' OR p.category = 'notice') AND s.role IN ('admin', 'cr', 'teacher'))
            OR (
              p.category = 'announcement'
              AND s.role IN ('admin', 'cr', 'teacher')
              AND (p.target_all_semesters = 1 OR EXISTS (SELECT 1 FROM post_target_semesters pts_ta WHERE pts_ta.post_id = p.id AND pts_ta.semester IN (${placeholders})))
            )
            OR (
              (s.role IS NULL OR s.role NOT IN ('teacher', 'admin'))
              AND (p.target_all_semesters = 1 OR EXISTS (SELECT 1 FROM post_target_semesters pts_ts WHERE pts_ts.post_id = p.id AND pts_ts.semester IN (${placeholders})))
            )
          )`);
          params.push(viewerStudentId, ...teacherAssignedSemesters, ...teacherAssignedSemesters);
        } else {
          whereConditions.push(`(
            p.user_id = ?
            OR ((p.type = 'notice' OR p.category = 'notice') AND s.role IN ('admin', 'cr', 'teacher'))
            OR (
              p.category = 'announcement'
              AND s.role IN ('admin', 'cr', 'teacher')
              AND p.target_all_semesters = 1
            )
            OR (
              (s.role IS NULL OR s.role NOT IN ('teacher', 'admin'))
              AND p.target_all_semesters = 1
            )
          )`);
          params.push(viewerStudentId);
        }

        // Additional requested semester filter narrows results within teacher's scope
        if (parsedReqSem) {
          whereConditions.push('(p.target_all_semesters = 1 OR EXISTS (SELECT 1 FROM post_target_semesters pts_req WHERE pts_req.post_id = p.id AND pts_req.semester = ?))');
          params.push(parsedReqSem);
        }
      } else {
        // Student & CR visibility:
        // Strictly enforced using server-side academic context.
        // A requested semester parameter must NEVER expand student's authorized visibility.
        const studentSem = parseSemesterNumber(context.cohort?.currentSemester || context.semester || req.postUser?.semester);
        if (studentSem) {
          whereConditions.push(`(
            p.user_id = ?
            OR p.target_all_semesters = 1
            OR EXISTS (SELECT 1 FROM post_target_semesters pts_s WHERE pts_s.post_id = p.id AND pts_s.semester = ?)
            OR ((p.type = 'notice' OR p.category = 'notice') AND s.role IN ('admin', 'cr', 'teacher'))
          )`);
          params.push(viewerStudentId, studentSem);
        } else {
          whereConditions.push(`(
            p.user_id = ?
            OR p.target_all_semesters = 1
            OR ((p.type = 'notice' OR p.category = 'notice') AND s.role IN ('admin', 'cr', 'teacher'))
          )`);
          params.push(viewerStudentId);
        }

        // Additional requested semester filter: narrows the feed, but NEVER expands beyond studentSem
        if (parsedReqSem) {
          whereConditions.push('(p.target_all_semesters = 1 OR EXISTS (SELECT 1 FROM post_target_semesters pts_req WHERE pts_req.post_id = p.id AND pts_req.semester = ?))');
          params.push(parsedReqSem);
        }
      }

      // Audience visibility filtering
      const isStaffViewer = ['admin', 'teacher'].includes(viewerRole);
      const isModerationView = viewerRole === 'admin' && (req.query.moderation === 'true' || req.query.moderation === '1');

      const filterVisibility = req.query.visibility || req.query.audience;
      if (filterVisibility && filterVisibility !== 'all') {
        const normVis = normalizeVisibility(filterVisibility);
        if (normVis) {
          if (normVis === 'students_only') {
            if (isStaffViewer && !isModerationView) {
              whereConditions.push('1 = 0');
            } else {
              whereConditions.push('p.visibility = ?');
              params.push('students_only');
            }
          } else {
            whereConditions.push("(p.visibility = 'everyone' OR p.visibility IS NULL OR p.visibility = '')");
          }
        }
      } else if (isStaffViewer && !isModerationView) {
        // In normal feeds, teachers and admins only see everyone posts or their own posts
        whereConditions.push("(p.visibility = 'everyone' OR p.visibility IS NULL OR p.visibility = '' OR p.user_id = ?)");
        params.push(viewerStudentId);
      }

      const searchQuery = (req.query.q || req.query.search || '').trim();
      if (searchQuery) {
        whereConditions.push('(p.content LIKE ? OR p.title LIKE ?)');
        params.push(`%${searchQuery}%`, `%${searchQuery}%`);
      }

      const targetAuthor = studentId || authorStudentId;
      if (targetAuthor) {
        whereConditions.push('p.user_id = ?');
        params.push(String(targetAuthor));
      }
      if (before !== undefined) {
        whereConditions.push('p.id < ?');
        params.push(Number(before));
      }
      if (type !== undefined) {
        whereConditions.push('p.type = ?');
        params.push(type);
        if (type === 'notice') {
          whereConditions.push("s.role IN ('admin', 'cr', 'teacher')");
        }
      }
      if (official === 'true' && type !== 'notice') {
        whereConditions.push("s.role IN ('admin', 'cr', 'teacher')");
      }
      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
      params.push(Number(limit) + 1);
      const selectPosts = buildSelectPosts(modAvail);
      const rows = await db.all(`${selectPosts}
        ${whereClause} ORDER BY p.id DESC LIMIT ?`, ...params);
      const hasMore = rows.length > Number(limit);
      const posts = rows.slice(0, Number(limit)).map(row => formatPost(row, req));
      await attachMediaToPosts(posts);
      await attachTargetSemestersToPosts(posts);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ posts, nextCursor: hasMore ? posts[posts.length - 1].id : null });
    } catch (err) {
      next(err);
    }
  });

  // Single Attachment Upload Endpoint: independent upload stays safely below Vercel's request ceiling
  router.post('/attachments', upload.any(), async (req, res, next) => {
    try {
      const studentId = req.postUser?.studentId;
      if (!studentId) {
        return res.status(403).json({ message: 'Sign in with a student account to upload attachments.' });
      }

      const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
      if (!file) {
        return res.status(400).json({ message: 'Please select a file to upload.' });
      }

      if (file.size > MAX_ATTACHMENT_BYTES_PER_FILE) {
        await removeUploadedImage(file.path);
        return res.status(413).json({
          message: 'Files must be 4 MB or smaller. For larger study materials, upload them to Semester Library.'
        });
      }

      const isImg = file.mimetype && file.mimetype.startsWith('image/');
      const mediaType = isImg ? 'image' : 'file';

      const fileBuffer = await fs.promises.readFile(file.path);
      const saved = await db.saveFileBlob(file.filename, fileBuffer, file.mimetype);
      if (!saved) {
        await removeUploadedImage(file.path);
        return res.status(500).json({ message: 'Could not persist attachment.' });
      }

      const attachmentId = crypto.randomUUID();
      const relativeUrl = `/uploads/posts/${file.filename}`;
      const nowIso = new Date().toISOString();

      await db.run(
        `INSERT INTO post_attachment_staging 
         (id, filename, url, uploader_student_id, media_type, mime_type, file_name, file_size, is_committed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        attachmentId,
        file.filename,
        relativeUrl,
        studentId,
        mediaType,
        file.mimetype || null,
        file.originalname || null,
        file.size || null,
        nowIso
      );

      res.status(201).json({
        id: attachmentId,
        url: relativeUrl,
        filename: file.filename,
        media_type: mediaType,
        mime_type: file.mimetype,
        file_name: file.originalname || null,
        file_size: file.size || null
      });
    } catch (err) {
      if (req.files) {
        for (const f of req.files) await removeUploadedImage(f.path);
      } else if (req.file) {
        await removeUploadedImage(req.file.path);
      }
      next(err);
    }
  });

  // Safe Unattached Blob Cleanup Endpoint
  router.delete('/attachments/:filename', async (req, res, next) => {
    try {
      const studentId = req.postUser?.studentId;
      if (!studentId) {
        return res.status(403).json({ message: 'Authentication required.' });
      }

      const filename = req.params.filename;
      if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(filename)) {
        return res.status(400).json({ message: 'Invalid attachment filename.' });
      }

      const fileUrl = `/uploads/posts/${filename}`;
      const altUrl = `uploads/posts/${filename}`;

      // Only delete if NOT referenced by any post or post_media
      const inPosts = await db.get('SELECT COUNT(*) AS c FROM posts WHERE attachment_url = ? OR attachment_url = ?', fileUrl, altUrl);
      const inMedia = await db.get('SELECT COUNT(*) AS c FROM post_media WHERE url = ? OR url = ?', fileUrl, altUrl);

      if ((Number(inPosts?.c || 0) + Number(inMedia?.c || 0)) > 0) {
        return res.status(409).json({ message: 'Cannot delete attachment that is in use by an active post.' });
      }

      const staging = await db.get(
        'SELECT * FROM post_attachment_staging WHERE filename = ?',
        filename
      );

      if (staging) {
        // Enforce ownership: only the uploader (or admin) may delete their uncommitted staged blob
        if (staging.uploader_student_id !== studentId && req.postUser?.role !== 'admin') {
          return res.status(403).json({ message: 'You do not have permission to delete this attachment.' });
        }
        if (Number(staging.is_committed) === 1) {
          return res.status(409).json({ message: 'Cannot delete attachment that is in use by an active post.' });
        }
      } else {
        const blobExists = typeof db.getFileBlob === 'function' ? await db.getFileBlob(filename) : null;
        if (!blobExists) {
          return res.status(404).json({ message: 'Attachment not found.' });
        }
        if (req.postUser?.role !== 'admin') {
          return res.status(403).json({ message: 'You do not have permission to delete this attachment.' });
        }
      }

      await db.deleteFileBlob(filename);
      await removeUploadedImage(path.join(uploadDir, filename));
      await db.run('DELETE FROM post_attachment_staging WHERE filename = ?', filename);

      res.json({ ok: true, deleted: filename, message: 'Attachment deleted successfully.' });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireLogin, upload.any(), async (req, res, next) => {
    const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);

    async function rejectPost(message, status = 400) {
      for (const f of uploadedFiles) await removeUploadedImage(f.path);
      if (Array.isArray(req.savedBlobs) && req.savedBlobs.length > 0) {
        await cleanupUnattachedBlobs(req.savedBlobs);
      }
      return res.status(status).json({ message });
    }

    let allAttachments = [];

    try {
      let { content, type = 'status' } = req.body || {};
      let attachment_url = req.body?.attachment_url ?? null;

      // 1. Collect pre-uploaded attachments from JSON body
      let incomingAttachments = [];
      if (Array.isArray(req.body?.attachments)) {
        incomingAttachments = [...req.body.attachments];
      } else if (typeof req.body?.attachments === 'string') {
        try {
          const parsed = JSON.parse(req.body.attachments);
          if (Array.isArray(parsed)) incomingAttachments = [...parsed];
        } catch (_) {}
      }

      // 2. Validate individual uploaded files (if sent via direct multipart)
      for (const f of uploadedFiles) {
        if (f.size > MAX_ATTACHMENT_BYTES_PER_FILE) {
          return rejectPost('Files must be 4 MB or smaller. For larger study materials, upload them to Semester Library.', 413);
        }
      }

      // Validate pre-uploaded staged attachments against server database
      // Loads authoritative metadata; rejects cross-user hijacking, forged URLs, and replay
      let validatedStaged = [];
      if (incomingAttachments.length > 0) {
        try {
          validatedStaged = await resolveAndValidateAttachments(incomingAttachments, req.postUser.studentId);
        } catch (valErr) {
          return rejectPost(valErr.message, valErr.status || 400);
        }
      }

      // Handle legacy attachment_url if passed as local post upload
      if (typeof attachment_url === 'string' && /^\/?uploads\/posts\/[a-f0-9-]+\.[a-z0-9]+$/i.test(attachment_url)) {
        try {
          const legacyValidated = await resolveAndValidateAttachments([attachment_url], req.postUser.studentId);
          validatedStaged.push(...legacyValidated);
        } catch (valErr) {
          return rejectPost(valErr.message, valErr.status || 400);
        }
      }

      // Persist any direct multipart files, register into post_attachment_staging, and add to allAttachments
      const newlySavedBlobs = [];
      req.savedBlobs = newlySavedBlobs;
      const directAttachments = [];

      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const isImg = file.mimetype && file.mimetype.startsWith('image/');
        const mediaType = isImg ? 'image' : 'file';
        const fileBuffer = await fs.promises.readFile(file.path);
        const saved = await db.saveFileBlob(file.filename, fileBuffer, file.mimetype);
        if (!saved) throw new Error('Could not persist post attachment.');
        newlySavedBlobs.push(file.filename);

        const attachmentId = crypto.randomUUID();
        const relativeUrl = `/uploads/posts/${file.filename}`;
        const nowIso = new Date().toISOString();

        await db.run(
          `INSERT INTO post_attachment_staging 
           (id, filename, url, uploader_student_id, media_type, mime_type, file_name, file_size, is_committed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          attachmentId,
          file.filename,
          relativeUrl,
          req.postUser.studentId,
          mediaType,
          file.mimetype || null,
          file.originalname || null,
          file.size || null,
          nowIso
        );

        directAttachments.push({
          stagingId: attachmentId,
          filename: file.filename,
          url: relativeUrl,
          media_type: mediaType,
          mime_type: file.mimetype || null,
          file_name: file.originalname || null,
          file_size: file.size || null
        });
      }

      allAttachments = [...validatedStaged, ...directAttachments];

      // 3. Validate image/document count limits
      const totalImages = allAttachments.filter(a => a.media_type === 'image');
      if (totalImages.length > 10) {
        return rejectPost('Maximum 10 images allowed per post.');
      }

      const totalDocs = allAttachments.filter(a => a.media_type === 'file');
      if (totalDocs.length > 5) {
        return rejectPost('Maximum 5 files allowed per post.');
      }

      const rawContent = typeof content === 'string' ? content : '';
      const trimmedContent = rawContent.trim();
      const hasText = trimmedContent.length > 0;
      const hasAttachments = allAttachments.length > 0 || Boolean(attachment_url);

      if (!hasText && !hasAttachments) {
        return rejectPost('Post must contain either text content or at least one photo or file.');
      }
      if (trimmedContent.length > 1000000) {
        return rejectPost('Post content cannot exceed 1,000,000 characters.');
      }
      if (!['status', 'assignment', 'notice'].includes(type)) {
        return rejectPost('Choose status, assignment, or notice.');
      }
      if (type === 'notice') {
        const canPostNotice = ['admin', 'cr', 'teacher'].includes(req.postUser?.role);
        if (!canPostNotice) {
          return rejectPost('Only authorized roles (admin, CR, teacher) can publish notices.', 403);
        }
      }
      if (type === 'assignment') {
        const canPostAssignment = ['admin', 'teacher'].includes(req.postUser?.role);
        if (!canPostAssignment) {
          return rejectPost('Only teachers and administrators can create assignments.', 403);
        }
      }
      const isOfficial = type === 'notice' || (['admin', 'cr', 'teacher'].includes(req.postUser?.role) && Boolean(req.body?.official === true || req.body?.official === 'true' || req.body?.is_official === true));

      if (allAttachments.length > 0) {
        const firstImg = allAttachments.find(m => m.media_type === 'image') || allAttachments[0];
        attachment_url = firstImg.url;
      } else if (attachment_url !== null) {
        let url;
        try { url = typeof attachment_url === 'string' && new URL(attachment_url); } catch (_) { }
        if (!url || !['http:', 'https:'].includes(url.protocol) || attachment_url.length > 2048) {
          return rejectPost('Attachment must be an HTTP or HTTPS URL.');
        }
      }

      // Category validation
      let validatedCategory = DEFAULT_POST_CATEGORY;
      if (req.body?.category !== undefined && req.body?.category !== null && req.body?.category !== '') {
        const cat = normalizeCategory(req.body.category);
        if (!cat) {
          return rejectPost('Invalid category. Choose Notice, General, Announcement, News, Complaints, or Feedback.', 400);
        }
        validatedCategory = cat;
      }

      if (validatedCategory === 'notice') {
        const canPostNotice = ['admin', 'cr', 'teacher'].includes(req.postUser?.role);
        if (!canPostNotice) {
          return rejectPost('Only authorized roles (admin, CR, teacher) can publish notices.', 403);
        }
        type = 'notice';
      }
      if (type === 'notice') {
        validatedCategory = 'notice';
      }

      // Audience / Visibility validation
      let validatedVisibility = DEFAULT_POST_VISIBILITY;
      const requestedVisibility = req.body?.visibility !== undefined ? req.body.visibility : (req.body?.audience !== undefined ? req.body.audience : undefined);
      if (requestedVisibility !== undefined && requestedVisibility !== null && requestedVisibility !== '') {
        const normVis = normalizeVisibility(requestedVisibility);
        if (!normVis) {
          return rejectPost('Invalid audience visibility. Choose everyone or students_only.', 400);
        }
        if (normVis === 'students_only') {
          const isStudentOrCr = ['student', 'cr'].includes(req.postUser?.role) || (!['admin', 'teacher'].includes(req.postUser?.role));
          if (!isStudentOrCr) {
            return rejectPost('Only students and CRs can set audience visibility to students_only.', 403);
          }
        }
        validatedVisibility = normVis;
      }

      // Target semesters validation
      let parsedSemesters = { allSemesters: true, semesters: [] };
      try {
        parsedSemesters = parseAndValidateTargetSemesters(
          req.body?.targetSemesters !== undefined ? req.body.targetSemesters : (req.body?.target_semesters !== undefined ? req.body.target_semesters : req.body?.semesters),
          req.body?.allSemesters !== undefined ? req.body.allSemesters : req.body?.target_all_semesters
        );
      } catch (semErr) {
        return rejectPost(semErr.message, 400);
      }

      const rawTitle = (req.body?.title || req.body?.heading || '').trim();
      const passedTitle = validatedCategory === 'general' ? null : (rawTitle.length > 0 ? rawTitle : null);
      if (passedTitle && passedTitle.length > 200) {
        return rejectPost('Post title cannot exceed 200 characters.', 400);
      }

      let newPostId = null;
      let postRow = null;

      const academicCtx = await getAcademicContext(db, req);
      const isNotice = type === 'notice';
      const publishScope = await resolvePublishScope(db, academicCtx, req.body, { isNotice });

      let postAudienceScope = publishScope.audienceScope;
      let postCohortId = publishScope.cohortId;
      let postSemesterNo = publishScope.semesterNo;
      // Feed posts with semester targeting or targeting all semesters apply across cohorts to the specified semesters
      if (!req.body?.cohort_id && !req.body?.cohortId) {
        postAudienceScope = 'all_students';
        postCohortId = null;
      }

      if (parsedSemesters.allSemesters) {
        postSemesterNo = null;
      } else if (parsedSemesters.semesters.length === 1) {
        postSemesterNo = parsedSemesters.semesters[0];
      } else {
        postSemesterNo = null;
      }

      // Atomic DB Transaction for post creation, attachment insertion, and staging commitment
      await runTransaction(async (tx) => {
        const result = await tx.run(
          `INSERT INTO posts (user_id, title, content, type, category, visibility, target_all_semesters, attachment_url, cohort_id, semester_no, audience_scope, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          req.postUser.studentId, passedTitle, trimmedContent, type, validatedCategory, validatedVisibility, parsedSemesters.allSemesters ? 1 : 0, attachment_url, postCohortId, postSemesterNo, postAudienceScope, new Date().toISOString()
        );
        newPostId = result.lastInsertRowid;

        if (!parsedSemesters.allSemesters && parsedSemesters.semesters.length > 0) {
          for (const s of parsedSemesters.semesters) {
            await tx.run('INSERT INTO post_target_semesters (post_id, semester) VALUES (?, ?)', newPostId, s);
          }
        }

        for (let i = 0; i < allAttachments.length; i++) {
          const media = allAttachments[i];
          await tx.run(
            `INSERT INTO post_media (post_id, media_type, url, mime_type, file_name, file_size, sort_order, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            newPostId, media.media_type, media.url, media.mime_type, media.file_name, media.file_size, i, new Date().toISOString()
          );

          if (media.stagingId) {
            const updateResult = await tx.run(
              'UPDATE post_attachment_staging SET is_committed = 1, post_id = ? WHERE id = ? AND is_committed = 0',
              newPostId, media.stagingId
            );
            const changes = updateResult ? (updateResult.changes ?? updateResult.rowCount ?? 1) : 1;
            if (changes === 0) {
              const err = new Error('Attachment has already been committed to another post.');
              err.status = 409;
              throw err;
            }
          }
        }

        const modAvail = await isModerationSchemaAvailable(tx);
        postRow = await tx.get(`${buildSelectPosts(modAvail)} WHERE p.id = ?`, req.postUser.studentId, newPostId);
      });
      req.postCreated = true;

      const formatted = formatPost(postRow, req);
      await attachMediaToPosts([formatted]);
      await attachTargetSemestersToPosts([formatted]);

      // Push notification outbox enqueue and bounded synchronous dispatch (isolated failure)
      try {
        const { enqueuePostOrNoticePush, dispatchImmediateOutbox } = require('../lib/push-notifications');
        const enqueueResult = await enqueuePostOrNoticePush(db, {
          postId: newPostId,
          authorStudentId: req.postUser.studentId,
          authorName: req.postUser.name,
          type,
          isOfficial,
          role: req.postUser.role,
          title: passedTitle || null,
          content: trimmedContent,
          semester: req.postUser.semester,
          cohortId: publishScope.cohortId,
          semesterNo: publishScope.semesterNo,
          audienceScope: publishScope.audienceScope,
          category: validatedCategory,
          visibility: validatedVisibility,
          audience: validatedVisibility,
          targetSemesters: parsedSemesters.semesters,
          targetAllSemesters: parsedSemesters.allSemesters
        });
        if (enqueueResult && enqueueResult.enqueuedCount > 0) {
          const isOfficialNotice = type === 'notice' && (Boolean(isOfficial) || ['admin', 'cr', 'teacher'].includes(req.postUser.role));
          await dispatchImmediateOutbox(db, {
            eventType: isOfficialNotice ? 'notice' : 'post',
            eventId: newPostId,
            timeoutMs: 3500
          });
        }
      } catch (pushErr) {
        console.error('[Push Dispatch Warning]:', pushErr.message);
      }

      // F3: Respond immediately to the student so they do not wait for indexing
      res.status(201).json(formatted);

      // KYANA AI 3.0 Knowledge Indexing Hook (Non-blocking via waitUntil / setImmediate)
      const postSyncData = {
        id: newPostId,
        title: passedTitle || formatted.title || trimmedContent.slice(0, 80),
        content: trimmedContent,
        subject: req.body?.subject || null,
        category: validatedCategory,
        visibility: validatedVisibility,
        audience_scope: publishScope.audienceScope,
        cohort_id: publishScope.cohortId,
        semester_no: publishScope.semesterNo || null,
        target_all_semesters: parsedSemesters.allSemesters ? 1 : 0,
        user_id: req.postUser.studentId,
        author_role: req.postUser.role,
        target_semesters: parsedSemesters.allSemesters ? [] : (parsedSemesters.semesters || [])
      };

      const runSyncTask = async () => {
        try {
          const { onPostSaved } = require('../lib/knowledge-sync');
          await onPostSaved(db, postSyncData);
        } catch (syncErr) {
          console.error('[KYANA Knowledge Sync Post Create Error]:', syncErr.message);
        }
      };

      try {
        const { waitUntil } = require('@vercel/functions');
        if (typeof waitUntil === 'function') {
          waitUntil(runSyncTask());
        } else {
          setImmediate(runSyncTask);
        }
      } catch (_) {
        setImmediate(runSyncTask);
      }
    } catch (err) {
      // If final post creation fails, clean up newly uploaded unattached blobs safely (Requirement 8)
      try {
        await cleanupUnattachedBlobs(allAttachments);
      } catch (cleanErr) {
        console.error('[Post Failure Blob Cleanup Error]:', cleanErr.message);
      }
      for (const f of uploadedFiles) await removeUploadedImage(f.path);
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  });

  router.param('id', (req, res, next, id) => {
    if (!positiveId(id)) return res.status(400).json({ message: 'Invalid post ID.' });
    next();
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const postId = Number(req.params.id);
      if (!Number.isInteger(postId) || postId <= 0) {
        return res.status(400).json({ message: 'Invalid post ID.' });
      }
      const currentUserId = req.student?.studentId || req.user?.studentId || req.session?.studentId || null;
      const modAvail = await isModerationSchemaAvailable(db);
      const row = await db.get(`${buildSelectPosts(modAvail)} WHERE p.id = ?`, currentUserId, postId);
      if (!row) return res.status(404).json({ message: 'Post not found.' });

      if (modAvail && row.moderation_status === 'removed') {
        return res.status(404).json({
          message: 'This post is no longer available as it was removed by moderation.',
          isRemoved: true
        });
      }

      const context = await getAcademicContext(db, req);
      row.targetSemesters = (await db.all('SELECT semester FROM post_target_semesters WHERE post_id = ?', row.id)).map(r => r.semester);
      if (!assertContentAccess(context, row) || !assertAudienceAccess(req, row)) {
        return res.status(404).json({ message: 'Post not found.' });
      }

      // Authoritative semester & role visibility check
      if (!(await assertPostVisibility(db, req, row, context))) {
        return res.status(404).json({ message: 'Post not found.' });
      }

      const formatted = formatPost(row, req);
      await attachMediaToPosts([formatted]);
      await attachTargetSemestersToPosts([formatted]);
      res.setHeader('Cache-Control', 'no-store');
      res.json(formatted);
    } catch (err) {
      next(err);
    }
  });

  async function assertPostVisibility(db, req, post, context) {
    if (!post) return false;
    const viewerId = req.postUser?.studentId || req.student?.studentId || req.user?.studentId || req.session?.studentId || null;
    const viewerRole = req.postUser?.role || req.student?.role || req.user?.role || 'student';
    const isAuthor = Boolean(viewerId && post.user_id === viewerId);

    // 1. Author can always see their own post
    if (isAuthor) return true;

    // 2. Admin can manage posts across all semesters
    if (viewerRole === 'admin') return true;

    // Retrieve post author's role if not already provided on post
    let postAuthorRole = post.role;
    if (postAuthorRole === undefined && post.user_id) {
      try {
        const authorRow = await db.get('SELECT role FROM students WHERE studentId = ?', post.user_id);
        postAuthorRole = authorRow?.role || null;
      } catch (_) {}
    }

    // 3. Official university notices
    const isOfficialNotice = (post.type === 'notice' || post.category === 'notice') &&
      ['admin', 'cr', 'teacher'].includes(postAuthorRole);
    if (isOfficialNotice) return true;

    const isAllSemesters = post.target_all_semesters === undefined ||
      post.target_all_semesters === null ||
      Number(post.target_all_semesters) === 1;

    // 4. Teacher visibility
    if (viewerRole === 'teacher') {
      const isOtherTeacher = postAuthorRole === 'teacher';
      const isAnnouncement = post.category === 'announcement';
      if (isOtherTeacher && !isAnnouncement) {
        // Ordinary post from another teacher is not visible in normal feed or direct lookup
        return false;
      }

      if (isAllSemesters) return true;

      // Check teacher's assigned semesters
      const teacherSemesters = await getTeacherAssignedSemesters(db, viewerId);
      if (teacherSemesters.length === 0) return false;

      const placeholders = teacherSemesters.map(() => '?').join(',');
      const match = await db.get(
        `SELECT 1 AS ok FROM post_target_semesters WHERE post_id = ? AND semester IN (${placeholders}) LIMIT 1`,
        post.id, ...teacherSemesters
      );
      return Boolean(match);
    }

    // 5. Student / CR visibility
    if (isAllSemesters) return true;

    const academicCtx = context || await getAcademicContext(db, req);
    const studentSem = parseSemesterNumber(academicCtx.cohort?.currentSemester || academicCtx.semester || req.postUser?.semester);
    if (!studentSem) return false;

    const hasMatch = await db.get(
      'SELECT 1 AS ok FROM post_target_semesters WHERE post_id = ? AND semester = ? LIMIT 1',
      post.id, studentSem
    );
    return Boolean(hasMatch);
  }

  async function assertSemesterAccess(req, post) {
    const context = await getAcademicContext(db, req);
    return assertPostVisibility(db, req, post, context);
  }

  async function getAndAuthorizePost(req, postId) {
    const modAvail = await isModerationSchemaAvailable(db);
    const post = await db.get(`
      SELECT p.id, p.user_id, p.content, p.cohort_id, p.semester_no, p.audience_scope,
             p.target_all_semesters, p.visibility, p.type, p.category,
             ${modAvail ? 'p.moderation_status' : "'active' AS moderation_status"}, s.role
      FROM posts p
      LEFT JOIN students s ON s.studentId = p.user_id
      WHERE p.id = ?`, postId);
    if (!post) return null;
    if (modAvail && post.moderation_status === 'removed') return null;
    const context = await getAcademicContext(db, req);
    if (!assertContentAccess(context, post)) return null;
    if (!assertAudienceAccess(req, post)) return null;
    if (!(await assertPostVisibility(db, req, post, context))) return null;
    return post;
  }

  async function setLike(req, res, next) {
    try {
      const post = await getAndAuthorizePost(req, Number(req.params.id));
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const liked = req.method === 'POST';
      if (liked) {
        await db.run(`INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)
          ON CONFLICT (post_id, user_id) DO NOTHING`, post.id, req.postUser.studentId);

        if (post.user_id && post.user_id !== req.postUser.studentId) {
          try {
            const notifService = require('../lib/notifications-service');
            const actorName = req.postUser.name || 'A classmate';
            const postPreview = (post.content || 'your post').slice(0, 60);
            await notifService.createNotification(db, {
              type: 'post_reaction',
              actorId: req.postUser.studentId,
              actorName,
              actorAvatar: req.postUser.avatarUrl || null,
              title: `${actorName} reacted to your post`,
              body: `liked "${postPreview}"`,
              entityType: 'post',
              entityId: String(post.id),
              deepLink: `/post/${post.id}`,
              webPath: `dashboard.html?post=${post.id}`,
              groupKey: `post:${post.id}:reactions`,
              recipientUserIds: [post.user_id],
              metadata: { preview: postPreview },
            });
          } catch (notifErr) {
            console.warn('[Post Like Notification Error]:', notifErr.message);
          }
        }
      } else {
        await db.run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', post.id, req.postUser.studentId);
        try {
          const notifService = require('../lib/notifications-service');
          await notifService.removeReactionFromGroup(db, {
            groupKey: `post:${post.id}:reactions`,
            actorId: req.postUser.studentId,
          });
        } catch (unreactErr) {
          console.warn('[Post Unlike Notification Error]:', unreactErr.message);
        }
      }
      const count = await db.get('SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?', post.id);
      res.json({ liked_by_me: liked, like_count: Number(count.c), liked, likeCount: Number(count.c) });
    } catch (err) {
      next(err);
    }
  }

  router.post('/:id/like', setLike);
  router.delete('/:id/like', setLike);

  router.get('/:id/comments', async (req, res, next) => {
    try {
      const postId = Number(req.params.id);
      const post = await getAndAuthorizePost(req, postId);
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const comments = await fetchPostComments(db, postId, req);
      res.setHeader('Cache-Control', 'no-store');
      res.json(comments);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  });

  router.post('/:id/comments', async (req, res, next) => {
    try {
      const postId = Number(req.params.id);
      const post = await getAndAuthorizePost(req, postId);
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const { content, parent_comment_id, parentCommentId, reply_to_user_id, replyToUserId } = req.body || {};
      const result = await createCommentOrReply(db, {
        postId,
        targetParentId: parent_comment_id !== undefined ? parent_comment_id : parentCommentId,
        replyToUserId: reply_to_user_id || replyToUserId,
        content,
        req
      });
      res.status(201).json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  });

  router.get('/:id/comments/:commentId/replies', async (req, res, next) => {
    try {
      const post = await getAndAuthorizePost(req, Number(req.params.id));
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const { limit = '50', offset = '0' } = req.query;
      const replies = await fetchCommentReplies(db, req.params.commentId, req, { limit, offset });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ replies, replyCount: replies.length });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  });

  router.post('/:id/comments/:commentId/replies', async (req, res, next) => {
    try {
      const post = await getAndAuthorizePost(req, Number(req.params.id));
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const { content, reply_to_user_id, replyToUserId } = req.body || {};
      const result = await createCommentOrReply(db, {
        postId: Number(req.params.id),
        targetParentId: req.params.commentId,
        replyToUserId: reply_to_user_id || replyToUserId,
        content,
        req
      });
      res.status(201).json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  });

  const handleEditCommentRoute = async (req, res, next) => {
    try {
      const post = await getAndAuthorizePost(req, Number(req.params.id));
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const { content } = req.body || {};
      const result = await editComment(db, {
        commentId: req.params.commentId,
        content,
        req
      });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  };

  router.put('/:id/comments/:commentId', handleEditCommentRoute);
  router.patch('/:id/comments/:commentId', handleEditCommentRoute);

  router.delete('/:id/comments/:commentId', async (req, res, next) => {
    try {
      const post = await getAndAuthorizePost(req, Number(req.params.id));
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const result = await deleteComment(db, {
        commentId: req.params.commentId,
        postId: Number(req.params.id),
        req
      });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  });

  router.post('/:id/comments/:commentId/reactions', async (req, res, next) => {
    try {
      const post = await getAndAuthorizePost(req, Number(req.params.id));
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const reactionType = req.body?.reaction_type || req.body?.reactionType || req.body?.type || 'like';
      const result = await addCommentReaction(db, {
        commentId: req.params.commentId,
        reactionType,
        req
      });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  });

  const handleRemoveCommentReaction = async (req, res, next) => {
    try {
      const post = await getAndAuthorizePost(req, Number(req.params.id));
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const reactionType = req.params.reactionType || req.body?.reaction_type || req.body?.reactionType || 'like';
      const result = await removeCommentReaction(db, {
        commentId: req.params.commentId,
        reactionType,
        req
      });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  };

  router.delete('/:id/comments/:commentId/reactions', handleRemoveCommentReaction);
  router.delete('/:id/comments/:commentId/reactions/:reactionType', handleRemoveCommentReaction);

  router.post('/:id/comments/:commentId/like', async (req, res, next) => {
    try {
      const post = await getAndAuthorizePost(req, Number(req.params.id));
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const result = await toggleCommentReaction(db, {
        commentId: req.params.commentId,
        reactionType: 'like',
        req
      });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  });

  router.delete('/:id/comments/:commentId/like', handleRemoveCommentReaction);

  const VALID_REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'misinformation', 'other'];

  /**
   * POST /api/posts/:id/report
   * Report a post. Content must be accessible to caller. Prevents duplicate reports.
   */
  router.post('/:id/report', requireLogin, async (req, res, next) => {
    try {
      const postId = Number(req.params.id);
      if (!Number.isInteger(postId) || postId <= 0) {
        return res.status(400).json({ message: 'Invalid post ID.' });
      }

      const reporterId = req.student?.studentId || req.user?.studentId || req.session?.studentId || req.postUser?.studentId;
      if (!reporterId) {
        return res.status(401).json({ message: 'Authentication required to report content.' });
      }

      const reportsAvail = await isContentReportsAvailable(db);
      if (!reportsAvail) {
        return res.status(503).json({
          message: 'Content reporting is temporarily unavailable pending database migration.',
          migrationPending: true
        });
      }

      // Check account suspension
      const reporter = await db.get('SELECT studentId, account_status FROM students WHERE studentId = ?', reporterId);
      if (reporter && (reporter.account_status === 'suspended' || reporter.accountStatus === 'suspended')) {
        return res.status(403).json({ message: 'Suspended accounts cannot submit content reports.' });
      }

      // Verify the post is accessible to the user using existing authorization
      const post = await getAndAuthorizePost(req, postId);
      if (!post) {
        return res.status(404).json({ message: 'Post not found.' });
      }

      if (post.user_id === reporterId) {
        return res.status(400).json({ message: 'You cannot report your own content.' });
      }

      const { reason, description } = req.body || {};
      const cleanReason = (typeof reason === 'string' ? reason.trim().toLowerCase() : '');
      if (!VALID_REPORT_REASONS.includes(cleanReason)) {
        return res.status(400).json({
          message: 'A valid report reason is required (spam, harassment, inappropriate, misinformation, or other).'
        });
      }

      const cleanDesc = (typeof description === 'string' ? description.trim().slice(0, 1000) : null);

      // Duplicate report abuse prevention: check if this user already has an open report on this post
      const existing = await db.get(
        "SELECT id FROM content_reports WHERE reporter_id = ? AND content_type = 'post' AND content_id = ? AND status = 'open'",
        reporterId, postId
      );
      if (existing) {
        return res.status(409).json({ message: 'You have already submitted an active report for this post.' });
      }

      const insertResult = await db.run(
        `INSERT INTO content_reports (content_type, content_id, reporter_id, reason, description, status, created_at)
         VALUES ('post', ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)`,
        postId, reporterId, cleanReason, cleanDesc
      );
      // KYANA AI 3.0 Moderation Threshold Hook (3+ reports -> hidden_at)
      try {
        const countRow = await db.get(
          "SELECT COUNT(*) AS count FROM content_reports WHERE content_type = 'post' AND content_id = ? AND status = 'open'",
          postId
        );
        if (countRow && Number(countRow.count) >= 3) {
          const { onPostModerationChanged } = require('../lib/knowledge-sync');
          await onPostModerationChanged(db, postId, { isHidden: true });
        }
      } catch (modErr) {
        console.error('[KYANA Moderation Sync Error]:', modErr.message);
      }

      res.status(201).json({
        success: true,
        message: 'Report submitted successfully. Community moderators will review this content.',
        reportId: insertResult?.lastInsertRowid || null,
        status: 'open'
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/posts/:id/comments/:commentId/report
   * Report a comment. Parent post and comment must be accessible to caller. Prevents duplicates.
   */
  router.post('/:id/comments/:commentId/report', requireLogin, async (req, res, next) => {
    try {
      const postId = Number(req.params.id);
      const commentId = Number(req.params.commentId);
      if (!Number.isInteger(postId) || postId <= 0 || !Number.isInteger(commentId) || commentId <= 0) {
        return res.status(400).json({ message: 'Invalid post or comment ID.' });
      }

      const reporterId = req.student?.studentId || req.user?.studentId || req.session?.studentId || req.postUser?.studentId;
      if (!reporterId) {
        return res.status(401).json({ message: 'Authentication required to report content.' });
      }

      const reportsAvail = await isContentReportsAvailable(db);
      if (!reportsAvail) {
        return res.status(503).json({
          message: 'Content reporting is temporarily unavailable pending database migration.',
          migrationPending: true
        });
      }

      const reporter = await db.get('SELECT studentId, account_status FROM students WHERE studentId = ?', reporterId);
      if (reporter && (reporter.account_status === 'suspended' || reporter.accountStatus === 'suspended')) {
        return res.status(403).json({ message: 'Suspended accounts cannot submit content reports.' });
      }

      // Verify parent post is accessible
      const post = await getAndAuthorizePost(req, postId);
      if (!post) {
        return res.status(404).json({ message: 'Post not found.' });
      }

      // Verify comment exists on this post
      const modAvail = await isModerationSchemaAvailable(db);
      const comment = await db.get(
        `SELECT id, post_id, user_id, deleted_at ${modAvail ? ', moderation_status' : ''} FROM post_comments WHERE id = ? AND post_id = ?`,
        commentId, postId
      );
      if (!comment || comment.deleted_at || (modAvail && comment.moderation_status === 'removed')) {
        return res.status(404).json({ message: 'Comment not found.' });
      }

      if (comment.user_id === reporterId) {
        return res.status(400).json({ message: 'You cannot report your own content.' });
      }

      const { reason, description } = req.body || {};
      const cleanReason = (typeof reason === 'string' ? reason.trim().toLowerCase() : '');
      if (!VALID_REPORT_REASONS.includes(cleanReason)) {
        return res.status(400).json({
          message: 'A valid report reason is required (spam, harassment, inappropriate, misinformation, or other).'
        });
      }

      const cleanDesc = (typeof description === 'string' ? description.trim().slice(0, 1000) : null);

      // Duplicate report prevention
      const existing = await db.get(
        "SELECT id FROM content_reports WHERE reporter_id = ? AND content_type = 'comment' AND content_id = ? AND status = 'open'",
        reporterId, commentId
      );
      if (existing) {
        return res.status(409).json({ message: 'You have already submitted an active report for this comment.' });
      }

      const insertResult = await db.run(
        `INSERT INTO content_reports (content_type, content_id, reporter_id, reason, description, status, created_at)
         VALUES ('comment', ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)`,
        commentId, reporterId, cleanReason, cleanDesc
      );

      res.status(201).json({
        success: true,
        message: 'Report submitted successfully. Community moderators will review this comment.',
        reportId: insertResult?.lastInsertRowid || null,
        status: 'open'
      });
    } catch (err) {
      next(err);
    }
  });

  const handleEditPost = async (req, res, next) => {
    try {
      const postId = Number(req.params.id);
      const post = await db.get('SELECT * FROM posts WHERE id = ?', postId);
      const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);

      if (!post) {
        for (const f of uploadedFiles) await removeUploadedImage(f.path);
        return res.status(404).json({ message: 'Post not found.' });
      }

      if (post.moderation_status === 'removed') {
        for (const f of uploadedFiles) await removeUploadedImage(f.path);
        return res.status(400).json({ message: 'Cannot edit a post that has been removed by moderation.' });
      }

      // Backend ownership check: Never trust client userId / studentId!
      const isAuthor = post.user_id === req.postUser.studentId;
      const isAdmin = req.postUser.role === 'admin';
      if (!isAuthor && !isAdmin) {
        for (const f of uploadedFiles) await removeUploadedImage(f.path);
        return res.status(403).json({ message: 'Only the original post author can edit this post.' });
      }

      const { content } = req.body || {};
      let newContent = post.content || '';
      if (content !== undefined) {
        if (typeof content !== 'string') {
          for (const f of uploadedFiles) await removeUploadedImage(f.path);
          return res.status(400).json({ message: 'Invalid content format.' });
        }
        if (content.trim().length > 1000000) {
          for (const f of uploadedFiles) await removeUploadedImage(f.path);
          return res.status(400).json({ message: 'Post content cannot exceed 1,000,000 characters.' });
        }
        newContent = content.trim();
      }

      // Category update
      let updatedCategory = post.category || DEFAULT_POST_CATEGORY;
      if (req.body?.category !== undefined && req.body?.category !== null && req.body?.category !== '') {
        const cat = normalizeCategory(req.body.category);
        if (!cat) {
          for (const f of uploadedFiles) await removeUploadedImage(f.path);
          return res.status(400).json({ message: 'Invalid category. Choose Notice, General, Announcement, News, Complaints, or Feedback.' });
        }
        updatedCategory = cat;
      }

      if (updatedCategory === 'notice') {
        const canPostNotice = ['admin', 'cr', 'teacher'].includes(req.postUser?.role);
        if (!canPostNotice) {
          for (const f of uploadedFiles) await removeUploadedImage(f.path);
          return res.status(403).json({ message: 'Only authorized roles (admin, CR, teacher) can publish notices.' });
        }
      }

      // Audience / Visibility update
      let updatedVisibility = post.visibility || DEFAULT_POST_VISIBILITY;
      const requestedVisibility = req.body?.visibility !== undefined ? req.body.visibility : (req.body?.audience !== undefined ? req.body.audience : undefined);
      if (requestedVisibility !== undefined && requestedVisibility !== null && requestedVisibility !== '') {
        const normVis = normalizeVisibility(requestedVisibility);
        if (!normVis) {
          for (const f of uploadedFiles) await removeUploadedImage(f.path);
          return res.status(400).json({ message: 'Invalid audience visibility. Choose everyone or students_only.' });
        }
        if (normVis === 'students_only') {
          const isStudentOrCr = ['student', 'cr'].includes(req.postUser?.role) || (!['admin', 'teacher'].includes(req.postUser?.role));
          if (!isStudentOrCr) {
            for (const f of uploadedFiles) await removeUploadedImage(f.path);
            return res.status(403).json({ message: 'Only students and CRs can set audience visibility to students_only.' });
          }
        }
        updatedVisibility = normVis;
      }

      // Target semesters update
      let updateSemesters = false;
      let parsedSemesters = null;
      if (req.body?.targetSemesters !== undefined || req.body?.target_semesters !== undefined || req.body?.allSemesters !== undefined || req.body?.target_all_semesters !== undefined) {
        try {
          parsedSemesters = parseAndValidateTargetSemesters(
            req.body?.targetSemesters !== undefined ? req.body.targetSemesters : req.body?.target_semesters,
            req.body?.allSemesters !== undefined ? req.body.allSemesters : req.body?.target_all_semesters
          );
          updateSemesters = true;
        } catch (semErr) {
          for (const f of uploadedFiles) await removeUploadedImage(f.path);
          return res.status(400).json({ message: semErr.message });
        }
      }

      let finalTargetAllSem = post.target_all_semesters ?? 1;
      let finalSemesterNo = post.semester_no;

      // Title update: General category NEVER has a title
      let updatedTitle = post.title || null;
      if (updatedCategory === 'general') {
        updatedTitle = null;
      } else if (req.body?.title !== undefined) {
        const t = String(req.body.title).trim();
        if (t.length > 200) {
          for (const f of uploadedFiles) await removeUploadedImage(f.path);
          return res.status(400).json({ message: 'Post title cannot exceed 200 characters.' });
        }
        updatedTitle = t || null;
      }

      // Parse keepMediaUrls and keepMediaIds
      let keepUrls = null;
      if (req.body?.keepMediaUrls !== undefined) {
        if (Array.isArray(req.body.keepMediaUrls)) {
          keepUrls = req.body.keepMediaUrls;
        } else if (typeof req.body.keepMediaUrls === 'string') {
          try {
            const parsed = JSON.parse(req.body.keepMediaUrls);
            if (Array.isArray(parsed)) keepUrls = parsed;
            else keepUrls = [req.body.keepMediaUrls];
          } catch (_) {
            keepUrls = req.body.keepMediaUrls.split(',').map(s => s.trim()).filter(Boolean);
          }
        }
      }

      let keepIds = null;
      if (req.body?.keepMediaIds !== undefined) {
        if (Array.isArray(req.body.keepMediaIds)) {
          keepIds = req.body.keepMediaIds.map(Number);
        } else if (typeof req.body.keepMediaIds === 'string') {
          try {
            const parsed = JSON.parse(req.body.keepMediaIds);
            if (Array.isArray(parsed)) keepIds = parsed.map(Number);
            else keepIds = req.body.keepMediaIds.split(',').map(s => Number(s.trim())).filter(Number.isFinite);
          } catch (_) {
            keepIds = req.body.keepMediaIds.split(',').map(s => Number(s.trim())).filter(Number.isFinite);
          }
        }
      }

      const existingMedia = await db.all(
        'SELECT * FROM post_media WHERE post_id = ? ORDER BY sort_order ASC, id ASC',
        postId
      );

      let keptExistingMedia = existingMedia;
      let removedMedia = [];

      if (keepUrls !== null || keepIds !== null) {
        keptExistingMedia = existingMedia.filter(row => {
          if (keepUrls !== null && !keepUrls.includes(row.url)) return false;
          if (keepIds !== null && !keepIds.includes(Number(row.id))) return false;
          return true;
        });
        removedMedia = existingMedia.filter(row => !keptExistingMedia.some(k => k.id === row.id));
      }

      // Parse newAttachments from JSON body or parse string
      let incomingNewAttachments = [];
      if (Array.isArray(req.body?.newAttachments)) {
        incomingNewAttachments = [...req.body.newAttachments];
      } else if (typeof req.body?.newAttachments === 'string') {
        try {
          const parsed = JSON.parse(req.body.newAttachments);
          if (Array.isArray(parsed)) incomingNewAttachments = [...parsed];
        } catch (_) {}
      }

      // Check each uploaded file if multipart files are sent
      for (const f of uploadedFiles) {
        if (f.size > MAX_ATTACHMENT_BYTES_PER_FILE) {
          for (const file of uploadedFiles) await removeUploadedImage(file.path);
          return res.status(413).json({ message: 'Files must be 4 MB or smaller. For larger study materials, upload them to Semester Library.' });
        }
      }

      // Validate staged new attachments against server database
      let validatedStagedNew = [];
      if (incomingNewAttachments.length > 0) {
        try {
          validatedStagedNew = await resolveAndValidateAttachments(incomingNewAttachments, req.postUser.studentId);
        } catch (valErr) {
          for (const f of uploadedFiles) await removeUploadedImage(f.path);
          return res.status(valErr.status || 400).json({ message: valErr.message });
        }
      }

      // Persist newly uploaded multipart files and stage them
      const savedBlobs = [];
      req.savedBlobs = savedBlobs;
      const directNewAttachments = [];

      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const isImg = file.mimetype && file.mimetype.startsWith('image/');
        const mediaType = isImg ? 'image' : 'file';
        const saved = await db.saveFileBlob(file.filename, await fs.promises.readFile(file.path), file.mimetype);
        if (!saved) throw new Error('Could not persist post attachment.');
        savedBlobs.push(file.filename);

        const attachmentId = crypto.randomUUID();
        const relativeUrl = `/uploads/posts/${file.filename}`;
        const nowIso = new Date().toISOString();

        await db.run(
          `INSERT INTO post_attachment_staging 
           (id, filename, url, uploader_student_id, media_type, mime_type, file_name, file_size, is_committed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          attachmentId,
          file.filename,
          relativeUrl,
          req.postUser.studentId,
          mediaType,
          file.mimetype || null,
          file.originalname || null,
          file.size || null,
          nowIso
        );

        directNewAttachments.push({
          stagingId: attachmentId,
          filename: file.filename,
          url: relativeUrl,
          media_type: mediaType,
          mime_type: file.mimetype || null,
          file_name: file.originalname || null,
          file_size: file.size || null
        });
      }

      const allNewAttachments = [...validatedStagedNew, ...directNewAttachments];

      // Validate structural counts BEFORE database transaction
      const preNewImages = allNewAttachments.filter(a => a.media_type === 'image');
      const directNewImages = [];
      const keptImages = keptExistingMedia.filter(m => (m.media_type || 'image') === 'image');

      if (keptImages.length + preNewImages.length > 10) {
        for (const f of uploadedFiles) await removeUploadedImage(f.path);
        return res.status(400).json({ message: 'Maximum 10 images allowed per post.' });
      }

      const preNewDocs = allNewAttachments.filter(a => a.media_type === 'file');
      const keptDocs = keptExistingMedia.filter(m => m.media_type === 'file');

      if (keptDocs.length + preNewDocs.length > 5) {
        for (const f of uploadedFiles) await removeUploadedImage(f.path);
        return res.status(400).json({ message: 'Maximum 5 files allowed per post.' });
      }

      const totalAttachments = keptExistingMedia.length + allNewAttachments.length;
      if (!newContent && totalAttachments === 0) {
        for (const f of uploadedFiles) await removeUploadedImage(f.path);
        return res.status(400).json({ message: 'Post must contain either text content or at least one photo or file.' });
      }

      const baseSortOrder = keptExistingMedia.length;
      const newMediaRecords = allNewAttachments.map((att, i) => ({
        stagingId: att.stagingId,
        mediaType: att.media_type || 'image',
        url: att.url,
        mimeType: att.mime_type || null,
        fileName: att.file_name || null,
        fileSize: att.file_size || null,
        sortOrder: baseSortOrder + i
      }));

      let updatedAttachmentUrl = null;

      try {
        await runTransaction(async (tx) => {
          // 1. Remove unkept post_media
          for (const row of removedMedia) {
            await tx.run('DELETE FROM post_media WHERE id = ?', row.id);
          }

          // 2. Reorder retained media
          if (keepUrls !== null) {
            for (let i = 0; i < keepUrls.length; i++) {
              const u = keepUrls[i];
              await tx.run('UPDATE post_media SET sort_order = ? WHERE post_id = ? AND url = ?', i, postId, u);
            }
          }

          // 3. Insert newly uploaded media and atomically commit staging records
          for (const media of newMediaRecords) {
            await tx.run(
              `INSERT INTO post_media (post_id, media_type, url, mime_type, file_name, file_size, sort_order, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              postId, media.mediaType, media.url, media.mimeType, media.fileName, media.fileSize, media.sortOrder, new Date().toISOString()
            );

            if (media.stagingId) {
              const updateResult = await tx.run(
                'UPDATE post_attachment_staging SET is_committed = 1, post_id = ? WHERE id = ? AND is_committed = 0',
                postId, media.stagingId
              );
              const changes = updateResult ? (updateResult.changes ?? updateResult.rowCount ?? 1) : 1;
              if (changes === 0) {
                const err = new Error('Attachment has already been committed to another post.');
                err.status = 409;
                throw err;
              }
            }
          }

          // 4. Determine updated primary attachment_url
          const allCurrentMedia = await tx.all(
            'SELECT url, media_type FROM post_media WHERE post_id = ? ORDER BY sort_order ASC, id ASC',
            postId
          );
          if (allCurrentMedia && allCurrentMedia.length > 0) {
            const firstImg = allCurrentMedia.find(m => m.media_type === 'image') || allCurrentMedia[0];
            updatedAttachmentUrl = firstImg.url;
          } else if (keepUrls === null && keepIds === null) {
            updatedAttachmentUrl = post.attachment_url;
          } else if (keepUrls && keepUrls.includes(post.attachment_url)) {
            updatedAttachmentUrl = post.attachment_url;
          }

          // 5. Update post in place with edited_at timestamp
          finalTargetAllSem = updateSemesters ? (parsedSemesters.allSemesters ? 1 : 0) : (post.target_all_semesters ?? 1);
          finalSemesterNo = updateSemesters
            ? (parsedSemesters.allSemesters ? null : (parsedSemesters.semesters.length === 1 ? parsedSemesters.semesters[0] : null))
            : post.semester_no;
          await tx.run(
            'UPDATE posts SET content = ?, attachment_url = ?, category = ?, visibility = ?, target_all_semesters = ?, semester_no = ?, title = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
            newContent, updatedAttachmentUrl, updatedCategory, updatedVisibility, finalTargetAllSem, finalSemesterNo, updatedTitle, postId
          );

          if (updateSemesters) {
            await tx.run('DELETE FROM post_target_semesters WHERE post_id = ?', postId);
            if (!parsedSemesters.allSemesters && parsedSemesters.semesters.length > 0) {
              for (const s of parsedSemesters.semesters) {
                await tx.run('INSERT INTO post_target_semesters (post_id, semester) VALUES (?, ?)', postId, s);
              }
            }
          }
        });
      } catch (txErr) {
        // If final update fails, clean up newly uploaded unattached blobs safely (Requirement 8)
        try {
          await cleanupUnattachedBlobs(newMediaRecords);
        } catch (cleanErr) {
          console.error('[Post Edit Failure Blob Cleanup Error]:', cleanErr.message);
        }
        if (txErr.status) return res.status(txErr.status).json({ message: txErr.message });
        throw txErr;
      }
      req.postEdited = true;

      // Safe cleanup of removed blobs AFTER database update succeeds
      const removedBlobsToClean = removedMedia.map(m => m.url);
      if (post.attachment_url && keepUrls && !keepUrls.includes(post.attachment_url) && existingMedia.length === 0) {
        removedBlobsToClean.push(post.attachment_url);
      }

      await cleanupUnattachedBlobs(removedBlobsToClean);

      const modAvail = await isModerationSchemaAvailable(db);
      const updatedRow = await db.get(`${buildSelectPosts(modAvail)} WHERE p.id = ?`, req.postUser.studentId, postId);
      const formatted = formatPost(updatedRow, req);
      await attachMediaToPosts([formatted]);
      await attachTargetSemestersToPosts([formatted]);

      // F3: Deletes and privacy changes MUST stay synchronous so content vanishes immediately
      if (updatedVisibility && updatedVisibility !== post.visibility && (updatedVisibility === 'private' || updatedVisibility === 'teachers_only')) {
        try {
          const isPg = Boolean(db.isPostgres || (db.query && !db.all));
          if (isPg) {
            await db.query("UPDATE knowledge_resources SET visibility = 'teachers_only', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [`post:${postId}`]);
          } else {
            await db.run("UPDATE knowledge_resources SET visibility = 'teachers_only', updated_at = CURRENT_TIMESTAMP WHERE id = ?", `post:${postId}`);
          }
        } catch (_) {}
      }

      // F3: Respond immediately to the student
      res.json(formatted);

      // F3 & F4: Non-blocking re-indexing via waitUntil / setImmediate (isolated from response lifecycle)
      try {
        const editSyncData = {
          id: postId,
          title: formatted.title || post.title || (newContent ? newContent.slice(0, 80) : ''),
          content: newContent || post.content,
          category: updatedCategory,
          visibility: updatedVisibility,
          audience_scope: post.audience_scope,
          cohort_id: post.cohort_id,
          semester_no: finalSemesterNo,
          target_all_semesters: finalTargetAllSem,
          user_id: post.user_id,
          author_role: req.postUser.role,
          target_semesters: (parsedSemesters && parsedSemesters.allSemesters) ? [] : (parsedSemesters?.semesters || [])
        };

        const runEditSyncTask = async () => {
          try {
            const { onPostSaved } = require('../lib/knowledge-sync');
            await onPostSaved(db, editSyncData);
          } catch (syncErr) {
            console.error('[KYANA Knowledge Sync Post Edit Error]:', syncErr.message);
          }
        };

        try {
          const { waitUntil } = require('@vercel/functions');
          if (typeof waitUntil === 'function') {
            waitUntil(runEditSyncTask());
          } else {
            setImmediate(runEditSyncTask);
          }
        } catch (_) {
          setImmediate(runEditSyncTask);
        }
      } catch (bgErr) {
        console.error('[KYANA Knowledge Sync Post Edit Background Error]:', bgErr.message);
      }
    } catch (err) {
      next(err);
    }
  };

  router.put('/:id', requireLogin, upload.any(), handleEditPost);
  router.patch('/:id', requireLogin, upload.any(), handleEditPost);

  router.delete('/:id', async (req, res, next) => {
    try {
      const postId = Number(req.params.id);
      const modAvail = await isModerationSchemaAvailable(db);
      const post = await db.get(
        `SELECT user_id, attachment_url ${modAvail ? ', moderation_status' : ''} FROM posts WHERE id = ?`,
        postId
      );
      if (!post) return res.status(404).json({ message: 'Post not found.' });
      if (modAvail && post.moderation_status === 'removed' && req.postUser.role !== 'admin') {
        return res.status(400).json({ message: 'Cannot delete a post that has been removed by moderation.' });
      }
      if (post.user_id !== req.postUser.studentId && req.postUser.role !== 'admin') {
        return res.status(403).json({ message: 'Only the owner or an admin can delete this post.' });
      }

      // Fetch all media URLs for this post before deleting
      const mediaList = await db.all('SELECT url FROM post_media WHERE post_id = ?', postId);
      const urlsToClean = new Set();
      if (post.attachment_url) urlsToClean.add(post.attachment_url);
      for (const m of mediaList) {
        if (m.url) urlsToClean.add(m.url);
      }

      await db.run('DELETE FROM posts WHERE id = ?', postId);

      // Clean up blobs safely (only if no other record references it)
      for (const url of urlsToClean) {
        if (/^\/uploads\/posts\/[a-f0-9-]+\.[a-z0-9]+$/i.test(url)) {
          const ref1 = await db.get('SELECT COUNT(*) AS c FROM post_media WHERE url = ?', url);
          const ref2 = await db.get('SELECT COUNT(*) AS c FROM posts WHERE attachment_url = ?', url);
          if ((Number(ref1?.c || 0) + Number(ref2?.c || 0)) === 0) {
            const filename = path.basename(url);
            await db.deleteFileBlob(filename);
            await removeUploadedImage(path.join(uploadDir, filename));
          }
        }
      }

      // KYANA AI 3.0 Knowledge Soft-Delete Hook (Synchronous before response)
      try {
        const { onPostDeleted } = require('../lib/knowledge-sync');
        await onPostDeleted(db, postId);
      } catch (syncErr) {
        console.error('[KYANA Knowledge Sync Post Delete Error]:', syncErr.message);
      }

      res.json({ message: 'Post deleted.' });
    } catch (err) {
      next(err);
    }
  });

  router.use(async (err, req, res, next) => {
    if (!req.postCreated && !req.postEdited) {
      if (req.savedBlobs && Array.isArray(req.savedBlobs)) {
        for (const filename of req.savedBlobs) {
          await db.deleteFileBlob(filename);
        }
      } else if (req.postImageSaved && req.file?.filename) {
        await db.deleteFileBlob(req.file.filename);
      }
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          if (file.path) await removeUploadedImage(file.path);
        }
      } else if (req.file?.path) {
        await removeUploadedImage(req.file.path);
      }
    }
    if (err instanceof multer.MulterError) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        message: err.code === 'LIMIT_FILE_SIZE' ? 'Files must be 4 MB or smaller. For larger study materials, upload them to Semester Library.' : err.code === 'LIMIT_FILE_COUNT' ? 'Maximum allowed files exceeded.' : 'Upload valid files and text fields only.'
      });
    }
    if (err.code === 'INVALID_FILE_TYPE' || err.code === 'INVALID_IMAGE_TYPE') return res.status(400).json({ message: err.message });
    console.error('[Posts API Error]:', err.message);
    res.status(500).json({ message: 'Could not update or load posts. Please try again.' });
  });
  return router;
};
