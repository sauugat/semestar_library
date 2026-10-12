'use strict';

const crypto = require('crypto');
const { parseSemesterNumber } = require('./academic-context');
const { recordAdminAudit } = require('./audit-service');

/**
 * Returns cross-semester academic structure, active/archived counts,
 * assigned teacher counts, materials counts, and coursework counts.
 */
async function getAcademicsOverview(db) {
  const isPg = Boolean(db && db.isPostgres);

  // 1. Query subjects per semester with active and archived breakdown
  const subQuery = isPg
    ? `SELECT semester,
              SUM(CASE WHEN active = TRUE THEN 1 ELSE 0 END) AS active_count,
              SUM(CASE WHEN active = FALSE THEN 1 ELSE 0 END) AS archived_count,
              COUNT(*) AS total_count
       FROM subjects
       GROUP BY semester`
    : `SELECT semester,
              SUM(CASE WHEN active = 1 OR active = '1' THEN 1 ELSE 0 END) AS active_count,
              SUM(CASE WHEN active = 0 OR active = '0' THEN 1 ELSE 0 END) AS archived_count,
              COUNT(*) AS total_count
       FROM subjects
       GROUP BY semester`;

  // 2. Query distinct teachers assigned per semester
  const teachQuery = `
    SELECT s.semester, COUNT(DISTINCT ts.teacher_id) AS teacher_count
    FROM teacher_subjects ts
    JOIN subjects s ON s.id = ts.subject_id
    GROUP BY s.semester
  `;

  // 3. Query files and assignments per semester
  const filesQuery = `SELECT semester, COUNT(*) AS count FROM files GROUP BY semester`;
  const assignQuery = `SELECT semester, COUNT(*) AS count FROM assignments GROUP BY semester`;

  const [subjectsRows, teachersRows, filesRows, assignmentsRows] = await Promise.all([
    db.all(subQuery).catch(() => []),
    db.all(teachQuery).catch(() => []),
    db.all(filesQuery).catch(() => []),
    db.all(assignQuery).catch(() => [])
  ]);

  const semesterStats = [];
  let totalActive = 0;
  let totalArchived = 0;
  let totalSubjects = 0;

  for (let sem = 1; sem <= 8; sem++) {
    const semStr = String(sem);
    const fullSemStr = `Semester ${sem}`;
    const shortSemStr = `Sem ${sem}`;

    const subMatch = (subjectsRows || []).find(r => Number(r.semester) === sem);
    const teachMatch = (teachersRows || []).find(r => Number(r.semester) === sem);
    const fileMatch = (filesRows || []).find(r => {
      const s = String(r.semester || '').trim().toLowerCase();
      return s === semStr || s === fullSemStr.toLowerCase() || s === shortSemStr.toLowerCase();
    });
    const assignMatch = (assignmentsRows || []).find(r => {
      const s = String(r.semester || '').trim().toLowerCase();
      return s === semStr || s === fullSemStr.toLowerCase() || s === shortSemStr.toLowerCase();
    });

    const activeCount = Number(subMatch?.active_count || subMatch?.activecount || 0);
    const archivedCount = Number(subMatch?.archived_count || subMatch?.archivedcount || 0);
    const semTotalSub = Number(subMatch?.total_count || subMatch?.totalcount || (activeCount + archivedCount));

    totalActive += activeCount;
    totalArchived += archivedCount;
    totalSubjects += semTotalSub;

    semesterStats.push({
      semester: sem,
      label: `Semester ${sem}`,
      activeSubjectsCount: activeCount,
      archivedSubjectsCount: archivedCount,
      totalSubjectsCount: semTotalSub,
      subjectsCount: activeCount, // backward-compat with older UI
      assignedTeachersCount: Number(teachMatch?.teacher_count || teachMatch?.teachercount || 0),
      materialsCount: Number(fileMatch?.count || 0),
      assignmentsCount: Number(assignMatch?.count || 0)
    });
  }

  // Count distinct assigned teachers across the entire institution
  const totalTeachersRow = await db.get('SELECT COUNT(DISTINCT teacher_id) AS count FROM teacher_subjects').catch(() => null);
  const totalAssignedTeachers = Number(totalTeachersRow?.count || 0);

  const totalMaterials = (filesRows || []).reduce((acc, r) => acc + Number(r.count || 0), 0);
  const totalAssignments = (assignmentsRows || []).reduce((acc, r) => acc + Number(r.count || 0), 0);

  return {
    semesters: semesterStats,
    totals: {
      activeSubjects: totalActive,
      archivedSubjects: totalArchived,
      subjects: totalActive, // backward-compat with older UI
      totalSubjects,
      assignedTeachers: totalAssignedTeachers,
      materials: totalMaterials,
      assignments: totalAssignments
    }
  };
}

/**
 * Lists canonical subjects with semester, status, search filtering, and pagination.
 */
async function listCanonicalSubjects(db, { semester, status = 'all', search, page, limit } = {}) {
  const isPg = Boolean(db && db.isPostgres);
  const conditions = [];
  const params = [];

  // 1. Semester filter
  if (semester !== undefined && semester !== null && String(semester).trim() !== '' && String(semester).toLowerCase() !== 'all') {
    const semNum = Number(semester);
    if (semNum >= 1 && semNum <= 8) {
      conditions.push(isPg ? `s.semester = $${params.length + 1}` : 's.semester = ?');
      params.push(semNum);
    }
  }

  // 2. Status filter ('active', 'archived'/'inactive', 'all')
  const cleanStatus = (status || 'all').trim().toLowerCase();
  if (cleanStatus === 'active') {
    conditions.push(isPg ? '(s.active = TRUE OR s.active IS NULL)' : '(s.active = 1 OR s.active IS NULL)');
  } else if (cleanStatus === 'archived' || cleanStatus === 'inactive') {
    conditions.push(isPg ? 's.active = FALSE' : '(s.active = 0 OR s.active = \'0\')');
  }

  // 3. Search filter
  if (search && String(search).trim()) {
    const term = `%${String(search).trim().toLowerCase()}%`;
    if (isPg) {
      conditions.push(`(LOWER(s.code) LIKE $${params.length + 1} OR LOWER(s.name) LIKE $${params.length + 2})`);
      params.push(term, term);
    } else {
      conditions.push('(LOWER(s.code) LIKE ? OR LOWER(s.name) LIKE ?)');
      params.push(term, term);
    }
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total matching subjects
  const countSql = `SELECT COUNT(*) AS total FROM subjects s ${whereSql}`;
  const countRow = await db.get(countSql, ...params);
  const total = Number(countRow?.total || 0);

  // Pagination calculation
  const hasPagination = page !== undefined || limit !== undefined;
  const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(String(limit || (hasPagination ? '50' : '200')), 10) || 50));
  const offsetNum = (pageNum - 1) * limitNum;
  const totalPages = Math.ceil(total / limitNum) || 1;

  let query = `
    SELECT s.id, s.code, s.name, s.semester, s.department,
           s.credit_hours AS "creditHours", s.nature, s.active,
           s.created_at AS "createdAt", s.updated_at AS "updatedAt",
           (SELECT COUNT(DISTINCT ts.teacher_id) FROM teacher_subjects ts WHERE ts.subject_id = s.id) AS "assignedTeachersCount",
           (SELECT COUNT(*) FROM files f WHERE f.subject = s.code OR f.subject = s.name) AS "materialsCount",
           (SELECT COUNT(*) FROM assignments a WHERE a.subject = s.code OR a.subject = s.name) AS "assignmentsCount"
    FROM subjects s
    ${whereSql}
    ORDER BY s.semester ASC, s.code ASC
  `;

  const queryParams = [...params];
  if (hasPagination) {
    if (isPg) {
      query += ` LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    } else {
      query += ' LIMIT ? OFFSET ?';
    }
    queryParams.push(limitNum, offsetNum);
  }

  const rows = (await db.all(query, ...queryParams)) || [];
  const subjects = rows.map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    semester: Number(r.semester),
    department: r.department || 'BIT',
    creditHours: Number(r.creditHours || r.credithours || 3.0),
    nature: r.nature || null,
    active: !(r.active === false || r.active === 0 || r.active === '0'),
    assignedTeachersCount: Number(r.assignedTeachersCount || r.assignedteacherscount || 0),
    materialsCount: Number(r.materialsCount || r.materialscount || 0),
    assignmentsCount: Number(r.assignmentsCount || r.assignmentscount || 0),
    createdAt: r.createdAt || r.createdat || null,
    updatedAt: r.updatedAt || r.updatedat || null
  }));

  return {
    subjects,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages
    }
  };
}

/**
 * Retrieves complete detail for a single canonical subject by ID or code,
 * including assigned faculty teachers and related materials/assignments counts.
 */
async function getSubjectDetail(db, subjectIdOrCode) {
  if (!subjectIdOrCode) return null;
  const isPg = Boolean(db && db.isPostgres);

  const query = isPg
    ? `SELECT s.id, s.code, s.name, s.semester, s.department,
              s.credit_hours AS "creditHours", s.nature, s.active,
              s.created_at AS "createdAt", s.updated_at AS "updatedAt"
       FROM subjects s
       WHERE s.id = $1 OR LOWER(s.code) = LOWER($2)`
    : `SELECT s.id, s.code, s.name, s.semester, s.department,
              s.credit_hours AS "creditHours", s.nature, s.active,
              s.created_at AS "createdAt", s.updated_at AS "updatedAt"
       FROM subjects s
       WHERE s.id = ? OR LOWER(s.code) = LOWER(?)`;

  const subject = await db.get(query, subjectIdOrCode, subjectIdOrCode);
  if (!subject) return null;

  // Query assigned teachers
  const teachersQuery = isPg
    ? `SELECT t.id AS teacher_id, t.user_id, t.status, t.designation,
              st.name, st.username, st.email, st.department
       FROM teacher_subjects ts
       JOIN teachers t ON t.id = ts.teacher_id
       LEFT JOIN students st ON st.studentId = t.user_id
       WHERE ts.subject_id = $1
       ORDER BY st.name ASC`
    : `SELECT t.id AS teacher_id, t.user_id, t.status, t.designation,
              st.name, st.username, st.email, st.department
       FROM teacher_subjects ts
       JOIN teachers t ON t.id = ts.teacher_id
       LEFT JOIN students st ON st.studentId = t.user_id
       WHERE ts.subject_id = ?
       ORDER BY st.name ASC`;

  const teachers = (await db.all(teachersQuery, subject.id)) || [];

  // Related materials count
  const matCountQuery = isPg
    ? `SELECT COUNT(*) AS count FROM files WHERE subject = $1 OR subject = $2`
    : `SELECT COUNT(*) AS count FROM files WHERE subject = ? OR subject = ?`;
  const matRow = await db.get(matCountQuery, subject.code, subject.name).catch(() => null);

  // Related assignments count
  const assignCountQuery = isPg
    ? `SELECT COUNT(*) AS count FROM assignments WHERE subject = $1 OR subject = $2`
    : `SELECT COUNT(*) AS count FROM assignments WHERE subject = ? OR subject = ?`;
  const assignRow = await db.get(assignCountQuery, subject.code, subject.name).catch(() => null);

  return {
    id: subject.id,
    code: subject.code,
    name: subject.name,
    semester: Number(subject.semester),
    department: subject.department || 'BIT',
    creditHours: Number(subject.creditHours || subject.credithours || 3.0),
    nature: subject.nature || null,
    active: !(subject.active === false || subject.active === 0 || subject.active === '0'),
    createdAt: subject.createdAt || subject.createdat || null,
    updatedAt: subject.updatedAt || subject.updatedat || null,
    assignedTeachers: teachers.map(t => ({
      teacherId: t.teacher_id,
      userId: t.user_id,
      name: t.name || 'Unnamed Teacher',
      username: t.username || '—',
      email: t.email || '—',
      designation: t.designation || 'Instructor',
      status: t.status || 'active'
    })),
    assignedTeachersCount: teachers.length,
    materialsCount: Number(matRow?.count || 0),
    assignmentsCount: Number(assignRow?.count || 0)
  };
}

/**
 * Creates a new canonical subject with transactional audit logging.
 */
async function createCanonicalSubject(db, {
  adminId,
  code,
  name,
  semester,
  department = 'BIT',
  creditHours = 3.0,
  nature = null,
  reason
}) {
  if (!adminId || typeof adminId !== 'string') {
    const err = new Error('Authenticated administrator identity is required.');
    err.statusCode = 401;
    throw err;
  }

  const cleanCode = (code ? String(code).trim().toUpperCase() : '');
  if (!cleanCode) {
    const err = new Error('Subject code is required.');
    err.statusCode = 400;
    throw err;
  }

  const cleanName = (name ? String(name).trim() : '');
  if (!cleanName) {
    const err = new Error('Subject name is required.');
    err.statusCode = 400;
    throw err;
  }

  const parsedSem = parseSemesterNumber(semester);
  if (parsedSem === null || parsedSem < 1 || parsedSem > 8) {
    const err = new Error('Invalid academic semester. Must be an integer between 1 and 8.');
    err.statusCode = 400;
    throw err;
  }

  const cleanDept = (department ? String(department).trim().toUpperCase() : 'BIT') || 'BIT';
  const cleanCredit = Number.isFinite(Number(creditHours)) && Number(creditHours) >= 0 ? Number(creditHours) : 3.0;
  const cleanNature = nature ? String(nature).trim() : null;

  // Check unique code across all subjects
  const existing = await db.get('SELECT id, code FROM subjects WHERE LOWER(code) = LOWER(?)', cleanCode);
  if (existing) {
    const err = new Error(`Subject with code "${cleanCode}" already exists.`);
    err.statusCode = 409;
    throw err;
  }

  // Use stable ID based on canonical uppercase code (or fallback to UUID if necessary)
  const id = cleanCode;

  const runCreate = async (tx) => {
    const isPg = Boolean(tx.isPostgres || db.isPostgres);
    const activeVal = isPg ? true : 1;

    if (isPg) {
      await tx.run(
        `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        id, cleanCode, cleanName, parsedSem, cleanDept, cleanCredit, cleanNature, activeVal
      );
    } else {
      await tx.run(
        `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        id, cleanCode, cleanName, parsedSem, cleanDept, cleanCredit, cleanNature, activeVal
      );
    }

    const createdRecord = {
      id,
      code: cleanCode,
      name: cleanName,
      semester: parsedSem,
      department: cleanDept,
      creditHours: cleanCredit,
      nature: cleanNature,
      active: true
    };

    await recordAdminAudit(db, {
      actorUserId: adminId,
      action: 'subject_created',
      entityType: 'subject',
      entityId: id,
      beforeState: null,
      afterState: createdRecord,
      metadata: {
        reason: reason || 'Canonical subject created by administrator',
        code: cleanCode,
        name: cleanName,
        semester: parsedSem
      },
      required: true,
      tx
    });

    return createdRecord;
  };

  if (typeof db.withTransaction === 'function') {
    return await db.withTransaction(runCreate);
  }
  return await runCreate(db);
}

/**
 * Updates an existing subject without changing its stable ID,
 * with transactional audit logging.
 */
async function updateCanonicalSubject(db, {
  adminId,
  subjectId,
  code,
  name,
  semester,
  department,
  creditHours,
  nature,
  reason
}) {
  if (!adminId || typeof adminId !== 'string') {
    const err = new Error('Authenticated administrator identity is required.');
    err.statusCode = 401;
    throw err;
  }

  if (!subjectId) {
    const err = new Error('Subject ID is required.');
    err.statusCode = 400;
    throw err;
  }

  // Fetch current state
  const current = await db.get('SELECT * FROM subjects WHERE id = ? OR LOWER(code) = LOWER(?)', subjectId, subjectId);
  if (!current) {
    const err = new Error('Subject not found.');
    err.statusCode = 404;
    throw err;
  }

  const updatedCode = code !== undefined ? String(code).trim().toUpperCase() : current.code;
  if (!updatedCode) {
    const err = new Error('Subject code cannot be empty.');
    err.statusCode = 400;
    throw err;
  }

  // Check unique code if changed
  if (updatedCode.toLowerCase() !== String(current.code).toLowerCase()) {
    const dup = await db.get('SELECT id FROM subjects WHERE LOWER(code) = LOWER(?) AND id != ?', updatedCode, current.id);
    if (dup) {
      const err = new Error(`Subject with code "${updatedCode}" already exists.`);
      err.statusCode = 409;
      throw err;
    }
  }

  const updatedName = name !== undefined ? String(name).trim() : current.name;
  if (!updatedName) {
    const err = new Error('Subject name cannot be empty.');
    err.statusCode = 400;
    throw err;
  }

  let updatedSem = current.semester;
  if (semester !== undefined && semester !== null) {
    const parsedSem = parseSemesterNumber(semester);
    if (parsedSem === null || parsedSem < 1 || parsedSem > 8) {
      const err = new Error('Invalid academic semester. Must be an integer between 1 and 8.');
      err.statusCode = 400;
      throw err;
    }
    updatedSem = parsedSem;

    // Safety restriction: Disallow changing semester of subjects with existing references
    // to prevent desynchronization of teacher authorization, student library isolation, and coursework
    if (updatedSem !== Number(current.semester)) {
      const isPg = Boolean(db && db.isPostgres);
      const teacherCheck = isPg
        ? await db.get('SELECT 1 FROM teacher_subjects WHERE subject_id = $1 LIMIT 1', current.id)
        : await db.get('SELECT 1 FROM teacher_subjects WHERE subject_id = ? LIMIT 1', current.id);
      const fileCheck = isPg
        ? await db.get('SELECT 1 FROM files WHERE subject = $1 OR subject = $2 LIMIT 1', current.id, current.code)
        : await db.get('SELECT 1 FROM files WHERE subject = ? OR subject = ? LIMIT 1', current.id, current.code);
      const assignCheck = isPg
        ? await db.get('SELECT 1 FROM assignments WHERE subject = $1 OR subject = $2 LIMIT 1', current.id, current.code)
        : await db.get('SELECT 1 FROM assignments WHERE subject = ? OR subject = ? LIMIT 1', current.id, current.code);

      if (teacherCheck || fileCheck || assignCheck) {
        const conflictType = teacherCheck
          ? 'teacher assignments'
          : fileCheck
          ? 'academic study materials'
          : 'coursework assignments';
        const err = new Error(
          `Cannot change academic semester of subject "${current.code}" because existing ${conflictType} ` +
          `are linked to semester ${current.semester}. Archiving or creating a separate course code is required to preserve academic authorization.`
        );
        err.statusCode = 409;
        throw err;
      }
    }
  }

  const updatedDept = department !== undefined ? String(department).trim().toUpperCase() : current.department;
  const updatedCredit = creditHours !== undefined && Number.isFinite(Number(creditHours)) && Number(creditHours) >= 0
    ? Number(creditHours)
    : Number(current.credit_hours || 3.0);
  const updatedNature = nature !== undefined ? (nature ? String(nature).trim() : null) : current.nature;

  const beforeState = {
    id: current.id,
    code: current.code,
    name: current.name,
    semester: Number(current.semester),
    department: current.department,
    creditHours: Number(current.credit_hours || 3.0),
    nature: current.nature,
    active: !(current.active === false || current.active === 0 || current.active === '0')
  };

  const afterState = {
    id: current.id, // Stable subject ID remains strictly preserved
    code: updatedCode,
    name: updatedName,
    semester: Number(updatedSem),
    department: updatedDept,
    creditHours: updatedCredit,
    nature: updatedNature,
    active: beforeState.active
  };

  const runUpdate = async (tx) => {
    const isPg = Boolean(tx.isPostgres || db.isPostgres);

    if (isPg) {
      await tx.run(
        `UPDATE subjects
         SET code = $1, name = $2, semester = $3, department = $4,
             credit_hours = $5, nature = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $7`,
        updatedCode, updatedName, updatedSem, updatedDept, updatedCredit, updatedNature, current.id
      );
    } else {
      await tx.run(
        `UPDATE subjects
         SET code = ?, name = ?, semester = ?, department = ?,
             credit_hours = ?, nature = ?, updated_at = datetime('now')
         WHERE id = ?`,
        updatedCode, updatedName, updatedSem, updatedDept, updatedCredit, updatedNature, current.id
      );
    }

    await recordAdminAudit(db, {
      actorUserId: adminId,
      action: 'subject_updated',
      entityType: 'subject',
      entityId: current.id,
      beforeState,
      afterState,
      metadata: {
        reason: reason || 'Canonical subject updated by administrator',
        subjectCode: updatedCode
      },
      required: true,
      tx
    });

    return afterState;
  };

  if (typeof db.withTransaction === 'function') {
    return await db.withTransaction(runUpdate);
  }
  return await runUpdate(db);
}

/**
 * Reversibly archives/deactivates a canonical subject.
 * CRITICAL: Preserves all teacher assignments, historical materials, and coursework.
 */
async function archiveCanonicalSubject(db, { adminId, subjectId, reason }) {
  if (!adminId || typeof adminId !== 'string') {
    const err = new Error('Authenticated administrator identity is required.');
    err.statusCode = 401;
    throw err;
  }

  if (!subjectId) {
    const err = new Error('Subject ID is required.');
    err.statusCode = 400;
    throw err;
  }

  const subject = await db.get('SELECT * FROM subjects WHERE id = ? OR LOWER(code) = LOWER(?)', subjectId, subjectId);
  if (!subject) {
    const err = new Error('Subject not found.');
    err.statusCode = 404;
    throw err;
  }

  const isAlreadyArchived = subject.active === false || subject.active === 0 || subject.active === '0';
  if (isAlreadyArchived) {
    return {
      id: subject.id,
      code: subject.code,
      name: subject.name,
      active: false,
      alreadyArchived: true
    };
  }

  const beforeState = {
    id: subject.id,
    code: subject.code,
    name: subject.name,
    semester: Number(subject.semester),
    active: true
  };

  const afterState = {
    ...beforeState,
    active: false
  };

  const runArchive = async (tx) => {
    const isPg = Boolean(tx.isPostgres || db.isPostgres);
    const inactiveVal = isPg ? false : 0;

    if (isPg) {
      await tx.run(
        `UPDATE subjects SET active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        inactiveVal, subject.id
      );
    } else {
      await tx.run(
        `UPDATE subjects SET active = ?, updated_at = datetime('now') WHERE id = ?`,
        inactiveVal, subject.id
      );
    }

    await recordAdminAudit(db, {
      actorUserId: adminId,
      action: 'subject_archived',
      entityType: 'subject',
      entityId: subject.id,
      beforeState,
      afterState,
      metadata: {
        reason: reason || 'Subject archived by administrator',
        subjectCode: subject.code,
        subjectName: subject.name
      },
      required: true,
      tx
    });

    return afterState;
  };

  if (typeof db.withTransaction === 'function') {
    return await db.withTransaction(runArchive);
  }
  return await runArchive(db);
}

/**
 * Reactivates an archived canonical subject.
 */
async function reactivateCanonicalSubject(db, { adminId, subjectId, reason }) {
  if (!adminId || typeof adminId !== 'string') {
    const err = new Error('Authenticated administrator identity is required.');
    err.statusCode = 401;
    throw err;
  }

  if (!subjectId) {
    const err = new Error('Subject ID is required.');
    err.statusCode = 400;
    throw err;
  }

  const subject = await db.get('SELECT * FROM subjects WHERE id = ? OR LOWER(code) = LOWER(?)', subjectId, subjectId);
  if (!subject) {
    const err = new Error('Subject not found.');
    err.statusCode = 404;
    throw err;
  }

  const isAlreadyActive = !(subject.active === false || subject.active === 0 || subject.active === '0');
  if (isAlreadyActive) {
    return {
      id: subject.id,
      code: subject.code,
      name: subject.name,
      active: true,
      alreadyActive: true
    };
  }

  const beforeState = {
    id: subject.id,
    code: subject.code,
    name: subject.name,
    semester: Number(subject.semester),
    active: false
  };

  const afterState = {
    ...beforeState,
    active: true
  };

  const runReactivate = async (tx) => {
    const isPg = Boolean(tx.isPostgres || db.isPostgres);
    const activeVal = isPg ? true : 1;

    if (isPg) {
      await tx.run(
        `UPDATE subjects SET active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        activeVal, subject.id
      );
    } else {
      await tx.run(
        `UPDATE subjects SET active = ?, updated_at = datetime('now') WHERE id = ?`,
        activeVal, subject.id
      );
    }

    await recordAdminAudit(db, {
      actorUserId: adminId,
      action: 'subject_reactivated',
      entityType: 'subject',
      entityId: subject.id,
      beforeState,
      afterState,
      metadata: {
        reason: reason || 'Subject reactivated by administrator',
        subjectCode: subject.code,
        subjectName: subject.name
      },
      required: true,
      tx
    });

    return afterState;
  };

  if (typeof db.withTransaction === 'function') {
    return await db.withTransaction(runReactivate);
  }
  return await runReactivate(db);
}

/**
 * Returns read-only review list of unclassified academic materials and assignments
 * (e.g. missing valid semester 1-8 or unlinked subject).
 * DOES NOT MUTATE OR RECLASSIFY ANY RECORDS.
 */
async function getUnclassifiedMaterials(db, { page = 1, limit = 20 } = {}) {
  const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(String(limit || '20'), 10) || 20));
  const offsetNum = (pageNum - 1) * limitNum;

  // Retrieve canonical codes and names to detect unlinked subjects
  const canonicalSubs = (await db.all('SELECT code, name FROM subjects')) || [];
  const knownSet = new Set();
  for (const s of canonicalSubs) {
    if (s.code) knownSet.add(s.code.trim().toLowerCase());
    if (s.name) knownSet.add(s.name.trim().toLowerCase());
  }

  // Valid semester strings
  const validSemestersSql = "('1','2','3','4','5','6','7','8', 'Semester 1', 'Semester 2', 'Semester 3', 'Semester 4', 'Semester 5', 'Semester 6', 'Semester 7', 'Semester 8', 'Sem 1', 'Sem 2', 'Sem 3', 'Sem 4', 'Sem 5', 'Sem 6', 'Sem 7', 'Sem 8')";

  // 1. Files with missing semester or unlinked subject
  const unclassifiedFilesQuery = `
    SELECT f.id, f.title, f.originalName, f.storedName, f.subject, f.chapter,
           f.semester, f.uploadedBy, f.sizeBytes, f.uploadedAt,
           s.name AS uploader_name, s.role AS uploader_role
    FROM files f
    LEFT JOIN students s ON s.studentId = f.uploadedBy
    WHERE f.semester IS NULL OR TRIM(f.semester) = '' OR TRIM(f.semester) NOT IN ${validSemestersSql}
       OR f.subject IS NULL OR TRIM(f.subject) = ''
    ORDER BY f.uploadedAt DESC
  `;

  // 2. Assignments with missing semester or unlinked subject
  const unclassifiedAssignmentsQuery = `
    SELECT a.id, a.title, a.description, a.language, a.subject, a.semester,
           a.deadline, a.createdBy, a.createdAt,
           s.name AS author_name, s.role AS author_role
    FROM assignments a
    LEFT JOIN students s ON s.studentId = a.createdBy
    WHERE a.semester IS NULL OR TRIM(a.semester) = '' OR TRIM(a.semester) NOT IN ${validSemestersSql}
       OR a.subject IS NULL OR TRIM(a.subject) = ''
    ORDER BY a.createdAt DESC
  `;

  const [allUnclassFiles, allUnclassAssignments] = await Promise.all([
    db.all(unclassifiedFilesQuery).catch(() => []),
    db.all(unclassifiedAssignmentsQuery).catch(() => [])
  ]);

  // Tag items with issue explanation
  const tagIssue = (item) => {
    const sem = String(item.semester || '').trim();
    const parsedSem = parseSemesterNumber(sem);
    const subj = String(item.subject || '').trim().toLowerCase();
    const hasValidSem = parsedSem !== null && parsedSem >= 1 && parsedSem <= 8;
    const hasCanonicalSub = subj ? knownSet.has(subj) : false;

    const issues = [];
    if (!hasValidSem) issues.push(sem ? `Invalid semester "${sem}"` : 'Missing semester');
    if (!subj) issues.push('Missing subject');
    else if (!hasCanonicalSub) issues.push(`Custom / unlinked subject "${item.subject}"`);

    return {
      ...item,
      issue: issues.join('; '),
      missingSemester: !hasValidSem,
      unlinkedSubject: !hasCanonicalSub
    };
  };

  const filesWithIssues = (allUnclassFiles || []).map(tagIssue);
  const assignmentsWithIssues = (allUnclassAssignments || []).map(tagIssue);

  const totalFiles = filesWithIssues.length;
  const totalAssignments = assignmentsWithIssues.length;
  const totalCombined = totalFiles + totalAssignments;

  const paginatedFiles = filesWithIssues.slice(offsetNum, offsetNum + limitNum);

  return {
    summary: {
      totalUnclassifiedMaterials: totalFiles,
      totalUnclassifiedAssignments: totalAssignments,
      totalCombined,
      recommendedAction: 'Manual administrative review required before linking historical files to canonical subjects.'
    },
    files: paginatedFiles,
    assignments: assignmentsWithIssues.slice(0, 50),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: totalFiles,
      totalPages: Math.ceil(totalFiles / limitNum) || 1
    }
  };
}

module.exports = {
  getAcademicsOverview,
  listCanonicalSubjects,
  getSubjectDetail,
  createCanonicalSubject,
  updateCanonicalSubject,
  archiveCanonicalSubject,
  reactivateCanonicalSubject,
  getUnclassifiedMaterials
};
