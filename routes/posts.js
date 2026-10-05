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
  cleanupAbandonedStagedAttachments
} = require('../lib/posts');
const {
  getAcademicContext,
  buildAcademicContentFilter,
  resolvePublishScope,
  assertContentAccess
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
  if (['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.txt', '.zip', '.jpg', '.jpeg', '.png', '.webp'].includes(origExt)) {
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
        ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.txt', '.zip'].includes(origExt);
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
      await db.initSchema();
      req.postUser = req.student || await db.get('SELECT studentId, name, role FROM students WHERE studentId = ?', req.session.studentId);
      if (!req.postUser && req.method !== 'GET') {
        return res.status(403).json({ message: 'Sign in with a student account to post or like.' });
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  const selectPosts = `
    SELECT p.*, s.name, s.role, s.avatarUrl AS "avatarUrl", s.studentId AS "studentId",
      COALESCE(l.like_count, 0) AS like_count,
      COALESCE(c.comment_count, 0) AS comment_count,
      COALESCE(sub.submission_count, 0) AS submission_count,
      (mine.user_id IS NOT NULL) AS liked_by_me
    FROM posts p
    LEFT JOIN students s ON s.studentId = p.user_id
    LEFT JOIN (SELECT post_id, COUNT(*) AS like_count FROM post_likes GROUP BY post_id) l
      ON l.post_id = p.id
    LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM post_comments WHERE deleted_at IS NULL GROUP BY post_id) c
      ON c.post_id = p.id
    LEFT JOIN post_likes mine ON mine.post_id = p.id AND mine.user_id = ?
    LEFT JOIN (SELECT post_id, COUNT(*) AS submission_count FROM post_submissions GROUP BY post_id) sub
      ON sub.post_id = p.id AND p.type = 'assignment'`;

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

  function formatPost(post, req) {
    const isOfficialNotice = post.type === 'notice' && ['admin', 'cr', 'teacher'].includes(post.role);
    const isAuthor = post.user_id === req.postUser?.studentId;
    const isAdmin = req.postUser?.role === 'admin';
    return {
      ...post,
      id: Number(post.id),
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
      audienceScope: post.audience_scope || post.audienceScope || 'cohort',
      audience_scope: post.audience_scope || post.audienceScope || 'cohort',
      is_official: isOfficialNotice,
      canDelete: isAuthor || isAdmin,
      canEdit: isAuthor || isAdmin,
      media: Array.isArray(post.media) ? post.media : []
    };
  }

  router.get('/', async (req, res, next) => {
    try {
      const { limit = '20', before, type, official, studentId, authorStudentId } = req.query;
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
        requestedCohortId: req.query.cohortId || req.query.cohort_id,
        requestedSemester: req.query.semester || req.query.semester_no
      });
      whereConditions.push(academicFilter.sql);
      params.push(...academicFilter.params);

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
      const rows = await db.all(`${selectPosts}
        ${whereClause} ORDER BY p.id DESC LIMIT ?`, ...params);
      const hasMore = rows.length > Number(limit);
      const posts = rows.slice(0, Number(limit)).map(row => formatPost(row, req));
      await attachMediaToPosts(posts);
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
      const { content, type = 'status' } = req.body || {};
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
      if (trimmedContent.length > 5000) {
        return rejectPost('Post content cannot exceed 5,000 characters.');
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

      let newPostId = null;
      let postRow = null;

      const academicCtx = await getAcademicContext(db, req);
      const isNotice = type === 'notice';
      const publishScope = await resolvePublishScope(db, academicCtx, req.body, { isNotice });

      // Atomic DB Transaction for post creation, attachment insertion, and staging commitment
      await runTransaction(async (tx) => {
        const result = await tx.run(
          `INSERT INTO posts (user_id, content, type, attachment_url, cohort_id, semester_no, audience_scope, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          req.postUser.studentId, trimmedContent, type, attachment_url, publishScope.cohortId, publishScope.semesterNo, publishScope.audienceScope, new Date().toISOString()
        );
        newPostId = result.lastInsertRowid;

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

        postRow = await tx.get(`${selectPosts} WHERE p.id = ?`, req.postUser.studentId, newPostId);
      });
      req.postCreated = true;

      const formatted = formatPost(postRow, req);
      await attachMediaToPosts([formatted]);

      // Push notification outbox enqueue and bounded synchronous dispatch (isolated failure)
      try {
        const { enqueuePostOrNoticePush, dispatchImmediateOutbox } = require('../lib/push-notifications');
        const passedTitle = (req.body?.title || req.body?.heading || '').trim();
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
          audienceScope: publishScope.audienceScope
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
        console.error('[Post/Notice Push Enqueue/Dispatch Error]:', pushErr.message);
      }

      res.status(201).json(formatted);
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
      const row = await db.get(`${selectPosts} WHERE p.id = ?`, currentUserId, postId);
      if (!row) return res.status(404).json({ message: 'Post not found.' });

      const context = await getAcademicContext(db, req);
      if (!assertContentAccess(context, row)) {
        return res.status(404).json({ message: 'Post not found.' });
      }

      const formatted = formatPost(row, req);
      await attachMediaToPosts([formatted]);
      res.setHeader('Cache-Control', 'no-store');
      res.json(formatted);
    } catch (err) {
      next(err);
    }
  });

  async function setLike(req, res, next) {
    try {
      const post = await db.get('SELECT id, user_id, content, cohort_id, semester_no, audience_scope FROM posts WHERE id = ?', Number(req.params.id));
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const context = await getAcademicContext(db, req);
      if (!assertContentAccess(context, post)) {
        return res.status(404).json({ message: 'Post not found.' });
      }

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
      const post = await db.get('SELECT id, cohort_id, semester_no, audience_scope FROM posts WHERE id = ?', postId);
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const context = await getAcademicContext(db, req);
      if (!assertContentAccess(context, post)) {
        return res.status(404).json({ message: 'Post not found.' });
      }

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
      const post = await db.get('SELECT id, user_id, content, cohort_id, semester_no, audience_scope FROM posts WHERE id = ?', postId);
      if (!post) return res.status(404).json({ message: 'Post not found.' });

      const context = await getAcademicContext(db, req);
      if (!assertContentAccess(context, post)) {
        return res.status(404).json({ message: 'Post not found.' });
      }

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

  const handleEditPost = async (req, res, next) => {
    try {
      const postId = Number(req.params.id);
      const post = await db.get('SELECT * FROM posts WHERE id = ?', postId);
      const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);

      if (!post) {
        for (const f of uploadedFiles) await removeUploadedImage(f.path);
        return res.status(404).json({ message: 'Post not found.' });
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
        if (content.trim().length > 5000) {
          for (const f of uploadedFiles) await removeUploadedImage(f.path);
          return res.status(400).json({ message: 'Post content cannot exceed 5,000 characters.' });
        }
        newContent = content.trim();
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
          await tx.run(
            'UPDATE posts SET content = ?, attachment_url = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
            newContent, updatedAttachmentUrl, postId
          );
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

      const updatedRow = await db.get(`${selectPosts} WHERE p.id = ?`, req.postUser.studentId, postId);
      const formatted = formatPost(updatedRow, req);
      await attachMediaToPosts([formatted]);
      res.json(formatted);
    } catch (err) {
      next(err);
    }
  };

  router.put('/:id', requireLogin, upload.any(), handleEditPost);
  router.patch('/:id', requireLogin, upload.any(), handleEditPost);

  router.delete('/:id', async (req, res, next) => {
    try {
      const postId = Number(req.params.id);
      const post = await db.get('SELECT user_id, attachment_url FROM posts WHERE id = ?', postId);
      if (!post) return res.status(404).json({ message: 'Post not found.' });
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
