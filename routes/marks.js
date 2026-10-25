'use strict';

const express = require('express');
const {
  getTeacherMarksContext,
  getExamConfiguration,
  upsertExamConfiguration,
  getSubjectMarksRoster,
  saveStudentMarks,
  publishSubjectResults,
  getSubjectMarksAuditLogs,
  getStudentPublishedResults
} = require('../lib/marks-service');

function resolveCallerId(req) {
  return (
    (req.user && req.user.studentId) ||
    (req.student && req.student.studentId) ||
    (req.session && req.session.studentId) ||
    null
  );
}

function sendMarksError(res, err, fallbackMessage = 'Marks & Results operation failed.') {
  const status = Number(err && (err.status || err.statusCode)) || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const safeMessage = status >= 500 && isProd ? fallbackMessage : (err && err.message) || fallbackMessage;
  const payload = {
    error: (err && err.code) || (status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'MARKS_ERROR'),
    code: (err && err.code) || undefined,
    message: safeMessage
  };
  return res.status(status).json(payload);
}

function createMarksRouter(arg1, arg2) {
  let db, requireLogin;
  if (arg1 && arg1.db) {
    db = arg1.db;
    requireLogin = arg1.requireLogin || ((req, res, next) => next());
  } else {
    db = arg1;
    requireLogin = arg2 || ((req, res, next) => next());
  }

  const router = express.Router();

  // Authoritative Admin Guard when mounted under /api/admin/marks
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

  const isAdminMount = (req) => /\/admin\/marks$/i.test(req.baseUrl || '');
  const isResultsMount = (req) => /\/results$/i.test(req.baseUrl || '');

  router.use((req, res, next) => {
    if (!isAdminMount(req)) return next();
    return requireLogin(req, res, (err) => {
      if (err) return next(err);
      return requireAdminRole(req, res, next);
    });
  });

  /**
   * Helper: Detect and reject any student attempting to query another student's results
   */
  function enforceStudentSelfIsolation(req, callerId) {
    const requestedStudentId =
      (req.query && (req.query.studentId || req.query.student_id || req.query.userId || req.query.user_id)) ||
      (req.body && (req.body.studentId || req.body.student_id || req.body.userId || req.body.user_id)) ||
      (req.params && (req.params.studentId || req.params.student_id)) ||
      null;

    if (requestedStudentId && String(requestedStudentId).trim() !== String(callerId).trim()) {
      const err = new Error('Forbidden: You can only access your own published results.');
      err.status = 403;
      err.code = 'CROSS_STUDENT_ACCESS_DENIED';
      throw err;
    }
  }

  /**
   * 1. GET /api/marks/teacher/context (also /api/marks/subjects, /api/marks/context)
   * Allowed: teacher and admin.
   * Returns authorized subjects, exam types, and exam status overview.
   */
  const handleGetContext = async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const context = await getTeacherMarksContext(db, { actorUserId: callerId });
      return res.json(context);
    } catch (err) {
      return sendMarksError(res, err, 'Failed to load teacher marks entry context.');
    }
  };

  router.get('/teacher/context', requireLogin, handleGetContext);
  router.get('/context', requireLogin, handleGetContext);
  router.get('/subjects', requireLogin, handleGetContext);

  /**
   * 2. GET /api/marks/config (also /api/marks/exam-config, /api/marks/configurations)
   * Allowed: authorized teacher and admin.
   * Query: subjectId, examType (optional)
   */
  const handleGetConfig = async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const subjectId = req.query.subjectId || req.query.subject_id || req.query.subject;
      const examType = req.query.examType || req.query.exam_type || req.query.exam || null;
      const result = await getExamConfiguration(db, {
        actorUserId: callerId,
        subjectId,
        examType
      });
      return res.json(result);
    } catch (err) {
      return sendMarksError(res, err, 'Failed to load exam configuration.');
    }
  };

  router.get('/config', requireLogin, handleGetConfig);
  router.get('/exam-config', requireLogin, handleGetConfig);
  router.get('/configurations', requireLogin, handleGetConfig);

  /**
   * 3. POST / PUT / PATCH /api/marks/config
   * Allowed: authorized teacher and admin.
   * Body: { subjectId, examType, maxMarks, reason }
   */
  const handleUpsertConfig = async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const body = req.body || {};
      const subjectId = body.subjectId || body.subject_id || body.subject || req.query.subjectId;
      const examType = body.examType || body.exam_type || body.exam || req.query.examType;
      const maxMarks =
        body.maxMarks !== undefined
          ? body.maxMarks
          : body.max_marks !== undefined
          ? body.max_marks
          : body.maximumMarks;

      const result = await upsertExamConfiguration(db, {
        actorUserId: callerId,
        subjectId,
        examType,
        maxMarks,
        reason: body.reason || null
      });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      return sendMarksError(res, err, 'Failed to save exam configuration.');
    }
  };

  router.post('/config', requireLogin, handleUpsertConfig);
  router.put('/config', requireLogin, handleUpsertConfig);
  router.patch('/config', requireLogin, handleUpsertConfig);
  router.post('/exam-config', requireLogin, handleUpsertConfig);
  router.put('/exam-config', requireLogin, handleUpsertConfig);
  router.patch('/exam-config', requireLogin, handleUpsertConfig);

  /**
   * 4. GET /api/marks/roster (also /api/marks/students, /api/marks/register)
   * Allowed: authorized teacher and admin.
   * Query: subjectId, examType, cohortId (optional)
   */
  const handleGetRoster = async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const subjectId = req.query.subjectId || req.query.subject_id || req.query.subject;
      const examType = req.query.examType || req.query.exam_type || req.query.exam || null;
      const cohortId = req.query.cohortId || req.query.cohort_id || req.query.cohort || null;

      const result = await getSubjectMarksRoster(db, {
        actorUserId: callerId,
        subjectId,
        examType,
        cohortId
      });
      return res.json(result);
    } catch (err) {
      return sendMarksError(res, err, 'Failed to load enrolled students and marks register.');
    }
  };

  router.get('/roster', requireLogin, handleGetRoster);
  router.get('/students', requireLogin, handleGetRoster);
  router.get('/register', requireLogin, handleGetRoster);

  /**
   * 5. POST / PUT / PATCH /api/marks/draft (and /api/marks/save, /api/marks)
   * Saves draft marks (or edits marks) for a subject and exam type.
   */
  const handleSaveMarks = (options = {}) => async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const body = req.body || {};
      const subjectId = body.subjectId || body.subject_id || body.subject;
      const examType = body.examType || body.exam_type || body.exam;
      const cohortId = body.cohortId || body.cohort_id || body.cohort || null;
      const maxMarks =
        body.maxMarks !== undefined
          ? body.maxMarks
          : body.max_marks !== undefined
          ? body.max_marks
          : body.maximumMarks;
      const records = Array.isArray(body.records)
        ? body.records
        : Array.isArray(body.marks)
        ? body.marks
        : Array.isArray(body.students)
        ? body.students
        : [];
      const publish = Boolean(options.publish || body.publish === true || body.status === 'published');
      const editPublished = Boolean(options.editPublished || body.editPublished === true);

      const result = await saveStudentMarks(db, {
        actorUserId: callerId,
        subjectId,
        examType,
        maxMarks,
        records,
        cohortId,
        publish,
        editPublished,
        reason: body.reason || null
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendMarksError(res, err, 'Failed to save student marks.');
    }
  };

  router.post('/draft', requireLogin, handleSaveMarks({ publish: false }));
  router.put('/draft', requireLogin, handleSaveMarks({ publish: false }));
  router.post('/save', requireLogin, handleSaveMarks({ publish: false }));
  router.put('/save', requireLogin, handleSaveMarks({ publish: false }));

  /**
   * 6. POST / PUT /api/marks/publish
   * Publishes results for a subject and exam type.
   */
  const handlePublishResults = async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const body = req.body || {};
      const subjectId = body.subjectId || body.subject_id || body.subject;
      const examType = body.examType || body.exam_type || body.exam;
      const cohortId = body.cohortId || body.cohort_id || body.cohort || null;
      const maxMarks =
        body.maxMarks !== undefined
          ? body.maxMarks
          : body.max_marks !== undefined
          ? body.max_marks
          : body.maximumMarks;
      const records = Array.isArray(body.records)
        ? body.records
        : Array.isArray(body.marks)
        ? body.marks
        : Array.isArray(body.students)
        ? body.students
        : undefined;

      const result = await publishSubjectResults(db, {
        actorUserId: callerId,
        subjectId,
        examType,
        maxMarks,
        records,
        cohortId,
        reason: body.reason || null
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendMarksError(res, err, 'Failed to publish exam results.');
    }
  };

  router.post('/publish', requireLogin, handlePublishResults);
  router.put('/publish', requireLogin, handlePublishResults);

  /**
   * 7. PUT / PATCH / POST /api/marks/published (and /api/marks/edit-published)
   * Authorized editing of already-published marks with audit tracking.
   */
  router.put('/published', requireLogin, handleSaveMarks({ editPublished: true }));
  router.patch('/published', requireLogin, handleSaveMarks({ editPublished: true }));
  router.post('/edit-published', requireLogin, handleSaveMarks({ editPublished: true }));

  /**
   * 8. GET /api/marks/audit
   * Returns audit history for marks & configuration changes on a subject/exam.
   */
  router.get('/audit', requireLogin, async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      const subjectId = req.query.subjectId || req.query.subject_id || req.query.subject;
      const examType = req.query.examType || req.query.exam_type || req.query.exam || null;
      const result = await getSubjectMarksAuditLogs(db, {
        actorUserId: callerId,
        subjectId,
        examType
      });
      return res.json(result);
    } catch (err) {
      return sendMarksError(res, err, 'Failed to load marks audit logs.');
    }
  });

  /**
   * 9. GET /api/results/my-results (and /api/marks/my-results, /api/results/student, /api/results/student/:studentId)
   * Allowed: student and CR.
   * Strictly returns ONLY the authenticated student's own published results.
   */
  const handleGetStudentResults = async (req, res) => {
    try {
      const callerId = resolveCallerId(req);
      enforceStudentSelfIsolation(req, callerId);

      const semesterFilter = req.query.semester || req.query.semesterNo || req.query.semester_no || null;
      const results = await getStudentPublishedResults(db, {
        studentUserId: callerId,
        semesterFilter
      });
      return res.json(results);
    } catch (err) {
      return sendMarksError(res, err, 'Failed to load published results.');
    }
  };

  router.get('/my-results', requireLogin, handleGetStudentResults);
  router.get('/my-summary', requireLogin, handleGetStudentResults);
  router.get('/student', requireLogin, handleGetStudentResults);
  router.get('/student/:studentId', requireLogin, handleGetStudentResults);

  /**
   * Root handlers on /api/marks and /api/results:
   * - If GET /api/results -> student published results (or if subjectId query param is passed by teacher/admin on /api/marks -> roster).
   * - If POST/PUT/PATCH /api/marks -> save marks (rejects students with 403).
   */
  router.get('/', requireLogin, async (req, res) => {
    const subjectId = req.query.subjectId || req.query.subject_id || req.query.subject;
    if (isResultsMount(req) && !subjectId) {
      return handleGetStudentResults(req, res);
    }
    if (subjectId) {
      return handleGetRoster(req, res);
    }
    if (isResultsMount(req)) {
      return handleGetStudentResults(req, res);
    }
    return handleGetContext(req, res);
  });

  router.post('/', requireLogin, handleSaveMarks({ publish: false }));
  router.put('/', requireLogin, handleSaveMarks({ publish: false }));
  router.patch('/', requireLogin, handleSaveMarks({ publish: false }));

  return router;
}

module.exports = createMarksRouter;
