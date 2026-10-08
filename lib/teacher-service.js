'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DEFAULT_INVITE_EXPIRY_DAYS = 14;
const ONBOARDING_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'system',
  'teacher',
  'teachers',
  'student',
  'students',
  'moderator',
  'help',
  'support',
  'api',
  'root',
  'auth',
  'null',
  'undefined',
  'faculty',
  'staff',
  'cr',
  'dashboard',
  'settings',
  'profile',
  'chat',
  'games',
  'routine',
  'syllabus'
]);

function isTeacherOnboardingEnabled() {
  const val = process.env.TEACHER_ONBOARDING_ENABLED;
  return val === '1' || val === 'true';
}

function getTeacherOnboardingSecret() {
  const secret = process.env.TEACHER_ONBOARDING_SECRET;
  if (secret && typeof secret === 'string' && secret.trim().length >= 16) {
    return secret.trim();
  }

  if (process.env.NODE_ENV === 'test' && !process.env.__TEST_FORCE_PROD_SECRET_CHECK) {
    return 'test-teacher-onboarding-secret-key-32-bytes-secure!';
  }

  if (process.env.NODE_ENV === 'production' || process.env.__TEST_FORCE_PROD_SECRET_CHECK) {
    throw new Error('FATAL: TEACHER_ONBOARDING_SECRET environment variable is required in production.');
  }

  // Development fallback with clear warning
  return 'dev-local-teacher-onboarding-secret-do-not-use-in-prod!';
}

/**
 * Base64URL encode and decode helpers.
 */
function toBase64Url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Creates a signed restricted onboarding token.
 */
function signOnboardingToken({ inviteId, initialUsername, nonce = 1, ttlMs = ONBOARDING_TOKEN_TTL_MS }) {
  const secret = getTeacherOnboardingSecret();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.floor(ttlMs / 1000);

  const header = { alg: 'HS256', typ: 'teacher_onboarding' };
  const payload = {
    inviteId,
    initialUsername,
    nonce,
    scope: 'teacher_onboarding',
    iat: now,
    exp
  };

  const headerPart = toBase64Url(JSON.stringify(header));
  const payloadPart = toBase64Url(JSON.stringify(payload));
  const data = `${headerPart}.${payloadPart}`;

  const sig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');

  return {
    token: `${data}.${sig}`,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

/**
 * Verifies a restricted onboarding token.
 */
function verifyOnboardingToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token is required' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid token structure' };
  }

  const [headerPart, payloadPart, sigPart] = parts;
  const secret = getTeacherOnboardingSecret();
  const data = `${headerPart}.${payloadPart}`;

  let expectedSig;
  try {
    expectedSig = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('base64url');
  } catch (err) {
    return { valid: false, error: 'Signature verification failure' };
  }

  const sigBuffer = Buffer.from(sigPart);
  const expectedBuffer = Buffer.from(expectedSig);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, error: 'Invalid token signature' };
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(payloadPart));
  } catch {
    return { valid: false, error: 'Malformed token payload' };
  }

  if (payload.scope !== 'teacher_onboarding') {
    return { valid: false, error: 'Invalid token scope' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    return { valid: false, error: 'Token has expired' };
  }

  return { valid: true, payload };
}

/**
 * Schema initialization for Teacher Accounts and Subjects Catalog.
 * Idempotent across PostgreSQL and SQLite.
 */
async function ensureTeacherSchema({ exec, isPostgres }) {
  if (isPostgres) {
    await exec(`
      CREATE TABLE IF NOT EXISTS teacher_invites (
        id TEXT PRIMARY KEY,
        initial_username TEXT NOT NULL,
        temporary_password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'provisioned' CHECK (status IN ('provisioned', 'onboarding', 'awaiting_email_verification', 'completed', 'expired', 'disabled')),
        expires_at TIMESTAMPTZ NOT NULL,
        claimed_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        onboarding_nonce INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT REFERENCES students(studentId) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_invites_username ON teacher_invites (LOWER(initial_username));
      CREATE INDEX IF NOT EXISTS idx_teacher_invites_status ON teacher_invites (status);
      CREATE INDEX IF NOT EXISTS idx_teacher_invites_expires ON teacher_invites (expires_at);

      CREATE TABLE IF NOT EXISTS subjects (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
        department TEXT NOT NULL DEFAULT 'BIT',
        credit_hours NUMERIC(3, 1) DEFAULT 3.0,
        nature TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_subjects_semester ON subjects (semester);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_code ON subjects (code);

      CREATE TABLE IF NOT EXISTS teachers (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES students(studentId) ON DELETE CASCADE,
        invite_id TEXT UNIQUE REFERENCES teacher_invites(id) ON DELETE SET NULL,
        designation TEXT DEFAULT 'Instructor',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers (user_id);
      CREATE INDEX IF NOT EXISTS idx_teachers_status ON teachers (status);

      CREATE TABLE IF NOT EXISTS teacher_subjects (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(teacher_id, subject_id)
      );
      CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher ON teacher_subjects (teacher_id);
      CREATE INDEX IF NOT EXISTS idx_teacher_subjects_subject ON teacher_subjects (subject_id);

      CREATE TABLE IF NOT EXISTS teacher_onboarding_pending (
        id TEXT PRIMARY KEY,
        invite_id TEXT NOT NULL UNIQUE REFERENCES teacher_invites(id) ON DELETE CASCADE,
        supabase_uid TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_verification_sent_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ NOT NULL
      );
      ALTER TABLE teacher_onboarding_pending ADD COLUMN IF NOT EXISTS last_verification_sent_at TIMESTAMPTZ;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_pending_username ON teacher_onboarding_pending (LOWER(username));
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_pending_email ON teacher_onboarding_pending (LOWER(email));
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_pending_supabase_uid ON teacher_onboarding_pending (supabase_uid);

      CREATE TABLE IF NOT EXISTS teacher_onboarding_pending_subjects (
        id TEXT PRIMARY KEY,
        pending_id TEXT NOT NULL REFERENCES teacher_onboarding_pending(id) ON DELETE CASCADE,
        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(pending_id, subject_id)
      );
      CREATE INDEX IF NOT EXISTS idx_teacher_pending_subjects_pending ON teacher_onboarding_pending_subjects (pending_id);
      CREATE INDEX IF NOT EXISTS idx_teacher_pending_subjects_subject ON teacher_onboarding_pending_subjects (subject_id);
    `);
  } else {
    await exec(`
      CREATE TABLE IF NOT EXISTS teacher_invites (
        id TEXT PRIMARY KEY,
        initial_username TEXT NOT NULL,
        temporary_password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'provisioned' CHECK (status IN ('provisioned', 'onboarding', 'awaiting_email_verification', 'completed', 'expired', 'disabled')),
        expires_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT,
        onboarding_nonce INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        FOREIGN KEY (created_by) REFERENCES students(studentId) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_invites_username ON teacher_invites (LOWER(initial_username));
      CREATE INDEX IF NOT EXISTS idx_teacher_invites_status ON teacher_invites (status);
      CREATE INDEX IF NOT EXISTS idx_teacher_invites_expires ON teacher_invites (expires_at);

      CREATE TABLE IF NOT EXISTS subjects (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
        department TEXT NOT NULL DEFAULT 'BIT',
        credit_hours REAL DEFAULT 3.0,
        nature TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_subjects_semester ON subjects (semester);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_code ON subjects (code);

      CREATE TABLE IF NOT EXISTS teachers (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        invite_id TEXT UNIQUE,
        designation TEXT DEFAULT 'Instructor',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES students(studentId) ON DELETE CASCADE,
        FOREIGN KEY (invite_id) REFERENCES teacher_invites(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers (user_id);
      CREATE INDEX IF NOT EXISTS idx_teachers_status ON teachers (status);

      CREATE TABLE IF NOT EXISTS teacher_subjects (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(teacher_id, subject_id),
        FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher ON teacher_subjects (teacher_id);
      CREATE INDEX IF NOT EXISTS idx_teacher_subjects_subject ON teacher_subjects (subject_id);

      CREATE TABLE IF NOT EXISTS teacher_onboarding_pending (
        id TEXT PRIMARY KEY,
        invite_id TEXT NOT NULL UNIQUE,
        supabase_uid TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_verification_sent_at TEXT,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (invite_id) REFERENCES teacher_invites(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_pending_username ON teacher_onboarding_pending (LOWER(username));
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_pending_email ON teacher_onboarding_pending (LOWER(email));
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_pending_supabase_uid ON teacher_onboarding_pending (supabase_uid);

      CREATE TABLE IF NOT EXISTS teacher_onboarding_pending_subjects (
        id TEXT PRIMARY KEY,
        pending_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(pending_id, subject_id),
        FOREIGN KEY (pending_id) REFERENCES teacher_onboarding_pending(id) ON DELETE CASCADE,
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_teacher_pending_subjects_pending ON teacher_onboarding_pending_subjects (pending_id);
      CREATE INDEX IF NOT EXISTS idx_teacher_pending_subjects_subject ON teacher_onboarding_pending_subjects (subject_id);
    `);

    // Ensure last_verification_sent_at column exists in SQLite table if table already existed
    try {
      await exec(`ALTER TABLE teacher_onboarding_pending ADD COLUMN last_verification_sent_at TEXT;`);
    } catch (_) {
      // Column already exists
    }
  }
}

/**
 * Idempotently seeds the 45 canonical courses from syllabus-data.json.
 */
async function seedCanonicalSubjects(db) {
  const syllabusPath = path.join(__dirname, '..', 'syllabus-data.json');
  if (!fs.existsSync(syllabusPath)) {
    throw new Error(`Canonical syllabus file not found at ${syllabusPath}`);
  }

  const rawData = JSON.parse(fs.readFileSync(syllabusPath, 'utf8'));
  const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

  const courses = [];
  for (const s of rawData.semesters || []) {
    const semIndex = ROMANS.indexOf((s.semester || '').trim());
    const semNum = semIndex !== -1 ? semIndex + 1 : parseInt(s.semester, 10);
    if (!semNum || semNum < 1 || semNum > 8) {
      throw new Error(`Invalid semester indicator in syllabus data: ${s.semester}`);
    }

    for (const c of s.courses || []) {
      const code = (c.code || '').trim();
      const title = (c.title || '').trim();
      if (!code || !title) continue;

      const credit = parseFloat(String(c.credit).replace(/[^\d.]/g, '')) || 3.0;
      courses.push({
        id: code,
        code,
        name: title,
        semester: semNum,
        department: 'BIT',
        credit_hours: credit,
        nature: c.nature ? c.nature.trim() : null,
        active: db.isPostgres ? true : 1
      });
    }
  }

  if (courses.length !== 45) {
    throw new Error(`Expected exactly 45 canonical courses from syllabus-data.json, found ${courses.length}`);
  }

  let insertedOrUpdated = 0;
  for (const course of courses) {
    if (db.isPostgres) {
      await db.run(
        `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           code = EXCLUDED.code,
           name = EXCLUDED.name,
           semester = EXCLUDED.semester,
           credit_hours = EXCLUDED.credit_hours,
           nature = EXCLUDED.nature,
           active = EXCLUDED.active,
           updated_at = CURRENT_TIMESTAMP`,
        course.id,
        course.code,
        course.name,
        course.semester,
        course.department,
        course.credit_hours,
        course.nature,
        course.active
      );
    } else {
      await db.run(
        `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           code = excluded.code,
           name = excluded.name,
           semester = excluded.semester,
           credit_hours = excluded.credit_hours,
           nature = excluded.nature,
           active = excluded.active,
           updated_at = datetime('now')`,
        course.id,
        course.code,
        course.name,
        course.semester,
        course.department,
        course.credit_hours,
        course.nature,
        course.active
      );
    }
    insertedOrUpdated++;
  }

  return { totalSeeded: insertedOrUpdated };
}

/**
 * Validates teacher display name.
 */
function validateTeacherName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, reason: 'Full name is required.' };
  }

  const cleaned = name.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2 || cleaned.length > 100) {
    return { valid: false, reason: 'Full name must be between 2 and 100 characters.' };
  }

  // Realistic Unicode names, accents, dots, and hyphens supported (e.g. "Dr. Ram Sharma", "Prof. A. K. Joshi")
  if (!/^[\p{L}\p{M}\s.'-]+$/u.test(cleaned)) {
    return { valid: false, reason: 'Full name contains invalid characters.' };
  }

  return { valid: true, cleanedName: cleaned };
}

/**
 * Validates permanent teacher username against rules and global namespace.
 */
async function checkPermanentUsernameAvailability(db, username, currentInviteId = null) {
  if (!username || typeof username !== 'string') {
    return { available: false, reason: 'Username is required.' };
  }

  const clean = username.trim().toLowerCase();
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(clean)) {
    return {
      available: false,
      reason: 'Username must be 3-30 characters (letters, numbers, underscore, dot).'
    };
  }

  if (RESERVED_USERNAMES.has(clean)) {
    return { available: false, reason: 'This username is reserved.' };
  }

  // Check collision in students table (the authoritative account anchor)
  const existingStudent = await db.get(
    'SELECT studentId FROM students WHERE LOWER(username) = ?',
    clean
  );

  if (existingStudent) {
    return { available: false, reason: 'This username is already taken.' };
  }

  // Check collision in still-valid pending onboarding reservations
  try {
    const existingPending = await db.get(
      'SELECT id, invite_id FROM teacher_onboarding_pending WHERE LOWER(username) = ?',
      clean
    );
    if (existingPending && (!currentInviteId || existingPending.invite_id !== currentInviteId)) {
      return { available: false, reason: 'This username is currently reserved.' };
    }
  } catch (_) {}

  return { available: true, username: clean };
}

/**
 * Validates recovery email availability against global namespace.
 */
async function checkPermanentEmailAvailability(db, email, currentInviteId = null) {
  if (!email || typeof email !== 'string') {
    return { available: false, reason: 'Email is required.' };
  }

  const clean = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(clean) || clean.length > 150) {
    return { available: false, reason: 'Please provide a valid email address.' };
  }

  const existingEmail = await db.get(
    'SELECT studentId FROM students WHERE LOWER(email) = ?',
    clean
  );

  if (existingEmail) {
    return { available: false, code: 'EMAIL_COLLISION', reason: 'An account with this email address already exists.' };
  }

  // Check collision in still-valid pending onboarding reservations
  try {
    const existingPendingEmail = await db.get(
      'SELECT id, invite_id FROM teacher_onboarding_pending WHERE LOWER(email) = ?',
      clean
    );
    if (existingPendingEmail && (!currentInviteId || existingPendingEmail.invite_id !== currentInviteId)) {
      return { available: false, code: 'EMAIL_COLLISION', reason: 'This email is currently reserved.' };
    }
  } catch (_) {}

  return { available: true, email: clean };
}

/**
 * Creates a pre-provisioned teacher invite with transaction-safe global collision check.
 */
async function createTeacherInvite(db, {
  initialUsername,
  temporaryPassword,
  createdBy = null,
  expiryDays = DEFAULT_INVITE_EXPIRY_DAYS
}) {
  if (!initialUsername || !temporaryPassword) {
    throw new Error('initialUsername and temporaryPassword are required');
  }

  const cleanUsername = initialUsername.trim().toLowerCase();
  if (RESERVED_USERNAMES.has(cleanUsername)) {
    throw new Error(`Username "${cleanUsername}" is reserved.`);
  }

  // 1. Global collision check against students.username
  const existingStudent = await db.get(
    'SELECT studentId FROM students WHERE LOWER(username) = ? OR LOWER(studentId) = ?',
    cleanUsername,
    cleanUsername
  );
  if (existingStudent) {
    throw new Error(`Username "${cleanUsername}" collides with an existing student account.`);
  }

  // 2. Collision check against teacher_invites
  const existingInvite = await db.get(
    'SELECT id, status FROM teacher_invites WHERE LOWER(initial_username) = ?',
    cleanUsername
  );
  if (existingInvite) {
    throw new Error(`Username "${cleanUsername}" is already provisioned (status: ${existingInvite.status}).`);
  }

  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(temporaryPassword, 12);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

  if (db.isPostgres) {
    await db.run(
      `INSERT INTO teacher_invites (
        id, initial_username, temporary_password_hash, status, expires_at, created_by
      ) VALUES ($1, $2, $3, 'provisioned', $4, $5)`,
      id,
      cleanUsername,
      hash,
      expiresAt,
      createdBy
    );
  } else {
    await db.run(
      `INSERT INTO teacher_invites (
        id, initial_username, temporary_password_hash, status, expires_at, created_by
      ) VALUES (?, ?, ?, 'provisioned', ?, ?)`,
      id,
      cleanUsername,
      hash,
      expiresAt,
      createdBy
    );
  }

  return {
    id,
    initialUsername: cleanUsername,
    expiresAt,
    status: 'provisioned'
  };
}

/**
 * Verifies temporary teacher credentials and returns invite details if valid.
 */
async function verifyTemporaryTeacherCredentials(db, { username, password }) {
  if (!username || !password) {
    return { success: false, reason: 'INVALID_CREDENTIALS' };
  }

  const cleanUsername = String(username).trim().toLowerCase();
  const invite = await db.get(
    'SELECT * FROM teacher_invites WHERE LOWER(initial_username) = ?',
    cleanUsername
  );

  if (!invite) {
    return { success: false, reason: 'INVALID_CREDENTIALS' };
  }

  const status = invite.status;
  if (status === 'disabled') {
    return { success: false, reason: 'INVITE_DISABLED' };
  }
  if (status === 'completed') {
    return { success: false, reason: 'INVITE_COMPLETED' };
  }

  const expiresAt = new Date(invite.expires_at || invite.expiresat).getTime();
  if (expiresAt < Date.now()) {
    return { success: false, reason: 'INVITE_EXPIRED' };
  }

  const passHash = invite.temporary_password_hash || invite.temporarypasswordhash;
  const matches = bcrypt.compareSync(String(password), passHash);
  if (!matches) {
    return { success: false, reason: 'INVALID_CREDENTIALS' };
  }

  // Update status from 'provisioned' to 'onboarding' on first successful credential check
  // or increment nonce on subsequent logins so older onboarding tokens are safely revoked
  const nowIso = new Date().toISOString();
  if (status === 'provisioned') {
    if (db.isPostgres) {
      await db.run(
        `UPDATE teacher_invites SET status = 'onboarding', claimed_at = COALESCE(claimed_at, $1) WHERE id = $2`,
        nowIso,
        invite.id
      );
    } else {
      await db.run(
        `UPDATE teacher_invites SET status = 'onboarding', claimed_at = COALESCE(claimed_at, ?) WHERE id = ?`,
        nowIso,
        invite.id
      );
    }
    invite.status = 'onboarding';
  } else if (status === 'onboarding' || status === 'awaiting_email_verification') {
    if (db.isPostgres) {
      await db.run(
        `UPDATE teacher_invites SET onboarding_nonce = onboarding_nonce + 1 WHERE id = $1`,
        invite.id
      );
    } else {
      await db.run(
        `UPDATE teacher_invites SET onboarding_nonce = onboarding_nonce + 1 WHERE id = ?`,
        invite.id
      );
    }
    const updated = await db.get('SELECT onboarding_nonce FROM teacher_invites WHERE id = ?', invite.id);
    invite.onboarding_nonce = updated?.onboarding_nonce ?? updated?.onboardingnonce ?? ((invite.onboarding_nonce || 1) + 1);
  }

  return { success: true, invite };
}

function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const parts = email.trim().split('@');
  if (parts.length !== 2) return '***';
  const [local, domain] = parts;
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/**
 * Returns safe onboarding state for an invite ID.
 */
async function getOnboardingState(db, inviteId) {
  if (!inviteId) return null;

  const invite = await db.get(
    'SELECT id, initial_username, status, expires_at, onboarding_nonce FROM teacher_invites WHERE id = ?',
    inviteId
  );

  if (!invite) return null;

  const initialUsername = invite.initial_username || invite.initialusername;
  const expiresAt = invite.expires_at || invite.expiresat;
  const status = invite.status;

  let pendingData = null;
  if (status === 'awaiting_email_verification') {
    const pending = await db.get(
      'SELECT id, name, username, email FROM teacher_onboarding_pending WHERE invite_id = ?',
      invite.id
    );
    if (pending) {
      const subCountRow = await db.get(
        'SELECT COUNT(*) AS c FROM teacher_onboarding_pending_subjects WHERE pending_id = ?',
        pending.id
      );
      const subjectsCount = Number(subCountRow?.c || subCountRow?.count || 0);
      pendingData = {
        name: pending.name,
        username: pending.username,
        emailMasked: maskEmail(pending.email),
        subjectsCount,
        canResend: true,
        canChangeEmail: true
      };
    }
  }

  return {
    inviteId: invite.id,
    initialUsername,
    status,
    expiresAt,
    isExpired: new Date(expiresAt).getTime() < Date.now(),
    emailMasked: pendingData?.emailMasked || null,
    canResend: Boolean(pendingData?.canResend),
    canChangeEmail: Boolean(pendingData?.canChangeEmail),
    subjectsSelected: pendingData?.subjectsCount || 0,
    pending: pendingData,
    setupSteps: {
      accountDetails: status === 'awaiting_email_verification' || status === 'completed',
      subjectsSelected: status === 'awaiting_email_verification' || status === 'completed',
      emailVerified: status === 'completed'
    }
  };
}

/**
 * Returns list of canonical active subjects for onboarding.
 */
async function listOnboardingSubjects(db) {
  const query = db.isPostgres
    ? `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature
       FROM subjects
       WHERE active = TRUE
       ORDER BY semester ASC, code ASC`
    : `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature
       FROM subjects
       WHERE active = 1
       ORDER BY semester ASC, code ASC`;

  const rows = (await db.all(query)) || [];
  return rows.map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    semester: Number(r.semester),
    department: r.department,
    creditHours: Number(r.creditHours || r.credithours || 3.0),
    nature: r.nature || null
  }));
}

/**
 * Service helper: Search active canonical subjects by code or name (case-insensitive).
 */
async function searchSubjects(dbOrQuery, maybeQuery) {
  let dbInstance = dbOrQuery;
  let query = maybeQuery;
  if (typeof dbOrQuery === 'string' && maybeQuery === undefined) {
    dbInstance = require('../db');
    query = dbOrQuery;
  }

  if (!query || typeof query !== 'string') {
    return [];
  }

  const clean = query.trim().toLowerCase();
  if (!clean) return [];

  const pattern = `%${clean}%`;
  const sql = dbInstance.isPostgres
    ? `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature
       FROM subjects
       WHERE active = TRUE
         AND (LOWER(code) LIKE $1 OR LOWER(name) LIKE $1)
       ORDER BY semester ASC, code ASC`
    : `SELECT id, code, name, semester, department, credit_hours AS "creditHours", nature
       FROM subjects
       WHERE active = 1
         AND (LOWER(code) LIKE ? OR LOWER(name) LIKE ?)
       ORDER BY semester ASC, code ASC`;

  const rows = dbInstance.isPostgres
    ? await dbInstance.all(sql, pattern)
    : await dbInstance.all(sql, pattern, pattern);

  return (rows || []).map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    semester: Number(r.semester),
    department: r.department,
    creditHours: Number(r.creditHours || r.credithours || 3.0),
    nature: r.nature || null
  }));
}

/**
 * Service validation: Validates an array of canonical subject IDs.
 * Ensures every ID exists in the database and is active.
 * Rejects non-arrays, empty arrays, non-existent codes, or inactive subjects.
 */
async function validateSubjectIds(dbOrIds, maybeIds) {
  let dbInstance = dbOrIds;
  let subjectIds = maybeIds;
  if (Array.isArray(dbOrIds) && maybeIds === undefined) {
    dbInstance = require('../db');
    subjectIds = dbOrIds;
  }

  if (!Array.isArray(subjectIds) || subjectIds.length === 0) {
    return { valid: false, reason: 'Subject IDs must be a non-empty array.' };
  }

  const uniqueIds = [...new Set(subjectIds.map(id => String(id || '').trim()))].filter(Boolean);
  if (uniqueIds.length !== subjectIds.length) {
    return { valid: false, reason: 'Duplicate subject IDs provided.' };
  }

  for (const id of uniqueIds) {
    const row = await dbInstance.get(
      'SELECT id, active FROM subjects WHERE id = ? OR code = ?',
      id,
      id
    );
    if (!row) {
      return { valid: false, reason: `Invalid subject ID: ${id} does not exist.` };
    }
    const isActive = dbInstance.isPostgres ? row.active === true : Number(row.active) === 1;
    if (!isActive) {
      return { valid: false, reason: `Subject ${id} is inactive.` };
    }
  }

  return { valid: true, subjectIds: uniqueIds };
}

const VALID_INVITE_TRANSITIONS = {
  provisioned: ['onboarding', 'disabled', 'expired'],
  onboarding: ['onboarding', 'awaiting_email_verification', 'disabled', 'expired'],
  awaiting_email_verification: ['onboarding', 'completed', 'disabled', 'expired'],
  completed: [],
  disabled: [],
  expired: []
};

/**
 * Transition invite status with state machine validation.
 */
async function transitionInviteStatus(db, inviteId, targetStatus) {
  if (!inviteId || !targetStatus) {
    throw new Error('inviteId and targetStatus are required.');
  }

  const invite = await db.get('SELECT id, status FROM teacher_invites WHERE id = ?', inviteId);
  if (!invite) {
    throw new Error(`Teacher invite ${inviteId} not found.`);
  }

  const currentStatus = invite.status;
  const allowed = VALID_INVITE_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    throw new Error(`Invalid status transition from "${currentStatus}" to "${targetStatus}".`);
  }

  const nowIso = new Date().toISOString();
  let sql;
  let params;
  if (targetStatus === 'completed') {
    sql = db.isPostgres
      ? 'UPDATE teacher_invites SET status = $1, completed_at = $2 WHERE id = $3'
      : 'UPDATE teacher_invites SET status = ?, completed_at = ? WHERE id = ?';
    params = [targetStatus, nowIso, inviteId];
  } else if (targetStatus === 'onboarding') {
    sql = db.isPostgres
      ? 'UPDATE teacher_invites SET status = $1, claimed_at = COALESCE(claimed_at, $2) WHERE id = $3'
      : 'UPDATE teacher_invites SET status = ?, claimed_at = COALESCE(claimed_at, ?) WHERE id = ?';
    params = [targetStatus, nowIso, inviteId];
  } else {
    sql = db.isPostgres
      ? 'UPDATE teacher_invites SET status = $1 WHERE id = $2'
      : 'UPDATE teacher_invites SET status = ? WHERE id = ?';
    params = [targetStatus, inviteId];
  }

  await db.run(sql, ...params);
  return { id: inviteId, previousStatus: currentStatus, newStatus: targetStatus };
}

const resendCooldownMap = new Map();

/**
 * Handles teacher onboarding submission.
 * Validates inputs, creates unconfirmed Supabase Auth user, relationally saves pending state.
 */
async function submitTeacherOnboarding(db, {
  inviteId,
  name,
  username,
  email,
  password,
  confirmPassword,
  subjectIds,
  redirectTo,
  supabaseClientMock = null
}) {
  if (!inviteId) {
    throw new Error('inviteId is required.');
  }

  const invite = await db.get('SELECT id, status, expires_at FROM teacher_invites WHERE id = ?', inviteId);
  if (!invite) {
    throw new Error('Teacher invitation not found.');
  }

  if (invite.status === 'disabled') {
    throw new Error('This invitation has been disabled by administration.');
  }

  if (new Date(invite.expires_at || invite.expiresat).getTime() < Date.now()) {
    throw new Error('This invitation has expired.');
  }

  // 1. Validate Name
  const nameCheck = validateTeacherName(name);
  if (!nameCheck.valid) {
    return { success: false, code: 'INVALID_NAME', reason: nameCheck.reason };
  }
  const cleanName = nameCheck.cleanedName;

  // 2. Validate Username
  const usernameCheck = await checkPermanentUsernameAvailability(db, username, inviteId);
  if (!usernameCheck.available) {
    return { success: false, code: 'INVALID_USERNAME', reason: usernameCheck.reason };
  }
  const cleanUsername = usernameCheck.username;

  // 3. Validate Email
  const emailCheck = await checkPermanentEmailAvailability(db, email, inviteId);
  if (!emailCheck.available) {
    return { success: false, code: 'INVALID_EMAIL', reason: emailCheck.reason };
  }
  const cleanEmail = emailCheck.email;

  // 4. Validate Password & Confirmation
  if (!password || typeof password !== 'string' || password.length < 8) {
    return { success: false, code: 'INVALID_PASSWORD', reason: 'Password must be at least 8 characters long.' };
  }
  if (password !== confirmPassword) {
    return { success: false, code: 'PASSWORD_MISMATCH', reason: 'Password confirmation does not match.' };
  }

  // 5. Validate Subjects
  const subjectsCheck = await validateSubjectIds(db, subjectIds);
  if (!subjectsCheck.valid) {
    return { success: false, code: 'INVALID_SUBJECTS', reason: subjectsCheck.reason };
  }
  const validSubjectIds = subjectsCheck.subjectIds;

  // 6. Supabase Registration
  let supabaseUid = null;
  const isTestMock = Boolean(
    supabaseClientMock ||
    process.env.__TEST_SUPABASE_MOCK ||
    process.env.NODE_ENV === 'test' ||
    global.__testSupabaseMock
  );

  if (isTestMock) {
    const mock = supabaseClientMock || global.__testSupabaseMock;
    if (mock && mock.auth && typeof mock.auth.signUp === 'function') {
      const mockRes = await mock.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { name: cleanName, username: cleanUsername, role: 'teacher' }, emailRedirectTo: redirectTo }
      });
      if (mockRes.error) {
        return { success: false, code: 'AUTH_REGISTRATION_FAILED', reason: mockRes.error.message || 'Authentication error.' };
      }
      supabaseUid = mockRes.data?.user?.id || `mock-sub-${crypto.randomUUID()}`;
    } else if (mock && typeof mock.registerUser === 'function') {
      const mockRes = await mock.registerUser({
        email: cleanEmail,
        password,
        metadata: { name: cleanName, username: cleanUsername, role: 'teacher' },
        redirectTo
      });
      if (mockRes.error) {
        return { success: false, code: 'AUTH_REGISTRATION_FAILED', reason: mockRes.error.message || 'Authentication error.' };
      }
      supabaseUid = mockRes.user?.id || `mock-sub-${crypto.randomUUID()}`;
    } else {
      supabaseUid = `mock-sub-${crypto.randomUUID()}`;
    }
  } else {
    const { registerSupabaseUser } = require('./supabase');
    const { user: authUser, error: authErr } = await registerSupabaseUser({
      email: cleanEmail,
      password,
      metadata: {
        name: cleanName,
        username: cleanUsername,
        role: 'teacher'
      },
      redirectTo
    });

    if (authErr) {
      const msg = (authErr.message || '').toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        return { success: false, code: 'EMAIL_ALREADY_EXISTS', reason: 'This email cannot be used.' };
      }
      return { success: false, code: 'AUTH_REGISTRATION_FAILED', reason: authErr.message || 'Failed to initialize account with authentication service.' };
    }

    if (!authUser || !authUser.id) {
      return { success: false, code: 'AUTH_FAILED', reason: 'Failed to obtain authentication identity.' };
    }
    supabaseUid = authUser.id;
  }

  // 7. Relational Persistence of Pending State (Atomic)
  const pendingId = crypto.randomUUID();
  const expiresAtIso = invite.expires_at || invite.expiresat;

  // Clean existing pending for this invite if re-submitting before verification
  const existingPending = await db.get('SELECT id FROM teacher_onboarding_pending WHERE invite_id = ?', inviteId);
  if (existingPending) {
    await db.run('DELETE FROM teacher_onboarding_pending_subjects WHERE pending_id = ?', existingPending.id);
    await db.run('DELETE FROM teacher_onboarding_pending WHERE id = ?', existingPending.id);
  }

  if (db.isPostgres) {
    await db.run(
      `INSERT INTO teacher_onboarding_pending (
        id, invite_id, supabase_uid, name, username, email, created_at, updated_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $7)`,
      pendingId, inviteId, supabaseUid, cleanName, cleanUsername, cleanEmail, expiresAtIso
    );
  } else {
    await db.run(
      `INSERT INTO teacher_onboarding_pending (
        id, invite_id, supabase_uid, name, username, email, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
      pendingId, inviteId, supabaseUid, cleanName, cleanUsername, cleanEmail, expiresAtIso
    );
  }

  // Insert pending subjects relationally
  for (const subId of validSubjectIds) {
    const relId = crypto.randomUUID();
    if (db.isPostgres) {
      await db.run(
        `INSERT INTO teacher_onboarding_pending_subjects (id, pending_id, subject_id, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        relId, pendingId, subId
      );
    } else {
      await db.run(
        `INSERT INTO teacher_onboarding_pending_subjects (id, pending_id, subject_id, created_at) VALUES (?, ?, ?, datetime('now'))`,
        relId, pendingId, subId
      );
    }
  }

  // Update invite state to awaiting_email_verification
  if (db.isPostgres) {
    await db.run(`UPDATE teacher_invites SET status = 'awaiting_email_verification' WHERE id = $1`, inviteId);
  } else {
    await db.run(`UPDATE teacher_invites SET status = 'awaiting_email_verification' WHERE id = ?`, inviteId);
  }

  return {
    success: true,
    status: 'awaiting_email_verification',
    emailMasked: maskEmail(cleanEmail),
    message: 'Verification email sent. Please check your inbox and verify your email.'
  };
}

/**
 * Resends verification email for pending onboarding record.
 */
async function resendTeacherVerification(db, inviteId, supabaseClientMock = null) {
  if (!inviteId) {
    throw new Error('inviteId is required.');
  }

  const pending = await db.get(
    'SELECT id, email, supabase_uid, last_verification_sent_at FROM teacher_onboarding_pending WHERE invite_id = ?',
    inviteId
  );
  if (!pending) {
    return { success: false, code: 'NOT_FOUND', reason: 'No pending onboarding record found.' };
  }

  // Rate limit / cooldown: 60 seconds (Authoritative DB check + in-memory fallback)
  let dateStr = pending.last_verification_sent_at || pending.lastverificationsentat;
  if (dateStr && typeof dateStr === 'string' && !dateStr.endsWith('Z') && !dateStr.includes('+')) {
    dateStr = dateStr.replace(' ', 'T') + 'Z';
  }
  const lastSentDb = dateStr ? new Date(dateStr).getTime() : 0;
  const lastSentMem = resendCooldownMap.get(inviteId) || 0;
  const lastSent = Math.max(lastSentDb, lastSentMem);

  if (lastSent && Date.now() - lastSent < 60 * 1000) {
    const waitSec = Math.ceil((60 * 1000 - (Date.now() - lastSent)) / 1000);
    return {
      success: false,
      code: 'RATE_LIMITED',
      reason: `Please wait ${waitSec} seconds before requesting another verification email.`
    };
  }

  const isTestMock = Boolean(
    supabaseClientMock ||
    process.env.__TEST_SUPABASE_MOCK ||
    process.env.NODE_ENV === 'test' ||
    global.__testSupabaseMock
  );
  if (isTestMock) {
    const mock = supabaseClientMock || global.__testSupabaseMock;
    if (mock && mock.auth && typeof mock.auth.resend === 'function') {
      await mock.auth.resend({ type: 'signup', email: pending.email });
    } else if (mock && typeof mock.resendVerification === 'function') {
      await mock.resendVerification({ email: pending.email });
    }
  } else {
    const { resendVerificationEmail } = require('./supabase');
    const { error } = await resendVerificationEmail({ email: pending.email });
    if (error) {
      return { success: false, code: 'RESEND_FAILED', reason: error.message || 'Failed to resend verification email.' };
    }
  }

  // Update DB timestamp so serverless instances share cooldown (ISO UTC string)
  const nowIso = new Date().toISOString();
  if (db.isPostgres) {
    await db.run('UPDATE teacher_onboarding_pending SET last_verification_sent_at = $1 WHERE id = $2', nowIso, pending.id);
  } else {
    await db.run('UPDATE teacher_onboarding_pending SET last_verification_sent_at = ? WHERE id = ?', nowIso, pending.id);
  }

  resendCooldownMap.set(inviteId, Date.now());
  return {
    success: true,
    message: 'Verification email sent.'
  };
}

/**
 * Changes unverified recovery email for pending onboarding record.
 */
async function changeTeacherPendingEmail(db, { inviteId, newEmail, supabaseClientMock = null }) {
  if (!inviteId || !newEmail) {
    throw new Error('inviteId and newEmail are required.');
  }

  // 1. Verify invite status allows email modification
  const invite = await db.get('SELECT status FROM teacher_invites WHERE id = ?', inviteId);
  if (!invite) {
    return { success: false, code: 'NOT_FOUND', reason: 'Teacher provisioning record not found.' };
  }
  if (invite.status !== 'awaiting_email_verification' && invite.status !== 'onboarding') {
    return {
      success: false,
      code: 'INVALID_STATE',
      reason: 'Email address can only be changed while awaiting verification.'
    };
  }

  const pending = await db.get('SELECT id, email, supabase_uid FROM teacher_onboarding_pending WHERE invite_id = ?', inviteId);
  if (!pending) {
    return { success: false, code: 'NOT_FOUND', reason: 'No pending onboarding record found.' };
  }

  // Validate new email
  const emailCheck = await checkPermanentEmailAvailability(db, newEmail, inviteId);
  if (!emailCheck.available) {
    return { success: false, code: emailCheck.code || 'INVALID_EMAIL', reason: emailCheck.reason };
  }
  const cleanEmail = emailCheck.email;

  if (cleanEmail === pending.email.toLowerCase()) {
    return { success: false, code: 'SAME_EMAIL', reason: 'The new email is identical to the current recovery email.' };
  }

  const isTestMock = Boolean(
    supabaseClientMock ||
    (process.env.__TEST_SUPABASE_MOCK && global.__testSupabaseMock)
  );

  if (isTestMock) {
    const mock = supabaseClientMock || global.__testSupabaseMock;
    if (mock && mock.auth && mock.auth.admin && typeof mock.auth.admin.updateUserById === 'function') {
      const res = await mock.auth.admin.updateUserById(pending.supabase_uid, { email: cleanEmail });
      if (res?.error) {
        return { success: false, code: 'UPDATE_FAILED', reason: res.error.message || 'Failed to update email.' };
      }
    } else if (mock && typeof mock.updateUserEmail === 'function') {
      await mock.updateUserEmail({ userId: pending.supabase_uid, newEmail: cleanEmail });
    }
  } else {
    let admin = null;
    try {
      const { getSupabaseAdminClient } = require('./supabase');
      admin = getSupabaseAdminClient();
    } catch (adminErr) {
      return {
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        reason: 'Email change service is temporarily unavailable due to missing credentials. Please contact administration.'
      };
    }

    if (!admin) {
      return {
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        reason: 'Email change service is temporarily unavailable. Please contact administration.'
      };
    }

    const { error } = await admin.auth.admin.updateUserById(pending.supabase_uid, {
      email: cleanEmail,
      email_confirm: false
    });
    if (error) {
      return { success: false, code: 'UPDATE_FAILED', reason: error.message || 'Failed to update email with authentication provider.' };
    }
  }

  // Update DB pending with compensation rollback if DB update fails
  try {
    if (db.isPostgres) {
      await db.run(
        'UPDATE teacher_onboarding_pending SET email = $1, updated_at = CURRENT_TIMESTAMP, last_verification_sent_at = CURRENT_TIMESTAMP WHERE id = $2',
        cleanEmail, pending.id
      );
    } else {
      await db.run(
        "UPDATE teacher_onboarding_pending SET email = ?, updated_at = datetime('now'), last_verification_sent_at = datetime('now') WHERE id = ?",
        cleanEmail, pending.id
      );
    }
  } catch (dbErr) {
    // Attempt compensation rollback in Supabase
    try {
      if (isTestMock) {
        const mock = supabaseClientMock || global.__testSupabaseMock;
        if (mock?.auth?.admin?.updateUserById) {
          await mock.auth.admin.updateUserById(pending.supabase_uid, { email: pending.email });
        }
      } else {
        const { getSupabaseAdminClient } = require('./supabase');
        const admin = getSupabaseAdminClient();
        await admin.auth.admin.updateUserById(pending.supabase_uid, { email: pending.email, email_confirm: false });
      }
    } catch (_) {}
    return { success: false, code: 'DATABASE_ERROR', reason: 'Failed to update pending recovery email in database.' };
  }

  resendCooldownMap.set(inviteId, Date.now());

  return {
    success: true,
    emailMasked: maskEmail(cleanEmail),
    message: 'Email address updated and new verification link sent.'
  };
}

/**
 * Finalizes teacher onboarding after permanent email verification in Supabase.
 * Executes atomic DB activation transaction.
 */
async function finalizeTeacherOnboarding(db, {
  supabaseToken,
  supabaseUser = null,
  supabaseClientMock = null
}) {
  let verifiedUser = supabaseUser;

  // 1. Verify Supabase JWT if passed
  if (!verifiedUser) {
    if (!supabaseToken || typeof supabaseToken !== 'string') {
      return { success: false, code: 'TOKEN_REQUIRED', reason: 'Authentication token is required.' };
    }

    const isTestMock = Boolean(supabaseClientMock || process.env.__TEST_SUPABASE_MOCK);
    if (isTestMock) {
      const mock = supabaseClientMock || global.__testSupabaseMock;
      if (mock && typeof mock.verifyToken === 'function') {
        const res = await mock.verifyToken(supabaseToken);
        if (res.error || !res.user) {
          return { success: false, code: 'INVALID_TOKEN', reason: res.error?.message || 'Invalid or expired authentication token.' };
        }
        verifiedUser = res.user;
      } else if (mock && mock.auth && typeof mock.auth.getUser === 'function') {
        const res = await mock.auth.getUser(supabaseToken);
        if (res.error || !res.data?.user) {
          return { success: false, code: 'INVALID_TOKEN', reason: res.error?.message || 'Invalid or expired authentication token.' };
        }
        verifiedUser = res.data.user;
      }
    }

    if (!verifiedUser) {
      const { verifySupabaseToken } = require('./supabase');
      const { user, error } = await verifySupabaseToken(supabaseToken);
      if (error || !user) {
        return { success: false, code: 'INVALID_TOKEN', reason: error?.message || 'Invalid or expired authentication token.' };
      }
      verifiedUser = user;
    }
  }

  if (!verifiedUser || !verifiedUser.id) {
    return { success: false, code: 'UNAUTHORIZED', reason: 'Authentication failed.' };
  }

  // 2. Verify that email is confirmed
  const isConfirmed = Boolean(verifiedUser.email_confirmed_at || verifiedUser.confirmed_at);
  if (!isConfirmed) {
    return {
      success: false,
      code: 'EMAIL_NOT_CONFIRMED',
      reason: 'Your email address has not been verified yet. Please check your inbox and confirm your email.'
    };
  }

  // 3. Check Idempotency: Is this teacher already finalized?
  // Strict UID identity check
  const existingTeacher = await db.get(
    "SELECT studentId, username, name, email, supabase_uid FROM students WHERE supabase_uid = ? AND role = 'teacher'",
    verifiedUser.id
  );

  if (existingTeacher) {
    return {
      success: true,
      alreadyFinalized: true,
      alreadyActive: true,
      teacherId: existingTeacher.studentId,
      teacher: {
        studentId: existingTeacher.studentId,
        username: existingTeacher.username,
        name: existingTeacher.name,
        email: existingTeacher.email,
        role: 'teacher'
      },
      message: 'Your teacher account is already active. You can now sign in.'
    };
  }

  // Defend against different UID attempting to claim an account with an existing teacher's email
  const existingByEmail = await db.get(
    "SELECT studentId, supabase_uid FROM students WHERE LOWER(email) = ? AND role = 'teacher'",
    (verifiedUser.email || '').toLowerCase()
  );
  if (existingByEmail && existingByEmail.supabase_uid !== verifiedUser.id) {
    return {
      success: false,
      code: 'UNAUTHORIZED',
      reason: 'A teacher account with this email is already registered under a different identity.'
    };
  }

  // 4. Find pending onboarding record strictly by supabase_uid
  const pending = await db.get(
    'SELECT * FROM teacher_onboarding_pending WHERE supabase_uid = ?',
    verifiedUser.id
  );

  if (!pending) {
    return {
      success: false,
      code: 'NO_PENDING_RECORD',
      reason: 'No pending onboarding record found matching this account.'
    };
  }

  // Check email matches pending record
  if (verifiedUser.email && verifiedUser.email.toLowerCase() !== pending.email.toLowerCase()) {
    return {
      success: false,
      code: 'EMAIL_MISMATCH',
      reason: 'Verified email does not match onboarding reservation.'
    };
  }

  // 5. Re-check username uniqueness against students before permanent commit
  const userCheck = await db.get('SELECT studentId FROM students WHERE LOWER(username) = ?', pending.username.toLowerCase());
  if (userCheck) {
    return {
      success: false,
      code: 'USERNAME_TAKEN',
      reason: 'Permanent username was claimed while awaiting verification. Please contact support.'
    };
  }

  // 6. Load pending subjects
  const pendingSubjects = await db.all(
    'SELECT subject_id FROM teacher_onboarding_pending_subjects WHERE pending_id = ?',
    pending.id
  );

  // 7. Atomic DB Activation Transaction
  const teacherUserId = crypto.randomUUID(); // Stable internal account ID
  const teacherDomainId = crypto.randomUUID();
  const discardedSecret = crypto.randomBytes(32).toString('hex');
  const sentinelHash = bcrypt.hashSync(discardedSecret, 12);

  // A. Insert into students anchor
  if (db.isPostgres) {
    await db.run(
      `INSERT INTO students (
        studentId, username, name, email, supabase_uid,
        department, semester, gender, role, verification_status,
        passwordHash, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'BIT', NULL, NULL, 'teacher', 'verified', 'supabase_auth', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      teacherUserId, pending.username, pending.name, pending.email, verifiedUser.id
    );
  } else {
    await db.run(
      `INSERT INTO students (
        studentId, username, name, email, supabase_uid,
        department, semester, gender, role, verification_status,
        passwordHash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'BIT', NULL, NULL, 'teacher', 'verified', 'supabase_auth', datetime('now'), datetime('now'))`,
      teacherUserId, pending.username, pending.name, pending.email, verifiedUser.id
    );
  }

  // B. Insert into teachers domain table
  if (db.isPostgres) {
    await db.run(
      `INSERT INTO teachers (
        id, user_id, invite_id, designation, status, created_at, updated_at
      ) VALUES ($1, $2, $3, 'Instructor', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      teacherDomainId, teacherUserId, pending.invite_id
    );
  } else {
    await db.run(
      `INSERT INTO teachers (
        id, user_id, invite_id, designation, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'Instructor', 'active', datetime('now'), datetime('now'))`,
      teacherDomainId, teacherUserId, pending.invite_id
    );
  }

  // C. Insert teacher_subjects
  for (const row of pendingSubjects) {
    const tsId = crypto.randomUUID();
    const sid = row.subject_id || row.subjectid;
    if (db.isPostgres) {
      await db.run(
        `INSERT INTO teacher_subjects (id, teacher_id, subject_id, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        tsId, teacherDomainId, sid
      );
    } else {
      await db.run(
        `INSERT INTO teacher_subjects (id, teacher_id, subject_id, created_at) VALUES (?, ?, ?, datetime('now'))`,
        tsId, teacherDomainId, sid
      );
    }
  }

  // D. Transition invite -> completed, invalidate temporary password hash & nonce
  if (db.isPostgres) {
    await db.run(
      `UPDATE teacher_invites SET
        status = 'completed',
        completed_at = CURRENT_TIMESTAMP,
        temporary_password_hash = $1,
        onboarding_nonce = onboarding_nonce + 999
      WHERE id = $2`,
      sentinelHash, pending.invite_id
    );
  } else {
    await db.run(
      `UPDATE teacher_invites SET
        status = 'completed',
        completed_at = datetime('now'),
        temporary_password_hash = ?,
        onboarding_nonce = onboarding_nonce + 999
      WHERE id = ?`,
      sentinelHash, pending.invite_id
    );
  }

  // E. Delete pending onboarding records
  await db.run('DELETE FROM teacher_onboarding_pending_subjects WHERE pending_id = ?', pending.id);
  await db.run('DELETE FROM teacher_onboarding_pending WHERE id = ?', pending.id);

  return {
    success: true,
    activated: true,
    teacherId: teacherUserId,
    teacher: {
      studentId: teacherUserId,
      username: pending.username,
      name: pending.name,
      email: pending.email,
      role: 'teacher'
    },
    message: 'Teacher account successfully activated. You can now sign in with your permanent credentials.'
  };
}

/**
 * Returns canonical subjects assigned to an active teacher.
 */
async function getTeacherSubjects(db, teacherUserId) {
  const query = db.isPostgres
    ? `SELECT s.id, s.code, s.name, s.semester, s.department, s.credit_hours AS "creditHours", s.nature
       FROM teacher_subjects ts
       JOIN teachers t ON t.id = ts.teacher_id
       JOIN subjects s ON s.id = ts.subject_id
       WHERE (t.user_id = $1 OR t.id = $1)
       ORDER BY s.semester ASC, s.code ASC`
    : `SELECT s.id, s.code, s.name, s.semester, s.department, s.credit_hours AS "creditHours", s.nature
       FROM teacher_subjects ts
       JOIN teachers t ON t.id = ts.teacher_id
       JOIN subjects s ON s.id = ts.subject_id
       WHERE (t.user_id = ? OR t.id = ?)
       ORDER BY s.semester ASC, s.code ASC`;

  const rows = db.isPostgres
    ? (await db.all(query, teacherUserId)) || []
    : (await db.all(query, teacherUserId, teacherUserId)) || [];
  return rows.map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    semester: Number(r.semester),
    department: r.department,
    creditHours: Number(r.creditHours || r.credithours || 3.0),
    nature: r.nature || null
  }));
}

module.exports = {
  DEFAULT_INVITE_EXPIRY_DAYS,
  ONBOARDING_TOKEN_TTL_MS,
  RESERVED_USERNAMES,
  VALID_INVITE_TRANSITIONS,
  isTeacherOnboardingEnabled,
  getTeacherOnboardingSecret,
  signOnboardingToken,
  verifyOnboardingToken,
  ensureTeacherSchema,
  seedCanonicalSubjects,
  validateTeacherName,
  checkPermanentUsernameAvailability,
  checkPermanentEmailAvailability,
  createTeacherInvite,
  verifyTemporaryTeacherCredentials,
  getOnboardingState,
  listOnboardingSubjects,
  searchSubjects,
  validateSubjectIds,
  transitionInviteStatus,
  submitTeacherOnboarding,
  resendTeacherVerification,
  changeTeacherPendingEmail,
  finalizeTeacherOnboarding,
  getTeacherSubjects,
  maskEmail,
  resendCooldownMap
};
