'use strict';

const crypto = require('crypto');
const { getAcademicContext, parseSemesterNumber } = require('./academic-context');
const { getTeacherSubjects, validateTeacherSubjectAuthorization } = require('./teacher-service');
const { recordAdminAudit, sanitizeAuditData } = require('./audit-service');
const { formatNepalDate } = require('./nepali-dates');
const backupService = require('./attendance-backup-service');

const EDIT_WINDOW_HOURS = 24;
const EDIT_WINDOW_MS = EDIT_WINDOW_HOURS * 60 * 60 * 1000;
const ELIGIBILITY_THRESHOLD_KEY = 'eligibility_threshold_percent';
const VALID_ATTENDANCE_STATUSES = new Set(['present', 'absent']);
const inFlightSessionLocks = new Map();

async function withSessionLock(lockKey, fn) {
  const previous = inFlightSessionLocks.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise(resolve => {
    release = resolve;
  });
  const chain = previous.then(() => current, () => current);
  inFlightSessionLocks.set(lockKey, chain);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (inFlightSessionLocks.get(lockKey) === chain) {
      inFlightSessionLocks.delete(lockKey);
    }
  }
}

function createHttpError(status, message, code = null) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  if (code) err.code = code;
  return err;
}

/**
 * Validates that a date string is a valid calendar date in YYYY-MM-DD format
 * and is not in the future relative to Asia/Kathmandu time.
 */
function validateSessionDate(dateInput, { allowFuture = false, referenceDate = new Date() } = {}) {
  if (!dateInput || typeof dateInput !== 'string') {
    throw createHttpError(400, 'sessionDate is required in YYYY-MM-DD format.', 'INVALID_DATE');
  }

  const clean = dateInput.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw createHttpError(400, 'Invalid sessionDate format. Expected YYYY-MM-DD.', 'INVALID_DATE');
  }

  const [yearStr, monthStr, dayStr] = clean.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const parsedUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsedUtc.getTime()) ||
    parsedUtc.getUTCFullYear() !== year ||
    parsedUtc.getUTCMonth() + 1 !== month ||
    parsedUtc.getUTCDate() !== day
  ) {
    throw createHttpError(400, `Invalid calendar date "${clean}".`, 'INVALID_DATE');
  }

  if (!allowFuture) {
    const todayNepal = formatNepalDate(referenceDate);
    if (clean > todayNepal) {
      throw createHttpError(
        400,
        `Cannot record attendance for a future date (${clean}). Current Nepal date is ${todayNepal}.`,
        'FUTURE_DATE_NOT_ALLOWED'
      );
    }
  }

  return clean;
}

/**
 * Idempotently initializes the attendance schema for both PostgreSQL and SQLite/libSQL.
 */
async function ensureAttendanceSchema(dbOrOpts) {
  const execFn = typeof dbOrOpts?.exec === 'function' ? dbOrOpts.exec.bind(dbOrOpts) : null;
  const isPg = Boolean(dbOrOpts?.isPostgres);

  if (!execFn) {
    throw new Error('ensureAttendanceSchema requires a database adapter with an exec() method.');
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
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
        cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE RESTRICT,
        semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
        teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
        recorded_by_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
        session_date TEXT NOT NULL CHECK (session_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
        status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'locked')),
        latest_revision_no INTEGER NOT NULL DEFAULT 1,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (cohort_id, subject_id, session_date)
      );

      ALTER TABLE attendance_sessions
        ADD COLUMN IF NOT EXISTS latest_revision_no INTEGER NOT NULL DEFAULT 1;

      CREATE INDEX IF NOT EXISTS idx_attendance_sessions_cohort_sem_subj
        ON attendance_sessions (cohort_id, semester_no, subject_id, session_date DESC);

      CREATE INDEX IF NOT EXISTS idx_attendance_sessions_teacher_date
        ON attendance_sessions (teacher_id, session_date DESC);

      CREATE TABLE IF NOT EXISTS attendance_records (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
        student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
        marked_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (session_id, student_id)
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_records_session
        ON attendance_records (session_id);

      CREATE INDEX IF NOT EXISTS idx_attendance_records_student_session
        ON attendance_records (student_id, session_id);

      CREATE TABLE IF NOT EXISTS attendance_audit_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
        action TEXT NOT NULL CHECK (action IN ('session_created', 'teacher_edit', 'admin_correction', 'session_locked')),
        actor_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
        actor_role TEXT NOT NULL,
        reason TEXT,
        before_state JSONB,
        after_state JSONB,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_audit_session
        ON attendance_audit_logs (session_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_attendance_audit_actor
        ON attendance_audit_logs (actor_user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS attendance_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_by TEXT REFERENCES students(studentId) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS teacher_drive_connections (
        teacher_id TEXT PRIMARY KEY REFERENCES teachers(id) ON DELETE RESTRICT,
        user_id TEXT NOT NULL UNIQUE REFERENCES students(studentId) ON DELETE RESTRICT,
        google_email TEXT,
        root_folder_id TEXT,
        root_folder_name TEXT DEFAULT 'Semester Library Attendance Backups',
        daily_folder_id TEXT,
        full_folder_id TEXT,
        snapshots_folder_id TEXT,
        connection_status TEXT NOT NULL DEFAULT 'disconnected'
          CHECK (connection_status IN ('disconnected', 'connected', 'reconnect_required')),
        last_synced_at TIMESTAMPTZ,
        last_error_code TEXT,
        last_error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE teacher_drive_connections
        ADD COLUMN IF NOT EXISTS root_folder_name TEXT DEFAULT 'Semester Library Attendance Backups';

      CREATE INDEX IF NOT EXISTS idx_teacher_drive_connections_user
        ON teacher_drive_connections (user_id);

      CREATE INDEX IF NOT EXISTS idx_teacher_drive_connections_status
        ON teacher_drive_connections (connection_status);

      CREATE TABLE IF NOT EXISTS attendance_backup_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
        teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
        revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
        audit_log_id TEXT NOT NULL UNIQUE REFERENCES attendance_audit_logs(id) ON DELETE RESTRICT,
        action TEXT NOT NULL CHECK (action IN ('session_created', 'teacher_edit', 'admin_correction')),
        previous_snapshot_sha256 TEXT,
        snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
        snapshot_payload JSONB NOT NULL,
        backup_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (backup_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required')),
        snapshot_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (snapshot_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
        daily_workbook_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (daily_workbook_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
        annual_workbook_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (annual_workbook_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
        snapshot_drive_file_id TEXT,
        daily_drive_file_id TEXT,
        annual_drive_file_id TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        last_error_code TEXT,
        last_error_message TEXT,
        claimed_by_client_id TEXT,
        lease_expires_at TIMESTAMPTZ,
        last_attempt_at TIMESTAMPTZ,
        next_retry_at TIMESTAMPTZ,
        backed_up_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (session_id, revision_no),
        UNIQUE (session_id, snapshot_sha256)
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_backup_runs_teacher_status
        ON attendance_backup_runs (teacher_id, backup_status, created_at ASC);

      CREATE INDEX IF NOT EXISTS idx_attendance_backup_runs_session_rev
        ON attendance_backup_runs (session_id, revision_no DESC);

      CREATE TABLE IF NOT EXISTS attendance_backup_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES attendance_backup_runs(id) ON DELETE RESTRICT,
        session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
        teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
        revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
        artifact_type TEXT NOT NULL CHECK (artifact_type IN ('snapshot', 'daily_workbook', 'annual_workbook')),
        target_scope_key TEXT NOT NULL,
        snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
        artifact_sha256 TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
        drive_file_id TEXT,
        drive_file_name TEXT,
        mime_type TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
        claim_token TEXT,
        claimed_by_client_id TEXT,
        claimed_at TIMESTAMPTZ,
        lease_expires_at TIMESTAMPTZ,
        last_attempt_at TIMESTAMPTZ,
        next_retry_at TIMESTAMPTZ,
        last_error_code TEXT,
        last_error_message TEXT,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (run_id, artifact_type)
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_backup_artifacts_run
        ON attendance_backup_artifacts (run_id);

      CREATE INDEX IF NOT EXISTS idx_attendance_backup_artifacts_teacher_status
        ON attendance_backup_artifacts (teacher_id, status, next_retry_at);

      CREATE INDEX IF NOT EXISTS idx_attendance_backup_artifacts_session_type
        ON attendance_backup_artifacts (session_id, artifact_type, revision_no DESC);
    `);
  } else {
    await execFn(`
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
        cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE RESTRICT,
        semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
        teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
        recorded_by_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
        session_date TEXT NOT NULL CHECK (
          length(session_date) = 10
          AND substr(session_date, 5, 1) = '-'
          AND substr(session_date, 8, 1) = '-'
        ),
        status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'locked')),
        latest_revision_no INTEGER NOT NULL DEFAULT 1,
        submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (cohort_id, subject_id, session_date)
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_sessions_cohort_sem_subj
        ON attendance_sessions (cohort_id, semester_no, subject_id, session_date DESC);

      CREATE INDEX IF NOT EXISTS idx_attendance_sessions_teacher_date
        ON attendance_sessions (teacher_id, session_date DESC);

      CREATE TABLE IF NOT EXISTS attendance_records (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
        student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
        marked_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (session_id, student_id)
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_records_session
        ON attendance_records (session_id);

      CREATE INDEX IF NOT EXISTS idx_attendance_records_student_session
        ON attendance_records (student_id, session_id);

      CREATE TABLE IF NOT EXISTS attendance_audit_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
        action TEXT NOT NULL CHECK (action IN ('session_created', 'teacher_edit', 'admin_correction', 'session_locked')),
        actor_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
        actor_role TEXT NOT NULL,
        reason TEXT,
        before_state TEXT,
        after_state TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_audit_session
        ON attendance_audit_logs (session_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_attendance_audit_actor
        ON attendance_audit_logs (actor_user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS attendance_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_by TEXT REFERENCES students(studentId) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS teacher_drive_connections (
        teacher_id TEXT PRIMARY KEY REFERENCES teachers(id) ON DELETE RESTRICT,
        user_id TEXT NOT NULL UNIQUE REFERENCES students(studentId) ON DELETE RESTRICT,
        google_email TEXT,
        root_folder_id TEXT,
        root_folder_name TEXT DEFAULT 'Semester Library Attendance Backups',
        daily_folder_id TEXT,
        full_folder_id TEXT,
        snapshots_folder_id TEXT,
        connection_status TEXT NOT NULL DEFAULT 'disconnected'
          CHECK (connection_status IN ('disconnected', 'connected', 'reconnect_required')),
        last_synced_at TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_teacher_drive_connections_user
        ON teacher_drive_connections (user_id);

      CREATE INDEX IF NOT EXISTS idx_teacher_drive_connections_status
        ON teacher_drive_connections (connection_status);

      CREATE TABLE IF NOT EXISTS attendance_backup_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
        teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
        revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
        audit_log_id TEXT NOT NULL UNIQUE REFERENCES attendance_audit_logs(id) ON DELETE RESTRICT,
        action TEXT NOT NULL CHECK (action IN ('session_created', 'teacher_edit', 'admin_correction')),
        previous_snapshot_sha256 TEXT,
        snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64),
        snapshot_payload TEXT NOT NULL,
        backup_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (backup_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required')),
        snapshot_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (snapshot_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
        daily_workbook_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (daily_workbook_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
        annual_workbook_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (annual_workbook_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
        snapshot_drive_file_id TEXT,
        daily_drive_file_id TEXT,
        annual_drive_file_id TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        last_error_code TEXT,
        last_error_message TEXT,
        claimed_by_client_id TEXT,
        lease_expires_at TEXT,
        last_attempt_at TEXT,
        next_retry_at TEXT,
        backed_up_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (session_id, revision_no),
        UNIQUE (session_id, snapshot_sha256)
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_backup_runs_teacher_status
        ON attendance_backup_runs (teacher_id, backup_status, created_at ASC);

      CREATE INDEX IF NOT EXISTS idx_attendance_backup_runs_session_rev
        ON attendance_backup_runs (session_id, revision_no DESC);

      CREATE TABLE IF NOT EXISTS attendance_backup_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES attendance_backup_runs(id) ON DELETE RESTRICT,
        session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
        teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
        revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
        artifact_type TEXT NOT NULL CHECK (artifact_type IN ('snapshot', 'daily_workbook', 'annual_workbook')),
        target_scope_key TEXT NOT NULL,
        snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64),
        artifact_sha256 TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
        drive_file_id TEXT,
        drive_file_name TEXT,
        mime_type TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
        claim_token TEXT,
        claimed_by_client_id TEXT,
        claimed_at TEXT,
        lease_expires_at TEXT,
        last_attempt_at TEXT,
        next_retry_at TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (run_id, artifact_type)
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_backup_artifacts_run
        ON attendance_backup_artifacts (run_id);

      CREATE INDEX IF NOT EXISTS idx_attendance_backup_artifacts_teacher_status
        ON attendance_backup_artifacts (teacher_id, status, next_retry_at);

      CREATE INDEX IF NOT EXISTS idx_attendance_backup_artifacts_session_type
        ON attendance_backup_artifacts (session_id, artifact_type, revision_no DESC);
    `);

    try {
      await execFn('ALTER TABLE attendance_sessions ADD COLUMN latest_revision_no INTEGER NOT NULL DEFAULT 1;');
    } catch (_) {}
    try {
      await execFn("ALTER TABLE teacher_drive_connections ADD COLUMN root_folder_name TEXT DEFAULT 'Semester Library Attendance Backups';");
    } catch (_) {}
  }
  });
}

/**
 * Authoritatively resolves an authenticated user from the database.
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

  const role = String(actor.role || 'student').toLowerCase();
  if (Array.isArray(allowedRoles) && !allowedRoles.includes(role)) {
    throw createHttpError(403, 'Forbidden: You do not have permission to perform this action.', 'FORBIDDEN');
  }

  return {
    studentId: actor.studentId || actor.studentid,
    username: actor.username || null,
    name: actor.name,
    email: actor.email || null,
    role,
    department: actor.department || 'BIT',
    semester: actor.semester || null,
    cohortId: actor.cohortId || actor.cohort_id || null,
    accountStatus
  };
}

/**
 * Resolves the canonical teacher profile for a teacher or admin recording attendance.
 */
async function resolveTeacherProfileForSession(db, actor, subjectId, requestedTeacherId = null) {
  if (actor.role === 'teacher') {
    let teacher = await db.get(
      'SELECT id, user_id, status, designation FROM teachers WHERE user_id = ? OR id = ?',
      actor.studentId,
      actor.studentId
    );
    if (!teacher) {
      // Ensure anchor row exists in teachers table if legacy/fixture teacher was only in students
      await db.run(
        `INSERT INTO teachers (id, user_id, designation, status)
         VALUES (?, ?, 'Instructor', 'active')
         ON CONFLICT (id) DO NOTHING`,
        actor.studentId,
        actor.studentId
      ).catch(() => {});
      teacher = await db.get(
        'SELECT id, user_id, status, designation FROM teachers WHERE user_id = ? OR id = ?',
        actor.studentId,
        actor.studentId
      ) || { id: actor.studentId, user_id: actor.studentId, status: 'active' };
    }
    if (teacher.status !== 'active') {
      throw createHttpError(403, 'Teacher account is inactive.', 'TEACHER_INACTIVE');
    }
    return teacher;
  }

  // Admin flow: prefer explicitly passed teacherId, then subject's assigned active teacher, then admin anchor
  if (requestedTeacherId) {
    const t = await db.get(
      'SELECT id, user_id, status, designation FROM teachers WHERE id = ? OR user_id = ?',
      requestedTeacherId,
      requestedTeacherId
    );
    if (t && t.status === 'active') return t;
  }

  const assignedTeacher = await db.get(
    `SELECT t.id, t.user_id, t.status, t.designation
     FROM teacher_subjects ts
     JOIN teachers t ON t.id = ts.teacher_id
     WHERE ts.subject_id = ? AND t.status = 'active'
     ORDER BY ts.created_at ASC
     LIMIT 1`,
    subjectId
  );
  if (assignedTeacher) {
    return assignedTeacher;
  }

  let adminTeacherAnchor = await db.get(
    'SELECT id, user_id, status, designation FROM teachers WHERE user_id = ? OR id = ?',
    actor.studentId,
    actor.studentId
  );
  if (!adminTeacherAnchor) {
    await db.run(
      `INSERT INTO teachers (id, user_id, designation, status)
       VALUES (?, ?, 'Administrator', 'active')
       ON CONFLICT (id) DO NOTHING`,
      actor.studentId,
      actor.studentId
    ).catch(() => {});
    adminTeacherAnchor = { id: actor.studentId, user_id: actor.studentId, status: 'active' };
  }
  return adminTeacherAnchor;
}

/**
 * Computes edit window metadata for a session.
 */
function computeSessionEditWindow(session, referenceDate = new Date()) {
  if (!session) return null;
  const submittedAtRaw = session.submittedAt || session.submitted_at;
  const submittedAtMs = new Date(submittedAtRaw).getTime();
  const nowMs = referenceDate instanceof Date ? referenceDate.getTime() : new Date(referenceDate).getTime();
  const expiresAtMs = submittedAtMs + EDIT_WINDOW_MS;
  const elapsedMs = nowMs - submittedAtMs;
  const isLocked = session.status === 'locked';
  const isWithinWindow = !isLocked && Number.isFinite(submittedAtMs) && elapsedMs <= EDIT_WINDOW_MS;

  return {
    submittedAt: new Date(submittedAtMs).toISOString(),
    editWindowEndsAt: new Date(expiresAtMs).toISOString(),
    editWindowHours: EDIT_WINDOW_HOURS,
    isWithinEditWindow: isWithinWindow,
    canTeacherEdit: isWithinWindow,
    requiresAdminCorrection: !isWithinWindow,
    remainingMs: isWithinWindow ? Math.max(0, expiresAtMs - nowMs) : 0
  };
}

/**
 * Formats an attendance session row consistently.
 */
function formatSessionObject(row, referenceDate = new Date()) {
  if (!row) return null;
  const submittedAt = row.submittedAt || row.submitted_at;
  const createdAt = row.createdAt || row.created_at;
  const updatedAt = row.updatedAt || row.updated_at;
  const editWindow = computeSessionEditWindow({ ...row, submittedAt }, referenceDate);

  return {
    id: row.id,
    subjectId: row.subjectId || row.subject_id,
    subjectCode: row.subjectCode || row.subject_code || row.code || null,
    subjectName: row.subjectName || row.subject_name || row.name || null,
    cohortId: row.cohortId || row.cohort_id,
    cohortName: row.cohortName || row.cohort_name || row.display_name || row.displayName || null,
    slotCode: row.slotCode || row.slot_code || null,
    semesterNo: Number(row.semesterNo || row.semester_no),
    teacherId: row.teacherId || row.teacher_id,
    recordedByUserId: row.recordedByUserId || row.recorded_by_user_id,
    sessionDate: row.sessionDate || row.session_date,
    status: row.status,
    latestRevisionNo: Number(row.latestRevisionNo ?? row.latest_revision_no ?? 1),
    submittedAt,
    createdAt,
    updatedAt,
    editWindow
  };
}

/**
 * Writes an attendance audit log record within the given db/tx client.
 */
async function writeAttendanceAuditLog(client, {
  sessionId,
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
    `INSERT INTO attendance_audit_logs (
      id, session_id, action, actor_user_id, actor_role, reason,
      before_state, after_state, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    sessionId,
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
    sessionId,
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

/**
 * Deterministically serializes a JSON value with lexicographically sorted object keys,
 * explicit null handling for undefined object properties, and zero whitespace.
 */
function serializeCanonicalJson(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return 'null';
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => serializeCanonicalJson(item));
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const pairs = keys.map((k) => {
      const v = value[k] === undefined ? null : value[k];
      return `${JSON.stringify(k)}:${serializeCanonicalJson(v)}`;
    });
    return `{${pairs.join(',')}}`;
  }
  return 'null';
}

/**
 * Computes the 64-character lowercase hex SHA-256 digest of the canonical JSON bytes.
 */
function computeCanonicalSnapshotHash(canonicalPayload) {
  const canonicalBytes = Buffer.from(serializeCanonicalJson(canonicalPayload), 'utf8');
  return crypto.createHash('sha256').update(canonicalBytes).digest('hex');
}

/**
 * Builds a deterministic, privacy-scoped canonical attendance snapshot payload.
 * Excludes student email addresses, phone numbers, avatar URLs, and credentials.
 */
function buildCanonicalSnapshotPayload({
  sessionId,
  revisionNo,
  previousSnapshotSha256 = null,
  teacherId,
  subject,
  cohort,
  sessionDate,
  originalSubmittedAt,
  auditEvent,
  actor,
  recordsWithStudentMeta
}) {
  const sortedRecords = [...(recordsWithStudentMeta || [])]
    .map((r) => ({
      name: String(r.name || '').trim(),
      role: String(r.role || 'student').trim().toLowerCase(),
      status: r.status === 'present' ? 'present' : 'absent',
      studentId: String(r.studentId || '').trim(),
      username: r.username ? String(r.username).trim() : null
    }))
    .sort((a, b) => a.studentId.localeCompare(b.studentId));

  let presentCount = 0;
  let absentCount = 0;
  for (const rec of sortedRecords) {
    if (rec.status === 'present') presentCount += 1;
    else absentCount += 1;
  }

  return {
    actor: {
      role: String(actor.role || '').trim().toLowerCase(),
      userId: String(actor.userId || actor.studentId || '').trim()
    },
    auditEvent: {
      action: String(auditEvent.action || '').trim(),
      auditLogId: String(auditEvent.id || auditEvent.auditLogId || '').trim(),
      reason: auditEvent.reason !== null && auditEvent.reason !== undefined ? String(auditEvent.reason).trim() : null,
      timestamp: new Date(auditEvent.createdAt || auditEvent.timestamp).toISOString()
    },
    cohort: {
      displayName: String(cohort.displayName || '').trim(),
      id: String(cohort.id || '').trim(),
      semesterNo: Number(cohort.currentSemester ?? cohort.semesterNo),
      slotCode: cohort.slotCode ? String(cohort.slotCode).trim().toLowerCase() : null
    },
    counts: {
      absent: absentCount,
      present: presentCount,
      total: sortedRecords.length
    },
    originalSubmittedAt: new Date(originalSubmittedAt).toISOString(),
    previousSnapshotSha256: previousSnapshotSha256 ? String(previousSnapshotSha256).trim().toLowerCase() : null,
    records: sortedRecords,
    revisionNo: Number(revisionNo),
    schemaVersion: 1,
    sessionDate: String(sessionDate).trim(),
    sessionId: String(sessionId).trim(),
    subject: {
      code: String(subject.code || subject.id || '').trim(),
      department: String(subject.department || 'BIT').trim(),
      id: String(subject.id || '').trim(),
      name: String(subject.name || subject.code || '').trim(),
      semester: Number(subject.semester)
    },
    teacherId: String(teacherId).trim()
  };
}

/**
 * Formats a backup run / revision row consistently.
 */
function formatBackupRevisionRow(row) {
  if (!row) return null;
  let parsedPayload = row.snapshotPayload || row.snapshot_payload || null;
  if (typeof parsedPayload === 'string') {
    try {
      parsedPayload = JSON.parse(parsedPayload);
    } catch (_) {
      parsedPayload = null;
    }
  }
  return {
    id: row.id,
    sessionId: row.sessionId || row.session_id,
    teacherId: row.teacherId || row.teacher_id,
    revisionNo: Number(row.revisionNo || row.revision_no),
    auditLogId: row.auditLogId || row.audit_log_id,
    action: row.action,
    previousSnapshotSha256: row.previousSnapshotSha256 || row.previous_snapshot_sha256 || null,
    snapshotSha256: row.snapshotSha256 || row.snapshot_sha256,
    snapshotPayload: parsedPayload,
    backupStatus: row.backupStatus || row.backup_status || 'pending',
    snapshotStatus: row.snapshotStatus || row.snapshot_status || 'pending',
    dailyWorkbookStatus: row.dailyWorkbookStatus || row.daily_workbook_status || 'pending',
    annualWorkbookStatus: row.annualWorkbookStatus || row.annual_workbook_status || 'pending',
    snapshotDriveFileId: row.snapshotDriveFileId || row.snapshot_drive_file_id || null,
    dailyDriveFileId: row.dailyDriveFileId || row.daily_drive_file_id || null,
    annualDriveFileId: row.annualDriveFileId || row.annual_drive_file_id || null,
    attemptCount: Number(row.attemptCount ?? row.attempt_count ?? 0),
    lastErrorCode: row.lastErrorCode || row.last_error_code || null,
    lastErrorMessage: row.lastErrorMessage || row.last_error_message || null,
    claimedByClientId: row.claimedByClientId || row.claimed_by_client_id || null,
    leaseExpiresAt: row.leaseExpiresAt || row.lease_expires_at || null,
    lastAttemptAt: row.lastAttemptAt || row.last_attempt_at || null,
    nextRetryAt: row.nextRetryAt || row.next_retry_at || null,
    backedUpAt: row.backedUpAt || row.backed_up_at || null,
    createdAt: row.createdAt || row.created_at,
    updatedAt: row.updatedAt || row.updated_at
  };
}

/**
 * Transaction-safely allocates the next monotonic revision number for a session,
 * builds the canonical snapshot payload, computes its SHA-256 hash, and persists
 * the durable outbox row in attendance_backup_runs within the active transaction.
 */
async function createAttendanceBackupRevisionTx(tx, {
  sessionId,
  teacherId,
  subject,
  cohort,
  sessionDate,
  originalSubmittedAt,
  auditEntry,
  actor,
  finalRecords,
  studentMetaById,
  timestampIso
}) {
  // Lock the parent session row inside the transaction before reading the latest revision
  if (tx.isPostgres) {
    await tx.get('SELECT id, latest_revision_no FROM attendance_sessions WHERE id = ? FOR UPDATE', sessionId);
  }

  const prevRevRow = await tx.get(
    `SELECT id, revision_no, snapshot_sha256
     FROM attendance_backup_runs
     WHERE session_id = ?
     ORDER BY revision_no DESC
     LIMIT 1`,
    sessionId
  );

  const revisionNo = prevRevRow ? Number(prevRevRow.revisionNo || prevRevRow.revision_no) + 1 : 1;
  const previousSnapshotSha256 = prevRevRow
    ? (prevRevRow.snapshotSha256 || prevRevRow.snapshot_sha256 || null)
    : null;

  // Update latest_revision_no on parent attendance_sessions row atomically
  await tx.run(
    `UPDATE attendance_sessions
     SET latest_revision_no = ?, updated_at = ?
     WHERE id = ?`,
    revisionNo,
    timestampIso,
    sessionId
  );

  // Supersede any non-completed mutable workbook artifacts (daily_workbook, annual_workbook)
  // on older revisions of this session while preserving their immutable snapshot artifacts
  if (revisionNo > 1) {
    const priorRuns = (await tx.all(
      `SELECT id FROM attendance_backup_runs WHERE session_id = ? AND revision_no < ?`,
      sessionId,
      revisionNo
    )) || [];
    for (const pr of priorRuns) {
      await tx.run(
        `UPDATE attendance_backup_artifacts
         SET status = 'superseded',
             claim_token = NULL,
             claimed_by_client_id = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE run_id = ?
           AND artifact_type IN ('daily_workbook', 'annual_workbook')
           AND status NOT IN ('backed_up', 'superseded')`,
        timestampIso,
        pr.id
      );
      await backupService.syncBackupRunRollupTx(tx, pr.id, timestampIso);
    }
  }

  const recordsWithStudentMeta = finalRecords.map((rec) => {
    const sId = rec.studentId || rec.student_id;
    const meta = studentMetaById.get(sId) || {};
    return {
      studentId: sId,
      username: meta.username || null,
      name: meta.name || sId,
      role: meta.role || 'student',
      status: rec.status
    };
  });

  const canonicalPayload = buildCanonicalSnapshotPayload({
    sessionId,
    revisionNo,
    previousSnapshotSha256,
    teacherId,
    subject,
    cohort,
    sessionDate,
    originalSubmittedAt,
    auditEvent: auditEntry,
    actor,
    recordsWithStudentMeta
  });

  const canonicalJson = serializeCanonicalJson(canonicalPayload);
  const snapshotSha256 = computeCanonicalSnapshotHash(canonicalPayload);
  const backupRunId = crypto.randomUUID();

  await tx.run(
    `INSERT INTO attendance_backup_runs (
      id, session_id, teacher_id, revision_no, audit_log_id, action,
      previous_snapshot_sha256, snapshot_sha256, snapshot_payload,
      backup_status, snapshot_status, daily_workbook_status, annual_workbook_status,
      attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', 'pending', 'pending', 0, ?, ?)`,
    backupRunId,
    sessionId,
    teacherId,
    revisionNo,
    auditEntry.id,
    auditEntry.action,
    previousSnapshotSha256,
    snapshotSha256,
    canonicalJson,
    timestampIso,
    timestampIso
  );

  const artifactRows = await backupService.ensureBackupRunArtifactsTx(
    tx,
    {
      id: backupRunId,
      sessionId,
      teacherId,
      revisionNo,
      snapshotSha256,
      snapshotPayload: canonicalPayload,
      createdAt: timestampIso
    },
    {
      sessionDate,
      subjectCode: subject.code,
      slotCode: cohort.slotCode,
      cohortName: cohort.displayName,
      semesterNo: cohort.currentSemester ?? subject.semester
    }
  );

  return {
    id: backupRunId,
    sessionId,
    teacherId,
    revisionNo,
    auditLogId: auditEntry.id,
    action: auditEntry.action,
    previousSnapshotSha256,
    snapshotSha256,
    snapshotPayload: canonicalPayload,
    backupStatus: 'pending',
    snapshotStatus: 'pending',
    dailyWorkbookStatus: 'pending',
    annualWorkbookStatus: 'pending',
    attemptCount: 0,
    createdAt: timestampIso,
    updatedAt: timestampIso,
    artifacts: artifactRows.map((a) => backupService.formatArtifactRow(a, new Date(timestampIso)))
  };
}

/**
 * 9a. Reads the admin-configurable attendance eligibility threshold.
 * Returns an explicit unconfigured state when no threshold has been set.
 */
async function getEligibilityThresholdConfig(db) {
  let row = null;
  try {
    row = await db.get(
      `SELECT setting_key, setting_value, updated_by, created_at, updated_at
       FROM attendance_settings
       WHERE setting_key = ?`,
      ELIGIBILITY_THRESHOLD_KEY
    );
  } catch (_) {
    row = null;
  }

  if (!row || row.setting_value === null || row.setting_value === undefined || String(row.setting_value ?? row.settingValue ?? '').trim() === '') {
    return {
      configured: false,
      threshold: null,
      status: 'unconfigured',
      updatedBy: null,
      updatedAt: null
    };
  }

  const rawVal = Number(row.settingValue ?? row.setting_value);
  if (!Number.isFinite(rawVal) || rawVal <= 0 || rawVal > 100) {
    return {
      configured: false,
      threshold: null,
      status: 'unconfigured',
      updatedBy: null,
      updatedAt: null
    };
  }

  return {
    configured: true,
    threshold: rawVal,
    status: 'configured',
    updatedBy: row.updatedBy || row.updated_by || null,
    updatedAt: row.updatedAt || row.updated_at || null
  };
}

/**
 * 9b. Updates the admin-configurable attendance eligibility threshold.
 */
async function updateEligibilityThresholdConfig(db, { adminUserId, threshold, reason = null }) {
  const actor = await resolveAuthenticatedActor(db, adminUserId, ['admin']);

  if (threshold === null || threshold === undefined || threshold === '' || typeof threshold === 'boolean') {
    throw createHttpError(400, 'A numeric eligibility threshold between 1 and 100 is required.', 'INVALID_THRESHOLD');
  }

  const numThreshold = Number(threshold);
  if (!Number.isFinite(numThreshold) || numThreshold <= 0 || numThreshold > 100) {
    throw createHttpError(400, 'Eligibility threshold must be a number greater than 0 and at most 100.', 'INVALID_THRESHOLD');
  }

  const normalizedThreshold = Math.round(numThreshold * 100) / 100;
  const nowIso = new Date().toISOString();

  const runUpdate = async (tx) => {
    const previous = await getEligibilityThresholdConfig(tx);

    if (tx.isPostgres || db.isPostgres) {
      await tx.run(
        `INSERT INTO attendance_settings (setting_key, setting_value, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (setting_key) DO UPDATE SET
           setting_value = EXCLUDED.setting_value,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at`,
        ELIGIBILITY_THRESHOLD_KEY,
        String(normalizedThreshold),
        actor.studentId,
        nowIso,
        nowIso
      );
    } else {
      await tx.run(
        `INSERT INTO attendance_settings (setting_key, setting_value, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET
           setting_value = excluded.setting_value,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
        ELIGIBILITY_THRESHOLD_KEY,
        String(normalizedThreshold),
        actor.studentId,
        nowIso,
        nowIso
      );
    }

    await recordAdminAudit(db, {
      actorUserId: actor.studentId,
      action: 'attendance_threshold_updated',
      entityType: 'attendance_settings',
      entityId: ELIGIBILITY_THRESHOLD_KEY,
      beforeState: { threshold: previous.threshold, configured: previous.configured },
      afterState: { threshold: normalizedThreshold, configured: true },
      metadata: {
        reason: reason ? String(reason).trim() : 'Updated attendance eligibility threshold',
        threshold: normalizedThreshold
      },
      required: false,
      tx
    });

    return {
      configured: true,
      threshold: normalizedThreshold,
      status: 'configured',
      previousThreshold: previous.threshold,
      updatedBy: actor.studentId,
      updatedAt: nowIso
    };
  };

  if (typeof db.withTransaction === 'function') {
    return await db.withTransaction(runUpdate);
  }
  return await runUpdate(db);
}

/**
 * 1. Resolves a teacher's or admin's permitted attendance context.
 */
async function getTeacherAttendanceContext(db, { actorUserId }) {
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
        return rows.map(r => ({
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

  const [subjects, activeCohortsRaw, thresholdConfig] = await Promise.all([
    fetchSubjectsPromise,
    db.all(
      `SELECT id, slot_code, display_name, current_semester, intake_year, intake_identifier, status
       FROM cohorts
       WHERE status = 'active'
       ORDER BY current_semester ASC, slot_code ASC`
    ).then(r => r || []),
    getEligibilityThresholdConfig(db)
  ]);

  const activeCohorts = activeCohortsRaw.map(c => ({
    id: c.id,
    slotCode: String(c.slotCode || c.slot_code || '').toLowerCase(),
    displayName: c.displayName || c.display_name || c.slot_code,
    currentSemester: Number(c.currentSemester || c.current_semester),
    intakeYear: c.intakeYear !== undefined ? c.intakeYear : c.intake_year,
    intakeIdentifier: c.intakeIdentifier || c.intake_identifier || null,
    status: c.status
  }));

  const subjectsWithCohorts = subjects.map(sub => {
    const matchingCohorts = activeCohorts.filter(c => Number(c.currentSemester) === Number(sub.semester));
    return {
      ...sub,
      cohorts: matchingCohorts,
      hasMultipleActiveCohorts: matchingCohorts.length > 1
    };
  });

  const assignedSemesters = [...new Set(subjects.map(s => Number(s.semester)))].sort((a, b) => a - b);
  const relevantCohorts = actor.role === 'admin'
    ? activeCohorts
    : activeCohorts.filter(c => assignedSemesters.includes(Number(c.currentSemester)));

  return {
    role: actor.role,
    userId: actor.studentId,
    name: actor.name,
    currentNepalDate: formatNepalDate(new Date()),
    assignedSemesters,
    subjects: subjectsWithCohorts,
    cohorts: relevantCohorts,
    eligibilityThreshold: thresholdConfig
  };
}

/**
 * Resolves and validates subject + cohort relationship for attendance operations.
 */
async function resolveAndValidateSubjectAndCohort(db, {
  actor,
  subjectInput,
  cohortInput,
  requireActiveCohortAndSemesterMatch = true
}) {
  if (!subjectInput || !String(subjectInput).trim()) {
    throw createHttpError(400, 'subjectId is required.', 'MISSING_SUBJECT');
  }
  if (!cohortInput || !String(cohortInput).trim()) {
    throw createHttpError(400, 'cohortId is required.', 'MISSING_COHORT');
  }

  const cleanSubj = String(subjectInput).trim();
  const cleanCohort = String(cohortInput).trim();

  let authorizedSubject = null;
  if (actor.role === 'teacher') {
    try {
      authorizedSubject = await validateTeacherSubjectAuthorization(db, actor.studentId, cleanSubj);
    } catch (authErr) {
      throw createHttpError(authErr.status || 403, authErr.message, 'UNAUTHORIZED_SUBJECT');
    }
  } else {
    const subjRow = await db.get(
      `SELECT id, code, name, semester, department, active
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
    if (requireActiveCohortAndSemesterMatch && !isActive) {
      throw createHttpError(403, `Subject "${subjRow.name}" is archived and cannot accept new attendance.`, 'SUBJECT_ARCHIVED');
    }
    authorizedSubject = {
      subjectId: subjRow.id,
      code: subjRow.code,
      name: subjRow.name,
      semester: Number(subjRow.semester),
      department: subjRow.department || 'BIT'
    };
  }

  const cohortRow = await db.get(
    `SELECT id, slot_code, display_name, current_semester, intake_year, intake_identifier, status
     FROM cohorts
     WHERE id = ? OR (LOWER(slot_code) = LOWER(?) AND status = 'active')`,
    cleanCohort,
    cleanCohort
  );

  if (!cohortRow) {
    throw createHttpError(404, `Cohort "${cleanCohort}" not found.`, 'COHORT_NOT_FOUND');
  }

  const cohort = {
    id: cohortRow.id,
    slotCode: String(cohortRow.slotCode || cohortRow.slot_code || '').toLowerCase(),
    displayName: cohortRow.displayName || cohortRow.display_name || cohortRow.slot_code,
    currentSemester: Number(cohortRow.currentSemester || cohortRow.current_semester),
    intakeYear: cohortRow.intakeYear !== undefined ? cohortRow.intakeYear : cohortRow.intake_year,
    intakeIdentifier: cohortRow.intakeIdentifier || cohortRow.intake_identifier || null,
    status: cohortRow.status
  };

  if (requireActiveCohortAndSemesterMatch) {
    if (cohort.status !== 'active') {
      throw createHttpError(
        403,
        `Cohort "${cohort.displayName}" is not active (status: ${cohort.status}).`,
        'COHORT_NOT_ACTIVE'
      );
    }
    if (Number(cohort.currentSemester) !== Number(authorizedSubject.semester)) {
      throw createHttpError(
        403,
        `Cohort/semester mismatch: Subject "${authorizedSubject.code}" belongs to Semester ${authorizedSubject.semester}, but cohort "${cohort.displayName}" is currently in Semester ${cohort.currentSemester}.`,
        'COHORT_SEMESTER_MISMATCH'
      );
    }
  }

  return {
    subject: {
      id: authorizedSubject.subjectId,
      code: authorizedSubject.code,
      name: authorizedSubject.name,
      semester: Number(authorizedSubject.semester),
      department: authorizedSubject.department || 'BIT'
    },
    cohort
  };
}

/**
 * Case-insensitive alphabetical comparator for students by displayed name,
 * with deterministic tie-breaker on studentId.
 */
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
 * Queries the authoritative active student/CR roster for a specific cohort_id.
 * Strictly uses cohort_id; never includes unassigned students based on semester text.
 * Returns students sorted alphabetically by displayed name (case-insensitively).
 */
async function queryCohortEligibleRoster(client, cohortId) {
  const rows = (await client.all(
    `SELECT studentId, username, name, email, role, department, semester, cohort_id, avatarUrl, account_status
     FROM students
     WHERE cohort_id = ?
       AND LOWER(COALESCE(role, 'student')) IN ('student', 'cr')
       AND LOWER(COALESCE(account_status, 'active')) = 'active'
     ORDER BY LOWER(TRIM(COALESCE(name, studentId))) ASC, studentId ASC`,
    cohortId
  )) || [];

  const mapped = rows.map(r => ({
    studentId: r.studentId || r.studentid,
    username: r.username || null,
    name: r.name,
    email: r.email || null,
    role: String(r.role || 'student').toLowerCase(),
    department: r.department || 'BIT',
    semester: r.semester || null,
    cohortId: r.cohortId || r.cohort_id,
    avatarUrl: r.avatarUrl || r.avatarurl || null
  }));

  return sortStudentsAlphabetically(mapped);
}

/**
 * 2 & 3. Lists eligible students for a subject and cohort, and loads any existing session + records for the date.
 */
async function getAttendanceRoster(db, {
  actorUserId,
  subjectId,
  cohortId,
  sessionDate = null,
  now = new Date()
}) {
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  const resolvedDate = sessionDate
    ? validateSessionDate(sessionDate, { allowFuture: false, referenceDate: now })
    : formatNepalDate(now);

  const { subject, cohort } = await resolveAndValidateSubjectAndCohort(db, {
    actor,
    subjectInput: subjectId,
    cohortInput: cohortId,
    requireActiveCohortAndSemesterMatch: true
  });

  const [roster, existingSessionRow] = await Promise.all([
    queryCohortEligibleRoster(db, cohort.id),
    db.get(
      `SELECT * FROM attendance_sessions
       WHERE cohort_id = ? AND subject_id = ? AND session_date = ?`,
      cohort.id,
      subject.id,
      resolvedDate
    )
  ]);

  let session = null;
  let records = [];
  const statusByStudentId = new Map();

  if (existingSessionRow) {
    session = formatSessionObject(
      {
        ...existingSessionRow,
        subjectCode: subject.code,
        subjectName: subject.name,
        cohortName: cohort.displayName,
        slotCode: cohort.slotCode
      },
      now
    );

    const recordRows = (await db.all(
      `SELECT id, session_id, student_id, status, marked_by, created_at, updated_at
       FROM attendance_records
       WHERE session_id = ?
       ORDER BY student_id ASC`,
      existingSessionRow.id
    )) || [];

    records = recordRows.map(r => {
      const sId = r.studentId || r.student_id;
      statusByStudentId.set(sId, r.status);
      return {
        id: r.id,
        sessionId: r.sessionId || r.session_id,
        studentId: sId,
        status: r.status,
        markedBy: r.markedBy || r.marked_by,
        createdAt: r.createdAt || r.created_at,
        updatedAt: r.updatedAt || r.updated_at
      };
    });
  }

  const enrichedRoster = roster.map(student => ({
    ...student,
    status: statusByStudentId.has(student.studentId) ? statusByStudentId.get(student.studentId) : null
  }));

  return {
    subject,
    cohort,
    sessionDate: resolvedDate,
    roster: enrichedRoster,
    rosterCount: enrichedRoster.length,
    session,
    records
  };
}

/**
 * Validates and normalizes an array of attendance record inputs.
 */
function validateSubmittedRecordsInput(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw createHttpError(400, 'Attendance records must be a non-empty array.', 'INVALID_RECORDS');
  }

  const seenStudentIds = new Set();
  const normalized = [];

  for (let i = 0; i < records.length; i++) {
    const item = records[i];
    if (!item || typeof item !== 'object') {
      throw createHttpError(400, `Record at index ${i} must be an object.`, 'INVALID_RECORD_ITEM');
    }

    const rawStudentId = item.studentId !== undefined ? item.studentId : item.student_id;
    const studentId = rawStudentId ? String(rawStudentId).trim() : '';
    if (!studentId) {
      throw createHttpError(400, `Record at index ${i} is missing studentId.`, 'MISSING_STUDENT_ID');
    }

    if (seenStudentIds.has(studentId)) {
      throw createHttpError(400, `Duplicate studentId "${studentId}" in attendance submission.`, 'DUPLICATE_STUDENT_ID');
    }
    seenStudentIds.add(studentId);

    const status = item.status ? String(item.status).trim().toLowerCase() : '';
    if (!VALID_ATTENDANCE_STATUSES.has(status)) {
      throw createHttpError(
        400,
        `Invalid attendance status "${item.status}" for student "${studentId}". Allowed values are "present" and "absent".`,
        'INVALID_ATTENDANCE_STATUS'
      );
    }

    normalized.push({ studentId, status });
  }

  return normalized;
}

/**
 * 4 & 5. Creates a new attendance session or edits an existing session within the 24-hour window.
 * Enforces atomic bulk writes and handles concurrent duplicate submissions deterministically.
 */
async function saveAttendanceSession(db, {
  actorUserId,
  subjectId,
  cohortId,
  sessionDate,
  records,
  reason = null,
  teacherId = null,
  skipInProcessLock = false,
  now = new Date()
}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const nowIso = effectiveNow.toISOString();

  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  const cleanDate = validateSessionDate(sessionDate, { allowFuture: false, referenceDate: effectiveNow });
  const normalizedRecords = validateSubmittedRecordsInput(records);

  const { subject, cohort } = await resolveAndValidateSubjectAndCohort(db, {
    actor,
    subjectInput: subjectId,
    cohortInput: cohortId,
    requireActiveCohortAndSemesterMatch: true
  });

  const teacherProfile = await resolveTeacherProfileForSession(db, actor, subject.id, teacherId);

  const executeAttempt = async () => {
    const runInTx = async (tx) => {
      const eligibleRoster = await queryCohortEligibleRoster(tx, cohort.id);
      const eligibleMap = new Map(eligibleRoster.map(s => [s.studentId, s]));

      if (eligibleMap.size === 0) {
        throw createHttpError(400, `Cohort "${cohort.displayName}" has no active enrolled students.`, 'EMPTY_COHORT_ROSTER');
      }

      // Verify every submitted studentId belongs to the selected cohort's active student/CR roster
      for (const rec of normalizedRecords) {
        if (!eligibleMap.has(rec.studentId)) {
          throw createHttpError(
            403,
            `Student "${rec.studentId}" is not an active member of cohort "${cohort.displayName}".`,
            'STUDENT_NOT_IN_COHORT'
          );
        }
      }

      // Require complete cohort roster on both initial submission and teacher edits within the 24h window
      if (normalizedRecords.length !== eligibleMap.size) {
        throw createHttpError(
          400,
          `Complete cohort attendance roster is required. Cohort "${cohort.displayName}" has ${eligibleMap.size} active students, but ${normalizedRecords.length} records were provided.`,
          'INCOMPLETE_ROSTER'
        );
      }

      const forUpdateClause = tx.isPostgres ? ' FOR UPDATE' : '';
      const existingSession = await tx.get(
        `SELECT * FROM attendance_sessions
         WHERE cohort_id = ? AND subject_id = ? AND session_date = ?${forUpdateClause}`,
        cohort.id,
        subject.id,
        cleanDate
      );

      if (!existingSession) {
        const sessionId = crypto.randomUUID();
        await tx.run(
          `INSERT INTO attendance_sessions (
            id, subject_id, cohort_id, semester_no, teacher_id, recorded_by_user_id,
            session_date, status, submitted_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`,
          sessionId,
          subject.id,
          cohort.id,
          subject.semester,
          teacherProfile.id,
          actor.studentId,
          cleanDate,
          nowIso,
          nowIso,
          nowIso
        );

        const savedRecords = [];
        const afterStateRecords = {};

        for (const rec of normalizedRecords) {
          const recId = crypto.randomUUID();
          await tx.run(
            `INSERT INTO attendance_records (
              id, session_id, student_id, status, marked_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            recId,
            sessionId,
            rec.studentId,
            rec.status,
            actor.studentId,
            nowIso,
            nowIso
          );
          afterStateRecords[rec.studentId] = rec.status;
          savedRecords.push({
            id: recId,
            sessionId,
            studentId: rec.studentId,
            status: rec.status,
            markedBy: actor.studentId,
            createdAt: nowIso,
            updatedAt: nowIso
          });
        }

        const auditEntry = await writeAttendanceAuditLog(tx, {
          sessionId,
          action: 'session_created',
          actorUserId: actor.studentId,
          actorRole: actor.role,
          reason: reason ? String(reason).trim() : 'Initial attendance submission',
          beforeState: null,
          afterState: {
            status: 'submitted',
            submittedAt: nowIso,
            records: afterStateRecords
          },
          metadata: {
            cohortId: cohort.id,
            subjectId: subject.id,
            semesterNo: subject.semester,
            sessionDate: cleanDate,
            totalStudents: savedRecords.length
          },
          timestampIso: nowIso
        });

        const backupRevision = await createAttendanceBackupRevisionTx(tx, {
          sessionId,
          teacherId: teacherProfile.id,
          subject,
          cohort,
          sessionDate: cleanDate,
          originalSubmittedAt: nowIso,
          auditEntry,
          actor,
          finalRecords: savedRecords,
          studentMetaById: eligibleMap,
          timestampIso: nowIso
        });

        const createdRow = await tx.get('SELECT * FROM attendance_sessions WHERE id = ?', sessionId);
        return {
          created: true,
          updated: false,
          session: formatSessionObject(
            {
              ...createdRow,
              subjectCode: subject.code,
              subjectName: subject.name,
              cohortName: cohort.displayName,
              slotCode: cohort.slotCode
            },
            effectiveNow
          ),
          records: savedRecords,
          backupRevision
        };
      }

      // Existing session found: enforce 24-hour editing window against original submitted_at
      const editWindow = computeSessionEditWindow(existingSession, effectiveNow);
      if (!editWindow.isWithinEditWindow) {
        throw createHttpError(
          403,
          'The 24-hour editing window for this attendance session has expired. Post-window corrections require administrator authorization with a reason.',
          'EDIT_WINDOW_EXPIRED'
        );
      }

      if (!tx.isPostgres) {
        await tx.run('UPDATE attendance_sessions SET updated_at = updated_at WHERE id = ?', existingSession.id);
      }

      const existingRecords = (await tx.all(
        `SELECT id, session_id, student_id, status, marked_by, created_at, updated_at
         FROM attendance_records
         WHERE session_id = ?
         ORDER BY student_id ASC`,
        existingSession.id
      )) || [];

      const existingByStudent = new Map();
      const beforeStateRecords = {};
      for (const r of existingRecords) {
        const sId = r.studentId || r.student_id;
        existingByStudent.set(sId, r);
        beforeStateRecords[sId] = r.status;
      }

      const changedRecords = {};
      for (const rec of normalizedRecords) {
        const prev = existingByStudent.get(rec.studentId);
        if (prev) {
          if (prev.status !== rec.status) {
            changedRecords[rec.studentId] = { from: prev.status, to: rec.status };
            await tx.run(
              `UPDATE attendance_records
               SET status = ?, marked_by = ?, updated_at = ?
               WHERE id = ?`,
              rec.status,
              actor.studentId,
              nowIso,
              prev.id
            );
          }
        } else {
          const recId = crypto.randomUUID();
          changedRecords[rec.studentId] = { from: null, to: rec.status };
          await tx.run(
            `INSERT INTO attendance_records (
              id, session_id, student_id, status, marked_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            recId,
            existingSession.id,
            rec.studentId,
            rec.status,
            actor.studentId,
            nowIso,
            nowIso
          );
        }
      }

      // Update updated_at on session while strictly preserving original submitted_at
      await tx.run(
        `UPDATE attendance_sessions
         SET updated_at = ?
         WHERE id = ?`,
        nowIso,
        existingSession.id
      );

      const updatedRecordsRows = (await tx.all(
        `SELECT id, session_id, student_id, status, marked_by, created_at, updated_at
         FROM attendance_records
         WHERE session_id = ?
         ORDER BY student_id ASC`,
        existingSession.id
      )) || [];

      const afterStateRecords = {};
      const finalRecords = updatedRecordsRows.map(r => {
        const sId = r.studentId || r.student_id;
        afterStateRecords[sId] = r.status;
        return {
          id: r.id,
          sessionId: r.sessionId || r.session_id,
          studentId: sId,
          status: r.status,
          markedBy: r.markedBy || r.marked_by,
          createdAt: r.createdAt || r.created_at,
          updatedAt: r.updatedAt || r.updated_at
        };
      });

      const originalSubmittedAt = existingSession.submittedAt || existingSession.submitted_at;

      const auditEntry = await writeAttendanceAuditLog(tx, {
        sessionId: existingSession.id,
        action: 'teacher_edit',
        actorUserId: actor.studentId,
        actorRole: actor.role,
        reason: reason ? String(reason).trim() : 'Edited within 24-hour window',
        beforeState: {
          submittedAt: originalSubmittedAt,
          records: beforeStateRecords
        },
        afterState: {
          submittedAt: originalSubmittedAt,
          records: afterStateRecords
        },
        metadata: {
          cohortId: cohort.id,
          subjectId: subject.id,
          semesterNo: subject.semester,
          sessionDate: cleanDate,
          changedRecords,
          changedCount: Object.keys(changedRecords).length
        },
        timestampIso: nowIso
      });

      const sessionTeacherId = existingSession.teacherId || existingSession.teacher_id || teacherProfile.id;
      const backupRevision = await createAttendanceBackupRevisionTx(tx, {
        sessionId: existingSession.id,
        teacherId: sessionTeacherId,
        subject,
        cohort,
        sessionDate: cleanDate,
        originalSubmittedAt,
        auditEntry,
        actor,
        finalRecords,
        studentMetaById: eligibleMap,
        timestampIso: nowIso
      });

      const updatedSessionRow = await tx.get('SELECT * FROM attendance_sessions WHERE id = ?', existingSession.id);
      return {
        created: false,
        updated: true,
        session: formatSessionObject(
          {
            ...updatedSessionRow,
            subjectCode: subject.code,
            subjectName: subject.name,
            cohortName: cohort.displayName,
            slotCode: cohort.slotCode
          },
          effectiveNow
        ),
        records: finalRecords,
        backupRevision
      };
    };

    if (typeof db.withTransaction === 'function') {
      return await db.withTransaction(runInTx);
    }
    return await runInTx(db);
  };

  const runWithRetries = async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        return await executeAttempt();
      } catch (err) {
        lastErr = err;
        const isRetryableConflict =
          err &&
          !err.status &&
          (err.code === '23505' ||
            err.code === '40001' ||
            err.code === '40P01' ||
            err.code === 'SQLITE_CONSTRAINT' ||
            err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            err.code === 'SQLITE_BUSY' ||
            err.code === 'SQLITE_LOCKED' ||
            /unique constraint|duplicate key|database is locked|cannot start a transaction|could not serialize|deadlock/i.test(err.message || ''));

        if (!isRetryableConflict || attempt === 10) {
          throw err;
        }
        const jitter = Math.floor(Math.random() * 12);
        await new Promise((r) => setTimeout(r, 15 * attempt + jitter));
      }
    }
    throw lastErr;
  };

  if (skipInProcessLock) {
    return await runWithRetries();
  }
  const lockKey = `${cohort.id}:${subject.id}:${cleanDate}`;
  return await withSessionLock(lockKey, runWithRetries);
}

/**
 * 5b. Edits an existing session by sessionId within the 24-hour window.
 */
async function editAttendanceSessionById(db, {
  actorUserId,
  sessionId,
  records,
  reason = null,
  skipInProcessLock = false,
  now = new Date()
}) {
  if (!sessionId || !String(sessionId).trim()) {
    throw createHttpError(400, 'sessionId is required.', 'MISSING_SESSION_ID');
  }

  const sessionRow = await db.get('SELECT * FROM attendance_sessions WHERE id = ?', String(sessionId).trim());
  if (!sessionRow) {
    throw createHttpError(404, 'Attendance session not found.', 'SESSION_NOT_FOUND');
  }

  return await saveAttendanceSession(db, {
    actorUserId,
    subjectId: sessionRow.subjectId || sessionRow.subject_id,
    cohortId: sessionRow.cohortId || sessionRow.cohort_id,
    sessionDate: sessionRow.sessionDate || sessionRow.session_date,
    records,
    reason,
    skipInProcessLock,
    now
  });
}

/**
 * 6. Authorizes and records an administrative correction after the 24-hour editing window.
 * Preserves original submitted_at and writes durable audit logs with actor, timestamp, reason, and old/new values.
 */
async function adminCorrectAttendanceSession(db, {
  adminUserId,
  sessionId,
  records,
  reason,
  skipInProcessLock = false,
  now = new Date()
}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const nowIso = effectiveNow.toISOString();

  const adminActor = await resolveAuthenticatedActor(db, adminUserId, ['admin']);

  if (!sessionId || !String(sessionId).trim()) {
    throw createHttpError(400, 'sessionId is required.', 'MISSING_SESSION_ID');
  }

  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  if (cleanReason.length < 3) {
    throw createHttpError(
      400,
      'A valid correction reason (at least 3 characters) is required for administrative attendance corrections.',
      'REASON_REQUIRED'
    );
  }

  const normalizedRecords = validateSubmittedRecordsInput(records);

  const runCorrection = async (tx) => {
    if (tx.isPostgres) {
      await tx.get('SELECT id, latest_revision_no FROM attendance_sessions WHERE id = ? FOR UPDATE', String(sessionId).trim());
    } else {
      await tx.run('UPDATE attendance_sessions SET updated_at = updated_at WHERE id = ?', String(sessionId).trim());
    }

    const existingSession = await tx.get(
      `SELECT s.*, sub.code AS subject_code, sub.name AS subject_name,
              c.display_name AS cohort_name, c.slot_code
       FROM attendance_sessions s
       LEFT JOIN subjects sub ON sub.id = s.subject_id
       LEFT JOIN cohorts c ON c.id = s.cohort_id
       WHERE s.id = ?`,
      String(sessionId).trim()
    );

    if (!existingSession) {
      throw createHttpError(404, 'Attendance session not found.', 'SESSION_NOT_FOUND');
    }

    const sessionCohortId = existingSession.cohortId || existingSession.cohort_id;
    const sessionSubjectId = existingSession.subjectId || existingSession.subject_id;
    const sessionDate = existingSession.sessionDate || existingSession.session_date;
    const originalSubmittedAt = existingSession.submittedAt || existingSession.submitted_at;

    const existingRecords = (await tx.all(
      `SELECT id, session_id, student_id, status, marked_by, created_at, updated_at
       FROM attendance_records
       WHERE session_id = ?
       ORDER BY student_id ASC`,
      existingSession.id
    )) || [];

    const existingByStudent = new Map();
    const beforeStateRecords = {};
    for (const r of existingRecords) {
      const sId = r.studentId || r.student_id;
      existingByStudent.set(sId, r);
      beforeStateRecords[sId] = r.status;
    }

    const eligibleRoster = await queryCohortEligibleRoster(tx, sessionCohortId);
    const eligibleSet = new Set(eligibleRoster.map(s => s.studentId));

    // Every studentId in records must either already exist in this session or belong to the session's cohort
    for (const rec of normalizedRecords) {
      if (!existingByStudent.has(rec.studentId) && !eligibleSet.has(rec.studentId)) {
        throw createHttpError(
          403,
          `Student "${rec.studentId}" does not belong to cohort "${existingSession.cohort_name || sessionCohortId}".`,
          'STUDENT_NOT_IN_COHORT'
        );
      }
    }

    const changedRecords = {};
    for (const rec of normalizedRecords) {
      const prev = existingByStudent.get(rec.studentId);
      if (prev) {
        if (prev.status !== rec.status) {
          changedRecords[rec.studentId] = { from: prev.status, to: rec.status };
          await tx.run(
            `UPDATE attendance_records
             SET status = ?, marked_by = ?, updated_at = ?
             WHERE id = ?`,
            rec.status,
            adminActor.studentId,
            nowIso,
            prev.id
          );
        }
      } else {
        const recId = crypto.randomUUID();
        changedRecords[rec.studentId] = { from: null, to: rec.status };
        await tx.run(
          `INSERT INTO attendance_records (
            id, session_id, student_id, status, marked_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          recId,
          existingSession.id,
          rec.studentId,
          rec.status,
          adminActor.studentId,
          nowIso,
          nowIso
        );
      }
    }

    // Preserve original submitted_at; only update updated_at
    await tx.run(
      `UPDATE attendance_sessions
       SET updated_at = ?
       WHERE id = ?`,
      nowIso,
      existingSession.id
    );

    const updatedRecordsRows = (await tx.all(
      `SELECT id, session_id, student_id, status, marked_by, created_at, updated_at
       FROM attendance_records
       WHERE session_id = ?
       ORDER BY student_id ASC`,
      existingSession.id
    )) || [];

    const afterStateRecords = {};
    const finalRecords = updatedRecordsRows.map(r => {
      const sId = r.studentId || r.student_id;
      afterStateRecords[sId] = r.status;
      return {
        id: r.id,
        sessionId: r.sessionId || r.session_id,
        studentId: sId,
        status: r.status,
        markedBy: r.markedBy || r.marked_by,
        createdAt: r.createdAt || r.created_at,
        updatedAt: r.updatedAt || r.updated_at
      };
    });

    const auditEntry = await writeAttendanceAuditLog(tx, {
      sessionId: existingSession.id,
      action: 'admin_correction',
      actorUserId: adminActor.studentId,
      actorRole: 'admin',
      reason: cleanReason,
      beforeState: {
        submittedAt: originalSubmittedAt,
        records: beforeStateRecords
      },
      afterState: {
        submittedAt: originalSubmittedAt,
        records: afterStateRecords
      },
      metadata: {
        cohortId: sessionCohortId,
        subjectId: sessionSubjectId,
        semesterNo: Number(existingSession.semesterNo || existingSession.semester_no),
        sessionDate,
        changedRecords,
        changedCount: Object.keys(changedRecords).length
      },
      timestampIso: nowIso
    });

    await recordAdminAudit(db, {
      actorUserId: adminActor.studentId,
      action: 'attendance_admin_corrected',
      entityType: 'attendance_session',
      entityId: existingSession.id,
      beforeState: {
        submittedAt: originalSubmittedAt,
        records: beforeStateRecords
      },
      afterState: {
        submittedAt: originalSubmittedAt,
        records: afterStateRecords
      },
      metadata: {
        reason: cleanReason,
        cohortId: sessionCohortId,
        subjectId: sessionSubjectId,
        sessionDate,
        changedRecords
      },
      required: false,
      tx
    });

    // Resolve full student metadata (including any historical students on the session)
    const studentMetaById = new Map(eligibleRoster.map(s => [s.studentId, s]));
    for (const r of finalRecords) {
      if (!studentMetaById.has(r.studentId)) {
        const stuRow = await tx.get(
          'SELECT studentId, username, name, role FROM students WHERE studentId = ?',
          r.studentId
        );
        if (stuRow) {
          studentMetaById.set(r.studentId, {
            studentId: stuRow.studentId || stuRow.studentid,
            username: stuRow.username || null,
            name: stuRow.name || r.studentId,
            role: String(stuRow.role || 'student').toLowerCase()
          });
        }
      }
    }

    let sessionTeacherId = existingSession.teacherId || existingSession.teacher_id;
    // Ensure admin correction queues for the subject's assigned active teacher if session was recorded under an admin anchor
    const assignedSubjTeacher = await tx.get(
      `SELECT t.id
       FROM teacher_subjects ts
       JOIN teachers t ON t.id = ts.teacher_id
       WHERE ts.subject_id = ? AND t.status = 'active'
       ORDER BY CASE WHEN t.id = ? THEN 0 ELSE 1 END ASC, ts.created_at ASC
       LIMIT 1`,
      sessionSubjectId,
      sessionTeacherId
    );
    if (assignedSubjTeacher && assignedSubjTeacher.id) {
      sessionTeacherId = assignedSubjTeacher.id;
    }

    const semesterNo = Number(existingSession.semesterNo || existingSession.semester_no || 1);
    const backupRevision = await createAttendanceBackupRevisionTx(tx, {
      sessionId: existingSession.id,
      teacherId: sessionTeacherId,
      subject: {
        id: sessionSubjectId,
        code: existingSession.subject_code || sessionSubjectId,
        name: existingSession.subject_name || sessionSubjectId,
        semester: semesterNo,
        department: 'BIT'
      },
      cohort: {
        id: sessionCohortId,
        slotCode: existingSession.slot_code || null,
        displayName: existingSession.cohort_name || sessionCohortId,
        currentSemester: semesterNo
      },
      sessionDate,
      originalSubmittedAt,
      auditEntry,
      actor: adminActor,
      finalRecords,
      studentMetaById,
      timestampIso: nowIso
    });

    const updatedSessionRow = await tx.get('SELECT * FROM attendance_sessions WHERE id = ?', existingSession.id);

    return {
      corrected: true,
      session: formatSessionObject(
        {
          ...updatedSessionRow,
          subjectCode: existingSession.subject_code,
          subjectName: existingSession.subject_name,
          cohortName: existingSession.cohort_name,
          slotCode: existingSession.slot_code
        },
        effectiveNow
      ),
      records: finalRecords,
      audit: auditEntry,
      backupRevision
    };
  };

  const preSession = await db.get(
    'SELECT id, cohort_id, subject_id, session_date FROM attendance_sessions WHERE id = ?',
    String(sessionId).trim()
  );
  if (!preSession) {
    throw createHttpError(404, 'Attendance session not found.', 'SESSION_NOT_FOUND');
  }

  const runCorrectionWithRetries = async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        if (typeof db.withTransaction === 'function') {
          return await db.withTransaction(runCorrection);
        }
        return await runCorrection(db);
      } catch (err) {
        lastErr = err;
        const isRetryableConflict =
          err &&
          !err.status &&
          (err.code === '23505' ||
            err.code === '40001' ||
            err.code === '40P01' ||
            err.code === 'SQLITE_CONSTRAINT' ||
            err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            err.code === 'SQLITE_BUSY' ||
            err.code === 'SQLITE_LOCKED' ||
            /unique constraint|duplicate key|database is locked|cannot start a transaction|could not serialize|deadlock/i.test(err.message || ''));
        if (!isRetryableConflict || attempt === 10) {
          throw err;
        }
        const jitter = Math.floor(Math.random() * 12);
        await new Promise((r) => setTimeout(r, 15 * attempt + jitter));
      }
    }
    throw lastErr;
  };

  if (skipInProcessLock) {
    return await runCorrectionWithRetries();
  }
  const lockKey = `${preSession.cohortId || preSession.cohort_id}:${preSession.subjectId || preSession.subject_id}:${preSession.sessionDate || preSession.session_date}`;
  return await withSessionLock(lockKey, runCorrectionWithRetries);
}

/**
 * Queries audit history for a specific attendance session (teacher/admin).
 */
async function getAttendanceSessionAuditLogs(db, { actorUserId, sessionId }) {
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  if (!sessionId || !String(sessionId).trim()) {
    throw createHttpError(400, 'sessionId is required.', 'MISSING_SESSION_ID');
  }

  const session = await db.get('SELECT * FROM attendance_sessions WHERE id = ?', String(sessionId).trim());
  if (!session) {
    throw createHttpError(404, 'Attendance session not found.', 'SESSION_NOT_FOUND');
  }

  if (actor.role === 'teacher') {
    try {
      await validateTeacherSubjectAuthorization(db, actor.studentId, session.subjectId || session.subject_id);
    } catch (authErr) {
      throw createHttpError(authErr.status || 403, authErr.message, 'UNAUTHORIZED_SUBJECT');
    }
  }

  const rows = (await db.all(
    `SELECT a.*, s.name AS actor_name
     FROM attendance_audit_logs a
     LEFT JOIN students s ON s.studentId = a.actor_user_id
     WHERE a.session_id = ?
     ORDER BY a.created_at DESC`,
    session.id
  )) || [];

  const parseJsonCol = (val) => {
    if (!val) return null;
    if (typeof val === 'object') return val;
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  };

  return {
    sessionId: session.id,
    logs: rows.map(r => ({
      id: r.id,
      sessionId: r.sessionId || r.session_id,
      action: r.action,
      actorUserId: r.actorUserId || r.actor_user_id,
      actorName: r.actorName || r.actor_name || r.actor_user_id,
      actorRole: r.actorRole || r.actor_role,
      reason: r.reason || null,
      beforeState: parseJsonCol(r.beforeState || r.before_state),
      afterState: parseJsonCol(r.afterState || r.after_state),
      metadata: parseJsonCol(r.metadata),
      createdAt: r.createdAt || r.created_at
    }))
  };
}

/**
 * 8. Reads historical attendance sessions and counts for authorized teachers and admins.
 */
async function listAttendanceSessions(db, {
  actorUserId,
  subjectId = null,
  cohortId = null,
  semester = null,
  startDate = null,
  endDate = null,
  now = new Date()
}) {
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);

  const whereClauses = [];
  const params = [];

  if (actor.role === 'teacher') {
    const teacherSubjects = await getTeacherSubjects(db, actor.studentId);
    const allowedSubjectIds = teacherSubjects.map(s => s.id);

    if (subjectId && String(subjectId).trim()) {
      try {
        const authSub = await validateTeacherSubjectAuthorization(db, actor.studentId, String(subjectId).trim());
        whereClauses.push('s.subject_id = ?');
        params.push(authSub.subjectId);
      } catch (authErr) {
        throw createHttpError(authErr.status || 403, authErr.message, 'UNAUTHORIZED_SUBJECT');
      }
    } else {
      if (allowedSubjectIds.length === 0) {
        return { sessions: [] };
      }
      const placeholders = allowedSubjectIds.map(() => '?').join(', ');
      whereClauses.push(`s.subject_id IN (${placeholders})`);
      params.push(...allowedSubjectIds);
    }
  } else if (subjectId && String(subjectId).trim()) {
    const cleanSubj = String(subjectId).trim();
    const subjRow = await db.get(
      'SELECT id FROM subjects WHERE id = ? OR LOWER(code) = LOWER(?)',
      cleanSubj,
      cleanSubj
    );
    if (!subjRow) {
      throw createHttpError(404, `Subject "${cleanSubj}" not found.`, 'SUBJECT_NOT_FOUND');
    }
    whereClauses.push('s.subject_id = ?');
    params.push(subjRow.id);
  }

  if (cohortId && String(cohortId).trim()) {
    const cleanCohort = String(cohortId).trim();
    const cohortRow = await db.get(
      'SELECT id FROM cohorts WHERE id = ? OR LOWER(slot_code) = LOWER(?)',
      cleanCohort,
      cleanCohort
    );
    if (!cohortRow) {
      throw createHttpError(404, `Cohort "${cleanCohort}" not found.`, 'COHORT_NOT_FOUND');
    }
    whereClauses.push('s.cohort_id = ?');
    params.push(cohortRow.id);
  }

  if (semester !== null && semester !== undefined && String(semester).trim() !== '') {
    const semNum = parseSemesterNumber(semester);
    if (!semNum) {
      throw createHttpError(400, 'Invalid semester filter.', 'INVALID_SEMESTER');
    }
    whereClauses.push('s.semester_no = ?');
    params.push(semNum);
  }

  if (startDate && String(startDate).trim()) {
    const validStart = validateSessionDate(String(startDate).trim(), { allowFuture: true });
    whereClauses.push('s.session_date >= ?');
    params.push(validStart);
  }

  if (endDate && String(endDate).trim()) {
    const validEnd = validateSessionDate(String(endDate).trim(), { allowFuture: true });
    whereClauses.push('s.session_date <= ?');
    params.push(validEnd);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const rows = (await db.all(
    `SELECT s.*,
            sub.code AS subject_code,
            sub.name AS subject_name,
            c.display_name AS cohort_name,
            c.slot_code,
            (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id) AS total_records,
            (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id AND ar.status = 'present') AS present_count,
            (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id AND ar.status = 'absent') AS absent_count
     FROM attendance_sessions s
     LEFT JOIN subjects sub ON sub.id = s.subject_id
     LEFT JOIN cohorts c ON c.id = s.cohort_id
     ${whereSql}
     ORDER BY s.session_date DESC, s.submitted_at DESC`,
    ...params
  )) || [];

  const sessions = rows.map(r => {
    const totalCount = Number(r.total_records ?? r.totalrecords ?? 0);
    const presentCount = Number(r.present_count ?? r.presentcount ?? 0);
    const absentCount = Number(r.absent_count ?? r.absentcount ?? 0);
    const rawPct = totalCount > 0 ? (presentCount / totalCount) * 100 : 0;

    return {
      ...formatSessionObject(r, now),
      counts: {
        total: totalCount,
        present: presentCount,
        absent: absentCount,
        attendancePercentage: totalCount > 0 ? Math.round(rawPct * 100) / 100 : 0
      }
    };
  });

  return { sessions };
}

/**
 * 7. Calculates a student's or CR's subject-wise attendance summary for their active cohort and semester.
 * Strictly scopes to authenticated user's own studentId and cohort_id.
 */
async function getStudentAttendanceSummary(db, { studentUserId }) {
  const actor = await resolveAuthenticatedActor(db, studentUserId, ['student', 'cr']);
  const [context, thresholdConfig] = await Promise.all([
    getAcademicContext(db, { studentId: actor.studentId }),
    getEligibilityThresholdConfig(db)
  ]);

  if (!context || !context.cohort || !context.cohort.id || context.academicStatus === 'unassigned') {
    return {
      studentId: actor.studentId,
      name: actor.name,
      role: actor.role,
      academicStatus: 'unassigned',
      cohort: null,
      semesterNo: null,
      eligibilityThreshold: thresholdConfig,
      configuredThreshold: thresholdConfig.threshold,
      eligibilityStatus: thresholdConfig.configured ? 'not_applicable' : 'unconfigured',
      overall: {
        totalSessions: 0,
        presentCount: 0,
        absentCount: 0,
        attendancePercentage: 0,
        percentageAvailable: false,
        configuredThreshold: thresholdConfig.threshold,
        eligibilityStatus: thresholdConfig.configured ? 'not_applicable' : 'unconfigured',
        isEligible: null
      },
      subjects: [],
      recentHistory: []
    };
  }

  const cohortId = context.cohort.id;
  const semesterNo = Number(context.cohort.currentSemester);
  const activeCheck = db.isPostgres ? '(active = TRUE OR active IS NULL)' : '(active = 1 OR active IS NULL)';

  const [subjectsRows, sessionRows] = await Promise.all([
    db.all(
      `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature
       FROM subjects
       WHERE semester = ? AND ${activeCheck}
       ORDER BY code ASC`,
      semesterNo
    ).then(r => r || []),
    db.all(
      `SELECT s.id AS session_id,
              s.subject_id,
              s.cohort_id,
              s.semester_no,
              s.session_date,
              s.status AS session_status,
              s.submitted_at,
              sub.code AS subject_code,
              sub.name AS subject_name,
              r.status AS student_status,
              r.updated_at AS marked_at,
              (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id) AS roster_record_count
       FROM attendance_sessions s
       JOIN subjects sub ON sub.id = s.subject_id
       LEFT JOIN attendance_records r
         ON r.session_id = s.id AND r.student_id = ?
       WHERE s.cohort_id = ?
         AND s.semester_no = ?
         AND s.status IN ('submitted', 'locked')
       ORDER BY s.session_date DESC, s.submitted_at DESC`,
      actor.studentId,
      cohortId,
      semesterNo
    ).then(r => r || [])
  ]);

  // Filter to valid finalized sessions that have recorded attendance
  const finalizedSessions = sessionRows.filter(
    row => Number(row.roster_record_count ?? row.rosterrecordcount ?? 0) > 0
  );

  const sessionsBySubject = new Map();
  for (const row of finalizedSessions) {
    const subjId = row.subjectId || row.subject_id;
    if (!sessionsBySubject.has(subjId)) {
      sessionsBySubject.set(subjId, []);
    }
    sessionsBySubject.get(subjId).push(row);
  }

  let overallTotalSessions = 0;
  let overallPresentCount = 0;
  let overallAbsentCount = 0;

  const computeEligibility = (rawPercentage, totalApplicableSessions) => {
    if (!thresholdConfig.configured || thresholdConfig.threshold === null) {
      return {
        eligibilityStatus: 'unconfigured',
        isEligible: null
      };
    }
    if (totalApplicableSessions === 0) {
      return {
        eligibilityStatus: 'not_applicable',
        isEligible: null
      };
    }
    // Base eligibility decision on underlying unrounded numeric percentage
    if (rawPercentage >= thresholdConfig.threshold) {
      return {
        eligibilityStatus: 'eligible',
        isEligible: true
      };
    }
    return {
      eligibilityStatus: 'ineligible',
      isEligible: false
    };
  };

  const subjectSummaries = subjectsRows.map(sub => {
    const subSessions = sessionsBySubject.get(sub.id) || [];
    const totalSessions = subSessions.length;
    let presentCount = 0;
    let absentCount = 0;

    for (const sess of subSessions) {
      const st = sess.student_status || sess.studentstatus;
      if (st === 'present') {
        presentCount += 1;
      } else {
        // Count explicit 'absent' or any unrecorded slot in a finalized cohort session as absent
        // so incomplete rosters can never shrink the denominator or inflate attendance percentage
        absentCount += 1;
      }
    }

    overallTotalSessions += totalSessions;
    overallPresentCount += presentCount;
    overallAbsentCount += absentCount;

    const rawPercentage = totalSessions > 0 ? (presentCount / totalSessions) * 100 : 0;
    const displayPercentage = totalSessions > 0 ? Math.round(rawPercentage * 100) / 100 : 0;
    const { eligibilityStatus, isEligible } = computeEligibility(rawPercentage, totalSessions);

    return {
      subjectId: sub.id,
      code: sub.code,
      name: sub.name,
      semester: Number(sub.semester),
      creditHours: Number(sub.creditHours || sub.credithours || 3.0),
      nature: sub.nature || null,
      totalSessions,
      presentCount,
      absentCount,
      attendancePercentage: displayPercentage,
      percentageAvailable: totalSessions > 0,
      configuredThreshold: thresholdConfig.threshold,
      eligibilityStatus,
      isEligible
    };
  });

  const overallRawPct = overallTotalSessions > 0 ? (overallPresentCount / overallTotalSessions) * 100 : 0;
  const overallDisplayPct = overallTotalSessions > 0 ? Math.round(overallRawPct * 100) / 100 : 0;
  const overallElig = computeEligibility(overallRawPct, overallTotalSessions);

  const recentHistory = finalizedSessions.slice(0, 50).map(row => ({
    sessionId: row.session_id || row.sessionId,
    subjectId: row.subject_id || row.subjectId,
    subjectCode: row.subject_code || row.subjectCode,
    subjectName: row.subject_name || row.subjectName,
    sessionDate: row.session_date || row.sessionDate,
    status: (row.student_status || row.studentstatus) === 'present' ? 'present' : 'absent',
    submittedAt: row.submitted_at || row.submittedAt,
    markedAt: row.marked_at || row.markedAt || null
  }));

  return {
    studentId: actor.studentId,
    name: actor.name,
    role: actor.role,
    academicStatus: 'active',
    cohort: {
      id: context.cohort.id,
      slotCode: context.cohort.slotCode,
      displayName: context.cohort.displayName,
      currentSemester: semesterNo
    },
    semesterNo,
    eligibilityThreshold: thresholdConfig,
    configuredThreshold: thresholdConfig.threshold,
    eligibilityStatus: overallElig.eligibilityStatus,
    overall: {
      totalSessions: overallTotalSessions,
      presentCount: overallPresentCount,
      absentCount: overallAbsentCount,
      attendancePercentage: overallDisplayPct,
      percentageAvailable: overallTotalSessions > 0,
      configuredThreshold: thresholdConfig.threshold,
      eligibilityStatus: overallElig.eligibilityStatus,
      isEligible: overallElig.isEligible
    },
    subjects: subjectSummaries,
    recentHistory
  };
}

/**
 * Lists all immutable backup revisions for a session in chronological order (revision_no ASC).
 */
async function listSessionBackupRevisions(db, sessionId) {
  if (!sessionId || !String(sessionId).trim()) return [];
  const rows = (await db.all(
    `SELECT * FROM attendance_backup_runs
     WHERE session_id = ?
     ORDER BY revision_no ASC`,
    String(sessionId).trim()
  )) || [];
  return rows.map(formatBackupRevisionRow);
}

/**
 * Validates a month string in YYYY-MM format (defaults to current Nepal month).
 */
function validateMonthString(monthInput, { referenceDate = new Date() } = {}) {
  if (monthInput === null || monthInput === undefined || String(monthInput).trim() === '') {
    return formatNepalDate(referenceDate).slice(0, 7);
  }
  const clean = String(monthInput).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(clean)) {
    throw createHttpError(400, 'Invalid month format. Expected YYYY-MM.', 'INVALID_MONTH');
  }
  const year = Number(clean.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw createHttpError(400, 'Month year must be between 2000 and 2100.', 'INVALID_MONTH');
  }
  return clean;
}

const FULL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

function formatMonthDisplayLabel(yyyyMm) {
  if (!yyyyMm || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yyyyMm)) return String(yyyyMm || '');
  const [yStr, mStr] = yyyyMm.split('-');
  const mIdx = Number(mStr) - 1;
  return `${FULL_MONTH_NAMES[mIdx] || mStr} ${yStr}`;
}

function formatShortDateLabel(yyyyMmDd) {
  if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return String(yyyyMmDd || '');
  const [, mStr, dStr] = yyyyMmDd.split('-');
  const mIdx = Number(mStr) - 1;
  const dayNum = Number(dStr);
  return `${SHORT_MONTH_NAMES[mIdx] || mStr} ${dayNum}`;
}

/**
 * Computes the applicable calendar dates for a selected month (YYYY-MM)
 * relative to current Nepal local date:
 * - Past month: 1st through the last calendar day of that month.
 * - Current month: 1st through today's date in Nepal local time.
 * - Future month: empty array (never displays future attendance dates as if they have occurred).
 */
function buildApplicableCalendarDatesForMonth(monthStr, { referenceDate = new Date(), currentNepalDate = null } = {}) {
  const cleanMonth = validateMonthString(monthStr, { referenceDate });
  const todayNepal =
    currentNepalDate && /^\d{4}-\d{2}-\d{2}$/.test(String(currentNepalDate).trim())
      ? String(currentNepalDate).trim()
      : formatNepalDate(referenceDate);
  const currentMonthNepal = todayNepal.slice(0, 7);

  const [yStr, mStr] = cleanMonth.split('-');
  const year = Number(yStr);
  const monthNum = Number(mStr);
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const shortMonth = SHORT_MONTH_NAMES[monthNum - 1] || mStr;

  let endDay = daysInMonth;
  if (cleanMonth > currentMonthNepal) {
    endDay = 0;
  } else if (cleanMonth === currentMonthNepal) {
    const todayDay = Number(todayNepal.slice(8, 10));
    endDay = Math.min(daysInMonth, Math.max(0, todayDay));
  }

  const dates = [];
  for (let d = 1; d <= endDay; d++) {
    const dayPadded = String(d).padStart(2, '0');
    const dateStr = `${cleanMonth}-${dayPadded}`;
    dates.push({
      date: dateStr,
      day: d,
      label: `${shortMonth} ${d}`
    });
  }

  const result = dates;
  result.month = cleanMonth;
  result.monthLabel = formatMonthDisplayLabel(cleanMonth);
  result.todayNepal = todayNepal;
  result.daysInMonth = daysInMonth;
  result.applicableEndDay = endDay;
  result.startDate = endDay > 0 ? `${cleanMonth}-01` : null;
  result.endDate = endDay > 0 ? `${cleanMonth}-${String(endDay).padStart(2, '0')}` : null;
  result.dateRangeLabel =
    endDay > 0
      ? `${shortMonth} 1 – ${shortMonth} ${endDay}, ${year}`
      : `No elapsed dates in ${formatMonthDisplayLabel(cleanMonth)}`;
  result.dates = dates;

  return result;
}

/**
 * Pure domain builder for the Monthly Attendance Matrix.
 *
 * Rules enforced:
 * - Students are sorted alphabetically by displayed name (case-insensitively).
 * - Includes every calendar date from the 1st of the selected month through the applicable end date
 *   (today in Nepal time for the current month, last calendar day for past months, none for future months).
 * - Dates without a submitted attendance session display '-' for every student and are excluded from percentage calculation.
 * - Dates with a submitted session display each student's independent consecutive attendance number (1, 2, 3...)
 *   for Present and 'ABS' for Absent (which never increments the student's count).
 * - Consecutive numbering resets at the start of each month.
 * - Attendance % is calculated strictly from underlying submitted attendance records:
 *   (presentCount / totalSubmittedSessions) * 100, formatted to 1 decimal place, with safe 0-session handling.
 */
function buildMonthlyAttendanceMatrix({
  students = [],
  sessions = [],
  recordsBySessionId = new Map(),
  month = null,
  referenceDate = new Date(),
  currentNepalDate = null
} = {}) {
  const effectiveMonth = month
    ? String(month).trim()
    : (() => {
        const firstSess = (Array.isArray(sessions) ? sessions : []).find(
          (s) => s && (s.sessionDate || s.session_date)
        );
        if (firstSess) {
          return String(firstSess.sessionDate || firstSess.session_date).slice(0, 7);
        }
        return (currentNepalDate || formatNepalDate(referenceDate)).slice(0, 7);
      })();

  const calInfo = buildApplicableCalendarDatesForMonth(effectiveMonth, {
    referenceDate,
    currentNepalDate
  });
  const cleanMonth = calInfo.month;
  const maxAllowedDate = calInfo.endDate;

  const eligibleSessions = (Array.isArray(sessions) ? sessions : []).filter((s) => {
    if (!s) return false;
    const st = String(s.status || 'submitted').toLowerCase();
    if (st !== 'submitted' && st !== 'locked') return false;
    const sDate = String(s.sessionDate || s.session_date || '').trim();
    if (!sDate) return false;
    if (cleanMonth && !sDate.startsWith(`${cleanMonth}-`)) return false;
    if (!maxAllowedDate || sDate > maxAllowedDate) return false;
    return true;
  });

  // Sort chronologically: sessionDate ASC, submittedAt ASC, id ASC
  const chronologicalSessions = [...eligibleSessions].sort((a, b) => {
    const dateA = String(a.sessionDate || a.session_date || '');
    const dateB = String(b.sessionDate || b.session_date || '');
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const subA = String(a.submittedAt || a.submitted_at || '');
    const subB = String(b.submittedAt || b.submitted_at || '');
    if (subA !== subB) return subA.localeCompare(subB);
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  const numberedSessions = chronologicalSessions.map((s, idx) => {
    const sDate = String(s.sessionDate || s.session_date || '');
    return {
      ...s,
      id: s.id,
      sessionNumber: idx + 1,
      sessionDate: sDate,
      dateLabel: formatShortDateLabel(sDate),
      status: s.status || 'submitted',
      submittedAt: s.submittedAt || s.submitted_at || null,
      editWindow: s.editWindow || null,
      counts: s.counts || null
    };
  });

  // Index submitted sessions by YYYY-MM-DD calendar date
  const sessionByDate = new Map();
  for (const sess of numberedSessions) {
    sessionByDate.set(sess.sessionDate, sess);
  }

  const calendarDates = calInfo.dates.map((d) => {
    const sess = sessionByDate.get(d.date) || null;
    return {
      date: d.date,
      day: d.day,
      label: d.label,
      hasSession: Boolean(sess),
      sessionId: sess ? sess.id : null,
      sessionNumber: sess ? sess.sessionNumber : null,
      status: sess ? sess.status : null,
      submittedAt: sess ? sess.submittedAt : null
    };
  });

  const getStatusForSessionStudent = (sessionId, studentId) => {
    let sessionRecords = null;
    if (recordsBySessionId instanceof Map) {
      sessionRecords = recordsBySessionId.get(sessionId);
    } else if (recordsBySessionId && typeof recordsBySessionId === 'object') {
      sessionRecords = recordsBySessionId[sessionId];
    }
    if (!sessionRecords) return 'absent';
    if (sessionRecords instanceof Map) {
      const val = sessionRecords.get(studentId);
      if (typeof val === 'string') return val === 'present' ? 'present' : 'absent';
      if (val && typeof val === 'object') return val.status === 'present' ? 'present' : 'absent';
      return 'absent';
    }
    if (Array.isArray(sessionRecords)) {
      const found = sessionRecords.find((r) => String(r.studentId || r.student_id) === String(studentId));
      return found && found.status === 'present' ? 'present' : 'absent';
    }
    if (typeof sessionRecords === 'object') {
      const val = sessionRecords[studentId];
      if (typeof val === 'string') return val === 'present' ? 'present' : 'absent';
      if (val && typeof val === 'object') return val.status === 'present' ? 'present' : 'absent';
    }
    return 'absent';
  };

  const sortedStudents = sortStudentsAlphabetically(students);
  const totalSessions = numberedSessions.length;

  const rows = sortedStudents.map((stu) => {
    const studentId = String(stu.studentId || stu.student_id || '').trim();
    let consecutiveCount = 0;
    let presentCount = 0;
    let absentCount = 0;
    const cells = [];
    const sessionCells = [];

    for (const calCol of calendarDates) {
      if (!calCol.hasSession) {
        cells.push({
          date: calCol.date,
          sessionDate: calCol.date,
          day: calCol.day,
          label: calCol.label,
          hasSession: false,
          sessionId: null,
          sessionNumber: null,
          status: 'no_session',
          consecutiveCount: null,
          display: '-'
        });
        continue;
      }

      const status = getStatusForSessionStudent(calCol.sessionId, studentId);
      if (status === 'present') {
        presentCount += 1;
        consecutiveCount += 1;
        const cellObj = {
          date: calCol.date,
          sessionDate: calCol.date,
          day: calCol.day,
          label: calCol.label,
          hasSession: true,
          sessionId: calCol.sessionId,
          sessionNumber: calCol.sessionNumber,
          status: 'present',
          consecutiveCount,
          display: String(consecutiveCount)
        };
        cells.push(cellObj);
        sessionCells.push(cellObj);
      } else {
        absentCount += 1;
        const cellObj = {
          date: calCol.date,
          sessionDate: calCol.date,
          day: calCol.day,
          label: calCol.label,
          hasSession: true,
          sessionId: calCol.sessionId,
          sessionNumber: calCol.sessionNumber,
          status: 'absent',
          consecutiveCount: null,
          display: 'ABS'
        };
        cells.push(cellObj);
        sessionCells.push(cellObj);
      }
    }

    const rawPercentage = totalSessions > 0 ? (presentCount / totalSessions) * 100 : 0;
    const attendancePercentage = totalSessions > 0 ? Number(rawPercentage.toFixed(1)) : 0;
    const formattedPercentage = totalSessions > 0 ? `${rawPercentage.toFixed(1)}%` : '0.0%';

    return {
      studentId,
      name: String(stu.name || stu.studentName || studentId).trim(),
      username: stu.username || null,
      role: String(stu.role || 'student').toLowerCase(),
      cells,
      dateCells: cells,
      calendarCells: cells,
      sessionCells,
      presentCount,
      absentCount,
      totalSessions,
      attendancePercentage,
      formattedPercentage,
      remark: ''
    };
  });

  return {
    month: cleanMonth,
    monthLabel: calInfo.monthLabel,
    startDate: calInfo.startDate,
    endDate: calInfo.endDate,
    dateRangeLabel: calInfo.dateRangeLabel,
    daysInMonth: calInfo.daysInMonth,
    applicableEndDay: calInfo.applicableEndDay,
    calendarDates,
    dates: calendarDates,
    totalSessions,
    sessions: numberedSessions,
    rows,
    students: rows
  };
}

/**
 * Generates a deterministic CSV export from a monthly attendance matrix result.
 * Uses underlying attendance records for all totals and percentages.
 */
function exportMonthlyAttendanceCsv(matrixData) {
  const sessions = Array.isArray(matrixData && matrixData.sessions) ? matrixData.sessions : [];
  const rows = Array.isArray(matrixData && matrixData.rows) ? matrixData.rows : [];

  const escapeCsvCell = (val) => {
    if (val === null || val === undefined) return '';
    let str = String(val).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    if (/^[=+\-@]/.test(str) || /^[\t\r\n]/.test(str) || /^\s+[=+\-@]/.test(str)) {
      str = `'${str}`;
    }
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerCells = [
    'Student ID',
    'Student',
    ...sessions.map((s) => `${s.sessionNumber} (${s.sessionDate})`),
    'Sessions Attended',
    'Sessions Absent',
    'Total Sessions',
    'Attendance %'
  ];

  const lines = [headerCells.map(escapeCsvCell).join(',')];

  for (const row of rows) {
    const totalSessions = Number(row.totalSessions || 0);
    const presentCount = Number(row.presentCount || 0);
    const absentCount = Number(row.absentCount || 0);
    const rawPct = totalSessions > 0 ? (presentCount / totalSessions) * 100 : 0;
    const formattedPct = totalSessions > 0 ? `${rawPct.toFixed(1)}%` : '0.0%';

    const csvCells = Array.isArray(row.sessionCells) ? row.sessionCells : (row.cells || []);
    const lineCells = [
      row.studentId,
      row.name,
      ...csvCells.map((c) => c.display),
      presentCount,
      absentCount,
      totalSessions,
      formattedPct
    ];
    lines.push(lineCells.map(escapeCsvCell).join(','));
  }

  return lines.join('\n') + '\n';
}

/**
 * Escapes XML special characters and strips XML-illegal control characters
 * while preserving all valid Unicode / Nepali Devanagari characters.
 */
function escapeSvgXml(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates an official, standalone, printable A4 Landscape SVG attendance sheet.
 *
 * Layout & Pagination strategy:
 * - Page size: A4 Landscape (297mm × 210mm, coordinate canvas 1684 × 1190 per page).
 * - Multi-page pagination: Fits up to 25 student rows per A4 landscape page so text and row heights
 *   are never shrunk to illegible sizes. If a cohort exceeds 25 students, renders multiple full
 *   A4 landscape pages stacked vertically in the SVG, repeating the official Gandaki University
 *   metadata header and table column headings on every page and placing the handwritten signature
 *   block after the table on the final page.
 */
function exportMonthlyAttendanceSvg(matrixData = {}) {
  const PAGE_WIDTH = 1684;
  const PAGE_HEIGHT = 1190;
  const MARGIN_X = 44;
  const TABLE_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 1596
  const ROWS_PER_PAGE = 25;

  const monthStr = String(matrixData.month || '');
  const monthLabel = String(matrixData.monthLabel || formatMonthDisplayLabel(monthStr) || monthStr);
  const subjectObj = matrixData.subject || {};
  const cohortObj = matrixData.cohort || {};
  const semesterNo = subjectObj.semester || cohortObj.currentSemester || '';
  const semesterLabel = String(
    matrixData.semesterLabel ||
      (semesterNo ? `Semester ${semesterNo}` : '')
  ).trim();
  const subjectLabel = String(
    matrixData.subjectLabel ||
      (subjectObj.code && subjectObj.name
        ? `${subjectObj.code} — ${subjectObj.name}`
        : subjectObj.name || subjectObj.code || '')
  ).trim();
  const teacherName = String(
    matrixData.teacherName ||
      (matrixData.teacher && matrixData.teacher.name) ||
      ''
  ).trim();

  const calendarDates = Array.isArray(matrixData.calendarDates) ? matrixData.calendarDates : [];
  const allRows = sortStudentsAlphabetically(Array.isArray(matrixData.rows) ? matrixData.rows : []);

  const totalStudentCount = allRows.length;
  const pageCount = Math.max(1, Math.ceil(Math.max(1, totalStudentCount) / ROWS_PER_PAGE));
  const totalSvgHeight = PAGE_HEIGHT * pageCount;
  const totalHeightMm = 210 * pageCount;

  // Column width calculation
  const nameColWidth = 236;
  const pctColWidth = 92;
  const remarkColWidth = 128;
  const dateCount = calendarDates.length;
  const remainingWidth = TABLE_WIDTH - nameColWidth - pctColWidth - remarkColWidth; // 1140
  const dateColWidth = dateCount > 0 ? remainingWidth / dateCount : 0;

  const fontStack =
    "'Inter', -apple-system, BlinkMacSystemFont, 'Noto Sans Devanagari', 'Mukta', 'Mangal', 'Kohinoor Devanagari', 'Segoe UI', Arial, sans-serif";

  const pagesSvg = [];

  for (let pIdx = 0; pIdx < pageCount; pIdx++) {
    const pageOffsetY = pIdx * PAGE_HEIGHT;
    const pageRows = allRows.slice(pIdx * ROWS_PER_PAGE, (pIdx + 1) * ROWS_PER_PAGE);
    const isFinalPage = pIdx === pageCount - 1;

    const headerCenterX = PAGE_WIDTH / 2;
    const titleY = 52;
    const subtitleY = 82;
    const metaBoxTop = 100;
    const metaBoxHeight = 52;
    const tableTopY = 166;
    const tableHeaderHeight = 36;
    const rowHeight = 28;

    // Metadata bar coordinates
    const col1X = MARGIN_X + 14;
    const col2X = MARGIN_X + 360;
    const col3X = MARGIN_X + 690;
    const col4X = MARGIN_X + 1210;

    // Build table column headers & vertical grid lines
    const headerCellsSvg = [];
    const colXPositions = [];

    let curX = MARGIN_X;
    // 1. Name column
    colXPositions.push({ x: curX, width: nameColWidth, type: 'name' });
    headerCellsSvg.push(
      `<text x="${(curX + 10).toFixed(2)}" y="${tableTopY + 23}" class="th-text" text-anchor="start">Name</text>`
    );
    curX += nameColWidth;

    // 2. Calendar Date columns (1st through applicable end date)
    for (let dIdx = 0; dIdx < dateCount; dIdx++) {
      const dCol = calendarDates[dIdx];
      const cx = curX + dateColWidth / 2;
      colXPositions.push({ x: curX, width: dateColWidth, type: 'date', dateCol: dCol });
      headerCellsSvg.push(
        `<text x="${cx.toFixed(2)}" y="${tableTopY + 23}" class="th-date-text" text-anchor="middle">${escapeSvgXml(dCol.label)}</text>`
      );
      curX += dateColWidth;
    }

    // 3. Attendance % column
    const pctX = curX;
    colXPositions.push({ x: pctX, width: pctColWidth, type: 'pct' });
    headerCellsSvg.push(
      `<text x="${(pctX + pctColWidth / 2).toFixed(2)}" y="${tableTopY + 23}" class="th-text" text-anchor="middle">Attendance %</text>`
    );
    curX += pctColWidth;

    // 4. Remark column
    const remarkX = curX;
    colXPositions.push({ x: remarkX, width: remarkColWidth, type: 'remark' });
    headerCellsSvg.push(
      `<text x="${(remarkX + remarkColWidth / 2).toFixed(2)}" y="${tableTopY + 23}" class="th-text" text-anchor="middle">Remark</text>`
    );
    curX += remarkColWidth;

    const renderedRowCount = Math.max(1, pageRows.length);
    const tableBodyHeight = renderedRowCount * rowHeight;
    const tableTotalHeight = tableHeaderHeight + tableBodyHeight;
    const tableBottomY = tableTopY + tableTotalHeight;

    // Build student rows
    const bodyRowsSvg = [];
    if (pageRows.length === 0) {
      const rY = tableTopY + tableHeaderHeight;
      bodyRowsSvg.push(
        `<line x1="${MARGIN_X}" y1="${rY + rowHeight}" x2="${MARGIN_X + TABLE_WIDTH}" y2="${rY + rowHeight}" stroke="#000000" stroke-width="1"/>`,
        `<text x="${MARGIN_X + 12}" y="${rY + 19}" class="td-name">No students enrolled</text>`
      );
    } else {
      for (let rIdx = 0; rIdx < pageRows.length; rIdx++) {
        const row = pageRows[rIdx];
        const rY = tableTopY + tableHeaderHeight + rIdx * rowHeight;
        const textBaselineY = rY + 19;

        // Horizontal row divider
        bodyRowsSvg.push(
          `<line x1="${MARGIN_X}" y1="${rY + rowHeight}" x2="${MARGIN_X + TABLE_WIDTH}" y2="${rY + rowHeight}" stroke="#000000" stroke-width="0.8"/>`
        );

        // 1. Student Name cell
        bodyRowsSvg.push(
          `<text x="${(MARGIN_X + 8).toFixed(2)}" y="${textBaselineY}" class="td-name" text-anchor="start">${escapeSvgXml(row.name)}</text>`
        );

        // 2. Date cells
        const rowCells = Array.isArray(row.dateCells)
          ? row.dateCells
          : Array.isArray(row.cells)
          ? row.cells
          : [];
        for (let dIdx = 0; dIdx < dateCount; dIdx++) {
          const cellX = MARGIN_X + nameColWidth + dIdx * dateColWidth;
          const cellCenterX = cellX + dateColWidth / 2;
          const cellObj = rowCells[dIdx];
          const displayVal = cellObj && cellObj.display !== undefined ? String(cellObj.display) : '-';
          const cellClass =
            displayVal === 'ABS'
              ? 'td-abs'
              : displayVal === '-'
              ? 'td-dash'
              : 'td-num';
          bodyRowsSvg.push(
            `<text x="${cellCenterX.toFixed(2)}" y="${textBaselineY}" class="${cellClass}" text-anchor="middle">${escapeSvgXml(displayVal)}</text>`
          );
        }

        // 3. Attendance % cell
        const pctText =
          row.formattedPercentage ||
          (row.totalSessions > 0 ? `${Number(row.attendancePercentage || 0).toFixed(1)}%` : '0.0%');
        bodyRowsSvg.push(
          `<text x="${(pctX + pctColWidth - 8).toFixed(2)}" y="${textBaselineY}" class="td-pct" text-anchor="end">${escapeSvgXml(pctText)}</text>`
        );

        // 4. Remark cell: intentionally left blank for the teacher to fill in by hand
      }
    }

    // Build vertical column border lines
    const verticalLinesSvg = [];
    for (const col of colXPositions) {
      verticalLinesSvg.push(
        `<line x1="${col.x.toFixed(2)}" y1="${tableTopY}" x2="${col.x.toFixed(2)}" y2="${tableBottomY}" stroke="#000000" stroke-width="0.8"/>`
      );
    }
    verticalLinesSvg.push(
      `<line x1="${(MARGIN_X + TABLE_WIDTH).toFixed(2)}" y1="${tableTopY}" x2="${(MARGIN_X + TABLE_WIDTH).toFixed(2)}" y2="${tableBottomY}" stroke="#000000" stroke-width="1.2"/>`
    );

    // Signature section on the final page, placed below the student table
    let signatureSvg = '';
    if (isFinalPage) {
      const sigTopY = Math.min(PAGE_HEIGHT - 120, Math.max(tableBottomY + 42, PAGE_HEIGHT - 150));
      const sigRow2Y = sigTopY + 44;
      const sigRow3Y = sigTopY + 88;
      const leftColX = MARGIN_X + 8;
      const rightColX = MARGIN_X + 920;

      signatureSvg = `
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

    pagesSvg.push(`
      <g class="svg-print-page" data-page="${pIdx + 1}" transform="translate(0, ${pageOffsetY})">
        <rect x="0" y="0" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="#ffffff"/>
        ${
          pIdx > 0
            ? `<line x1="0" y1="0" x2="${PAGE_WIDTH}" y2="0" stroke="#000000" stroke-width="1" stroke-dasharray="6,6"/>`
            : ''
        }

        <!-- Centered Official University & Sheet Title -->
        <text x="${headerCenterX}" y="${titleY}" class="uni-title" text-anchor="middle">Gandaki University</text>
        <text x="${headerCenterX}" y="${subtitleY}" class="sheet-title" text-anchor="middle">MONTHLY ATTENDANCE</text>
        ${pageIndicatorSvg}

        <!-- Metadata Header Box -->
        <rect x="${MARGIN_X}" y="${metaBoxTop}" width="${TABLE_WIDTH}" height="${metaBoxHeight}" fill="#ffffff" stroke="#000000" stroke-width="1.2"/>
        <text x="${col1X}" y="${metaBoxTop + 31}" class="meta-text"><tspan class="meta-label">Month:</tspan> ${escapeSvgXml(monthLabel)}</text>
        <text x="${col2X}" y="${metaBoxTop + 31}" class="meta-text"><tspan class="meta-label">Semester:</tspan> ${escapeSvgXml(semesterLabel)}</text>
        <text x="${col3X}" y="${metaBoxTop + 31}" class="meta-text"><tspan class="meta-label">Subject:</tspan> ${escapeSvgXml(subjectLabel)}</text>
        <text x="${col4X}" y="${metaBoxTop + 31}" class="meta-text"><tspan class="meta-label">Teacher Name:</tspan> ${escapeSvgXml(teacherName)}</text>

        <!-- Attendance Table -->
        <rect x="${MARGIN_X}" y="${tableTopY}" width="${TABLE_WIDTH}" height="${tableTotalHeight}" fill="#ffffff" stroke="#000000" stroke-width="1.2"/>
        <rect x="${MARGIN_X}" y="${tableTopY}" width="${TABLE_WIDTH}" height="${tableHeaderHeight}" fill="#f4f4f5" stroke="#000000" stroke-width="1.2"/>

        ${headerCellsSvg.join('\n        ')}
        ${bodyRowsSvg.join('\n        ')}
        ${verticalLinesSvg.join('\n        ')}

        ${signatureSvg}
      </g>
    `);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="${totalHeightMm}mm" viewBox="0 0 ${PAGE_WIDTH} ${totalSvgHeight}" role="img" aria-label="Gandaki University Monthly Attendance Sheet — ${escapeSvgXml(subjectLabel)} (${escapeSvgXml(monthLabel)})">`,
    '  <style>',
    `    text { font-family: ${fontStack}; fill: #000000; }`,
    '    .uni-title { font-size: 24px; font-weight: 800; letter-spacing: 0.02em; }',
    '    .sheet-title { font-size: 16px; font-weight: 700; letter-spacing: 0.08em; }',
    '    .page-num-text { font-size: 11px; font-weight: 600; }',
    '    .meta-text { font-size: 12.5px; font-weight: 500; }',
    '    .meta-label { font-weight: 700; }',
    '    .th-text { font-size: 11px; font-weight: 700; }',
    '    .th-date-text { font-size: 9.5px; font-weight: 700; }',
    '    .td-name { font-size: 11px; font-weight: 600; }',
    '    .td-num { font-size: 10.5px; font-weight: 700; }',
    '    .td-abs { font-size: 9.5px; font-weight: 700; }',
    '    .td-dash { font-size: 11px; font-weight: 400; }',
    '    .td-pct { font-size: 10.5px; font-weight: 700; }',
    '    .sig-text { font-size: 12.5px; font-weight: 600; }',
    '  </style>',
    ...pagesSvg,
    '</svg>',
    ''
  ].join('\n');
}

/**
 * Loads the numbered monthly attendance matrix and per-student detailed attendance history
 * for an authorized teacher or admin.
 */
async function getMonthlyAttendanceRegister(db, {
  actorUserId,
  subjectId,
  cohortId,
  month = null,
  now = new Date()
}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  const selectedMonth = validateMonthString(month, { referenceDate: effectiveNow });

  // Validate teacher-subject authorization and resolve cohort
  const { subject, cohort } = await resolveAndValidateSubjectAndCohort(db, {
    actor,
    subjectInput: subjectId,
    cohortInput: cohortId,
    requireActiveCohortAndSemesterMatch: false
  });

  // Resolve assigned teacher name for the subject
  let resolvedTeacher = null;
  if (actor.role === 'teacher') {
    resolvedTeacher = {
      id: actor.studentId,
      userId: actor.studentId,
      name: actor.name || actor.studentId
    };
  } else {
    const assignedTeacherRow = await db.get(
      `SELECT t.id AS teacher_id, t.user_id, stu.name AS teacher_name
       FROM teacher_subjects ts
       JOIN teachers t ON t.id = ts.teacher_id
       LEFT JOIN students stu ON stu.studentId = t.user_id
       WHERE ts.subject_id = ? AND t.status = 'active'
       ORDER BY ts.created_at ASC
       LIMIT 1`,
      subject.id
    );
    if (assignedTeacherRow) {
      resolvedTeacher = {
        id: assignedTeacherRow.teacherId || assignedTeacherRow.teacher_id,
        userId: assignedTeacherRow.userId || assignedTeacherRow.user_id,
        name: assignedTeacherRow.teacherName || assignedTeacherRow.teacher_name || actor.name
      };
    } else {
      resolvedTeacher = {
        id: actor.studentId,
        userId: actor.studentId,
        name: actor.name || actor.studentId
      };
    }
  }

  // Query all finalized sessions for this subject + cohort across all months
  const allSessionRows = (await db.all(
    `SELECT s.*,
            sub.code AS subject_code,
            sub.name AS subject_name,
            c.display_name AS cohort_name,
            c.slot_code,
            (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id) AS total_records,
            (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id AND ar.status = 'present') AS present_count,
            (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id AND ar.status = 'absent') AS absent_count
     FROM attendance_sessions s
     LEFT JOIN subjects sub ON sub.id = s.subject_id
     LEFT JOIN cohorts c ON c.id = s.cohort_id
     WHERE s.cohort_id = ?
       AND s.subject_id = ?
       AND s.status IN ('submitted', 'locked')
     ORDER BY s.session_date ASC, s.submitted_at ASC, s.id ASC`,
    cohort.id,
    subject.id
  )) || [];

  const finalizedSessionRows = allSessionRows.filter(
    (r) => Number(r.total_records ?? r.totalrecords ?? 0) > 0
  );

  // If cohort is not currently active in the subject's semester and has no historical sessions for this subject, enforce strict match
  if (
    finalizedSessionRows.length === 0 &&
    (cohort.status !== 'active' || Number(cohort.currentSemester) !== Number(subject.semester))
  ) {
    await resolveAndValidateSubjectAndCohort(db, {
      actor,
      subjectInput: subjectId,
      cohortInput: cohortId,
      requireActiveCohortAndSemesterMatch: true
    });
  }

  const formattedAllSessions = finalizedSessionRows.map((r) => {
    const totalCount = Number(r.total_records ?? r.totalrecords ?? 0);
    const presentCount = Number(r.present_count ?? r.presentcount ?? 0);
    const absentCount = Number(r.absent_count ?? r.absentcount ?? 0);
    const rawPct = totalCount > 0 ? (presentCount / totalCount) * 100 : 0;

    return {
      ...formatSessionObject(r, effectiveNow),
      counts: {
        total: totalCount,
        present: presentCount,
        absent: absentCount,
        attendancePercentage: totalCount > 0 ? Number(rawPct.toFixed(1)) : 0
      }
    };
  });

  // Collect available months (always include current Nepal month and selectedMonth)
  const currentNepalDate = formatNepalDate(effectiveNow);
  const currentNepalMonth = currentNepalDate.slice(0, 7);
  const monthSet = new Set([currentNepalMonth, selectedMonth]);
  for (const sess of formattedAllSessions) {
    if (sess.sessionDate && sess.sessionDate.length >= 7) {
      monthSet.add(sess.sessionDate.slice(0, 7));
    }
  }
  const availableMonths = [...monthSet].sort((a, b) => b.localeCompare(a));

  // Query active cohort roster + batch-load all records for finalized sessions
  const activeRoster = await queryCohortEligibleRoster(db, cohort.id);
  const studentsById = new Map(activeRoster.map((s) => [s.studentId, s]));

  const recordsBySessionId = new Map();
  if (formattedAllSessions.length > 0) {
    const sessionIds = formattedAllSessions.map((s) => s.id);
    const ph = sessionIds.map(() => '?').join(', ');
    const recordRows = (await db.all(
      `SELECT ar.id, ar.session_id, ar.student_id, ar.status, ar.marked_by, ar.created_at, ar.updated_at,
              stu.name AS student_name, stu.username AS student_username, stu.role AS student_role
       FROM attendance_records ar
       LEFT JOIN students stu ON stu.studentId = ar.student_id
       WHERE ar.session_id IN (${ph})
       ORDER BY ar.student_id ASC`,
      ...sessionIds
    )) || [];

    for (const r of recordRows) {
      const sid = r.sessionId || r.session_id;
      const stuId = r.studentId || r.student_id;
      if (!recordsBySessionId.has(sid)) {
        recordsBySessionId.set(sid, new Map());
      }
      recordsBySessionId.get(sid).set(stuId, {
        id: r.id,
        sessionId: sid,
        studentId: stuId,
        status: r.status === 'present' ? 'present' : 'absent',
        markedBy: r.markedBy || r.marked_by || null,
        updatedAt: r.updatedAt || r.updated_at || null
      });

      if (!studentsById.has(stuId)) {
        studentsById.set(stuId, {
          studentId: stuId,
          name: r.studentName || r.student_name || stuId,
          username: r.studentUsername || r.student_username || null,
          role: String(r.studentRole || r.student_role || 'student').toLowerCase(),
          cohortId: cohort.id
        });
      }
    }
  }

  const allStudents = sortStudentsAlphabetically([...studentsById.values()]);

  // Build matrix for the selected month
  const monthlyMatrix = buildMonthlyAttendanceMatrix({
    students: allStudents,
    sessions: formattedAllSessions,
    recordsBySessionId,
    month: selectedMonth,
    referenceDate: effectiveNow,
    currentNepalDate
  });

  // Build per-student detailed attendance history across all sessions of this subject + cohort
  // (with per-month consecutive numbering and overall subject totals)
  const studentHistory = {};
  for (const stu of allStudents) {
    studentHistory[stu.studentId] = {
      studentId: stu.studentId,
      name: stu.name,
      username: stu.username || null,
      role: stu.role || 'student',
      overallTotalSessions: formattedAllSessions.length,
      overallPresentCount: 0,
      overallAbsentCount: 0,
      overallAttendancePercentage: 0,
      overallFormattedPercentage: '0.0%',
      sessions: []
    };
  }

  // Group all sessions by month to compute accurate monthly consecutive numbers in history
  const sessionsByMonth = new Map();
  for (const sess of formattedAllSessions) {
    const m = String(sess.sessionDate || '').slice(0, 7);
    if (!sessionsByMonth.has(m)) sessionsByMonth.set(m, []);
    sessionsByMonth.get(m).push(sess);
  }

  for (const [mKey, mSessions] of sessionsByMonth.entries()) {
    const mMatrix = buildMonthlyAttendanceMatrix({
      students: allStudents,
      sessions: mSessions,
      recordsBySessionId,
      month: mKey,
      referenceDate: effectiveNow,
      currentNepalDate
    });
    for (const row of mMatrix.rows) {
      const hist = studentHistory[row.studentId];
      if (!hist) continue;
      hist.overallPresentCount += row.presentCount;
      hist.overallAbsentCount += row.absentCount;
      for (const cell of row.sessionCells || []) {
        const recMeta = recordsBySessionId.get(cell.sessionId)?.get(row.studentId) || null;
        hist.sessions.push({
          sessionId: cell.sessionId,
          month: mKey,
          sessionNumberInMonth: cell.sessionNumber,
          sessionDate: cell.sessionDate,
          status: cell.status,
          consecutiveCount: cell.consecutiveCount,
          display: cell.display,
          updatedAt: recMeta ? recMeta.updatedAt : null
        });
      }
    }
  }

  for (const stu of allStudents) {
    const hist = studentHistory[stu.studentId];
    const total = hist.overallTotalSessions;
    const rawPct = total > 0 ? (hist.overallPresentCount / total) * 100 : 0;
    hist.overallAttendancePercentage = total > 0 ? Number(rawPct.toFixed(1)) : 0;
    hist.overallFormattedPercentage = total > 0 ? `${rawPct.toFixed(1)}%` : '0.0%';
  }

  const semesterLabel = `Semester ${subject.semester}`;
  const subjectLabel = subject.code && subject.name ? `${subject.code} — ${subject.name}` : subject.name || subject.code;

  return {
    subject,
    cohort,
    teacher: resolvedTeacher,
    teacherName: resolvedTeacher.name,
    semesterLabel,
    subjectLabel,
    month: selectedMonth,
    monthLabel: monthlyMatrix.monthLabel,
    startDate: monthlyMatrix.startDate,
    endDate: monthlyMatrix.endDate,
    dateRangeLabel: monthlyMatrix.dateRangeLabel,
    daysInMonth: monthlyMatrix.daysInMonth,
    applicableEndDay: monthlyMatrix.applicableEndDay,
    calendarDates: monthlyMatrix.calendarDates,
    dates: monthlyMatrix.calendarDates,
    availableMonths,
    totalSessions: monthlyMatrix.totalSessions,
    sessions: monthlyMatrix.sessions,
    rows: monthlyMatrix.rows,
    students: monthlyMatrix.rows,
    studentHistory
  };
}

module.exports = {
  EDIT_WINDOW_HOURS,
  EDIT_WINDOW_MS,
  ELIGIBILITY_THRESHOLD_KEY,
  VALID_ATTENDANCE_STATUSES,
  compareStudentsAlphabetically,
  sortStudentsAlphabetically,
  validateSessionDate,
  validateMonthString,
  formatMonthDisplayLabel,
  formatShortDateLabel,
  buildApplicableCalendarDatesForMonth,
  buildMonthlyAttendanceMatrix,
  exportMonthlyAttendanceCsv,
  exportMonthlyAttendanceSvg,
  escapeSvgXml,
  getMonthlyAttendanceRegister,
  ensureAttendanceSchema,
  serializeCanonicalJson,
  computeCanonicalSnapshotHash,
  buildCanonicalSnapshotPayload,
  formatBackupRevisionRow,
  listSessionBackupRevisions,
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
  ...backupService
};
