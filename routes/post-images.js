const express = require('express');

module.exports = function createPostImagesRouter(db) {
  const router = express.Router();
  router.get('/:filename', async (req, res, next) => {
    if (!/^[a-f0-9-]+\.[a-z]+$/.test(req.params.filename)) return res.sendStatus(404);
    try {
      await db.initSchema();
      // Only expose blobs referenced by posts, not unrelated library or chat attachments.
      const post = await db.get('SELECT id FROM posts WHERE attachment_url = ? LIMIT 1', `/uploads/posts/${req.params.filename}`);
      if (!post) return res.sendStatus(404);
      const blob = await db.getFileBlob(req.params.filename);
      if (!blob) return next(); // Existing local uploads remain available through express.static.
      res.setHeader('Content-Type', blob.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      res.send(blob.fileData);
    } catch (err) {
      console.error('[Post Image Error]:', err.message);
      res.status(500).json({ message: 'Could not load this image. Please try again.' });
    }
  });
  return router;
};
