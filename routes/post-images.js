const express = require('express');

module.exports = function createPostImagesRouter(db) {
  const router = express.Router();
  router.get('/:filename', async (req, res, next) => {
    if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(req.params.filename)) return res.sendStatus(404);
    try {
      await db.initSchema();
      // Only expose blobs referenced by posts (either primary attachment_url or any post_media entry)
      const post = await db.get(
        `SELECT id, user_id, visibility FROM posts WHERE attachment_url = ? OR attachment_url = ?
         UNION ALL
         SELECT p.id, p.user_id, p.visibility FROM post_media pm JOIN posts p ON pm.post_id = p.id WHERE pm.url = ? OR pm.url = ?
         LIMIT 1`,
        `/uploads/posts/${req.params.filename}`,
        `uploads/posts/${req.params.filename}`,
        `/uploads/posts/${req.params.filename}`,
        `uploads/posts/${req.params.filename}`
      );
      if (!post) return res.sendStatus(404);

      if (post.visibility === 'students_only') {
        const viewerStudentId = req.student?.studentId || req.user?.studentId || req.session?.studentId;
        if (!viewerStudentId) return res.sendStatus(404);
        let viewerRole = req.student?.role || req.user?.role || req.session?.role;
        if (!viewerRole) {
          const studentRec = await db.get('SELECT role FROM students WHERE studentId = ?', viewerStudentId);
          viewerRole = studentRec?.role || 'student';
        }
        const isAuthor = post.user_id === viewerStudentId;
        const isStudentOrCR = ['student', 'cr', 'class_rep'].includes(viewerRole);
        const isAdminModeration = viewerRole === 'admin' && (req.query?.moderation === 'true' || req.headers?.['x-admin-moderation'] === 'true');
        if (!isAuthor && !isStudentOrCR && !isAdminModeration) {
          return res.sendStatus(404);
        }
      }
      const blob = await db.getFileBlob(req.params.filename);
      if (!blob) return next(); // Existing local uploads remain available through express.static.
      res.setHeader('Content-Type', blob.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.send(blob.fileData);
    } catch (err) {
      console.error('[Post Image Error]:', err.message);
      res.status(500).json({ message: 'Could not load this image. Please try again.' });
    }
  });
  return router;
};
