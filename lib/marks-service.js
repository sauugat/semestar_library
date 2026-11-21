'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getAcademicContext, parseSemesterNumber } = require('./academic-context');
const { getTeacherSubjects, validateTeacherSubjectAuthorization } = require('./teacher-service');
const { sanitizeAuditData } = require('./audit-service');
const { formatNepalDate, adToBs } = require('./nepali-dates');

const VALID_EXAM_TYPES = [
  'Mid-Term Exam',
  'Pre-Board Exam',
  'Final Exam'
];

const EXAM_TYPE_MAP = new Map([
  ['mid-term exam', 'Mid-Term Exam'],
  ['mid-term', 'Mid-Term Exam'],
  ['mid_term', 'Mid-Term Exam'],
  ['midterm', 'Mid-Term Exam'],
  ['midterm exam', 'Mid-Term Exam'],
  ['pre-board exam', 'Pre-Board Exam'],
  ['pre-board', 'Pre-Board Exam'],
  ['pre_board', 'Pre-Board Exam'],
  ['preboard', 'Pre-Board Exam'],
  ['preboard exam', 'Pre-Board Exam'],
  ['final exam', 'Final Exam'],
  ['final', 'Final Exam']
]);

const initializedDbInstances = new WeakMap();

function createHttpError(status, message, code = null) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  if (code) err.code = code;
  return err;
}

function isMissingTableError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return (
    code === '42P01' ||
    /relation ["']?(?:public\.)?(?:exam_configurations|student_marks|marks_audit_logs)["']? does not exist/i.test(msg) ||
    /no such table:\s*(?:exam_configurations|student_marks|marks_audit_logs)/i.test(msg)
  );
}

/**
 * Normalizes and validates an exam type string into one of the three canonical labels:
 * - "Mid-Term Exam"
 * - "Pre-Board Exam"
 * - "Final Exam"
 */
function normalizeExamType(examTypeInput, { required = true } = {}) {
  if (examTypeInput === null || examTypeInput === undefined || String(examTypeInput).trim() === '') {
    if (!required) return null;
    throw createHttpError(
      400,
      `examType is required. Allowed values: ${VALID_EXAM_TYPES.join(', ')}.`,
      'MISSING_EXAM_TYPE'
    );
  }

  if (typeof examTypeInput !== 'string') {
    throw createHttpError(
      400,
      `Invalid examType. Allowed values: ${VALID_EXAM_TYPES.join(', ')}.`,
      'INVALID_EXAM_TYPE'
    );
  }

  const key = examTypeInput.trim().toLowerCase();
  const canonical = EXAM_TYPE_MAP.get(key);
  if (!canonical) {
    throw createHttpError(
      400,
      `Invalid examType "${examTypeInput}". Allowed values: ${VALID_EXAM_TYPES.join(', ')}.`,
      'INVALID_EXAM_TYPE'
    );
  }

  return canonical;
}

/**
 * Validates and normalizes maximum marks (> 0, finite number).
 */
function validateMaxMarks(maxMarksInput) {
  if (
    maxMarksInput === null ||
    maxMarksInput === undefined ||
    maxMarksInput === '' ||
    typeof maxMarksInput === 'boolean' ||
    typeof maxMarksInput === 'object'
  ) {
    throw createHttpError(
      400,
      'Maximum marks (maxMarks) is required and must be a number greater than zero.',
      'INVALID_MAX_MARKS'
    );
  }

  const rawStr = String(maxMarksInput).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(rawStr)) {
    throw createHttpError(
      400,
      `Invalid maximum marks "${maxMarksInput}". Must be a valid positive number.`,
      'INVALID_MAX_MARKS'
    );
  }

  const num = Number(rawStr);
  if (!Number.isFinite(num) || num <= 0) {
    throw createHttpError(
      400,
      'Maximum marks must be greater than zero.',
      'INVALID_MAX_MARKS'
    );
  }

  if (num > 10000) {
    throw createHttpError(
      400,
      'Maximum marks cannot exceed 10,000.',
      'INVALID_MAX_MARKS'
    );
  }

  return Math.round(num * 100) / 100;
}

/**
 * Validates obtained marks against configured maximum marks.
 * Returns null if marks are missing (null, undefined, or empty string '').
 */
function validateObtainedMarks(obtainedInput, maxMarks, studentIdForError = '') {
  const studentContext = studentIdForError ? ` for student "${studentIdForError}"` : '';

  if (obtainedInput === null || obtainedInput === undefined || obtainedInput === '') {
    return null;
  }

  if (typeof obtainedInput === 'boolean' || typeof obtainedInput === 'object') {
    throw createHttpError(
      400,
      `Invalid obtained marks${studentContext}. Marks must be a valid number.`,
      'INVALID_MARKS'
    );
  }

  const rawStr = String(obtainedInput).trim();
  if (rawStr === '') {
    return null;
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(rawStr)) {
    throw createHttpError(
      400,
      `Malformed obtained marks "${obtainedInput}"${studentContext}. Must be a numeric value.`,
      'INVALID_MARKS'
    );
  }

  const num = Number(rawStr);
  if (!Number.isFinite(num)) {
    throw createHttpError(
      400,
      `Invalid obtained marks${studentContext}.`,
      'INVALID_MARKS'
    );
  }

  if (num < 0) {
    throw createHttpError(
      400,
      `Obtained marks cannot be negative (${num})${studentContext}.`,
      'NEGATIVE_MARKS'
    );
  }

  if (maxMarks !== null && maxMarks !== undefined && num > Number(maxMarks)) {
    throw createHttpError(
      400,
      `Obtained marks (${num}) cannot exceed configured maximum marks (${maxMarks})${studentContext}.`,
      'MARKS_EXCEED_MAXIMUM'
    );
  }

  return Math.round(num * 100) / 100;
}

/**
 * Calculates exam percentage strictly as:
 * Percentage = (Obtained Marks / Maximum Marks) * 100
 * Returns null if obtainedMarks is null/undefined or maxMarks <= 0.
 */
function calculateExamPercentage(obtainedMarks, maxMarks) {
  if (obtainedMarks === null || obtainedMarks === undefined || obtainedMarks === '') {
    return null;
  }
  const obtained = Number(obtainedMarks);
  const max = Number(maxMarks);
  if (!Number.isFinite(obtained) || !Number.isFinite(max) || max <= 0) {
    return null;
  }
  const rawPct = (obtained / max) * 100;
  return Math.round(rawPct * 100) / 100;
}

function formatPercentageDisplay(percentage) {
  if (percentage === null || percentage === undefined || !Number.isFinite(Number(percentage))) {
    return null;
  }
  const num = Number(percentage);
  return Number.isInteger(num) ? `${num}%` : `${num.toFixed(2).replace(/\.?0+$/, '')}%`;
}

/**
 * Idempotently initializes the marks & results schema for both PostgreSQL and SQLite/libSQL.
 * Executes individual DDL statements so pooled/serverless PostgreSQL drivers and SQLite handle them cleanly.
 */
async function ensureMarksSchema(dbOrOpts) {
  const execFn = typeof dbOrOpts?.exec === 'function'
    ? dbOrOpts.exec.bind(dbOrOpts)
    : (typeof dbOrOpts?.run === 'function' ? dbOrOpts.run.bind(dbOrOpts) : null);
  const isPg = Boolean(dbOrOpts?.isPostgres);

  if (!execFn) {
    throw new Error('ensureMarksSchema requires a database adapter with an exec() or run() method.');
  }

  const runDdlWithRetry = async (fn) => {
    let lastErr;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const isConcurrentDdl =
          err &&
          (err.code === '23505' ||
            err.code === '42P07' ||
            err.code === '42701' ||
            err.code === 'XX000' ||
            err.code === 'SQLITE_BUSY' ||
            err.code === 'SQLITE_LOCKED' ||
            /already exists|duplicate column|tuple concurrently updated|database is locked/i.test(err.message || ''));
        if (!isConcurrentDdl || attempt === 5) throw err;
        await new Promise((r) => setTimeout(r, 20 * attempt));
      }
    }
    throw lastErr;
  };

  return await runDdlWithRetry(async () => {
    if (isPg) {
      const pgStatements = [
        `CREATE TABLE IF NOT EXISTS exam_configurations (
          id TEXT PRIMARY KEY,
          subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
          semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
          exam_type TEXT NOT NULL CHECK (exam_type IN ('Mid-Term Exam', 'Pre-Board Exam', 'Final Exam')),
          max_marks NUMERIC(8, 2) NOT NULL CHECK (max_marks > 0),
          created_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          updated_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (subject_id, semester_no, exam_type)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_exam_configurations_subject_sem
          ON exam_configurations (subject_id, semester_no, exam_type)`,
        `CREATE TABLE IF NOT EXISTS student_marks (
          id TEXT PRIMARY KEY,
          student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
          semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
          cohort_id TEXT REFERENCES cohorts(id) ON DELETE SET NULL,
          exam_type TEXT NOT NULL CHECK (exam_type IN ('Mid-Term Exam', 'Pre-Board Exam', 'Final Exam')),
          obtained_marks NUMERIC(8, 2) CHECK (obtained_marks IS NULL OR (obtained_marks >= 0 AND obtained_marks <= max_marks)),
          is_absent BOOLEAN NOT NULL DEFAULT FALSE,
          max_marks NUMERIC(8, 2) NOT NULL CHECK (max_marks > 0),
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
          published_at TIMESTAMPTZ,
          published_by TEXT REFERENCES students(studentId) ON DELETE SET NULL,
          created_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          updated_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (student_id, subject_id, semester_no, exam_type)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_student_marks_subj_sem_exam
          ON student_marks (subject_id, semester_no, exam_type, status)`,
        `CREATE INDEX IF NOT EXISTS idx_student_marks_student_status
          ON student_marks (student_id, status, semester_no)`,
        `CREATE INDEX IF NOT EXISTS idx_student_marks_cohort_subj_exam
          ON student_marks (cohort_id, subject_id, exam_type)`,
        `CREATE TABLE IF NOT EXISTS marks_audit_logs (
          id TEXT PRIMARY KEY,
          subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
          semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
          exam_type TEXT NOT NULL CHECK (exam_type IN ('Mid-Term Exam', 'Pre-Board Exam', 'Final Exam')),
          student_id TEXT REFERENCES students(studentId) ON DELETE SET NULL,
          action TEXT NOT NULL CHECK (action IN ('config_created', 'config_updated', 'draft_saved', 'results_published', 'published_marks_edited')),
          actor_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          actor_role TEXT NOT NULL,
          reason TEXT,
          before_state JSONB,
          after_state JSONB,
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_marks_audit_subj_exam
          ON marks_audit_logs (subject_id, semester_no, exam_type, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_marks_audit_actor
          ON marks_audit_logs (actor_user_id, created_at DESC)`
      ];
      for (const stmt of pgStatements) {
        await execFn(stmt);
      }
    } else {
      await execFn(`
        CREATE TABLE IF NOT EXISTS exam_configurations (
          id TEXT PRIMARY KEY,
          subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
          semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
          exam_type TEXT NOT NULL CHECK (exam_type IN ('Mid-Term Exam', 'Pre-Board Exam', 'Final Exam')),
          max_marks REAL NOT NULL CHECK (max_marks > 0),
          created_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          updated_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (subject_id, semester_no, exam_type)
        );

        CREATE INDEX IF NOT EXISTS idx_exam_configurations_subject_sem
          ON exam_configurations (subject_id, semester_no, exam_type);

        CREATE TABLE IF NOT EXISTS student_marks (
          id TEXT PRIMARY KEY,
          student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
          semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
          cohort_id TEXT REFERENCES cohorts(id) ON DELETE SET NULL,
          exam_type TEXT NOT NULL CHECK (exam_type IN ('Mid-Term Exam', 'Pre-Board Exam', 'Final Exam')),
          obtained_marks REAL CHECK (obtained_marks IS NULL OR (obtained_marks >= 0 AND obtained_marks <= max_marks)),
          is_absent INTEGER NOT NULL DEFAULT 0,
          max_marks REAL NOT NULL CHECK (max_marks > 0),
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
          published_at TEXT,
          published_by TEXT REFERENCES students(studentId) ON DELETE SET NULL,
          created_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          updated_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (student_id, subject_id, semester_no, exam_type)
        );

        CREATE INDEX IF NOT EXISTS idx_student_marks_subj_sem_exam
          ON student_marks (subject_id, semester_no, exam_type, status);

        CREATE INDEX IF NOT EXISTS idx_student_marks_student_status
          ON student_marks (student_id, status, semester_no);

        CREATE INDEX IF NOT EXISTS idx_student_marks_cohort_subj_exam
          ON student_marks (cohort_id, subject_id, exam_type);

        CREATE TABLE IF NOT EXISTS marks_audit_logs (
          id TEXT PRIMARY KEY,
          subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
          semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
          exam_type TEXT NOT NULL CHECK (exam_type IN ('Mid-Term Exam', 'Pre-Board Exam', 'Final Exam')),
          student_id TEXT REFERENCES students(studentId) ON DELETE SET NULL,
          action TEXT NOT NULL CHECK (action IN ('config_created', 'config_updated', 'draft_saved', 'results_published', 'published_marks_edited')),
          actor_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          actor_role TEXT NOT NULL,
          reason TEXT,
          before_state TEXT,
          after_state TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_marks_audit_subj_exam
          ON marks_audit_logs (subject_id, semester_no, exam_type, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_marks_audit_actor
          ON marks_audit_logs (actor_user_id, created_at DESC);
      `);
    }

    try {
      if (isPg) {
        await execFn(`ALTER TABLE student_marks ADD COLUMN IF NOT EXISTS is_absent BOOLEAN NOT NULL DEFAULT FALSE`);
      } else {
        await execFn(`ALTER TABLE student_marks ADD COLUMN is_absent INTEGER NOT NULL DEFAULT 0`);
      }
    } catch (_) {}

    if (dbOrOpts && typeof dbOrOpts === 'object') {
      initializedDbInstances.set(dbOrOpts, Promise.resolve(true));
    }
  });
}

/**
 * Ensures the marks schema is initialized on the given db adapter before running queries,
 * even if the server started via `verifyStartupReady()` fast-check or hot-reload.
 */
async function ensureMarksSchemaReady(db, { force = false } = {}) {
  if (!db || typeof db !== 'object') return;
  const rootDb = db._rawDb || db.rawDb || db;
  if (!force && (initializedDbInstances.has(db) || initializedDbInstances.has(rootDb))) {
    return await (initializedDbInstances.get(db) || initializedDbInstances.get(rootDb));
  }
  const initPromise = ensureMarksSchema(db).catch((err) => {
    initializedDbInstances.delete(db);
    initializedDbInstances.delete(rootDb);
    throw err;
  });
  initializedDbInstances.set(db, initPromise);
  initializedDbInstances.set(rootDb, initPromise);
  return await initPromise;
}

/**
 * Executes an async operation against the marks tables, automatically initializing the schema
 * and retrying once if a missing-table error is encountered.
 */
async function withMarksSchemaGuard(db, fn) {
  await ensureMarksSchemaReady(db);
  try {
    return await fn();
  } catch (err) {
    if (isMissingTableError(err)) {
      await ensureMarksSchemaReady(db, { force: true });
      return await fn();
    }
    throw err;
  }
}

/**
 * Resolves and validates the authenticated user from the database.
 */
async function resolveAuthenticatedActor(db, userId, allowedRoles = null) {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw createHttpError(401, 'Authentication required.', 'UNAUTHENTICATED');
  }

  const actor = await db.get(
    `SELECT studentId, username, name, email, role, department, semester, cohort_id, account_status
     FROM students
     WHERE studentId = ?`,
    userId.trim()
  );

  if (!actor) {
    throw createHttpError(401, 'Authenticated user account not found.', 'USER_NOT_FOUND');
  }

  const accountStatus = actor.accountStatus || actor.account_status || 'active';
  if (accountStatus === 'suspended') {
    throw createHttpError(403, 'Your account has been suspended by an administrator.', 'ACCOUNT_SUSPENDED');
  }

  const rawRole = String(actor.role || 'student').trim().toLowerCase();
  const normalizedRole = rawRole === 'faculty' ? 'teacher' : rawRole;

  if (Array.isArray(allowedRoles) && !allowedRoles.includes(normalizedRole)) {
    throw createHttpError(403, 'Forbidden: You do not have permission to perform this action.', 'FORBIDDEN');
  }

  return {
    studentId: actor.studentId || actor.studentid,
    username: actor.username || null,
    name: actor.name,
    email: actor.email || null,
    role: normalizedRole,
    department: actor.department || 'BIT',
    semester: actor.semester || null,
    cohortId: actor.cohortId || actor.cohort_id || null,
    accountStatus
  };
}

/**
 * Resolves and authorizes a subject for a teacher or administrator.
 * Uses the exact same teacher-subject mapping as getTeacherSubjects + validateTeacherSubjectAuthorization
 * so any subject ID or code (e.g. CIT214, CIT223) assigned to the teacher is consistently resolved.
 */
async function resolveAuthorizedSubject(db, actor, subjectInput, { allowArchivedForRead = false } = {}) {
  if (!subjectInput || !String(subjectInput).trim()) {
    throw createHttpError(400, 'subjectId is required.', 'MISSING_SUBJECT');
  }

  const cleanSubj = String(subjectInput).trim();
  const normInput = cleanSubj.toLowerCase();

  if (actor.role === 'teacher') {
    // Verify teacher profile status if a row exists in teachers
    const teacherProfile = await db.get(
      'SELECT id, user_id, status FROM teachers WHERE user_id = ? OR id = ?',
      actor.studentId,
      actor.studentId
    );
    if (teacherProfile && teacherProfile.status && String(teacherProfile.status).toLowerCase() !== 'active') {
      throw createHttpError(403, 'Teacher account is inactive.', 'UNAUTHORIZED_SUBJECT');
    }

    // Query assigned subjects using the same join pattern as getTeacherSubjects
    const assignedRows = (await db.all(
      `SELECT s.id, s.code, s.name, s.semester, s.department, s.credit_hours AS "creditHours", s.nature, s.active
       FROM teacher_subjects ts
       LEFT JOIN teachers t ON t.id = ts.teacher_id
       JOIN subjects s ON (s.id = ts.subject_id OR LOWER(s.code) = LOWER(ts.subject_id))
       WHERE (ts.teacher_id = ? OR t.user_id = ? OR t.id = ?)`,
      actor.studentId,
      actor.studentId,
      actor.studentId
    )) || [];

    let matched = assignedRows.find(
      (r) =>
        (r.id && String(r.id).trim().toLowerCase() === normInput) ||
        (r.code && String(r.code).trim().toLowerCase() === normInput) ||
        (r.name && String(r.name).trim().toLowerCase() === normInput)
    );

    if (!matched) {
      // Fallback to validateTeacherSubjectAuthorization for canonical title aliases
      try {
        const authSubj = await validateTeacherSubjectAuthorization(db, actor.studentId, cleanSubj);
        const subjRow = await db.get(
          `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature, active
           FROM subjects
           WHERE id = ? OR LOWER(code) = LOWER(?)`,
          authSubj.subjectId,
          authSubj.code || authSubj.subjectId
        );
        matched = subjRow || {
          id: authSubj.subjectId,
          code: authSubj.code,
          name: authSubj.name,
          semester: authSubj.semester,
          department: authSubj.department || 'BIT',
          creditHours: 3.0,
          nature: null,
          active: true
        };
      } catch (authErr) {
        throw createHttpError(
          authErr.status || 403,
          authErr.message || `You are not authorized to manage marks for subject "${cleanSubj}".`,
          'UNAUTHORIZED_SUBJECT'
        );
      }
    }

    const isActive = !(matched.active === false || matched.active === 0 || matched.active === '0');
    if (!allowArchivedForRead && !isActive) {
      throw createHttpError(403, `Subject "${matched.name}" is archived.`, 'SUBJECT_ARCHIVED');
    }

    return {
      id: matched.id,
      code: matched.code || matched.id,
      name: matched.name,
      semester: Number(matched.semester),
      department: matched.department || 'BIT',
      creditHours: Number(matched.creditHours ?? matched.credithours ?? 3.0),
      nature: matched.nature || null
    };
  }

  if (actor.role === 'admin') {
    const subjRow = await db.get(
      `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature, active
       FROM subjects
       WHERE id = ? OR LOWER(code) = LOWER(?) OR LOWER(name) = LOWER(?)`,
      cleanSubj,
      cleanSubj,
      cleanSubj
    );
    if (!subjRow) {
      throw createHttpError(404, `Subject "${cleanSubj}" not found.`, 'SUBJECT_NOT_FOUND');
    }
    const isActive = !(subjRow.active === false || subjRow.active === 0 || subjRow.active === '0');
    if (!allowArchivedForRead && !isActive) {
      throw createHttpError(403, `Subject "${subjRow.name}" is archived.`, 'SUBJECT_ARCHIVED');
    }
    return {
      id: subjRow.id,
      code: subjRow.code,
      name: subjRow.name,
      semester: Number(subjRow.semester),
      department: subjRow.department || 'BIT',
      creditHours: Number(subjRow.creditHours ?? subjRow.credithours ?? 3.0),
      nature: subjRow.nature || null
    };
  }

  throw createHttpError(403, 'Forbidden: Teacher or Administrator access required.', 'FORBIDDEN');
}

function compareStudentsAlphabetically(a, b) {
  const nameA = String((a && (a.name || a.studentName || a.displayName || a.studentId || a.student_id)) || '').trim();
  const nameB = String((b && (b.name || b.studentName || b.displayName || b.studentId || b.student_id)) || '').trim();
  const nameCmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  if (nameCmp !== 0) return nameCmp;
  const idA = String((a && (a.studentId || a.student_id || a.id)) || '').trim();
  const idB = String((b && (b.studentId || b.student_id || b.id)) || '').trim();
  return idA.localeCompare(idB, undefined, { sensitivity: 'base' });
}

function sortStudentsAlphabetically(students) {
  if (!Array.isArray(students)) return [];
  return [...students].sort(compareStudentsAlphabetically);
}

/**
 * Resolves enrolled students for a subject and its semester using existing cohort & semester assignment logic.
 * - If cohortId is explicitly provided, validates that the cohort is active and in subject.semester,
 *   and returns active students/CRs in that cohort.
 * - Otherwise, returns all active students/CRs enrolled in subject.semester either via an active cohort
 *   for that semester OR (when cohort_id is null or no active cohort exists for that semester) via their assigned semester field.
 */
async function queryEnrolledStudentsForSubject(client, { subject, cohortId = null }) {
  const semesterNo = Number(subject.semester);
  let resolvedCohort = null;

  const activeCohortsRaw = (await client.all(
    `SELECT id, slot_code, display_name, current_semester, intake_year, intake_identifier, status
     FROM cohorts
     WHERE status = 'active' AND current_semester = ?
     ORDER BY slot_code ASC`,
    semesterNo
  ).catch(() => [])) || [];

  const activeCohorts = activeCohortsRaw.map((c) => ({
    id: c.id,
    slotCode: String(c.slotCode || c.slot_code || '').toLowerCase(),
    displayName: c.displayName || c.display_name || c.slot_code,
    currentSemester: Number(c.currentSemester || c.current_semester),
    intakeYear: c.intakeYear !== undefined ? c.intakeYear : c.intake_year,
    intakeIdentifier: c.intakeIdentifier || c.intake_identifier || null,
    status: c.status
  }));

  if (cohortId && String(cohortId).trim()) {
    const cleanCohort = String(cohortId).trim();
    const cohortRow = await client.get(
      `SELECT id, slot_code, display_name, current_semester, intake_year, intake_identifier, status
       FROM cohorts
       WHERE id = ? OR (LOWER(slot_code) = LOWER(?) AND status = 'active')`,
      cleanCohort,
      cleanCohort
    );
    if (!cohortRow) {
      throw createHttpError(404, `Cohort "${cleanCohort}" not found.`, 'COHORT_NOT_FOUND');
    }
    if (cohortRow.status !== 'active') {
      throw createHttpError(403, `Cohort "${cohortRow.display_name || cleanCohort}" is not active.`, 'COHORT_NOT_ACTIVE');
    }
    if (Number(cohortRow.current_semester || cohortRow.currentSemester) !== semesterNo) {
      throw createHttpError(
        403,
        `Cohort/semester mismatch: Subject "${subject.code}" belongs to Semester ${semesterNo}, but cohort is in Semester ${cohortRow.current_semester || cohortRow.currentSemester}.`,
        'COHORT_SEMESTER_MISMATCH'
      );
    }
    resolvedCohort = {
      id: cohortRow.id,
      slotCode: String(cohortRow.slotCode || cohortRow.slot_code || '').toLowerCase(),
      displayName: cohortRow.displayName || cohortRow.display_name || cohortRow.slot_code,
      currentSemester: Number(cohortRow.currentSemester || cohortRow.current_semester),
      intakeYear: cohortRow.intakeYear !== undefined ? cohortRow.intakeYear : cohortRow.intake_year,
      intakeIdentifier: cohortRow.intakeIdentifier || cohortRow.intake_identifier || null,
      status: cohortRow.status
    };

    const rows = (await client.all(
      `SELECT studentId, username, name, email, role, department, semester, cohort_id
       FROM students
       WHERE cohort_id = ?
         AND LOWER(COALESCE(role, 'student')) IN ('student', 'cr')
         AND LOWER(COALESCE(account_status, 'active')) = 'active'`,
      resolvedCohort.id
    )) || [];

    const students = sortStudentsAlphabetically(
      rows.map((r) => ({
        studentId: r.studentId || r.studentid,
        rollNumber: r.studentId || r.studentid,
        username: r.username || null,
        name: r.name,
        email: r.email || null,
        role: String(r.role || 'student').toLowerCase(),
        department: r.department || 'BIT',
        semester: `Semester ${semesterNo}`,
        semesterNo,
        cohortId: r.cohortId || r.cohort_id || resolvedCohort.id,
        cohortName: resolvedCohort.displayName
      }))
    );

    return {
      cohort: resolvedCohort,
      cohorts: activeCohorts,
      students
    };
  }

  // When cohortId is not specified, resolve all active students/CRs enrolled in this semester
  if (activeCohorts.length === 1) {
    resolvedCohort = activeCohorts[0];
  }

  let allCandidateRows = [];
  try {
    allCandidateRows = (await client.all(
      `SELECT s.studentId, s.username, s.name, s.email, s.role, s.department, s.semester, s.cohort_id,
              c.id AS joined_cohort_id, c.display_name AS joined_cohort_name,
              c.current_semester AS joined_cohort_semester, c.status AS joined_cohort_status
       FROM students s
       LEFT JOIN cohorts c ON c.id = s.cohort_id
       WHERE LOWER(COALESCE(s.role, 'student')) IN ('student', 'cr')
         AND LOWER(COALESCE(s.account_status, 'active')) = 'active'`
    )) || [];
  } catch (_) {
    allCandidateRows = (await client.all(
      `SELECT studentId, username, name, email, role, department, semester, cohort_id
       FROM students
       WHERE LOWER(COALESCE(role, 'student')) IN ('student', 'cr')
         AND LOWER(COALESCE(account_status, 'active')) = 'active'`
    )) || [];
  }

  const enrolled = [];
  for (const r of allCandidateRows) {
    const joinedCohortId = r.joined_cohort_id || r.joinedCohortId || null;
    if (joinedCohortId) {
      const cStatus = String(r.joined_cohort_status || r.joinedCohortStatus || '').toLowerCase();
      const cSem = Number(r.joined_cohort_semester || r.joinedCohortSemester);
      if (cStatus === 'active' && cSem === semesterNo) {
        enrolled.push({
          studentId: r.studentId || r.studentid,
          rollNumber: r.studentId || r.studentid,
          username: r.username || null,
          name: r.name,
          email: r.email || null,
          role: String(r.role || 'student').toLowerCase(),
          department: r.department || 'BIT',
          semester: `Semester ${semesterNo}`,
          semesterNo,
          cohortId: joinedCohortId,
          cohortName: r.joined_cohort_name || r.joinedCohortName || null
        });
      }
    } else {
      const parsedSem = parseSemesterNumber(r.semester);
      if (parsedSem === semesterNo) {
        enrolled.push({
          studentId: r.studentId || r.studentid,
          rollNumber: r.studentId || r.studentid,
          username: r.username || null,
          name: r.name,
          email: r.email || null,
          role: String(r.role || 'student').toLowerCase(),
          department: r.department || 'BIT',
          semester: `Semester ${semesterNo}`,
          semesterNo,
          cohortId: null,
          cohortName: null
        });
      }
    }
  }

  return {
    cohort: resolvedCohort,
    cohorts: activeCohorts,
    students: sortStudentsAlphabetically(enrolled)
  };
}

/**
 * Writes a durable marks audit log record.
 */
async function writeMarksAuditLog(client, {
  subjectId,
  semesterNo,
  examType,
  studentId = null,
  action,
  actorUserId,
  actorRole,
  reason = null,
  beforeState = null,
  afterState = null,
  metadata = null,
  timestampIso = new Date().toISOString()
}) {
  const id = crypto.randomUUID();
  const cleanBefore = sanitizeAuditData(beforeState);
  const cleanAfter = sanitizeAuditData(afterState);
  const cleanMeta = sanitizeAuditData(metadata);

  const beforeJson = cleanBefore !== null && cleanBefore !== undefined ? JSON.stringify(cleanBefore) : null;
  const afterJson = cleanAfter !== null && cleanAfter !== undefined ? JSON.stringify(cleanAfter) : null;
  const metaJson = cleanMeta !== null && cleanMeta !== undefined ? JSON.stringify(cleanMeta) : null;

  await client.run(
    `INSERT INTO marks_audit_logs (
      id, subject_id, semester_no, exam_type, student_id, action,
      actor_user_id, actor_role, reason, before_state, after_state, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    subjectId,
    Number(semesterNo),
    examType,
    studentId,
    action,
    actorUserId,
    actorRole,
    reason,
    beforeJson,
    afterJson,
    metaJson,
    timestampIso
  );

  return {
    id,
    subjectId,
    semesterNo: Number(semesterNo),
    examType,
    studentId,
    action,
    actorUserId,
    actorRole,
    reason,
    beforeState: cleanBefore,
    afterState: cleanAfter,
    metadata: cleanMeta,
    createdAt: timestampIso
  };
}

function formatExamConfigRow(row, subject, examType) {
  if (!row) {
    return {
      id: null,
      subjectId: subject.id,
      subjectCode: subject.code,
      subjectName: subject.name,
      semesterNo: Number(subject.semester),
      examType,
      maxMarks: null,
      configured: false,
      createdBy: null,
      updatedBy: null,
      createdAt: null,
      updatedAt: null
    };
  }
  return {
    id: row.id,
    subjectId: row.subjectId || row.subject_id || subject.id,
    subjectCode: subject.code,
    subjectName: subject.name,
    semesterNo: Number(row.semesterNo || row.semester_no || subject.semester),
    examType: row.examType || row.exam_type || examType,
    maxMarks: Number(row.maxMarks ?? row.max_marks),
    configured: true,
    createdBy: row.createdBy || row.created_by || null,
    updatedBy: row.updatedBy || row.updated_by || null,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
  };
}

/**
 * 1. Retrieves teacher/admin Marks Entry context: authorized subjects, exam types, and per-subject status overview.
 */
async function getTeacherMarksContext(db, { actorUserId }) {
  return await withMarksSchemaGuard(db, async () => {
    const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);

    const fetchSubjectsPromise = actor.role === 'teacher'
      ? getTeacherSubjects(db, actor.studentId)
      : (async () => {
          const activeCheck = db.isPostgres ? '(active = TRUE OR active IS NULL)' : '(active = 1 OR active IS NULL)';
          const rows = (await db.all(
            `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature
             FROM subjects
             WHERE ${activeCheck}
             ORDER BY semester ASC, code ASC`
          )) || [];
          return rows.map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            title: r.name,
            semester: Number(r.semester),
            department: r.department || 'BIT',
            creditHours: Number(r.creditHours || r.credithours || 3.0),
            nature: r.nature || null
          }));
        })();

    const [subjects, activeCohortsRaw, configRows, markSummaryRows] = await Promise.all([
      fetchSubjectsPromise,
      db.all(
        `SELECT id, slot_code, display_name, current_semester, intake_year, intake_identifier, status
         FROM cohorts
         WHERE status = 'active'
         ORDER BY current_semester ASC, slot_code ASC`
      ).then((r) => r || []).catch(() => []),
      db.all(`SELECT * FROM exam_configurations`).then((r) => r || []).catch(() => []),
      db.all(
        `SELECT subject_id, semester_no, exam_type, status,
                COUNT(*) AS row_count,
                SUM(CASE WHEN obtained_marks IS NOT NULL THEN 1 ELSE 0 END) AS entered_count
         FROM student_marks
         GROUP BY subject_id, semester_no, exam_type, status`
      ).then((r) => r || []).catch(() => [])
    ]);

    const activeCohorts = activeCohortsRaw.map((c) => ({
      id: c.id,
      slotCode: String(c.slotCode || c.slot_code || '').toLowerCase(),
      displayName: c.displayName || c.display_name || c.slot_code,
      currentSemester: Number(c.currentSemester || c.current_semester),
      intakeYear: c.intakeYear !== undefined ? c.intakeYear : c.intake_year,
      intakeIdentifier: c.intakeIdentifier || c.intake_identifier || null,
      status: c.status
    }));

    const configByKey = new Map();
    for (const cfg of configRows) {
      const subjId = cfg.subjectId || cfg.subject_id;
      const semNo = Number(cfg.semesterNo || cfg.semester_no);
      const exType = cfg.examType || cfg.exam_type;
      configByKey.set(`${subjId}:${semNo}:${exType}`, cfg);
    }

    const statsByKey = new Map();
    for (const row of markSummaryRows) {
      const subjId = row.subjectId || row.subject_id;
      const semNo = Number(row.semesterNo || row.semester_no);
      const exType = row.examType || row.exam_type;
      const st = row.status;
      const key = `${subjId}:${semNo}:${exType}`;
      const existing = statsByKey.get(key) || { draftCount: 0, publishedCount: 0, enteredCount: 0 };
      const entered = Number(row.entered_count ?? row.enteredcount ?? 0);
      if (st === 'published') {
        existing.publishedCount += entered;
      } else {
        existing.draftCount += entered;
      }
      existing.enteredCount += entered;
      statsByKey.set(key, existing);
    }

    const enrichedSubjects = subjects.map((sub) => {
      const semNo = Number(sub.semester);
      const matchingCohorts = activeCohorts.filter((c) => Number(c.currentSemester) === semNo);
      const exams = VALID_EXAM_TYPES.map((examType) => {
        const key = `${sub.id}:${semNo}:${examType}`;
        const cfg = configByKey.get(key);
        const st = statsByKey.get(key) || { draftCount: 0, publishedCount: 0, enteredCount: 0 };
        let examStatus = 'not_started';
        if (st.publishedCount > 0 && st.draftCount === 0) {
          examStatus = 'published';
        } else if (st.publishedCount > 0 && st.draftCount > 0) {
          examStatus = 'partially_published';
        } else if (st.draftCount > 0 || cfg) {
          examStatus = 'draft';
        }
        return {
          examType,
          configured: Boolean(cfg),
          maxMarks: cfg ? Number(cfg.maxMarks ?? cfg.max_marks) : null,
          enteredCount: st.enteredCount,
          draftCount: st.draftCount,
          publishedCount: st.publishedCount,
          status: examStatus
        };
      });

      return {
        ...sub,
        semester: semNo,
        cohorts: matchingCohorts,
        exams
      };
    });

    const assignedSemesters = [...new Set(enrichedSubjects.map((s) => Number(s.semester)))].sort((a, b) => a - b);

    return {
      role: actor.role,
      userId: actor.studentId,
      name: actor.name,
      examTypes: VALID_EXAM_TYPES,
      assignedSemesters,
      subjects: enrichedSubjects,
      cohorts: actor.role === 'admin'
        ? activeCohorts
        : activeCohorts.filter((c) => assignedSemesters.includes(Number(c.currentSemester)))
    };
  });
}

/**
 * 2. Retrieves exam configuration(s) for an authorized subject.
 */
async function getExamConfiguration(db, { actorUserId, subjectId, examType = null }) {
  return await withMarksSchemaGuard(db, async () => {
    const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
    const subject = await resolveAuthorizedSubject(db, actor, subjectId, { allowArchivedForRead: true });
    const normalizedExamType = normalizeExamType(examType, { required: false });

    if (normalizedExamType) {
      const row = await db.get(
        `SELECT * FROM exam_configurations
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ?`,
        subject.id,
        subject.semester,
        normalizedExamType
      );
      return {
        subject,
        examType: normalizedExamType,
        config: formatExamConfigRow(row, subject, normalizedExamType)
      };
    }

    const rows = (await db.all(
      `SELECT * FROM exam_configurations
       WHERE subject_id = ? AND semester_no = ?`,
      subject.id,
      subject.semester
    )) || [];

    const rowByExam = new Map(rows.map((r) => [r.examType || r.exam_type, r]));
    const configs = {};
    const configList = VALID_EXAM_TYPES.map((et) => {
      const formatted = formatExamConfigRow(rowByExam.get(et) || null, subject, et);
      configs[et] = formatted;
      return formatted;
    });

    return {
      subject,
      examTypes: VALID_EXAM_TYPES,
      configs,
      configList
    };
  });
}

/**
 * 3. Creates or updates maximum marks configuration for a subject and exam type.
 */
async function upsertExamConfiguration(db, {
  actorUserId,
  subjectId,
  examType,
  maxMarks,
  reason = null
}) {
  return await withMarksSchemaGuard(db, async () => {
    const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
    const subject = await resolveAuthorizedSubject(db, actor, subjectId);
    const normalizedExamType = normalizeExamType(examType, { required: true });
    const validatedMaxMarks = validateMaxMarks(maxMarks);
    const nowIso = new Date().toISOString();

    const runUpsert = async (tx) => {
      const existingConfig = await tx.get(
        `SELECT * FROM exam_configurations
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ?`,
        subject.id,
        subject.semester,
        normalizedExamType
      );

      // Ensure no existing student mark exceeds the new maxMarks
      const highestMarkRow = await tx.get(
        `SELECT MAX(obtained_marks) AS max_obtained
         FROM student_marks
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ? AND obtained_marks IS NOT NULL`,
        subject.id,
        subject.semester,
        normalizedExamType
      );
      const highestObtained = highestMarkRow && (highestMarkRow.max_obtained ?? highestMarkRow.maxObtained);
      if (highestObtained !== null && highestObtained !== undefined && Number(highestObtained) > validatedMaxMarks) {
        throw createHttpError(
          400,
          `Cannot set maximum marks to ${validatedMaxMarks} because one or more students already have recorded marks up to ${Number(highestObtained)}.`,
          'MAX_MARKS_BELOW_EXISTING_OBTAINED'
        );
      }

      let configId = existingConfig ? existingConfig.id : crypto.randomUUID();
      const isCreated = !existingConfig;

      if (existingConfig) {
        await tx.run(
          `UPDATE exam_configurations
           SET max_marks = ?, updated_by = ?, updated_at = ?
           WHERE id = ?`,
          validatedMaxMarks,
          actor.studentId,
          nowIso,
          configId
        );
      } else {
        await tx.run(
          `INSERT INTO exam_configurations (
            id, subject_id, semester_no, exam_type, max_marks, created_by, updated_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          configId,
          subject.id,
          subject.semester,
          normalizedExamType,
          validatedMaxMarks,
          actor.studentId,
          actor.studentId,
          nowIso,
          nowIso
        );
      }

      // Keep max_marks synchronized on any existing student_marks rows for this exam
      await tx.run(
        `UPDATE student_marks
         SET max_marks = ?, updated_by = ?, updated_at = ?
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ?`,
        validatedMaxMarks,
        actor.studentId,
        nowIso,
        subject.id,
        subject.semester,
        normalizedExamType
      );

      await writeMarksAuditLog(tx, {
        subjectId: subject.id,
        semesterNo: subject.semester,
        examType: normalizedExamType,
        action: isCreated ? 'config_created' : 'config_updated',
        actorUserId: actor.studentId,
        actorRole: actor.role,
        reason: reason || (isCreated ? 'Configured exam maximum marks' : 'Updated exam maximum marks'),
        beforeState: existingConfig
          ? { maxMarks: Number(existingConfig.maxMarks ?? existingConfig.max_marks) }
          : null,
        afterState: { maxMarks: validatedMaxMarks },
        timestampIso: nowIso
      });

      const updatedRow = await tx.get('SELECT * FROM exam_configurations WHERE id = ?', configId);
      return {
        created: isCreated,
        updated: !isCreated,
        subject,
        examType: normalizedExamType,
        config: formatExamConfigRow(updatedRow, subject, normalizedExamType)
      };
    };

    if (typeof db.withTransaction === 'function') {
      return await db.withTransaction(runUpsert);
    }
    return await runUpsert(db);
  });
}

/**
 * 4. Retrieves the enrolled students and marks register for a selected subject and exam type.
 * Missing exam configuration never prevents the roster from loading.
 */
async function getSubjectMarksRoster(db, {
  actorUserId,
  subjectId,
  examType = null,
  cohortId = null
}) {
  return await withMarksSchemaGuard(db, async () => {
    const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
    const subject = await resolveAuthorizedSubject(db, actor, subjectId, { allowArchivedForRead: true });
    const normalizedExamType = normalizeExamType(examType, { required: false }) || 'Mid-Term Exam';

    const [enrollment, configRows, markRows] = await Promise.all([
      queryEnrolledStudentsForSubject(db, { subject, cohortId }),
      db.all(
        `SELECT * FROM exam_configurations
         WHERE (subject_id = ? OR LOWER(subject_id) = LOWER(?)) AND semester_no = ?`,
        subject.id,
        subject.code || subject.id,
        subject.semester
      ).then((r) => r || []),
      db.all(
        `SELECT * FROM student_marks
         WHERE (subject_id = ? OR LOWER(subject_id) = LOWER(?)) AND semester_no = ? AND exam_type = ?
         ORDER BY student_id ASC`,
        subject.id,
        subject.code || subject.id,
        subject.semester,
        normalizedExamType
      ).then((r) => r || [])
    ]);

    const configByExam = new Map(configRows.map((r) => [r.examType || r.exam_type, r]));
    const configsByExamType = {};
    for (const et of VALID_EXAM_TYPES) {
      configsByExamType[et] = formatExamConfigRow(configByExam.get(et) || null, subject, et);
    }

    const activeConfig = configsByExamType[normalizedExamType];
    const configuredMaxMarks = activeConfig.configured ? activeConfig.maxMarks : null;

    const markByStudentId = new Map();
    for (const row of markRows) {
      const sId = row.studentId || row.student_id;
      markByStudentId.set(sId, row);
    }

    let enteredCount = 0;
    let missingCount = 0;
    let draftCount = 0;
    let publishedCount = 0;
    let sumObtained = 0;
    let sumPct = 0;
    let highestMarks = null;
    let lowestMarks = null;

    const students = enrollment.students.map((stu) => {
      const markRow = markByStudentId.get(stu.studentId) || null;
      const isAbsent = Boolean(markRow && (markRow.isAbsent || markRow.is_absent));
      const rawObtained = markRow ? (markRow.obtainedMarks ?? markRow.obtained_marks) : null;
      const hasMarks = (rawObtained !== null && rawObtained !== undefined && rawObtained !== '') || isAbsent;
      const obtainedMarks = isAbsent ? null : (hasMarks ? Number(rawObtained) : null);
      const effectiveMaxMarks = configuredMaxMarks !== null
        ? configuredMaxMarks
        : (markRow && (markRow.maxMarks ?? markRow.max_marks) ? Number(markRow.maxMarks ?? markRow.max_marks) : null);

      const rowStatus = markRow ? String(markRow.status || 'draft').toLowerCase() : null;
      let entryStatus = 'missing';
      if (isAbsent) {
        entryStatus = 'absent';
        enteredCount += 1;
        if (rowStatus === 'published') publishedCount += 1;
        else draftCount += 1;
      } else if (hasMarks) {
        entryStatus = rowStatus === 'published' ? 'published' : 'draft';
        enteredCount += 1;
        if (entryStatus === 'published') publishedCount += 1;
        else draftCount += 1;

        sumObtained += obtainedMarks;
        if (highestMarks === null || obtainedMarks > highestMarks) highestMarks = obtainedMarks;
        if (lowestMarks === null || obtainedMarks < lowestMarks) lowestMarks = obtainedMarks;
      } else {
        missingCount += 1;
      }

      const percentage = isAbsent
        ? 0
        : (hasMarks && effectiveMaxMarks ? calculateExamPercentage(obtainedMarks, effectiveMaxMarks) : null);

      if (percentage !== null && !isAbsent) {
        sumPct += percentage;
      }

      return {
        studentId: stu.studentId,
        rollNumber: stu.rollNumber || stu.studentId,
        name: stu.name,
        username: stu.username,
        role: stu.role,
        department: stu.department,
        semester: stu.semester,
        semesterNo: stu.semesterNo,
        cohortId: stu.cohortId,
        cohortName: stu.cohortName,
        markId: markRow ? markRow.id : null,
        isAbsent,
        obtainedMarks,
        maxMarks: effectiveMaxMarks,
        percentage,
        formattedPercentage: isAbsent ? 'Absent' : formatPercentageDisplay(percentage),
        status: hasMarks ? (rowStatus === 'published' ? 'published' : 'draft') : null,
        entryStatus,
        isMissing: !hasMarks,
        publishedAt: markRow ? (markRow.publishedAt || markRow.published_at || null) : null,
        publishedBy: markRow ? (markRow.publishedBy || markRow.published_by || null) : null,
        updatedAt: markRow ? (markRow.updatedAt || markRow.updated_at || null) : null,
        updatedBy: markRow ? (markRow.updatedBy || markRow.updated_by || null) : null
      };
    });

    const totalStudents = students.length;
    let publicationStatus = 'not_started';
    if (!activeConfig.configured && enteredCount === 0) {
      publicationStatus = 'unconfigured';
    } else if (publishedCount > 0 && draftCount === 0 && missingCount === 0) {
      publicationStatus = 'published';
    } else if (publishedCount > 0) {
      publicationStatus = 'published';
    } else if (draftCount > 0) {
      publicationStatus = 'draft';
    }

    const summary = {
      totalStudents,
      enteredCount,
      missingCount,
      draftCount,
      publishedCount,
      isConfigured: activeConfig.configured,
      maxMarks: configuredMaxMarks,
      isPublished: publishedCount > 0 && draftCount === 0,
      hasPublishedMarks: publishedCount > 0,
      hasDraftMarks: draftCount > 0,
      publicationStatus,
      averageMarks: enteredCount > 0 ? Math.round((sumObtained / enteredCount) * 100) / 100 : null,
      averagePercentage: enteredCount > 0 ? Math.round((sumPct / enteredCount) * 100) / 100 : null,
      highestMarks,
      lowestMarks
    };

    let teacherName = actor.name || actor.studentId;
    if (actor.role === 'admin') {
      try {
        const assignedTeacherRow = await db.get(
          `SELECT stu.name AS teacher_name
           FROM teacher_subjects ts
           JOIN teachers t ON t.id = ts.teacher_id
           LEFT JOIN students stu ON stu.studentId = t.user_id
           WHERE ts.subject_id = ? AND t.status = 'active'
           ORDER BY ts.created_at ASC
           LIMIT 1`,
          subject.id
        );
        if (assignedTeacherRow && (assignedTeacherRow.teacherName || assignedTeacherRow.teacher_name)) {
          teacherName = assignedTeacherRow.teacherName || assignedTeacherRow.teacher_name;
        }
      } catch (_) {}
    }

    return {
      subject,
      teacherName,
      semesterNo: subject.semester,
      cohort: enrollment.cohort,
      cohorts: enrollment.cohorts,
      examType: normalizedExamType,
      examTypes: VALID_EXAM_TYPES,
      examConfig: activeConfig,
      configsByExamType,
      students,
      roster: students,
      summary
    };
  });
}

/**
 * Validates and normalizes an array of student marks input records.
 */
function parseAndValidateMarksRecordsInput(recordsInput, maxMarks) {
  if (!Array.isArray(recordsInput)) {
    throw createHttpError(400, 'records (or marks) must be an array.', 'INVALID_RECORDS');
  }

  const seenStudentIds = new Set();
  const normalized = [];

  for (let i = 0; i < recordsInput.length; i++) {
    const item = recordsInput[i];
    if (!item || typeof item !== 'object') {
      throw createHttpError(400, `Mark record at index ${i} must be an object.`, 'INVALID_RECORD_ITEM');
    }

    const rawStudentId = item.studentId !== undefined ? item.studentId : (item.student_id !== undefined ? item.student_id : item.rollNumber);
    const studentId = rawStudentId ? String(rawStudentId).trim() : '';
    if (!studentId) {
      throw createHttpError(400, `Mark record at index ${i} is missing studentId.`, 'MISSING_STUDENT_ID');
    }

    if (seenStudentIds.has(studentId)) {
      throw createHttpError(400, `Duplicate studentId "${studentId}" in marks submission.`, 'DUPLICATE_STUDENT_ID');
    }
    seenStudentIds.add(studentId);

    const isAbsent = Boolean(item.isAbsent || item.is_absent || item.absent);
    const rawObtained = item.obtainedMarks !== undefined
      ? item.obtainedMarks
      : (item.obtained_marks !== undefined ? item.obtained_marks : item.marks);

    const obtainedMarks = isAbsent ? null : validateObtainedMarks(rawObtained, maxMarks, studentId);
    normalized.push({
      studentId,
      obtainedMarks,
      isAbsent
    });
  }

  return normalized;
}

/**
 * 5. Saves student marks (as draft or editing existing marks) and optionally publishes them.
 */
async function saveStudentMarks(db, {
  actorUserId,
  subjectId,
  examType,
  maxMarks = undefined,
  records = [],
  cohortId = null,
  publish = false,
  editPublished = false,
  reason = null
}) {
  return await withMarksSchemaGuard(db, async () => {
    const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
    const subject = await resolveAuthorizedSubject(db, actor, subjectId);
    const normalizedExamType = normalizeExamType(examType, { required: true });
    const nowIso = new Date().toISOString();

    const runSave = async (tx) => {
      const isPg = Boolean(tx?.isPostgres ?? db?.isPostgres ?? false);
      // 1. Resolve or update exam configuration for maxMarks
      let configRow = await tx.get(
        `SELECT * FROM exam_configurations
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ?`,
        subject.id,
        subject.semester,
        normalizedExamType
      );

      let effectiveMaxMarks = configRow ? Number(configRow.maxMarks ?? configRow.max_marks) : null;

      if (maxMarks !== undefined && maxMarks !== null && maxMarks !== '') {
        const validatedMax = validateMaxMarks(maxMarks);
        effectiveMaxMarks = validatedMax;

        if (configRow) {
          if (Number(configRow.maxMarks ?? configRow.max_marks) !== validatedMax) {
            await tx.run(
              `UPDATE exam_configurations
               SET max_marks = ?, updated_by = ?, updated_at = ?
               WHERE id = ?`,
              validatedMax,
              actor.studentId,
              nowIso,
              configRow.id
            );
          }
        } else {
          const cfgId = crypto.randomUUID();
          await tx.run(
            `INSERT INTO exam_configurations (
              id, subject_id, semester_no, exam_type, max_marks, created_by, updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            cfgId,
            subject.id,
            subject.semester,
            normalizedExamType,
            validatedMax,
            actor.studentId,
            actor.studentId,
            nowIso,
            nowIso
          );
        }
      }

      if (effectiveMaxMarks === null || !Number.isFinite(effectiveMaxMarks) || effectiveMaxMarks <= 0) {
        throw createHttpError(
          400,
          `Maximum marks have not been configured for ${subject.code} (${normalizedExamType}). Please configure maximum marks greater than zero.`,
          'EXAM_CONFIG_REQUIRED'
        );
      }

      // 2. Validate records against effectiveMaxMarks
      const normalizedRecords = parseAndValidateMarksRecordsInput(records, effectiveMaxMarks);

      // 3. Verify enrolled students for this subject & semester
      const enrollment = await queryEnrolledStudentsForSubject(tx, { subject, cohortId });
      const enrolledMap = new Map(enrollment.students.map((s) => [s.studentId, s]));

      for (const rec of normalizedRecords) {
        if (!enrolledMap.has(rec.studentId)) {
          throw createHttpError(
            403,
            `Student "${rec.studentId}" is not enrolled in ${subject.code} (Semester ${subject.semester}).`,
            'STUDENT_NOT_ENROLLED'
          );
        }
      }

      // Check that no existing marks (for students not in this payload) exceed the new effectiveMaxMarks
      const existingMarkRows = (await tx.all(
        `SELECT * FROM student_marks
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ?`,
        subject.id,
        subject.semester,
        normalizedExamType
      )) || [];

      const existingByStudentId = new Map();
      const beforeState = {};
      for (const row of existingMarkRows) {
        const sId = row.studentId || row.student_id;
        existingByStudentId.set(sId, row);
        beforeState[sId] = {
          obtainedMarks: row.obtainedMarks !== null && row.obtainedMarks !== undefined
            ? Number(row.obtainedMarks)
            : (row.obtained_marks !== null && row.obtained_marks !== undefined ? Number(row.obtained_marks) : null),
          maxMarks: Number(row.maxMarks ?? row.max_marks),
          status: row.status
        };
      }

      const incomingStudentIds = new Set(normalizedRecords.map((r) => r.studentId));
      for (const [sId, existingRow] of existingByStudentId.entries()) {
        if (!incomingStudentIds.has(sId)) {
          const prevObt = existingRow.obtainedMarks ?? existingRow.obtained_marks;
          if (prevObt !== null && prevObt !== undefined && Number(prevObt) > effectiveMaxMarks) {
            throw createHttpError(
              400,
              `Cannot set maximum marks to ${effectiveMaxMarks} because student "${sId}" has existing marks of ${Number(prevObt)}.`,
              'MAX_MARKS_BELOW_EXISTING_OBTAINED'
            );
          }
        }
      }

      // Keep max_marks synced on all existing rows for this exam
      await tx.run(
        `UPDATE student_marks
         SET max_marks = ?, updated_at = ?
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ? AND max_marks != ?`,
        effectiveMaxMarks,
        nowIso,
        subject.id,
        subject.semester,
        normalizedExamType,
        effectiveMaxMarks
      );

      let editedPublishedCount = 0;
      const changedPublishedStudents = {};

      for (const rec of normalizedRecords) {
        const studentMeta = enrolledMap.get(rec.studentId);
        const existingRow = existingByStudentId.get(rec.studentId);

        if (rec.obtainedMarks === null && !rec.isAbsent) {
          // Missing mark: if existing row is draft, delete or clear it so it shows as missing
          if (existingRow) {
            if (existingRow.status === 'published' && !editPublished && !publish) {
              throw createHttpError(
                400,
                `Cannot clear already published marks for student "${rec.studentId}" without an authorized published-result edit.`,
                'PUBLISHED_MARKS_LOCKED'
              );
            }
            await tx.run(`DELETE FROM student_marks WHERE id = ?`, existingRow.id);
            if (existingRow.status === 'published') {
              editedPublishedCount += 1;
              changedPublishedStudents[rec.studentId] = {
                from: Number(existingRow.obtainedMarks ?? existingRow.obtained_marks),
                to: null
              };
            }
          }
          continue;
        }

        if (existingRow) {
          const prevObtained = existingRow.obtainedMarks !== null && existingRow.obtainedMarks !== undefined
            ? Number(existingRow.obtainedMarks)
            : (existingRow.obtained_marks !== null && existingRow.obtained_marks !== undefined ? Number(existingRow.obtained_marks) : null);
          const wasPublished = existingRow.status === 'published';
          const wasAbsent = Boolean(existingRow.isAbsent || existingRow.is_absent);
          const nextStatus = publish ? 'published' : 'draft';
          const nextPublishedAt = nextStatus === 'published'
            ? (existingRow.publishedAt || existingRow.published_at || nowIso)
            : null;
          const nextPublishedBy = nextStatus === 'published'
            ? (existingRow.publishedBy || existingRow.published_by || actor.studentId)
            : null;

          if (wasPublished && (prevObtained !== rec.obtainedMarks || wasAbsent !== rec.isAbsent)) {
            editedPublishedCount += 1;
            changedPublishedStudents[rec.studentId] = {
              from: wasAbsent ? 'Absent' : prevObtained,
              to: rec.isAbsent ? 'Absent' : rec.obtainedMarks
            };
          }

          await tx.run(
            `UPDATE student_marks
             SET obtained_marks = ?,
                 is_absent = ?,
                 max_marks = ?,
                 cohort_id = ?,
                 status = ?,
                 published_at = ?,
                 published_by = ?,
                 updated_by = ?,
                 updated_at = ?
             WHERE id = ?`,
            rec.obtainedMarks,
            rec.isAbsent ? (isPg ? true : 1) : (isPg ? false : 0),
            effectiveMaxMarks,
            studentMeta.cohortId || null,
            nextStatus,
            nextPublishedAt,
            nextPublishedBy,
            actor.studentId,
            nowIso,
            existingRow.id
          );
        } else {
          const markId = crypto.randomUUID();
          const nextStatus = publish ? 'published' : 'draft';
          await tx.run(
            `INSERT INTO student_marks (
              id, student_id, subject_id, semester_no, cohort_id, exam_type,
              obtained_marks, is_absent, max_marks, status, published_at, published_by,
              created_by, updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            markId,
            rec.studentId,
            subject.id,
            subject.semester,
            studentMeta.cohortId || null,
            normalizedExamType,
            rec.obtainedMarks,
            rec.isAbsent ? (isPg ? true : 1) : (isPg ? false : 0),
            effectiveMaxMarks,
            nextStatus,
            publish ? nowIso : null,
            publish ? actor.studentId : null,
            actor.studentId,
            actor.studentId,
            nowIso,
            nowIso
          );
        }
      }

      if (publish) {
        // Also transition any existing draft rows with non-null obtained_marks or is_absent for this subject & exam to published
        await tx.run(
          `UPDATE student_marks
           SET status = 'published',
               published_at = COALESCE(published_at, ?),
               published_by = COALESCE(published_by, ?),
               updated_by = ?,
               updated_at = ?
           WHERE subject_id = ? AND semester_no = ? AND exam_type = ?
             AND (obtained_marks IS NOT NULL OR is_absent IS TRUE)`,
          nowIso,
          actor.studentId,
          actor.studentId,
          nowIso,
          subject.id,
          subject.semester,
          normalizedExamType
        );

        const publishedCheck = await tx.get(
          `SELECT COUNT(*) AS cnt
           FROM student_marks
           WHERE subject_id = ? AND semester_no = ? AND exam_type = ? AND status = 'published'
             AND (obtained_marks IS NOT NULL OR is_absent IS TRUE)`,
          subject.id,
          subject.semester,
          normalizedExamType
        );
        const pubCount = Number(publishedCheck?.cnt ?? publishedCheck?.count ?? 0);
        if (pubCount === 0) {
          throw createHttpError(
            400,
            'Cannot publish results before entering marks for at least one enrolled student.',
            'NO_MARKS_TO_PUBLISH'
          );
        }
      }

      const updatedRows = (await tx.all(
        `SELECT * FROM student_marks
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ?`,
        subject.id,
        subject.semester,
        normalizedExamType
      )) || [];

      const afterState = {};
      for (const r of updatedRows) {
        const sId = r.studentId || r.student_id;
        afterState[sId] = {
          obtainedMarks: r.obtainedMarks !== null && r.obtainedMarks !== undefined
            ? Number(r.obtainedMarks)
            : (r.obtained_marks !== null && r.obtained_marks !== undefined ? Number(r.obtained_marks) : null),
          maxMarks: Number(r.maxMarks ?? r.max_marks),
          status: r.status
        };
      }

      const auditAction = (editedPublishedCount > 0 || editPublished)
        ? 'published_marks_edited'
        : (publish ? 'results_published' : 'draft_saved');

      await writeMarksAuditLog(tx, {
        subjectId: subject.id,
        semesterNo: subject.semester,
        examType: normalizedExamType,
        action: auditAction,
        actorUserId: actor.studentId,
        actorRole: actor.role,
        reason: reason || (
          auditAction === 'results_published'
            ? `Published ${normalizedExamType} results for ${subject.code}`
            : auditAction === 'published_marks_edited'
            ? `Edited published ${normalizedExamType} marks for ${subject.code}`
            : `Saved draft ${normalizedExamType} marks for ${subject.code}`
        ),
        beforeState,
        afterState,
        metadata: {
          maxMarks: effectiveMaxMarks,
          submittedRecordCount: normalizedRecords.length,
          editedPublishedCount,
          changedPublishedStudents
        },
        timestampIso: nowIso
      });
    };

    if (typeof db.withTransaction === 'function') {
      await db.withTransaction(runSave);
    } else {
      await runSave(db);
    }

    const rosterState = await getSubjectMarksRoster(db, {
      actorUserId,
      subjectId: subject.id,
      examType: normalizedExamType,
      cohortId
    });

    return {
      saved: true,
      published: Boolean(publish),
      ...rosterState
    };
  });
}

/**
 * 6. Publishes marks for a subject and exam type.
 * Can optionally accept `records` and `maxMarks` to save & publish in a single atomic operation,
 * or publish already-saved draft marks.
 */
async function publishSubjectResults(db, {
  actorUserId,
  subjectId,
  examType,
  maxMarks = undefined,
  records = undefined,
  cohortId = null,
  reason = null
}) {
  return await withMarksSchemaGuard(db, async () => {
    if (Array.isArray(records) && records.length > 0) {
      return await saveStudentMarks(db, {
        actorUserId,
        subjectId,
        examType,
        maxMarks,
        records,
        cohortId,
        publish: true,
        editPublished: true,
        reason
      });
    }

    const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
    const subject = await resolveAuthorizedSubject(db, actor, subjectId);
    const normalizedExamType = normalizeExamType(examType, { required: true });
    const nowIso = new Date().toISOString();

    const runPublishOnly = async (tx) => {
      if (maxMarks !== undefined && maxMarks !== null && maxMarks !== '') {
        const validatedMax = validateMaxMarks(maxMarks);
        const existingConfig = await tx.get(
          `SELECT * FROM exam_configurations
           WHERE subject_id = ? AND semester_no = ? AND exam_type = ?`,
          subject.id,
          subject.semester,
          normalizedExamType
        );
        if (existingConfig) {
          await tx.run(
            `UPDATE exam_configurations SET max_marks = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
            validatedMax,
            actor.studentId,
            nowIso,
            existingConfig.id
          );
        } else {
          await tx.run(
            `INSERT INTO exam_configurations (
              id, subject_id, semester_no, exam_type, max_marks, created_by, updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            crypto.randomUUID(),
            subject.id,
            subject.semester,
            normalizedExamType,
            validatedMax,
            actor.studentId,
            actor.studentId,
            nowIso,
            nowIso
          );
        }
      }

      const existingRows = (await tx.all(
        `SELECT * FROM student_marks
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ?
           AND (obtained_marks IS NOT NULL OR is_absent IS TRUE)`,
        subject.id,
        subject.semester,
        normalizedExamType
      )) || [];

      if (existingRows.length === 0) {
        throw createHttpError(
          400,
          'Cannot publish results before saving marks for at least one enrolled student.',
          'NO_MARKS_TO_PUBLISH'
        );
      }

      const beforeState = {};
      const afterState = {};
      for (const r of existingRows) {
        const sId = r.studentId || r.student_id;
        const rawObt = r.obtainedMarks ?? r.obtained_marks;
        const obt = rawObt !== null && rawObt !== undefined ? Number(rawObt) : null;
        const mx = Number(r.maxMarks ?? r.max_marks);
        beforeState[sId] = { obtainedMarks: obt, maxMarks: mx, status: r.status };
        afterState[sId] = { obtainedMarks: obt, maxMarks: mx, status: 'published' };
      }

      await tx.run(
        `UPDATE student_marks
         SET status = 'published',
             published_at = COALESCE(published_at, ?),
             published_by = COALESCE(published_by, ?),
             updated_by = ?,
             updated_at = ?
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ?
           AND (obtained_marks IS NOT NULL OR is_absent IS TRUE)`,
        nowIso,
        actor.studentId,
        actor.studentId,
        nowIso,
        subject.id,
        subject.semester,
        normalizedExamType
      );

      await writeMarksAuditLog(tx, {
        subjectId: subject.id,
        semesterNo: subject.semester,
        examType: normalizedExamType,
        action: 'results_published',
        actorUserId: actor.studentId,
        actorRole: actor.role,
        reason: reason || `Published ${normalizedExamType} results for ${subject.code}`,
        beforeState,
        afterState,
        metadata: { publishedCount: existingRows.length },
        timestampIso: nowIso
      });
    };

    if (typeof db.withTransaction === 'function') {
      await db.withTransaction(runPublishOnly);
    } else {
      await runPublishOnly(db);
    }

    const rosterState = await getSubjectMarksRoster(db, {
      actorUserId,
      subjectId: subject.id,
      examType: normalizedExamType,
      cohortId
    });

    return {
      saved: true,
      published: true,
      ...rosterState
    };
  });
}

/**
 * 7. Retrieves audit logs for marks changes on an authorized subject.
 */
async function getSubjectMarksAuditLogs(db, {
  actorUserId,
  subjectId,
  examType = null
}) {
  return await withMarksSchemaGuard(db, async () => {
    const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
    const subject = await resolveAuthorizedSubject(db, actor, subjectId, { allowArchivedForRead: true });
    const normalizedExamType = normalizeExamType(examType, { required: false });

    const params = [subject.id, subject.semester];
    let examClause = '';
    if (normalizedExamType) {
      examClause = ' AND l.exam_type = ?';
      params.push(normalizedExamType);
    }

    const rows = (await db.all(
      `SELECT l.*, u.name AS actor_name, u.username AS actor_username
       FROM marks_audit_logs l
       LEFT JOIN students u ON u.studentId = l.actor_user_id
       WHERE l.subject_id = ? AND l.semester_no = ?${examClause}
       ORDER BY l.created_at DESC`,
      ...params
    )) || [];

    const parseJsonField = (val) => {
      if (!val) return null;
      if (typeof val === 'object') return val;
      try {
        return JSON.parse(val);
      } catch (_) {
        return null;
      }
    };

    const logs = rows.map((r) => ({
      id: r.id,
      subjectId: r.subjectId || r.subject_id,
      semesterNo: Number(r.semesterNo || r.semester_no),
      examType: r.examType || r.exam_type,
      studentId: r.studentId || r.student_id || null,
      action: r.action,
      actorUserId: r.actorUserId || r.actor_user_id,
      actorName: r.actor_name || r.actorName || r.actorUserId || r.actor_user_id,
      actorUsername: r.actor_username || r.actorUsername || null,
      actorRole: r.actorRole || r.actor_role,
      reason: r.reason || null,
      beforeState: parseJsonField(r.beforeState || r.before_state),
      afterState: parseJsonField(r.afterState || r.after_state),
      metadata: parseJsonField(r.metadata),
      createdAt: r.createdAt || r.created_at
    }));

    return {
      subject,
      examType: normalizedExamType,
      logs
    };
  });
}

/**
 * 8. Retrieves the authenticated student's own published results, organized by semester and subject.
 * Draft/unpublished marks are strictly excluded at the SQL query level.
 */
async function getStudentPublishedResults(db, { studentUserId, semesterFilter = null }) {
  return await withMarksSchemaGuard(db, async () => {
    const actor = await resolveAuthenticatedActor(db, studentUserId, ['student', 'cr', 'admin']);
    const context = await getAcademicContext(db, { studentId: actor.studentId });

    const currentSemesterNo = Number(
      context?.cohort?.currentSemester ||
      context?.currentSemester ||
      parseSemesterNumber(actor.semester) ||
      1
    );

    // Query strictly published marks for this authenticated student
    const publishedRows = (await db.all(
      `SELECT m.id,
              m.student_id,
              m.subject_id,
              m.semester_no,
              m.cohort_id,
              m.exam_type,
              m.obtained_marks,
              m.is_absent,
              m.max_marks,
              m.status,
              m.published_at,
              m.updated_at,
              sub.code AS subject_code,
              sub.name AS subject_name,
              sub.department AS subject_department,
              sub.credit_hours AS subject_credit_hours,
              sub.nature AS subject_nature
       FROM student_marks m
       JOIN subjects sub ON sub.id = m.subject_id
       WHERE m.student_id = ?
         AND m.status = 'published'
       ORDER BY m.semester_no ASC, sub.code ASC, m.published_at ASC`,
      actor.studentId
    )) || [];

    // Track all semesters relevant to this student (published results + current semester + cohort history)
    const availableSemesterNumsSet = new Set([currentSemesterNo]);
    for (const r of publishedRows) {
      const sNo = Number(r.semesterNo || r.semester_no);
      if (Number.isInteger(sNo) && sNo >= 1 && sNo <= 8) {
        availableSemesterNumsSet.add(sNo);
      }
    }
    if (Array.isArray(context?.semesterHistory)) {
      for (const h of context.semesterHistory) {
        const sNo = Number(h.semesterNo || h.semester_no);
        if (Number.isInteger(sNo) && sNo >= 1 && sNo <= 8) {
          availableSemesterNumsSet.add(sNo);
        }
      }
    }

    let parsedSemesterFilter = null;
    if (semesterFilter !== null && semesterFilter !== undefined && String(semesterFilter).trim() !== '' && String(semesterFilter).toUpperCase() !== 'ALL') {
      parsedSemesterFilter = parseSemesterNumber(semesterFilter);
      if (!parsedSemesterFilter) {
        throw createHttpError(400, 'Invalid semester filter. Must be an integer between 1 and 8.', 'INVALID_SEMESTER');
      }
      availableSemesterNumsSet.add(parsedSemesterFilter);
    }

    const activeCheck = db.isPostgres ? '(active = TRUE OR active IS NULL)' : '(active = 1 OR active IS NULL)';
    const allSubjectsRows = (await db.all(
      `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature
       FROM subjects
       WHERE ${activeCheck}
       ORDER BY semester ASC, code ASC`
    )) || [];

    const subjectsById = new Map();
    const curriculumSubjectsBySemester = new Map();
    for (const s of allSubjectsRows) {
      const semNo = Number(s.semester);
      const subjObj = {
        subjectId: s.id,
        code: s.code,
        name: s.name,
        semesterNo: semNo,
        department: s.department || 'BIT',
        creditHours: Number(s.creditHours ?? s.credithours ?? 3.0),
        nature: s.nature || null
      };
      subjectsById.set(s.id, subjObj);
      if (!curriculumSubjectsBySemester.has(semNo)) {
        curriculumSubjectsBySemester.set(semNo, []);
      }
      curriculumSubjectsBySemester.get(semNo).push(subjObj);
    }

    // Group published exam results
    const examOrderIndex = new Map(VALID_EXAM_TYPES.map((t, idx) => [t, idx]));
    const formattedResults = [];
    const resultsBySemester = new Map();
    const unfilteredPublishedCountsBySem = new Map();

    let totalPublishedExams = 0;
    let totalObtainedMarks = 0;
    let totalMaxMarks = 0;
    let percentageSum = 0;
    let percentageCount = 0;
    const examTypeBreakdown = {
      'Mid-Term Exam': { publishedCount: 0, averagePercentage: null, sumPct: 0 },
      'Pre-Board Exam': { publishedCount: 0, averagePercentage: null, sumPct: 0 },
      'Final Exam': { publishedCount: 0, averagePercentage: null, sumPct: 0 }
    };

    for (const row of publishedRows) {
      // Double-guard: never include non-published rows
      if (String(row.status || '').toLowerCase() !== 'published') continue;

      const semNo = Number(row.semesterNo || row.semester_no);
      const subjId = row.subjectId || row.subject_id;
      const examType = row.examType || row.exam_type;
      const isAbsent = Boolean(row.is_absent || row.isAbsent);
      const rawObtained = row.obtainedMarks ?? row.obtained_marks;
      const isMissing = !isAbsent && (rawObtained === null || rawObtained === undefined || rawObtained === '');
      const obtainedMarks = isAbsent ? null : (isMissing ? null : Number(rawObtained));
      const maxMarks = Number(row.maxMarks ?? row.max_marks);
      const percentage = isAbsent ? 0 : (!isMissing ? calculateExamPercentage(obtainedMarks, maxMarks) : null);
      const formattedPercentage = isAbsent ? 'Absent' : formatPercentageDisplay(percentage);

      if (!isMissing && percentage !== null) {
        const prevSemStat = unfilteredPublishedCountsBySem.get(semNo) || { exams: 0, subjects: new Set() };
        prevSemStat.exams += 1;
        prevSemStat.subjects.add(subjId);
        unfilteredPublishedCountsBySem.set(semNo, prevSemStat);
      }

      if (parsedSemesterFilter && semNo !== parsedSemesterFilter) {
        continue;
      }

      const resultItem = {
        id: row.id,
        studentId: actor.studentId,
        subjectId: subjId,
        subjectCode: row.subject_code || row.subjectCode || subjId,
        subjectName: row.subject_name || row.subjectName || subjId,
        semesterNo: semNo,
        semesterLabel: `Semester ${semNo}`,
        examType,
        isAbsent,
        obtainedMarks,
        maxMarks,
        percentage,
        formattedPercentage,
        passFail: isAbsent ? 'Fail' : (percentage !== null && percentage >= 45 ? 'Pass' : 'Fail'),
        percentageAvailable: percentage !== null,
        isMissing,
        status: isAbsent ? 'Absent' : 'published',
        publicationStatus: isAbsent ? 'Absent' : 'Published',
        publishedAt: row.publishedAt || row.published_at || null,
        updatedAt: row.updatedAt || row.updated_at || null
      };

      formattedResults.push(resultItem);

      if (!isMissing && percentage !== null) {
        totalPublishedExams += 1;
        totalObtainedMarks += obtainedMarks;
        totalMaxMarks += maxMarks;
        percentageSum += percentage;
        percentageCount += 1;

        if (examTypeBreakdown[examType]) {
          examTypeBreakdown[examType].publishedCount += 1;
          examTypeBreakdown[examType].sumPct += percentage;
        }
      }

      if (!resultsBySemester.has(semNo)) {
        resultsBySemester.set(semNo, new Map());
      }
      const semSubjectsMap = resultsBySemester.get(semNo);
      if (!semSubjectsMap.has(subjId)) {
        const catSubj = subjectsById.get(subjId);
        semSubjectsMap.set(subjId, {
          subjectId: subjId,
          code: resultItem.subjectCode,
          name: resultItem.subjectName,
          semesterNo: semNo,
          department: catSubj ? catSubj.department : (row.subject_department || 'BIT'),
          creditHours: catSubj ? catSubj.creditHours : Number(row.subject_credit_hours || 3.0),
          nature: catSubj ? catSubj.nature : (row.subject_nature || null),
          exams: []
        });
      }
      semSubjectsMap.get(subjId).exams.push(resultItem);
    }

    for (const et of VALID_EXAM_TYPES) {
      const b = examTypeBreakdown[et];
      b.averagePercentage = b.publishedCount > 0
        ? Math.round((b.sumPct / b.publishedCount) * 100) / 100
        : null;
      delete b.sumPct;
    }

    // Build semester groups sorted by semester number (descending so most recent is first)
    const semesters = [...resultsBySemester.keys()]
      .sort((a, b) => b - a)
      .map((semNo) => {
        const semSubjectsMap = resultsBySemester.get(semNo);
        let semObtained = 0;
        let semMax = 0;
        let semValidExamCount = 0;
        let semPctSum = 0;

        const subjects = [...semSubjectsMap.values()].map((subj) => {
          subj.exams.sort(
            (a, b) => (examOrderIndex.get(a.examType) ?? 99) - (examOrderIndex.get(b.examType) ?? 99)
          );
          const examMap = {};
          let subjObtained = 0;
          let subjMax = 0;
          let subjValidExams = 0;

          for (const ex of subj.exams) {
            examMap[ex.examType] = ex;
            if (!ex.isMissing && ex.percentage !== null) {
              subjObtained += Number(ex.obtainedMarks);
              subjMax += Number(ex.maxMarks);
              subjValidExams += 1;
              semObtained += Number(ex.obtainedMarks);
              semMax += Number(ex.maxMarks);
              semValidExamCount += 1;
              semPctSum += Number(ex.percentage);
            }
          }

          const examSlots = VALID_EXAM_TYPES.map((examType) => {
            const pub = examMap[examType];
            if (pub) {
              return {
                ...pub,
                isPublished: true
              };
            }
            return {
              examType,
              subjectId: subj.subjectId,
              subjectCode: subj.code,
              subjectName: subj.name,
              semesterNo: semNo,
              semesterLabel: `Semester ${semNo}`,
              isPublished: false,
              isMissing: false,
              obtainedMarks: null,
              maxMarks: null,
              percentage: null,
              formattedPercentage: '—',
              percentageAvailable: false,
              status: 'not_published',
              publicationStatus: 'Not Yet Available',
              publishedAt: null
            };
          });

          const subjObtRounded = Math.round(subjObtained * 100) / 100;
          const subjMaxRounded = Math.round(subjMax * 100) / 100;
          const subjOverallPct = subjMaxRounded > 0
            ? Math.round(((subjObtRounded / subjMaxRounded) * 100) * 100) / 100
            : null;

          return {
            ...subj,
            publishedExamsCount: subjValidExams,
            totalExamTypes: VALID_EXAM_TYPES.length,
            unpublishedExamsCount: Math.max(0, VALID_EXAM_TYPES.length - subjValidExams),
            isPartiallyPublished: subjValidExams > 0 && subjValidExams < VALID_EXAM_TYPES.length,
            examsByType: examMap,
            examSlots,
            summary: {
              publishedExamsCount: subjValidExams,
              totalExamTypes: VALID_EXAM_TYPES.length,
              unpublishedExamsCount: Math.max(0, VALID_EXAM_TYPES.length - subjValidExams),
              isPartiallyPublished: subjValidExams > 0 && subjValidExams < VALID_EXAM_TYPES.length,
              totalObtainedMarks: subjObtRounded,
              totalMaxMarks: subjMaxRounded,
              overallPercentage: subjOverallPct,
              formattedOverallPercentage: formatPercentageDisplay(subjOverallPct),
              percentageAvailable: subjValidExams > 0 && subjMaxRounded > 0
            }
          };
        });

        const semObtRounded = Math.round(semObtained * 100) / 100;
        const semMaxRounded = Math.round(semMax * 100) / 100;
        const semOverallPct = semMaxRounded > 0
          ? Math.round(((semObtRounded / semMaxRounded) * 100) * 100) / 100
          : null;
        const semAvgPct = semValidExamCount > 0
          ? Math.round((semPctSum / semValidExamCount) * 100) / 100
          : null;
        const totalExpectedExams = subjects.length * VALID_EXAM_TYPES.length;
        const unpublishedExamsCount = Math.max(0, totalExpectedExams - semValidExamCount);
        const curriculumSubjs = curriculumSubjectsBySemester.get(semNo) || [];

        return {
          semesterNo: semNo,
          semesterLabel: `Semester ${semNo}`,
          publishedSubjectsCount: subjects.length,
          totalCurriculumSubjectsCount: curriculumSubjs.length || subjects.length,
          publishedExamsCount: semValidExamCount,
          unpublishedExamsCount,
          isPartiallyPublished: semValidExamCount > 0 && (unpublishedExamsCount > 0 || (curriculumSubjs.length > subjects.length)),
          summary: {
            publishedSubjectsCount: subjects.length,
            totalCurriculumSubjectsCount: curriculumSubjs.length || subjects.length,
            publishedExamsCount: semValidExamCount,
            totalExpectedExamsCount: totalExpectedExams,
            unpublishedExamsCount,
            isPartiallyPublished: semValidExamCount > 0 && (unpublishedExamsCount > 0 || (curriculumSubjs.length > subjects.length)),
            totalObtainedMarks: semObtRounded,
            totalMaxMarks: semMaxRounded,
            overallPercentage: semOverallPct,
            formattedOverallPercentage: formatPercentageDisplay(semOverallPct),
            aggregatePercentage: semOverallPct,
            formattedAggregatePercentage: formatPercentageDisplay(semOverallPct),
            averagePercentage: semAvgPct,
            formattedAveragePercentage: formatPercentageDisplay(semAvgPct),
            percentageAvailable: semValidExamCount > 0 && semMaxRounded > 0
          },
          subjects
        };
      });

    const availableSemesters = [...availableSemesterNumsSet]
      .sort((a, b) => b - a)
      .map((semNo) => {
        const stat = unfilteredPublishedCountsBySem.get(semNo);
        const pubExams = stat ? stat.exams : 0;
        const pubSubjs = stat ? stat.subjects.size : 0;
        return {
          semesterNo: semNo,
          semesterLabel: `Semester ${semNo}`,
          isCurrentSemester: semNo === currentSemesterNo,
          hasPublishedResults: pubExams > 0,
          publishedSubjectsCount: pubSubjs,
          publishedExamsCount: pubExams
        };
      });

    const subjectsWithResultsCount = semesters.reduce((acc, s) => acc + s.publishedSubjectsCount, 0);
    const overallAveragePercentage = percentageCount > 0
      ? Math.round((percentageSum / percentageCount) * 100) / 100
      : null;
    const overallAggregatePercentage = totalMaxMarks > 0
      ? Math.round(((totalObtainedMarks / totalMaxMarks) * 100) * 100) / 100
      : null;

    return {
      studentId: actor.studentId,
      rollNumber: actor.studentId,
      name: actor.name,
      username: actor.username,
      role: actor.role,
      department: actor.department || 'BIT',
      currentSemesterNo,
      semesterLabel: `Semester ${currentSemesterNo}`,
      cohort: context?.cohort
        ? {
            id: context.cohort.id,
            displayName: context.cohort.displayName,
            slotCode: context.cohort.slotCode,
            currentSemester: context.cohort.currentSemester
          }
        : null,
      examTypes: VALID_EXAM_TYPES,
      availableSemesters,
      hasPublishedResults: formattedResults.length > 0,
      summary: {
        totalPublishedExams,
        subjectsWithResultsCount,
        semestersWithResultsCount: semesters.length,
        totalObtainedMarks: Math.round(totalObtainedMarks * 100) / 100,
        totalMaxMarks: Math.round(totalMaxMarks * 100) / 100,
        overallPercentage: overallAggregatePercentage,
        formattedOverallPercentage: formatPercentageDisplay(overallAggregatePercentage),
        averagePercentage: overallAveragePercentage,
        formattedAveragePercentage: formatPercentageDisplay(overallAveragePercentage),
        aggregatePercentage: overallAggregatePercentage,
        formattedAggregatePercentage: formatPercentageDisplay(overallAggregatePercentage),
        percentageAvailable: percentageCount > 0,
        examTypeBreakdown
      },
      semesters,
      results: formattedResults
    };
  });
}

/**
 * 9. Generates a downloadable A4 PDF Report Card for the authenticated student's selected semester
 * and exam type (Mid-Term Exam, Pre-Board Exam, or Final Exam).
 * Includes all curriculum subjects for the semester (showing '-' where marks are unavailable),
 * overall exam percentage, and class rank computed from published marks.
 */
async function generateStudentSemesterReportCard(db, { studentUserId, semester = null, examType = null }) {
  return await withMarksSchemaGuard(db, async () => {
    const actor = await resolveAuthenticatedActor(db, studentUserId, ['student', 'cr', 'admin']);
    const resultsPayload = await getStudentPublishedResults(db, {
      studentUserId: actor.studentId
    });

    let targetSemesterNo = null;
    if (semester !== null && semester !== undefined && String(semester).trim() !== '') {
      targetSemesterNo = parseSemesterNumber(semester);
      if (!targetSemesterNo) {
        throw createHttpError(
          400,
          'Please select a valid semester (1 to 8) to download your report card.',
          'INVALID_SEMESTER'
        );
      }
    } else if (resultsPayload.semesters && resultsPayload.semesters.length > 0) {
      targetSemesterNo = resultsPayload.semesters[0].semesterNo;
    } else {
      targetSemesterNo = resultsPayload.currentSemesterNo;
    }

    const semesterData = (resultsPayload.semesters || []).find(
      (s) => Number(s.semesterNo) === Number(targetSemesterNo)
    );

    if (!semesterData || !semesterData.publishedExamsCount || semesterData.publishedExamsCount <= 0) {
      throw createHttpError(
        404,
        `No published examination results are available for Semester ${targetSemesterNo} to generate a PDF report card.`,
        'NO_PUBLISHED_RESULTS_FOR_SEMESTER'
      );
    }

    let targetExamType = normalizeExamType(examType, { required: false });
    if (!targetExamType) {
      for (const et of VALID_EXAM_TYPES) {
        const hasAny = (semesterData.subjects || []).some((sub) =>
          (sub.exams || []).some((e) => e && e.examType === et && (e.status === 'published' || e.isAbsent))
        );
        if (hasAny) {
          targetExamType = et;
          break;
        }
      }
      if (!targetExamType) targetExamType = 'Mid-Term Exam';
    }

    const activeCheck = db.isPostgres ? '(active = TRUE OR active IS NULL)' : '(active = 1 OR active IS NULL)';
    const curriculumRows = (await db.all(
      `SELECT id, code, name, semester
       FROM subjects
       WHERE semester = ? AND ${activeCheck}
       ORDER BY code ASC`,
      targetSemesterNo
    )) || [];

    const publishedBySubjKey = new Map();
    for (const sub of semesterData.subjects || []) {
      const pubExam = (sub.exams || []).find(
        (e) => e && e.examType === targetExamType && (e.status === 'published' || e.isAbsent)
      );
      if (pubExam) {
        if (sub.subjectId) publishedBySubjKey.set(String(sub.subjectId).trim().toLowerCase(), pubExam);
        if (sub.code) publishedBySubjKey.set(String(sub.code).trim().toLowerCase(), pubExam);
      }
    }

    if (publishedBySubjKey.size === 0) {
      throw createHttpError(
        404,
        `No published ${targetExamType} results are available for Semester ${targetSemesterNo}.`,
        'NO_PUBLISHED_RESULTS_FOR_EXAM'
      );
    }

    const allSubjects = curriculumRows.length > 0
      ? curriculumRows.map((r) => ({ id: r.id, code: r.code || r.id, name: r.name }))
      : (semesterData.subjects || []).map((s) => ({ id: s.subjectId, code: s.code || s.subjectId, name: s.name }));

    let myObtained = 0;
    let myMax = 0;
    let myAllPassed = true;

    const subjectRows = allSubjects.map((sub) => {
      const pubExam =
        publishedBySubjKey.get(String(sub.id || '').trim().toLowerCase()) ||
        publishedBySubjKey.get(String(sub.code || '').trim().toLowerCase()) ||
        null;

      if (!pubExam) {
        return {
          code: sub.code,
          name: sub.name,
          marksDisplay: '-',
          remarkDisplay: '-'
        };
      }

      const isAbsent = Boolean(pubExam.isAbsent || pubExam.status === 'Absent');
      const mx = Number(pubExam.maxMarks || 0);
      if (isAbsent) {
        if (mx > 0) myMax += mx;
        myAllPassed = false;
        return {
          code: sub.code,
          name: sub.name,
          marksDisplay: 'Absent',
          remarkDisplay: 'Fail'
        };
      }

      const obt = Number(pubExam.obtainedMarks);
      if (mx > 0) {
        myObtained += obt;
        myMax += mx;
      }
      const pct = mx > 0 ? calculateExamPercentage(obt, mx) : null;
      const isPass = pct !== null ? pct >= 45 : true;
      if (!isPass) myAllPassed = false;

      return {
        code: sub.code,
        name: sub.name,
        marksDisplay: Number.isInteger(obt) ? String(obt) : obt.toFixed(2).replace(/\.?0+$/, ''),
        remarkDisplay: pct !== null ? (isPass ? 'Pass' : 'Fail') : '-'
      };
    });

    const myPercentage = myMax > 0 ? Math.round(((myObtained / myMax) * 100) * 100) / 100 : null;

    let myRank = '-';
    if (myPercentage !== null && myAllPassed) {
      try {
        const peerMarkRows = (await db.all(
          `SELECT student_id, obtained_marks, max_marks, is_absent
           FROM student_marks
           WHERE semester_no = ? AND exam_type = ? AND status = 'published'`,
          targetSemesterNo,
          targetExamType
        )) || [];

        const peerTotals = new Map();
        for (const r of peerMarkRows) {
          const sId = String(r.studentId || r.student_id || '').trim();
          if (!sId) continue;
          const agg = peerTotals.get(sId) || { obt: 0, max: 0, passed: true, count: 0 };
          const isAbs = Boolean(r.isAbsent || r.is_absent);
          const mx = Number(r.maxMarks ?? r.max_marks ?? 0);
          if (isAbs) {
            if (mx > 0) agg.max += mx;
            agg.passed = false;
            agg.count += 1;
          } else {
            const rawObt = r.obtainedMarks ?? r.obtained_marks;
            if (rawObt !== null && rawObt !== undefined && String(rawObt).trim() !== '') {
              const obt = Number(rawObt);
              if (mx > 0) {
                agg.obt += obt;
                agg.max += mx;
                const p = calculateExamPercentage(obt, mx);
                if (p !== null && p < 45) agg.passed = false;
              }
              agg.count += 1;
            }
          }
          peerTotals.set(sId, agg);
        }

        const eligiblePeers = [];
        for (const [sId, agg] of peerTotals.entries()) {
          if (agg.count > 0 && agg.max > 0 && agg.passed) {
            eligiblePeers.push({
              studentId: sId,
              pct: Math.round(((agg.obt / agg.max) * 100) * 100) / 100
            });
          }
        }
        eligiblePeers.sort((a, b) => b.pct - a.pct);
        let lastPct = null;
        let currentRank = 0;
        for (let i = 0; i < eligiblePeers.length; i++) {
          if (lastPct === null || eligiblePeers[i].pct < lastPct) {
            currentRank = i + 1;
            lastPct = eligiblePeers[i].pct;
          }
          if (eligiblePeers[i].studentId === String(resultsPayload.studentId)) {
            myRank = String(currentRank);
            break;
          }
        }
      } catch (_) {}
    }

    const { generateStudentReportCardPdf } = require('./results-pdf');
    const generatedAt = new Date().toISOString();
    const issuedDate = formatCurrentBsDateLabel(new Date());
    const pdfBuffer = generateStudentReportCardPdf({
      student: {
        studentId: resultsPayload.studentId,
        rollNumber: resultsPayload.rollNumber,
        name: resultsPayload.name,
        department: resultsPayload.department,
        cohort: resultsPayload.cohort
      },
      semesterData,
      examType: targetExamType,
      subjectRows,
      percentage: myPercentage,
      rank: myRank,
      issuedDate,
      generatedAt
    });

    const safeStudentId = String(resultsPayload.studentId).replace(/[^a-zA-Z0-9_-]/g, '');
    const safeExam = String(targetExamType).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Gandaki_University_Report_Card_Sem_${targetSemesterNo}_${safeExam}_${safeStudentId}.pdf`;

    return {
      pdfBuffer,
      filename,
      semesterNo: targetSemesterNo,
      semesterLabel: semesterData.semesterLabel,
      examType: targetExamType,
      studentId: resultsPayload.studentId,
      generatedAt
    };
  });
}

let cachedMarksGandakiLogoUri = null;

function getGandakiLogoDataUri() {
  if (cachedMarksGandakiLogoUri !== null) return cachedMarksGandakiLogoUri;
  const candidates = [
    path.join(__dirname, '..', 'public', 'images', 'gandaki-university-logo.png'),
    path.join(__dirname, '..', 'mobile', 'assets', 'images', 'chat-themes', 'Pasted 2026-11-20 at 9.43.08 PM.png')
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        cachedMarksGandakiLogoUri = `data:image/png;base64,${buf.toString('base64')}`;
        return cachedMarksGandakiLogoUri;
      }
    } catch (_) {}
  }
  cachedMarksGandakiLogoUri = '';
  return cachedMarksGandakiLogoUri;
}

function escapeMarksSvgXml(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveStudentMarkStatusRow(stu, fallbackMaxMarks) {
  const isAbsent = Boolean(stu && (stu.isAbsent || stu.is_absent));
  const maxMarks = stu && stu.maxMarks !== null && stu.maxMarks !== undefined
    ? Number(stu.maxMarks)
    : fallbackMaxMarks;
  const hasObtained =
    !isAbsent &&
    stu &&
    stu.obtainedMarks !== null &&
    stu.obtainedMarks !== undefined &&
    String(stu.obtainedMarks).trim() !== '';

  if (isAbsent) {
    return { marksDisplay: 'Absent', statusDisplay: 'Fail', statusKind: 'fail', isAbsent: true };
  }
  if (!hasObtained) {
    return { marksDisplay: '-', statusDisplay: '-', statusKind: 'none', isAbsent: false };
  }

  const obtained = Number(stu.obtainedMarks);
  const marksDisplay = String(obtained);
  const pct = stu.percentage !== null && stu.percentage !== undefined
    ? Number(stu.percentage)
    : calculateExamPercentage(obtained, maxMarks);
  if (pct === null || !Number.isFinite(pct)) {
    return { marksDisplay, statusDisplay: '-', statusKind: 'none', isAbsent: false };
  }
  const isPass = pct >= 45;
  return {
    marksDisplay,
    statusDisplay: isPass ? 'Pass' : 'Fail',
    statusKind: isPass ? 'pass' : 'fail',
    isAbsent: false
  };
}

/**
 * Exports a subject's marks register as a CSV matching the official Gandaki University mark sheet:
 * S.N., Student Name, Marks, Status (Pass/Fail), Remark.
 */
function exportSubjectMarksCsv(rosterData = {}) {
  const escapeCsvCell = (val) => {
    if (val === null || val === undefined) return '';
    let str = String(val).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    if (str !== '-' && (/^[=+\-@]/.test(str) || /^[\t\r\n]/.test(str) || /^\s+[=+\-@]/.test(str))) {
      str = `'${str}`;
    }
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const subject = rosterData.subject || {};
  const semesterNo = rosterData.semesterNo || subject.semester || '';
  const semesterLabel = semesterNo ? `Semester ${semesterNo}` : '';
  const subjectLabel = subject.code && subject.name
    ? `${subject.code} — ${subject.name}`
    : subject.name || subject.code || '';
  const examType = String(rosterData.examType || 'Mid-Term Exam');
  const maxMarks = rosterData.examConfig && rosterData.examConfig.maxMarks !== null && rosterData.examConfig.maxMarks !== undefined
    ? Number(rosterData.examConfig.maxMarks)
    : (rosterData.summary && rosterData.summary.maxMarks !== null && rosterData.summary.maxMarks !== undefined
      ? Number(rosterData.summary.maxMarks)
      : null);
  const teacherName = String(rosterData.teacherName || '').trim();
  const students = sortStudentsAlphabetically(Array.isArray(rosterData.students) ? rosterData.students : []);

  const lines = [
    ['Gandaki University'].map(escapeCsvCell).join(','),
    ['EXAMINATION MARKS SHEET'].map(escapeCsvCell).join(','),
    [
      'Subject', subjectLabel,
      'Semester', semesterLabel,
      'Exam', examType,
      'Full Marks', maxMarks !== null ? String(maxMarks) : '—',
      'Teacher', teacherName
    ].map(escapeCsvCell).join(','),
    '',
    ['S.N.', 'Student Name', 'Marks', 'Status', 'Remark'].map(escapeCsvCell).join(',')
  ];

  students.forEach((stu, idx) => {
    const resolved = resolveStudentMarkStatusRow(stu, maxMarks);
    lines.push([idx + 1, stu.name || stu.studentId, resolved.marksDisplay, resolved.statusDisplay, ''].map(escapeCsvCell).join(','));
  });

  return lines.join('\n') + '\n';
}

/**
 * Generates an official, standalone, printable A4 Landscape SVG mark sheet for a subject & exam.
 * Uses 1:1 96-DPI A4 Landscape coordinates (1122 × 794 matching 297mm × 210mm) so text renders
 * at crisp full size in browsers and prints cleanly on A4 paper.
 *
 * Header: Centered Gandaki University logo, "Gandaki University", "EXAMINATION MARKS SHEET",
 *         and metadata box (Subject, Semester, Exam: Mid-Term / Pre-Board / Final, Full Marks, Teacher).
 * Table columns: S.N. | Student Name | Marks | Status (Pass / Fail) | Remark.
 */
function exportSubjectMarksSvg(rosterData = {}) {
  const PAGE_WIDTH = 1122;
  const PAGE_HEIGHT = 794;
  const MARGIN_X = 48;
  const TABLE_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 1026
  const ROWS_PER_PAGE = 14;

  const subject = rosterData.subject || {};
  const semesterNo = rosterData.semesterNo || subject.semester || '';
  const semesterLabel = semesterNo ? `Semester ${semesterNo}` : '';
  const subjectLabel = subject.code && subject.name
    ? `${subject.code} — ${subject.name}`
    : subject.name || subject.code || '';
  const examType = String(rosterData.examType || 'Mid-Term Exam');
  const maxMarks = rosterData.examConfig && rosterData.examConfig.maxMarks !== null && rosterData.examConfig.maxMarks !== undefined
    ? Number(rosterData.examConfig.maxMarks)
    : (rosterData.summary && rosterData.summary.maxMarks !== null && rosterData.summary.maxMarks !== undefined
      ? Number(rosterData.summary.maxMarks)
      : null);
  const fullMarksLabel = maxMarks !== null ? String(maxMarks) : '—';
  const teacherName = String(rosterData.teacherName || '').trim();
  const allStudents = sortStudentsAlphabetically(Array.isArray(rosterData.students) ? rosterData.students : []);

  let passCount = 0;
  let failCount = 0;
  let absentCount = 0;
  const preparedRows = allStudents.map((stu, idx) => {
    const resolved = resolveStudentMarkStatusRow(stu, maxMarks);
    if (resolved.statusKind === 'pass') passCount += 1;
    else if (resolved.statusKind === 'fail') failCount += 1;
    if (resolved.isAbsent) absentCount += 1;
    return {
      sn: idx + 1,
      name: String(stu.name || stu.studentId || '').trim(),
      ...resolved
    };
  });

  const pageCount = Math.max(1, Math.ceil(Math.max(1, preparedRows.length) / ROWS_PER_PAGE));
  const totalSvgHeight = PAGE_HEIGHT * pageCount;
  const totalHeightMm = 210 * pageCount;

  // Column widths summing to TABLE_WIDTH = 1026
  const snColWidth = 64;
  const nameColWidth = 380;
  const marksColWidth = 140;
  const statusColWidth = 140;
  const remarkColWidth = TABLE_WIDTH - snColWidth - nameColWidth - marksColWidth - statusColWidth; // 302

  const logoDataUri = getGandakiLogoDataUri();
  const logoSize = 58;
  const logoX = (PAGE_WIDTH - logoSize) / 2;
  const logoY = 18;

  const fontStack =
    "'Inter', -apple-system, BlinkMacSystemFont, 'Noto Sans Devanagari', 'Mukta', 'Mangal', 'Kohinoor Devanagari', 'Segoe UI', Arial, sans-serif";

  const pagesSvg = [];

  for (let pIdx = 0; pIdx < pageCount; pIdx++) {
    const pageOffsetY = pIdx * PAGE_HEIGHT;
    const pageRows = preparedRows.slice(pIdx * ROWS_PER_PAGE, (pIdx + 1) * ROWS_PER_PAGE);
    const isFinalPage = pIdx === pageCount - 1;

    const headerCenterX = PAGE_WIDTH / 2;
    const titleY = logoDataUri ? 100 : 48;
    const subtitleY = logoDataUri ? 122 : 72;
    const metaBoxTop = logoDataUri ? 136 : 88;
    const metaBoxHeight = 62;
    const tableTopY = metaBoxTop + metaBoxHeight + 14; // 212 with logo
    const tableHeaderHeight = 34;
    const rowHeight = 30;

    const snX = MARGIN_X;
    const nameX = snX + snColWidth;
    const marksX = nameX + nameColWidth;
    const statusX = marksX + marksColWidth;
    const remarkX = statusX + statusColWidth;

    const renderedRowCount = Math.max(1, pageRows.length);
    const tableTotalHeight = tableHeaderHeight + renderedRowCount * rowHeight;
    const tableBottomY = tableTopY + tableTotalHeight;

    const bodyRowsSvg = [];
    if (pageRows.length === 0) {
      const rY = tableTopY + tableHeaderHeight;
      bodyRowsSvg.push(
        `<line x1="${MARGIN_X}" y1="${rY + rowHeight}" x2="${MARGIN_X + TABLE_WIDTH}" y2="${rY + rowHeight}" stroke="#000000" stroke-width="1"/>`,
        `<text x="${nameX + 12}" y="${rY + 20}" class="td-name">No students enrolled</text>`
      );
    } else {
      for (let rIdx = 0; rIdx < pageRows.length; rIdx++) {
        const row = pageRows[rIdx];
        const rY = tableTopY + tableHeaderHeight + rIdx * rowHeight;
        const baselineY = rY + 20;

        if (rIdx % 2 === 1) {
          bodyRowsSvg.push(
            `<rect x="${MARGIN_X}" y="${rY}" width="${TABLE_WIDTH}" height="${rowHeight}" fill="#fafafa"/>`
          );
        }

        bodyRowsSvg.push(
          `<line x1="${MARGIN_X}" y1="${rY + rowHeight}" x2="${MARGIN_X + TABLE_WIDTH}" y2="${rY + rowHeight}" stroke="#000000" stroke-width="0.8"/>`,
          `<text x="${(snX + snColWidth / 2).toFixed(2)}" y="${baselineY}" class="td-sn" text-anchor="middle">${row.sn}</text>`,
          `<text x="${(nameX + 12).toFixed(2)}" y="${baselineY}" class="td-name" text-anchor="start">${escapeMarksSvgXml(row.name)}</text>`,
          `<text x="${(marksX + marksColWidth / 2).toFixed(2)}" y="${baselineY}" class="${row.marksDisplay === '-' ? 'td-dash' : 'td-marks'}" text-anchor="middle">${escapeMarksSvgXml(row.marksDisplay)}</text>`,
          `<text x="${(statusX + statusColWidth / 2).toFixed(2)}" y="${baselineY}" class="${row.statusDisplay === '-' ? 'td-dash' : 'td-status'}" text-anchor="middle">${escapeMarksSvgXml(row.statusDisplay)}</text>`
        );
      }
    }

    const colLines = [snX, nameX, marksX, statusX, remarkX, MARGIN_X + TABLE_WIDTH]
      .map((x, idx, arr) => {
        const sw = idx === 0 || idx === arr.length - 1 ? '1.2' : '0.9';
        return `<line x1="${x}" y1="${tableTopY}" x2="${x}" y2="${tableBottomY}" stroke="#000000" stroke-width="${sw}"/>`;
      })
      .join('\n        ');

    let footerSvg = '';
    if (isFinalPage) {
      const summaryY = tableBottomY + 28;
      const sigTopY = Math.min(PAGE_HEIGHT - 84, Math.max(summaryY + 34, PAGE_HEIGHT - 96));
      const sigRow2Y = sigTopY + 30;
      const sigRow3Y = sigTopY + 60;
      const leftColX = MARGIN_X + 8;
      const rightColX = MARGIN_X + 600;

      footerSvg = `
        <text x="${MARGIN_X + 8}" y="${summaryY}" class="summary-text">Total Students: ${preparedRows.length}   |   Pass: ${passCount}   |   Fail: ${failCount}   |   Absent: ${absentCount}</text>
        <g class="svg-signature-section" data-section="signatures">
          <text x="${leftColX}" y="${sigTopY}" class="sig-text">Prepared by / Subject Teacher: ____________________</text>
          <text x="${leftColX}" y="${sigRow2Y}" class="sig-text">Signature: ____________________</text>
          <text x="${leftColX}" y="${sigRow3Y}" class="sig-text">Date: ____________________</text>
          <text x="${rightColX}" y="${sigTopY}" class="sig-text">Verified by: ____________________</text>
          <text x="${rightColX}" y="${sigRow2Y}" class="sig-text">Signature: ____________________</text>
        </g>
      `;
    }

    const pageIndicatorSvg =
      pageCount > 1
        ? `<text x="${MARGIN_X + TABLE_WIDTH}" y="${titleY}" class="page-num-text" text-anchor="end">Page ${pIdx + 1} of ${pageCount}</text>`
        : '';

    const logoSvg = logoDataUri
      ? `<image href="${logoDataUri}" x="${logoX.toFixed(2)}" y="${logoY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>`
      : '';

    pagesSvg.push(`
      <g class="svg-print-page" data-page="${pIdx + 1}" transform="translate(0, ${pageOffsetY})">
        <rect x="0" y="0" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="#ffffff"/>
        ${
          pIdx > 0
            ? `<line x1="0" y1="0" x2="${PAGE_WIDTH}" y2="0" stroke="#000000" stroke-width="1" stroke-dasharray="6,6"/>`
            : ''
        }

        <!-- Official Gandaki University Emblem & Title -->
        ${logoSvg}
        <text x="${headerCenterX}" y="${titleY}" class="uni-title" text-anchor="middle">Gandaki University</text>
        <text x="${headerCenterX}" y="${subtitleY}" class="sheet-title" text-anchor="middle">EXAMINATION MARKS SHEET</text>
        ${pageIndicatorSvg}

        <!-- Metadata Header Box (2 clean rows) -->
        <rect x="${MARGIN_X}" y="${metaBoxTop}" width="${TABLE_WIDTH}" height="${metaBoxHeight}" fill="#fafafa" stroke="#000000" stroke-width="1.2"/>
        <line x1="${MARGIN_X}" y1="${metaBoxTop + 31}" x2="${MARGIN_X + TABLE_WIDTH}" y2="${metaBoxTop + 31}" stroke="#000000" stroke-width="0.8"/>
        <text x="${MARGIN_X + 16}" y="${metaBoxTop + 21}" class="meta-text"><tspan class="meta-label">Subject:</tspan> ${escapeMarksSvgXml(subjectLabel)}</text>
        <text x="${MARGIN_X + 700}" y="${metaBoxTop + 21}" class="meta-text"><tspan class="meta-label">Semester:</tspan> ${escapeMarksSvgXml(semesterLabel)}</text>
        <text x="${MARGIN_X + 16}" y="${metaBoxTop + 52}" class="meta-text"><tspan class="meta-label">Exam:</tspan> ${escapeMarksSvgXml(examType)}</text>
        <text x="${MARGIN_X + 390}" y="${metaBoxTop + 52}" class="meta-text"><tspan class="meta-label">Full Marks:</tspan> ${escapeMarksSvgXml(fullMarksLabel)}</text>
        <text x="${MARGIN_X + 700}" y="${metaBoxTop + 52}" class="meta-text"><tspan class="meta-label">Teacher:</tspan> ${escapeMarksSvgXml(teacherName)}</text>

        <!-- Marks Table -->
        <rect x="${MARGIN_X}" y="${tableTopY}" width="${TABLE_WIDTH}" height="${tableTotalHeight}" fill="#ffffff" stroke="#000000" stroke-width="1.2"/>
        <rect x="${MARGIN_X}" y="${tableTopY}" width="${TABLE_WIDTH}" height="${tableHeaderHeight}" fill="#f4f4f5" stroke="#000000" stroke-width="1.2"/>

        <text x="${(snX + snColWidth / 2).toFixed(2)}" y="${tableTopY + 22}" class="th-text" text-anchor="middle">S.N.</text>
        <text x="${(nameX + 12).toFixed(2)}" y="${tableTopY + 22}" class="th-text" text-anchor="start">Student Name</text>
        <text x="${(marksX + marksColWidth / 2).toFixed(2)}" y="${tableTopY + 22}" class="th-text" text-anchor="middle">Marks</text>
        <text x="${(statusX + statusColWidth / 2).toFixed(2)}" y="${tableTopY + 22}" class="th-text" text-anchor="middle">Status</text>
        <text x="${(remarkX + remarkColWidth / 2).toFixed(2)}" y="${tableTopY + 22}" class="th-text" text-anchor="middle">Remark</text>

        ${bodyRowsSvg.join('\n        ')}
        ${colLines}

        ${footerSvg}
      </g>
    `);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="${totalHeightMm}mm" viewBox="0 0 ${PAGE_WIDTH} ${totalSvgHeight}" role="img" aria-label="Gandaki University Marks Sheet — ${escapeMarksSvgXml(subjectLabel)} (${escapeMarksSvgXml(examType)})">`,
    '  <style>',
    `    text { font-family: ${fontStack}; fill: #000000; }`,
    '    .uni-title { font-size: 22px; font-weight: 800; letter-spacing: 0.02em; }',
    '    .sheet-title { font-size: 13.5px; font-weight: 700; letter-spacing: 0.1em; }',
    '    .page-num-text { font-size: 11px; font-weight: 600; }',
    '    .meta-text { font-size: 13px; font-weight: 500; }',
    '    .meta-label { font-weight: 700; }',
    '    .th-text { font-size: 13px; font-weight: 700; }',
    '    .td-sn { font-size: 13px; font-weight: 400; }',
    '    .td-name { font-size: 13px; font-weight: 500; }',
    '    .td-marks { font-size: 13px; font-weight: 400; }',
    '    .td-status { font-size: 13px; font-weight: 400; }',
    '    .td-dash { font-size: 13px; font-weight: 400; fill: #666666; }',
    '    .summary-text { font-size: 13px; font-weight: 600; }',
    '    .sig-text { font-size: 12.5px; font-weight: 600; }',
    '  </style>',
    ...pagesSvg,
    '</svg>',
    ''
  ].join('\n');
}

const BS_REPORT_MONTHS = [
  'Baishakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'
];

function formatCurrentBsDateLabel(referenceDate = new Date()) {
  try {
    const adStr = formatNepalDate(referenceDate);
    const bsStr = adToBs(adStr);
    if (bsStr && /^\d{4}-\d{2}-\d{2}$/.test(bsStr)) {
      const [y, m, d] = bsStr.split('-').map(Number);
      const monthName = BS_REPORT_MONTHS[m - 1] || String(m);
      return `${d} ${monthName} ${y} BS`;
    }
    return adStr;
  } catch (_) {
    return '';
  }
}

/**
 * 10. Retrieves the whole-semester marks report across all subjects in a semester for a selected exam.
 * Allowed: teacher (assigned to at least one subject in that semester) and admin.
 */
async function getSemesterMarksReport(db, {
  actorUserId,
  semester,
  examType = null,
  cohortId = null
}) {
  return await withMarksSchemaGuard(db, async () => {
    const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
    const semesterNo = parseSemesterNumber(semester);
    if (!semesterNo) {
      throw createHttpError(400, 'A valid semester (1 to 8) is required.', 'INVALID_SEMESTER');
    }
    const normalizedExamType = normalizeExamType(examType, { required: false }) || 'Mid-Term Exam';

    if (actor.role === 'teacher') {
      const assigned = await getTeacherSubjects(db, actor.studentId);
      const teachesSemester = (assigned || []).some((s) => Number(s.semester) === Number(semesterNo));
      if (!teachesSemester) {
        throw createHttpError(
          403,
          `You are not authorized to generate the Semester ${semesterNo} marks report.`,
          'UNAUTHORIZED_SEMESTER'
        );
      }
    }

    const activeCheck = db.isPostgres ? '(active = TRUE OR active IS NULL)' : '(active = 1 OR active IS NULL)';
    const [subjectRows, enrollment, configRows, markRows] = await Promise.all([
      db.all(
        `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature
         FROM subjects
         WHERE semester = ? AND ${activeCheck}
         ORDER BY code ASC`,
        semesterNo
      ).then((r) => r || []),
      queryEnrolledStudentsForSubject(db, { subject: { semester: semesterNo, code: `SEM${semesterNo}` }, cohortId }),
      db.all(
        `SELECT * FROM exam_configurations
         WHERE semester_no = ? AND exam_type = ?`,
        semesterNo,
        normalizedExamType
      ).then((r) => r || []),
      db.all(
        `SELECT * FROM student_marks
         WHERE semester_no = ? AND exam_type = ?`,
        semesterNo,
        normalizedExamType
      ).then((r) => r || [])
    ]);

    const subjects = subjectRows.map((r) => ({
      id: r.id,
      code: r.code || r.id,
      name: r.name,
      semester: Number(r.semester),
      department: r.department || 'BIT'
    }));

    const maxMarksBySubjectKey = new Map();
    for (const cfg of configRows) {
      const sId = String(cfg.subjectId || cfg.subject_id || '').trim().toLowerCase();
      const mx = Number(cfg.maxMarks ?? cfg.max_marks);
      if (sId && Number.isFinite(mx) && mx > 0) {
        maxMarksBySubjectKey.set(sId, mx);
      }
    }

    // Index student_marks by studentId -> subjectKey
    const marksByStudent = new Map();
    for (const row of markRows) {
      const stuId = String(row.studentId || row.student_id || '').trim();
      const subjKey = String(row.subjectId || row.subject_id || '').trim().toLowerCase();
      if (!stuId || !subjKey) continue;
      if (!marksByStudent.has(stuId)) marksByStudent.set(stuId, new Map());
      marksByStudent.get(stuId).set(subjKey, row);
    }

    const rows = enrollment.students.map((stu) => {
      const stuMarksMap = marksByStudent.get(stu.studentId) || new Map();
      let totalObtained = 0;
      let totalMax = 0;
      let enteredSubjectCount = 0;
      let allEnteredPassed = true;

      const subjectMarks = subjects.map((sub) => {
        const keyId = String(sub.id || '').trim().toLowerCase();
        const keyCode = String(sub.code || '').trim().toLowerCase();
        const row = stuMarksMap.get(keyId) || stuMarksMap.get(keyCode) || null;
        const cfgMax = maxMarksBySubjectKey.get(keyId) || maxMarksBySubjectKey.get(keyCode) || null;
        const isAbsent = Boolean(row && (row.isAbsent || row.is_absent));
        const rawObt = row ? (row.obtainedMarks ?? row.obtained_marks) : null;
        const hasObtained = !isAbsent && rawObt !== null && rawObt !== undefined && String(rawObt).trim() !== '';
        const effectiveMax = row && Number(row.maxMarks ?? row.max_marks) > 0
          ? Number(row.maxMarks ?? row.max_marks)
          : cfgMax;

        if (isAbsent) {
          enteredSubjectCount += 1;
          allEnteredPassed = false;
          if (effectiveMax && effectiveMax > 0) totalMax += effectiveMax;
          return {
            subjectId: sub.id,
            subjectCode: sub.code,
            display: 'ABS',
            isAbsent: true,
            obtainedMarks: null,
            maxMarks: effectiveMax
          };
        }

        if (!hasObtained) {
          return {
            subjectId: sub.id,
            subjectCode: sub.code,
            display: '-',
            isAbsent: false,
            obtainedMarks: null,
            maxMarks: effectiveMax
          };
        }

        const obtained = Number(rawObt);
        enteredSubjectCount += 1;
        if (effectiveMax && effectiveMax > 0) {
          totalObtained += obtained;
          totalMax += effectiveMax;
          const pct = calculateExamPercentage(obtained, effectiveMax);
          if (pct !== null && pct < 45) {
            allEnteredPassed = false;
          }
        }

        return {
          subjectId: sub.id,
          subjectCode: sub.code,
          display: String(obtained),
          isAbsent: false,
          obtainedMarks: obtained,
          maxMarks: effectiveMax
        };
      });

      const percentage = totalMax > 0 ? Math.round(((totalObtained / totalMax) * 100) * 100) / 100 : null;
      const formattedPercentage = percentage !== null ? `${percentage.toFixed(1)}%` : '-';
      const eligibleForRank = enteredSubjectCount > 0 && percentage !== null && allEnteredPassed;

      return {
        studentId: stu.studentId,
        rollNumber: stu.rollNumber || stu.studentId,
        name: stu.name,
        subjectMarks,
        totalObtained: Math.round(totalObtained * 100) / 100,
        totalMax: Math.round(totalMax * 100) / 100,
        percentage,
        formattedPercentage,
        eligibleForRank,
        rank: null,
        rankDisplay: '-',
        remarks: ''
      };
    });

    // Compute standard competition rank (1, 2, 2, 4...) among students who passed all entered subjects
    const rankedPool = rows
      .filter((r) => r.eligibleForRank)
      .sort((a, b) => Number(b.percentage) - Number(a.percentage));
    let lastPct = null;
    let currentRank = 0;
    rankedPool.forEach((r, idx) => {
      if (lastPct === null || Number(r.percentage) < lastPct) {
        currentRank = idx + 1;
        lastPct = Number(r.percentage);
      }
      r.rank = currentRank;
      r.rankDisplay = String(currentRank);
    });

    return {
      semesterNo,
      semesterLabel: `Semester ${semesterNo}`,
      examType: normalizedExamType,
      faculty: 'Science and Technology',
      program: 'Bachelor of Information Technology',
      cohort: enrollment.cohort,
      issuedBy: actor.name || actor.studentId,
      dateBs: formatCurrentBsDateLabel(new Date()),
      subjects,
      students: rows
    };
  });
}

function wrapSvgHeaderLines(text, maxCharsPerLine, maxLines = 3) {
  const clean = String(text || '').trim();
  if (!clean) return [''];
  const words = clean.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + ' ' + word).length <= maxCharsPerLine) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) {
        break;
      }
    }
  }
  if (current) {
    const remainingStartIdx = lines.join(' ').split(/\s+/).filter(Boolean).length;
    const tail = lines.length === maxLines - 1 ? words.slice(remainingStartIdx).join(' ') : current;
    const finalLine = tail.length > maxCharsPerLine + 3 ? tail.slice(0, maxCharsPerLine + 1) + '…' : tail;
    lines.push(finalLine);
  }
  return lines.slice(0, maxLines);
}

/**
 * Generates a standalone, printable A4 Landscape SVG Whole-Semester Marks Report
 * modeled after the official Gandaki University BIT result ledger layout.
 *
 * Columns: S.N. | Student Name | <All Semester Subjects> | Percentage | Rank | Remarks
 */
function exportSemesterMarksReportSvg(reportData = {}) {
  const PAGE_WIDTH = 1122;
  const PAGE_HEIGHT = 794;
  const MARGIN_X = 28;
  const TABLE_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 1066
  const ROWS_PER_PAGE = 25;

  const semesterNo = reportData.semesterNo || '';
  const semesterLabel = String(reportData.semesterLabel || (semesterNo ? `Semester ${semesterNo}` : '')).trim();
  const examType = String(reportData.examType || 'Mid-Term Exam').trim();
  const faculty = String(reportData.faculty || 'Science and Technology').trim();
  const program = String(reportData.program || 'Bachelor of Information Technology').trim();
  const issuedBy = String(reportData.issuedBy || '').trim();
  const dateBs = String(reportData.dateBs || formatCurrentBsDateLabel(new Date())).trim();
  const cohortName = reportData.cohort && reportData.cohort.displayName ? reportData.cohort.displayName : '';
  const batchYear = reportData.cohort && reportData.cohort.intakeYear ? String(reportData.cohort.intakeYear) : '';

  const subjects = Array.isArray(reportData.subjects) ? reportData.subjects : [];
  const students = Array.isArray(reportData.students) ? reportData.students : [];

  const pageCount = Math.max(1, Math.ceil(Math.max(1, students.length) / ROWS_PER_PAGE));
  const totalSvgHeight = PAGE_HEIGHT * pageCount;
  const totalHeightMm = 210 * pageCount;

  // Column widths summing to TABLE_WIDTH = 1066
  const snColWidth = 36;
  const nameColWidth = 168;
  const pctColWidth = 68;
  const rankColWidth = 44;
  const remarksColWidth = 90;
  const subjCount = Math.max(1, subjects.length);
  const subjAreaWidth = TABLE_WIDTH - snColWidth - nameColWidth - pctColWidth - rankColWidth - remarksColWidth; // 660
  const subjColWidth = subjAreaWidth / subjCount;
  const maxHeaderChars = Math.max(8, Math.floor(subjColWidth / 5.4));

  const logoDataUri = getGandakiLogoDataUri();
  const fontStack =
    "'Inter', -apple-system, BlinkMacSystemFont, 'Noto Sans Devanagari', 'Mukta', 'Mangal', 'Kohinoor Devanagari', 'Segoe UI', Arial, sans-serif";

  const pagesSvg = [];

  for (let pIdx = 0; pIdx < pageCount; pIdx++) {
    const pageOffsetY = pIdx * PAGE_HEIGHT;
    const pageRows = students.slice(pIdx * ROWS_PER_PAGE, (pIdx + 1) * ROWS_PER_PAGE);
    const isFirstPage = pIdx === 0;
    const isFinalPage = pIdx === pageCount - 1;

    const tableTopY = isFirstPage ? 156 : 36;
    const tableHeaderHeight = 42;
    const rowHeight = 22;

    const snX = MARGIN_X;
    const nameX = snX + snColWidth;
    const firstSubjX = nameX + nameColWidth;
    const pctX = firstSubjX + subjAreaWidth;
    const rankX = pctX + pctColWidth;
    const remarksX = rankX + rankColWidth;

    const renderedRowCount = Math.max(1, pageRows.length);
    const tableTotalHeight = tableHeaderHeight + renderedRowCount * rowHeight;
    const tableBottomY = tableTopY + tableTotalHeight;

    // Subject header cells (multi-line centered wrap matching BIT-I PDF)
    const subjectHeadersSvg = subjects.map((sub, sIdx) => {
      const cx = firstSubjX + sIdx * subjColWidth + subjColWidth / 2;
      const lines = wrapSvgHeaderLines(sub.name || sub.code, maxHeaderChars, 3);
      const lineHeight = 10.5;
      const startY = tableTopY + tableHeaderHeight / 2 - ((lines.length - 1) * lineHeight) / 2 + 3.5;
      const tspans = lines
        .map((ln, lIdx) => `<tspan x="${cx.toFixed(2)}" y="${(startY + lIdx * lineHeight).toFixed(2)}">${escapeMarksSvgXml(ln)}</tspan>`)
        .join('');
      return `<text class="th-subj" text-anchor="middle">${tspans}</text>`;
    });

    // Body rows
    const bodyRowsSvg = [];
    if (pageRows.length === 0) {
      const rY = tableTopY + tableHeaderHeight;
      bodyRowsSvg.push(
        `<line x1="${MARGIN_X}" y1="${rY + rowHeight}" x2="${MARGIN_X + TABLE_WIDTH}" y2="${rY + rowHeight}" stroke="#000000" stroke-width="0.75"/>`,
        `<text x="${nameX + 8}" y="${rY + 15}" class="td-name">No students enrolled</text>`
      );
    } else {
      for (let rIdx = 0; rIdx < pageRows.length; rIdx++) {
        const stu = pageRows[rIdx];
        const globalSn = pIdx * ROWS_PER_PAGE + rIdx + 1;
        const rY = tableTopY + tableHeaderHeight + rIdx * rowHeight;
        const baselineY = rY + 15;

        bodyRowsSvg.push(
          `<line x1="${MARGIN_X}" y1="${rY + rowHeight}" x2="${MARGIN_X + TABLE_WIDTH}" y2="${rY + rowHeight}" stroke="#000000" stroke-width="0.7"/>`,
          `<text x="${(snX + snColWidth / 2).toFixed(2)}" y="${baselineY}" class="td-cell" text-anchor="middle">${globalSn}.</text>`,
          `<text x="${(nameX + 6).toFixed(2)}" y="${baselineY}" class="td-name" text-anchor="start">${escapeMarksSvgXml(stu.name)}</text>`
        );

        const marksList = Array.isArray(stu.subjectMarks) ? stu.subjectMarks : [];
        subjects.forEach((_, sIdx) => {
          const cellX = firstSubjX + sIdx * subjColWidth + subjColWidth / 2;
          const cell = marksList[sIdx];
          const val = cell && cell.display !== undefined ? String(cell.display) : '-';
          bodyRowsSvg.push(
            `<text x="${cellX.toFixed(2)}" y="${baselineY}" class="td-cell" text-anchor="middle">${escapeMarksSvgXml(val)}</text>`
          );
        });

        bodyRowsSvg.push(
          `<text x="${(pctX + pctColWidth / 2).toFixed(2)}" y="${baselineY}" class="td-cell" text-anchor="middle">${escapeMarksSvgXml(stu.formattedPercentage || '-')}</text>`,
          `<text x="${(rankX + rankColWidth / 2).toFixed(2)}" y="${baselineY}" class="td-cell" text-anchor="middle">${escapeMarksSvgXml(stu.rankDisplay || '-')}</text>`,
          `<text x="${(remarksX + 6).toFixed(2)}" y="${baselineY}" class="td-cell" text-anchor="start">${escapeMarksSvgXml(stu.remarks || '')}</text>`
        );
      }
    }

    // Vertical gridlines
    const verticalXs = [snX, nameX, firstSubjX];
    for (let sIdx = 1; sIdx < subjCount; sIdx++) {
      verticalXs.push(firstSubjX + sIdx * subjColWidth);
    }
    verticalXs.push(pctX, rankX, remarksX, MARGIN_X + TABLE_WIDTH);
    const colLines = verticalXs
      .map((x, idx, arr) => {
        const sw = idx === 0 || idx === arr.length - 1 ? '1' : '0.7';
        return `<line x1="${x.toFixed(2)}" y1="${tableTopY}" x2="${x.toFixed(2)}" y2="${tableBottomY}" stroke="#000000" stroke-width="${sw}"/>`;
      })
      .join('\n        ');

    // Watermark centered behind the table (like BIT-I 2.pdf)
    const wmSize = 210;
    const wmX = (PAGE_WIDTH - wmSize) / 2;
    const wmY = tableTopY + Math.max(50, Math.min(240, (tableTotalHeight - wmSize) / 2));
    const watermarkSvg = logoDataUri
      ? `<image href="${logoDataUri}" x="${wmX.toFixed(2)}" y="${wmY.toFixed(2)}" width="${wmSize}" height="${wmSize}" opacity="0.08" preserveAspectRatio="xMidYMid meet"/>`
      : '';

    // Page 1 Official Header (matching BIT-I 2.pdf layout: top-left logo, centered university title, left+right metadata)
    const headerSvg = isFirstPage
      ? `
        ${logoDataUri ? `<image href="${logoDataUri}" x="${MARGIN_X + 12}" y="16" width="58" height="58" preserveAspectRatio="xMidYMid meet"/>` : ''}
        <text x="${PAGE_WIDTH / 2}" y="30" class="uni-kicker" text-anchor="middle">GANDAKI UNIVERSITY</text>
        <text x="${PAGE_WIDTH / 2}" y="50" class="uni-title" text-anchor="middle">GANDAKI UNIVERSITY</text>
        <text x="${PAGE_WIDTH / 2}" y="68" class="sheet-title" text-anchor="middle">SEMESTER MARKS REPORT</text>

        <text x="${MARGIN_X}" y="96" class="meta-text"><tspan class="meta-label">Faculty:</tspan> ${escapeMarksSvgXml(faculty)}</text>
        <text x="${MARGIN_X}" y="112" class="meta-text"><tspan class="meta-label">Program:</tspan> ${escapeMarksSvgXml(program)}</text>
        <text x="${MARGIN_X}" y="128" class="meta-text"><tspan class="meta-label">Semester:</tspan> ${escapeMarksSvgXml(semesterLabel)}${cohortName ? ` (${escapeMarksSvgXml(cohortName)})` : ''}${batchYear ? ` · Batch ${escapeMarksSvgXml(batchYear)}` : ''}</text>
        <text x="${MARGIN_X}" y="144" class="meta-text"><tspan class="meta-label">Exam Type:</tspan> ${escapeMarksSvgXml(examType)}</text>

        <text x="${MARGIN_X + TABLE_WIDTH}" y="128" class="meta-text" text-anchor="end"><tspan class="meta-label">Issued By:</tspan> ${escapeMarksSvgXml(issuedBy)}</text>
        <text x="${MARGIN_X + TABLE_WIDTH}" y="144" class="meta-text" text-anchor="end"><tspan class="meta-label">Date:</tspan> ${escapeMarksSvgXml(dateBs)}</text>
      `
      : `<text x="${MARGIN_X + TABLE_WIDTH}" y="24" class="page-num-text" text-anchor="end">Gandaki University · ${escapeMarksSvgXml(semesterLabel)} · ${escapeMarksSvgXml(examType)} · Page ${pIdx + 1} of ${pageCount}</text>`;

    // Final page signature block (matching BIT-I 2.pdf page 2)
    let footerSvg = '';
    if (isFinalPage) {
      const sigLineY = Math.min(PAGE_HEIGHT - 38, Math.max(tableBottomY + 52, PAGE_HEIGHT - 56));
      footerSvg = `
        <g class="svg-signature-section" data-section="signatures">
          <line x1="${MARGIN_X + 10}" y1="${sigLineY}" x2="${MARGIN_X + 200}" y2="${sigLineY}" stroke="#000000" stroke-width="0.9"/>
          <text x="${MARGIN_X + 105}" y="${sigLineY + 14}" class="sig-text" text-anchor="middle">Issued By (${escapeMarksSvgXml(issuedBy || 'Teacher')})</text>

          <line x1="${MARGIN_X + TABLE_WIDTH - 200}" y1="${sigLineY}" x2="${MARGIN_X + TABLE_WIDTH - 10}" y2="${sigLineY}" stroke="#000000" stroke-width="0.9"/>
          <text x="${MARGIN_X + TABLE_WIDTH - 105}" y="${sigLineY + 14}" class="sig-text" text-anchor="middle">Verified By / Controller of Examinations</text>
        </g>
      `;
    }

    pagesSvg.push(`
      <g class="svg-print-page" data-page="${pIdx + 1}" transform="translate(0, ${pageOffsetY})">
        <rect x="0" y="0" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="#ffffff"/>
        ${pIdx > 0 ? `<line x1="0" y1="0" x2="${PAGE_WIDTH}" y2="0" stroke="#000000" stroke-width="0.8" stroke-dasharray="6,6"/>` : ''}

        ${headerSvg}

        <!-- Table Outer Box & Header Fill -->
        <rect x="${MARGIN_X}" y="${tableTopY}" width="${TABLE_WIDTH}" height="${tableTotalHeight}" fill="#ffffff" stroke="#000000" stroke-width="1"/>
        <rect x="${MARGIN_X}" y="${tableTopY}" width="${TABLE_WIDTH}" height="${tableHeaderHeight}" fill="#e5e7eb" stroke="#000000" stroke-width="1"/>
        ${watermarkSvg}

        <!-- Fixed Column Headers -->
        <text x="${(snX + snColWidth / 2).toFixed(2)}" y="${tableTopY + 25}" class="th-text" text-anchor="middle">S.N.</text>
        <text x="${(nameX + nameColWidth / 2).toFixed(2)}" y="${tableTopY + 25}" class="th-text" text-anchor="middle">Student Name</text>
        ${subjectHeadersSvg.join('\n        ')}
        <text x="${(pctX + pctColWidth / 2).toFixed(2)}" y="${tableTopY + 25}" class="th-text" text-anchor="middle">Percentage</text>
        <text x="${(rankX + rankColWidth / 2).toFixed(2)}" y="${tableTopY + 25}" class="th-text" text-anchor="middle">Rank</text>
        <text x="${(remarksX + remarksColWidth / 2).toFixed(2)}" y="${tableTopY + 25}" class="th-text" text-anchor="middle">Remarks</text>

        ${bodyRowsSvg.join('\n        ')}
        ${colLines}

        ${footerSvg}
      </g>
    `);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="${totalHeightMm}mm" viewBox="0 0 ${PAGE_WIDTH} ${totalSvgHeight}" role="img" aria-label="Gandaki University Semester Marks Report — ${escapeMarksSvgXml(semesterLabel)} (${escapeMarksSvgXml(examType)})">`,
    '  <style>',
    `    text { font-family: ${fontStack}; fill: #000000; }`,
    '    .uni-kicker { font-size: 9.5px; font-weight: 500; letter-spacing: 0.08em; fill: #333333; }',
    '    .uni-title { font-size: 16.5px; font-weight: 800; letter-spacing: 0.03em; }',
    '    .sheet-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; fill: #222222; }',
    '    .page-num-text { font-size: 10px; font-weight: 600; fill: #444444; }',
    '    .meta-text { font-size: 11px; font-weight: 400; }',
    '    .meta-label { font-weight: 700; }',
    '    .th-text { font-size: 10px; font-weight: 700; }',
    '    .th-subj { font-size: 9px; font-weight: 700; }',
    '    .td-name { font-size: 10px; font-weight: 400; }',
    '    .td-cell { font-size: 10px; font-weight: 400; }',
    '    .sig-text { font-size: 10px; font-weight: 600; }',
    '  </style>',
    ...pagesSvg,
    '</svg>',
    ''
  ].join('\n');
}

const { invalidateAgentCache } = require('./kyana-agent-engine');

function wrapMarksWriteWithCacheInvalidation(fn) {
  return async function (db, ...rest) {
    try {
      return await fn(db, ...rest);
    } finally {
      try { invalidateAgentCache(db); } catch (_) {}
    }
  };
}

module.exports = {
  VALID_EXAM_TYPES,
  normalizeExamType,
  validateMaxMarks,
  validateObtainedMarks,
  calculateExamPercentage,
  formatPercentageDisplay,
  ensureMarksSchema,
  ensureMarksSchemaReady,
  getTeacherMarksContext,
  getExamConfiguration,
  upsertExamConfiguration: wrapMarksWriteWithCacheInvalidation(upsertExamConfiguration),
  getSubjectMarksRoster,
  exportSubjectMarksSvg,
  exportSubjectMarksCsv,
  getSemesterMarksReport,
  exportSemesterMarksReportSvg,
  saveStudentMarks: wrapMarksWriteWithCacheInvalidation(saveStudentMarks),
  publishSubjectResults: wrapMarksWriteWithCacheInvalidation(publishSubjectResults),
  getSubjectMarksAuditLogs,
  getStudentPublishedResults,
  generateStudentSemesterReportCard
};
