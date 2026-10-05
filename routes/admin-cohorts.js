'use strict';

const express = require('express');
const {
  getAllCohortsWithHistory,
  getCohortHistory,
  createCohort,
  promoteCohort,
  graduateCohort,
  recycleSlot,
  assignStudentToCohort,
  reassignStudentCohort
} = require('../lib/academic-context');

function adminCohortsRouter(arg1, arg2) {
  let db, requireLogin;
  if (arg1 && arg1.db) {
    db = arg1.db;
    requireLogin = arg1.requireLogin || ((req, res, next) => next());
  } else {
    db = arg1;
    requireLogin = arg2 || ((req, res, next) => next());
  }
  const router = express.Router();

  // Guard: require authenticated session and admin role
  const requireAdminRole = async (req, res, next) => {
    const studentId = req.student?.studentId || req.user?.studentId || req.session?.studentId;
    if (!studentId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    if (req.user?.role === 'admin' || req.student?.role === 'admin') {
      req.adminStudentId = studentId;
      return next();
    }

    try {
      const student = await db.get('SELECT studentId, role FROM students WHERE studentId = ?', studentId);
      if (!student || student.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied: Administrator access required.' });
      }
      req.adminStudentId = student.studentId;
      next();
    } catch (err) {
      return res.status(500).json({ message: 'Authorization check failed.' });
    }
  };

  // Guard: allow teachers and admins to inspect historical timeline
  const requireStaffRole = async (req, res, next) => {
    const studentId = req.student?.studentId || req.user?.studentId || req.session?.studentId;
    if (!studentId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    try {
      const student = await db.get('SELECT studentId, role FROM students WHERE studentId = ?', studentId);
      if (!student || (student.role !== 'admin' && student.role !== 'teacher')) {
        return res.status(403).json({ message: 'Access denied: Staff access required.' });
      }
      req.staffStudentId = student.studentId;
      next();
    } catch (err) {
      return res.status(500).json({ message: 'Authorization check failed.' });
    }
  };

  // 1. GET /api/admin/cohorts - List all active & graduated cohorts
  router.get('/cohorts', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const cohorts = await getAllCohortsWithHistory(db);
      const ALL_SLOTS = ['mercury', 'venus', 'earth', 'mars'];
      const activeSlots = cohorts
        .filter(c => c.status === 'active')
        .map(c => (c.slotCode || c.slot_code || '').toLowerCase());
      const availableSlots = ALL_SLOTS.filter(s => !activeSlots.includes(s));
      res.json({ cohorts, activeSlots, availableSlots });
    } catch (err) {
      res.status(500).json({ message: err.message || 'Failed to list cohorts.' });
    }
  });

  // 2. GET /api/admin/unassigned-students - List unassigned students eligible for enrollment
  router.get('/unassigned-students', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const students = await db.all(
        `SELECT studentId, name, email, department, semester, role, createdAt
         FROM students
         WHERE cohort_id IS NULL AND COALESCE(role, 'student') = 'student'
         ORDER BY studentId ASC`
      );
      res.json({ students: students || [] });
    } catch (err) {
      res.status(500).json({ message: err.message || 'Failed to list unassigned students.' });
    }
  });

  // 3. POST /api/admin/cohorts - Create a new cohort
  router.post('/cohorts', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const { slotCode, displayName, intakeYear, academicYear, currentSemester } = req.body;
      if (!slotCode) {
        return res.status(400).json({ message: 'slotCode is required.' });
      }
      const rawYear = intakeYear || academicYear;
      const parsedYear = rawYear ? Number(rawYear) : new Date().getFullYear();
      const cohort = await createCohort(db, {
        slotCode,
        displayName: displayName || null,
        intakeYear: parsedYear,
        currentSemester: currentSemester ? Number(currentSemester) : 1,
        status: 'active',
        actorId: req.adminStudentId
      });
      res.status(201).json({ success: true, cohort });
    } catch (err) {
      const status = err.status || (err.message.includes('occupied') ? 409 : 400);
      res.status(status).json({ message: err.message });
    }
  });

  // 4. POST /api/admin/cohorts/recycle - Recycle an empty/graduated slot
  router.post('/cohorts/recycle', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const { slotCode, displayName, intakeYear, academicYear, intakeIdentifier } = req.body;
      if (!slotCode) {
        return res.status(400).json({ message: 'slotCode is required.' });
      }
      const rawYear = intakeYear || academicYear;
      const parsedYear = rawYear ? Number(rawYear) : new Date().getFullYear();
      const cohort = await recycleSlot(db, {
        slotCode,
        displayName: displayName || null,
        intakeYear: parsedYear,
        intakeIdentifier: intakeIdentifier || null,
        actorId: req.adminStudentId
      });
      res.status(201).json({ success: true, cohort });
    } catch (err) {
      const status = err.status || (err.message.includes('still using it') ? 409 : 400);
      res.status(status).json({ message: err.message });
    }
  });

  // 5. POST /api/admin/cohorts/:id/promote - Promote cohort semester
  router.post('/cohorts/:id/promote', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const { expectedSemester } = req.body;
      const result = await promoteCohort(db, {
        cohortId: req.params.id,
        actorId: req.adminStudentId,
        expectedSemester: expectedSemester !== undefined ? Number(expectedSemester) : null
      });
      res.json({ success: true, ...result });
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ message: err.message });
    }
  });

  // 6. POST /api/admin/cohorts/:id/graduate - Graduate an active cohort
  router.post('/cohorts/:id/graduate', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const result = await graduateCohort(db, {
        cohortId: req.params.id,
        actorId: req.adminStudentId
      });
      res.json({ success: true, ...result });
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ message: err.message });
    }
  });

  // 7. POST /api/admin/cohorts/:id/assign-student - Assign an unassigned student
  router.post('/cohorts/:id/assign-student', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const { studentId } = req.body;
      if (!studentId) {
        return res.status(400).json({ message: 'studentId is required.' });
      }
      const result = await assignStudentToCohort(db, {
        studentId,
        cohortId: req.params.id,
        actorId: req.adminStudentId
      });
      res.json(result);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ message: err.message });
    }
  });

  // 8. POST /api/admin/cohorts/:id/reassign-student - Transfer an assigned student
  router.post('/cohorts/:id/reassign-student', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const { studentId } = req.body;
      if (!studentId) {
        return res.status(400).json({ message: 'studentId is required.' });
      }
      const result = await reassignStudentCohort(db, {
        studentId,
        newCohortId: req.params.id,
        actorId: req.adminStudentId
      });
      res.json(result);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ message: err.message });
    }
  });

  // 9. POST /api/admin/cohorts/:id/bulk-assign - Bulk assign students
  router.post('/cohorts/:id/bulk-assign', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const { studentIds } = req.body;
      if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ message: 'studentIds array is required.' });
      }
      const results = [];
      for (const sId of studentIds) {
        const r = await assignStudentToCohort(db, {
          studentId: sId,
          cohortId: req.params.id,
          actorId: req.adminStudentId
        });
        results.push(r);
      }
      res.json({ success: true, count: results.length });
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ message: err.message });
    }
  });

  // 10. GET /api/admin/cohorts/:id/history - Full history timeline and audit
  router.get('/cohorts/:id/history', requireLogin, requireStaffRole, async (req, res) => {
    try {
      const history = await getCohortHistory(db, req.params.id);
      res.json({ history });
    } catch (err) {
      const status = err.status || 404;
      res.status(status).json({ message: err.message });
    }
  });

  return router;
}

module.exports = adminCohortsRouter;
module.exports.adminCohortsRouter = adminCohortsRouter;
module.exports.createAdminCohortsRouter = adminCohortsRouter;

