'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recordAdminAudit } = require('../lib/audit-service');
const { ensurePostsSchema } = require('../lib/posts');
const {
  ensureAdvertisementsSchema,
  validateAdvertisementInput,
  normalizeAdStatus,
  formatAdvertisement,
  shuffleWithSeed,
  getEligibleAdvertisements,
  recordAdvertisementImpression,
  recordAdvertisementClick
} = require('../lib/advertisements');

const AD_UPLOAD_DIR = process.env.VERCEL
  ? path.join('/tmp', 'uploads', 'posts')
  : path.join(__dirname, '..', 'public', 'uploads', 'posts');

const imageExtensions = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/heic': '.heic',
  'image/heif': '.heif'
};

const videoExtensions = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
  'video/3gpp': '.3gp',
  'video/mpeg': '.mpg'
};

const extToMime = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.3gp': 'video/3gpp',
  '.mpg': 'video/mpeg'
};

const ALLOWED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg', '.bmp', '.heic', '.heif'];
const ALLOWED_VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v', '.3gp', '.mpg'];

const MAX_AD_MEDIA_BYTES = 15 * 1024 * 1024; // 15 MB for image/video creative

function getSafeAdMediaExtension(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime && imageExtensions[mime]) return imageExtensions[mime];
  if (mime && videoExtensions[mime]) return videoExtensions[mime];
  const origExt = path.extname(file.originalname || '').toLowerCase();
  if (ALLOWED_IMAGE_EXTS.includes(origExt) || ALLOWED_VIDEO_EXTS.includes(origExt)) {
    return origExt;
  }
  if (mime === 'video' || mime.startsWith('video/')) return '.mp4';
  return '.jpg';
}

function detectMediaType(file) {
  if (!file) return 'image';
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime === 'video' || mime.startsWith('video/')) return 'video';
  const ext = path.extname(file.originalname || file.filename || '').toLowerCase();
  if (ALLOWED_VIDEO_EXTS.includes(ext)) return 'video';
  return 'image';
}

function resolveCanonicalAdMimeType(file) {
  if (!file) return 'image/jpeg';
  const rawMime = String(file.mimetype || '').toLowerCase().trim();
  const ext = path.extname(file.filename || file.originalname || '').toLowerCase();
  if (rawMime === 'image/jpg') return 'image/jpeg';
  if (rawMime && (imageExtensions[rawMime] || videoExtensions[rawMime] || rawMime.startsWith('image/') || rawMime.startsWith('video/'))) {
    return rawMime;
  }
  if (ext && extToMime[ext]) {
    return extToMime[ext];
  }
  if (rawMime === 'video' || ALLOWED_VIDEO_EXTS.includes(ext)) {
    return 'video/mp4';
  }
  return 'image/jpeg';
}

async function removeLocalUpload(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[Ad Media Cleanup Error]:', err.message);
  }
}

module.exports = function createAdvertisementsRouter(db, requireLogin, { uploadDir = AD_UPLOAD_DIR } = {}) {
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
      filename: (req, file, cb) => cb(null, crypto.randomUUID() + getSafeAdMediaExtension(file))
    }),
    limits: { fileSize: MAX_AD_MEDIA_BYTES, files: 4, fields: 30, fieldSize: 64 * 1024 },
    fileFilter: (req, file, cb) => {
      const mime = String(file.mimetype || '').toLowerCase();
      const ext = path.extname(file.originalname || '').toLowerCase();
      const isImg = mime === 'image' || mime.startsWith('image/') || ALLOWED_IMAGE_EXTS.includes(ext);
      const isVid = mime === 'video' || mime.startsWith('video/') || ALLOWED_VIDEO_EXTS.includes(ext);
      if (isImg || isVid) return cb(null, true);
      const err = new Error('Please upload an image or video creative (JPG, PNG, WebP, GIF, MP4, WebM, MOV).');
      err.code = 'INVALID_AD_MEDIA_TYPE';
      err.status = 400;
      cb(err);
    }
  });

  const router = express.Router();
  router.use(requireLogin);

  router.use(async (req, res, next) => {
    try {
      if (typeof db.verifyStartupReady === 'function') {
        await db.verifyStartupReady();
      } else if (typeof db.initSchema === 'function') {
        await db.initSchema();
      }
      await ensurePostsSchema(db);
      await ensureAdvertisementsSchema(db);
      next();
    } catch (err) {
      next(err);
    }
  });

  // Strict server-side admin verification against authoritative database record
  const requireAdminRole = async (req, res, next) => {
    const studentId = req.student?.studentId || req.user?.studentId || req.session?.studentId;
    if (!studentId) {
      return res.status(401).json({ message: 'Authentication required. Please sign in.' });
    }
    try {
      const user = await db.get(
        'SELECT studentId, role, name, email, account_status FROM students WHERE studentId = ?',
        studentId
      );
      if (!user || user.role !== 'admin' || (user.account_status || 'active') === 'suspended') {
        return res.status(403).json({ message: 'Forbidden: Only administrators can create or manage advertisements.' });
      }
      req.adminUser = user;
      req.adminStudentId = user.studentId || user.studentid;
      next();
    } catch (err) {
      next(err);
    }
  };

  async function saveUploadedFileToBlob(file, uploaderStudentId) {
    const canonicalMime = resolveCanonicalAdMimeType(file);
    const fileBuffer = await fs.promises.readFile(file.path);
    const saved = await db.saveFileBlob(file.filename, fileBuffer, canonicalMime);
    if (!saved) {
      await removeLocalUpload(file.path);
      const err = new Error('Could not persist advertisement media.');
      err.status = 500;
      throw err;
    }
    const mediaType = detectMediaType(file);
    const relativeUrl = `/uploads/posts/${file.filename}`;
    const attachmentId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    try {
      await db.run(
        `INSERT INTO post_attachment_staging
         (id, filename, url, uploader_student_id, media_type, mime_type, file_name, file_size, is_committed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        attachmentId,
        file.filename,
        relativeUrl,
        uploaderStudentId,
        mediaType,
        canonicalMime,
        file.originalname || file.filename || null,
        file.size || fileBuffer.length || null,
        nowIso
      );
    } catch (_) {
      // Staging entry is optional if table already has it or is bypassed
    }

    return {
      id: attachmentId,
      filename: file.filename,
      url: relativeUrl,
      media_type: mediaType,
      mime_type: canonicalMime,
      file_name: file.originalname || file.filename || null,
      file_size: file.size || fileBuffer.length || null
    };
  }

  async function markStagingCommitted(urlOrFilename) {
    if (!urlOrFilename || typeof urlOrFilename !== 'string') return;
    const clean = urlOrFilename.split('?')[0].split('#')[0];
    const base = path.basename(clean);
    try {
      await db.run(
        `UPDATE post_attachment_staging SET is_committed = 1 WHERE url = ? OR filename = ?`,
        clean,
        base
      );
    } catch (_) {}
  }

  /**
   * POST /api/advertisements/media
   * Admin-only endpoint for uploading advertisement creative (image/video) or advertiser logo.
   */
  router.post('/media', requireAdminRole, upload.any(), async (req, res, next) => {
    try {
      const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
      if (!file) {
        return res.status(400).json({ message: 'Please select an image or video file to upload.' });
      }
      const saved = await saveUploadedFileToBlob(file, req.adminStudentId);
      res.status(201).json(saved);
    } catch (err) {
      if (req.files) {
        for (const f of req.files) await removeLocalUpload(f.path);
      }
      next(err);
    }
  });

  /**
   * GET /api/advertisements/eligible
   * Public authenticated endpoint returning currently active & date-eligible advertisements.
   */
  router.get('/eligible', async (req, res, next) => {
    try {
      const seed = req.query.seed || 'default-seed';
      const excludeRaw = req.query.excludeIds || req.query.seenAdIds || '';
      const excludeSet = new Set(
        String(excludeRaw)
          .split(',')
          .map(s => Number(s.trim()))
          .filter(n => Number.isInteger(n) && n > 0)
      );

      const eligible = await getEligibleAdvertisements(db);
      const filtered = eligible.filter(ad => !excludeSet.has(ad.id));
      const shuffled = shuffleWithSeed(filtered, `${seed}:ads`);

      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        advertisements: shuffled,
        seed: String(seed)
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/advertisements/manage
   * Admin-only endpoint returning all advertisements and summary statistics.
   */
  router.get('/manage', requireAdminRole, async (req, res, next) => {
    try {
      const statusFilter = req.query.status ? String(req.query.status).trim().toLowerCase() : null;
      const search = req.query.search ? String(req.query.search).trim() : null;

      const whereClauses = [];
      const params = [];

      if (statusFilter && statusFilter !== 'all') {
        if (statusFilter === 'active') {
          whereClauses.push("a.is_active = 1 AND a.status = 'active'");
        } else if (statusFilter === 'inactive' || statusFilter === 'paused') {
          whereClauses.push("(a.is_active = 0 OR a.status IN ('inactive', 'paused'))");
        } else {
          whereClauses.push('a.status = ?');
          params.push(statusFilter);
        }
      }

      if (search) {
        whereClauses.push('(a.advertiser_name LIKE ? OR a.primary_text LIKE ? OR a.headline LIKE ?)');
        const pattern = `%${search}%`;
        params.push(pattern, pattern, pattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const rows = await db.all(
        `SELECT a.*, s.name AS creator_name
         FROM advertisements a
         LEFT JOIN students s ON s.studentId = a.created_by
         ${whereSql}
         ORDER BY a.created_at DESC, a.id DESC`,
        ...params
      );

      const advertisements = (rows || []).map(row => ({
        ...formatAdvertisement(row, { includeAdminFields: true }),
        creator_name: row.creator_name || row.creatorName || null
      }));

      const allRows = statusFilter || search
        ? await db.all('SELECT * FROM advertisements')
        : rows;

      const totalAds = (allRows || []).length;
      const activeAds = (allRows || []).filter(r => Number(r.is_active ?? r.isActive ?? 0) === 1 && r.status === 'active').length;
      const totalImpressions = (allRows || []).reduce((sum, r) => sum + Number(r.impression_count ?? r.impressionCount ?? 0), 0);
      const totalClicks = (allRows || []).reduce((sum, r) => sum + Number(r.click_count ?? r.clickCount ?? 0), 0);

      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        advertisements,
        summary: {
          total: totalAds,
          active: activeAds,
          inactive: Math.max(0, totalAds - activeAds),
          totalImpressions,
          totalClicks,
          overallCtr: totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0
        }
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/advertisements
   * If `?manage=1` or `?admin=1` (or mounted at `/api/admin/advertisements`), enforces admin role and returns full list.
   * Otherwise returns eligible active advertisements for feed consumption.
   */
  router.get('/', async (req, res, next) => {
    const isAdminMount = req.baseUrl && req.baseUrl.includes('/admin');
    const isManageQuery = req.query.manage === '1' || req.query.manage === 'true' || req.query.admin === '1' || isAdminMount;
    if (isManageQuery) {
      return requireAdminRole(req, res, async (err) => {
        if (err) return next(err);
        try {
          const rows = await db.all(
            `SELECT a.*, s.name AS creator_name
             FROM advertisements a
             LEFT JOIN students s ON s.studentId = a.created_by
             ORDER BY a.created_at DESC, a.id DESC`
          );
          const advertisements = (rows || []).map(r => formatAdvertisement(r, { includeAdminFields: true }));
          const totalAds = advertisements.length;
          const activeAds = advertisements.filter(a => a.is_active === 1 && a.status === 'active').length;
          const totalImpressions = advertisements.reduce((sum, a) => sum + (a.impression_count || 0), 0);
          const totalClicks = advertisements.reduce((sum, a) => sum + (a.click_count || 0), 0);
          res.setHeader('Cache-Control', 'private, no-store');
          return res.json({
            advertisements,
            summary: {
              total: totalAds,
              active: activeAds,
              inactive: Math.max(0, totalAds - activeAds),
              totalImpressions,
              totalClicks,
              overallCtr: totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0
            }
          });
        } catch (e) {
          return next(e);
        }
      });
    }

    try {
      const seed = req.query.seed || 'default-seed';
      const excludeRaw = req.query.excludeIds || req.query.seenAdIds || '';
      const excludeSet = new Set(
        String(excludeRaw)
          .split(',')
          .map(s => Number(s.trim()))
          .filter(n => Number.isInteger(n) && n > 0)
      );
      const eligible = await getEligibleAdvertisements(db);
      const filtered = eligible.filter(ad => !excludeSet.has(ad.id));
      const shuffled = shuffleWithSeed(filtered, `${seed}:ads`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ advertisements: shuffled, seed: String(seed) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/advertisements/:id
   * Admin-only detail view for a single advertisement.
   */
  router.get('/:id', requireAdminRole, async (req, res, next) => {
    try {
      const adId = Number(req.params.id);
      if (!Number.isInteger(adId) || adId <= 0) {
        return res.status(400).json({ message: 'Invalid advertisement ID.' });
      }
      const row = await db.get('SELECT * FROM advertisements WHERE id = ?', adId);
      if (!row) {
        return res.status(404).json({ message: 'Advertisement not found.' });
      }
      res.json({ advertisement: formatAdvertisement(row, { includeAdminFields: true }) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/advertisements
   * Admin-only endpoint to create and publish/save an advertisement.
   * Supports JSON or multipart/form-data.
   */
  router.post('/', requireAdminRole, upload.any(), async (req, res, next) => {
    const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
    try {
      const body = { ...(req.body || {}) };

      for (const file of uploadedFiles) {
        const field = (file.fieldname || '').toLowerCase();
        const saved = await saveUploadedFileToBlob(file, req.adminStudentId);
        if (field === 'logo' || field === 'advertiser_logo' || field === 'advertiserlogo') {
          body.advertiser_logo_url = saved.url;
        } else {
          body.media_url = saved.url;
          body.media_type = saved.media_type;
          body.mime_type = saved.mime_type;
        }
      }

      // Support pre-uploaded attachment objects if passed via attachments array
      if (!body.media_url && Array.isArray(body.attachments) && body.attachments.length > 0) {
        const first = body.attachments[0];
        if (typeof first === 'string') {
          body.media_url = first;
        } else if (first && first.url) {
          body.media_url = first.url;
          if (!body.media_type && first.media_type) {
            body.media_type = first.media_type === 'video' ? 'video' : 'image';
          }
          if (!body.mime_type && first.mime_type) {
            body.mime_type = first.mime_type;
          }
        }
      }

      const validated = validateAdvertisementInput(body, { partial: false });
      const nowIso = new Date().toISOString();

      await markStagingCommitted(validated.media_url);
      if (validated.advertiser_logo_url) {
        await markStagingCommitted(validated.advertiser_logo_url);
      }

      const insertRes = await db.run(
        `INSERT INTO advertisements (
          advertiser_name,
          advertiser_logo_url,
          primary_text,
          headline,
          description,
          media_url,
          media_type,
          mime_type,
          cta_label,
          destination_url,
          status,
          is_active,
          start_date,
          end_date,
          impression_count,
          click_count,
          created_by,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
        validated.advertiser_name,
        validated.advertiser_logo_url,
        validated.primary_text,
        validated.headline,
        validated.description,
        validated.media_url,
        validated.media_type,
        validated.mime_type,
        validated.cta_label,
        validated.destination_url,
        validated.status,
        validated.is_active,
        validated.start_date,
        validated.end_date,
        req.adminStudentId,
        nowIso,
        nowIso
      );

      const newId = Number(insertRes.lastInsertRowid);
      const createdRow = await db.get('SELECT * FROM advertisements WHERE id = ?', newId);
      const formatted = formatAdvertisement(createdRow, { includeAdminFields: true });

      try {
        await recordAdminAudit(db, {
          actorUserId: req.adminStudentId,
          action: 'advertisement_created',
          entityType: 'advertisement',
          entityId: String(newId),
          afterState: {
            advertiser_name: formatted.advertiser_name,
            status: formatted.status,
            is_active: formatted.is_active,
            destination_url: formatted.destination_url
          }
        });
      } catch (_) {}

      res.status(201).json({
        advertisement: formatted,
        ...formatted
      });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ message: err.message });
      }
      next(err);
    }
  });

  /**
   * PUT / PATCH /api/advertisements/:id
   * Admin-only endpoint to update an existing advertisement.
   */
  const handleUpdateAd = async (req, res, next) => {
    const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
    try {
      const adId = Number(req.params.id);
      if (!Number.isInteger(adId) || adId <= 0) {
        return res.status(400).json({ message: 'Invalid advertisement ID.' });
      }

      const existing = await db.get('SELECT * FROM advertisements WHERE id = ?', adId);
      if (!existing) {
        return res.status(404).json({ message: 'Advertisement not found.' });
      }

      const body = { ...(req.body || {}) };
      for (const file of uploadedFiles) {
        const field = (file.fieldname || '').toLowerCase();
        const saved = await saveUploadedFileToBlob(file, req.adminStudentId);
        if (field === 'logo' || field === 'advertiser_logo' || field === 'advertiserlogo') {
          body.advertiser_logo_url = saved.url;
        } else {
          body.media_url = saved.url;
          body.media_type = saved.media_type;
          body.mime_type = saved.mime_type;
        }
      }

      const mergedPayload = {
        advertiser_name: body.advertiser_name ?? body.advertiserName ?? existing.advertiser_name,
        advertiser_logo_url: body.advertiser_logo_url !== undefined || body.advertiserLogoUrl !== undefined
          ? (body.advertiser_logo_url ?? body.advertiserLogoUrl)
          : existing.advertiser_logo_url,
        primary_text: body.primary_text ?? body.primaryText ?? body.content ?? existing.primary_text,
        headline: body.headline !== undefined ? body.headline : existing.headline,
        description: body.description !== undefined ? body.description : existing.description,
        media_url: body.media_url ?? body.mediaUrl ?? existing.media_url,
        media_type: body.media_type ?? body.mediaType ?? existing.media_type,
        mime_type: body.mime_type !== undefined || body.mimeType !== undefined
          ? (body.mime_type ?? body.mimeType)
          : existing.mime_type,
        cta_label: body.cta_label ?? body.ctaLabel ?? existing.cta_label,
        destination_url: body.destination_url ?? body.destinationUrl ?? existing.destination_url,
        status: body.status !== undefined ? body.status : existing.status,
        is_active: body.is_active !== undefined || body.isActive !== undefined
          ? (body.is_active ?? body.isActive)
          : (body.status !== undefined ? undefined : existing.is_active),
        start_date: body.start_date !== undefined || body.startDate !== undefined
          ? (body.start_date ?? body.startDate)
          : existing.start_date,
        end_date: body.end_date !== undefined || body.endDate !== undefined
          ? (body.end_date ?? body.endDate)
          : existing.end_date
      };

      const validated = validateAdvertisementInput(mergedPayload, { partial: false });
      const nowIso = new Date().toISOString();

      await markStagingCommitted(validated.media_url);
      if (validated.advertiser_logo_url) {
        await markStagingCommitted(validated.advertiser_logo_url);
      }

      await db.run(
        `UPDATE advertisements SET
          advertiser_name = ?,
          advertiser_logo_url = ?,
          primary_text = ?,
          headline = ?,
          description = ?,
          media_url = ?,
          media_type = ?,
          mime_type = ?,
          cta_label = ?,
          destination_url = ?,
          status = ?,
          is_active = ?,
          start_date = ?,
          end_date = ?,
          updated_at = ?
        WHERE id = ?`,
        validated.advertiser_name,
        validated.advertiser_logo_url,
        validated.primary_text,
        validated.headline,
        validated.description,
        validated.media_url,
        validated.media_type,
        validated.mime_type,
        validated.cta_label,
        validated.destination_url,
        validated.status,
        validated.is_active,
        validated.start_date,
        validated.end_date,
        nowIso,
        adId
      );

      const updatedRow = await db.get('SELECT * FROM advertisements WHERE id = ?', adId);
      const formatted = formatAdvertisement(updatedRow, { includeAdminFields: true });

      try {
        await recordAdminAudit(db, {
          actorUserId: req.adminStudentId,
          action: 'advertisement_updated',
          entityType: 'advertisement',
          entityId: String(adId),
          beforeState: { status: existing.status, is_active: existing.is_active },
          afterState: { status: formatted.status, is_active: formatted.is_active }
        });
      } catch (_) {}

      res.json({
        advertisement: formatted,
        ...formatted
      });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ message: err.message });
      }
      next(err);
    }
  };

  router.put('/:id', requireAdminRole, upload.any(), handleUpdateAd);
  router.patch('/:id', requireAdminRole, upload.any(), handleUpdateAd);

  /**
   * POST / PATCH /api/advertisements/:id/status
   * POST /api/advertisements/:id/activate
   * POST /api/advertisements/:id/deactivate
   * Admin-only status transitions (publish, pause, deactivate, reactivate).
   */
  const handleStatusChange = (forcedStatus = null) => async (req, res, next) => {
    try {
      const adId = Number(req.params.id);
      if (!Number.isInteger(adId) || adId <= 0) {
        return res.status(400).json({ message: 'Invalid advertisement ID.' });
      }
      const existing = await db.get('SELECT * FROM advertisements WHERE id = ?', adId);
      if (!existing) {
        return res.status(404).json({ message: 'Advertisement not found.' });
      }

      const rawStatus = forcedStatus !== null ? forcedStatus : req.body?.status;
      const rawActive = forcedStatus !== null ? (forcedStatus === 'active') : (req.body?.is_active ?? req.body?.isActive);
      const norm = normalizeAdStatus(rawStatus, rawActive);
      const nowIso = new Date().toISOString();

      await db.run(
        `UPDATE advertisements SET status = ?, is_active = ?, updated_at = ? WHERE id = ?`,
        norm.status,
        norm.is_active,
        nowIso,
        adId
      );

      const updatedRow = await db.get('SELECT * FROM advertisements WHERE id = ?', adId);
      const formatted = formatAdvertisement(updatedRow, { includeAdminFields: true });

      try {
        await recordAdminAudit(db, {
          actorUserId: req.adminStudentId,
          action: norm.is_active ? 'advertisement_activated' : 'advertisement_deactivated',
          entityType: 'advertisement',
          entityId: String(adId),
          beforeState: { status: existing.status, is_active: existing.is_active },
          afterState: { status: formatted.status, is_active: formatted.is_active }
        });
      } catch (_) {}

      res.json({
        advertisement: formatted,
        ...formatted
      });
    } catch (err) {
      next(err);
    }
  };

  router.post('/:id/status', requireAdminRole, handleStatusChange(null));
  router.patch('/:id/status', requireAdminRole, handleStatusChange(null));
  router.post('/:id/activate', requireAdminRole, handleStatusChange('active'));
  router.post('/:id/publish', requireAdminRole, handleStatusChange('active'));
  router.post('/:id/deactivate', requireAdminRole, handleStatusChange('inactive'));
  router.post('/:id/pause', requireAdminRole, handleStatusChange('paused'));

  /**
   * DELETE /api/advertisements/:id
   * Admin-only endpoint to delete an advertisement.
   */
  router.delete('/:id', requireAdminRole, async (req, res, next) => {
    try {
      const adId = Number(req.params.id);
      if (!Number.isInteger(adId) || adId <= 0) {
        return res.status(400).json({ message: 'Invalid advertisement ID.' });
      }
      const existing = await db.get('SELECT * FROM advertisements WHERE id = ?', adId);
      if (!existing) {
        return res.status(404).json({ message: 'Advertisement not found.' });
      }

      await db.run('DELETE FROM advertisements WHERE id = ?', adId);

      try {
        await recordAdminAudit(db, {
          actorUserId: req.adminStudentId,
          action: 'advertisement_deleted',
          entityType: 'advertisement',
          entityId: String(adId),
          beforeState: {
            advertiser_name: existing.advertiser_name,
            status: existing.status
          }
        });
      } catch (_) {}

      res.json({
        ok: true,
        deleted: adId,
        message: 'Advertisement deleted.'
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/advertisements/:id/impression
   * First-party deduplicated impression tracking.
   */
  router.post('/:id/impression', async (req, res, next) => {
    try {
      const studentId = req.student?.studentId || req.user?.studentId || req.session?.studentId || 'anon';
      const sessionKey = req.body?.sessionKey || req.body?.session_key || req.headers['x-feed-session'] || req.sessionID || 'default';
      const result = await recordAdvertisementImpression(db, {
        advertisementId: req.params.id,
        studentId,
        sessionKey
      });
      res.status(200).json(result);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ message: err.message });
      }
      next(err);
    }
  });

  /**
   * POST /api/advertisements/:id/click
   * First-party CTA click tracking.
   */
  router.post('/:id/click', async (req, res, next) => {
    try {
      const studentId = req.student?.studentId || req.user?.studentId || req.session?.studentId || 'anon';
      const sessionKey = req.body?.sessionKey || req.body?.session_key || req.headers['x-feed-session'] || req.sessionID || 'default';
      const result = await recordAdvertisementClick(db, {
        advertisementId: req.params.id,
        studentId,
        sessionKey
      });
      res.status(200).json(result);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ message: err.message });
      }
      next(err);
    }
  });

  return router;
};
