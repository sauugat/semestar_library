const express = require('express');
const { isModerationSchemaAvailable } = require('../lib/posts');

module.exports = function createPostImagesRouter(db) {
  const router = express.Router();
  router.get('/:filename', async (req, res, next) => {
    if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(req.params.filename)) return res.sendStatus(404);
    try {
      if (typeof db.initSchema === 'function') {
        await db.initSchema();
      }
      const modAvail = await isModerationSchemaAvailable(db);
      const modCol = modAvail ? ', moderation_status' : ", 'active' AS moderation_status";
      const fullPath = `/uploads/posts/${req.params.filename}`;
      const altPath = `uploads/posts/${req.params.filename}`;

      // Check if referenced by an advertisement creative or advertiser logo
      let isAdAsset = false;
      try {
        const adRef = await db.get(
          `SELECT id FROM advertisements
           WHERE media_url = ? OR media_url = ? OR advertiser_logo_url = ? OR advertiser_logo_url = ?
           LIMIT 1`,
          fullPath,
          altPath,
          fullPath,
          altPath
        );
        if (adRef) isAdAsset = true;
      } catch (_) {}

      if (!isAdAsset) {
        // Expose blobs referenced by posts (either primary attachment_url or any post_media entry)
        const post = await db.get(
          `SELECT id, user_id, visibility ${modCol} FROM posts WHERE attachment_url = ? OR attachment_url = ?
           UNION ALL
           SELECT p.id, p.user_id, p.visibility ${modCol} FROM post_media pm JOIN posts p ON pm.post_id = p.id WHERE pm.url = ? OR pm.url = ?
           LIMIT 1`,
          fullPath,
          altPath,
          fullPath,
          altPath
        );
        if (!post) return res.sendStatus(404);

        const viewerStudentId = req.student?.studentId || req.user?.studentId || req.session?.studentId;
        let viewerRole = req.student?.role || req.user?.role || req.session?.role;
        if (!viewerRole && viewerStudentId) {
          const studentRec = await db.get('SELECT role FROM students WHERE studentId = ?', viewerStudentId);
          viewerRole = studentRec?.role || 'student';
        }
        const isAdminModeration = viewerRole === 'admin' && (req.query?.moderation === 'true' || req.headers?.['x-admin-moderation'] === 'true');

        if (modAvail && post.moderation_status === 'removed' && !isAdminModeration) {
          return res.sendStatus(404);
        }

        if (post.visibility === 'students_only') {
          if (!viewerStudentId) return res.sendStatus(404);
          const isAuthor = post.user_id === viewerStudentId;
          const isStudentOrCR = ['student', 'cr', 'class_rep'].includes(viewerRole);
          if (!isAuthor && !isStudentOrCR && !isAdminModeration) {
            return res.sendStatus(404);
          }
        }
      }

      const blob = await db.getFileBlob(req.params.filename);
      if (!blob) return next(); // Existing local uploads remain available through express.static.
      const lowerName = req.params.filename.toLowerCase();
      let mimeType = blob.mimeType || 'application/octet-stream';
      if (lowerName.endsWith('.pdf')) mimeType = 'application/pdf';
      else if (lowerName.endsWith('.mp4')) mimeType = 'video/mp4';
      else if (lowerName.endsWith('.webm')) mimeType = 'video/webm';
      else if (lowerName.endsWith('.mov')) mimeType = 'video/quicktime';

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (!lowerName.endsWith('.pdf')) {
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; media-src 'self' data: blob:; style-src 'unsafe-inline'");
      }
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.send(blob.fileData);
    } catch (err) {
      console.error('[Post Image Error]:', err.message);
      res.status(500).json({ message: 'Could not load this media. Please try again.' });
    }
  });
  return router;
};
