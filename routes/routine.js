const express = require('express');
const { FIELDS, ORDER_BY, semesterNumber, validateRoutine } = require('../lib/routine');
const { getAcademicContext } = require('../lib/academic-context');

module.exports = function createRoutineRouter(db, requireLogin, { invalidateCache = () => {} } = {}) {
  const router = express.Router();
  const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const requireAdmin = handle(async (req, res, next) => {
    const role = (req.user && req.user.role) || (req.session && req.session.role);
    if (role === 'admin') return next();
    const studentId = (req.user && req.user.studentId) || (req.session && req.session.studentId);
    const student = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
    if (!student || student.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage the routine.' });
    next();
  });
  const checkId = (req, res, next) => {
    const text = req.params.id;
    if (!/^[1-9]\d*$/.test(text) || Number(text) > 2147483647) return res.status(400).json({ error: 'Invalid exam ID.' });
    req.routineId = Number(text);
    next();
  };
  const list = handle(async (req, res) => {
    const context = await getAcademicContext(db, req);
    let targetSemester = null;

    if (context && (context.canViewAllCohorts || context.role === 'teacher' || context.role === 'admin')) {
      targetSemester = req.query.semester === undefined ? null : semesterNumber(req.query.semester);
      if (req.query.semester !== undefined && !targetSemester) {
        return res.status(400).json({ error: 'Semester must be between 1 and 8.' });
      }
    } else if (context && context.authenticated && (context.role === 'student' || context.role === 'cr')) {
      if (!context.cohort || !context.cohort.currentSemester || context.academicStatus === 'unassigned') {
        return res.set('Cache-Control', 'no-store').json([]);
      }
      targetSemester = Number(context.cohort.currentSemester);
    } else {
      targetSemester = req.query.semester === undefined ? null : semesterNumber(req.query.semester);
      if (req.query.semester !== undefined && !targetSemester) {
        return res.status(400).json({ error: 'Semester must be between 1 and 8.' });
      }
    }

    const rows = await db.all(
      `SELECT * FROM routine ${targetSemester ? 'WHERE semester = ?' : ''} ORDER BY ${ORDER_BY}`,
      ...(targetSemester ? [targetSemester] : [])
    );
    res.set('Cache-Control', 'no-store').json(rows);
  });

  router.get('/', list);
  router.get('/admin', requireLogin, requireAdmin, list);
  router.post('/', requireLogin, requireAdmin, handle(async (req, res) => {
    const { value, error } = validateRoutine(req.body);
    if (error) return res.status(400).json({ error });
    const result = await db.run(`INSERT INTO routine (${FIELDS.join(', ')}) VALUES (${FIELDS.map(() => '?').join(', ')})`, ...FIELDS.map(field => value[field]));
    const row = await db.get('SELECT * FROM routine WHERE id = ?', result.lastInsertRowid);
    invalidateCache();
    notifyRoutineUpdate(db, value.semester, value.subject_name, value.exam_date).catch(() => {});
    res.status(201).json(row);
  }));
  router.put('/:id', requireLogin, requireAdmin, checkId, handle(async (req, res) => {
    const { value, error } = validateRoutine(req.body);
    if (error) return res.status(400).json({ error });
    const result = await db.run(`UPDATE routine SET ${FIELDS.map(field => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...FIELDS.map(field => value[field]), new Date().toISOString(), req.routineId);
    if (!result.changes) return res.status(404).json({ error: 'This exam no longer exists. Refresh the list.' });
    invalidateCache();
    notifyRoutineUpdate(db, value.semester, value.subject_name, value.exam_date).catch(() => {});
    res.json(await db.get('SELECT * FROM routine WHERE id = ?', req.routineId));
  }));
  router.delete('/:id', requireLogin, requireAdmin, checkId, handle(async (req, res) => {
    const result = await db.run('DELETE FROM routine WHERE id = ?', req.routineId);
    if (!result.changes) return res.status(404).json({ error: 'This exam no longer exists. Refresh the list.' });
    invalidateCache();
    res.json({ success: true });
  }));
  async function notifyRoutineUpdate(db, semester, subjectName, examDate) {
    try {
      const notifService = require('../lib/notifications-service');
      const targetSem = `Semester ${semester}`;
      let students = [];
      try {
        students = await db.all(
          `SELECT studentId FROM students
           WHERE cohort_id IN (SELECT id FROM cohorts WHERE current_semester = ? AND status = 'active')
              OR semester = ? OR semester = ?`,
          Number(semester),
          targetSem,
          String(semester)
        );
      } catch {
        students = await db.all('SELECT studentId FROM students LIMIT 100').catch(() => []);
      }
      if (!students || students.length === 0) return;
      const recipientIds = students.map((s) => s.studentId);
      await notifService.createNotification(db, {
        type: 'routine_updated',
        title: `Semester ${semester} Routine Updated`,
        body: `Schedule posted for ${subjectName} on ${examDate}.`,
        entityType: 'routine',
        entityId: String(semester),
        deepLink: '/routine',
        webPath: 'routine.html',
        groupKey: `routine:${semester}`,
        priority: 'high',
        recipientUserIds: recipientIds,
        metadata: { semester, subjectName, examDate },
      });
    } catch (err) {}
  }

  router.use((err, req, res, next) => {
    console.error('[Routine API]', err.code || err.name);
    res.status(500).json({ error: 'Could not load or save the routine. Please try again.' });
  });

  return router;
};
