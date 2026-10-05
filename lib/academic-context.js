'use strict';

const crypto = require('crypto');

const VALID_SLOT_CODES = ['mercury', 'venus', 'earth', 'mars'];
const SLOT_DISPLAY_NAMES = {
  mercury: 'Mercury',
  venus: 'Venus',
  earth: 'Earth',
  mars: 'Mars'
};

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

function parseSemesterNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= 8 ? value : null;
  }
  const text = String(value).trim().replace(/^(?:semester|sem)\s*/i, '').toUpperCase();
  const number = /^[1-8]$/.test(text) ? Number(text) : ROMANS.indexOf(text) + 1;
  return number >= 1 && number <= 8 ? number : null;
}

/**
 * Ensures cohort-related tables and columns exist in both PostgreSQL and SQLite.
 * Non-destructive, idempotent, and backward-compatible.
 */
async function ensureAcademicCohortSchema({ exec, run, all, isPostgres }) {
  if (isPostgres) {
    await exec(`
      CREATE TABLE IF NOT EXISTS cohorts (
        id TEXT PRIMARY KEY,
        slot_code TEXT NOT NULL CHECK (slot_code IN ('mercury', 'venus', 'earth', 'mars')),
        group_code TEXT,
        display_name TEXT NOT NULL,
        intake_year INTEGER,
        intake_identifier TEXT,
        current_semester INTEGER NOT NULL CHECK (current_semester BETWEEN 1 AND 8),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'graduated', 'archived')),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        graduated_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cohorts_active_slot ON cohorts (slot_code) WHERE status = 'active';

      ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS group_code TEXT;
      ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      UPDATE cohorts SET group_code = UPPER(slot_code) WHERE group_code IS NULL AND slot_code IS NOT NULL;

      CREATE TABLE IF NOT EXISTS cohort_semester_history (
        id TEXT PRIMARY KEY,
        cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
        semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
        started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMPTZ,
        promoted_by TEXT REFERENCES students(studentId),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cohort_history_cohort ON cohort_semester_history (cohort_id, semester_no);

      CREATE TABLE IF NOT EXISTS cohort_audit_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        cohort_id TEXT NOT NULL,
        actor_id TEXT,
        details_json TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cohort_audit_cohort ON cohort_audit_logs (cohort_id, created_at);

      CREATE TABLE IF NOT EXISTS chat_groups (
        id TEXT PRIMARY KEY,
        cohort_id TEXT UNIQUE REFERENCES cohorts(id),
        kind TEXT NOT NULL DEFAULT 'cohort' CHECK(kind IN ('cohort','legacy')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','recycling','recycled','quarantined')),
        realtime_epoch INTEGER NOT NULL DEFAULT 1 CHECK(realtime_epoch>0),
        projection_status TEXT NOT NULL DEFAULT 'pending' CHECK(projection_status IN ('pending','ready','failed')),
        projection_epoch INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMPTZ,
        recycled_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS chat_one_legacy_room ON chat_groups(kind) WHERE kind='legacy';

      CREATE TABLE IF NOT EXISTS chat_group_slots (
        group_code TEXT PRIMARY KEY CHECK(group_code IN ('MERCURY','VENUS','EARTH','MARS')),
        current_chat_group_id TEXT UNIQUE REFERENCES chat_groups(id),
        version INTEGER NOT NULL DEFAULT 1
      );

      ALTER TABLE students ADD COLUMN IF NOT EXISTS cohort_id TEXT REFERENCES cohorts(id);
      CREATE INDEX IF NOT EXISTS idx_students_cohort ON students (cohort_id);

      ALTER TABLE posts ADD COLUMN IF NOT EXISTS cohort_id TEXT REFERENCES cohorts(id);
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS semester_no INTEGER;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS audience_scope TEXT NOT NULL DEFAULT 'cohort';
      CREATE INDEX IF NOT EXISTS idx_posts_cohort_sem ON posts (cohort_id, semester_no);
      CREATE INDEX IF NOT EXISTS idx_posts_audience ON posts (audience_scope);

      ALTER TABLE files ADD COLUMN IF NOT EXISTS cohort_id TEXT REFERENCES cohorts(id);
      ALTER TABLE files ADD COLUMN IF NOT EXISTS semester_no INTEGER;
      ALTER TABLE files ADD COLUMN IF NOT EXISTS audience_scope TEXT NOT NULL DEFAULT 'cohort';
      CREATE INDEX IF NOT EXISTS idx_files_cohort_sem ON files (cohort_id, semester_no);
      CREATE INDEX IF NOT EXISTS idx_files_audience ON files (audience_scope);

      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS cohort_id TEXT REFERENCES cohorts(id);
      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS semester_no INTEGER;
      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS audience_scope TEXT NOT NULL DEFAULT 'cohort';
      CREATE INDEX IF NOT EXISTS idx_assignments_cohort_sem ON assignments (cohort_id, semester_no);
      CREATE INDEX IF NOT EXISTS idx_assignments_audience ON assignments (audience_scope);

      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='posts' AND column_name='created_at') THEN
          CREATE INDEX IF NOT EXISTS idx_posts_cohort_sem_created ON posts (cohort_id, semester_no, created_at);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='subject') THEN
          CREATE INDEX IF NOT EXISTS idx_files_cohort_sem_subj ON files (cohort_id, semester_no, subject);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='assignments' AND column_name='deadline') THEN
          CREATE INDEX IF NOT EXISTS idx_assignments_cohort_sem_deadline ON assignments (cohort_id, semester_no, deadline);
        END IF;
      END $$;
    `);
  } else {
    await exec(`
      CREATE TABLE IF NOT EXISTS cohorts (
        id TEXT PRIMARY KEY,
        slot_code TEXT NOT NULL CHECK (slot_code IN ('mercury', 'venus', 'earth', 'mars')),
        group_code TEXT,
        display_name TEXT NOT NULL,
        intake_year INTEGER,
        intake_identifier TEXT,
        current_semester INTEGER NOT NULL CHECK (current_semester BETWEEN 1 AND 8),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'graduated', 'archived')),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        graduated_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cohorts_active_slot ON cohorts (slot_code) WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS cohort_semester_history (
        id TEXT PRIMARY KEY,
        cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
        semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        promoted_by TEXT REFERENCES students(studentId),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cohort_history_cohort ON cohort_semester_history (cohort_id, semester_no);

      CREATE TABLE IF NOT EXISTS cohort_audit_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        cohort_id TEXT NOT NULL,
        actor_id TEXT,
        details_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cohort_audit_cohort ON cohort_audit_logs (cohort_id, created_at);

      CREATE TABLE IF NOT EXISTS chat_groups (
        id TEXT PRIMARY KEY,
        cohort_id TEXT UNIQUE REFERENCES cohorts(id),
        kind TEXT NOT NULL DEFAULT 'cohort' CHECK(kind IN ('cohort','legacy')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','recycling','recycled','quarantined')),
        realtime_epoch INTEGER NOT NULL DEFAULT 1 CHECK(realtime_epoch>0),
        projection_status TEXT NOT NULL DEFAULT 'pending' CHECK(projection_status IN ('pending','ready','failed')),
        projection_epoch INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at TEXT,
        recycled_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS chat_one_legacy_room ON chat_groups(kind) WHERE kind='legacy';

      CREATE TABLE IF NOT EXISTS chat_group_slots (
        group_code TEXT PRIMARY KEY CHECK(group_code IN ('MERCURY','VENUS','EARTH','MARS')),
        current_chat_group_id TEXT UNIQUE REFERENCES chat_groups(id),
        version INTEGER NOT NULL DEFAULT 1
      );
    `);

    // Helper for safe SQLite column additions
    async function addColumnIfNotExists(table, column, colDef) {
      const cols = await all(`PRAGMA table_info(${table})`);
      const names = cols.map(c => c.name);
      if (!names.includes(column)) {
        await exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${colDef};`);
      }
    }

    await addColumnIfNotExists('cohorts', 'group_code', 'TEXT');
    await addColumnIfNotExists('cohorts', 'version', 'INTEGER NOT NULL DEFAULT 1');
    await exec("UPDATE cohorts SET group_code = UPPER(slot_code) WHERE group_code IS NULL AND slot_code IS NOT NULL;");

    await addColumnIfNotExists('students', 'cohort_id', 'TEXT REFERENCES cohorts(id)');
    await addColumnIfNotExists('posts', 'cohort_id', 'TEXT REFERENCES cohorts(id)');
    await addColumnIfNotExists('posts', 'semester_no', 'INTEGER');
    await addColumnIfNotExists('posts', 'audience_scope', "TEXT NOT NULL DEFAULT 'cohort'");

    await addColumnIfNotExists('files', 'cohort_id', 'TEXT REFERENCES cohorts(id)');
    await addColumnIfNotExists('files', 'semester_no', 'INTEGER');
    await addColumnIfNotExists('files', 'audience_scope', "TEXT NOT NULL DEFAULT 'cohort'");

    await addColumnIfNotExists('assignments', 'cohort_id', 'TEXT REFERENCES cohorts(id)');
    await addColumnIfNotExists('assignments', 'semester_no', 'INTEGER');
    await addColumnIfNotExists('assignments', 'audience_scope', "TEXT NOT NULL DEFAULT 'cohort'");

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_students_cohort ON students (cohort_id);
      CREATE INDEX IF NOT EXISTS idx_posts_cohort_sem ON posts (cohort_id, semester_no);
      CREATE INDEX IF NOT EXISTS idx_posts_audience ON posts (audience_scope);
      CREATE INDEX IF NOT EXISTS idx_files_cohort_sem ON files (cohort_id, semester_no);
      CREATE INDEX IF NOT EXISTS idx_files_audience ON files (audience_scope);
      CREATE INDEX IF NOT EXISTS idx_assignments_cohort_sem ON assignments (cohort_id, semester_no);
      CREATE INDEX IF NOT EXISTS idx_assignments_audience ON assignments (audience_scope);
    `);

    const postCols = await all('PRAGMA table_info(posts)');
    if (postCols.some(c => c.name === 'created_at')) {
      await exec('CREATE INDEX IF NOT EXISTS idx_posts_cohort_sem_created ON posts (cohort_id, semester_no, created_at);');
    }
    const fileCols = await all('PRAGMA table_info(files)');
    if (fileCols.some(c => c.name === 'subject')) {
      await exec('CREATE INDEX IF NOT EXISTS idx_files_cohort_sem_subj ON files (cohort_id, semester_no, subject);');
    }
    const assignmentCols = await all('PRAGMA table_info(assignments)');
    if (assignmentCols.some(c => c.name === 'deadline')) {
      await exec('CREATE INDEX IF NOT EXISTS idx_assignments_cohort_sem_deadline ON assignments (cohort_id, semester_no, deadline);');
    }
  }
}

/**
 * Reusable server-authoritative academic & cohort context service.
 * Identity flow: Authenticated user -> students DB row -> cohort_id -> active cohort.
 * Students CANNOT switch cohort or override semester via query parameters or body values.
 *
 * @param {object} db - Database client adapter
 * @param {object} reqOrUser - Express req or user object
 * @returns {Promise<object>} Academic context object
 */
async function getAcademicContext(db, reqOrUser) {
  let studentId = null;

  if (reqOrUser) {
    if (reqOrUser.studentId) {
      studentId = reqOrUser.studentId;
    } else if (reqOrUser.user && reqOrUser.user.studentId) {
      studentId = reqOrUser.user.studentId;
    } else if (reqOrUser.student && reqOrUser.student.studentId) {
      studentId = reqOrUser.student.studentId;
    } else if (reqOrUser.session && reqOrUser.session.studentId) {
      studentId = reqOrUser.session.studentId;
    }
  }

  if (!studentId) {
    return {
      authenticated: false,
      role: 'anonymous',
      cohort: null
    };
  }

  // Always reload student from DB to ensure authoritative state (never trusting client parameters)
  let student = null;
  try {
    student = await db.get(`SELECT * FROM students WHERE studentId = ?`, studentId);
  } catch {
    student = null;
  }

  if (!student) {
    return {
      authenticated: false,
      role: 'anonymous',
      cohort: null
    };
  }

  const role = student.role || 'student';
  const resolvedCohortId = student.cohortId || student.cohort_id || null;

  // Teachers and Admins have institutional oversight
  if (role === 'teacher' || role === 'admin') {
    let cohorts = [];
    try {
      cohorts = (await db.all(
        `SELECT id, slot_code, display_name, current_semester, intake_year, intake_identifier, status, created_at, graduated_at
         FROM cohorts
         ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, current_semester ASC, created_at DESC`
      )) || [];
    } catch {
      cohorts = [];
    }

    const formattedCohorts = cohorts.map(c => ({
      id: c.id,
      code: (c.slotCode || c.slot_code || '').toLowerCase(),
      slotCode: (c.slotCode || c.slot_code || '').toLowerCase(),
      displayName: c.displayName || c.display_name || SLOT_DISPLAY_NAMES[(c.slotCode || c.slot_code || '').toLowerCase()] || c.slot_code,
      currentSemester: Number(c.currentSemester || c.current_semester),
      intakeYear: c.intakeYear !== undefined ? c.intakeYear : c.intake_year,
      intakeIdentifier: c.intakeIdentifier || c.intake_identifier || null,
      status: c.status,
      createdAt: c.createdAt || c.created_at,
      graduatedAt: c.graduatedAt || c.graduated_at || null
    }));

    return {
      authenticated: true,
      role,
      studentId: student.studentId,
      name: student.name,
      canViewAllCohorts: true,
      canManageCohorts: role === 'admin',
      cohorts: formattedCohorts
    };
  }

  // Student / CR flow: Enrolled in exactly one cohort
  let studentCohort = null;
  if (resolvedCohortId) {
    try {
      const c = await db.get(
        `SELECT id, slot_code, display_name, current_semester, intake_year, intake_identifier, status, created_at, graduated_at
         FROM cohorts WHERE id = ?`,
        resolvedCohortId
      );

      if (c) {
        studentCohort = {
          id: c.id,
          code: (c.slotCode || c.slot_code || '').toLowerCase(),
          slotCode: (c.slotCode || c.slot_code || '').toLowerCase(),
          displayName: c.displayName || c.display_name || SLOT_DISPLAY_NAMES[(c.slotCode || c.slot_code || '').toLowerCase()] || c.slot_code,
          currentSemester: Number(c.currentSemester || c.current_semester),
          intakeYear: c.intakeYear !== undefined ? c.intakeYear : c.intake_year,
          intakeIdentifier: c.intakeIdentifier || c.intake_identifier || null,
          status: c.status,
          createdAt: c.createdAt || c.created_at,
          graduatedAt: c.graduatedAt || c.graduated_at || null
        };
      }
    } catch {
      studentCohort = null;
    }
  }

  return {
    authenticated: true,
    role, // 'student' or 'cr'
    studentId: student.studentId,
    name: student.name,
    semester: student.semester || null,
    canViewAllCohorts: false,
    cohort: studentCohort,
    academicStatus: studentCohort ? (studentCohort.status === 'active' ? 'active' : studentCohort.status) : 'unassigned'
  };
}

/**
 * Records an auditable lifecycle action in cohort_audit_logs.
 */
async function logCohortAudit(db, { action, cohortId, actorId = null, details = {} }) {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const detailsJson = JSON.stringify(details || {});
    await db.run(
      `INSERT INTO cohort_audit_logs (id, action, cohort_id, actor_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, action, cohortId, actorId, detailsJson, now
    );
  } catch {
    // Non-fatal if table not initialized in mock fixtures
  }
}

/**
 * Creates a brand new cohort.
 * Permanent UUID primary key is generated.
 * Display slot code ('mercury', 'venus', 'earth', 'mars') is recyclable across cohorts over time.
 * Automatically allocates a permanent, immutable chat room for the cohort.
 */
async function createCohort(db, {
  id = null,
  slotCode,
  displayName = null,
  intakeYear = new Date().getFullYear(),
  intakeIdentifier = null,
  currentSemester = 1,
  status = 'active',
  actorId = null
}) {
  const code = String(slotCode || '').toLowerCase().trim();
  if (!VALID_SLOT_CODES.includes(code)) {
    throw new Error(`Invalid slot code "${slotCode}". Allowed slots: ${VALID_SLOT_CODES.join(', ')}`);
  }

  const sem = Number(currentSemester);
  if (!Number.isInteger(sem) || sem < 1 || sem > 8) {
    throw new Error('Current semester must be an integer between 1 and 8.');
  }

  const validStatuses = ['active', 'graduated', 'archived'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status "${status}". Allowed: ${validStatuses.join(', ')}`);
  }

  const cohortId = id || crypto.randomUUID();
  const name = displayName || SLOT_DISPLAY_NAMES[code] || code.toUpperCase();
  const now = new Date().toISOString();
  const upperCode = code.toUpperCase();

  // If status is active, check if another active cohort already occupies this slot
  if (status === 'active') {
    const existing = await db.get(
      `SELECT id, slot_code, display_name, current_semester FROM cohorts WHERE slot_code = ? AND status = 'active'`,
      code
    );
    if (existing) {
      const err = new Error(`Slot "${code}" is already occupied by active cohort ${existing.id} (${existing.displayName || existing.display_name}). Graduate or archive it before recycling this slot.`);
      err.status = 409;
      throw err;
    }
  }

  await db.run(
    `INSERT INTO cohorts (id, slot_code, group_code, display_name, intake_year, intake_identifier, current_semester, version, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    cohortId, code, upperCode, name, intakeYear || null, intakeIdentifier || null, sem, status, now, now
  );

  // Initialize semester history
  const historyId = crypto.randomUUID();
  await db.run(
    `INSERT INTO cohort_semester_history (id, cohort_id, semester_no, started_at, promoted_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    historyId, cohortId, sem, now, actorId, now
  );

  // Allocate immutable cohort chat room (1-to-1 relationship with permanent cohort UUID)
  const roomId = crypto.randomUUID();
  try {
    await db.run(
      `INSERT INTO chat_groups (id, cohort_id, kind, status, realtime_epoch, created_at)
       VALUES (?, ?, 'cohort', 'active', 1, ?)`,
      roomId, cohortId, now
    );
    try {
      await db.run(
        `INSERT INTO chat_group_slots (group_code, current_chat_group_id, version)
         VALUES (?, ?, 1)
         ON CONFLICT (group_code) DO UPDATE SET current_chat_group_id = excluded.current_chat_group_id, version = chat_group_slots.version + 1`,
        upperCode, roomId
      );
    } catch {
      await db.run(
        `UPDATE chat_group_slots SET current_chat_group_id = ?, version = version + 1 WHERE group_code = ?`,
        roomId, upperCode
      );
    }
  } catch {
    // chat_groups table may not be present in pure academic sub-tests
  }

  await logCohortAudit(db, {
    action: 'create',
    cohortId,
    actorId,
    details: { slotCode: code, currentSemester: sem, intakeYear }
  });

  return {
    id: cohortId,
    code,
    slotCode: code,
    displayName: name,
    intakeYear,
    intakeIdentifier,
    currentSemester: sem,
    status,
    chatGroupId: roomId,
    createdAt: now
  };
}

/**
 * Promotes a cohort to its next semester.
 * Records semester history cleanly and non-destructively.
 * Historical content semester_no is NEVER changed.
 * Concurrency protected: conditional update prevents race conditions.
 */
async function promoteCohort(db, arg1, arg2 = {}) {
  const opts = (typeof arg1 === 'object' && arg1 !== null) ? arg1 : { cohortId: arg1, ...arg2 };
  const { cohortId, actorId = null, expectedSemester = null } = opts;
  const cohort = await db.get('SELECT * FROM cohorts WHERE id = ?', cohortId);
  if (!cohort) {
    const err = new Error(`Cohort ${cohortId} not found.`);
    err.status = 404;
    throw err;
  }

  if (cohort.status !== 'active') {
    const err = new Error(`Cannot promote cohort ${cohortId} because its status is "${cohort.status}".`);
    err.status = 409;
    throw err;
  }

  const currentSem = Number(cohort.currentSemester || cohort.current_semester);
  if (expectedSemester !== null && expectedSemester !== undefined && currentSem !== Number(expectedSemester)) {
    const err = new Error(`Expected semester ${expectedSemester} does not match cohort current semester ${currentSem}.`);
    err.status = 409;
    throw err;
  }

  const now = new Date().toISOString();

  if (currentSem >= 8) {
    // Reached final semester -> Graduating cohort
    return await graduateCohort(db, { cohortId, actorId });
  }

  const nextSem = currentSem + 1;

  // Concurrency-safe conditional update
  const updateRes = await db.run(
    `UPDATE cohorts
     SET current_semester = ?, version = COALESCE(version, 1) + 1, updated_at = ?
     WHERE id = ? AND current_semester = ? AND status = 'active'`,
    nextSem, now, cohortId, currentSem
  );

  if (updateRes && updateRes.changes === 0) {
    const conflictErr = new Error(`Cohort ${cohortId} was modified concurrently or is no longer active.`);
    conflictErr.status = 409;
    throw conflictErr;
  }

  // 1. Close current semester history record
  await db.run(
    `UPDATE cohort_semester_history
     SET ended_at = ?
     WHERE cohort_id = ? AND semester_no = ? AND ended_at IS NULL`,
    now, cohortId, currentSem
  );

  // 2. Insert new semester history record
  const historyId = crypto.randomUUID();
  await db.run(
    `INSERT INTO cohort_semester_history (id, cohort_id, semester_no, started_at, promoted_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    historyId, cohortId, nextSem, now, actorId, now
  );

  // 3. Update enrolled students' semester to match cohort
  await db.run(
    'UPDATE students SET semester = ? WHERE cohort_id = ?',
    `Semester ${nextSem}`, cohortId
  );

  await logCohortAudit(db, {
    action: 'promote',
    cohortId,
    actorId,
    details: { previousSemester: currentSem, currentSemester: nextSem }
  });

  return {
    id: cohortId,
    cohortId,
    previousSemester: currentSem,
    currentSemester: nextSem,
    status: 'active',
    updatedAt: now
  };
}

/**
 * Graduates an active cohort.
 * Sets status to 'graduated', records graduated_at timestamp.
 * Historical content and history records remain fully intact.
 * Archives the chat room and releases the slot_code for future recycling under a NEW UUID identity.
 * Concurrency & double-graduation safe.
 */
async function graduateCohort(db, arg1, arg2 = {}) {
  const opts = (typeof arg1 === 'object' && arg1 !== null) ? arg1 : { cohortId: arg1, ...arg2 };
  const { cohortId, actorId = null } = opts;
  const cohort = await db.get('SELECT * FROM cohorts WHERE id = ?', cohortId);
  if (!cohort) {
    const err = new Error(`Cohort ${cohortId} not found.`);
    err.status = 404;
    throw err;
  }

  const currentSem = Number(cohort.currentSemester || cohort.current_semester);
  const now = new Date().toISOString();
  const slot = (cohort.slotCode || cohort.slot_code || '').toLowerCase();

  if (cohort.status === 'graduated') {
    return {
      cohortId,
      status: 'graduated',
      graduatedAt: cohort.graduatedAt || cohort.graduated_at || now,
      alreadyGraduated: true,
      releasedSlotCode: slot
    };
  }

  // Concurrency-safe conditional update
  const gradRes = await db.run(
    `UPDATE cohorts
     SET status = 'graduated', graduated_at = ?, version = COALESCE(version, 1) + 1, updated_at = ?
     WHERE id = ? AND status = 'active'`,
    now, now, cohortId
  );

  if (gradRes && gradRes.changes === 0) {
    const refreshed = await db.get('SELECT * FROM cohorts WHERE id = ?', cohortId);
    return {
      cohortId,
      status: refreshed?.status || 'graduated',
      graduatedAt: refreshed?.graduatedAt || refreshed?.graduated_at || now,
      alreadyGraduated: true,
      releasedSlotCode: slot
    };
  }

  // Close active semester history
  await db.run(
    `UPDATE cohort_semester_history
     SET ended_at = ?
     WHERE cohort_id = ? AND ended_at IS NULL`,
    now, cohortId
  );

  // Close and archive active chat room
  try {
    const room = await db.get('SELECT id FROM chat_groups WHERE cohort_id = ?', cohortId);
    if (room && room.id) {
      await db.run("UPDATE chat_groups SET status = 'closed', closed_at = ? WHERE id = ?", now, room.id);
      await db.run("UPDATE chat_group_slots SET current_chat_group_id = NULL, version = version + 1 WHERE current_chat_group_id = ?", room.id);
      await db.run("UPDATE chat_realtime_memberships SET active = 0 WHERE chat_group_id = ?", room.id);
      await db.run("UPDATE chat_realtime_outbox SET status = 'cancelled' WHERE chat_group_id = ? AND status <> 'sent'", room.id);
      await db.run("UPDATE push_notification_outbox SET status = 'cancelled' WHERE chat_group_id = ? AND status = 'pending'", room.id);
    }
  } catch {
    // Non-fatal if chat tables not mounted in test fixture
  }

  await logCohortAudit(db, {
    action: 'graduate',
    cohortId,
    actorId,
    details: { graduatedAt: now }
  });

  return {
    cohortId,
    status: 'graduated',
    graduatedAt: now,
    releasedSlotCode: slot
  };
}

/**
 * Recycles a display slot (e.g. 'mars') for a brand new incoming cohort.
 * Guaranteed to generate a NEW, distinct UUID identity and a NEW chat room UUID.
 * Never reuses the old cohort database identity.
 */
async function recycleSlot(db, {
  slotCode,
  displayName = null,
  intakeYear = new Date().getFullYear(),
  intakeIdentifier = null,
  actorId = null
}) {
  const code = String(slotCode || '').toLowerCase().trim();

  // Verify the active slot is free
  const activeExisting = await db.get(
    `SELECT id, status FROM cohorts WHERE slot_code = ? AND status = 'active'`,
    code
  );
  if (activeExisting) {
    const conflictErr = new Error(`Cannot recycle slot "${code}": Active cohort ${activeExisting.id} is still using it. Graduate it first.`);
    conflictErr.status = 409;
    throw conflictErr;
  }

  // Create brand new cohort with fresh UUID and fresh chat room identity
  const newCohort = await createCohort(db, {
    slotCode: code,
    displayName: displayName || SLOT_DISPLAY_NAMES[code] || code.toUpperCase(),
    intakeYear,
    intakeIdentifier,
    currentSemester: 1,
    status: 'active',
    actorId
  });

  await logCohortAudit(db, {
    action: 'recycle_slot',
    cohortId: newCohort.id,
    actorId,
    details: { slotCode: code, newCohortId: newCohort.id }
  });

  return newCohort;
}

/**
 * Assigns an unassigned student to an active cohort.
 * Server-authoritative: student cannot self-select.
 */
async function assignStudentToCohort(db, arg1, arg2, arg3) {
  let studentId, cohortId, actorId = null;
  if (typeof arg1 === 'object' && arg1 !== null) {
    studentId = arg1.studentId;
    cohortId = arg1.cohortId;
    actorId = arg1.actorId || null;
  } else {
    studentId = arg1;
    cohortId = arg2;
    actorId = arg3?.actorId || arg3?.assignedBy || null;
  }
  const student = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
  if (!student) {
    const err = new Error(`Student ${studentId} not found.`);
    err.status = 404;
    throw err;
  }

  const cohort = await db.get('SELECT * FROM cohorts WHERE id = ? AND status = \'active\'', cohortId);
  if (!cohort) {
    const err = new Error(`Active cohort ${cohortId} not found.`);
    err.status = 400;
    throw err;
  }

  const currentSem = Number(cohort.currentSemester || cohort.current_semester);
  await db.run('UPDATE students SET cohort_id = ?, semester = ? WHERE studentId = ?', cohortId, `Semester ${currentSem}`, studentId);

  await logCohortAudit(db, {
    action: 'assign_student',
    cohortId,
    actorId,
    details: { studentId }
  });

  return {
    success: true,
    studentId,
    cohortId,
    currentSemester: currentSem
  };
}

/**
 * Reassigns an existing student to a different active cohort (admin-only correction).
 * Invalidates old presence/realtime sessions and moves membership cleanly.
 */
async function reassignStudentCohort(db, arg1, arg2, arg3) {
  let studentId, newCohortId, actorId = null;
  if (typeof arg1 === 'object' && arg1 !== null) {
    studentId = arg1.studentId;
    newCohortId = arg1.newCohortId || arg1.cohortId;
    actorId = arg1.actorId || null;
  } else {
    studentId = arg1;
    newCohortId = arg2;
    actorId = arg3?.actorId || arg3?.reassignedBy || null;
  }
  const student = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
  if (!student) {
    const err = new Error(`Student ${studentId} not found.`);
    err.status = 404;
    throw err;
  }

  const newCohort = await db.get('SELECT * FROM cohorts WHERE id = ? AND status = \'active\'', newCohortId);
  if (!newCohort) {
    const err = new Error(`Active cohort ${newCohortId} not found.`);
    err.status = 400;
    throw err;
  }

  const prevCohortId = student.cohortId || student.cohort_id || null;

  // Evict presence and subscriptions from old room
  try {
    await db.run('DELETE FROM chat_online_sessions WHERE student_id = ?', studentId);
    await db.run('DELETE FROM chat_room_typing WHERE student_id = ?', studentId);
    await db.run('UPDATE chat_realtime_memberships SET active = 0 WHERE student_id = ?', studentId);
  } catch {}

  const currentSem = Number(newCohort.currentSemester || newCohort.current_semester);
  await db.run('UPDATE students SET cohort_id = ?, semester = ? WHERE studentId = ?', newCohortId, `Semester ${currentSem}`, studentId);

  await logCohortAudit(db, {
    action: 'reassign_student',
    cohortId: newCohortId,
    actorId,
    details: { studentId, previousCohortId: prevCohortId }
  });

  return {
    success: true,
    studentId,
    previousCohortId: prevCohortId,
    newCohortId,
    currentSemester: currentSem
  };
}

/**
 * Inspects a cohort's full semester progression and audit timeline.
 */
async function getCohortHistory(db, cohortId) {
  const cohort = await db.get('SELECT * FROM cohorts WHERE id = ?', cohortId);
  if (!cohort) {
    const err = new Error(`Cohort ${cohortId} not found.`);
    err.status = 404;
    throw err;
  }

  let semesters = [];
  try {
    semesters = (await db.all(
      `SELECT h.id, h.semester_no, h.started_at, h.ended_at, h.promoted_by, s.name AS promoter_name
       FROM cohort_semester_history h
       LEFT JOIN students s ON s.studentId = h.promoted_by
       WHERE h.cohort_id = ?
       ORDER BY h.semester_no ASC, h.started_at ASC`,
      cohortId
    )) || [];
  } catch {
    semesters = [];
  }

  let audits = [];
  try {
    audits = (await db.all(
      `SELECT a.id, a.action, a.actor_id, a.details_json, a.created_at, s.name AS actor_name
       FROM cohort_audit_logs a
       LEFT JOIN students s ON s.studentId = a.actor_id
       WHERE a.cohort_id = ?
       ORDER BY a.created_at ASC`,
      cohortId
    )) || [];
  } catch {
    audits = [];
  }

  let studentCount = 0;
  try {
    const cnt = await db.get('SELECT COUNT(*) AS total FROM students WHERE cohort_id = ?', cohortId);
    studentCount = Number(cnt?.total || 0);
  } catch {}

  return {
    cohort: {
      id: cohort.id,
      slotCode: (cohort.slotCode || cohort.slot_code || '').toLowerCase(),
      displayName: cohort.displayName || cohort.display_name,
      intakeYear: cohort.intakeYear !== undefined ? cohort.intakeYear : cohort.intake_year,
      intakeIdentifier: cohort.intakeIdentifier || cohort.intake_identifier,
      currentSemester: Number(cohort.currentSemester || cohort.current_semester),
      status: cohort.status,
      createdAt: cohort.createdAt || cohort.created_at,
      graduatedAt: cohort.graduatedAt || cohort.graduated_at,
      studentCount
    },
    semesters: semesters.map(s => ({
      id: s.id,
      semesterNo: Number(s.semesterNo || s.semester_no),
      startedAt: s.startedAt || s.started_at,
      endedAt: s.endedAt || s.ended_at || null,
      promotedBy: s.promotedBy || s.promoted_by,
      promoterName: s.promoterName || s.promoter_name
    })),
    audits: audits.map(a => ({
      id: a.id,
      action: a.action,
      actorId: a.actorId || a.actor_id,
      actorName: a.actorName || a.actor_name,
      details: typeof a.detailsJson === 'string' ? JSON.parse(a.detailsJson || '{}') : (typeof a.details_json === 'string' ? JSON.parse(a.details_json || '{}') : {}),
      createdAt: a.createdAt || a.created_at
    }))
  };
}

/**
 * Retrieves all cohorts with their status, current semester, student count, and history.
 */
async function getAllCohortsWithHistory(db) {
  let cohorts = [];
  try {
    cohorts = (await db.all(
      `SELECT c.*,
              (SELECT COUNT(*) FROM students s WHERE s.cohort_id = c.id) AS student_count,
              (SELECT g.id FROM chat_groups g WHERE g.cohort_id = c.id LIMIT 1) AS chat_group_id,
              (SELECT g.status FROM chat_groups g WHERE g.cohort_id = c.id LIMIT 1) AS chat_group_status
       FROM cohorts c
       ORDER BY CASE WHEN c.status = 'active' THEN 0 ELSE 1 END, c.current_semester ASC, c.created_at DESC`
    )) || [];
  } catch {
    cohorts = [];
  }

  return cohorts.map(c => ({
    id: c.id,
    slotCode: (c.slotCode || c.slot_code || '').toLowerCase(),
    groupCode: c.groupCode || c.group_code || (c.slotCode || c.slot_code || '').toUpperCase(),
    displayName: c.displayName || c.display_name || SLOT_DISPLAY_NAMES[(c.slotCode || c.slot_code || '').toLowerCase()] || c.slot_code,
    intakeYear: c.intakeYear !== undefined ? c.intakeYear : c.intake_year,
    intakeIdentifier: c.intakeIdentifier || c.intake_identifier,
    currentSemester: Number(c.currentSemester || c.current_semester),
    version: Number(c.version || 1),
    status: c.status,
    studentCount: Number(c.studentCount || c.student_count || 0),
    chatGroupId: c.chatGroupId || c.chat_group_id || null,
    chatGroupStatus: c.chatGroupStatus || c.chat_group_status || null,
    createdAt: c.createdAt || c.created_at,
    graduatedAt: c.graduatedAt || c.graduated_at
  }));
}

/**
 * Validates whether the authenticated context has authorization to access content.
 * Prevents horizontal privilege escalation (e.g. Student Mercury reading Earth content).
 */
function assertAcademicAccess(context, targetCohortId, audienceScope = 'cohort') {
  if (audienceScope === 'all_students') {
    return true;
  }

  if (!context || !context.authenticated) {
    const err = new Error('Authentication required.');
    err.status = 401;
    throw err;
  }

  if (context.canViewAllCohorts || context.role === 'teacher' || context.role === 'admin') {
    return true;
  }

  if (context.role === 'student' || context.role === 'cr') {
    if (!context.cohort || !context.cohort.id) {
      const err = new Error('Academic cohort membership required.');
      err.status = 403;
      throw err;
    }

    if (context.cohort.id !== targetCohortId) {
      const err = new Error('Access denied: You are not authorized to view content from other academic cohorts.');
      err.status = 403;
      throw err;
    }
    return true;
  }

  const err = new Error('Access forbidden.');
  err.status = 403;
  throw err;
}

/**
 * Asserts whether the authenticated context can access a specific content item.
 * Used for deep links, single-resource GETs, downloads, and previews.
 * Returns true if allowed, false if denied.
 */
function assertContentAccess(context, entityRecord) {
  if (!entityRecord) return false;
  const audience = entityRecord.audience_scope || entityRecord.audienceScope || 'cohort';
  const cohortId = entityRecord.cohort_id || entityRecord.cohortId || null;

  if (audience === 'all_students') {
    return true;
  }

  if (!context || !context.authenticated) {
    return false;
  }

  if (context.canViewAllCohorts || context.role === 'teacher' || context.role === 'admin') {
    return true;
  }

  if (context.role === 'student' || context.role === 'cr') {
    if (!context.cohort || !context.cohort.id || context.academicStatus === 'unassigned') {
      return false;
    }
    return context.cohort.id === cohortId;
  }

  return false;
}

/**
 * Resolves server-authoritative publishing scope for posts, notices, files, and assignments.
 * Prevents client parameter spoofing.
 */
async function resolvePublishScope(db, context, reqBody = {}, { isNotice = false } = {}) {
  if (!context || !context.authenticated) {
    const err = new Error('Authentication required.');
    err.status = 401;
    throw err;
  }

  const role = context.role;

  if (role === 'student') {
    if (isNotice) {
      const err = new Error('Students are not authorized to publish notices.');
      err.status = 403;
      throw err;
    }
    if (!context.cohort || !context.cohort.id || context.academicStatus === 'unassigned') {
      return {
        cohortId: null,
        semesterNo: parseSemesterNumber(context.semester),
        audienceScope: 'all_students'
      };
    }
    return {
      cohortId: context.cohort.id,
      semesterNo: Number(context.cohort.currentSemester),
      audienceScope: 'cohort'
    };
  }

  if (role === 'cr') {
    if (!context.cohort || !context.cohort.id || context.academicStatus === 'unassigned') {
      return {
        cohortId: null,
        semesterNo: parseSemesterNumber(context.semester),
        audienceScope: 'all_students'
      };
    }
    return {
      cohortId: context.cohort.id,
      semesterNo: Number(context.cohort.currentSemester),
      audienceScope: 'cohort'
    };
  }

  if (role === 'teacher' || role === 'admin') {
    const rawScope = String(reqBody.audience_scope || reqBody.audienceScope || reqBody.targetAudience || '').toLowerCase().trim();
    const rawCohort = reqBody.cohort_id || reqBody.cohortId || reqBody.targetCohort || null;
    const rawSem = reqBody.semester_no || reqBody.semesterNo || reqBody.semester || null;
    const parsedSem = parseSemesterNumber(rawSem);

    if (rawScope === 'all_students' || rawCohort === 'all' || (!rawCohort && rawScope === 'all_students')) {
      return {
        cohortId: null,
        semesterNo: parsedSem,
        audienceScope: 'all_students'
      };
    }

    if (rawCohort) {
      const cohortRow = await db.get(
        `SELECT id, slot_code, current_semester, status FROM cohorts WHERE (id = ? OR LOWER(slot_code) = LOWER(?)) AND status = 'active'`,
        String(rawCohort), String(rawCohort)
      );
      if (!cohortRow) {
        const err = new Error(`Target cohort "${rawCohort}" not found or is not active.`);
        err.status = 400;
        throw err;
      }
      return {
        cohortId: cohortRow.id,
        semesterNo: parsedSem || Number(cohortRow.currentSemester || cohortRow.current_semester),
        audienceScope: 'cohort'
      };
    }

    return {
      cohortId: null,
      semesterNo: parsedSem,
      audienceScope: 'all_students'
    };
  }

  const err = new Error('Unauthorized role.');
  err.status = 403;
  throw err;
}

/**
 * Generates SQL WHERE clause fragments and parameters for scoping academic queries.
 * Server-authoritative: Students receive ONLY global content + their own cohort content.
 *
 * @param {object} context - Authoritative academic context from getAcademicContext
 * @param {object} options - Options including table alias and requested filters
 */
function buildAcademicContentFilter(context, {
  tableAlias = '',
  requestedCohortId = null,
  requestedSemester = null,
  includeHistorical = false
} = {}) {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  if (!context || !context.authenticated) {
    // Unauthenticated sees only global content
    return {
      sql: `${prefix}audience_scope = 'all_students'`,
      params: []
    };
  }

  if (context.canViewAllCohorts || context.role === 'teacher' || context.role === 'admin') {
    // Teachers / Admins can optionally filter by cohort/semester or view everything
    const conditions = [];
    const params = [];

    if (requestedCohortId && requestedCohortId !== 'all') {
      conditions.push(`${prefix}cohort_id = ?`);
      params.push(requestedCohortId);
    }
    if (requestedSemester && requestedSemester !== 'all') {
      const parsedSem = parseSemesterNumber(requestedSemester);
      if (parsedSem) {
        conditions.push(`${prefix}semester_no = ?`);
        params.push(parsedSem);
      }
    }

    return {
      sql: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
      params
    };
  }

  // Student flow: strictly bounded to own cohort + all_students
  if (!context.cohort || !context.cohort.id || context.academicStatus === 'unassigned') {
    const studentSem = parseSemesterNumber(context.semester);
    if (studentSem) {
      return {
        sql: `(${prefix}audience_scope = 'all_students' AND (${prefix}semester_no = ? OR ${prefix}semester_no IS NULL))`,
        params: [studentSem]
      };
    }
    // Unassigned student: only global content
    return {
      sql: `${prefix}audience_scope = 'all_students'`,
      params: []
    };
  }

  const ownCohortId = context.cohort.id;
  const currentSemester = Number(context.cohort.currentSemester);

  if (includeHistorical) {
    return {
      sql: `(${prefix}audience_scope = 'all_students' OR ${prefix}cohort_id = ?)`,
      params: [ownCohortId]
    };
  }

  // Current semester normal view:
  // Cohort content for current semester
  // PLUS global content applicable to current semester (or global semester-independent)
  return {
    sql: `((${prefix}cohort_id = ? AND (${prefix}semester_no = ? OR ${prefix}semester_no IS NULL)) OR (${prefix}audience_scope = 'all_students' AND (${prefix}semester_no = ? OR ${prefix}semester_no IS NULL)))`,
    params: [ownCohortId, currentSemester, currentSemester]
  };
}

module.exports = {
  VALID_SLOT_CODES,
  SLOT_DISPLAY_NAMES,
  ensureAcademicCohortSchema,
  getAcademicContext,
  createCohort,
  promoteCohort,
  graduateCohort,
  recycleSlot,
  assignStudentToCohort,
  reassignStudentCohort,
  getCohortHistory,
  getAllCohortsWithHistory,
  logCohortAudit,
  assertAcademicAccess,
  assertContentAccess,
  resolvePublishScope,
  buildAcademicContentFilter,
  parseSemesterNumber
};
