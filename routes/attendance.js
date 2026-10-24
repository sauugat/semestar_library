'use strict';

const express = require('express');
const {
  getEligibilityThresholdConfig,
  updateEligibilityThresholdConfig,
  getTeacherAttendanceContext,
  getAttendanceRoster,
  saveAttendanceSession,
  editAttendanceSessionById,
  adminCorrectAttendanceSession,
  getAttendanceSessionAuditLogs,
  listAttendanceSessions,
  getStudentAttendanceSummary,
  assertNoForbiddenSecrets,
  getTeacherDriveBackupStatus,
  upsertTeacherDriveConnection,
  disconnectTeacherDriveConnection,
  listPendingBackupWork,
  claimBackupRunArtifacts,
  completeBackupArtifact,
  failBackupArtifact,
  getBackupRunArtifacts,
  getSessionBackupRevisionsAuthorized,
  generateDailyAttendanceWorkbook,
  generateAnnualAttendanceWorkbook
} = require('../lib/attendance-service');

function resolveCallerId(req) {
  return (
    (req.user && req.user.studentId) ||
    (req.student && req.student.studentId) ||
    (req.session && req.session.studentId) ||
    null
  );
}

function sendAttendanceError(res, err, fallbackMessage = 'Attendance operation failed.') {
  const status = Number(err && (err.status || err.statusCode)) || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const safeMessage = status >= 500 && isProd ? fallbackMessage : (err && err.message) || fallbackMessage;
  const payload = {
    error: (err && err.code) || (status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'ATTENDANCE_ERROR'),
    code: (err && err.code) || undefined,
    message: safeMessage
  };
  return res.status(status).json(payload);
}

function createAttendanceRouter(arg1, arg2) {
  let db, requireLogin;
  if (arg1 && arg1.db) {
    db = arg1.db;
    requireLogin = arg1.requireLogin || ((req, res, next) => next());
  } else {
    db = arg1;
    requireLogin = arg2 || ((req, res, next) => next());
  }

  const router = express.Router();

  // Authoritative Admin Guard
  const requireAdminRole = async (req, res, next) => {
    const callerId = resolveCallerId(req);
    if (!callerId) {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Authentication required. Please sign in.' });
    }
    try {
      const user = await db.get(
        'SELECT studentId, role, account_status FROM students WHERE studentId = ?',
        callerId
      );
      if (!user || (user.account_status || user.accountStatus || 'active') === 'suspended') {
        return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Forbidden: Account is suspended or invalid.' });
      }
      if (String(user.role || '').toLowerCase() !== 'admin') {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Forbidden: Administrator access required.' });
      }
      req.adminStudentId = user.studentId || user.studentid;
      next();
    } catch (err) {
      return res.status(500).json({ error: 'AUTH_ERROR', message: 'Authorization check failed.' });
    }
  };

  const isAdminMount = (req) => /\/admin\/attendance$/i.test(req.baseUrl || '');

  // If mounted at /api/admin/attendance, strictly enforce admin role on all routes under this mount
  router.use((req, res, next) => {
    if (!isAdminMount(req)) return next();
    return requireLogin(req, res, (err) => {
      if (err) return next(err);
      return requireAdminRole(req, res, next);
    });
  });

  /**
   * 1. GET /api/attendance/teacher/context
   * Allowed: teacher and admin.
   * Returns authorized subjects and active cohorts for those subjects.
   */
  router.get('/teacher/context', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const context = await getTeacherAttendanceContext(db, { actorUserId: callerId });
      return res.json(context);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to load teacher attendance context.');
    }
  });

  /**
   * 2. GET /api/attendance/roster
   * Allowed: teacher and admin.
   * Query: subjectId, cohortId, date (or sessionDate).
   */
  router.get('/roster', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const subjectId = req.query.subjectId || req.query.subject_id || req.query.subject;
      const cohortId = req.query.cohortId || req.query.cohort_id || req.query.cohort;
      const sessionDate = req.query.sessionDate || req.query.session_date || req.query.date || null;

      const result = await getAttendanceRoster(db, {
        actorUserId: callerId,
        subjectId,
        cohortId,
        sessionDate
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to load attendance roster.');
    }
  });

  /**
   * 3. POST /api/attendance/sessions
   * Allowed: teacher and admin.
   * Creates a new attendance session or updates an existing session within the 24-hour window.
   */
  router.post('/sessions', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const body = req.body || {};
      const subjectId = body.subjectId || body.subject_id || body.subject;
      const cohortId = body.cohortId || body.cohort_id || body.cohort;
      const sessionDate = body.sessionDate || body.session_date || body.date;
      const records = body.records;
      const reason = body.reason || null;

      const result = await saveAttendanceSession(db, {
        actorUserId: callerId,
        subjectId,
        cohortId,
        sessionDate,
        records,
        reason
      });

      return res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to save attendance session.');
    }
  });

  /**
   * 9. Admin Correction Handler (Post-24h window corrections)
   */
  const handleAdminCorrection = async (req, res) => {
    try {
      const body = req.body || {};
      const result = await adminCorrectAttendanceSession(db, {
        adminUserId: req.adminStudentId || resolveCallerId(req),
        sessionId: req.params.id,
        records: body.records,
        reason: body.reason
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to apply administrative attendance correction.');
    }
  };

  /**
   * 4. PUT / PATCH /api/attendance/sessions/:id
   * When called under /api/attendance/sessions/:id -> teacher/admin 24-hour window edit.
   * When called under /api/admin/attendance/sessions/:id -> admin post-window correction.
   */
  const handleEditSessionById = async (req, res) => {
    if (isAdminMount(req)) {
      return handleAdminCorrection(req, res);
    }
    try {
      const callerId = resolveCallerId(req);
      const body = req.body || {};
      const result = await editAttendanceSessionById(db, {
        actorUserId: callerId,
        sessionId: req.params.id,
        records: body.records,
        reason: body.reason || null
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to update attendance session.');
    }
  };
  router.put('/sessions/:id', requireLogin, handleEditSessionById);
  router.patch('/sessions/:id', requireLogin, handleEditSessionById);

  /**
   * 5. GET /api/attendance/sessions
   * Allowed: teacher and admin.
   * Returns authorized historical sessions and attendance counts.
   */
  router.get('/sessions', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const subjectId = req.query.subjectId || req.query.subject_id || req.query.subject || null;
      const cohortId = req.query.cohortId || req.query.cohort_id || req.query.cohort || null;
      const semester = req.query.semester || req.query.semester_no || null;
      const startDate = req.query.startDate || req.query.start_date || null;
      const endDate = req.query.endDate || req.query.end_date || null;

      const result = await listAttendanceSessions(db, {
        actorUserId: callerId,
        subjectId,
        cohortId,
        semester,
        startDate,
        endDate
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to load attendance sessions.');
    }
  });

  /**
   * 6. GET /api/attendance/sessions/:id/audit
   * Allowed: authorized teacher and admin.
   */
  router.get('/sessions/:id/audit', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const result = await getAttendanceSessionAuditLogs(db, {
        actorUserId: callerId,
        sessionId: req.params.id
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to load session audit history.');
    }
  });

  /**
   * 6b. GET /api/attendance/sessions/:id/revisions
   * Allowed: authorized teacher and admin.
   * Returns chronological immutable backup revisions and per-artifact states for the session.
   */
  router.get('/sessions/:id/revisions', requireLogin, async (req, res) => {
    try {
      assertNoForbiddenSecrets(req.query, 'revisions query parameters');
      const callerId = resolveCallerId(req);
      const result = await getSessionBackupRevisionsAuthorized(db, {
        actorUserId: callerId,
        sessionId: req.params.id
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to load session backup revisions.');
    }
  });

  // ==========================================================================
  // PHASE 2A — GOOGLE DRIVE BACKUP COORDINATION ROUTES
  // ==========================================================================

  /**
   * GET /api/attendance/backup/status
   * Allowed: teacher (own status) and admin (read-only administrative visibility).
   */
  router.get('/backup/status', requireLogin, async (req, res) => {
    try {
      assertNoForbiddenSecrets(req.query, 'backup status query parameters');
      const callerId = resolveCallerId(req);
      const requestedTeacherId = req.query.teacherId || req.query.teacher_id || null;
      const requestedUserId = req.query.userId || req.query.user_id || req.query.studentId || req.query.student_id || null;
      const requestedRole = req.query.role || null;

      const status = await getTeacherDriveBackupStatus(db, {
        actorUserId: callerId,
        requestedTeacherId,
        requestedUserId,
        requestedRole
      });
      return res.json(status);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to load Google Drive backup status.');
    }
  });

  /**
   * PUT /api/attendance/backup/connection
   * Allowed: teacher only (stores non-secret folder IDs & connection state; rejects tokens/secrets).
   */
  router.put('/backup/connection', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const result = await upsertTeacherDriveConnection(db, {
        actorUserId: callerId,
        body: req.body || {}
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to update Google Drive backup connection.');
    }
  });

  /**
   * POST /api/attendance/backup/disconnect
   * Allowed: teacher only.
   */
  router.post('/backup/disconnect', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const result = await disconnectTeacherDriveConnection(db, {
        actorUserId: callerId,
        body: req.body || {}
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to disconnect Google Drive backup.');
    }
  });

  /**
   * GET /api/attendance/backup/pending
   * Allowed: teacher (own authorized pending runs) and admin (read-only administrative visibility).
   */
  router.get('/backup/pending', requireLogin, async (req, res) => {
    try {
      assertNoForbiddenSecrets(req.query, 'pending backup query parameters');
      const callerId = resolveCallerId(req);
      const requestedTeacherId = req.query.teacherId || req.query.teacher_id || null;
      const requestedUserId = req.query.userId || req.query.user_id || req.query.studentId || req.query.student_id || null;
      const requestedRole = req.query.role || null;
      const sessionId = req.query.sessionId || req.query.session_id || null;

      const result = await listPendingBackupWork(db, {
        actorUserId: callerId,
        requestedTeacherId,
        requestedUserId,
        requestedRole,
        sessionId
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to list pending attendance backups.');
    }
  });

  /**
   * POST /api/attendance/backup/runs/:runId/claim
   * Allowed: authorized owning teacher only.
   */
  router.post('/backup/runs/:runId/claim', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const result = await claimBackupRunArtifacts(db, {
        actorUserId: callerId,
        runId: req.params.runId,
        body: req.body || {}
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to claim attendance backup run.');
    }
  });

  /**
   * POST /api/attendance/backup/runs/:runId/complete
   * Allowed: authorized owning teacher only.
   */
  router.post('/backup/runs/:runId/complete', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const result = await completeBackupArtifact(db, {
        actorUserId: callerId,
        runId: req.params.runId,
        body: req.body || {}
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to complete attendance backup artifact.');
    }
  });

  /**
   * POST /api/attendance/backup/runs/:runId/fail
   * Allowed: authorized owning teacher only.
   */
  router.post('/backup/runs/:runId/fail', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const result = await failBackupArtifact(db, {
        actorUserId: callerId,
        runId: req.params.runId,
        body: req.body || {}
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to record attendance backup failure.');
    }
  });

  /**
   * GET /api/attendance/backup/runs/:runId/artifacts
   * Allowed: authorized teacher and admin.
   */
  router.get('/backup/runs/:runId/artifacts', requireLogin, async (req, res) => {
    try {
      assertNoForbiddenSecrets(req.query, 'backup artifacts query parameters');
      const callerId = resolveCallerId(req);
      const includePayloads =
        req.query.includePayloads === '1' ||
        req.query.includePayloads === 'true' ||
        req.query.bundle === '1' ||
        req.query.bundle === 'true';

      const result = await getBackupRunArtifacts(db, {
        actorUserId: callerId,
        runId: req.params.runId,
        includePayloads
      });
      return res.json(result);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to load attendance backup artifacts.');
    }
  });

  // ==========================================================================
  // PHASE 2B — SERVER-AUTHORITATIVE XLSX WORKBOOK ENDPOINTS
  // ==========================================================================

  const handleDailyWorkbook = async (req, res) => {
    try {
      assertNoForbiddenSecrets(req.query, 'daily workbook query parameters');
      const callerId = resolveCallerId(req);
      const date = req.query.date || req.query.sessionDate || req.query.session_date || null;
      const subjectId = req.query.subjectId || req.query.subject_id || req.query.subject || null;
      const cohortId = req.query.cohortId || req.query.cohort_id || req.query.cohort || null;
      const requestedTeacherId = req.query.teacherId || req.query.teacher_id || null;
      const requestedUserId = req.query.userId || req.query.user_id || req.query.studentId || req.query.student_id || null;
      const requestedRole = req.query.role || null;
      const format = String(req.query.format || '').trim().toLowerCase();

      const workbook = await generateDailyAttendanceWorkbook(db, {
        actorUserId: callerId,
        date,
        subjectId,
        cohortId,
        requestedTeacherId,
        requestedUserId,
        requestedRole
      });

      if (format === 'json') {
        return res.json({
          filename: workbook.filename,
          mimeType: workbook.mimeType,
          date: workbook.date,
          sessionCount: workbook.sessionCount,
          sessions: workbook.sessions,
          sheetNames: workbook.sheetNames,
          sha256: workbook.sha256,
          sizeBytes: workbook.sizeBytes,
          base64: workbook.buffer.toString('base64')
        });
      }

      res.setHeader('Content-Type', workbook.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${workbook.filename}"`);
      res.setHeader('Content-Length', String(workbook.sizeBytes));
      res.setHeader('X-Workbook-Sha256', workbook.sha256);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(workbook.buffer);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to generate daily attendance workbook.');
    }
  };

  const handleAnnualWorkbook = async (req, res) => {
    try {
      assertNoForbiddenSecrets(req.query, 'annual workbook query parameters');
      const callerId = resolveCallerId(req);
      const year = req.query.year || null;
      const subjectId = req.query.subjectId || req.query.subject_id || req.query.subject || null;
      const cohortId = req.query.cohortId || req.query.cohort_id || req.query.cohort || null;
      const requestedTeacherId = req.query.teacherId || req.query.teacher_id || null;
      const requestedUserId = req.query.userId || req.query.user_id || req.query.studentId || req.query.student_id || null;
      const requestedRole = req.query.role || null;
      const format = String(req.query.format || '').trim().toLowerCase();

      const workbook = await generateAnnualAttendanceWorkbook(db, {
        actorUserId: callerId,
        year,
        subjectId,
        cohortId,
        requestedTeacherId,
        requestedUserId,
        requestedRole
      });

      if (format === 'json') {
        return res.json({
          filename: workbook.filename,
          mimeType: workbook.mimeType,
          year: workbook.year,
          startDate: workbook.startDate,
          endDate: workbook.endDate,
          sessionCount: workbook.sessionCount,
          sessions: workbook.sessions,
          sheetNames: workbook.sheetNames,
          sha256: workbook.sha256,
          sizeBytes: workbook.sizeBytes,
          base64: workbook.buffer.toString('base64')
        });
      }

      res.setHeader('Content-Type', workbook.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${workbook.filename}"`);
      res.setHeader('Content-Length', String(workbook.sizeBytes));
      res.setHeader('X-Workbook-Sha256', workbook.sha256);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(workbook.buffer);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to generate annual attendance workbook.');
    }
  };

  router.get('/backup/workbooks/daily', requireLogin, handleDailyWorkbook);
  router.get('/workbooks/daily', requireLogin, handleDailyWorkbook);
  router.get('/backup/workbooks/annual', requireLogin, handleAnnualWorkbook);
  router.get('/workbooks/annual', requireLogin, handleAnnualWorkbook);

  /**
   * 7. GET /api/attendance/my-summary
   * Allowed: student and CR.
   * Returns attendance summary strictly for the authenticated user.
   * Rejects any attempt to access another student's summary via query parameters.
   */
  router.get('/my-summary', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const requestedStudentId =
        req.query.studentId ||
        req.query.student_id ||
        req.query.userId ||
        req.query.user_id ||
        null;

      if (requestedStudentId && String(requestedStudentId).trim() !== String(callerId).trim()) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          code: 'CROSS_STUDENT_ACCESS_DENIED',
          message: 'Forbidden: You can only view your own attendance summary.'
        });
      }

      const summary = await getStudentAttendanceSummary(db, { studentUserId: callerId });
      return res.json(summary);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to load attendance summary.');
    }
  });

  /**
   * 8. Admin Configuration Routes: Read & Update Eligibility Threshold
   */
  const handleGetThreshold = async (req, res) => {
    try {
      const config = await getEligibilityThresholdConfig(db);
      return res.json(config);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to read attendance eligibility threshold.');
    }
  };

  const handleUpdateThreshold = async (req, res) => {
    try {
      const body = req.body || {};
      const rawThreshold =
        body.threshold !== undefined
          ? body.threshold
          : body.eligibilityThreshold !== undefined
          ? body.eligibilityThreshold
          : body.minimumPercentage;

      const updated = await updateEligibilityThresholdConfig(db, {
        adminUserId: req.adminStudentId,
        threshold: rawThreshold,
        reason: body.reason || null
      });
      return res.json(updated);
    } catch (err) {
      return sendAttendanceError(res, err, 'Failed to update attendance eligibility threshold.');
    }
  };

  router.get('/settings', requireLogin, handleGetThreshold);
  router.get('/threshold', requireLogin, handleGetThreshold);
  router.get('/admin/settings', requireLogin, requireAdminRole, handleGetThreshold);
  router.get('/admin/threshold', requireLogin, requireAdminRole, handleGetThreshold);

  router.put('/settings', requireLogin, requireAdminRole, handleUpdateThreshold);
  router.post('/settings', requireLogin, requireAdminRole, handleUpdateThreshold);
  router.patch('/settings', requireLogin, requireAdminRole, handleUpdateThreshold);
  router.put('/threshold', requireLogin, requireAdminRole, handleUpdateThreshold);
  router.post('/threshold', requireLogin, requireAdminRole, handleUpdateThreshold);
  router.put('/admin/settings', requireLogin, requireAdminRole, handleUpdateThreshold);
  router.post('/admin/settings', requireLogin, requireAdminRole, handleUpdateThreshold);
  router.patch('/admin/settings', requireLogin, requireAdminRole, handleUpdateThreshold);
  router.put('/admin/threshold', requireLogin, requireAdminRole, handleUpdateThreshold);
  router.post('/admin/threshold', requireLogin, requireAdminRole, handleUpdateThreshold);

  router.post('/sessions/:id/correct', requireLogin, requireAdminRole, handleAdminCorrection);
  router.post('/admin/sessions/:id/correct', requireLogin, requireAdminRole, handleAdminCorrection);
  router.patch('/admin/sessions/:id', requireLogin, requireAdminRole, handleAdminCorrection);
  router.put('/admin/sessions/:id', requireLogin, requireAdminRole, handleAdminCorrection);
  router.post('/sessions/:id/admin-correct', requireLogin, requireAdminRole, handleAdminCorrection);

  return router;
}

module.exports = createAttendanceRouter;
module.exports.createAttendanceRouter = createAttendanceRouter;
