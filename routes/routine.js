const express = require('express');
const { FIELDS, ORDER_BY, semesterNumber, validateRoutine } = require('../lib/routine');

module.exports = function createRoutineRouter(db, requireLogin, { invalidateCache = () => {} } = {}) {
  const router = express.Router();
  const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const requireAdmin = handle(async (req, res, next) => {
    const student = await db.get('SELECT role FROM students WHERE studentId = ?', req.session.studentId);
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
    const semester = req.query.semester === undefined ? null : semesterNumber(req.query.semester);
    if (req.query.semester !== undefined && !semester) return res.status(400).json({ error: 'Semester must be between 1 and 8.' });
    const rows = await db.all(`SELECT * FROM routine ${semester ? 'WHERE semester = ?' : ''} ORDER BY ${ORDER_BY}`, ...(semester ? [semester] : []));
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
    res.status(201).json(row);
  }));
  router.put('/:id', requireLogin, requireAdmin, checkId, handle(async (req, res) => {
    const { value, error } = validateRoutine(req.body);
    if (error) return res.status(400).json({ error });
    const result = await db.run(`UPDATE routine SET ${FIELDS.map(field => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...FIELDS.map(field => value[field]), new Date().toISOString(), req.routineId);
    if (!result.changes) return res.status(404).json({ error: 'This exam no longer exists. Refresh the list.' });
    invalidateCache();
    res.json(await db.get('SELECT * FROM routine WHERE id = ?', req.routineId));
  }));
  router.delete('/:id', requireLogin, requireAdmin, checkId, handle(async (req, res) => {
    const result = await db.run('DELETE FROM routine WHERE id = ?', req.routineId);
    if (!result.changes) return res.status(404).json({ error: 'This exam no longer exists. Refresh the list.' });
    invalidateCache();
    res.json({ success: true });
  }));
  router.use((err, req, res, next) => {
    console.error('[Routine API]', err.code || err.name);
    res.status(500).json({ error: 'Could not load or save the routine. Please try again.' });
  });
  return router;
};
