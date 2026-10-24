'use strict';

const crypto = require('crypto');
const { getTeacherSubjects, validateTeacherSubjectAuthorization } = require('./teacher-service');
const { formatNepalDate } = require('./nepali-dates');
const {
  XLSX_MIME_TYPE,
  sanitizeWorksheetName,
  sanitizeWorkbookFilename,
  buildXlsxWorkbookBuffer
} = require('./attendance-xlsx');

const DEFAULT_LEASE_DURATION_MS = 2 * 60 * 1000; // 120 seconds
const MIN_LEASE_DURATION_MS = 1000;              // 1s minimum (supports fast lease-expiry tests)
const MAX_LEASE_DURATION_MS = 5 * 60 * 1000;     // 5m maximum
const MAX_BACKUP_ATTEMPTS = 5;
const MAX_ANNUAL_WORKBOOK_SESSIONS = 2500;

const VALID_ARTIFACT_TYPES = ['snapshot', 'daily_workbook', 'annual_workbook'];
const VALID_ARTIFACT_TYPE_SET = new Set(VALID_ARTIFACT_TYPES);
const VALID_CONNECTION_STATUSES = new Set(['disconnected', 'connected', 'reconnect_required']);

const FORBIDDEN_SECRET_KEYS = new Set([
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'oauthtoken',
  'oauth_token',
  'authtoken',
  'auth_token',
  'bearertoken',
  'bearer_token',
  'authorizationcode',
  'authorization_code',
  'authcode',
  'auth_code',
  'code',
  'clientsecret',
  'client_secret',
  'secret',
  'privatekey',
  'private_key',
  'password',
  'passwordhash',
  'password_hash',
  'apikey',
  'api_key',
  'credentials'
]);

const FORBIDDEN_TOKEN_VALUE_PATTERNS = [
  /^ya29\.[A-Za-z0-9._-]{10,}/,
  /^1\/\/[A-Za-z0-9._-]{10,}/,
  /^GOCSPX-[A-Za-z0-9._-]{8,}/,
  /^Bearer\s+[A-Za-z0-9._-]{10,}/i,
  /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/
];

function createHttpError(status, message, code = null) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  if (code) err.code = code;
  return err;
}

/**
 * Rejects any request payload that attempts to send OAuth access tokens,
 * refresh tokens, authorization codes, client secrets, or raw credentials.
 */
function assertNoForbiddenSecrets(payload, contextLabel = 'request payload') {
  if (!payload || typeof payload !== 'object') return;

  const visit = (node, pathPrefix) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, idx) => visit(item, `${pathPrefix}[${idx}]`));
      return;
    }

    for (const [rawKey, value] of Object.entries(node)) {
      const normKey = String(rawKey).trim().toLowerCase();
      if (FORBIDDEN_SECRET_KEYS.has(normKey)) {
        throw createHttpError(
          400,
          `Forbidden credential field "${rawKey}" in ${contextLabel}. OAuth tokens, authorization codes, and secrets must never be sent to the backend.`,
          'SENSITIVE_TOKEN_FORBIDDEN'
        );
      }

      if (typeof value === 'string') {
        const trimmedVal = value.trim();
        for (const pattern of FORBIDDEN_TOKEN_VALUE_PATTERNS) {
          if (pattern.test(trimmedVal)) {
            throw createHttpError(
              400,
              `Forbidden credential or token pattern detected in "${rawKey}" of ${contextLabel}.`,
              'SENSITIVE_TOKEN_FORBIDDEN'
            );
          }
        }
      } else if (value && typeof value === 'object') {
        visit(value, `${pathPrefix}.${rawKey}`);
      }
    }
  };

  visit(payload, 'body');
}

/**
 * Sanitizes client-reported or runtime backup error messages so OAuth tokens,
 * authorization headers, query-string codes, and secrets are never persisted.
 */
function sanitizeBackupErrorMessage(rawMessage) {
  if (rawMessage === null || rawMessage === undefined) return null;
  let cleaned = String(rawMessage)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[REDACTED_GOOGLE_TOKEN]')
    .replace(/1\/\/[A-Za-z0-9._-]+/g, '[REDACTED_REFRESH_TOKEN]')
    .replace(/GOCSPX-[A-Za-z0-9._-]+/g, '[REDACTED_CLIENT_SECRET]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[REDACTED_JWT]')
    .replace(/([?&](?:access_token|refresh_token|id_token|code|client_secret|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:access_token|refresh_token|id_token|client_secret|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/[\u0000-\u001F]+/g, ' ')
    .trim();

  if (!cleaned) return null;
  return cleaned.slice(0, 240);
}

function sanitizeBackupErrorCode(rawCode, fallback = 'BACKUP_FAILED') {
  if (!rawCode || typeof rawCode !== 'string') return fallback;
  const cleaned = rawCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.-]+/g, '_')
    .slice(0, 64);
  return cleaned || fallback;
}

/**
 * Validates that a Google Drive folder/file ID is a clean non-secret identifier.
 */
function validateDriveId(rawId, fieldName = 'driveFileId', { required = true } = {}) {
  if (rawId === null || rawId === undefined || String(rawId).trim() === '') {
    if (!required) return null;
    throw createHttpError(400, `${fieldName} is required.`, 'INVALID_DRIVE_ID');
  }
  const clean = String(rawId).trim();
  for (const pattern of FORBIDDEN_TOKEN_VALUE_PATTERNS) {
    if (pattern.test(clean)) {
      throw createHttpError(400, `${fieldName} contains a forbidden token pattern.`, 'SENSITIVE_TOKEN_FORBIDDEN');
    }
  }
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(clean)) {
    throw createHttpError(
      400,
      `Invalid ${fieldName}. Expected an alphanumeric Google Drive identifier (3–128 characters).`,
      'INVALID_DRIVE_ID'
    );
  }
  return clean;
}

/**
 * Authoritatively resolves the authenticated user from the students table.
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
 * Resolves the canonical teacher profile in the teachers table for an authenticated teacher account,
 * ensuring the 1:1 foreign-key anchor in `teachers` exists and is active.
 */
async function resolveCanonicalTeacherProfile(db, actor) {
  if (!actor || actor.role !== 'teacher') {
    throw createHttpError(403, 'Forbidden: Teacher account required.', 'TEACHER_REQUIRED');
  }

  let teacher = await db.get(
    'SELECT id, user_id, status, designation FROM teachers WHERE user_id = ? OR id = ?',
    actor.studentId,
    actor.studentId
  );

  if (!teacher) {
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
    ) || { id: actor.studentId, user_id: actor.studentId, status: 'active', designation: 'Instructor' };
  }

  if (String(teacher.status || 'active').toLowerCase() !== 'active') {
    throw createHttpError(403, 'Teacher account is inactive.', 'TEACHER_INACTIVE');
  }

  return {
    id: teacher.id,
    teacherId: teacher.id,
    userId: teacher.userId || teacher.user_id || actor.studentId,
    status: teacher.status || 'active',
    designation: teacher.designation || 'Instructor'
  };
}

/**
 * Rejects any client-supplied teacherId, userId, studentId, or role that attempts
 * to impersonate or target another user.
 */
function assertNoForgedOwnership(actor, teacherProfile, inputObj = {}) {
  if (!inputObj || typeof inputObj !== 'object') return;

  const suppliedRole = inputObj.role !== undefined ? String(inputObj.role).trim().toLowerCase() : null;
  if (suppliedRole && suppliedRole !== actor.role) {
    throw createHttpError(
      403,
      'Forbidden: Cannot override authenticated role.',
      'OWNERSHIP_FORGERY_REJECTED'
    );
  }

  if (actor.role === 'teacher' && teacherProfile) {
    const rawTeacherId = inputObj.teacherId ?? inputObj.teacher_id ?? null;
    if (
      rawTeacherId !== null &&
      rawTeacherId !== undefined &&
      String(rawTeacherId).trim() !== '' &&
      String(rawTeacherId).trim() !== teacherProfile.teacherId &&
      String(rawTeacherId).trim() !== actor.studentId
    ) {
      throw createHttpError(
        403,
        'Forbidden: Cannot access or modify backup resources belonging to another teacher.',
        'OWNERSHIP_FORGERY_REJECTED'
      );
    }

    const rawUserId = inputObj.userId ?? inputObj.user_id ?? inputObj.studentId ?? inputObj.student_id ?? null;
    if (
      rawUserId !== null &&
      rawUserId !== undefined &&
      String(rawUserId).trim() !== '' &&
      String(rawUserId).trim() !== actor.studentId &&
      String(rawUserId).trim() !== teacherProfile.teacherId
    ) {
      throw createHttpError(
        403,
        'Forbidden: Cannot specify another user identity.',
        'OWNERSHIP_FORGERY_REJECTED'
      );
    }
  }
}

/**
 * Reads environment variables to report whether Google Drive OAuth Client IDs are configured.
 */
function getDriveOAuthConfigStatus() {
  const webClientId = String(
    process.env.GOOGLE_DRIVE_WEB_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_WEB_CLIENT_ID ||
    ''
  ).trim();
  const iosClientId = String(
    process.env.GOOGLE_DRIVE_IOS_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_IOS_CLIENT_ID ||
    ''
  ).trim();
  const androidClientId = String(
    process.env.GOOGLE_DRIVE_ANDROID_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_ANDROID_CLIENT_ID ||
    ''
  ).trim();

  const webConfigured = Boolean(webClientId);
  const iosConfigured = Boolean(iosClientId);
  const androidConfigured = Boolean(androidClientId);
  const configured = Boolean(webConfigured || iosConfigured || androidConfigured);

  return {
    configured,
    webConfigured,
    iosConfigured,
    androidConfigured,
    scope: 'https://www.googleapis.com/auth/drive.file'
  };
}

/**
 * Builds deterministic artifact filenames and scope keys for the 3 artifacts of a revision.
 */
function buildArtifactDefinitionsForRun({
  runId,
  sessionId,
  teacherId,
  revisionNo,
  snapshotSha256,
  sessionDate,
  subjectCode,
  cohortLabel,
  semesterNo
}) {
  const cleanSubj = String(subjectCode || 'SUBJ').replace(/[^A-Za-z0-9_-]/g, '');
  const cleanCohort = String(cohortLabel || 'Cohort').replace(/[^A-Za-z0-9_-]/g, '');
  const cleanDate = String(sessionDate || '0000-00-00').trim();
  const yearStr = cleanDate.slice(0, 4);
  const shortSha = String(snapshotSha256 || '').slice(0, 12);

  return [
    {
      artifactType: 'snapshot',
      targetScopeKey: `session:${sessionId}:v${revisionNo}`,
      driveFileName: `${cleanSubj}_${cleanCohort}_Sem${semesterNo}_${cleanDate}_${sessionId}_v${revisionNo}_${shortSha}.json`,
      mimeType: 'application/json',
      artifactSha256: snapshotSha256
    },
    {
      artifactType: 'daily_workbook',
      targetScopeKey: `daily:${teacherId}:${cleanDate}`,
      driveFileName: `Attendance_Daily_${cleanDate}.xlsx`,
      mimeType: XLSX_MIME_TYPE,
      artifactSha256: null
    },
    {
      artifactType: 'annual_workbook',
      targetScopeKey: `annual:${teacherId}:${yearStr}`,
      driveFileName: `Attendance_Year_${yearStr}.xlsx`,
      mimeType: XLSX_MIME_TYPE,
      artifactSha256: null
    }
  ];
}

function formatArtifactRow(row, referenceDate = new Date()) {
  if (!row) return null;
  const nowMs = referenceDate instanceof Date ? referenceDate.getTime() : new Date(referenceDate).getTime();
  const status = row.status || 'pending';
  const attemptCount = Number(row.attemptCount ?? row.attempt_count ?? 0);
  const maxAttempts = Number(row.maxAttempts ?? row.max_attempts ?? MAX_BACKUP_ATTEMPTS);
  const leaseExpiresAt = row.leaseExpiresAt || row.lease_expires_at || null;
  const nextRetryAt = row.nextRetryAt || row.next_retry_at || null;

  const leaseActive =
    status === 'in_progress' &&
    Boolean(leaseExpiresAt) &&
    new Date(leaseExpiresAt).getTime() > nowMs;
  const leaseExpired =
    status === 'in_progress' &&
    Boolean(leaseExpiresAt) &&
    new Date(leaseExpiresAt).getTime() <= nowMs;
  const retryExhausted =
    (status === 'failed' || status === 'reconnect_required') &&
    attemptCount >= maxAttempts;
  const backoffActive =
    status === 'failed' &&
    Boolean(nextRetryAt) &&
    new Date(nextRetryAt).getTime() > nowMs;

  return {
    id: row.id,
    runId: row.runId || row.run_id,
    sessionId: row.sessionId || row.session_id,
    teacherId: row.teacherId || row.teacher_id,
    revisionNo: Number(row.revisionNo ?? row.revision_no ?? 1),
    artifactType: row.artifactType || row.artifact_type,
    targetScopeKey: row.targetScopeKey || row.target_scope_key,
    snapshotSha256: row.snapshotSha256 || row.snapshot_sha256,
    artifactSha256: row.artifactSha256 || row.artifact_sha256 || null,
    status,
    driveFileId: row.driveFileId || row.drive_file_id || null,
    driveFileName: row.driveFileName || row.drive_file_name || null,
    mimeType: row.mimeType || row.mime_type,
    attemptCount,
    maxAttempts,
    retryExhausted,
    backoffActive,
    leaseActive,
    leaseExpired,
    isClaimable:
      !retryExhausted &&
      !backoffActive &&
      (status === 'pending' ||
        status === 'failed' ||
        status === 'reconnect_required' ||
        leaseExpired),
    claimedByClientId: row.claimedByClientId || row.claimed_by_client_id || null,
    claimedAt: row.claimedAt || row.claimed_at || null,
    leaseExpiresAt,
    lastAttemptAt: row.lastAttemptAt || row.last_attempt_at || null,
    nextRetryAt,
    lastErrorCode: row.lastErrorCode || row.last_error_code || null,
    lastErrorMessage: row.lastErrorMessage || row.last_error_message || null,
    completedAt: row.completedAt || row.completed_at || null,
    createdAt: row.createdAt || row.created_at,
    updatedAt: row.updatedAt || row.updated_at
  };
}

/**
 * Computes the rollup status of a backup run from its 3 per-artifact rows.
 * A run is ONLY marked 'backed_up' when its snapshot is 'backed_up' AND both
 * daily_workbook and annual_workbook are in ('backed_up', 'superseded').
 */
function computeBackupRunRollup(artifactRows) {
  const byType = new Map();
  for (const a of artifactRows || []) {
    byType.set(a.artifactType || a.artifact_type, a);
  }

  const snap = byType.get('snapshot');
  const daily = byType.get('daily_workbook');
  const annual = byType.get('annual_workbook');

  const snapshotStatus = snap ? snap.status : 'pending';
  const dailyWorkbookStatus = daily ? daily.status : 'pending';
  const annualWorkbookStatus = annual ? annual.status : 'pending';

  const snapshotDriveFileId = snap ? (snap.driveFileId || snap.drive_file_id || null) : null;
  const dailyDriveFileId = daily ? (daily.driveFileId || daily.drive_file_id || null) : null;
  const annualDriveFileId = annual ? (annual.driveFileId || annual.drive_file_id || null) : null;

  const statuses = [snapshotStatus, dailyWorkbookStatus, annualWorkbookStatus];
  const allComplete =
    snapshotStatus === 'backed_up' &&
    (dailyWorkbookStatus === 'backed_up' || dailyWorkbookStatus === 'superseded') &&
    (annualWorkbookStatus === 'backed_up' || annualWorkbookStatus === 'superseded');

  let backupStatus = 'pending';
  if (allComplete) {
    backupStatus = 'backed_up';
  } else if (statuses.includes('reconnect_required')) {
    backupStatus = 'reconnect_required';
  } else if (statuses.includes('in_progress')) {
    backupStatus = 'in_progress';
  } else if (statuses.includes('failed')) {
    backupStatus = 'failed';
  } else {
    backupStatus = 'pending';
  }

  let maxAttemptCount = 0;
  let lastErrorCode = null;
  let lastErrorMessage = null;
  let activeClaimClientId = null;
  let maxLeaseExpiresAt = null;
  let minNextRetryAt = null;

  for (const a of artifactRows || []) {
    const att = Number(a.attemptCount ?? a.attempt_count ?? 0);
    if (att > maxAttemptCount) maxAttemptCount = att;
    const errCode = a.lastErrorCode || a.last_error_code;
    const errMsg = a.lastErrorMessage || a.last_error_message;
    if (errCode && !lastErrorCode) {
      lastErrorCode = errCode;
      lastErrorMessage = errMsg || null;
    }
    if (a.status === 'in_progress') {
      activeClaimClientId = a.claimedByClientId || a.claimed_by_client_id || activeClaimClientId;
      const leaseExp = a.leaseExpiresAt || a.lease_expires_at || null;
      if (leaseExp && (!maxLeaseExpiresAt || leaseExp > maxLeaseExpiresAt)) {
        maxLeaseExpiresAt = leaseExp;
      }
    }
    const nextRetry = a.nextRetryAt || a.next_retry_at || null;
    if (nextRetry && (!minNextRetryAt || nextRetry < minNextRetryAt)) {
      minNextRetryAt = nextRetry;
    }
  }

  return {
    backupStatus,
    snapshotStatus,
    dailyWorkbookStatus,
    annualWorkbookStatus,
    snapshotDriveFileId,
    dailyDriveFileId,
    annualDriveFileId,
    attemptCount: maxAttemptCount,
    lastErrorCode: allComplete ? null : lastErrorCode,
    lastErrorMessage: allComplete ? null : lastErrorMessage,
    claimedByClientId: backupStatus === 'in_progress' ? activeClaimClientId : null,
    leaseExpiresAt: backupStatus === 'in_progress' ? maxLeaseExpiresAt : null,
    nextRetryAt: allComplete ? null : minNextRetryAt
  };
}

/**
 * Ensures the 3 per-artifact rows exist in attendance_backup_artifacts for a backup run.
 */
async function ensureBackupRunArtifactsTx(tx, runRow, sessionMeta = {}) {
  const runId = runRow.id;
  const existing = (await tx.all(
    `SELECT * FROM attendance_backup_artifacts
     WHERE run_id = ?
     ORDER BY CASE artifact_type
       WHEN 'snapshot' THEN 1
       WHEN 'daily_workbook' THEN 2
       WHEN 'annual_workbook' THEN 3
       ELSE 4
     END ASC`,
    runId
  )) || [];

  if (existing.length === 3) {
    return existing;
  }

  let parsedPayload = runRow.snapshotPayload || runRow.snapshot_payload || null;
  if (typeof parsedPayload === 'string') {
    try {
      parsedPayload = JSON.parse(parsedPayload);
    } catch (_) {
      parsedPayload = null;
    }
  }

  const sessionId = runRow.sessionId || runRow.session_id;
  const teacherId = runRow.teacherId || runRow.teacher_id;
  const revisionNo = Number(runRow.revisionNo ?? runRow.revision_no ?? 1);
  const snapshotSha256 = runRow.snapshotSha256 || runRow.snapshot_sha256;
  const sessionDate =
    sessionMeta.sessionDate ||
    sessionMeta.session_date ||
    parsedPayload?.sessionDate ||
    '2026-01-01';
  const subjectCode =
    sessionMeta.subjectCode ||
    sessionMeta.subject_code ||
    parsedPayload?.subject?.code ||
    'SUBJ';
  const cohortLabel =
    sessionMeta.slotCode ||
    sessionMeta.slot_code ||
    sessionMeta.cohortName ||
    sessionMeta.cohort_name ||
    parsedPayload?.cohort?.slotCode ||
    parsedPayload?.cohort?.displayName ||
    'Cohort';
  const semesterNo = Number(
    sessionMeta.semesterNo ??
    sessionMeta.semester_no ??
    parsedPayload?.cohort?.semesterNo ??
    parsedPayload?.subject?.semester ??
    1
  );

  const defs = buildArtifactDefinitionsForRun({
    runId,
    sessionId,
    teacherId,
    revisionNo,
    snapshotSha256,
    sessionDate,
    subjectCode,
    cohortLabel,
    semesterNo
  });

  const existingByType = new Set(existing.map((e) => e.artifactType || e.artifact_type));
  const nowIso = runRow.createdAt || runRow.created_at || new Date().toISOString();

  for (const def of defs) {
    if (existingByType.has(def.artifactType)) continue;
    const artifactId = crypto.randomUUID();
    await tx.run(
      `INSERT INTO attendance_backup_artifacts (
        id, run_id, session_id, teacher_id, revision_no, artifact_type,
        target_scope_key, snapshot_sha256, artifact_sha256, status,
        drive_file_name, mime_type, attempt_count, max_attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?, ?, ?)`,
      artifactId,
      runId,
      sessionId,
      teacherId,
      revisionNo,
      def.artifactType,
      def.targetScopeKey,
      snapshotSha256,
      def.artifactSha256,
      def.driveFileName,
      def.mimeType,
      MAX_BACKUP_ATTEMPTS,
      nowIso,
      nowIso
    );
  }

  return (await tx.all(
    `SELECT * FROM attendance_backup_artifacts
     WHERE run_id = ?
     ORDER BY CASE artifact_type
       WHEN 'snapshot' THEN 1
       WHEN 'daily_workbook' THEN 2
       WHEN 'annual_workbook' THEN 3
       ELSE 4
     END ASC`,
    runId
  )) || [];
}

/**
 * Synchronizes parent attendance_backup_runs status columns from its 3 artifact rows.
 */
async function syncBackupRunRollupTx(tx, runId, nowIso = new Date().toISOString()) {
  const artifactRows = (await tx.all(
    `SELECT * FROM attendance_backup_artifacts
     WHERE run_id = ?
     ORDER BY CASE artifact_type
       WHEN 'snapshot' THEN 1
       WHEN 'daily_workbook' THEN 2
       WHEN 'annual_workbook' THEN 3
       ELSE 4
     END ASC`,
    runId
  )) || [];

  const rollup = computeBackupRunRollup(artifactRows);
  const backedUpAt = rollup.backupStatus === 'backed_up' ? nowIso : null;

  await tx.run(
    `UPDATE attendance_backup_runs
     SET backup_status = ?,
         snapshot_status = ?,
         daily_workbook_status = ?,
         annual_workbook_status = ?,
         snapshot_drive_file_id = ?,
         daily_drive_file_id = ?,
         annual_drive_file_id = ?,
         attempt_count = ?,
         last_error_code = ?,
         last_error_message = ?,
         claimed_by_client_id = ?,
         lease_expires_at = ?,
         next_retry_at = ?,
         backed_up_at = COALESCE(backed_up_at, ?),
         updated_at = ?
     WHERE id = ?`,
    rollup.backupStatus,
    rollup.snapshotStatus,
    rollup.dailyWorkbookStatus,
    rollup.annualWorkbookStatus,
    rollup.snapshotDriveFileId,
    rollup.dailyDriveFileId,
    rollup.annualDriveFileId,
    rollup.attemptCount,
    rollup.lastErrorCode,
    rollup.lastErrorMessage,
    rollup.claimedByClientId,
    rollup.leaseExpiresAt,
    rollup.nextRetryAt,
    backedUpAt,
    nowIso,
    runId
  );

  const updatedRun = await tx.get('SELECT * FROM attendance_backup_runs WHERE id = ?', runId);
  return {
    run: updatedRun,
    artifacts: artifactRows
  };
}

/**
 * Formats a teacher_drive_connections row consistently.
 */
function formatDriveConnectionRow(row, oauthConfig = getDriveOAuthConfigStatus()) {
  if (!row) {
    return {
      connected: false,
      connectionStatus: oauthConfig.configured ? 'disconnected' : 'not_configured',
      googleEmail: null,
      rootFolderId: null,
      rootFolderName: 'Semester Library Attendance Backups',
      dailyFolderId: null,
      fullFolderId: null,
      snapshotsFolderId: null,
      lastSyncedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: null
    };
  }

  const rawStatus = row.connectionStatus || row.connection_status || 'disconnected';
  return {
    teacherId: row.teacherId || row.teacher_id,
    userId: row.userId || row.user_id,
    connected: rawStatus === 'connected',
    connectionStatus: rawStatus,
    googleEmail: row.googleEmail || row.google_email || null,
    rootFolderId: row.rootFolderId || row.root_folder_id || null,
    rootFolderName: row.rootFolderName || row.root_folder_name || 'Semester Library Attendance Backups',
    dailyFolderId: row.dailyFolderId || row.daily_folder_id || null,
    fullFolderId: row.fullFolderId || row.full_folder_id || null,
    snapshotsFolderId: row.snapshotsFolderId || row.snapshots_folder_id || null,
    lastSyncedAt: row.lastSyncedAt || row.last_synced_at || null,
    lastErrorCode: row.lastErrorCode || row.last_error_code || null,
    lastErrorMessage: row.lastErrorMessage || row.last_error_message || null,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
  };
}

/**
 * Helper to verify that a teacher or admin is authorized to access a session / backup run.
 * For teachers:
 *   1. Validates teacher is currently assigned & active for session.subject_id.
 *   2. If backupRun is provided, verifies backupRun.teacher_id matches the teacher's canonical teacher.id.
 */
async function verifyBackupSessionAndRunAccess(db, actor, sessionRow, backupRunRow = null, { requireTeacherOwner = false } = {}) {
  if (!sessionRow) {
    throw createHttpError(404, 'Attendance session not found.', 'SESSION_NOT_FOUND');
  }

  if (actor.role === 'admin') {
    if (requireTeacherOwner) {
      throw createHttpError(
        403,
        'Forbidden: Only the assigned teacher account can claim, complete, or modify Google Drive backup uploads.',
        'TEACHER_ONLY_DRIVE_SYNC'
      );
    }
    return { teacherProfile: null };
  }

  const teacherProfile = await resolveCanonicalTeacherProfile(db, actor);
  const subjectId = sessionRow.subjectId || sessionRow.subject_id;

  try {
    await validateTeacherSubjectAuthorization(db, actor.studentId, subjectId);
  } catch (authErr) {
    throw createHttpError(authErr.status || 403, authErr.message, 'UNAUTHORIZED_SUBJECT');
  }

  if (backupRunRow) {
    const runTeacherId = backupRunRow.teacherId || backupRunRow.teacher_id;
    if (runTeacherId !== teacherProfile.teacherId && runTeacherId !== actor.studentId) {
      throw createHttpError(
        403,
        'Forbidden: You do not have permission to access another teacher\'s backup run.',
        'UNAUTHORIZED_BACKUP_RUN'
      );
    }
  } else {
    const sessionTeacherId = sessionRow.teacherId || sessionRow.teacher_id;
    if (sessionTeacherId && sessionTeacherId !== teacherProfile.teacherId && sessionTeacherId !== actor.studentId) {
      // Allow only if teacher is authorized for the subject; for strict run ownership, checked above
    }
  }

  return { teacherProfile };
}

/**
 * 1. GET /api/attendance/backup/status
 * Returns Google OAuth configuration status, teacher connection metadata, and outbox summary counts.
 */
async function getTeacherDriveBackupStatus(db, {
  actorUserId,
  requestedTeacherId = null,
  requestedUserId = null
}) {
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  const oauthConfig = getDriveOAuthConfigStatus();

  if (actor.role === 'teacher') {
    const teacherProfile = await resolveCanonicalTeacherProfile(db, actor);
    assertNoForgedOwnership(actor, teacherProfile, {
      teacherId: requestedTeacherId,
      userId: requestedUserId
    });

    const connRow = await db.get(
      'SELECT * FROM teacher_drive_connections WHERE teacher_id = ? OR user_id = ?',
      teacherProfile.teacherId,
      actor.studentId
    );

    const assignedSubjects = await getTeacherSubjects(db, actor.studentId);
    const allowedSubjectIds = new Set(assignedSubjects.map((s) => s.id));

    const runRows = (await db.all(
      `SELECT r.*, s.subject_id
       FROM attendance_backup_runs r
       JOIN attendance_sessions s ON s.id = r.session_id
       WHERE r.teacher_id = ?`,
      teacherProfile.teacherId
    )) || [];

    const authorizedRuns = runRows.filter((r) => allowedSubjectIds.has(r.subjectId || r.subject_id));
    let pendingRuns = 0;
    let inProgressRuns = 0;
    let failedRuns = 0;
    let reconnectRequiredRuns = 0;
    let backedUpRuns = 0;

    for (const r of authorizedRuns) {
      const st = r.backupStatus || r.backup_status || 'pending';
      if (st === 'backed_up') backedUpRuns += 1;
      else if (st === 'in_progress') inProgressRuns += 1;
      else if (st === 'failed') failedRuns += 1;
      else if (st === 'reconnect_required') reconnectRequiredRuns += 1;
      else pendingRuns += 1;
    }

    return {
      role: 'teacher',
      teacherId: teacherProfile.teacherId,
      userId: actor.studentId,
      canManageConnection: true,
      oauth: oauthConfig,
      connection: formatDriveConnectionRow(connRow, oauthConfig),
      connectionStatusNote:
        'Stored connection status is informational metadata; client must verify Google Drive OAuth token validity before uploading.',
      summary: {
        totalRuns: authorizedRuns.length,
        pendingRuns,
        inProgressRuns,
        failedRuns,
        reconnectRequiredRuns,
        backedUpRuns,
        actionableRuns: pendingRuns + failedRuns + reconnectRequiredRuns
      }
    };
  }

  // Admin read-only visibility
  let targetTeacherId = requestedTeacherId ? String(requestedTeacherId).trim() : null;
  if (!targetTeacherId && requestedUserId) {
    const tRow = await db.get(
      'SELECT id FROM teachers WHERE user_id = ? OR id = ?',
      String(requestedUserId).trim(),
      String(requestedUserId).trim()
    );
    if (tRow) targetTeacherId = tRow.id;
  }

  let connRow = null;
  if (targetTeacherId) {
    connRow = await db.get(
      'SELECT * FROM teacher_drive_connections WHERE teacher_id = ? OR user_id = ?',
      targetTeacherId,
      targetTeacherId
    );
  }

  const runRows = targetTeacherId
    ? ((await db.all('SELECT * FROM attendance_backup_runs WHERE teacher_id = ?', targetTeacherId)) || [])
    : ((await db.all('SELECT * FROM attendance_backup_runs')) || []);

  let pendingRuns = 0;
  let inProgressRuns = 0;
  let failedRuns = 0;
  let reconnectRequiredRuns = 0;
  let backedUpRuns = 0;

  for (const r of runRows) {
    const st = r.backupStatus || r.backup_status || 'pending';
    if (st === 'backed_up') backedUpRuns += 1;
    else if (st === 'in_progress') inProgressRuns += 1;
    else if (st === 'failed') failedRuns += 1;
    else if (st === 'reconnect_required') reconnectRequiredRuns += 1;
    else pendingRuns += 1;
  }

  return {
    role: 'admin',
    teacherId: targetTeacherId,
    userId: actor.studentId,
    canManageConnection: false,
    oauth: oauthConfig,
    connection: targetTeacherId ? formatDriveConnectionRow(connRow, oauthConfig) : null,
    connectionStatusNote:
      'Administrator view is read-only. Only the assigned teacher can connect or modify their personal Google Drive backup connection.',
    summary: {
      totalRuns: runRows.length,
      pendingRuns,
      inProgressRuns,
      failedRuns,
      reconnectRequiredRuns,
      backedUpRuns,
      actionableRuns: pendingRuns + failedRuns + reconnectRequiredRuns
    }
  };
}

/**
 * 2. PUT /api/attendance/backup/connection
 * Stores non-secret Google Drive folder IDs and connection status for the authenticated teacher.
 * Strictly rejects admins, students, CRs, cross-teacher IDs, and any OAuth tokens or secrets.
 */
async function upsertTeacherDriveConnection(db, {
  actorUserId,
  body = {},
  now = new Date()
}) {
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  if (actor.role === 'admin') {
    throw createHttpError(
      403,
      'Forbidden: Only the assigned teacher account can connect or modify their Google Drive backup connection.',
      'TEACHER_ONLY_CONNECTION_WRITE'
    );
  }

  assertNoForbiddenSecrets(body, 'Google Drive connection update');
  const teacherProfile = await resolveCanonicalTeacherProfile(db, actor);
  assertNoForgedOwnership(actor, teacherProfile, body);

  const connectionStatus = body.connectionStatus || body.connection_status || 'connected';
  if (!VALID_CONNECTION_STATUSES.has(connectionStatus)) {
    throw createHttpError(
      400,
      `Invalid connectionStatus "${connectionStatus}". Allowed values: connected, disconnected, reconnect_required.`,
      'INVALID_CONNECTION_STATUS'
    );
  }

  const requireFolders = connectionStatus === 'connected';
  const rootFolderId = validateDriveId(
    body.rootFolderId ?? body.root_folder_id,
    'rootFolderId',
    { required: requireFolders }
  );
  const dailyFolderId = validateDriveId(
    body.dailyFolderId ?? body.daily_folder_id,
    'dailyFolderId',
    { required: false }
  );
  const fullFolderId = validateDriveId(
    body.fullFolderId ?? body.full_folder_id,
    'fullFolderId',
    { required: false }
  );
  const snapshotsFolderId = validateDriveId(
    body.snapshotsFolderId ?? body.snapshots_folder_id,
    'snapshotsFolderId',
    { required: false }
  );

  let googleEmail = body.googleEmail ?? body.google_email ?? null;
  if (googleEmail !== null && googleEmail !== undefined && String(googleEmail).trim() !== '') {
    googleEmail = String(googleEmail).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(googleEmail) || googleEmail.length > 160) {
      throw createHttpError(400, 'Invalid googleEmail address.', 'INVALID_GOOGLE_EMAIL');
    }
  } else {
    googleEmail = null;
  }

  const rootFolderNameRaw = body.rootFolderName ?? body.root_folder_name ?? 'Semester Library Attendance Backups';
  const rootFolderName = String(rootFolderNameRaw || 'Semester Library Attendance Backups')
    .replace(/[\u0000-\u001F]+/g, '')
    .trim()
    .slice(0, 120) || 'Semester Library Attendance Backups';

  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();

  const runUpsert = async (tx) => {
    const existing = await tx.get(
      'SELECT * FROM teacher_drive_connections WHERE teacher_id = ?',
      teacherProfile.teacherId
    );

    if (!existing) {
      await tx.run(
        `INSERT INTO teacher_drive_connections (
          teacher_id, user_id, google_email, root_folder_id, root_folder_name,
          daily_folder_id, full_folder_id, snapshots_folder_id,
          connection_status, last_error_code, last_error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        teacherProfile.teacherId,
        actor.studentId,
        googleEmail,
        rootFolderId,
        rootFolderName,
        dailyFolderId,
        fullFolderId,
        snapshotsFolderId,
        connectionStatus,
        nowIso,
        nowIso
      );
    } else {
      await tx.run(
        `UPDATE teacher_drive_connections
         SET google_email = COALESCE(?, google_email),
             root_folder_id = COALESCE(?, root_folder_id),
             root_folder_name = ?,
             daily_folder_id = COALESCE(?, daily_folder_id),
             full_folder_id = COALESCE(?, full_folder_id),
             snapshots_folder_id = COALESCE(?, snapshots_folder_id),
             connection_status = ?,
             last_error_code = NULL,
             last_error_message = NULL,
             updated_at = ?
         WHERE teacher_id = ?`,
        googleEmail,
        rootFolderId,
        rootFolderName,
        dailyFolderId,
        fullFolderId,
        snapshotsFolderId,
        connectionStatus,
        nowIso,
        teacherProfile.teacherId
      );
    }

    // If reconnecting after reconnect_required, reset any reconnect_required artifacts to pending so they can be claimed
    if (connectionStatus === 'connected') {
      await tx.run(
        `UPDATE attendance_backup_artifacts
         SET status = 'pending', updated_at = ?
         WHERE teacher_id = ? AND status = 'reconnect_required'`,
        nowIso,
        teacherProfile.teacherId
      );
      await tx.run(
        `UPDATE attendance_backup_runs
         SET backup_status = 'pending', updated_at = ?
         WHERE teacher_id = ? AND backup_status = 'reconnect_required'`,
        nowIso,
        teacherProfile.teacherId
      );
    }

    return await tx.get(
      'SELECT * FROM teacher_drive_connections WHERE teacher_id = ?',
      teacherProfile.teacherId
    );
  };

  const savedRow = typeof db.withTransaction === 'function'
    ? await db.withTransaction(runUpsert)
    : await runUpsert(db);

  const oauthConfig = getDriveOAuthConfigStatus();
  return {
    connected: connectionStatus === 'connected',
    connection: formatDriveConnectionRow(savedRow, oauthConfig)
  };
}

/**
 * 3. POST /api/attendance/backup/disconnect
 * Marks the teacher's Google Drive connection as disconnected and clears active leases.
 */
async function disconnectTeacherDriveConnection(db, {
  actorUserId,
  body = {},
  now = new Date()
}) {
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  if (actor.role === 'admin') {
    throw createHttpError(
      403,
      'Forbidden: Only the assigned teacher account can disconnect their Google Drive backup connection.',
      'TEACHER_ONLY_CONNECTION_WRITE'
    );
  }

  assertNoForbiddenSecrets(body, 'Google Drive disconnect request');
  const teacherProfile = await resolveCanonicalTeacherProfile(db, actor);
  assertNoForgedOwnership(actor, teacherProfile, body);

  const clearFolders = Boolean(body.clearFolders ?? body.clear_folders ?? false);
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();

  const runDisconnect = async (tx) => {
    const existing = await tx.get(
      'SELECT * FROM teacher_drive_connections WHERE teacher_id = ?',
      teacherProfile.teacherId
    );

    if (existing) {
      if (clearFolders) {
        await tx.run(
          `UPDATE teacher_drive_connections
           SET connection_status = 'disconnected',
               google_email = NULL,
               root_folder_id = NULL,
               daily_folder_id = NULL,
               full_folder_id = NULL,
               snapshots_folder_id = NULL,
               last_error_code = NULL,
               last_error_message = NULL,
               updated_at = ?
           WHERE teacher_id = ?`,
          nowIso,
          teacherProfile.teacherId
        );
      } else {
        await tx.run(
          `UPDATE teacher_drive_connections
           SET connection_status = 'disconnected',
               last_error_code = NULL,
               last_error_message = NULL,
               updated_at = ?
           WHERE teacher_id = ?`,
          nowIso,
          teacherProfile.teacherId
        );
      }
    }

    // Release any in-progress artifact leases back to pending
    await tx.run(
      `UPDATE attendance_backup_artifacts
       SET status = 'pending',
           claim_token = NULL,
           claimed_by_client_id = NULL,
           lease_expires_at = NULL,
           updated_at = ?
       WHERE teacher_id = ? AND status = 'in_progress'`,
      nowIso,
      teacherProfile.teacherId
    );

    await tx.run(
      `UPDATE attendance_backup_runs
       SET backup_status = 'pending',
           claimed_by_client_id = NULL,
           lease_expires_at = NULL,
           updated_at = ?
       WHERE teacher_id = ? AND backup_status = 'in_progress'`,
      nowIso,
      teacherProfile.teacherId
    );

    return await tx.get(
      'SELECT * FROM teacher_drive_connections WHERE teacher_id = ?',
      teacherProfile.teacherId
    );
  };

  const updatedRow = typeof db.withTransaction === 'function'
    ? await db.withTransaction(runDisconnect)
    : await runDisconnect(db);

  const oauthConfig = getDriveOAuthConfigStatus();
  return {
    disconnected: true,
    connection: formatDriveConnectionRow(updatedRow, oauthConfig)
  };
}

/**
 * 4. GET /api/attendance/backup/pending
 * Lists pending, failed, reconnect_required, or expired-lease backup runs and their per-artifact states.
 */
async function listPendingBackupWork(db, {
  actorUserId,
  requestedTeacherId = null,
  requestedUserId = null,
  sessionId = null,
  now = new Date()
}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);

  let targetTeacherId = null;
  let allowedSubjectIds = null;

  if (actor.role === 'teacher') {
    const teacherProfile = await resolveCanonicalTeacherProfile(db, actor);
    assertNoForgedOwnership(actor, teacherProfile, {
      teacherId: requestedTeacherId,
      userId: requestedUserId
    });
    targetTeacherId = teacherProfile.teacherId;

    const teacherSubjects = await getTeacherSubjects(db, actor.studentId);
    allowedSubjectIds = new Set(teacherSubjects.map((s) => s.id));
  } else if (requestedTeacherId && String(requestedTeacherId).trim()) {
    targetTeacherId = String(requestedTeacherId).trim();
  }

  const whereClauses = [`r.backup_status != 'backed_up'`];
  const params = [];

  if (targetTeacherId) {
    whereClauses.push('r.teacher_id = ?');
    params.push(targetTeacherId);
  }

  if (sessionId && String(sessionId).trim()) {
    whereClauses.push('r.session_id = ?');
    params.push(String(sessionId).trim());
  }

  const runRows = (await db.all(
    `SELECT r.*,
            s.subject_id,
            s.cohort_id,
            s.semester_no,
            s.session_date,
            s.latest_revision_no,
            sub.code AS subject_code,
            sub.name AS subject_name,
            c.display_name AS cohort_name,
            c.slot_code
     FROM attendance_backup_runs r
     JOIN attendance_sessions s ON s.id = r.session_id
     LEFT JOIN subjects sub ON sub.id = s.subject_id
     LEFT JOIN cohorts c ON c.id = s.cohort_id
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY r.created_at ASC, r.revision_no ASC`,
    ...params
  )) || [];

  const filteredRuns = allowedSubjectIds
    ? runRows.filter((r) => allowedSubjectIds.has(r.subjectId || r.subject_id))
    : runRows;

  const formattedRuns = [];
  for (const r of filteredRuns) {
    const artifactRows = await ensureBackupRunArtifactsTx(db, r, r);
    const artifacts = artifactRows.map((a) => formatArtifactRow(a, effectiveNow));
    let parsedPayload = r.snapshotPayload || r.snapshot_payload || null;
    if (typeof parsedPayload === 'string') {
      try {
        parsedPayload = JSON.parse(parsedPayload);
      } catch (_) {
        parsedPayload = null;
      }
    }

    formattedRuns.push({
      id: r.id,
      sessionId: r.sessionId || r.session_id,
      teacherId: r.teacherId || r.teacher_id,
      subjectId: r.subjectId || r.subject_id,
      subjectCode: r.subjectCode || r.subject_code || null,
      subjectName: r.subjectName || r.subject_name || null,
      cohortId: r.cohortId || r.cohort_id,
      cohortName: r.cohortName || r.cohort_name || null,
      slotCode: r.slotCode || r.slot_code || null,
      semesterNo: Number(r.semesterNo ?? r.semester_no ?? 1),
      sessionDate: r.sessionDate || r.session_date,
      revisionNo: Number(r.revisionNo ?? r.revision_no ?? 1),
      latestSessionRevisionNo: Number(r.latestRevisionNo ?? r.latest_revision_no ?? 1),
      isLatestSessionRevision:
        Number(r.revisionNo ?? r.revision_no ?? 1) ===
        Number(r.latestRevisionNo ?? r.latest_revision_no ?? 1),
      action: r.action,
      previousSnapshotSha256: r.previousSnapshotSha256 || r.previous_snapshot_sha256 || null,
      snapshotSha256: r.snapshotSha256 || r.snapshot_sha256,
      snapshotPayload: parsedPayload,
      backupStatus: r.backupStatus || r.backup_status,
      snapshotStatus: r.snapshotStatus || r.snapshot_status,
      dailyWorkbookStatus: r.dailyWorkbookStatus || r.daily_workbook_status,
      annualWorkbookStatus: r.annualWorkbookStatus || r.annual_workbook_status,
      attemptCount: Number(r.attemptCount ?? r.attempt_count ?? 0),
      lastErrorCode: r.lastErrorCode || r.last_error_code || null,
      lastErrorMessage: r.lastErrorMessage || r.last_error_message || null,
      claimedByClientId: r.claimedByClientId || r.claimed_by_client_id || null,
      leaseExpiresAt: r.leaseExpiresAt || r.lease_expires_at || null,
      nextRetryAt: r.nextRetryAt || r.next_retry_at || null,
      createdAt: r.createdAt || r.created_at,
      updatedAt: r.updatedAt || r.updated_at,
      artifacts,
      claimableArtifactTypes: artifacts.filter((a) => a.isClaimable).map((a) => a.artifactType)
    });
  }

  return {
    pendingCount: formattedRuns.length,
    runs: formattedRuns
  };
}

/**
 * Helper to execute a transactional DB callback with automatic retries on transient
 * SQLite busy / PostgreSQL serialization errors.
 */
async function executeWithDbRetry(db, runInTx, maxRetries = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (typeof db.withTransaction === 'function') {
        return await db.withTransaction(runInTx);
      }
      return await runInTx(db);
    } catch (err) {
      lastErr = err;
      const isTransientConflict =
        err &&
        !err.status &&
        (err.code === '40001' ||
          err.code === '40P01' ||
          err.code === 'SQLITE_BUSY' ||
          err.code === 'SQLITE_LOCKED' ||
          /database is locked|cannot start a transaction|could not serialize access|deadlock detected/i.test(
            err.message || ''
          ));
      if (!isTransientConflict || attempt === maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 15 * attempt));
    }
  }
  throw lastErr;
}

/**
 * 5. POST /api/attendance/backup/runs/:runId/claim
 * Database-backed atomic lease acquisition for a backup run's artifacts.
 * Safe across separate database connections and serverless instances.
 */
async function claimBackupRunArtifacts(db, {
  actorUserId,
  runId,
  body = {},
  now = new Date()
}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const nowMs = effectiveNow.getTime();
  const nowIso = effectiveNow.toISOString();

  assertNoForbiddenSecrets(body, 'backup claim request');

  if (!runId || !String(runId).trim()) {
    throw createHttpError(400, 'runId is required.', 'MISSING_RUN_ID');
  }
  const cleanRunId = String(runId).trim();

  const rawClientId = body.clientId ?? body.client_id ?? null;
  if (rawClientId !== null && rawClientId !== undefined && (typeof rawClientId !== 'string' || !rawClientId.trim() || rawClientId.trim().length > 128)) {
    throw createHttpError(400, 'clientId must be a non-empty string up to 128 characters.', 'INVALID_CLIENT_ID');
  }

  let requestedArtifactTypes = null;
  const rawTypes = body.artifactTypes ?? body.artifact_types ?? (body.artifactType ? [body.artifactType] : null);
  if (rawTypes !== null && rawTypes !== undefined) {
    if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
      throw createHttpError(400, 'artifactTypes must be a non-empty array when provided.', 'INVALID_ARTIFACT_TYPES');
    }
    requestedArtifactTypes = [];
    for (const t of rawTypes) {
      const cleanT = String(t || '').trim();
      if (!VALID_ARTIFACT_TYPE_SET.has(cleanT)) {
        throw createHttpError(
          400,
          `Invalid artifactType "${t}". Allowed values: snapshot, daily_workbook, annual_workbook.`,
          'INVALID_ARTIFACT_TYPE'
        );
      }
      if (!requestedArtifactTypes.includes(cleanT)) {
        requestedArtifactTypes.push(cleanT);
      }
    }
  }

  let leaseDurationMs = DEFAULT_LEASE_DURATION_MS;
  if (body.leaseDurationMs !== undefined && body.leaseDurationMs !== null) {
    const parsedLease = Number(body.leaseDurationMs);
    if (!Number.isFinite(parsedLease) || parsedLease < MIN_LEASE_DURATION_MS || parsedLease > MAX_LEASE_DURATION_MS) {
      throw createHttpError(
        400,
        `leaseDurationMs must be between ${MIN_LEASE_DURATION_MS} and ${MAX_LEASE_DURATION_MS}.`,
        'INVALID_LEASE_DURATION'
      );
    }
    leaseDurationMs = Math.floor(parsedLease);
  }
  const leaseExpiresIso = new Date(nowMs + leaseDurationMs).toISOString();
  const forceRetry = Boolean(body.forceRetry ?? body.force_retry ?? false);

  const expectedRevisionNo = body.revisionNo ?? body.revision_no ?? null;
  const expectedSnapshotSha256 = body.snapshotSha256 ?? body.snapshot_sha256 ?? null;

  return await executeWithDbRetry(db, async (tx) => {
    const actor = await resolveAuthenticatedActor(tx, actorUserId, ['teacher', 'admin']);
    if (actor.role === 'admin') {
      throw createHttpError(
        403,
        'Forbidden: Only the assigned teacher account can claim Google Drive backup runs.',
        'TEACHER_ONLY_DRIVE_SYNC'
      );
    }

    const teacherProfile = await resolveCanonicalTeacherProfile(tx, actor);
    assertNoForgedOwnership(actor, teacherProfile, body);
    const clientId = rawClientId ? rawClientId.trim() : `client_${actor.studentId}`;

    const forUpdateClause = tx.isPostgres ? ' FOR UPDATE' : '';

    const runRow = await tx.get(
      `SELECT * FROM attendance_backup_runs WHERE id = ?${forUpdateClause}`,
      cleanRunId
    );
    if (!runRow) {
      throw createHttpError(404, 'Attendance backup run not found.', 'BACKUP_RUN_NOT_FOUND');
    }

    if (tx.isPostgres) {
      await tx.get(
        'SELECT id FROM attendance_sessions WHERE id = ? FOR UPDATE',
        runRow.sessionId || runRow.session_id
      );
    }

    const sessionRow = await tx.get(
      `SELECT s.*, sub.code AS subject_code, sub.name AS subject_name,
              c.display_name AS cohort_name, c.slot_code
       FROM attendance_sessions s
       LEFT JOIN subjects sub ON sub.id = s.subject_id
       LEFT JOIN cohorts c ON c.id = s.cohort_id
       WHERE s.id = ?`,
      runRow.sessionId || runRow.session_id
    );

    await verifyBackupSessionAndRunAccess(tx, actor, sessionRow, runRow, { requireTeacherOwner: true });

    const runRevNo = Number(runRow.revisionNo ?? runRow.revision_no ?? 1);
    const runSha256 = String(runRow.snapshotSha256 || runRow.snapshot_sha256 || '').toLowerCase();

    if (expectedRevisionNo !== null && expectedRevisionNo !== undefined && Number(expectedRevisionNo) !== runRevNo) {
      throw createHttpError(
        409,
        `Revision number mismatch: requested revision ${expectedRevisionNo}, but run belongs to revision ${runRevNo}.`,
        'REVISION_HASH_MISMATCH'
      );
    }

    if (
      expectedSnapshotSha256 !== null &&
      expectedSnapshotSha256 !== undefined &&
      String(expectedSnapshotSha256).trim().toLowerCase() !== runSha256
    ) {
      throw createHttpError(
        409,
        'Snapshot SHA-256 mismatch for the requested backup run.',
        'REVISION_HASH_MISMATCH'
      );
    }

    // Ensure the 3 artifact rows exist and lock them on PostgreSQL
    await ensureBackupRunArtifactsTx(tx, runRow, sessionRow);
    let artifactRows = (await tx.all(
      `SELECT * FROM attendance_backup_artifacts
       WHERE run_id = ?
       ORDER BY CASE artifact_type
         WHEN 'snapshot' THEN 1
         WHEN 'daily_workbook' THEN 2
         WHEN 'annual_workbook' THEN 3
         ELSE 4
       END ASC${forUpdateClause}`,
      cleanRunId
    )) || [];

    const latestSessionRevNo = Number(sessionRow.latestRevisionNo ?? sessionRow.latest_revision_no ?? runRevNo);

    // If a newer session revision exists, any unfinished daily_workbook / annual_workbook on this older revision is superseded
    if (latestSessionRevNo > runRevNo) {
      await tx.run(
        `UPDATE attendance_backup_artifacts
         SET status = 'superseded',
             claim_token = NULL,
             claimed_by_client_id = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE run_id = ?
           AND artifact_type IN ('daily_workbook', 'annual_workbook')
           AND status != 'backed_up'
           AND status != 'superseded'`,
        nowIso,
        cleanRunId
      );
      artifactRows = (await tx.all(
        `SELECT * FROM attendance_backup_artifacts
         WHERE run_id = ?
         ORDER BY CASE artifact_type
           WHEN 'snapshot' THEN 1
           WHEN 'daily_workbook' THEN 2
           WHEN 'annual_workbook' THEN 3
           ELSE 4
         END ASC`,
        cleanRunId
      )) || [];
    }

    // Check if run is already completely backed up
    const initialRollup = computeBackupRunRollup(artifactRows);
    if (initialRollup.backupStatus === 'backed_up') {
      const synced = await syncBackupRunRollupTx(tx, cleanRunId, nowIso);
      return {
        claimed: false,
        alreadyBackedUp: true,
        idempotent: true,
        runId: cleanRunId,
        revisionNo: runRevNo,
        snapshotSha256: runSha256,
        backupStatus: 'backed_up',
        claimedArtifacts: [],
        artifacts: synced.artifacts.map((a) => formatArtifactRow(a, effectiveNow))
      };
    }

    const targetTypes = requestedArtifactTypes || VALID_ARTIFACT_TYPES;
    const claimedArtifacts = [];
    let anyIdempotentRenew = false;

    for (const artRow of artifactRows) {
      const artType = artRow.artifactType || artRow.artifact_type;
      if (!targetTypes.includes(artType)) continue;

      const status = artRow.status || 'pending';
      const attemptCount = Number(artRow.attemptCount ?? artRow.attempt_count ?? 0);
      const maxAttempts = Number(artRow.maxAttempts ?? artRow.max_attempts ?? MAX_BACKUP_ATTEMPTS);
      const leaseExp = artRow.leaseExpiresAt || artRow.lease_expires_at || null;
      const leaseExpMs = leaseExp ? new Date(leaseExp).getTime() : 0;
      const claimedBy = artRow.claimedByClientId || artRow.claimed_by_client_id || null;
      const nextRetry = artRow.nextRetryAt || artRow.next_retry_at || null;
      const nextRetryMs = nextRetry ? new Date(nextRetry).getTime() : 0;

      if (status === 'backed_up') {
        if (requestedArtifactTypes && requestedArtifactTypes.length === 1) {
          return {
            claimed: false,
            alreadyBackedUp: true,
            idempotent: true,
            runId: cleanRunId,
            revisionNo: runRevNo,
            snapshotSha256: runSha256,
            backupStatus: initialRollup.backupStatus,
            claimedArtifacts: [],
            artifacts: artifactRows.map((a) => formatArtifactRow(a, effectiveNow))
          };
        }
        continue;
      }

      if (status === 'superseded') {
        if (requestedArtifactTypes && requestedArtifactTypes.includes(artType)) {
          throw createHttpError(
            409,
            `Artifact "${artType}" for revision ${runRevNo} has been superseded by revision ${latestSessionRevNo}.`,
            'STALE_REVISION_ARTIFACT'
          );
        }
        continue;
      }

      if (status === 'in_progress') {
        if (leaseExpMs > nowMs) {
          if (claimedBy === clientId) {
            // Idempotent lease renewal for the same client without incrementing attempt_count
            await tx.run(
              `UPDATE attendance_backup_artifacts
               SET lease_expires_at = ?, updated_at = ?
               WHERE id = ? AND status = 'in_progress' AND claimed_by_client_id = ?`,
              leaseExpiresIso,
              nowIso,
              artRow.id,
              clientId
            );
            anyIdempotentRenew = true;
            claimedArtifacts.push({
              artifactId: artRow.id,
              artifactType: artType,
              claimToken: artRow.claimToken || artRow.claim_token,
              clientId,
              attemptCount,
              leaseExpiresAt: leaseExpiresIso,
              revisionNo: runRevNo,
              snapshotSha256: runSha256,
              driveFileName: artRow.driveFileName || artRow.drive_file_name,
              idempotentRenewal: true
            });
            continue;
          }
          throw createHttpError(
            409,
            `Artifact "${artType}" is currently claimed by another active client until ${leaseExp}.`,
            'CLAIM_LEASE_ACTIVE'
          );
        }
        // Lease has expired: fall through to recover claim if within retry bounds
      }

      if (attemptCount >= maxAttempts) {
        throw createHttpError(
          409,
          `Retry limit exceeded for artifact "${artType}" (${attemptCount}/${maxAttempts} attempts).`,
          'RETRY_LIMIT_EXCEEDED'
        );
      }

      if (status === 'failed' && nextRetryMs > nowMs && !forceRetry) {
        throw createHttpError(
          409,
          `Artifact "${artType}" is in retry backoff until ${nextRetry}.`,
          'RETRY_BACKOFF_ACTIVE'
        );
      }

      const newClaimToken = crypto.randomUUID();
      const newAttemptCount = attemptCount + 1;

      const updateResult = await tx.run(
        `UPDATE attendance_backup_artifacts
         SET status = 'in_progress',
             attempt_count = ?,
             claim_token = ?,
             claimed_by_client_id = ?,
             claimed_at = ?,
             lease_expires_at = ?,
             last_attempt_at = ?,
             next_retry_at = NULL,
             updated_at = ?
         WHERE id = ?
           AND (
             status IN ('pending', 'failed', 'reconnect_required')
             OR (status = 'in_progress' AND lease_expires_at <= ?)
           )`,
        newAttemptCount,
        newClaimToken,
        clientId,
        nowIso,
        leaseExpiresIso,
        nowIso,
        nowIso,
        artRow.id,
        nowIso
      );

      if (!updateResult || Number(updateResult.changes) === 0) {
        throw createHttpError(
          409,
          `Concurrent claim conflict on artifact "${artType}".`,
          'CLAIM_LEASE_ACTIVE'
        );
      }

      claimedArtifacts.push({
        artifactId: artRow.id,
        artifactType: artType,
        claimToken: newClaimToken,
        clientId,
        attemptCount: newAttemptCount,
        leaseExpiresAt: leaseExpiresIso,
        revisionNo: runRevNo,
        snapshotSha256: runSha256,
        driveFileName: artRow.driveFileName || artRow.drive_file_name,
        idempotentRenewal: false
      });
    }

    const synced = await syncBackupRunRollupTx(tx, cleanRunId, nowIso);
    return {
      claimed: claimedArtifacts.length > 0,
      alreadyBackedUp: false,
      idempotent: anyIdempotentRenew,
      runId: cleanRunId,
      sessionId: sessionRow.id,
      revisionNo: runRevNo,
      snapshotSha256: runSha256,
      backupStatus: synced.run.backupStatus || synced.run.backup_status,
      claimedArtifacts,
      artifacts: synced.artifacts.map((a) => formatArtifactRow(a, effectiveNow))
    };
  });
}

/**
 * 6. POST /api/attendance/backup/runs/:runId/complete
 * Validates claim token, lease expiration, revision number, snapshot hash, and Drive file ID
 * before marking one or more artifacts as 'backed_up'.
 *
 * Security Note: Because Google Drive uploads execute client-side with the teacher's scoped
 * drive.file token, the backend authoritatively validates identity, ownership, active lease
 * token, revision number, snapshot SHA-256, and Drive file ID format, but cannot independently
 * inspect the bytes stored inside the teacher's personal Google Drive without an external audit read.
 */
async function completeBackupArtifact(db, {
  actorUserId,
  runId,
  body = {},
  now = new Date()
}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const nowMs = effectiveNow.getTime();
  const nowIso = effectiveNow.toISOString();

  assertNoForbiddenSecrets(body, 'backup completion request');

  if (!runId || !String(runId).trim()) {
    throw createHttpError(400, 'runId is required.', 'MISSING_RUN_ID');
  }
  const cleanRunId = String(runId).trim();

  return await executeWithDbRetry(db, async (tx) => {
    const actor = await resolveAuthenticatedActor(tx, actorUserId, ['teacher', 'admin']);
    if (actor.role === 'admin') {
      throw createHttpError(
        403,
        'Forbidden: Only the assigned teacher account can complete Google Drive backup runs.',
        'TEACHER_ONLY_DRIVE_SYNC'
      );
    }

    const teacherProfile = await resolveCanonicalTeacherProfile(tx, actor);
    assertNoForgedOwnership(actor, teacherProfile, body);

    // Normalize single-artifact vs multi-artifact completion input
    const itemsRaw = Array.isArray(body.artifacts) && body.artifacts.length > 0
      ? body.artifacts
      : [body];

    const normalizedItems = itemsRaw.map((item, idx) => {
      if (!item || typeof item !== 'object') {
        throw createHttpError(400, `Completion item at index ${idx} must be an object.`, 'INVALID_COMPLETION_PAYLOAD');
      }
      const artifactType = String(item.artifactType ?? item.artifact_type ?? body.artifactType ?? body.artifact_type ?? '').trim();
      if (!VALID_ARTIFACT_TYPE_SET.has(artifactType)) {
        throw createHttpError(
          400,
          'artifactType is required (snapshot, daily_workbook, or annual_workbook).',
          'INVALID_ARTIFACT_TYPE'
        );
      }

      const claimToken = String(item.claimToken ?? item.claim_token ?? body.claimToken ?? body.claim_token ?? '').trim();
      if (!claimToken) {
        throw createHttpError(
          400,
          `claimToken is required to complete artifact "${artifactType}".`,
          'MISSING_CLAIM_TOKEN'
        );
      }

      const rawRevNo = item.revisionNo ?? item.revision_no ?? body.revisionNo ?? body.revision_no;
      if (rawRevNo === null || rawRevNo === undefined || !Number.isInteger(Number(rawRevNo)) || Number(rawRevNo) < 1) {
        throw createHttpError(
          400,
          `Valid integer revisionNo is required to complete artifact "${artifactType}".`,
          'MISSING_REVISION_NO'
        );
      }

      const rawSha = String(item.snapshotSha256 ?? item.snapshot_sha256 ?? body.snapshotSha256 ?? body.snapshot_sha256 ?? '').trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(rawSha)) {
        throw createHttpError(
          400,
          `Valid 64-character hex snapshotSha256 is required to complete artifact "${artifactType}".`,
          'MISSING_SNAPSHOT_HASH'
        );
      }

      const driveFileId = validateDriveId(
        item.driveFileId ?? item.drive_file_id ?? body.driveFileId ?? body.drive_file_id,
        'driveFileId',
        { required: true }
      );

      const driveFileName = item.driveFileName ?? item.drive_file_name ?? null;
      const artifactSha256Raw = item.artifactSha256 ?? item.artifact_sha256 ?? null;
      let artifactSha256 = null;
      if (artifactSha256Raw !== null && artifactSha256Raw !== undefined && String(artifactSha256Raw).trim() !== '') {
        artifactSha256 = String(artifactSha256Raw).trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(artifactSha256)) {
          throw createHttpError(400, 'artifactSha256 must be a 64-character lowercase hex SHA-256 digest.', 'INVALID_ARTIFACT_HASH');
        }
      }

      return {
        artifactType,
        claimToken,
        revisionNo: Number(rawRevNo),
        snapshotSha256: rawSha,
        driveFileId,
        driveFileName: driveFileName ? String(driveFileName).trim().slice(0, 180) : null,
        artifactSha256
      };
    });

    const forUpdateClause = tx.isPostgres ? ' FOR UPDATE' : '';

    const runRow = await tx.get(
      `SELECT * FROM attendance_backup_runs WHERE id = ?${forUpdateClause}`,
      cleanRunId
    );
    if (!runRow) {
      throw createHttpError(404, 'Attendance backup run not found.', 'BACKUP_RUN_NOT_FOUND');
    }

    if (tx.isPostgres) {
      await tx.get(
        'SELECT id FROM attendance_sessions WHERE id = ? FOR UPDATE',
        runRow.sessionId || runRow.session_id
      );
    }

    const sessionRow = await tx.get(
      `SELECT s.*, sub.code AS subject_code, sub.name AS subject_name,
              c.display_name AS cohort_name, c.slot_code
       FROM attendance_sessions s
       LEFT JOIN subjects sub ON sub.id = s.subject_id
       LEFT JOIN cohorts c ON c.id = s.cohort_id
       WHERE s.id = ?`,
      runRow.sessionId || runRow.session_id
    );

    await verifyBackupSessionAndRunAccess(tx, actor, sessionRow, runRow, { requireTeacherOwner: true });

    const runRevNo = Number(runRow.revisionNo ?? runRow.revision_no ?? 1);
    const runSha256 = String(runRow.snapshotSha256 || runRow.snapshot_sha256 || '').toLowerCase();
    const latestSessionRevNo = Number(sessionRow.latestRevisionNo ?? sessionRow.latest_revision_no ?? runRevNo);

    await ensureBackupRunArtifactsTx(tx, runRow, sessionRow);
    const artifactRows = (await tx.all(
      `SELECT * FROM attendance_backup_artifacts
       WHERE run_id = ?${forUpdateClause}`,
      cleanRunId
    )) || [];
    const artifactByType = new Map(artifactRows.map((a) => [a.artifactType || a.artifact_type, a]));

    let allIdempotent = true;
    for (const item of normalizedItems) {
      if (item.revisionNo !== runRevNo || item.snapshotSha256 !== runSha256) {
        throw createHttpError(
          409,
          `Revision or snapshot hash mismatch: run ${cleanRunId} is revision ${runRevNo} (${runSha256.slice(0, 12)}...), not revision ${item.revisionNo}.`,
          'REVISION_HASH_MISMATCH'
        );
      }

      if (item.artifactType === 'snapshot' && item.artifactSha256 && item.artifactSha256 !== runSha256) {
        throw createHttpError(
          409,
          'Snapshot artifactSha256 does not match the canonical snapshotSha256.',
          'REVISION_HASH_MISMATCH'
        );
      }

      const artRow = artifactByType.get(item.artifactType);
      if (!artRow) {
        throw createHttpError(404, `Artifact "${item.artifactType}" not found for run.`, 'ARTIFACT_NOT_FOUND');
      }

      const currentStatus = artRow.status || 'pending';
      const existingDriveFileId = artRow.driveFileId || artRow.drive_file_id || null;
      const existingClaimToken = artRow.claimToken || artRow.claim_token || null;

      // Idempotent repeat completion check
      if (currentStatus === 'backed_up') {
        if (existingDriveFileId === item.driveFileId && (!existingClaimToken || existingClaimToken === item.claimToken)) {
          continue;
        }
        throw createHttpError(
          409,
          `Artifact "${item.artifactType}" is already backed up and cannot be overwritten with a different file ID or claim.`,
          'INVALID_ARTIFACT_STATE_TRANSITION'
        );
      }

      // Prevent stale workbook completion when a newer revision already exists for this session
      if (
        (item.artifactType === 'daily_workbook' || item.artifactType === 'annual_workbook') &&
        latestSessionRevNo > runRevNo
      ) {
        await tx.run(
          `UPDATE attendance_backup_artifacts
           SET status = 'superseded',
               claim_token = NULL,
               claimed_by_client_id = NULL,
               lease_expires_at = NULL,
               updated_at = ?
           WHERE id = ?`,
          nowIso,
          artRow.id
        );
        await syncBackupRunRollupTx(tx, cleanRunId, nowIso);
        throw createHttpError(
          409,
          `Cannot complete ${item.artifactType} for stale revision ${runRevNo}; session is now at revision ${latestSessionRevNo}.`,
          'STALE_REVISION_WORKBOOK'
        );
      }

      if (currentStatus === 'superseded') {
        throw createHttpError(
          409,
          `Artifact "${item.artifactType}" has been superseded by a newer revision.`,
          'STALE_REVISION_WORKBOOK'
        );
      }

      if (currentStatus !== 'in_progress') {
        throw createHttpError(
          409,
          `Cannot complete artifact "${item.artifactType}" from state "${currentStatus}" without an active claim.`,
          'INVALID_ARTIFACT_STATE_TRANSITION'
        );
      }

      if (!existingClaimToken || existingClaimToken !== item.claimToken) {
        throw createHttpError(
          409,
          `Stale or invalid claimToken for artifact "${item.artifactType}".`,
          'STALE_OR_INVALID_CLAIM'
        );
      }

      const leaseExp = artRow.leaseExpiresAt || artRow.lease_expires_at || null;
      if (!leaseExp || new Date(leaseExp).getTime() <= nowMs) {
        throw createHttpError(
          409,
          `Claim lease for artifact "${item.artifactType}" expired at ${leaseExp}.`,
          'CLAIM_LEASE_EXPIRED'
        );
      }

      allIdempotent = false;
      await tx.run(
        `UPDATE attendance_backup_artifacts
         SET status = 'backed_up',
             drive_file_id = ?,
             drive_file_name = COALESCE(?, drive_file_name),
             artifact_sha256 = COALESCE(?, artifact_sha256),
             lease_expires_at = NULL,
             last_error_code = NULL,
             last_error_message = NULL,
             next_retry_at = NULL,
             completed_at = ?,
             updated_at = ?
         WHERE id = ? AND status = 'in_progress' AND claim_token = ?`,
        item.driveFileId,
        item.driveFileName,
        item.artifactSha256 || (item.artifactType === 'snapshot' ? runSha256 : null),
        nowIso,
        nowIso,
        artRow.id,
        item.claimToken
      );
    }

    const synced = await syncBackupRunRollupTx(tx, cleanRunId, nowIso);
    const finalStatus = synced.run.backupStatus || synced.run.backup_status;

    if (finalStatus === 'backed_up') {
      await tx.run(
        `UPDATE teacher_drive_connections
         SET last_synced_at = ?,
             last_error_code = NULL,
             last_error_message = NULL,
             updated_at = ?
         WHERE teacher_id = ?`,
        nowIso,
        nowIso,
        teacherProfile.teacherId
      );
    }

    return {
      completed: true,
      idempotent: allIdempotent,
      runId: cleanRunId,
      sessionId: sessionRow.id,
      revisionNo: runRevNo,
      snapshotSha256: runSha256,
      backupStatus: finalStatus,
      allArtifactsComplete: finalStatus === 'backed_up',
      verificationNote:
        'Server verified teacher authorization, active claim lease, revision number, and canonical snapshot SHA-256.',
      artifacts: synced.artifacts.map((a) => formatArtifactRow(a, effectiveNow))
    };
  });
}

/**
 * 7. POST /api/attendance/backup/runs/:runId/fail
 * Records a sanitized failure for one or more claimed artifacts without discarding
 * already-completed sibling artifacts.
 */
async function failBackupArtifact(db, {
  actorUserId,
  runId,
  body = {},
  now = new Date()
}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const nowMs = effectiveNow.getTime();
  const nowIso = effectiveNow.toISOString();

  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  assertNoForbiddenSecrets(body, 'backup failure report');

  if (actor.role === 'admin') {
    throw createHttpError(
      403,
      'Forbidden: Only the assigned teacher account can report Google Drive backup failures.',
      'TEACHER_ONLY_DRIVE_SYNC'
    );
  }

  const teacherProfile = await resolveCanonicalTeacherProfile(db, actor);
  assertNoForgedOwnership(actor, teacherProfile, body);

  if (!runId || !String(runId).trim()) {
    throw createHttpError(400, 'runId is required.', 'MISSING_RUN_ID');
  }
  const cleanRunId = String(runId).trim();

  const claimToken = String(body.claimToken ?? body.claim_token ?? '').trim();
  if (!claimToken) {
    throw createHttpError(400, 'claimToken is required to report a backup failure.', 'MISSING_CLAIM_TOKEN');
  }

  const rawArtifactType = body.artifactType ?? body.artifact_type ?? null;
  if (rawArtifactType !== null && rawArtifactType !== undefined && !VALID_ARTIFACT_TYPE_SET.has(String(rawArtifactType).trim())) {
    throw createHttpError(
      400,
      `Invalid artifactType "${rawArtifactType}". Allowed values: snapshot, daily_workbook, annual_workbook.`,
      'INVALID_ARTIFACT_TYPE'
    );
  }
  const targetArtifactType = rawArtifactType ? String(rawArtifactType).trim() : null;

  const reconnectRequired = Boolean(body.reconnectRequired ?? body.reconnect_required ?? false);
  const errorCode = sanitizeBackupErrorCode(
    body.errorCode ?? body.error_code,
    reconnectRequired ? 'DRIVE_AUTH_EXPIRED' : 'DRIVE_UPLOAD_FAILED'
  );
  const errorMessage =
    sanitizeBackupErrorMessage(body.errorMessage ?? body.error_message ?? body.message) ||
    'Google Drive synchronization failed.';

  const customRetryDelayMs =
    body.retryDelayMs !== undefined && body.retryDelayMs !== null
      ? Math.max(0, Math.min(300_000, Number(body.retryDelayMs) || 0))
      : null;

  return await executeWithDbRetry(db, async (tx) => {
    const forUpdateClause = tx.isPostgres ? ' FOR UPDATE' : '';

    const runRow = await tx.get(
      `SELECT * FROM attendance_backup_runs WHERE id = ?${forUpdateClause}`,
      cleanRunId
    );
    if (!runRow) {
      throw createHttpError(404, 'Attendance backup run not found.', 'BACKUP_RUN_NOT_FOUND');
    }

    const sessionRow = await tx.get(
      `SELECT * FROM attendance_sessions WHERE id = ?${forUpdateClause}`,
      runRow.sessionId || runRow.session_id
    );

    await verifyBackupSessionAndRunAccess(tx, actor, sessionRow, runRow, { requireTeacherOwner: true });

    await ensureBackupRunArtifactsTx(tx, runRow, sessionRow);
    const artifactRows = (await tx.all(
      `SELECT * FROM attendance_backup_artifacts WHERE run_id = ?${forUpdateClause}`,
      cleanRunId
    )) || [];

    const matchingArtifacts = targetArtifactType
      ? artifactRows.filter((a) => (a.artifactType || a.artifact_type) === targetArtifactType)
      : artifactRows.filter((a) => (a.claimToken || a.claim_token) === claimToken);

    if (matchingArtifacts.length === 0) {
      throw createHttpError(
        409,
        'No active artifact claim matched the provided claimToken and artifactType.',
        'STALE_OR_INVALID_CLAIM'
      );
    }

    const nextStatus = reconnectRequired ? 'reconnect_required' : 'failed';

    for (const artRow of matchingArtifacts) {
      const currentStatus = artRow.status || 'pending';
      if (currentStatus === 'backed_up' || currentStatus === 'superseded') {
        throw createHttpError(
          409,
          `Cannot mark artifact "${artRow.artifactType || artRow.artifact_type}" as failed from terminal state "${currentStatus}".`,
          'INVALID_ARTIFACT_STATE_TRANSITION'
        );
      }

      const existingClaimToken = artRow.claimToken || artRow.claim_token || null;
      if (currentStatus !== 'in_progress' || existingClaimToken !== claimToken) {
        throw createHttpError(
          409,
          `Stale or invalid claimToken for artifact "${artRow.artifactType || artRow.artifact_type}".`,
          'STALE_OR_INVALID_CLAIM'
        );
      }

      const attemptCount = Number(artRow.attemptCount ?? artRow.attempt_count ?? 1);
      const backoffMs = customRetryDelayMs !== null
        ? customRetryDelayMs
        : Math.min(300_000, 1000 * Math.pow(2, Math.max(0, attemptCount - 1)));
      const nextRetryIso = new Date(nowMs + backoffMs).toISOString();

      await tx.run(
        `UPDATE attendance_backup_artifacts
         SET status = ?,
             last_error_code = ?,
             last_error_message = ?,
             claim_token = NULL,
             claimed_by_client_id = NULL,
             lease_expires_at = NULL,
             next_retry_at = ?,
             updated_at = ?
         WHERE id = ?`,
        nextStatus,
        errorCode,
        errorMessage,
        nextRetryIso,
        nowIso,
        artRow.id
      );
    }

    if (reconnectRequired) {
      await tx.run(
        `UPDATE teacher_drive_connections
         SET connection_status = 'reconnect_required',
             last_error_code = ?,
             last_error_message = ?,
             updated_at = ?
         WHERE teacher_id = ?`,
        errorCode,
        errorMessage,
        nowIso,
        teacherProfile.teacherId
      );
    }

    const synced = await syncBackupRunRollupTx(tx, cleanRunId, nowIso);
    return {
      failed: true,
      runId: cleanRunId,
      backupStatus: synced.run.backupStatus || synced.run.backup_status,
      lastErrorCode: errorCode,
      lastErrorMessage: errorMessage,
      artifacts: synced.artifacts.map((a) => formatArtifactRow(a, effectiveNow))
    };
  });
}

/**
 * 8. GET /api/attendance/sessions/:id/revisions
 * Returns chronological revision history and per-artifact backup states for an authorized session.
 */
async function getSessionBackupRevisionsAuthorized(db, {
  actorUserId,
  sessionId,
  now = new Date()
}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);

  if (!sessionId || !String(sessionId).trim()) {
    throw createHttpError(400, 'sessionId is required.', 'MISSING_SESSION_ID');
  }
  const cleanSessionId = String(sessionId).trim();

  const sessionRow = await db.get(
    `SELECT s.*, sub.code AS subject_code, sub.name AS subject_name,
            c.display_name AS cohort_name, c.slot_code
     FROM attendance_sessions s
     LEFT JOIN subjects sub ON sub.id = s.subject_id
     LEFT JOIN cohorts c ON c.id = s.cohort_id
     WHERE s.id = ?`,
    cleanSessionId
  );

  await verifyBackupSessionAndRunAccess(db, actor, sessionRow, null, { requireTeacherOwner: false });

  const runRows = (await db.all(
    `SELECT * FROM attendance_backup_runs
     WHERE session_id = ?
     ORDER BY revision_no ASC`,
    cleanSessionId
  )) || [];

  const revisions = [];
  for (const r of runRows) {
    const artifactRows = await ensureBackupRunArtifactsTx(db, r, sessionRow);
    let parsedPayload = r.snapshotPayload || r.snapshot_payload || null;
    if (typeof parsedPayload === 'string') {
      try {
        parsedPayload = JSON.parse(parsedPayload);
      } catch (_) {
        parsedPayload = null;
      }
    }

    revisions.push({
      id: r.id,
      runId: r.id,
      sessionId: cleanSessionId,
      teacherId: r.teacherId || r.teacher_id,
      revisionNo: Number(r.revisionNo ?? r.revision_no ?? 1),
      auditLogId: r.auditLogId || r.audit_log_id,
      action: r.action,
      previousSnapshotSha256: r.previousSnapshotSha256 || r.previous_snapshot_sha256 || null,
      snapshotSha256: r.snapshotSha256 || r.snapshot_sha256,
      snapshotPayload: parsedPayload,
      backupStatus: r.backupStatus || r.backup_status,
      snapshotStatus: r.snapshotStatus || r.snapshot_status,
      dailyWorkbookStatus: r.dailyWorkbookStatus || r.daily_workbook_status,
      annualWorkbookStatus: r.annualWorkbookStatus || r.annual_workbook_status,
      snapshotDriveFileId: r.snapshotDriveFileId || r.snapshot_drive_file_id || null,
      dailyDriveFileId: r.dailyDriveFileId || r.daily_drive_file_id || null,
      annualDriveFileId: r.annualDriveFileId || r.annual_drive_file_id || null,
      attemptCount: Number(r.attemptCount ?? r.attempt_count ?? 0),
      lastErrorCode: r.lastErrorCode || r.last_error_code || null,
      lastErrorMessage: r.lastErrorMessage || r.last_error_message || null,
      backedUpAt: r.backedUpAt || r.backed_up_at || null,
      createdAt: r.createdAt || r.created_at,
      updatedAt: r.updatedAt || r.updated_at,
      artifacts: artifactRows.map((a) => formatArtifactRow(a, effectiveNow))
    });
  }

  return {
    sessionId: cleanSessionId,
    subjectId: sessionRow.subjectId || sessionRow.subject_id,
    subjectCode: sessionRow.subjectCode || sessionRow.subject_code || null,
    cohortId: sessionRow.cohortId || sessionRow.cohort_id,
    sessionDate: sessionRow.sessionDate || sessionRow.session_date,
    latestRevisionNo: Number(sessionRow.latestRevisionNo ?? sessionRow.latest_revision_no ?? revisions.length ?? 1),
    revisions
  };
}

/**
 * Validates a calendar date string (YYYY-MM-DD) in Nepal time for workbook generation.
 */
function validateWorkbookDate(dateInput, { allowFuture = false, referenceDate = new Date() } = {}) {
  if (!dateInput || typeof dateInput !== 'string') {
    throw createHttpError(400, 'date is required in YYYY-MM-DD format.', 'INVALID_DATE');
  }
  const clean = dateInput.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw createHttpError(400, 'Invalid date format. Expected YYYY-MM-DD.', 'INVALID_DATE');
  }
  const [yStr, mStr, dStr] = clean.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== m ||
    dt.getUTCDate() !== d
  ) {
    throw createHttpError(400, `Invalid calendar date "${clean}".`, 'INVALID_DATE');
  }
  if (!allowFuture) {
    const todayNepal = formatNepalDate(referenceDate);
    if (clean > todayNepal) {
      throw createHttpError(
        400,
        `Cannot generate attendance workbook for a future date (${clean}). Current Nepal date is ${todayNepal}.`,
        'FUTURE_DATE_NOT_ALLOWED'
      );
    }
  }
  return clean;
}

/**
 * Validates a 4-digit academic year (YYYY) for annual workbook generation.
 */
function validateWorkbookYear(yearInput) {
  if (yearInput === null || yearInput === undefined || String(yearInput).trim() === '') {
    throw createHttpError(400, 'year is required in YYYY format.', 'INVALID_YEAR');
  }
  const clean = String(yearInput).trim();
  if (!/^\d{4}$/.test(clean)) {
    throw createHttpError(400, 'Invalid year format. Expected 4-digit year (YYYY).', 'INVALID_YEAR');
  }
  const num = Number(clean);
  if (!Number.isInteger(num) || num < 2000 || num > 2100) {
    throw createHttpError(400, 'Year must be between 2000 and 2100.', 'INVALID_YEAR');
  }
  return clean;
}

/**
 * Resolves the authorized subject IDs and teacher scope for workbook generation.
 */
async function resolveWorkbookAuthorizationScope(db, {
  actor,
  subjectId = null,
  cohortId = null,
  requestedTeacherId = null,
  requestedUserId = null
}) {
  let teacherProfile = null;
  let allowedSubjectIds = null;

  if (actor.role === 'teacher') {
    teacherProfile = await resolveCanonicalTeacherProfile(db, actor);
    assertNoForgedOwnership(actor, teacherProfile, {
      teacherId: requestedTeacherId,
      userId: requestedUserId
    });

    const teacherSubjects = await getTeacherSubjects(db, actor.studentId);
    allowedSubjectIds = teacherSubjects.map((s) => s.id);

    if (subjectId && String(subjectId).trim()) {
      try {
        const authSub = await validateTeacherSubjectAuthorization(db, actor.studentId, String(subjectId).trim());
        allowedSubjectIds = [authSub.subjectId];
      } catch (authErr) {
        throw createHttpError(authErr.status || 403, authErr.message, 'UNAUTHORIZED_SUBJECT');
      }
    }
  } else {
    // Admin scope
    if (subjectId && String(subjectId).trim()) {
      const cleanSubj = String(subjectId).trim();
      const subjRow = await db.get(
        'SELECT id FROM subjects WHERE id = ? OR LOWER(code) = LOWER(?)',
        cleanSubj,
        cleanSubj
      );
      if (!subjRow) {
        throw createHttpError(404, `Subject "${cleanSubj}" not found.`, 'SUBJECT_NOT_FOUND');
      }
      allowedSubjectIds = [subjRow.id];
    }
    if (requestedTeacherId && String(requestedTeacherId).trim()) {
      const cleanTea = String(requestedTeacherId).trim();
      const tRow = await db.get(
        'SELECT id, user_id, status FROM teachers WHERE id = ? OR user_id = ?',
        cleanTea,
        cleanTea
      );
      if (!tRow) {
        throw createHttpError(404, `Teacher "${cleanTea}" not found.`, 'TEACHER_NOT_FOUND');
      }
      teacherProfile = { id: tRow.id, teacherId: tRow.id, userId: tRow.user_id || tRow.userId };
    }
  }

  let resolvedCohortId = null;
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
    resolvedCohortId = cohortRow.id;
  }

  return {
    teacherProfile,
    allowedSubjectIds,
    resolvedCohortId
  };
}

/**
 * PHASE 2B — 1. Server-Authoritative Daily Attendance Workbook Generator
 * Generates a deterministic .xlsx workbook for a specific Nepal calendar date (YYYY-MM-DD)
 * strictly from committed finalized database records within the caller's authorized scope.
 */
async function generateDailyAttendanceWorkbook(db, {
  actorUserId,
  date,
  subjectId = null,
  cohortId = null,
  requestedTeacherId = null,
  requestedUserId = null,
  now = new Date()
}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  const cleanDate = validateWorkbookDate(date || formatNepalDate(effectiveNow), {
    allowFuture: false,
    referenceDate: effectiveNow
  });

  const { teacherProfile, allowedSubjectIds, resolvedCohortId } = await resolveWorkbookAuthorizationScope(db, {
    actor,
    subjectId,
    cohortId,
    requestedTeacherId,
    requestedUserId
  });

  if (Array.isArray(allowedSubjectIds) && allowedSubjectIds.length === 0) {
    const emptyBuilt = buildXlsxWorkbookBuffer([
      {
        name: 'Daily Summary',
        columnWidths: [24, 16, 16, 30, 12, 18, 14, 14, 14, 14, 14, 14, 18, 66],
        freezeRows: 6,
        rows: [
          [{ value: 'Semester Library — Daily Attendance Workbook', style: 1 }],
          ['Session Date (Nepal)', cleanDate, 'Scope', actor.name],
          ['Total Finalized Sessions', 0, 'Total Present', 0, 'Total Absent', 0, 'Overall Attendance %', 0],
          ['Note', 'Editable report view derived from committed database records. Immutable revision evidence is stored separately in canonical JSON snapshots.'],
          [],
          {
            style: 2,
            cells: [
              'Session ID', 'Session Date', 'Subject Code', 'Subject Name', 'Semester',
              'Cohort', 'Status', 'Total Students', 'Present', 'Absent',
              'Attendance %', 'Latest Revision No', 'Latest Action', 'Latest Snapshot SHA-256'
            ]
          },
          ['No finalized attendance sessions recorded for this date.']
        ]
      }
    ]);

    return {
      filename: sanitizeWorkbookFilename(`Attendance_Daily_${cleanDate}.xlsx`),
      mimeType: XLSX_MIME_TYPE,
      date: cleanDate,
      sessionCount: 0,
      sessions: [],
      ...emptyBuilt
    };
  }

  const whereClauses = [
    `s.session_date = ?`,
    `s.status IN ('submitted', 'locked')`
  ];
  const params = [cleanDate];

  if (Array.isArray(allowedSubjectIds)) {
    const ph = allowedSubjectIds.map(() => '?').join(', ');
    whereClauses.push(`s.subject_id IN (${ph})`);
    params.push(...allowedSubjectIds);
  }

  if (teacherProfile && actor.role === 'admin') {
    whereClauses.push('s.teacher_id = ?');
    params.push(teacherProfile.teacherId);
  }

  if (resolvedCohortId) {
    whereClauses.push('s.cohort_id = ?');
    params.push(resolvedCohortId);
  }

  const sessionRows = (await db.all(
    `SELECT s.*,
            sub.code AS subject_code,
            sub.name AS subject_name,
            c.display_name AS cohort_name,
            c.slot_code
     FROM attendance_sessions s
     JOIN subjects sub ON sub.id = s.subject_id
     JOIN cohorts c ON c.id = s.cohort_id
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY sub.code ASC, c.display_name ASC, s.id ASC`,
    ...params
  )) || [];

  const summaryRows = [
    [{ value: 'Semester Library — Daily Attendance Workbook', style: 1 }],
    ['Session Date (Nepal)', cleanDate, 'Generated For', actor.name],
    null, // placeholder for aggregate metrics row
    ['Evidence Note', 'This workbook reflects current committed attendance records. Historical teacher edits and admin corrections are preserved in immutable JSON snapshots.'],
    [],
    {
      style: 2,
      cells: [
        'Session ID', 'Session Date', 'Subject Code', 'Subject Name', 'Semester',
        'Cohort', 'Status', 'Total Students', 'Present', 'Absent',
        'Attendance %', 'Latest Revision No', 'Latest Action', 'Latest Snapshot SHA-256',
        'Original Submitted At', 'Last Updated At'
      ]
    }
  ];

  const sessionDetailSheets = [];
  const includedSessionMeta = [];
  let grandTotalStudents = 0;
  let grandTotalPresent = 0;
  let grandTotalAbsent = 0;

  for (const sRow of sessionRows) {
    const latestRun = await db.get(
      `SELECT revision_no, action, snapshot_sha256, created_at
       FROM attendance_backup_runs
       WHERE session_id = ?
       ORDER BY revision_no DESC
       LIMIT 1`,
      sRow.id
    );

    const recordRows = (await db.all(
      `SELECT ar.student_id, ar.status, ar.marked_by, ar.updated_at,
              stu.name AS student_name, stu.username AS student_username, stu.role AS student_role
       FROM attendance_records ar
       LEFT JOIN students stu ON stu.studentId = ar.student_id
       WHERE ar.session_id = ?
       ORDER BY ar.student_id ASC`,
      sRow.id
    )) || [];

    if (recordRows.length === 0) continue;

    let presentCount = 0;
    let absentCount = 0;
    for (const r of recordRows) {
      if (r.status === 'present') presentCount += 1;
      else absentCount += 1;
    }
    const totalCount = recordRows.length;
    const pct = totalCount > 0 ? Math.round((presentCount / totalCount) * 10000) / 100 : 0;

    grandTotalStudents += totalCount;
    grandTotalPresent += presentCount;
    grandTotalAbsent += absentCount;

    const revNo = Number(latestRun?.revisionNo ?? latestRun?.revision_no ?? sRow.latestRevisionNo ?? sRow.latest_revision_no ?? 1);
    const snapSha = latestRun?.snapshotSha256 || latestRun?.snapshot_sha256 || '';
    const lastAction = latestRun?.action || 'session_created';
    const subjCode = sRow.subjectCode || sRow.subject_code || sRow.subject_id;
    const subjName = sRow.subjectName || sRow.subject_name || subjCode;
    const cohortName = sRow.cohortName || sRow.cohort_name || sRow.cohort_id;
    const semesterNo = Number(sRow.semesterNo ?? sRow.semester_no ?? 1);
    const submittedAt = sRow.submittedAt || sRow.submitted_at || '';
    const updatedAt = sRow.updatedAt || sRow.updated_at || '';

    summaryRows.push([
      sRow.id,
      cleanDate,
      subjCode,
      subjName,
      semesterNo,
      cohortName,
      sRow.status,
      totalCount,
      presentCount,
      absentCount,
      pct,
      revNo,
      lastAction,
      snapSha,
      submittedAt,
      updatedAt
    ]);

    includedSessionMeta.push({
      sessionId: sRow.id,
      subjectId: sRow.subjectId || sRow.subject_id,
      subjectCode: subjCode,
      cohortId: sRow.cohortId || sRow.cohort_id,
      cohortName,
      sessionDate: cleanDate,
      revisionNo: revNo,
      snapshotSha256: snapSha,
      presentCount,
      absentCount,
      totalCount
    });

    const rawSheetTitle = `${subjCode}_${cohortName}`;
    const detailRows = [
      [{ value: `Session Attendance — ${subjCode} (${subjName})`, style: 1 }],
      ['Session ID', sRow.id, 'Session Date', cleanDate],
      ['Subject', `${subjCode} - ${subjName}`, 'Cohort', `${cohortName} (Semester ${semesterNo})`],
      ['Total Students', totalCount, 'Present', presentCount, 'Absent', absentCount, 'Attendance %', pct],
      ['Latest Revision No', revNo, 'Last Action', lastAction, 'Snapshot SHA-256', snapSha],
      ['Original Submitted At', submittedAt, 'Last Updated At', updatedAt],
      [],
      {
        style: 2,
        cells: ['S.N.', 'Student ID', 'Student Name', 'Username', 'Role', 'Attendance Status', 'Marked By', 'Updated At']
      },
      ...recordRows.map((rec, idx) => [
        idx + 1,
        rec.studentId || rec.student_id,
        rec.studentName || rec.student_name || (rec.studentId || rec.student_id),
        rec.studentUsername || rec.student_username || '',
        String(rec.studentRole || rec.student_role || 'student').toUpperCase(),
        rec.status === 'present' ? 'Present' : 'Absent',
        rec.markedBy || rec.marked_by || '',
        rec.updatedAt || rec.updated_at || ''
      ])
    ];

    sessionDetailSheets.push({
      name: rawSheetTitle,
      columnWidths: [8, 18, 28, 18, 12, 18, 18, 26],
      freezeRows: 8,
      rows: detailRows
    });
  }

  const overallPct = grandTotalStudents > 0
    ? Math.round((grandTotalPresent / grandTotalStudents) * 10000) / 100
    : 0;
  summaryRows[2] = [
    'Total Finalized Sessions', includedSessionMeta.length,
    'Total Present Marks', grandTotalPresent,
    'Total Absent Marks', grandTotalAbsent,
    'Overall Attendance %', overallPct
  ];

  if (includedSessionMeta.length === 0) {
    summaryRows.push(['No finalized attendance sessions recorded for this date.']);
  }

  const sheets = [
    {
      name: 'Daily Summary',
      columnWidths: [38, 14, 14, 28, 10, 16, 12, 14, 10, 10, 14, 16, 18, 66, 24, 24],
      freezeRows: 6,
      rows: summaryRows
    },
    ...sessionDetailSheets
  ];

  const built = buildXlsxWorkbookBuffer(sheets);
  return {
    filename: sanitizeWorkbookFilename(`Attendance_Daily_${cleanDate}.xlsx`),
    mimeType: XLSX_MIME_TYPE,
    date: cleanDate,
    sessionCount: includedSessionMeta.length,
    sessions: includedSessionMeta,
    ...built
  };
}

/**
 * PHASE 2B — 2. Server-Authoritative Annual Cumulative Attendance Workbook Generator
 * Generates a multi-sheet .xlsx workbook for a 4-digit calendar year (YYYY) containing:
 *   1. Session Overview
 *   2. Subject Summaries (calculated across ALL finalized sessions in the year, never capped at 50)
 *   3. Subject-Cohort Session Matrices (one sheet per subject + cohort + semester)
 *   4. Audit & Revisions Ledger (showing initial submissions, 24h teacher edits, and post-24h admin corrections)
 */
async function generateAnnualAttendanceWorkbook(db, {
  actorUserId,
  year,
  subjectId = null,
  cohortId = null,
  requestedTeacherId = null,
  requestedUserId = null,
  now = new Date()
}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);
  const defaultYear = formatNepalDate(effectiveNow).slice(0, 4);
  const cleanYear = validateWorkbookYear(year || defaultYear);
  const startDate = `${cleanYear}-01-01`;
  const endDate = `${cleanYear}-12-31`;

  const { teacherProfile, allowedSubjectIds, resolvedCohortId } = await resolveWorkbookAuthorizationScope(db, {
    actor,
    subjectId,
    cohortId,
    requestedTeacherId,
    requestedUserId
  });

  const buildEmptyAnnual = () => {
    const emptyBuilt = buildXlsxWorkbookBuffer([
      {
        name: 'Session Overview',
        columnWidths: [38, 14, 14, 28, 10, 16, 12, 14, 10, 10, 14, 16, 18, 66],
        freezeRows: 5,
        rows: [
          [{ value: `Semester Library — Annual Attendance Workbook (${cleanYear})`, style: 1 }],
          ['Academic Year', Number(cleanYear), 'Date Range', `${startDate} to ${endDate}`, 'Total Sessions', 0],
          ['Note', 'Editable report view derived from committed database records. Immutable revision snapshots are stored separately.'],
          [],
          {
            style: 2,
            cells: [
              'Session ID', 'Session Date', 'Subject Code', 'Subject Name', 'Semester',
              'Cohort', 'Status', 'Total Students', 'Present', 'Absent',
              'Attendance %', 'Latest Revision No', 'Latest Action', 'Latest Snapshot SHA-256'
            ]
          },
          ['No finalized attendance sessions recorded for this year.']
        ]
      },
      {
        name: 'Subject Summaries',
        rows: [
          [{ value: `Subject-Wise Attendance Summaries (${cleanYear})`, style: 1 }],
          ['No finalized attendance sessions recorded for this year.']
        ]
      },
      {
        name: 'Audit & Revisions',
        rows: [
          [{ value: `Attendance Revision & Audit History (${cleanYear})`, style: 1 }],
          ['No revision history recorded for this year.']
        ]
      }
    ]);

    return {
      filename: sanitizeWorkbookFilename(`Attendance_Year_${cleanYear}.xlsx`),
      mimeType: XLSX_MIME_TYPE,
      year: Number(cleanYear),
      startDate,
      endDate,
      sessionCount: 0,
      sessions: [],
      ...emptyBuilt
    };
  };

  if (Array.isArray(allowedSubjectIds) && allowedSubjectIds.length === 0) {
    return buildEmptyAnnual();
  }

  const whereClauses = [
    `s.session_date >= ?`,
    `s.session_date <= ?`,
    `s.status IN ('submitted', 'locked')`
  ];
  const params = [startDate, endDate];

  if (Array.isArray(allowedSubjectIds)) {
    const ph = allowedSubjectIds.map(() => '?').join(', ');
    whereClauses.push(`s.subject_id IN (${ph})`);
    params.push(...allowedSubjectIds);
  }

  if (teacherProfile && actor.role === 'admin') {
    whereClauses.push('s.teacher_id = ?');
    params.push(teacherProfile.teacherId);
  }

  if (resolvedCohortId) {
    whereClauses.push('s.cohort_id = ?');
    params.push(resolvedCohortId);
  }

  const sessionRows = (await db.all(
    `SELECT s.*,
            sub.code AS subject_code,
            sub.name AS subject_name,
            c.display_name AS cohort_name,
            c.slot_code
     FROM attendance_sessions s
     JOIN subjects sub ON sub.id = s.subject_id
     JOIN cohorts c ON c.id = s.cohort_id
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY s.session_date ASC, sub.code ASC, c.display_name ASC, s.id ASC`,
    ...params
  )) || [];

  if (sessionRows.length === 0) {
    return buildEmptyAnnual();
  }

  if (sessionRows.length > MAX_ANNUAL_WORKBOOK_SESSIONS) {
    throw createHttpError(
      413,
      `Annual workbook request exceeds the maximum bounded limit of ${MAX_ANNUAL_WORKBOOK_SESSIONS} sessions. Filter by subjectId or cohortId.`,
      'WORKBOOK_LIMIT_EXCEEDED'
    );
  }

  const sessionIds = sessionRows.map((s) => s.id);
  const sessionPh = sessionIds.map(() => '?').join(', ');

  // Batch-load all attendance_records for the authorized sessions in one query (no N+1)
  const allRecordRows = (await db.all(
    `SELECT ar.session_id, ar.student_id, ar.status, ar.marked_by, ar.updated_at,
            stu.name AS student_name, stu.username AS student_username, stu.role AS student_role
     FROM attendance_records ar
     LEFT JOIN students stu ON stu.studentId = ar.student_id
     WHERE ar.session_id IN (${sessionPh})
     ORDER BY ar.student_id ASC`,
    ...sessionIds
  )) || [];

  const recordsBySessionId = new Map();
  for (const r of allRecordRows) {
    const sid = r.sessionId || r.session_id;
    if (!recordsBySessionId.has(sid)) {
      recordsBySessionId.set(sid, []);
    }
    recordsBySessionId.get(sid).push(r);
  }

  // Batch-load all backup revisions & audit history for the authorized sessions
  const allRevisionRows = (await db.all(
    `SELECT r.*, a.actor_user_id, a.actor_role, a.reason
     FROM attendance_backup_runs r
     LEFT JOIN attendance_audit_logs a ON a.id = r.audit_log_id
     WHERE r.session_id IN (${sessionPh})
     ORDER BY r.session_id ASC, r.revision_no ASC`,
    ...sessionIds
  )) || [];

  const latestRevBySessionId = new Map();
  for (const rev of allRevisionRows) {
    const sid = rev.sessionId || rev.session_id;
    latestRevBySessionId.set(sid, rev);
  }

  // Filter strictly to finalized sessions that have >= 1 attendance record
  const validSessions = sessionRows.filter((s) => (recordsBySessionId.get(s.id) || []).length > 0);
  if (validSessions.length === 0) {
    return buildEmptyAnnual();
  }

  // 1. Build Sheet 1: Session Overview
  const overviewRows = [
    [{ value: `Semester Library — Annual Attendance Workbook (${cleanYear})`, style: 1 }],
    ['Academic Year', Number(cleanYear), 'Date Range', `${startDate} to ${endDate}`, 'Total Finalized Sessions', validSessions.length],
    ['Representation Note', 'This workbook displays the current committed attendance state per session alongside its latest revision number and SHA-256 hash. Every historical edit and post-24h administrative correction is listed in the "Audit & Revisions" sheet and preserved as an immutable JSON snapshot.'],
    [],
    {
      style: 2,
      cells: [
        'Session ID', 'Session Date', 'Subject Code', 'Subject Name', 'Semester',
        'Cohort', 'Status', 'Total Students', 'Present', 'Absent',
        'Attendance %', 'Latest Revision No', 'Latest Action', 'Latest Snapshot SHA-256',
        'Original Submitted At', 'Last Updated At'
      ]
    }
  ];

  // Group sessions by (subject_id, cohort_id, semester_no) for Subject Summaries & Matrices
  const subjectCohortGroups = new Map();
  const includedSessionsMeta = [];

  for (const sRow of validSessions) {
    const recs = recordsBySessionId.get(sRow.id) || [];
    let presentCount = 0;
    let absentCount = 0;
    for (const r of recs) {
      if (r.status === 'present') presentCount += 1;
      else absentCount += 1;
    }
    const totalCount = recs.length;
    const pct = totalCount > 0 ? Math.round((presentCount / totalCount) * 10000) / 100 : 0;

    const latestRev = latestRevBySessionId.get(sRow.id);
    const revNo = Number(latestRev?.revisionNo ?? latestRev?.revision_no ?? sRow.latestRevisionNo ?? sRow.latest_revision_no ?? 1);
    const snapSha = latestRev?.snapshotSha256 || latestRev?.snapshot_sha256 || '';
    const lastAction = latestRev?.action || 'session_created';
    const subjId = sRow.subjectId || sRow.subject_id;
    const subjCode = sRow.subjectCode || sRow.subject_code || subjId;
    const subjName = sRow.subjectName || sRow.subject_name || subjCode;
    const cohortIdVal = sRow.cohortId || sRow.cohort_id;
    const cohortName = sRow.cohortName || sRow.cohort_name || cohortIdVal;
    const semesterNo = Number(sRow.semesterNo ?? sRow.semester_no ?? 1);
    const sessionDate = sRow.sessionDate || sRow.session_date;

    overviewRows.push([
      sRow.id,
      sessionDate,
      subjCode,
      subjName,
      semesterNo,
      cohortName,
      sRow.status,
      totalCount,
      presentCount,
      absentCount,
      pct,
      revNo,
      lastAction,
      snapSha,
      sRow.submittedAt || sRow.submitted_at || '',
      sRow.updatedAt || sRow.updated_at || ''
    ]);

    includedSessionsMeta.push({
      sessionId: sRow.id,
      subjectId: subjId,
      subjectCode: subjCode,
      cohortId: cohortIdVal,
      cohortName,
      semesterNo,
      sessionDate,
      revisionNo: revNo,
      snapshotSha256: snapSha,
      presentCount,
      absentCount,
      totalCount
    });

    const groupKey = `${subjId}::${cohortIdVal}::${semesterNo}`;
    if (!subjectCohortGroups.has(groupKey)) {
      subjectCohortGroups.set(groupKey, {
        subjectId: subjId,
        subjectCode: subjCode,
        subjectName: subjName,
        cohortId: cohortIdVal,
        cohortName,
        semesterNo,
        sessions: [],
        studentsById: new Map()
      });
    }
    const group = subjectCohortGroups.get(groupKey);
    group.sessions.push({
      sessionId: sRow.id,
      sessionDate,
      revisionNo: revNo,
      snapshotSha256: snapSha,
      records: recs
    });

    for (const r of recs) {
      const stuId = r.studentId || r.student_id;
      if (!group.studentsById.has(stuId)) {
        group.studentsById.set(stuId, {
          studentId: stuId,
          name: r.studentName || r.student_name || stuId,
          username: r.studentUsername || r.student_username || '',
          role: String(r.studentRole || r.student_role || 'student').toUpperCase()
        });
      }
    }
  }

  // Also include any active cohort students who might not have had a row in an earlier partial record
  for (const group of subjectCohortGroups.values()) {
    const cohortStudents = (await db.all(
      `SELECT studentId, username, name, role
       FROM students
       WHERE cohort_id = ?
         AND LOWER(COALESCE(role, 'student')) IN ('student', 'cr')
         AND LOWER(COALESCE(account_status, 'active')) = 'active'
       ORDER BY studentId ASC`,
      group.cohortId
    )) || [];
    for (const cs of cohortStudents) {
      const stuId = cs.studentId || cs.studentid;
      if (!group.studentsById.has(stuId)) {
        group.studentsById.set(stuId, {
          studentId: stuId,
          name: cs.name || stuId,
          username: cs.username || '',
          role: String(cs.role || 'student').toUpperCase()
        });
      }
    }
  }

  // 2. Build Sheet 2: Subject Summaries & Sheet 3+: Subject-Cohort Session Matrices
  const subjectSummaryRows = [
    [{ value: `Subject-Wise Student Attendance Summaries (${cleanYear})`, style: 1 }],
    ['Note', 'Calculated directly from all finalized attendance sessions in the database (uncapped).'],
    [],
    {
      style: 2,
      cells: [
        'Subject Code', 'Subject Name', 'Semester', 'Cohort',
        'Student ID', 'Student Name', 'Role',
        'Total Sessions', 'Present Count', 'Absent Count', 'Attendance %'
      ]
    }
  ];

  const matrixSheets = [];

  for (const group of subjectCohortGroups.values()) {
    const totalGroupSessions = group.sessions.length;
    const sortedStudents = [...group.studentsById.values()].sort((a, b) =>
      a.studentId.localeCompare(b.studentId)
    );

    const matrixHeaderCells = [
      'Student ID',
      'Student Name',
      'Role',
      'Total Sessions',
      'Present',
      'Absent',
      'Attendance %',
      ...group.sessions.map((s) => `${s.sessionDate} (v${s.revisionNo})`)
    ];

    const matrixBodyRows = [];

    for (const stu of sortedStudents) {
      let presentCount = 0;
      let absentCount = 0;
      const perSessionMarks = [];

      for (const sess of group.sessions) {
        const rec = sess.records.find((r) => (r.studentId || r.student_id) === stu.studentId);
        const status = rec && rec.status === 'present' ? 'present' : 'absent';
        if (status === 'present') {
          presentCount += 1;
          perSessionMarks.push('P');
        } else {
          absentCount += 1;
          perSessionMarks.push('A');
        }
      }

      const pct = totalGroupSessions > 0
        ? Math.round((presentCount / totalGroupSessions) * 10000) / 100
        : 0;

      subjectSummaryRows.push([
        group.subjectCode,
        group.subjectName,
        group.semesterNo,
        group.cohortName,
        stu.studentId,
        stu.name,
        stu.role,
        totalGroupSessions,
        presentCount,
        absentCount,
        pct
      ]);

      matrixBodyRows.push([
        stu.studentId,
        stu.name,
        stu.role,
        totalGroupSessions,
        presentCount,
        absentCount,
        pct,
        ...perSessionMarks
      ]);
    }

    matrixSheets.push({
      name: `Mat_${group.subjectCode}_${group.cohortName}_S${group.semesterNo}`,
      columnWidths: [16, 26, 10, 14, 10, 10, 14, ...group.sessions.map(() => 16)],
      freezeRows: 5,
      rows: [
        [{ value: `Session Matrix — ${group.subjectCode} (${group.subjectName})`, style: 1 }],
        ['Cohort', group.cohortName, 'Semester', group.semesterNo, 'Total Sessions', totalGroupSessions],
        ['Legend', 'P = Present, A = Absent. Column header shows YYYY-MM-DD and latest committed revision (vN).'],
        [],
        { style: 2, cells: matrixHeaderCells },
        ...matrixBodyRows
      ]
    });
  }

  // 4. Build Final Sheet: Audit & Revisions
  const sessionById = new Map(validSessions.map((s) => [s.id, s]));
  const auditRows = [
    [{ value: `Attendance Revision & Audit Ledger (${cleanYear})`, style: 1 }],
    ['Note', 'Lists every immutable revision (initial submission, 24h teacher edit, and post-24h admin correction) and its SHA-256 hash chain.'],
    [],
    {
      style: 2,
      cells: [
        'Session ID', 'Session Date', 'Subject Code', 'Cohort', 'Revision No',
        'Action', 'Actor User ID', 'Actor Role', 'Reason',
        'Previous Snapshot SHA-256', 'Snapshot SHA-256', 'Backup Status', 'Timestamp'
      ]
    }
  ];

  for (const rev of allRevisionRows) {
    const sid = rev.sessionId || rev.session_id;
    const sRow = sessionById.get(sid);
    if (!sRow) continue;
    auditRows.push([
      sid,
      sRow.sessionDate || sRow.session_date,
      sRow.subjectCode || sRow.subject_code || sRow.subject_id,
      sRow.cohortName || sRow.cohort_name || sRow.cohort_id,
      Number(rev.revisionNo ?? rev.revision_no ?? 1),
      rev.action,
      rev.actorUserId || rev.actor_user_id || '',
      rev.actorRole || rev.actor_role || '',
      rev.reason || '',
      rev.previousSnapshotSha256 || rev.previous_snapshot_sha256 || '',
      rev.snapshotSha256 || rev.snapshot_sha256 || '',
      rev.backupStatus || rev.backup_status || 'pending',
      rev.createdAt || rev.created_at || ''
    ]);
  }

  const sheets = [
    {
      name: 'Session Overview',
      columnWidths: [38, 14, 14, 28, 10, 16, 12, 14, 10, 10, 14, 16, 18, 66, 24, 24],
      freezeRows: 5,
      rows: overviewRows
    },
    {
      name: 'Subject Summaries',
      columnWidths: [14, 28, 10, 16, 16, 26, 10, 14, 14, 14, 14],
      freezeRows: 4,
      rows: subjectSummaryRows
    },
    ...matrixSheets,
    {
      name: 'Audit & Revisions',
      columnWidths: [38, 14, 14, 16, 12, 18, 18, 12, 32, 66, 66, 16, 24],
      freezeRows: 4,
      rows: auditRows
    }
  ];

  const built = buildXlsxWorkbookBuffer(sheets);
  return {
    filename: sanitizeWorkbookFilename(`Attendance_Year_${cleanYear}.xlsx`),
    mimeType: XLSX_MIME_TYPE,
    year: Number(cleanYear),
    startDate,
    endDate,
    sessionCount: includedSessionsMeta.length,
    sessions: includedSessionsMeta,
    ...built
  };
}

/**
 * 9. GET /api/attendance/backup/runs/:runId/artifacts
 * Returns the canonical snapshot payload, per-artifact tracking state, and workbook
 * artifact metadata (plus optional base64 XLSX payloads if includePayloads is requested).
 * Enforces that stale revisions cannot generate or overwrite newer workbook artifacts.
 */
async function getBackupRunArtifacts(db, {
  actorUserId,
  runId,
  includePayloads = false,
  now = new Date()
}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const nowIso = effectiveNow.toISOString();
  const actor = await resolveAuthenticatedActor(db, actorUserId, ['teacher', 'admin']);

  if (!runId || !String(runId).trim()) {
    throw createHttpError(400, 'runId is required.', 'MISSING_RUN_ID');
  }
  const cleanRunId = String(runId).trim();

  const runRow = await db.get('SELECT * FROM attendance_backup_runs WHERE id = ?', cleanRunId);
  if (!runRow) {
    throw createHttpError(404, 'Attendance backup run not found.', 'BACKUP_RUN_NOT_FOUND');
  }

  const sessionRow = await db.get(
    `SELECT s.*, sub.code AS subject_code, sub.name AS subject_name,
            c.display_name AS cohort_name, c.slot_code
     FROM attendance_sessions s
     LEFT JOIN subjects sub ON sub.id = s.subject_id
     LEFT JOIN cohorts c ON c.id = s.cohort_id
     WHERE s.id = ?`,
    runRow.sessionId || runRow.session_id
  );

  await verifyBackupSessionAndRunAccess(db, actor, sessionRow, runRow, { requireTeacherOwner: false });

  const runRevNo = Number(runRow.revisionNo ?? runRow.revision_no ?? 1);
  const latestSessionRevNo = Number(sessionRow.latestRevisionNo ?? sessionRow.latest_revision_no ?? runRevNo);
  const isLatestRevision = runRevNo === latestSessionRevNo;

  let artifactRows = await ensureBackupRunArtifactsTx(db, runRow, sessionRow);
  if (!isLatestRevision) {
    await db.run(
      `UPDATE attendance_backup_artifacts
       SET status = 'superseded',
           claim_token = NULL,
           claimed_by_client_id = NULL,
           lease_expires_at = NULL,
           updated_at = ?
       WHERE run_id = ?
         AND artifact_type IN ('daily_workbook', 'annual_workbook')
         AND status NOT IN ('backed_up', 'superseded')`,
      nowIso,
      cleanRunId
    );
    const synced = await syncBackupRunRollupTx(db, cleanRunId, nowIso);
    artifactRows = synced.artifacts;
  }

  const formattedArtifacts = artifactRows.map((a) => formatArtifactRow(a, effectiveNow));
  const snapshotArtifact = formattedArtifacts.find((a) => a.artifactType === 'snapshot');
  const dailyArtifact = formattedArtifacts.find((a) => a.artifactType === 'daily_workbook');
  const annualArtifact = formattedArtifacts.find((a) => a.artifactType === 'annual_workbook');

  let parsedPayload = runRow.snapshotPayload || runRow.snapshot_payload || null;
  if (typeof parsedPayload === 'string') {
    try {
      parsedPayload = JSON.parse(parsedPayload);
    } catch (_) {
      parsedPayload = null;
    }
  }

  const sessionDate = sessionRow.sessionDate || sessionRow.session_date;
  const yearStr = String(sessionDate).slice(0, 4);
  const runSha256 = runRow.snapshotSha256 || runRow.snapshot_sha256;

  let dailyWorkbookBundle = null;
  let annualWorkbookBundle = null;

  if (includePayloads && isLatestRevision) {
    const dailyBuilt = await generateDailyAttendanceWorkbook(db, {
      actorUserId: actor.studentId,
      date: sessionDate,
      requestedTeacherId: runRow.teacherId || runRow.teacher_id,
      now: effectiveNow
    });
    dailyWorkbookBundle = {
      filename: dailyBuilt.filename,
      mimeType: dailyBuilt.mimeType,
      sha256: dailyBuilt.sha256,
      sizeBytes: dailyBuilt.sizeBytes,
      sheetNames: dailyBuilt.sheetNames,
      base64: dailyBuilt.buffer.toString('base64')
    };

    const annualBuilt = await generateAnnualAttendanceWorkbook(db, {
      actorUserId: actor.studentId,
      year: yearStr,
      requestedTeacherId: runRow.teacherId || runRow.teacher_id,
      now: effectiveNow
    });
    annualWorkbookBundle = {
      filename: annualBuilt.filename,
      mimeType: annualBuilt.mimeType,
      sha256: annualBuilt.sha256,
      sizeBytes: annualBuilt.sizeBytes,
      sheetNames: annualBuilt.sheetNames,
      base64: annualBuilt.buffer.toString('base64')
    };
  }

  return {
    runId: cleanRunId,
    sessionId: sessionRow.id,
    teacherId: runRow.teacherId || runRow.teacher_id,
    revisionNo: runRevNo,
    latestSessionRevisionNo: latestSessionRevNo,
    isLatestRevision,
    action: runRow.action,
    previousSnapshotSha256: runRow.previousSnapshotSha256 || runRow.previous_snapshot_sha256 || null,
    snapshotSha256: runSha256,
    backupStatus: runRow.backupStatus || runRow.backup_status,
    artifacts: formattedArtifacts,
    snapshot: {
      artifactId: snapshotArtifact?.id || null,
      status: snapshotArtifact?.status || 'pending',
      filename: snapshotArtifact?.driveFileName || `snapshot_v${runRevNo}.json`,
      mimeType: 'application/json',
      sha256: runSha256,
      payload: parsedPayload
    },
    workbooks: {
      daily: {
        artifactId: dailyArtifact?.id || null,
        status: dailyArtifact?.status || (isLatestRevision ? 'pending' : 'superseded'),
        supersededByRevisionNo: isLatestRevision ? null : latestSessionRevNo,
        date: sessionDate,
        filename: dailyArtifact?.driveFileName || `Attendance_Daily_${sessionDate}.xlsx`,
        mimeType: XLSX_MIME_TYPE,
        downloadPath: `/api/attendance/backup/workbooks/daily?date=${encodeURIComponent(sessionDate)}`,
        bundle: dailyWorkbookBundle
      },
      annual: {
        artifactId: annualArtifact?.id || null,
        status: annualArtifact?.status || (isLatestRevision ? 'pending' : 'superseded'),
        supersededByRevisionNo: isLatestRevision ? null : latestSessionRevNo,
        year: Number(yearStr),
        filename: annualArtifact?.driveFileName || `Attendance_Year_${yearStr}.xlsx`,
        mimeType: XLSX_MIME_TYPE,
        downloadPath: `/api/attendance/backup/workbooks/annual?year=${encodeURIComponent(yearStr)}`,
        bundle: annualWorkbookBundle
      }
    }
  };
}

module.exports = {
  DEFAULT_LEASE_DURATION_MS,
  MAX_BACKUP_ATTEMPTS,
  MAX_ANNUAL_WORKBOOK_SESSIONS,
  VALID_ARTIFACT_TYPES,
  assertNoForbiddenSecrets,
  sanitizeBackupErrorMessage,
  sanitizeBackupErrorCode,
  assertNoForgedOwnership,
  resolveCanonicalTeacherProfile,
  getDriveOAuthConfigStatus,
  buildArtifactDefinitionsForRun,
  formatArtifactRow,
  computeBackupRunRollup,
  ensureBackupRunArtifactsTx,
  syncBackupRunRollupTx,
  getTeacherDriveBackupStatus,
  upsertTeacherDriveConnection,
  disconnectTeacherDriveConnection,
  listPendingBackupWork,
  claimBackupRunArtifacts,
  completeBackupArtifact,
  failBackupArtifact,
  getSessionBackupRevisionsAuthorized,
  getBackupRunArtifacts,
  generateDailyAttendanceWorkbook,
  generateAnnualAttendanceWorkbook
};
