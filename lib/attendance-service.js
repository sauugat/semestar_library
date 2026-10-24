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

  let subjects = [];
  if (actor.role === 'teacher') {
    subjects = await getTeacherSubjects(db, actor.studentId);
  } else {
    const activeCheck = db.isPostgres ? '(active = TRUE OR active IS NULL)' : '(active = 1 OR active IS NULL)';
    const rows = (await db.all(
      `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature
       FROM subjects
       WHERE ${activeCheck}
       ORDER BY semester ASC, code ASC`
    )) || [];
    subjects = rows.map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      title: r.name,
      semester: Number(r.semester),
      department: r.department || 'BIT',
      creditHours: Number(r.creditHours || r.credithours || 3.0),
      nature: r.nature || null
    }));
  }

  const activeCohortsRaw = (await db.all(
    `SELECT id, slot_code, display_name, current_semester, intake_year, intake_identifier, status
     FROM cohorts
     WHERE status = 'active'
     ORDER BY current_semester ASC, slot_code ASC`
  )) || [];

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

  const thresholdConfig = await getEligibilityThresholdConfig(db);

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
 * Queries the authoritative active student/CR roster for a specific cohort_id.
 * Strictly uses cohort_id; never includes unassigned students based on semester text.
 */
async function queryCohortEligibleRoster(client, cohortId) {
  const rows = (await client.all(
    `SELECT studentId, username, name, email, role, department, semester, cohort_id, avatarUrl, account_status
     FROM students
     WHERE cohort_id = ?
       AND LOWER(COALESCE(role, 'student')) IN ('student', 'cr')
       AND LOWER(COALESCE(account_status, 'active')) = 'active'
     ORDER BY studentId ASC`,
    cohortId
  )) || [];

  return rows.map(r => ({
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

  const roster = await queryCohortEligibleRoster(db, cohort.id);

  const existingSessionRow = await db.get(
    `SELECT * FROM attendance_sessions
     WHERE cohort_id = ? AND subject_id = ? AND session_date = ?`,
    cohort.id,
    subject.id,
    resolvedDate
  );

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

  const lockKey = `${cohort.id}:${subject.id}:${cleanDate}`;
  return await withSessionLock(lockKey, async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 5; attempt++) {
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

        if (!isRetryableConflict || attempt === 5) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 15 * attempt));
      }
    }
    throw lastErr;
  });
}

/**
 * 5b. Edits an existing session by sessionId within the 24-hour window.
 */
async function editAttendanceSessionById(db, {
  actorUserId,
  sessionId,
  records,
  reason = null,
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

  const lockKey = `${preSession.cohortId || preSession.cohort_id}:${preSession.subjectId || preSession.subject_id}:${preSession.sessionDate || preSession.session_date}`;
  return await withSessionLock(lockKey, async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 5; attempt++) {
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
        if (!isRetryableConflict || attempt === 5) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 15 * attempt));
      }
    }
    throw lastErr;
  });
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
  const context = await getAcademicContext(db, { studentId: actor.studentId });
  const thresholdConfig = await getEligibilityThresholdConfig(db);

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

  const subjectsRows = (await db.all(
    `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature
     FROM subjects
     WHERE semester = ? AND ${activeCheck}
     ORDER BY code ASC`,
    semesterNo
  )) || [];

  // Query all finalized sessions for the student's cohort and current semester
  // Exclude any draft session or session with 0 records
  const sessionRows = (await db.all(
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
  )) || [];

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

module.exports = {
  EDIT_WINDOW_HOURS,
  EDIT_WINDOW_MS,
  ELIGIBILITY_THRESHOLD_KEY,
  VALID_ATTENDANCE_STATUSES,
  validateSessionDate,
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
