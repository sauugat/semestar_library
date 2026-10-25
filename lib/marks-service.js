'use strict';

const crypto = require('crypto');
const { getAcademicContext, parseSemesterNumber } = require('./academic-context');
const { getTeacherSubjects, validateTeacherSubjectAuthorization } = require('./teacher-service');
const { recordAdminAudit, sanitizeAuditData } = require('./audit-service');

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

function createHttpError(status, message, code = null) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  if (code) err.code = code;
  return err;
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
 */
async function ensureMarksSchema(dbOrOpts) {
  const execFn = typeof dbOrOpts?.exec === 'function' ? dbOrOpts.exec.bind(dbOrOpts) : null;
  const isPg = Boolean(dbOrOpts?.isPostgres);

  if (!execFn) {
    throw new Error('ensureMarksSchema requires a database adapter with an exec() method.');
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
      await execFn(`
        CREATE TABLE IF NOT EXISTS exam_configurations (
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
          obtained_marks NUMERIC(8, 2) CHECK (obtained_marks IS NULL OR (obtained_marks >= 0 AND obtained_marks <= max_marks)),
          max_marks NUMERIC(8, 2) NOT NULL CHECK (max_marks > 0),
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
          published_at TIMESTAMPTZ,
          published_by TEXT REFERENCES students(studentId) ON DELETE SET NULL,
          created_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          updated_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
          before_state JSONB,
          after_state JSONB,
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_marks_audit_subj_exam
          ON marks_audit_logs (subject_id, semester_no, exam_type, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_marks_audit_actor
          ON marks_audit_logs (actor_user_id, created_at DESC);
      `);
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
  });
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
 */
async function resolveAuthorizedSubject(db, actor, subjectInput, { allowArchivedForRead = false } = {}) {
  if (!subjectInput || !String(subjectInput).trim()) {
    throw createHttpError(400, 'subjectId is required.', 'MISSING_SUBJECT');
  }

  const cleanSubj = String(subjectInput).trim();

  if (actor.role === 'teacher') {
    try {
      const authSubj = await validateTeacherSubjectAuthorization(db, actor.studentId, cleanSubj);
      const subjRow = await db.get(
        `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature, active
         FROM subjects
         WHERE id = ?`,
        authSubj.subjectId
      );
      return {
        id: authSubj.subjectId,
        code: authSubj.code,
        name: authSubj.name,
        semester: Number(authSubj.semester),
        department: authSubj.department || 'BIT',
        creditHours: Number(subjRow?.creditHours ?? subjRow?.credithours ?? 3.0),
        nature: subjRow?.nature || null
      };
    } catch (authErr) {
      throw createHttpError(authErr.status || 403, authErr.message, 'UNAUTHORIZED_SUBJECT');
    }
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
 *   for that semester OR (when cohort_id is null) via their assigned semester field.
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
      `SELECT studentId, username, name, email, role, department, semester, cohort_id, avatarUrl
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

  const allCandidateRows = (await client.all(
    `SELECT s.studentId, s.username, s.name, s.email, s.role, s.department, s.semester, s.cohort_id,
            c.id AS joined_cohort_id, c.display_name AS joined_cohort_name,
            c.current_semester AS joined_cohort_semester, c.status AS joined_cohort_status
     FROM students s
     LEFT JOIN cohorts c ON c.id = s.cohort_id
     WHERE LOWER(COALESCE(s.role, 'student')) IN ('student', 'cr')
       AND LOWER(COALESCE(s.account_status, 'active')) = 'active'`
  )) || [];

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
}

/**
 * 2. Retrieves exam configuration(s) for an authorized subject.
 */
async function getExamConfiguration(db, { actorUserId, subjectId, examType = null }) {
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
}

/**
 * 4. Retrieves the enrolled students and marks register for a selected subject and exam type.
 */
async function getSubjectMarksRoster(db, {
  actorUserId,
  subjectId,
  examType = null,
  cohortId = null
}) {
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  const subject = await resolveAuthorizedSubject(db, actor, subjectId, { allowArchivedForRead: true });
  const normalizedExamType = normalizeExamType(examType, { required: false }) || 'Mid-Term Exam';

  const [enrollment, configRows, markRows] = await Promise.all([
    queryEnrolledStudentsForSubject(db, { subject, cohortId }),
    db.all(
      `SELECT * FROM exam_configurations
       WHERE subject_id = ? AND semester_no = ?`,
      subject.id,
      subject.semester
    ).then((r) => r || []),
    db.all(
      `SELECT * FROM student_marks
       WHERE subject_id = ? AND semester_no = ? AND exam_type = ?
       ORDER BY student_id ASC`,
      subject.id,
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
    const rawObtained = markRow ? (markRow.obtainedMarks ?? markRow.obtained_marks) : null;
    const hasMarks = rawObtained !== null && rawObtained !== undefined && rawObtained !== '';
    const obtainedMarks = hasMarks ? Number(rawObtained) : null;
    const effectiveMaxMarks = configuredMaxMarks !== null
      ? configuredMaxMarks
      : (markRow && (markRow.maxMarks ?? markRow.max_marks) ? Number(markRow.maxMarks ?? markRow.max_marks) : null);

    const rowStatus = markRow ? String(markRow.status || 'draft').toLowerCase() : null;
    let entryStatus = 'missing';
    if (hasMarks) {
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

    const percentage = hasMarks && effectiveMaxMarks
      ? calculateExamPercentage(obtainedMarks, effectiveMaxMarks)
      : null;

    if (percentage !== null) {
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
      obtainedMarks,
      maxMarks: effectiveMaxMarks,
      percentage,
      formattedPercentage: formatPercentageDisplay(percentage),
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

  return {
    subject,
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

    const rawObtained = item.obtainedMarks !== undefined
      ? item.obtainedMarks
      : (item.obtained_marks !== undefined ? item.obtained_marks : item.marks);

    const obtainedMarks = validateObtainedMarks(rawObtained, maxMarks, studentId);
    normalized.push({
      studentId,
      obtainedMarks
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
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  const subject = await resolveAuthorizedSubject(db, actor, subjectId);
  const normalizedExamType = normalizeExamType(examType, { required: true });
  const nowIso = new Date().toISOString();

  const runSave = async (tx) => {
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

    //Keep max_marks synced on all existing rows for this exam
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

      if (rec.obtainedMarks === null) {
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
        const nextStatus = (publish || wasPublished) ? 'published' : 'draft';
        const nextPublishedAt = nextStatus === 'published'
          ? (existingRow.publishedAt || existingRow.published_at || nowIso)
          : null;
        const nextPublishedBy = nextStatus === 'published'
          ? (existingRow.publishedBy || existingRow.published_by || actor.studentId)
          : null;

        if (wasPublished && prevObtained !== rec.obtainedMarks) {
          editedPublishedCount += 1;
          changedPublishedStudents[rec.studentId] = {
            from: prevObtained,
            to: rec.obtainedMarks
          };
        }

        await tx.run(
          `UPDATE student_marks
           SET obtained_marks = ?,
               max_marks = ?,
               cohort_id = ?,
               status = ?,
               published_at = ?,
               published_by = ?,
               updated_by = ?,
               updated_at = ?
           WHERE id = ?`,
          rec.obtainedMarks,
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
            obtained_marks, max_marks, status, published_at, published_by,
            created_by, updated_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          markId,
          rec.studentId,
          subject.id,
          subject.semester,
          studentMeta.cohortId || null,
          normalizedExamType,
          rec.obtainedMarks,
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
      // Also transition any existing draft rows with non-null obtained_marks for this subject & exam to published
      await tx.run(
        `UPDATE student_marks
         SET status = 'published',
             published_at = COALESCE(published_at, ?),
             published_by = COALESCE(published_by, ?),
             updated_by = ?,
             updated_at = ?
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ? AND obtained_marks IS NOT NULL`,
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
         WHERE subject_id = ? AND semester_no = ? AND exam_type = ? AND status = 'published' AND obtained_marks IS NOT NULL`,
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

    const auditAction = publish
      ? 'results_published'
      : (editedPublishedCount > 0 || editPublished ? 'published_marks_edited' : 'draft_saved');

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
  if (Array.isArray(records) && records.length > 0) {
    return await saveStudentMarks(db, {
      actorUserId,
      subjectId,
      examType,
      maxMarks,
      records,
      cohortId,
      publish: true,
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
       WHERE subject_id = ? AND semester_no = ? AND exam_type = ? AND obtained_marks IS NOT NULL`,
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
      const obt = Number(r.obtainedMarks ?? r.obtained_marks);
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
       WHERE subject_id = ? AND semester_no = ? AND exam_type = ? AND obtained_marks IS NOT NULL`,
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
}

/**
 * 7. Retrieves audit logs for marks changes on an authorized subject.
 */
async function getSubjectMarksAuditLogs(db, {
  actorUserId,
  subjectId,
  examType = null
}) {
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
}

/**
 * 8. Retrieves the authenticated student's own published results, organized by semester and subject.
 * Draft/unpublished marks are strictly excluded at the SQL query level.
 */
async function getStudentPublishedResults(db, { studentUserId, semesterFilter = null }) {
  const actor = await resolveAuthenticatedActor(db, studentUserId, ['student', 'cr']);
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

  // Also fetch subjects for the student's current semester (and any semester where the student has published marks)
  const semestersSet = new Set([currentSemesterNo]);
  for (const r of publishedRows) {
    semestersSet.add(Number(r.semesterNo || r.semester_no));
  }
  if (semesterFilter !== null && semesterFilter !== undefined && semesterFilter !== '') {
    const parsedFilter = parseSemesterNumber(semesterFilter);
    if (parsedFilter) semestersSet.add(parsedFilter);
  }

  const activeCheck = db.isPostgres ? '(active = TRUE OR active IS NULL)' : '(active = 1 OR active IS NULL)';
  const allSubjectsRows = (await db.all(
    `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature
     FROM subjects
     WHERE ${activeCheck}
     ORDER BY semester ASC, code ASC`
  )) || [];

  const subjectsById = new Map();
  for (const s of allSubjectsRows) {
    subjectsById.set(s.id, {
      subjectId: s.id,
      code: s.code,
      name: s.name,
      semesterNo: Number(s.semester),
      department: s.department || 'BIT',
      creditHours: Number(s.creditHours ?? s.credithours ?? 3.0),
      nature: s.nature || null
    });
  }

  // Group published exam results
  const examOrderIndex = new Map(VALID_EXAM_TYPES.map((t, idx) => [t, idx]));
  const formattedResults = [];
  const resultsBySemester = new Map();

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
    if (semesterFilter) {
      const parsedFilter = parseSemesterNumber(semesterFilter);
      if (parsedFilter && semNo !== parsedFilter) continue;
    }

    const subjId = row.subjectId || row.subject_id;
    const examType = row.examType || row.exam_type;
    const rawObtained = row.obtainedMarks ?? row.obtained_marks;
    const isMissing = rawObtained === null || rawObtained === undefined || rawObtained === '';
    const obtainedMarks = isMissing ? null : Number(rawObtained);
    const maxMarks = Number(row.maxMarks ?? row.max_marks);
    const percentage = !isMissing ? calculateExamPercentage(obtainedMarks, maxMarks) : null;
    const formattedPercentage = formatPercentageDisplay(percentage);

    const resultItem = {
      id: row.id,
      studentId: actor.studentId,
      subjectId: subjId,
      subjectCode: row.subject_code || row.subjectCode || subjId,
      subjectName: row.subject_name || row.subjectName || subjId,
      semesterNo: semNo,
      semesterLabel: `Semester ${semNo}`,
      examType,
      obtainedMarks,
      maxMarks,
      percentage,
      formattedPercentage,
      percentageAvailable: percentage !== null,
      isMissing,
      status: 'published',
      publicationStatus: 'Published',
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

  // Build semester groups sorted by semester number
  const semesters = [...resultsBySemester.keys()]
    .sort((a, b) => b - a)
    .map((semNo) => {
      const semSubjectsMap = resultsBySemester.get(semNo);
      const subjects = [...semSubjectsMap.values()].map((subj) => {
        subj.exams.sort(
          (a, b) => (examOrderIndex.get(a.examType) ?? 99) - (examOrderIndex.get(b.examType) ?? 99)
        );
        const examMap = {};
        for (const ex of subj.exams) {
          examMap[ex.examType] = ex;
        }
        return {
          ...subj,
          publishedExamsCount: subj.exams.length,
          examsByType: examMap
        };
      });

      return {
        semesterNo: semNo,
        semesterLabel: `Semester ${semNo}`,
        publishedSubjectsCount: subjects.length,
        publishedExamsCount: subjects.reduce((acc, s) => acc + s.exams.length, 0),
        subjects
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
    hasPublishedResults: formattedResults.length > 0,
    summary: {
      totalPublishedExams,
      subjectsWithResultsCount,
      semestersWithResultsCount: semesters.length,
      totalObtainedMarks: Math.round(totalObtainedMarks * 100) / 100,
      totalMaxMarks: Math.round(totalMaxMarks * 100) / 100,
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
}

module.exports = {
  VALID_EXAM_TYPES,
  normalizeExamType,
  validateMaxMarks,
  validateObtainedMarks,
  calculateExamPercentage,
  formatPercentageDisplay,
  ensureMarksSchema,
  getTeacherMarksContext,
  getExamConfiguration,
  upsertExamConfiguration,
  getSubjectMarksRoster,
  saveStudentMarks,
  publishSubjectResults,
  getSubjectMarksAuditLogs,
  getStudentPublishedResults
};
