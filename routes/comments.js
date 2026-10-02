const express = require('express');
const {
  fetchCommentReplies,
  createCommentOrReply,
  editComment,
  deleteComment,
  addCommentReaction,
  removeCommentReaction,
  toggleCommentReaction
} = require('../lib/comments');

module.exports = function createCommentsRouter(db, requireLogin) {
  const router = express.Router();
  router.use(requireLogin);
  router.use(async (req, res, next) => {
    try {
      await db.initSchema();
      req.postUser = req.student || await db.get('SELECT studentId, name, role FROM students WHERE studentId = ?', req.session.studentId);
      if (!req.postUser && req.method !== 'GET') {
        return res.status(403).json({ message: 'Sign in with a student account to interact with comments.' });
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  // GET /api/comments/:commentId/replies
  router.get('/:commentId/replies', async (req, res, next) => {
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

  // POST /api/comments/:commentId/replies
  router.post('/:commentId/replies', async (req, res, next) => {
    try {
      const { content, reply_to_user_id, replyToUserId } = req.body || {};
      const result = await createCommentOrReply(db, {
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

  // PUT & PATCH /api/comments/:commentId
  const handleEdit = async (req, res, next) => {
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

  router.put('/:commentId', handleEdit);
  router.patch('/:commentId', handleEdit);

  // DELETE /api/comments/:commentId
  router.delete('/:commentId', async (req, res, next) => {
    try {
      const result = await deleteComment(db, {
        commentId: req.params.commentId,
        req
      });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  });

  // POST /api/comments/:commentId/reactions
  router.post('/:commentId/reactions', async (req, res, next) => {
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

  // DELETE /api/comments/:commentId/reactions (or /:reactionType)
  const handleRemoveReaction = async (req, res, next) => {
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

  router.delete('/:commentId/reactions', handleRemoveReaction);
  router.delete('/:commentId/reactions/:reactionType', handleRemoveReaction);

  // POST & DELETE /api/comments/:commentId/like (aliases for simple like reactions)
  router.post('/:commentId/like', async (req, res, next) => {
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

  router.delete('/:commentId/like', handleRemoveReaction);

  return router;
};
