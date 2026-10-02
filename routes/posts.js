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

const POST_UPLOAD_DIR = process.env.VERCEL
  ? path.join('/tmp', 'uploads', 'posts')
  : path.join(__dirname, '..', 'public', 'uploads', 'posts');
const imageExtensions = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/avif': '.avif', 'image/apng': '.apng',
  'image/svg+xml': '.svg', 'image/bmp': '.bmp', 'image/tiff': '.tiff',
  'image/heic': '.heic', 'image/heif': '.heif', 'image/x-icon': '.ico'
};

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
      // Use a server-generated name and image extension, never the supplied filename.
      filename: (req, file, cb) => cb(null, crypto.randomUUID() + (imageExtensions[file.mimetype] || '.img'))
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 10, fields: 20, fieldSize: 64 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) return cb(null, true);
      const err = new Error('Please choose an image file.');
      err.code = 'INVALID_IMAGE_TYPE';
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

  async function attachMediaToPosts(posts) {
    if (!Array.isArray(posts) || posts.length === 0) return posts;
    const postIds = posts.map(p => Number(p.id)).filter(id => Number.isInteger(id) && id > 0);
    if (postIds.length === 0) return posts;

    const placeholders = postIds.map(() => '?').join(',');
    let mediaRows = [];
    try {
      mediaRows = await db.all(
        `SELECT id, post_id, media_type, url, mime_type, sort_order, created_at
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
        url: row.url,
        mime_type: row.mime_type || null,
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
          post.attachment_url = mediaList[0].url;
        }
      } else if (post.attachment_url) {
        post.media = [{
          id: 0,
          post_id: pid,
          media_type: 'image',
          url: post.attachment_url,
          mime_type: null,
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
      like_count: Number(post.like_count),
      comment_count: Number(post.comment_count || 0),
      submission_count: Number(post.submission_count),
      liked_by_me: Boolean(post.liked_by_me),
      // Keep the original response fields for already-open dashboard clients.
      likeCount: Number(post.like_count),
      commentCount: Number(post.comment_count || 0),
      submittedCount: Number(post.submission_count),
      liked: Boolean(post.liked_by_me),
      is_official: isOfficialNotice,
      canDelete: isAuthor || isAdmin,
      canEdit: isAuthor || isAdmin,
      media: Array.isArray(post.media) ? post.media : []
    };
  }

  router.get('/', async (req, res, next) => {
    try {
      const { limit = '20', before, type, official } = req.query;
      if (!positiveId(limit) || Number(limit) > 100 || (before !== undefined && !positiveId(before))) {
        return res.status(400).json({ message: 'Use a limit from 1 to 100 and a positive before ID.' });
      }
      if (type !== undefined && !['status', 'assignment', 'notice'].includes(type)) {
        return res.status(400).json({ message: 'Invalid post type filter.' });
      }
      const params = [req.session.studentId];
      const whereConditions = [];
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

  router.post('/', requireLogin, upload.any(), async (req, res, next) => {
    try {
      const { content, type = 'status' } = req.body || {};
      let attachment_url = req.body?.attachment_url ?? null;
      const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);

      async function rejectPost(message) {
        for (const f of uploadedFiles) await removeUploadedImage(f.path);
        return res.status(400).json({ message });
      }

      if (uploadedFiles.length > 10) {
        return rejectPost('Maximum 10 images allowed per post.');
      }

      for (const f of uploadedFiles) {
        if (!f.mimetype || !f.mimetype.startsWith('image/')) {
          return rejectPost('Please choose an image file.');
        }
      }

      const rawContent = typeof content === 'string' ? content : '';
      const trimmedContent = rawContent.trim();
      const hasText = trimmedContent.length > 0;
      const hasImages = uploadedFiles.length > 0 || Boolean(attachment_url);

      if (!hasText && !hasImages) {
        return rejectPost('Post must contain either text content or at least one photo.');
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
          for (const f of uploadedFiles) await removeUploadedImage(f.path);
          return res.status(403).json({ message: 'Only authorized roles (admin, CR, teacher) can publish notices.' });
        }
      }
      if (type === 'assignment') {
        const canPostAssignment = ['admin', 'teacher'].includes(req.postUser?.role);
        if (!canPostAssignment) {
          for (const f of uploadedFiles) await removeUploadedImage(f.path);
          return res.status(403).json({ message: 'Only teachers and administrators can create assignments.' });
        }
      }
      const isOfficial = type === 'notice' || (['admin', 'cr', 'teacher'].includes(req.postUser?.role) && Boolean(req.body?.official === true || req.body?.official === 'true' || req.body?.is_official === true));

      const savedBlobs = [];
      const mediaRecords = [];
      req.savedBlobs = savedBlobs;

      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const saved = await db.saveFileBlob(file.filename, await fs.promises.readFile(file.path), file.mimetype);
        if (!saved) throw new Error('Could not persist post image.');
        savedBlobs.push(file.filename);
        mediaRecords.push({
          url: `/uploads/posts/${file.filename}`,
          mimeType: file.mimetype,
          sortOrder: i
        });
      }

      if (mediaRecords.length > 0) {
        attachment_url = mediaRecords[0].url;
      } else if (attachment_url !== null) {
        let url;
        try { url = typeof attachment_url === 'string' && new URL(attachment_url); } catch (_) { }
        if (!url || !['http:', 'https:'].includes(url.protocol) || attachment_url.length > 2048) {
          return rejectPost('Attachment must be an HTTP or HTTPS URL.');
        }
      }

      const result = await db.run(`INSERT INTO posts (user_id, content, type, attachment_url, created_at)
        VALUES (?, ?, ?, ?, ?)`, req.postUser.studentId, trimmedContent, type, attachment_url, new Date().toISOString());
      req.postCreated = true;
      const newPostId = result.lastInsertRowid;

      for (const media of mediaRecords) {
        await db.run(
          `INSERT INTO post_media (post_id, media_type, url, mime_type, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          newPostId, 'image', media.url, media.mimeType, media.sortOrder, new Date().toISOString()
        );
      }

      const post = await db.get(`${selectPosts} WHERE p.id = ?`, req.postUser.studentId, newPostId);
      const formatted = formatPost(post, req);
      await attachMediaToPosts([formatted]);

      // Push notification outbox enqueue and bounded synchronous dispatch (isolated failure)
      try {
        const { enqueuePostOrNoticePush, dispatchImmediateOutbox } = require('../lib/push-notifications');
        const passedTitle = (req.body?.title || req.body?.heading || '').trim();
        const enqueueResult = await enqueuePostOrNoticePush(db, {
          postId: result.lastInsertRowid,
          authorStudentId: req.postUser.studentId,
          authorName: req.postUser.name,
          type,
          isOfficial,
          role: req.postUser.role,
          title: passedTitle || null,
          content: trimmedContent,
          semester: req.postUser.semester
        });
        if (enqueueResult && enqueueResult.enqueuedCount > 0) {
          const isOfficialNotice = type === 'notice' && (Boolean(isOfficial) || ['admin', 'cr', 'teacher'].includes(req.postUser.role));
          await dispatchImmediateOutbox(db, {
            eventType: isOfficialNotice ? 'notice' : 'post',
            eventId: result.lastInsertRowid,
            timeoutMs: 3500
          });
        }
      } catch (pushErr) {
        console.error('[Post/Notice Push Enqueue/Dispatch Error]:', pushErr.message);
      }

      res.status(201).json(formatted);
    } catch (err) {
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
      const post = await db.get('SELECT id FROM posts WHERE id = ?', Number(req.params.id));
      if (!post) return res.status(404).json({ message: 'Post not found.' });
      const liked = req.method === 'POST';
      if (liked) {
        await db.run(`INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)
          ON CONFLICT (post_id, user_id) DO NOTHING`, post.id, req.postUser.studentId);
      } else {
        await db.run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', post.id, req.postUser.studentId);
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
      const post = await db.get('SELECT id FROM posts WHERE id = ?', postId);
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

      // Parse keepMediaUrls
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

      for (const f of uploadedFiles) {
        if (!f.mimetype || !f.mimetype.startsWith('image/')) {
          for (const file of uploadedFiles) await removeUploadedImage(file.path);
          return res.status(400).json({ message: 'Please choose an image file.' });
        }
      }

      const existingMedia = await db.all(
        'SELECT * FROM post_media WHERE post_id = ? ORDER BY sort_order ASC, id ASC',
        postId
      );

      // Kept count
      let keptCount = 0;
      if (keepUrls !== null) {
        keptCount = keepUrls.length;
      } else {
        keptCount = existingMedia.length > 0 ? existingMedia.length : (post.attachment_url ? 1 : 0);
      }

      if (keptCount + uploadedFiles.length > 10) {
        for (const f of uploadedFiles) await removeUploadedImage(f.path);
        return res.status(400).json({ message: 'Maximum 10 images allowed per post.' });
      }

      const finalImageCount = keptCount + uploadedFiles.length;
      if (!newContent && finalImageCount === 0) {
        for (const f of uploadedFiles) await removeUploadedImage(f.path);
        return res.status(400).json({ message: 'Post must contain either text content or at least one photo.' });
      }

      // Handle removed media and safe cleanup
      if (keepUrls !== null) {
        for (const row of existingMedia) {
          if (!keepUrls.includes(row.url)) {
            await db.run('DELETE FROM post_media WHERE id = ?', row.id);
            // Safe cleanup: delete blob only if no other post or post_media uses it
            const refCount1 = await db.get('SELECT COUNT(*) AS c FROM post_media WHERE url = ? AND id != ?', row.url, row.id);
            const refCount2 = await db.get('SELECT COUNT(*) AS c FROM posts WHERE attachment_url = ? AND id != ?', row.url, postId);
            if ((Number(refCount1?.c || 0) + Number(refCount2?.c || 0)) === 0) {
              if (/^\/uploads\/posts\/[a-f0-9-]+\.[a-z0-9]+$/i.test(row.url)) {
                const filename = path.basename(row.url);
                await db.deleteFileBlob(filename);
                await removeUploadedImage(path.join(uploadDir, filename));
              }
            }
          }
        }

        // Also check if legacy post.attachment_url was removed
        if (post.attachment_url && !keepUrls.includes(post.attachment_url) && existingMedia.length === 0) {
          const refCount1 = await db.get('SELECT COUNT(*) AS c FROM post_media WHERE url = ?', post.attachment_url);
          const refCount2 = await db.get('SELECT COUNT(*) AS c FROM posts WHERE attachment_url = ? AND id != ?', post.attachment_url, postId);
          if ((Number(refCount1?.c || 0) + Number(refCount2?.c || 0)) === 0) {
            if (/^\/uploads\/posts\/[a-f0-9-]+\.[a-z0-9]+$/i.test(post.attachment_url)) {
              const filename = path.basename(post.attachment_url);
              await db.deleteFileBlob(filename);
              await removeUploadedImage(path.join(uploadDir, filename));
            }
          }
        }

        // Reorder kept media if requested
        for (let i = 0; i < keepUrls.length; i++) {
          const u = keepUrls[i];
          await db.run('UPDATE post_media SET sort_order = ? WHERE post_id = ? AND url = ?', i, postId, u);
        }
      }

      // Persist newly uploaded files
      const savedBlobs = [];
      req.savedBlobs = savedBlobs;
      const baseSortOrder = keepUrls !== null ? keepUrls.length : existingMedia.length;
      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const saved = await db.saveFileBlob(file.filename, await fs.promises.readFile(file.path), file.mimetype);
        if (!saved) throw new Error('Could not persist post image.');
        savedBlobs.push(file.filename);
        const fileUrl = `/uploads/posts/${file.filename}`;
        await db.run(
          `INSERT INTO post_media (post_id, media_type, url, mime_type, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          postId, 'image', fileUrl, file.mimetype, baseSortOrder + i, new Date().toISOString()
        );
      }

      // Determine updated primary attachment_url
      const allCurrentMedia = await db.all(
        'SELECT url FROM post_media WHERE post_id = ? ORDER BY sort_order ASC, id ASC',
        postId
      );
      let updatedAttachmentUrl = null;
      if (allCurrentMedia.length > 0) {
        updatedAttachmentUrl = allCurrentMedia[0].url;
      } else if (keepUrls === null) {
        updatedAttachmentUrl = post.attachment_url;
      } else if (keepUrls.includes(post.attachment_url)) {
        updatedAttachmentUrl = post.attachment_url;
      }

      // Update post in place (preserves comments, likes, submissions, created_at, user_id)
      await db.run(
        'UPDATE posts SET content = ?, attachment_url = ? WHERE id = ?',
        newContent, updatedAttachmentUrl, postId
      );
      req.postEdited = true;

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
        message: err.code === 'LIMIT_FILE_SIZE' ? 'Images must be 5 MB or smaller.' : err.code === 'LIMIT_FILE_COUNT' ? 'Maximum 10 images allowed per post.' : 'Upload valid images and text fields only.'
      });
    }
    if (err.code === 'INVALID_IMAGE_TYPE') return res.status(400).json({ message: err.message });
    console.error('[Posts API Error]:', err.message);
    res.status(500).json({ message: 'Could not update or load posts. Please try again.' });
  });
  return router;
};
