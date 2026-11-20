const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  ROMANS,
  WORKING_DAYS,
  CLASS_TYPES,
  FACULTY_TYPES,
  FIELDS,
  ORDER_BY,
  DEFAULT_TIME_SLOTS,
  semesterNumber,
  validateRoutine,
  validateClassRoutine,
  validateSlot,
  validateRoutineEntry,
  getFullClassRoutine,
} = require('../lib/routine');
const { getAcademicContext } = require('../lib/academic-context');

module.exports = function createRoutineRouter(db, requireLogin, { invalidateCache = () => {} } = {}) {
  const router = express.Router();
  const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  const requireAdmin = handle(async (req, res, next) => {
    const role = (req.user && req.user.role) || (req.session && req.session.role);
    if (role === 'admin') return next();
    const studentId = (req.user && req.user.studentId) || (req.session && req.session.studentId);
    if (!studentId) return res.status(403).json({ error: 'Only admins can manage the routine.' });
    const student = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
    if (!student || student.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage the routine.' });
    next();
  });

  const checkId = (paramName = 'id', label = 'exam') => (req, res, next) => {
    const text = req.params[paramName];
    if (!/^[1-9]\d*$/.test(text) || Number(text) > 2147483647) {
      return res.status(400).json({ error: `Invalid ${label} ID.` });
    }
    req.routineId = Number(text);
    next();
  };

  // ============================================================================
  // PICKER OPTIONS CATALOG (Subjects, Teachers, BS Calendar, Nepali Time Presets)
  // ============================================================================
  let cachedSyllabusCatalog = null;
  function loadSyllabusCatalog() {
    if (cachedSyllabusCatalog) return cachedSyllabusCatalog;
    const subjectsBySemester = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [] };
    let electives = [];
    try {
      const raw = fs.readFileSync(path.join(__dirname, '..', 'syllabus-data.json'), 'utf8');
      const parsed = JSON.parse(raw);
      for (const semBlock of parsed.semesters || []) {
        const semNum = semesterNumber(semBlock.semester);
        if (!semNum) continue;
        subjectsBySemester[semNum] = (semBlock.courses || []).map((c) => ({
          title: String(c.title || '').trim(),
          code: String(c.code || '').trim(),
          nature: String(c.nature || '').trim(),
        })).filter((c) => c.title);
      }
      electives = (parsed.electives || []).map((c) => ({
        title: String(c.title || '').trim(),
        code: String(c.code || 'ELE').trim(),
        nature: String(c.nature || '').trim(),
      })).filter((c) => c.title);
    } catch (_) {}
    cachedSyllabusCatalog = { subjectsBySemester, electives };
    return cachedSyllabusCatalog;
  }

  const BS_MONTHS = [
    { value: '01', name: 'Baisakh', nepali: 'बैशाख' },
    { value: '02', name: 'Jestha', nepali: 'जेठ' },
    { value: '03', name: 'Ashadh', nepali: 'असार' },
    { value: '04', name: 'Shrawan', nepali: 'साउन' },
    { value: '05', name: 'Bhadra', nepali: 'भदौ' },
    { value: '06', name: 'Ashwin', nepali: 'असोज' },
    { value: '07', name: 'Kartik', nepali: 'कार्तिक' },
    { value: '08', name: 'Mangsir', nepali: 'मंसिर' },
    { value: '09', name: 'Poush', nepali: 'पुष' },
    { value: '10', name: 'Magh', nepali: 'माघ' },
    { value: '11', name: 'Falgun', nepali: 'फागुन' },
    { value: '12', name: 'Chaitra', nepali: 'चैत्र' },
  ];
  const DEFAULT_ROOMS = [
    'Room 101', 'Room 102', 'Room 201', 'Room 202', 'Room 204', 'Room 301',
    'Computer Lab 1', 'Computer Lab 2', 'Hardware Lab', 'Seminar Hall', 'Exam Hall A', 'Exam Hall B',
  ];
  const DEFAULT_EXAM_TYPES = [
    'Final Examination', 'Pre-board Examination', 'Midterm Examination', 'Practical Examination', 'Makeup Examination', 'Theory', 'Practical',
  ];
  const DEFAULT_EXAM_TIME_PRESETS = [
    '7:00 AM – 10:00 AM',
    '8:00 AM – 11:00 AM',
    '11:00 AM – 2:00 PM',
    '11:30 AM – 2:30 PM',
    '12:00 PM – 3:00 PM',
    '1:00 PM – 4:00 PM',
    '2:00 PM – 5:00 PM',
  ];
  const DEFAULT_SESSION_PRESETS = [
    '2082 BS (Ashwin–Chaitra)',
    '2083 BS (Baisakh–Bhadra)',
    '2083 BS (Ashwin–Chaitra)',
    '2084 BS (Baisakh–Bhadra)',
    '2084 BS (Ashwin–Chaitra)',
  ];

  router.get('/options', requireLogin, handle(async (req, res) => {
    const { subjectsBySemester, electives } = loadSyllabusCatalog();
    const teacherSet = new Set();
    const roomSet = new Set(DEFAULT_ROOMS);

    try {
      const teacherRows = await db.all(
        "SELECT DISTINCT name FROM students WHERE LOWER(COALESCE(role, '')) IN ('teacher', 'faculty') AND name IS NOT NULL"
      );
      for (const r of teacherRows || []) {
        const n = String(r.name || '').trim();
        if (n) teacherSet.add(n);
      }
    } catch (_) {}

    try {
      const entryFacultyRows = await db.all(
        "SELECT DISTINCT faculty_name FROM class_routine_entries WHERE faculty_name IS NOT NULL AND TRIM(faculty_name) <> ''"
      );
      for (const r of entryFacultyRows || []) {
        const n = String(r.faculty_name || '').trim();
        if (n) teacherSet.add(n);
      }
    } catch (_) {}

    try {
      const roomRows = await db.all(
        "SELECT DISTINCT room FROM routine WHERE room IS NOT NULL AND TRIM(room) <> ''"
      );
      for (const r of roomRows || []) {
        const rm = String(r.room || '').trim();
        if (rm) roomSet.add(rm);
      }
    } catch (_) {}

    res.set('Cache-Control', 'private, max-age=60').json({
      subjectsBySemester,
      electives,
      teachers: Array.from(teacherSet).sort((a, b) => a.localeCompare(b)),
      rooms: Array.from(roomSet),
      examTypes: DEFAULT_EXAM_TYPES,
      classTypes: CLASS_TYPES,
      facultyTypes: [
        { value: 'FT', label: 'Full Time (FT)' },
        { value: 'CC', label: 'Course Contract (CC)' },
        { value: 'MA', label: "Master's Assistantship (MA)" },
      ],
      workingDays: WORKING_DAYS,
      weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      bsMonths: BS_MONTHS,
      bsYears: [2081, 2082, 2083, 2084, 2085],
      examTimePresets: DEFAULT_EXAM_TIME_PRESETS,
      sessionPresets: DEFAULT_SESSION_PRESETS,
      defaultSlots: DEFAULT_TIME_SLOTS,
    });
  }));

  // ============================================================================
  // CLASS ROUTINE ENDPOINTS (Semester-Aware Weekly Academic Timetable)
  // ============================================================================

  // Student / Staff read endpoint for published class routines
  router.get('/class', handle(async (req, res) => {
    const context = await getAcademicContext(db, req);
    if (!context || !context.authenticated) {
      return res.status(401).set('Cache-Control', 'private, no-store').json({
        error: 'Sign in to view your semester class routine.',
        authenticated: false
      });
    }

    const sessionFilter = typeof req.query.academic_session === 'string' && req.query.academic_session.trim()
      ? req.query.academic_session.trim()
      : null;

    if (context.role === 'student' || context.role === 'cr') {
      const studentSem = (context.cohort && context.cohort.currentSemester)
        ? Number(context.cohort.currentSemester)
        : semesterNumber(context.semester);

      if (req.query.semester !== undefined) {
        const requestedSem = semesterNumber(req.query.semester);
        if (!requestedSem || requestedSem !== studentSem) {
          return res.status(403).set('Cache-Control', 'private, no-store').json({
            error: 'You are not authorized to access routines for other semesters.'
          });
        }
      }

      if (!studentSem) {
        return res.set('Cache-Control', 'private, no-store').json({
          routine: null,
          semester: null,
          message: 'Your academic semester is not configured yet.'
        });
      }

      const query = sessionFilter
        ? `SELECT id FROM class_routines WHERE semester = ? AND status = 'published' AND academic_session = ? ORDER BY published_at DESC, id DESC LIMIT 1`
        : `SELECT id FROM class_routines WHERE semester = ? AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT 1`;
      const row = sessionFilter
        ? await db.get(query, studentSem, sessionFilter)
        : await db.get(query, studentSem);

      if (!row) {
        return res.set('Cache-Control', 'private, no-store').json({
          routine: null,
          semester: studentSem,
          message: `No class routine has been published for Semester ${ROMANS[studentSem - 1]} yet.`
        });
      }

      const full = await getFullClassRoutine(db, row.id);
      return res.set('Cache-Control', 'private, no-store').json({
        routine: full,
        semester: studentSem
      });
    }

    // Teachers & Admins can inspect any published semester routine
    if (req.query.semester !== undefined) {
      const targetSem = semesterNumber(req.query.semester);
      if (!targetSem) {
        return res.status(400).json({ error: 'Semester must be between 1 and 8.' });
      }
      const query = sessionFilter
        ? `SELECT id FROM class_routines WHERE semester = ? AND status = 'published' AND academic_session = ? ORDER BY published_at DESC, id DESC LIMIT 1`
        : `SELECT id FROM class_routines WHERE semester = ? AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT 1`;
      const row = sessionFilter
        ? await db.get(query, targetSem, sessionFilter)
        : await db.get(query, targetSem);

      if (!row) {
        return res.set('Cache-Control', 'private, no-store').json({
          routine: null,
          semester: targetSem,
          message: `No class routine has been published for Semester ${ROMANS[targetSem - 1]} yet.`
        });
      }

      const full = await getFullClassRoutine(db, row.id);
      return res.set('Cache-Control', 'private, no-store').json({
        routine: full,
        semester: targetSem
      });
    }

    const listQuery = sessionFilter
      ? `SELECT id FROM class_routines WHERE status = 'published' AND academic_session = ? ORDER BY semester ASC, id DESC`
      : `SELECT id FROM class_routines WHERE status = 'published' ORDER BY semester ASC, id DESC`;
    const rows = sessionFilter ? await db.all(listQuery, sessionFilter) : await db.all(listQuery);
    const routines = [];
    for (const r of rows) {
      const full = await getFullClassRoutine(db, r.id);
      if (full) routines.push(full);
    }
    return res.set('Cache-Control', 'private, no-store').json({ routines });
  }));

  // Admin: list all class routines (draft, published, archived)
  router.get('/class/admin', requireLogin, requireAdmin, handle(async (req, res) => {
    const conditions = [];
    const params = [];

    if (req.query.semester !== undefined && req.query.semester !== 'all' && req.query.semester !== '') {
      const sem = semesterNumber(req.query.semester);
      if (!sem) return res.status(400).json({ error: 'Semester must be between 1 and 8.' });
      conditions.push('r.semester = ?');
      params.push(sem);
    }
    if (req.query.status && req.query.status !== 'all') {
      conditions.push('r.status = ?');
      params.push(String(req.query.status));
    }
    if (req.query.academic_session && req.query.academic_session !== 'all') {
      conditions.push('r.academic_session = ?');
      params.push(String(req.query.academic_session));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.all(
      `SELECT r.*,
              (SELECT COUNT(*) FROM class_routine_entries e WHERE e.routine_id = r.id) AS entry_count,
              (SELECT COUNT(*) FROM class_routine_slots s WHERE s.routine_id = r.id) AS slot_count
       FROM class_routines r
       ${where}
       ORDER BY CASE r.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, r.semester ASC, r.created_at DESC`,
      ...params
    );
    res.set('Cache-Control', 'private, no-store').json({ routines: rows });
  }));

  // Admin: get single full class routine
  router.get('/class/admin/:id', requireLogin, requireAdmin, checkId('id', 'routine'), handle(async (req, res) => {
    const full = await getFullClassRoutine(db, req.routineId);
    if (!full) return res.status(404).json({ error: 'Class routine not found.' });
    res.set('Cache-Control', 'private, no-store').json({ routine: full });
  }));

  // Admin: create a new class routine
  router.post('/class/admin', requireLogin, requireAdmin, handle(async (req, res) => {
    const { value, error } = validateClassRoutine(req.body);
    if (error) return res.status(400).json({ error });

    const existing = await db.get(
      'SELECT id FROM class_routines WHERE academic_session = ? AND year = ? AND semester = ?',
      value.academic_session, value.year, value.semester
    );
    if (existing) {
      return res.status(409).json({
        error: `A routine already exists for ${value.academic_session}, Year ${value.year} / Semester ${ROMANS[value.semester - 1]}.`
      });
    }

    const rawSlots = Array.isArray(req.body.slots) && req.body.slots.length ? req.body.slots : DEFAULT_TIME_SLOTS;
    const validatedSlots = [];
    for (let i = 0; i < rawSlots.length; i++) {
      const s = validateSlot(rawSlots[i], i);
      if (s.error) return res.status(400).json({ error: s.error });
      validatedSlots.push(s.value);
    }

    const now = new Date().toISOString();
    const actorId = (req.user && req.user.studentId) || (req.session && req.session.studentId) || null;
    const publishedAt = value.status === 'published' ? now : null;

    let routineId;
    if (db.isPostgres) {
      const row = await db.get(
        `INSERT INTO class_routines (university, program, academic_session, year, semester, effective_date, status, created_by, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        value.university, value.program, value.academic_session, value.year, value.semester,
        value.effective_date, value.status, actorId, publishedAt, now, now
      );
      routineId = row.id;
    } else {
      const result = await db.run(
        `INSERT INTO class_routines (university, program, academic_session, year, semester, effective_date, status, created_by, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        value.university, value.program, value.academic_session, value.year, value.semester,
        value.effective_date, value.status, actorId, publishedAt, now, now
      );
      routineId = Number(result.lastInsertRowid);
    }

    for (const slot of validatedSlots) {
      const isBreakVal = db.isPostgres ? slot.is_break : (slot.is_break ? 1 : 0);
      await db.run(
        `INSERT INTO class_routine_slots (routine_id, slot_order, start_time, end_time, duration_minutes, label, is_break)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        routineId, slot.slot_order, slot.start_time, slot.end_time, slot.duration_minutes, slot.label, isBreakVal
      );
    }

    const full = await getFullClassRoutine(db, routineId);
    invalidateCache();
    res.status(201).json({ routine: full });
  }));

  // Admin: update routine metadata
  router.put('/class/admin/:id', requireLogin, requireAdmin, checkId('id', 'routine'), handle(async (req, res) => {
    const existing = await db.get('SELECT * FROM class_routines WHERE id = ?', req.routineId);
    if (!existing) return res.status(404).json({ error: 'Class routine not found.' });

    const { value, error } = validateClassRoutine({ ...existing, ...req.body });
    if (error) return res.status(400).json({ error });

    const conflict = await db.get(
      'SELECT id FROM class_routines WHERE academic_session = ? AND year = ? AND semester = ? AND id <> ?',
      value.academic_session, value.year, value.semester, req.routineId
    );
    if (conflict) {
      return res.status(409).json({
        error: `Another routine already exists for ${value.academic_session}, Year ${value.year} / Semester ${ROMANS[value.semester - 1]}.`
      });
    }

    const now = new Date().toISOString();
    await db.run(
      `UPDATE class_routines
       SET university = ?, program = ?, academic_session = ?, year = ?, semester = ?, effective_date = ?, updated_at = ?
       WHERE id = ?`,
      value.university, value.program, value.academic_session, value.year, value.semester, value.effective_date, now, req.routineId
    );

    const full = await getFullClassRoutine(db, req.routineId);
    invalidateCache();
    res.json({ routine: full });
  }));

  // Admin: configure time slots
  router.put('/class/admin/:id/slots', requireLogin, requireAdmin, checkId('id', 'routine'), handle(async (req, res) => {
    const existing = await db.get('SELECT * FROM class_routines WHERE id = ?', req.routineId);
    if (!existing) return res.status(404).json({ error: 'Class routine not found.' });

    const rawSlots = Array.isArray(req.body?.slots) ? req.body.slots : null;
    if (!rawSlots || rawSlots.length === 0) {
      return res.status(400).json({ error: 'Provide at least one time slot.' });
    }

    const validated = [];
    const seenOrders = new Set();
    for (let i = 0; i < rawSlots.length; i++) {
      const s = validateSlot(rawSlots[i], i);
      if (s.error) return res.status(400).json({ error: s.error });
      if (seenOrders.has(s.value.slot_order)) {
        return res.status(400).json({ error: `Duplicate slot_order ${s.value.slot_order}.` });
      }
      seenOrders.add(s.value.slot_order);
      validated.push(s.value);
    }

    const existingSlots = await db.all('SELECT * FROM class_routine_slots WHERE routine_id = ?', req.routineId);
    const byId = new Map(existingSlots.map(s => [Number(s.id), s]));
    const keepIds = new Set();

    for (const slot of validated) {
      const isBreakVal = db.isPostgres ? slot.is_break : (slot.is_break ? 1 : 0);
      const rawId = rawSlots.find(r => Number(r.slot_order ?? -1) === slot.slot_order)?.id;
      if (rawId && byId.has(Number(rawId))) {
        await db.run(
          `UPDATE class_routine_slots SET slot_order = ?, start_time = ?, end_time = ?, duration_minutes = ?, label = ?, is_break = ? WHERE id = ? AND routine_id = ?`,
          slot.slot_order, slot.start_time, slot.end_time, slot.duration_minutes, slot.label, isBreakVal, Number(rawId), req.routineId
        );
        keepIds.add(Number(rawId));
      } else {
        if (db.isPostgres) {
          const row = await db.get(
            `INSERT INTO class_routine_slots (routine_id, slot_order, start_time, end_time, duration_minutes, label, is_break) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
            req.routineId, slot.slot_order, slot.start_time, slot.end_time, slot.duration_minutes, slot.label, isBreakVal
          );
          keepIds.add(Number(row.id));
        } else {
          const r = await db.run(
            `INSERT INTO class_routine_slots (routine_id, slot_order, start_time, end_time, duration_minutes, label, is_break) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            req.routineId, slot.slot_order, slot.start_time, slot.end_time, slot.duration_minutes, slot.label, isBreakVal
          );
          keepIds.add(Number(r.lastInsertRowid));
        }
      }
    }

    for (const s of existingSlots) {
      if (!keepIds.has(Number(s.id))) {
        await db.run('DELETE FROM class_routine_slots WHERE id = ? AND routine_id = ?', s.id, req.routineId);
      }
    }

    const full = await getFullClassRoutine(db, req.routineId);
    invalidateCache();
    res.json({ routine: full });
  }));

  // Admin: batch upsert timetable entries (prevents duplicates via UNIQUE(routine_id, day_of_week, slot_id))
  router.put('/class/admin/:id/entries', requireLogin, requireAdmin, checkId('id', 'routine'), handle(async (req, res) => {
    const existing = await db.get('SELECT * FROM class_routines WHERE id = ?', req.routineId);
    if (!existing) return res.status(404).json({ error: 'Class routine not found.' });

    const rawEntries = Array.isArray(req.body?.entries) ? req.body.entries : null;
    if (!rawEntries) return res.status(400).json({ error: 'Provide an entries array.' });

    const validSlotIds = new Set(
      (await db.all('SELECT id FROM class_routine_slots WHERE routine_id = ?', req.routineId)).map(s => Number(s.id))
    );

    const validated = [];
    const seenKeys = new Set();
    for (const raw of rawEntries) {
      const v = validateRoutineEntry(raw);
      if (v.error) return res.status(400).json({ error: v.error });
      if (!validSlotIds.has(v.value.slot_id)) {
        return res.status(400).json({ error: `Slot ${v.value.slot_id} does not belong to this routine.` });
      }
      const key = `${v.value.day_of_week}:${v.value.slot_id}`;
      if (seenKeys.has(key)) {
        return res.status(400).json({ error: `Duplicate entry for ${v.value.day_of_week} in slot ${v.value.slot_id}.` });
      }
      seenKeys.add(key);
      validated.push(v.value);
    }

    const now = new Date().toISOString();
    for (const entry of validated) {
      const isEmptyVal = db.isPostgres ? entry.is_empty : (entry.is_empty ? 1 : 0);
      const existingEntry = await db.get(
        'SELECT id FROM class_routine_entries WHERE routine_id = ? AND day_of_week = ? AND slot_id = ?',
        req.routineId, entry.day_of_week, entry.slot_id
      );
      if (existingEntry) {
        await db.run(
          `UPDATE class_routine_entries
           SET subject_name = ?, faculty_name = ?, faculty_type = ?, class_type = ?, is_empty = ?, notes = ?, updated_at = ?
           WHERE id = ?`,
          entry.subject_name, entry.faculty_name, entry.faculty_type, entry.class_type, isEmptyVal, entry.notes, now, existingEntry.id
        );
      } else {
        await db.run(
          `INSERT INTO class_routine_entries (routine_id, slot_id, day_of_week, subject_name, faculty_name, faculty_type, class_type, is_empty, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          req.routineId, entry.slot_id, entry.day_of_week, entry.subject_name, entry.faculty_name, entry.faculty_type, entry.class_type, isEmptyVal, entry.notes, now, now
        );
      }
    }

    await db.run('UPDATE class_routines SET updated_at = ? WHERE id = ?', now, req.routineId);
    const full = await getFullClassRoutine(db, req.routineId);
    invalidateCache();
    res.json({ routine: full });
  }));

  // Admin: upsert single timetable entry
  router.post('/class/admin/:id/entry', requireLogin, requireAdmin, checkId('id', 'routine'), handle(async (req, res) => {
    const existing = await db.get('SELECT * FROM class_routines WHERE id = ?', req.routineId);
    if (!existing) return res.status(404).json({ error: 'Class routine not found.' });

    const { value: entry, error } = validateRoutineEntry(req.body);
    if (error) return res.status(400).json({ error });

    const slot = await db.get('SELECT id FROM class_routine_slots WHERE id = ? AND routine_id = ?', entry.slot_id, req.routineId);
    if (!slot) return res.status(400).json({ error: 'Invalid slot_id for this routine.' });

    const now = new Date().toISOString();
    const isEmptyVal = db.isPostgres ? entry.is_empty : (entry.is_empty ? 1 : 0);
    const existingEntry = await db.get(
      'SELECT id FROM class_routine_entries WHERE routine_id = ? AND day_of_week = ? AND slot_id = ?',
      req.routineId, entry.day_of_week, entry.slot_id
    );

    if (existingEntry) {
      await db.run(
        `UPDATE class_routine_entries
         SET subject_name = ?, faculty_name = ?, faculty_type = ?, class_type = ?, is_empty = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        entry.subject_name, entry.faculty_name, entry.faculty_type, entry.class_type, isEmptyVal, entry.notes, now, existingEntry.id
      );
    } else {
      await db.run(
        `INSERT INTO class_routine_entries (routine_id, slot_id, day_of_week, subject_name, faculty_name, faculty_type, class_type, is_empty, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.routineId, entry.slot_id, entry.day_of_week, entry.subject_name, entry.faculty_name, entry.faculty_type, entry.class_type, isEmptyVal, entry.notes, now, now
      );
    }

    const full = await getFullClassRoutine(db, req.routineId);
    invalidateCache();
    res.json({ routine: full });
  }));

  // Admin: delete single entry
  router.delete('/class/admin/:id/entries/:entryId', requireLogin, requireAdmin, checkId('id', 'routine'), handle(async (req, res) => {
    const entryId = Number(req.params.entryId);
    if (!Number.isInteger(entryId) || entryId < 1) return res.status(400).json({ error: 'Invalid entry ID.' });
    const result = await db.run('DELETE FROM class_routine_entries WHERE id = ? AND routine_id = ?', entryId, req.routineId);
    if (!result.changes) return res.status(404).json({ error: 'Timetable entry not found.' });
    const full = await getFullClassRoutine(db, req.routineId);
    invalidateCache();
    res.json({ routine: full });
  }));

  // Admin: publish routine (archives any older published routine for the same semester atomically)
  router.post('/class/admin/:id/publish', requireLogin, requireAdmin, checkId('id', 'routine'), handle(async (req, res) => {
    const runTx = typeof db.withTransaction === 'function' ? db.withTransaction.bind(db) : (fn) => fn(db);
    const result = await runTx(async (tx) => {
      const existing = await tx.get('SELECT * FROM class_routines WHERE id = ?', req.routineId);
      if (!existing) return { notFound: true };

      const now = new Date().toISOString();
      const replaceExisting = req.body?.replaceExisting !== false;

      if (replaceExisting) {
        await tx.run(
          `UPDATE class_routines SET status = 'archived', archived_at = ?, updated_at = ?
           WHERE semester = ? AND status = 'published' AND id <> ?`,
          now, now, existing.semester, req.routineId
        );
      }

      await tx.run(
        `UPDATE class_routines SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`,
        now, now, req.routineId
      );

      const full = await getFullClassRoutine(tx, req.routineId);
      return { full };
    });

    if (result.notFound) return res.status(404).json({ error: 'Class routine not found.' });
    invalidateCache();
    res.json({ routine: result.full });
  }));

  // Admin: unpublish routine (revert to draft)
  router.post('/class/admin/:id/unpublish', requireLogin, requireAdmin, checkId('id', 'routine'), handle(async (req, res) => {
    const existing = await db.get('SELECT * FROM class_routines WHERE id = ?', req.routineId);
    if (!existing) return res.status(404).json({ error: 'Class routine not found.' });

    const now = new Date().toISOString();
    await db.run(
      `UPDATE class_routines SET status = 'draft', updated_at = ? WHERE id = ?`,
      now, req.routineId
    );

    const full = await getFullClassRoutine(db, req.routineId);
    invalidateCache();
    res.json({ routine: full });
  }));

  // Admin: archive routine
  router.post('/class/admin/:id/archive', requireLogin, requireAdmin, checkId('id', 'routine'), handle(async (req, res) => {
    const existing = await db.get('SELECT * FROM class_routines WHERE id = ?', req.routineId);
    if (!existing) return res.status(404).json({ error: 'Class routine not found.' });

    const now = new Date().toISOString();
    await db.run(
      `UPDATE class_routines SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`,
      now, now, req.routineId
    );

    const full = await getFullClassRoutine(db, req.routineId);
    invalidateCache();
    res.json({ routine: full });
  }));

  // Admin: replace routine with a new academic session (atomically archives old & clones slots/entries)
  router.post('/class/admin/:id/replace', requireLogin, requireAdmin, checkId('id', 'routine'), handle(async (req, res) => {
    const newSession = typeof req.body?.academic_session === 'string' ? req.body.academic_session.trim() : '';
    if (!newSession) return res.status(400).json({ error: 'New academic_session is required.' });

    const runTx = typeof db.withTransaction === 'function' ? db.withTransaction.bind(db) : (fn) => fn(db);
    const result = await runTx(async (tx) => {
      const oldRoutine = await getFullClassRoutine(tx, req.routineId);
      if (!oldRoutine) return { status: 404, error: 'Source routine not found.' };

      const conflict = await tx.get(
        'SELECT id FROM class_routines WHERE academic_session = ? AND year = ? AND semester = ?',
        newSession, oldRoutine.year, oldRoutine.semester
      );
      if (conflict) {
        return {
          status: 409,
          error: `A routine already exists for ${newSession}, Semester ${ROMANS[oldRoutine.semester - 1]}.`
        };
      }

      const now = new Date().toISOString();
      const actorId = (req.user && req.user.studentId) || (req.session && req.session.studentId) || null;
      const publishImmediately = Boolean(req.body?.publish);
      const archiveOld = req.body?.archiveOld !== false;
      const isPg = Boolean(tx.isPostgres ?? db.isPostgres);

      if (archiveOld) {
        await tx.run(
          `UPDATE class_routines SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`,
          now, now, oldRoutine.id
        );
      }

      if (publishImmediately) {
        await tx.run(
          `UPDATE class_routines SET status = 'archived', archived_at = ?, updated_at = ?
           WHERE semester = ? AND status = 'published' AND id <> ?`,
          now, now, oldRoutine.semester, oldRoutine.id
        );
      }

      let newId;
      const status = publishImmediately ? 'published' : 'draft';
      const publishedAt = publishImmediately ? now : null;
      if (isPg) {
        const row = await tx.get(
          `INSERT INTO class_routines (university, program, academic_session, year, semester, effective_date, status, created_by, published_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          oldRoutine.university, oldRoutine.program, newSession, oldRoutine.year, oldRoutine.semester,
          req.body?.effective_date || null, status, actorId, publishedAt, now, now
        );
        newId = row.id;
      } else {
        const r = await tx.run(
          `INSERT INTO class_routines (university, program, academic_session, year, semester, effective_date, status, created_by, published_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          oldRoutine.university, oldRoutine.program, newSession, oldRoutine.year, oldRoutine.semester,
          req.body?.effective_date || null, status, actorId, publishedAt, now, now
        );
        newId = Number(r.lastInsertRowid);
      }

      const slotMap = new Map();
      for (const s of oldRoutine.slots) {
        const isBreakVal = isPg ? Boolean(s.is_break) : (s.is_break ? 1 : 0);
        let newSlotId;
        if (isPg) {
          const sr = await tx.get(
            `INSERT INTO class_routine_slots (routine_id, slot_order, start_time, end_time, duration_minutes, label, is_break) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
            newId, s.slot_order, s.start_time, s.end_time, s.duration_minutes, s.label, isBreakVal
          );
          newSlotId = sr.id;
        } else {
          const sr = await tx.run(
            `INSERT INTO class_routine_slots (routine_id, slot_order, start_time, end_time, duration_minutes, label, is_break) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            newId, s.slot_order, s.start_time, s.end_time, s.duration_minutes, s.label, isBreakVal
          );
          newSlotId = Number(sr.lastInsertRowid);
        }
        slotMap.set(Number(s.id), newSlotId);
      }

      if (req.body?.copyEntries !== false) {
        for (const e of oldRoutine.entries) {
          const targetSlotId = slotMap.get(Number(e.slot_id));
          if (!targetSlotId) continue;
          const isEmptyVal = isPg ? Boolean(e.is_empty) : (e.is_empty ? 1 : 0);
          await tx.run(
            `INSERT INTO class_routine_entries (routine_id, slot_id, day_of_week, subject_name, faculty_name, faculty_type, class_type, is_empty, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            newId, targetSlotId, e.day_of_week, e.subject_name, e.faculty_name, e.faculty_type, e.class_type, isEmptyVal, e.notes, now, now
          );
        }
      }

      const full = await getFullClassRoutine(tx, newId);
      return { status: 201, full };
    });

    if (result.error) return res.status(result.status).json({ error: result.error });
    invalidateCache();
    res.status(201).json({ routine: result.full });
  }));

  // Admin: delete class routine
  router.delete('/class/admin/:id', requireLogin, requireAdmin, checkId('id', 'routine'), handle(async (req, res) => {
    const result = await db.run('DELETE FROM class_routines WHERE id = ?', req.routineId);
    if (!result.changes) return res.status(404).json({ error: 'Class routine not found.' });
    invalidateCache();
    res.json({ success: true });
  }));

  // ============================================================================
  // EXISTING EXAM ROUTINE ENDPOINTS (Preserved for backward compatibility)
  // ============================================================================

  const list = handle(async (req, res) => {
    const context = await getAcademicContext(db, req);
    let targetSemester = null;

    if (context && (context.canViewAllCohorts || context.role === 'teacher' || context.role === 'admin')) {
      targetSemester = req.query.semester === undefined ? null : semesterNumber(req.query.semester);
      if (req.query.semester !== undefined && !targetSemester) {
        return res.status(400).json({ error: 'Semester must be between 1 and 8.' });
      }
    } else if (context && context.authenticated && (context.role === 'student' || context.role === 'cr')) {
      const semNum = (context.cohort && context.cohort.currentSemester)
        ? Number(context.cohort.currentSemester)
        : semesterNumber(context.semester);
      if (!semNum) {
        return res.set('Cache-Control', 'no-store').json([]);
      }
      targetSemester = semNum;
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
    res.set('Cache-Control', 'private, no-store').json(rows);
  });

  router.get('/', list);
  router.get('/admin', requireLogin, requireAdmin, list);
  router.post('/', requireLogin, requireAdmin, handle(async (req, res) => {
    const { value, error } = validateRoutine(req.body);
    if (error) return res.status(400).json({ error });
    const result = await db.run(`INSERT INTO routine (${FIELDS.join(', ')}) VALUES (${FIELDS.map(() => '?').join(', ')})`, ...FIELDS.map(field => value[field]));
    const row = await db.get('SELECT * FROM routine WHERE id = ?', result.lastInsertRowid);
    invalidateCache();
    try {
      const knowledgeSync = require('../lib/knowledge-sync');
      if (typeof knowledgeSync.onRoutineSaved === 'function' && row) {
        await knowledgeSync.onRoutineSaved(db, row);
      }
    } catch (_) {}
    notifyRoutineUpdate(db, value.semester, value.subject_name, value.exam_date).catch(() => {});
    res.status(201).json(row);
  }));
  router.put('/:id', requireLogin, requireAdmin, checkId('id', 'exam'), handle(async (req, res) => {
    const { value, error } = validateRoutine(req.body);
    if (error) return res.status(400).json({ error });
    const result = await db.run(`UPDATE routine SET ${FIELDS.map(field => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...FIELDS.map(field => value[field]), new Date().toISOString(), req.routineId);
    if (!result.changes) return res.status(404).json({ error: 'This exam no longer exists. Refresh the list.' });
    const updatedRow = await db.get('SELECT * FROM routine WHERE id = ?', req.routineId);
    invalidateCache();
    try {
      const knowledgeSync = require('../lib/knowledge-sync');
      if (typeof knowledgeSync.onRoutineSaved === 'function' && updatedRow) {
        await knowledgeSync.onRoutineSaved(db, updatedRow);
      }
    } catch (_) {}
    notifyRoutineUpdate(db, value.semester, value.subject_name, value.exam_date).catch(() => {});
    res.json(updatedRow);
  }));
  router.delete('/:id', requireLogin, requireAdmin, checkId('id', 'exam'), handle(async (req, res) => {
    const result = await db.run('DELETE FROM routine WHERE id = ?', req.routineId);
    if (!result.changes) return res.status(404).json({ error: 'This exam no longer exists. Refresh the list.' });
    invalidateCache();
    try {
      const knowledgeSync = require('../lib/knowledge-sync');
      if (typeof knowledgeSync.onRoutineDeleted === 'function') {
        await knowledgeSync.onRoutineDeleted(db, req.routineId);
      }
    } catch (_) {}
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
