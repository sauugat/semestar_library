const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const POST_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'posts');
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
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3, fieldSize: 32 * 1024 },
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
      req.postUser = await db.get('SELECT studentId, role FROM students WHERE studentId = ?', req.session.studentId);
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
      COALESCE(sub.submission_count, 0) AS submission_count,
      (mine.user_id IS NOT NULL) AS liked_by_me
    FROM posts p
    JOIN students s ON s.studentId = p.user_id
    LEFT JOIN (SELECT post_id, COUNT(*) AS like_count FROM post_likes GROUP BY post_id) l
      ON l.post_id = p.id
    LEFT JOIN post_likes mine ON mine.post_id = p.id AND mine.user_id = ?
    LEFT JOIN (SELECT post_id, COUNT(*) AS submission_count FROM post_submissions GROUP BY post_id) sub
      ON sub.post_id = p.id AND p.type = 'assignment'`;

  function formatPost(post, req) {
    return {
      ...post,
      id: Number(post.id),
      like_count: Number(post.like_count),
      submission_count: Number(post.submission_count),
      liked_by_me: Boolean(post.liked_by_me),
      // Keep the original response fields for already-open dashboard clients.
      likeCount: Number(post.like_count),
      submittedCount: Number(post.submission_count),
      liked: Boolean(post.liked_by_me),
      canDelete: post.user_id === req.postUser?.studentId || req.postUser?.role === 'admin'
    };
  }

  router.get('/', async (req, res, next) => {
    try {
      const { limit = '20', before } = req.query;
      if (!positiveId(limit) || Number(limit) > 100 || (before !== undefined && !positiveId(before))) {
        return res.status(400).json({ message: 'Use a limit from 1 to 100 and a positive before ID.' });
      }
      const params = [req.session.studentId];
      if (before !== undefined) params.push(Number(before));
      params.push(Number(limit) + 1);
      const rows = await db.all(`${selectPosts}
        ${before !== undefined ? 'WHERE p.id < ?' : ''} ORDER BY p.id DESC LIMIT ?`, ...params);
      const hasMore = rows.length > Number(limit);
      const posts = rows.slice(0, Number(limit)).map(row => formatPost(row, req));
      res.setHeader('Cache-Control', 'no-store');
      res.json({ posts, nextCursor: hasMore ? posts[posts.length - 1].id : null });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireLogin, upload.single('image'), async (req, res, next) => {
    try {
      const { content, type = 'status' } = req.body || {};
      let attachment_url = req.body?.attachment_url ?? null;
      async function rejectPost(message) {
        if (req.file) await removeUploadedImage(req.file.path);
        return res.status(400).json({ message });
      }
      if (typeof content !== 'string' || !content.trim() || content.trim().length > 5000) {
        return rejectPost('Post content must be between 1 and 5,000 characters.');
      }
      if (!['status', 'assignment', 'notice'].includes(type)) {
        return rejectPost('Choose status, assignment, or notice.');
      }
      if (req.file) {
        attachment_url = `/uploads/posts/${req.file.filename}`;
      } else if (attachment_url !== null) {
        let url;
        try { url = typeof attachment_url === 'string' && new URL(attachment_url); } catch (_) { }
        if (!url || !['http:', 'https:'].includes(url.protocol) || attachment_url.length > 2048) {
          return rejectPost('Attachment must be an HTTP or HTTPS URL.');
        }
      }
      const result = await db.run(`INSERT INTO posts (user_id, content, type, attachment_url, created_at)
        VALUES (?, ?, ?, ?, ?)`, req.postUser.studentId, content.trim(), type, attachment_url, new Date().toISOString());
      req.postCreated = true;
      const post = await db.get(`${selectPosts} WHERE p.id = ?`, req.postUser.studentId, result.lastInsertRowid);
      res.status(201).json(formatPost(post, req));
    } catch (err) {
      next(err);
    }
  });

  router.param('id', (req, res, next, id) => {
    if (!positiveId(id)) return res.status(400).json({ message: 'Invalid post ID.' });
    next();
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

  router.delete('/:id', async (req, res, next) => {
    try {
      const post = await db.get('SELECT user_id, attachment_url FROM posts WHERE id = ?', Number(req.params.id));
      if (!post) return res.status(404).json({ message: 'Post not found.' });
      if (post.user_id !== req.postUser.studentId && req.postUser.role !== 'admin') {
        return res.status(403).json({ message: 'Only the owner or an admin can delete this post.' });
      }
      await db.run('DELETE FROM posts WHERE id = ?', Number(req.params.id));
      if (/^\/uploads\/posts\/[a-f0-9-]+\.[a-z]+$/.test(post.attachment_url || '')) {
        await removeUploadedImage(path.join(uploadDir, path.basename(post.attachment_url)));
      }
      res.json({ message: 'Post deleted.' });
    } catch (err) {
      next(err);
    }
  });

  router.use(async (err, req, res, next) => {
    if (req.file?.path && !req.postCreated) await removeUploadedImage(req.file.path);
    if (err instanceof multer.MulterError) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        message: err.code === 'LIMIT_FILE_SIZE' ? 'Images must be 5 MB or smaller.' : 'Upload one image and the post text fields only.'
      });
    }
    if (err.code === 'INVALID_IMAGE_TYPE') return res.status(400).json({ message: err.message });
    console.error('[Posts API Error]:', err.message);
    res.status(500).json({ message: 'Could not update or load posts. Please try again.' });
  });
  return router;
};
