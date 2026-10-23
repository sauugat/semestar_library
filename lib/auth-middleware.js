const { verifySupabaseToken } = require('./supabase');
const { parseSemesterNumber, resolveActiveCohortForSemester } = require('./academic-context');
const crypto = require('crypto');

/**
 * Creates authentication middleware for Express.
 * Resolves verified Supabase JWTs to Neon PostgreSQL students,
 * while preserving legacy mobile bearer token authentication.
 */
function createAuthMiddleware(db) {
  async function authenticate(req, res, next) {
    req.user = null;

    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query && typeof req.query.token === 'string' && req.query.token.trim()) {
      token = req.query.token.trim();
    }

    if (!token) {
      return next();
    }

    // Distinguish between Supabase JWT (contains 2 dots separating 3 base64url segments)
    // and legacy 64-hex mobile tokens.
    const isJwt = token.split('.').length === 3;

    if (isJwt) {
      // Defense-in-depth: Immediately ignore restricted teacher onboarding tokens from authenticating normal app APIs
      try {
        const [headerPart] = token.split('.');
        const parsedHeader = JSON.parse(Buffer.from(headerPart, 'base64').toString('utf8'));
        if (parsedHeader && parsedHeader.typ === 'teacher_onboarding') {
          return next();
        }
      } catch {}

      try {
        const { user: supabaseUser, error } = await verifySupabaseToken(token);
        if (!error && supabaseUser && supabaseUser.id) {
          const supabaseUid = supabaseUser.id;
          const userEmail = supabaseUser.email ? supabaseUser.email.toLowerCase().trim() : null;
          const meta = supabaseUser.user_metadata || {};

          // Lookup student in Neon PostgreSQL by supabase_uid or email
          let student = await db.get(
            `SELECT studentId, username, name, role, department, semester, cohort_id, gender, email, supabase_uid, avatarUrl, verification_status, account_status
             FROM students
             WHERE supabase_uid = ? OR (email IS NOT NULL AND LOWER(email) = ?)`,
            supabaseUid, userEmail || ''
          );

          // Fallback lookup by username/studentId from metadata if email/uid wasn't linked yet
          if (!student && (meta.username || meta.studentId || meta.student_id)) {
            const candidateHandle = String(meta.username || meta.studentId || meta.student_id).trim().toLowerCase();
            if (candidateHandle) {
              student = await db.get(
                `SELECT studentId, username, name, role, department, semester, cohort_id, gender, email, supabase_uid, avatarUrl, verification_status, account_status
                 FROM students
                 WHERE (LOWER(username) = ? OR LOWER(studentId) = ?) AND (supabase_uid IS NULL OR supabase_uid = '')`,
                candidateHandle, candidateHandle
              );
            }
          }

          // Auto-provision student row if verified Supabase user has profile metadata but DB row was not created.
          // CRITICAL: Never auto-provision a 'student' row for teacher onboarding requests or pending teacher accounts!
          const isEmailConfirmed = !!(supabaseUser.email_confirmed_at || supabaseUser.confirmed_at);
          const isTeacherRoleMeta = String(meta.role || '').toLowerCase() === 'teacher';
          const isTeacherOnboardingPath = Boolean(req.path && req.path.includes('/teacher/onboarding'));
          const hasProfileMeta = Boolean(meta && (meta.name || meta.full_name || meta.username || meta.semester || meta.studentId || meta.student_id));

          if (!student && isEmailConfirmed && !isTeacherOnboardingPath) {
            // Check if this confirmed Supabase user has a pending teacher onboarding record
            let pendingTeacher = null;
            try {
              pendingTeacher = await db.get(
                'SELECT id, supabase_uid FROM teacher_onboarding_pending WHERE supabase_uid = ? OR (email IS NOT NULL AND LOWER(email) = ?)',
                supabaseUid, userEmail || ''
              );
            } catch {}

            if (pendingTeacher) {
              try {
                const { finalizeTeacherOnboarding } = require('./teacher-service');
                const finRes = await finalizeTeacherOnboarding(db, {
                  supabaseToken: token,
                  supabaseUser
                });
                if (finRes && finRes.success) {
                  student = await db.get(
                    `SELECT studentId, username, name, role, department, semester, cohort_id, gender, email, supabase_uid, avatarUrl, verification_status, account_status
                     FROM students
                     WHERE supabase_uid = ? OR studentId = ?`,
                    supabaseUid, finRes.teacherId || ''
                  );
                }
              } catch (finErr) {
                console.warn('[Auth Middleware] Auto-finalize pending teacher warning:', finErr.message);
              }
            } else if (hasProfileMeta && !isTeacherRoleMeta) {
              try {
                const cleanName = String(meta.full_name || meta.name || (userEmail ? userEmail.split('@')[0] : 'Student')).trim() || 'Student';
                let baseUsername = String(meta.username || meta.studentId || meta.student_id || (userEmail ? userEmail.split('@')[0].replace(/[^a-zA-Z0-9_.]/g, '') : '') || `user_${supabaseUid.slice(0, 8)}`).trim().toLowerCase();
                if (baseUsername.length < 3) baseUsername = `user_${supabaseUid.slice(0, 8)}`.toLowerCase();
                let cleanUsername = baseUsername;
                const existingUsername = await db.get('SELECT studentId FROM students WHERE LOWER(username) = ?', cleanUsername);
                if (existingUsername) {
                  cleanUsername = `${baseUsername.slice(0, 22)}_${crypto.randomBytes(2).toString('hex')}`;
                }
                let studentIdToUse = String(meta.studentId || meta.student_id || cleanUsername).trim();
                const existingId = await db.get('SELECT studentId FROM students WHERE studentId = ?', studentIdToUse);
                if (existingId) {
                  studentIdToUse = `s_${cleanUsername}_${crypto.randomBytes(3).toString('hex')}`;
                }
                const cleanDept = String(meta.department || 'BIT').trim() || 'BIT';
                const semNum = parseSemesterNumber(meta.semester) || 1;
                const cleanSem = `Semester ${semNum}`;
                const cleanGender = meta.gender && String(meta.gender).trim() ? String(meta.gender).trim().toLowerCase() : null;
                let assignedCohortId = null;
                try {
                  const cohortRes = await resolveActiveCohortForSemester(db, semNum);
                  if (cohortRes && cohortRes.cohort && cohortRes.cohort.id) {
                    assignedCohortId = cohortRes.cohort.id;
                  }
                } catch {}

                if (db.isPostgres) {
                  await db.run(
                    `INSERT INTO students (
                      studentId, username, name, email, supabase_uid,
                      department, semester, gender, role, verification_status,
                      passwordHash, cohort_id, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'student', 'verified', 'supabase_auth', $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                    studentIdToUse, cleanUsername, cleanName, userEmail, supabaseUid,
                    cleanDept, cleanSem, cleanGender, assignedCohortId
                  );
                } else {
                  await db.run(
                    `INSERT INTO students (
                      studentId, username, name, email, supabase_uid,
                      department, semester, gender, role, verification_status,
                      passwordHash, cohort_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'student', 'verified', 'supabase_auth', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                    studentIdToUse, cleanUsername, cleanName, userEmail, supabaseUid,
                    cleanDept, cleanSem, cleanGender, assignedCohortId
                  );
                }

                student = await db.get(
                  `SELECT studentId, username, name, role, department, semester, cohort_id, gender, email, supabase_uid, avatarUrl, verification_status, account_status
                   FROM students
                   WHERE studentId = ?`,
                  studentIdToUse
                );
              } catch (provisionErr) {
                console.warn('[Auth Middleware] Auto-provision student warning:', provisionErr.message);
              }
            }
          }

          if (student) {
            const isSuspended = (student.account_status === 'suspended' || student.accountStatus === 'suspended');
            if (isSuspended) {
              req.isSuspended = true;
              req.suspendedStudent = student;
              req.user = null;
              req.student = null;
              return next();
            }
            const needsVerificationSync = isEmailConfirmed && (student.verification_status !== 'verified' && student.verificationStatus !== 'verified');
            const needsUidSync = !student.supabase_uid && userEmail;

            if (needsUidSync && needsVerificationSync) {
              db.run('UPDATE students SET supabase_uid = ?, verification_status = ? WHERE studentId = ?', supabaseUid, 'verified', student.studentId).catch(() => {});
              student.verification_status = 'verified';
              student.verificationStatus = 'verified';
            } else if (needsUidSync) {
              db.run('UPDATE students SET supabase_uid = ? WHERE studentId = ?', supabaseUid, student.studentId).catch(() => {});
            } else if (needsVerificationSync) {
              db.run('UPDATE students SET verification_status = ? WHERE studentId = ?', 'verified', student.studentId).catch(() => {});
              student.verification_status = 'verified';
              student.verificationStatus = 'verified';
            }

            if (student.role !== 'teacher' && student.role !== 'admin') {
              if (!student.semester && meta.semester) {
                const parsedMetaSem = parseSemesterNumber(meta.semester);
                if (parsedMetaSem) {
                  student.semester = `Semester ${parsedMetaSem}`;
                  db.run('UPDATE students SET semester = ? WHERE studentId = ?', student.semester, student.studentId).catch(() => {});
                }
              }
              if (!(student.cohort_id || student.cohortId) && student.semester) {
                try {
                  const cohortRes = await resolveActiveCohortForSemester(db, student.semester);
                  if (cohortRes && cohortRes.cohort && cohortRes.cohort.id) {
                    student.cohort_id = cohortRes.cohort.id;
                    student.cohortId = cohortRes.cohort.id;
                    db.run('UPDATE students SET cohort_id = ? WHERE studentId = ?', cohortRes.cohort.id, student.studentId).catch(() => {});
                  }
                } catch {}
              }
            }

            const resolvedCohortId = student.role === 'teacher' ? null : (student.cohort_id || student.cohortId || null);
            const resolvedSemNum = parseSemesterNumber(student.semester || meta.semester) || 1;
            const resolvedSemester = student.role === 'teacher' ? null : (student.semester || `Semester ${resolvedSemNum}`);
            req.user = {
              supabaseUid,
              studentId: student.studentId,
              username: student.username || null,
              name: student.name,
              role: student.role || 'student',
              department: student.department || 'BIT',
              semester: resolvedSemester,
              cohortId: resolvedCohortId,
              cohort_id: resolvedCohortId,
              gender: student.gender || null,
              email: student.email || userEmail,
              avatarUrl: student.avatarUrl || null,
              verificationStatus: isEmailConfirmed ? 'verified' : (student.verificationStatus || student.verification_status || 'unverified')
            };

            // Maintain req.student and req.session compatibility
            req.student = req.user;
            if (!req.session) {
              req.session = {
                destroy: (cb) => { if (cb) cb(); },
                save: (cb) => { if (cb) cb(); },
                regenerate: (cb) => { if (cb) cb(); },
                reload: (cb) => { if (cb) cb(); }
              };
            }
            req.session.studentId = student.studentId;
            req.session.studentName = student.name;
            req.session.role = student.role || 'student';
          }
        }
      } catch (err) {
        console.error('[Auth Middleware] Supabase verification error:', err.message);
      }
    } else {
      // Optimized Mobile Bearer Token Authentication:
      // Consolidates token lookup + student profile into a single database round-trip
      try {
        const row = await db.get(
          `SELECT m.token, m.studentId, m.expiresAt,
                  s.username, s.name, s.role, s.department, s.semester, s.cohort_id,
                  s.gender, s.email, s.avatarUrl, s.verification_status, s.supabase_uid, s.account_status
           FROM mobile_tokens m
           LEFT JOIN students s ON s.studentId = m.studentId
           WHERE m.token = ?`,
          token
        );
        if (row) {
          const isSuspended = (row.account_status === 'suspended' || row.accountStatus === 'suspended');
          if (isSuspended) {
            req.isSuspended = true;
            req.user = null;
            req.student = null;
            db.run('DELETE FROM mobile_tokens WHERE token = ?', token).catch(() => {});
            return next();
          }
          const rawExpiry = row.expiresAt || row.expiresat;
          const expiresAt = new Date(rawExpiry).getTime();
          if (expiresAt > Date.now()) {
            const resolvedStudentId = row.studentId || row.studentid;
            if (row.name && resolvedStudentId) {
              const resolvedSupabaseUid = row.supabase_uid || row.supabaseUid || null;
              req.user = {
                studentId: resolvedStudentId,
                username: row.username || null,
                name: row.name,
                role: row.role || 'student',
                department: row.department || 'BIT',
                semester: row.role === 'teacher' ? null : (row.semester || 'Semester 1'),
                cohortId: row.role === 'teacher' ? null : (row.cohort_id || row.cohortId || null),
                cohort_id: row.role === 'teacher' ? null : (row.cohort_id || row.cohortId || null),
                gender: row.gender || null,
                email: row.email || null,
                avatarUrl: row.avatarUrl || row.avatarurl || null,
                verificationStatus: row.verificationStatus || row.verification_status || 'unverified',
                supabase_uid: resolvedSupabaseUid,
                supabaseUid: resolvedSupabaseUid,
              };
              req.student = req.user;
              req.mobileToken = token;
              if (!req.session) {
                req.session = {
                  destroy: (cb) => { if (cb) cb(); },
                  save: (cb) => { if (cb) cb(); },
                  regenerate: (cb) => { if (cb) cb(); },
                  reload: (cb) => { if (cb) cb(); }
                };
              }
              req.session.studentId = resolvedStudentId;
              req.session.studentName = row.name;
              req.session.role = row.role || 'student';
            }
          } else {
            db.run('DELETE FROM mobile_tokens WHERE token = ?', token).catch(() => {});
          }
        }
      } catch (err) {
        console.error('[Auth Middleware] Mobile auth error:', err.message);
      }
    }

    next();
  }

  function requireLogin(req, res, next) {
    if (req.isSuspended) {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }
    if (!req.user || !req.user.studentId) {
      return res.status(401).json({ message: 'Authentication required. Please sign in.' });
    }
    if (req.user.account_status === 'suspended' || req.user.accountStatus === 'suspended') {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }
    req.student = req.user;
    next();
  }

  function requireAdmin(req, res, next) {
    if (req.isSuspended) {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }
    next();
  }

  function requireTeacher(req, res, next) {
    if (req.isSuspended) {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }
    if (!req.user || (req.user.role !== 'teacher' && req.user.role !== 'admin')) {
      return res.status(403).json({ message: 'Forbidden: Faculty or Administrator access required' });
    }
    next();
  }

  return {
    authenticate,
    requireLogin,
    requireAdmin,
    requireTeacher,
  };
}

module.exports = {
  createAuthMiddleware,
};
