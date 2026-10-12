'use strict';

const express = require('express');
const { queryAdminAuditLogs, recordAdminAudit } = require('../lib/audit-service');
const { isModerationSchemaAvailable, isContentReportsAvailable } = require('../lib/posts');

function createAdminDashboardRouter(arg1, arg2) {
  let db, requireLogin;
  if (arg1 && arg1.db) {
    db = arg1.db;
    requireLogin = arg1.requireLogin || ((req, res, next) => next());
  } else {
    db = arg1;
    requireLogin = arg2 || ((req, res, next) => next());
  }

  const router = express.Router();

  // Strict Authoritative Admin Guard
  const requireAdminRole = async (req, res, next) => {
    const studentId = req.student?.studentId || req.user?.studentId || req.session?.studentId;
    if (!studentId) {
      return res.status(401).json({ message: 'Authentication required. Please sign in.' });
    }

    try {
      const student = await db.get(
        'SELECT studentId, role, name, email, department, avatarUrl, account_status FROM students WHERE studentId = ?',
        studentId
      );
      if (!student || student.role !== 'admin' || (student.account_status || 'active') === 'suspended') {
        return res.status(403).json({ message: 'Forbidden: Administrator access required.' });
      }
      req.adminStudentId = student.studentId;
      req.adminUser = student;
      next();
    } catch (err) {
      console.error('[Admin Auth Guard Error]:', err);
      return res.status(500).json({ message: 'Authorization verification failed.' });
    }
  };

  /**
   * 1. GET /api/admin/overview
   * Efficient aggregate metrics across users, content, materials, and cohorts.
   */
  router.get('/overview', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const [
        studentsCountRow,
        teachersCountRow,
        crsCountRow,
        adminsCountRow,
        postsCountRow,
        noticesCountRow,
        filesCountRow,
        assignmentsCountRow,
        activeCohortsCountRow,
        pendingInvitesCountRow
      ] = await Promise.all([
        db.get("SELECT COUNT(*) AS count FROM students WHERE COALESCE(role, 'student') = 'student'"),
        db.get("SELECT COUNT(*) AS count FROM students WHERE role = 'teacher'"),
        db.get("SELECT COUNT(*) AS count FROM students WHERE role = 'cr'"),
        db.get("SELECT COUNT(*) AS count FROM students WHERE role = 'admin'"),
        db.get("SELECT COUNT(*) AS count FROM posts").catch(() => ({ count: 0 })),
        db.get("SELECT COUNT(*) AS count FROM posts WHERE type = 'notice' OR category = 'notice'").catch(() => ({ count: 0 })),
        db.get("SELECT COUNT(*) AS count FROM files").catch(() => ({ count: 0 })),
        db.get("SELECT COUNT(*) AS count FROM assignments").catch(() => ({ count: 0 })),
        db.get("SELECT COUNT(*) AS count FROM cohorts WHERE status = 'active'").catch(() => ({ count: 0 })),
        db.get("SELECT COUNT(*) AS count FROM teacher_invites WHERE status = 'pending'").catch(() => ({ count: 0 }))
      ]);

      const counts = {
        students: Number(studentsCountRow?.count || 0),
        teachers: Number(teachersCountRow?.count || 0),
        crs: Number(crsCountRow?.count || 0),
        admins: Number(adminsCountRow?.count || 0),
        posts: Number(postsCountRow?.count || 0),
        notices: Number(noticesCountRow?.count || 0),
        materials: Number(filesCountRow?.count || 0),
        assignments: Number(assignmentsCountRow?.count || 0),
        activeCohorts: Number(activeCohortsCountRow?.count || 0),
        pendingTeacherInvites: Number(pendingInvitesCountRow?.count || 0),
        totalUsers: Number(studentsCountRow?.count || 0) +
                    Number(teachersCountRow?.count || 0) +
                    Number(crsCountRow?.count || 0) +
                    Number(adminsCountRow?.count || 0)
      };

      res.json({
        counts,
        admin: {
          studentId: req.adminUser.studentId,
          name: req.adminUser.name,
          email: req.adminUser.email,
          role: req.adminUser.role,
          department: req.adminUser.department,
          avatarUrl: req.adminUser.avatarUrl
        },
        system: {
          nodeEnv: process.env.NODE_ENV || 'development',
          timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      console.error('[Admin Overview Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve administrative overview.' });
    }
  });

  /**
   * 2. GET /api/admin/users
   * Paginated, search-supported user directory.
   * Strictly filters out passwordHash, supabase_uid, tokens, and private messages.
   */
  router.get('/users', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = (page - 1) * limit;

      const roleFilter = req.query.role ? String(req.query.role).trim().toLowerCase() : null;
      const semesterFilter = req.query.semester ? String(req.query.semester).trim() : null;
      const search = req.query.search ? String(req.query.search).trim() : null;

      const statusFilter = req.query.status ? String(req.query.status).trim().toLowerCase() : null;

      const whereClauses = [];
      const params = [];

      if (statusFilter && ['active', 'suspended'].includes(statusFilter)) {
        whereClauses.push("COALESCE(s.account_status, 'active') = ?");
        params.push(statusFilter);
      }

      if (roleFilter && ['student', 'teacher', 'cr', 'admin'].includes(roleFilter)) {
        if (roleFilter === 'student') {
          whereClauses.push("COALESCE(s.role, 'student') = 'student'");
        } else {
          whereClauses.push("s.role = ?");
          params.push(roleFilter);
        }
      }

      if (semesterFilter && semesterFilter !== 'all') {
        whereClauses.push("(s.semester = ? OR s.semester = ?)");
        params.push(semesterFilter, `Semester ${semesterFilter}`);
      }

      if (search) {
        whereClauses.push("(s.name LIKE ? OR s.studentId LIKE ? OR s.email LIKE ? OR s.username LIKE ?)");
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      // Count total matches
      const countSql = `SELECT COUNT(*) AS total FROM students s ${whereSql}`;
      const countRow = await db.get(countSql, ...params);
      const total = Number(countRow?.total || 0);
      const totalPages = Math.ceil(total / limit) || 1;

      // Select safe, paginated user rows
      const querySql = `
        SELECT s.studentId, s.name, s.email, s.username, s.gender, s.avatarUrl,
               s.department, s.semester, COALESCE(s.role, 'student') AS role,
               s.verification_status, s.cohort_id, s.created_at,
               COALESCE(s.account_status, 'active') AS account_status,
               c.slot_code AS cohort_slot, c.display_name AS cohort_name
        FROM students s
        LEFT JOIN cohorts c ON c.id = s.cohort_id
        ${whereSql}
        ORDER BY s.created_at DESC
        LIMIT ? OFFSET ?
      `;

      const users = await db.all(querySql, ...params, limit, offset);

      res.json({
        users: (users || []).map(u => ({
          ...u,
          accountStatus: u.account_status || 'active'
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      });
    } catch (err) {
      console.error('[Admin Users Directory Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve users directory.' });
    }
  });

  /**
   * 2a. GET /api/admin/users/:studentId/status
   * Retrieve authoritative account status for a specific user.
   */
  router.get('/users/:studentId/status', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const targetId = (req.params.studentId || '').trim();
      if (!targetId) {
        return res.status(400).json({ message: 'Target student ID is required.' });
      }

      const user = await db.get(
        `SELECT studentId, username, name, email, role, department, semester,
                COALESCE(account_status, 'active') AS account_status,
                created_at, updated_at
         FROM students
         WHERE studentId = ?`,
        targetId
      );

      if (!user) {
        return res.status(404).json({ message: 'User account not found.' });
      }

      res.json({
        studentId: user.studentId,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        semester: user.semester,
        accountStatus: user.account_status,
        isSuspended: user.account_status === 'suspended',
        createdAt: user.created_at,
        updatedAt: user.updated_at
      });
    } catch (err) {
      console.error('[Admin User Status Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve account status.' });
    }
  });

  /**
   * 2b. POST /api/admin/users/:studentId/suspend
   * Transactionally suspend an active Student, CR, or Teacher account with audited reason.
   */
  router.post('/users/:studentId/suspend', requireLogin, requireAdminRole, async (req, res) => {
    const targetId = (req.params.studentId || '').trim();
    const reason = (req.body.reason || '').trim();

    if (!targetId) {
      return res.status(400).json({ message: 'Target student ID is required.' });
    }

    if (!reason || reason.length < 3) {
      return res.status(400).json({ message: 'A valid suspension reason (at least 3 characters) is required.' });
    }

    // Administrators cannot suspend their own account
    if (targetId === req.adminStudentId) {
      return res.status(400).json({ message: 'Administrators cannot suspend their own account.' });
    }

    try {
      const runSuspend = async (tx) => {
        const user = await tx.get(
          `SELECT studentId, username, name, email, role,
                  COALESCE(account_status, 'active') AS account_status
           FROM students
           WHERE studentId = ?`,
          targetId
        );

        if (!user) {
          const notFoundErr = new Error('User account not found.');
          notFoundErr.statusCode = 404;
          throw notFoundErr;
        }

        // Administrator accounts cannot be suspended
        if (user.role === 'admin') {
          const adminErr = new Error('Administrator accounts cannot be suspended.');
          adminErr.statusCode = 400;
          throw adminErr;
        }

        // Account must currently be active
        if (user.account_status === 'suspended') {
          const conflictErr = new Error('Account is already suspended.');
          conflictErr.statusCode = 409;
          throw conflictErr;
        }

        // 1. Update account status
        await tx.run(
          `UPDATE students SET account_status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE studentId = ?`,
          targetId
        );

        // 2. Revoke active mobile bearer tokens immediately
        try {
          await tx.run('DELETE FROM mobile_tokens WHERE studentId = ?', targetId);
        } catch (_) {}

        // 3. Best-effort active session invalidation in session store
        try {
          if (tx.isPostgres) {
            await tx.run(`DELETE FROM session WHERE sess::text LIKE '%"studentId":"' || $1 || '"%'`, targetId);
          } else {
            await tx.run(`DELETE FROM session WHERE sess LIKE '%"studentId":"' || ? || '"%'`, targetId);
          }
        } catch (_) {}

        // 4. Record immutable administrative audit record within the exact same database transaction
        await recordAdminAudit(tx, {
          actorUserId: req.adminStudentId,
          action: 'account_suspended',
          entityType: 'account',
          entityId: targetId,
          beforeState: {
            account_status: user.account_status,
            role: user.role
          },
          afterState: {
            account_status: 'suspended',
            role: user.role
          },
          metadata: {
            reason,
            targetRole: user.role,
            targetUsername: user.username || null,
            targetName: user.name || null
          },
          required: true,
          tx
        });

        return user;
      };

      const suspendedUser = typeof db.withTransaction === 'function'
        ? await db.withTransaction(runSuspend)
        : await runSuspend(db);

      res.json({
        success: true,
        message: `Account for ${suspendedUser.name} (${suspendedUser.role}) has been suspended.`,
        studentId: targetId,
        accountStatus: 'suspended'
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      console.error('[Admin Suspend Account Error]:', err);
      res.status(500).json({ message: err.message || 'Failed to suspend user account.' });
    }
  });

  /**
   * 2c. POST /api/admin/users/:studentId/reactivate
   * Transactionally reactivate a suspended account with audited reason.
   */
  router.post('/users/:studentId/reactivate', requireLogin, requireAdminRole, async (req, res) => {
    const targetId = (req.params.studentId || '').trim();
    const reason = (req.body.reason || '').trim();

    if (!targetId) {
      return res.status(400).json({ message: 'Target student ID is required.' });
    }

    try {
      const runReactivate = async (tx) => {
        const user = await tx.get(
          `SELECT studentId, username, name, email, role,
                  COALESCE(account_status, 'active') AS account_status
           FROM students
           WHERE studentId = ?`,
          targetId
        );

        if (!user) {
          const notFoundErr = new Error('User account not found.');
          notFoundErr.statusCode = 404;
          throw notFoundErr;
        }

        // Account must currently be suspended
        if (user.account_status !== 'suspended') {
          const conflictErr = new Error('Account is not suspended.');
          conflictErr.statusCode = 409;
          throw conflictErr;
        }

        // 1. Update account status back to active
        await tx.run(
          `UPDATE students SET account_status = 'active', updated_at = CURRENT_TIMESTAMP WHERE studentId = ?`,
          targetId
        );

        // 2. Record immutable administrative audit record within the exact same database transaction
        await recordAdminAudit(tx, {
          actorUserId: req.adminStudentId,
          action: 'account_reactivated',
          entityType: 'account',
          entityId: targetId,
          beforeState: {
            account_status: 'suspended',
            role: user.role
          },
          afterState: {
            account_status: 'active',
            role: user.role
          },
          metadata: {
            reason: reason || 'Reactivated by administrator',
            targetRole: user.role,
            targetUsername: user.username || null,
            targetName: user.name || null
          },
          required: true,
          tx
        });

        return user;
      };

      const reactivatedUser = typeof db.withTransaction === 'function'
        ? await db.withTransaction(runReactivate)
        : await runReactivate(db);

      res.json({
        success: true,
        message: `Account for ${reactivatedUser.name} (${reactivatedUser.role}) has been reactivated.`,
        studentId: targetId,
        accountStatus: 'active'
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      console.error('[Admin Reactivate Account Error]:', err);
      res.status(500).json({ message: err.message || 'Failed to reactivate user account.' });
    }
  });

  /**
   * 2d. GET /api/admin/users/:studentId/suspension-history
   * Retrieve suspension & reactivation audit history for a specific account.
   */
  router.get('/users/:studentId/suspension-history', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const targetId = (req.params.studentId || '').trim();
      if (!targetId) {
        return res.status(400).json({ message: 'Target student ID is required.' });
      }

      const user = await db.get('SELECT studentId, name, role FROM students WHERE studentId = ?', targetId);
      if (!user) {
        return res.status(404).json({ message: 'User account not found.' });
      }

      const historyRows = await db.all(
        `SELECT a.id, a.actor_user_id, a.action, a.entity_id, a.metadata,
                a.before_state, a.after_state, a.created_at,
                s.name AS actor_name, s.role AS actor_role
         FROM admin_audit_logs a
         LEFT JOIN students s ON s.studentId = a.actor_user_id
         WHERE a.entity_type = 'account' AND a.entity_id = ? AND a.action IN ('account_suspended', 'account_reactivated')
         ORDER BY a.created_at DESC`,
        targetId
      ).catch(() => []);

      const history = (historyRows || []).map(row => {
        let meta = null;
        let before = null;
        let after = null;
        try { meta = row.metadata ? (typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata)) : null; } catch (_) {}
        try { before = row.before_state ? (typeof row.before_state === 'object' ? row.before_state : JSON.parse(row.before_state)) : null; } catch (_) {}
        try { after = row.after_state ? (typeof row.after_state === 'object' ? row.after_state : JSON.parse(row.after_state)) : null; } catch (_) {}

        return {
          id: row.id,
          action: row.action,
          actorUserId: row.actor_user_id,
          actorName: row.actor_name || row.actor_user_id,
          actorRole: row.actor_role || 'admin',
          reason: meta?.reason || null,
          beforeStatus: before?.account_status || null,
          afterStatus: after?.account_status || null,
          createdAt: row.created_at
        };
      });

      res.json({
        studentId: targetId,
        user: { name: user.name, role: user.role },
        history
      });
    } catch (err) {
      console.error('[Admin Suspension History Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve suspension history.' });
    }
  });

  /**
   * 2e. GET /api/admin/cr
   * List all current Class Representative accounts.
   */
  router.get('/cr', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const crs = await db.all(`
        SELECT s.studentId, s.username, s.name, s.email, s.department, s.semester, s.cohort_id,
               COALESCE(s.account_status, 'active') AS account_status,
               s.created_at, s.updated_at,
               c.slot_code AS cohort_slot, c.display_name AS cohort_name
        FROM students s
        LEFT JOIN cohorts c ON c.id = s.cohort_id
        WHERE s.role = 'cr' OR s.role = 'class_rep'
        ORDER BY s.name ASC
      `);

      res.json({
        success: true,
        count: (crs || []).length,
        crs: (crs || []).map(c => ({
          studentId: c.studentId,
          username: c.username,
          name: c.name,
          email: c.email,
          role: 'cr',
          department: c.department || 'BIT',
          semester: c.semester || 'Semester 1',
          cohortId: c.cohort_id,
          cohortSlot: c.cohort_slot ? c.cohort_slot.toUpperCase() : null,
          cohortName: c.cohort_name || null,
          accountStatus: c.account_status || 'active',
          isSuspended: c.account_status === 'suspended',
          createdAt: c.created_at,
          updatedAt: c.updated_at
        }))
      });
    } catch (err) {
      console.error('[Admin List CRs Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve Class Representative accounts.' });
    }
  });

  /**
   * 2f. GET /api/admin/users/:studentId/role
   * View student/CR role details and promotion/demotion eligibility.
   */
  router.get('/users/:studentId/role', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const targetId = (req.params.studentId || '').trim();
      if (!targetId) {
        return res.status(400).json({ message: 'Target student ID is required.' });
      }

      const user = await db.get(
        `SELECT studentId, username, name, email, role, department, semester, cohort_id,
                COALESCE(account_status, 'active') AS account_status,
                created_at, updated_at
         FROM students
         WHERE studentId = ?`,
        targetId
      );

      if (!user) {
        return res.status(404).json({ message: 'User account not found.' });
      }

      const currentRole = user.role || 'student';
      const isSuspended = user.account_status === 'suspended';
      const isStudent = currentRole === 'student';
      const isCR = currentRole === 'cr' || currentRole === 'class_rep';
      const isTeacher = currentRole === 'teacher';
      const isAdmin = currentRole === 'admin';

      const isEligibleForPromotion = isStudent && !isSuspended;
      const isEligibleForDemotion = isCR && !isSuspended;

      res.json({
        studentId: user.studentId,
        username: user.username,
        name: user.name,
        email: user.email,
        role: currentRole,
        accountStatus: user.account_status,
        isSuspended,
        isStudent,
        isCR,
        isTeacher,
        isAdmin,
        isEligibleForPromotion,
        isEligibleForDemotion,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      });
    } catch (err) {
      console.error('[Admin User Role Details Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve user role details.' });
    }
  });

  /**
   * 2g. POST /api/admin/users/:studentId/promote-cr
   * Transactionally promote an active Student account to Class Representative (CR).
   */
  router.post('/users/:studentId/promote-cr', requireLogin, requireAdminRole, async (req, res) => {
    const targetId = (req.params.studentId || '').trim();
    const reason = (req.body.reason || '').trim();

    if (!targetId) {
      return res.status(400).json({ message: 'Target student ID is required.' });
    }

    if (!reason || reason.length < 3) {
      return res.status(400).json({ message: 'A valid promotion reason (at least 3 characters) is required.' });
    }

    // Administrators cannot modify their own account role via student management
    if (targetId === req.adminStudentId) {
      return res.status(400).json({ message: 'Administrators cannot modify their own account role via student management.' });
    }

    try {
      const runPromote = async (tx) => {
        const user = await tx.get(
          `SELECT studentId, username, name, email, role, department, semester, cohort_id,
                  COALESCE(account_status, 'active') AS account_status
           FROM students
           WHERE studentId = ?`,
          targetId
        );

        if (!user) {
          const notFoundErr = new Error('User account not found.');
          notFoundErr.statusCode = 404;
          throw notFoundErr;
        }

        if (user.role === 'admin') {
          const adminErr = new Error('Administrator accounts cannot be modified via student role management.');
          adminErr.statusCode = 400;
          throw adminErr;
        }

        if (user.role === 'teacher') {
          const teacherErr = new Error('Faculty/Teacher accounts cannot be promoted to Class Representative.');
          teacherErr.statusCode = 400;
          throw teacherErr;
        }

        if (user.account_status === 'suspended') {
          const suspErr = new Error('Suspended accounts cannot be promoted. Reactivate the account first.');
          suspErr.statusCode = 400;
          throw suspErr;
        }

        if (user.role === 'cr' || user.role === 'class_rep') {
          const conflictErr = new Error('User is already a Class Representative.');
          conflictErr.statusCode = 409;
          throw conflictErr;
        }

        if (user.role && user.role !== 'student') {
          const invalidRoleErr = new Error(`Invalid role transition: cannot promote user with role '${user.role}' to Class Representative.`);
          invalidRoleErr.statusCode = 400;
          throw invalidRoleErr;
        }

        // 1. Update role to canonical 'cr' strictly preserving all other student columns
        await tx.run(
          `UPDATE students SET role = 'cr', updated_at = CURRENT_TIMESTAMP WHERE studentId = ?`,
          targetId
        );

        // 2. Best-effort session update for active Express sessions
        try {
          if (tx.isPostgres) {
            await tx.run(`UPDATE session SET sess = jsonb_set(sess::jsonb, '{role}', '"cr"') WHERE sess::text LIKE '%"studentId":"' || $1 || '"%'`, targetId);
          }
        } catch (_) {}

        // 3. Record immutable administrative audit record within the exact same database transaction
        await recordAdminAudit(tx, {
          actorUserId: req.adminStudentId,
          action: 'student_promoted_to_cr',
          entityType: 'account',
          entityId: targetId,
          beforeState: {
            role: user.role || 'student',
            account_status: user.account_status
          },
          afterState: {
            role: 'cr',
            account_status: user.account_status
          },
          metadata: {
            reason,
            previousRole: user.role || 'student',
            newRole: 'cr',
            targetStudentId: targetId,
            targetName: user.name || null,
            targetUsername: user.username || null,
            adminId: req.adminStudentId
          },
          required: true,
          tx
        });

        return user;
      };

      const promotedUser = typeof db.withTransaction === 'function'
        ? await db.withTransaction(runPromote)
        : await runPromote(db);

      res.json({
        success: true,
        message: `Student ${promotedUser.name} successfully promoted to Class Representative.`,
        studentId: targetId,
        previousRole: promotedUser.role || 'student',
        role: 'cr'
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      console.error('[Admin Promote to CR Error]:', err);
      res.status(500).json({ message: err.message || 'Failed to promote student to Class Representative.' });
    }
  });

  /**
   * 2h. POST /api/admin/users/:studentId/demote-student
   * Transactionally demote a Class Representative (CR) back to regular Student role.
   */
  router.post('/users/:studentId/demote-student', requireLogin, requireAdminRole, async (req, res) => {
    const targetId = (req.params.studentId || '').trim();
    const reason = (req.body.reason || '').trim();

    if (!targetId) {
      return res.status(400).json({ message: 'Target student ID is required.' });
    }

    if (!reason || reason.length < 3) {
      return res.status(400).json({ message: 'A valid demotion reason (at least 3 characters) is required.' });
    }

    // Administrators cannot change their own role via student role management
    if (targetId === req.adminStudentId) {
      return res.status(400).json({ message: 'Administrators cannot modify their own account role via student management.' });
    }

    try {
      const runDemote = async (tx) => {
        const user = await tx.get(
          `SELECT studentId, username, name, email, role, department, semester, cohort_id,
                  COALESCE(account_status, 'active') AS account_status
           FROM students
           WHERE studentId = ?`,
          targetId
        );

        if (!user) {
          const notFoundErr = new Error('User account not found.');
          notFoundErr.statusCode = 404;
          throw notFoundErr;
        }

        if (user.role === 'admin') {
          const adminErr = new Error('Administrator accounts cannot be modified via student role management.');
          adminErr.statusCode = 400;
          throw adminErr;
        }

        if (user.role === 'teacher') {
          const teacherErr = new Error('Faculty/Teacher accounts cannot be demoted via student role management.');
          teacherErr.statusCode = 400;
          throw teacherErr;
        }

        if (user.account_status === 'suspended') {
          const suspErr = new Error('Suspended accounts cannot have their roles modified. Reactivate the account first.');
          suspErr.statusCode = 400;
          throw suspErr;
        }

        if (user.role === 'student' || !user.role) {
          const conflictErr = new Error('User is already a regular student.');
          conflictErr.statusCode = 409;
          throw conflictErr;
        }

        if (user.role !== 'cr' && user.role !== 'class_rep') {
          const invalidRoleErr = new Error(`Invalid role transition: cannot demote user with role '${user.role}' to regular student.`);
          invalidRoleErr.statusCode = 400;
          throw invalidRoleErr;
        }

        // 1. Update role to canonical 'student' strictly preserving all other student columns
        await tx.run(
          `UPDATE students SET role = 'student', updated_at = CURRENT_TIMESTAMP WHERE studentId = ?`,
          targetId
        );

        // 2. Best-effort session update for active Express sessions
        try {
          if (tx.isPostgres) {
            await tx.run(`UPDATE session SET sess = jsonb_set(sess::jsonb, '{role}', '"student"') WHERE sess::text LIKE '%"studentId":"' || $1 || '"%'`, targetId);
          }
        } catch (_) {}

        // 3. Record immutable administrative audit record within the exact same database transaction
        await recordAdminAudit(tx, {
          actorUserId: req.adminStudentId,
          action: 'cr_demoted_to_student',
          entityType: 'account',
          entityId: targetId,
          beforeState: {
            role: user.role,
            account_status: user.account_status
          },
          afterState: {
            role: 'student',
            account_status: user.account_status
          },
          metadata: {
            reason,
            previousRole: user.role,
            newRole: 'student',
            targetStudentId: targetId,
            targetName: user.name || null,
            targetUsername: user.username || null,
            adminId: req.adminStudentId
          },
          required: true,
          tx
        });

        return user;
      };

      const demotedUser = typeof db.withTransaction === 'function'
        ? await db.withTransaction(runDemote)
        : await runDemote(db);

      res.json({
        success: true,
        message: `Class Representative ${demotedUser.name} successfully demoted to regular Student.`,
        studentId: targetId,
        previousRole: demotedUser.role,
        role: 'student'
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      console.error('[Admin Demote to Student Error]:', err);
      res.status(500).json({ message: err.message || 'Failed to demote Class Representative to Student.' });
    }
  });

  /**
   * 2i. GET /api/admin/users/:studentId/role-history
   * Retrieve role transition audit history for a specific account.
   */
  router.get('/users/:studentId/role-history', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const targetId = (req.params.studentId || '').trim();
      if (!targetId) {
        return res.status(400).json({ message: 'Target student ID is required.' });
      }

      const user = await db.get('SELECT studentId, name, role FROM students WHERE studentId = ?', targetId);
      if (!user) {
        return res.status(404).json({ message: 'User account not found.' });
      }

      const historyRows = await db.all(
        `SELECT a.id, a.actor_user_id, a.action, a.entity_id, a.metadata,
                a.before_state, a.after_state, a.created_at,
                s.name AS actor_name, s.role AS actor_role
         FROM admin_audit_logs a
         LEFT JOIN students s ON s.studentId = a.actor_user_id
         WHERE a.entity_type = 'account' AND a.entity_id = ? AND a.action IN ('student_promoted_to_cr', 'cr_demoted_to_student')
         ORDER BY a.created_at DESC`,
        targetId
      ).catch(() => []);

      const history = (historyRows || []).map(row => {
        let meta = null;
        let before = null;
        let after = null;
        try { meta = row.metadata ? (typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata)) : null; } catch (_) {}
        try { before = row.before_state ? (typeof row.before_state === 'object' ? row.before_state : JSON.parse(row.before_state)) : null; } catch (_) {}
        try { after = row.after_state ? (typeof row.after_state === 'object' ? row.after_state : JSON.parse(row.after_state)) : null; } catch (_) {}

        return {
          id: row.id,
          action: row.action,
          actorUserId: row.actor_user_id,
          actorName: row.actor_name || row.actor_user_id,
          actorRole: row.actor_role || 'admin',
          reason: meta?.reason || null,
          previousRole: before?.role || null,
          newRole: after?.role || null,
          createdAt: row.created_at
        };
      });

      res.json({
        studentId: targetId,
        user: { name: user.name, role: user.role },
        history
      });
    } catch (err) {
      console.error('[Admin Role History Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve role-change history.' });
    }
  });

  /**
   * 2j. GET /api/admin/roles/history
   * Retrieve platform-wide role transition audit history.
   */
  router.get('/roles/history', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = (page - 1) * limit;

      const countRow = await db.get(
        `SELECT COUNT(*) AS total
         FROM admin_audit_logs
         WHERE action IN ('student_promoted_to_cr', 'cr_demoted_to_student')`
      ).catch(() => ({ total: 0 }));
      const total = Number(countRow?.total || 0);
      const totalPages = Math.ceil(total / limit) || 1;

      const historyRows = await db.all(
        `SELECT a.id, a.actor_user_id, a.action, a.entity_id, a.metadata,
                a.before_state, a.after_state, a.created_at,
                s.name AS actor_name, s.role AS actor_role,
                t.name AS target_name
         FROM admin_audit_logs a
         LEFT JOIN students s ON s.studentId = a.actor_user_id
         LEFT JOIN students t ON t.studentId = a.entity_id
         WHERE a.action IN ('student_promoted_to_cr', 'cr_demoted_to_student')
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`,
        limit, offset
      ).catch(() => []);

      const history = (historyRows || []).map(row => {
        let meta = null;
        let before = null;
        let after = null;
        try { meta = row.metadata ? (typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata)) : null; } catch (_) {}
        try { before = row.before_state ? (typeof row.before_state === 'object' ? row.before_state : JSON.parse(row.before_state)) : null; } catch (_) {}
        try { after = row.after_state ? (typeof row.after_state === 'object' ? row.after_state : JSON.parse(row.after_state)) : null; } catch (_) {}

        return {
          id: row.id,
          action: row.action,
          targetStudentId: row.entity_id,
          targetName: row.target_name || meta?.targetName || row.entity_id,
          actorUserId: row.actor_user_id,
          actorName: row.actor_name || row.actor_user_id,
          actorRole: row.actor_role || 'admin',
          reason: meta?.reason || null,
          previousRole: before?.role || null,
          newRole: after?.role || null,
          createdAt: row.created_at
        };
      });

      res.json({
        history,
        pagination: { page, limit, total, totalPages }
      });
    } catch (err) {
      console.error('[Admin Platform Role History Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve role changes history.' });
    }
  });

  /**
   * 3. GET /api/admin/academics
   * Cross-semester academic structure, subject aggregates, notes counts, and assignment counts.
   */
  router.get('/academics', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const [subjectsRows, filesRows, assignmentsRows] = await Promise.all([
        db.all("SELECT semester, COUNT(*) AS count FROM subjects WHERE is_active = 1 GROUP BY semester").catch(() => []),
        db.all("SELECT semester, COUNT(*) AS count FROM files GROUP BY semester").catch(() => []),
        db.all("SELECT semester, COUNT(*) AS count FROM assignments GROUP BY semester").catch(() => [])
      ]);

      const semesterStats = [];
      for (let sem = 1; sem <= 8; sem++) {
        const semStr = String(sem);
        const fullSemStr = `Semester ${sem}`;

        const subMatch = (subjectsRows || []).find(r => String(r.semester) === semStr || String(r.semester) === fullSemStr);
        const fileMatch = (filesRows || []).find(r => String(r.semester) === semStr || String(r.semester) === fullSemStr || String(r.semester).toLowerCase() === `sem ${sem}`);
        const assignMatch = (assignmentsRows || []).find(r => String(r.semester) === semStr || String(r.semester) === fullSemStr || String(r.semester).toLowerCase() === `sem ${sem}`);

        semesterStats.push({
          semester: sem,
          label: `Semester ${sem}`,
          subjectsCount: Number(subMatch?.count || 0),
          materialsCount: Number(fileMatch?.count || 0),
          assignmentsCount: Number(assignMatch?.count || 0)
        });
      }

      const totalSubjects = (subjectsRows || []).reduce((acc, r) => acc + Number(r.count || 0), 0);
      const totalMaterials = (filesRows || []).reduce((acc, r) => acc + Number(r.count || 0), 0);
      const totalAssignments = (assignmentsRows || []).reduce((acc, r) => acc + Number(r.count || 0), 0);

      res.json({
        semesters: semesterStats,
        totals: {
          subjects: totalSubjects,
          materials: totalMaterials,
          assignments: totalAssignments
        }
      });
    } catch (err) {
      console.error('[Admin Academics Overview Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve academic overview.' });
    }
  });

  /**
   * 4. GET /api/admin/academics/materials
   * Paginated study materials across all semesters.
   */
  router.get('/academics/materials', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = (page - 1) * limit;

      const semester = req.query.semester ? String(req.query.semester).trim() : null;
      const search = req.query.search ? String(req.query.search).trim() : null;

      const whereClauses = [];
      const params = [];

      if (semester && semester !== 'all') {
        whereClauses.push("(f.semester = ? OR f.semester = ? OR f.semester = ?)");
        params.push(semester, `Semester ${semester}`, `Sem ${semester}`);
      }

      if (search) {
        whereClauses.push("(f.title LIKE ? OR f.originalName LIKE ? OR f.subject LIKE ? OR f.uploadedBy LIKE ?)");
        const p = `%${search}%`;
        params.push(p, p, p, p);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const countRow = await db.get(`SELECT COUNT(*) AS total FROM files f ${whereSql}`, ...params);
      const total = Number(countRow?.total || 0);
      const totalPages = Math.ceil(total / limit) || 1;

      const files = await db.all(`
        SELECT f.id, f.title, f.originalName, f.storedName, f.subject, f.chapter,
               f.semester, f.uploadedBy, f.sizeBytes, f.uploadedAt,
               s.name AS uploader_name, s.role AS uploader_role
        FROM files f
        LEFT JOIN students s ON s.studentId = f.uploadedBy
        ${whereSql}
        ORDER BY f.uploadedAt DESC
        LIMIT ? OFFSET ?
      `, ...params, limit, offset);

      res.json({
        materials: files || [],
        pagination: { page, limit, total, totalPages }
      });
    } catch (err) {
      console.error('[Admin Materials Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve materials list.' });
    }
  });

  /**
   * 5. GET /api/admin/academics/assignments
   * Paginated assignments across all semesters.
   */
  router.get('/academics/assignments', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = (page - 1) * limit;

      const semester = req.query.semester ? String(req.query.semester).trim() : null;
      const search = req.query.search ? String(req.query.search).trim() : null;

      const whereClauses = [];
      const params = [];

      if (semester && semester !== 'all') {
        whereClauses.push("(a.semester = ? OR a.semester = ?)");
        params.push(semester, `Semester ${semester}`);
      }

      if (search) {
        whereClauses.push("(a.title LIKE ? OR a.subject LIKE ? OR a.createdBy LIKE ?)");
        const p = `%${search}%`;
        params.push(p, p, p);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const countRow = await db.get(`SELECT COUNT(*) AS total FROM assignments a ${whereSql}`, ...params);
      const total = Number(countRow?.total || 0);
      const totalPages = Math.ceil(total / limit) || 1;

      const assignments = await db.all(`
        SELECT a.id, a.title, a.description, a.language, a.subject, a.semester,
               a.deadline, a.createdBy, a.createdAt,
               s.name AS author_name, s.role AS author_role,
               (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignmentId = a.id) AS question_count,
               (SELECT COUNT(DISTINCT sub.studentId) FROM submissions sub WHERE sub.assignmentId = a.id) AS submission_count
        FROM assignments a
        LEFT JOIN students s ON s.studentId = a.createdBy
        ${whereSql}
        ORDER BY a.createdAt DESC
        LIMIT ? OFFSET ?
      `, ...params, limit, offset);

      res.json({
        assignments: assignments || [],
        pagination: { page, limit, total, totalPages }
      });
    } catch (err) {
      console.error('[Admin Assignments Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve assignments list.' });
    }
  });

  /**
   * 6. GET /api/admin/content
   * Administrative feed oversight with separate flags for student-only cohort posts
   * and official circulars. No private DM content is accessible.
   */
  router.get('/content', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = (page - 1) * limit;

      const category = req.query.category ? String(req.query.category).trim() : null;
      const type = req.query.type ? String(req.query.type).trim() : null;
      const audience = req.query.audience ? String(req.query.audience).trim() : null;
      const visibility = req.query.visibility ? String(req.query.visibility).trim() : null;
      const status = req.query.status ? String(req.query.status).trim().toLowerCase() : null;
      const search = req.query.search ? String(req.query.search).trim() : null;

      const whereClauses = [];
      const params = [];

      if (category && category !== 'all') {
        whereClauses.push("p.category = ?");
        params.push(category.toLowerCase());
      }

      if (type && type !== 'all') {
        whereClauses.push("p.type = ?");
        params.push(type.toLowerCase());
      }

      if (audience && audience !== 'all') {
        whereClauses.push("p.audience_scope = ?");
        params.push(audience.toLowerCase());
      }

      if (visibility && visibility !== 'all') {
        whereClauses.push("p.visibility = ?");
        params.push(visibility.toLowerCase());
      }

      const modAvail = await isModerationSchemaAvailable(db);
      const reportsAvail = await isContentReportsAvailable(db);

      if (status && status !== 'all') {
        if (modAvail) {
          whereClauses.push("COALESCE(p.moderation_status, 'active') = ?");
          params.push(status);
        } else if (status === 'removed') {
          whereClauses.push("1 = 0");
        }
      }

      if (search) {
        whereClauses.push("(p.content LIKE ? OR p.user_id LIKE ? OR s.name LIKE ?)");
        const p = `%${search}%`;
        params.push(p, p, p);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const countRow = await db.get(`
        SELECT COUNT(*) AS total
        FROM posts p
        LEFT JOIN students s ON s.studentId = p.user_id
        ${whereSql}
      `, ...params);

      const total = Number(countRow?.total || 0);
      const totalPages = Math.ceil(total / limit) || 1;

      const modCols = modAvail
        ? `COALESCE(p.moderation_status, 'active') AS moderation_status,
           p.moderated_at, p.moderated_by, p.moderation_reason,`
        : `'active' AS moderation_status,
           NULL AS moderated_at, NULL AS moderated_by, NULL AS moderation_reason,`;

      const commentsCountSql = modAvail
        ? `COALESCE((SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id AND pc.deleted_at IS NULL AND (pc.moderation_status IS NULL OR pc.moderation_status = 'active')), 0) AS comments_count,`
        : `COALESCE((SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id AND pc.deleted_at IS NULL), 0) AS comments_count,`;

      const reportsCountSql = reportsAvail
        ? `COALESCE((SELECT COUNT(*) FROM content_reports cr WHERE cr.content_type = 'post' AND cr.content_id = p.id AND cr.status = 'open'), 0) AS open_reports_count,
           COALESCE((SELECT COUNT(*) FROM content_reports cr WHERE cr.content_type = 'post' AND cr.content_id = p.id), 0) AS total_reports_count`
        : `0 AS open_reports_count,
           0 AS total_reports_count`;

      const posts = await db.all(`
        SELECT p.id, p.user_id, p.title, p.content, p.type, p.category,
               COALESCE(p.visibility, 'everyone') AS visibility,
               CASE WHEN (p.type = 'notice' OR p.category = 'notice') AND s.role IN ('admin', 'cr', 'teacher') THEN 1 ELSE 0 END AS is_official,
               p.target_all_semesters, p.audience_scope,
               ${modCols}
               p.attachment_url, p.created_at, p.edited_at,
               s.name AS author_name, s.role AS author_role, s.avatarUrl AS author_avatar_url,
               COALESCE((SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id), 0) AS likes_count,
               ${commentsCountSql}
               ${reportsCountSql}
        FROM posts p
        LEFT JOIN students s ON s.studentId = p.user_id
        ${whereSql}
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `, ...params, limit, offset);

      const formattedPosts = (posts || []).map(p => ({
        ...p,
        visibility: p.visibility || 'everyone',
        is_student_only: (p.visibility === 'students_only') || (p.audience_scope === 'student_only') || (p.audienceScope === 'student_only'),
        audience_scope: p.audience_scope || p.audienceScope || 'all_students',
        audienceScope: p.audienceScope || p.audience_scope || 'all_students',
        is_official: p.is_official !== undefined ? p.is_official : (p.isOfficial !== undefined ? p.isOfficial : 0),
        moderation_status: p.moderation_status || 'active',
        is_removed: p.moderation_status === 'removed',
        moderated_at: p.moderated_at || null,
        moderated_by: p.moderated_by || null,
        moderation_reason: p.moderation_reason || null,
        open_reports_count: Number(p.open_reports_count || 0),
        total_reports_count: Number(p.total_reports_count || 0)
      }));

      res.json({
        posts: formattedPosts,
        moderation_access: true,
        pagination: { page, limit, total, totalPages }
      });
    } catch (err) {
      console.error('[Admin Content Oversight Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve content oversight list.' });
    }
  });

  /**
   * 7. GET /api/admin/activity
   * Read-only administrative activity history view backed by admin_audit_logs.
   * Auto-sanitizes credentials, paginates, and supports action/actor filtering.
   */
  router.get('/activity', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const { page, limit, action, actor, entityType, startDate, endDate } = req.query;
      const result = await queryAdminAuditLogs(db, {
        page,
        limit,
        action,
        actor,
        entityType,
        startDate,
        endDate
      });
      res.json(result);
    } catch (err) {
      console.error('[Admin Activity Log Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve administrative activity history.' });
    }
  });

  // ==========================================
  // CONTENT MODERATION ENDPOINTS (PHASE 4B.4)
  // ==========================================

  /**
   * 8. GET /api/admin/moderation/queue
   * Content review queue listing reports with target post/comment preview.
   */
  router.get('/moderation/queue', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = (page - 1) * limit;

      const reportsAvail = await isContentReportsAvailable(db);
      if (!reportsAvail) {
        return res.json({
          reports: [],
          pagination: { page, limit, total: 0, totalPages: 1 },
          migrationPending: true
        });
      }

      const status = req.query.status ? String(req.query.status).trim().toLowerCase() : 'open';
      const type = req.query.type ? String(req.query.type).trim().toLowerCase() : 'all';

      const whereClauses = [];
      const params = [];

      if (status !== 'all') {
        whereClauses.push('cr.status = ?');
        params.push(status);
      }

      if (type !== 'all') {
        whereClauses.push('cr.content_type = ?');
        params.push(type);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const countRow = await db.get(
        `SELECT COUNT(*) AS total FROM content_reports cr ${whereSql}`,
        ...params
      );
      const total = Number(countRow?.total || 0);
      const totalPages = Math.ceil(total / limit) || 1;

      const reports = await db.all(`
        SELECT cr.id, cr.content_type, cr.content_id, cr.reporter_id, cr.reason,
               cr.description, cr.status, cr.resolved_by, cr.resolved_at, cr.resolution_notes,
               cr.created_at,
               s.name AS reporter_name, s.role AS reporter_role, s.email AS reporter_email,
               res_s.name AS resolver_name
        FROM content_reports cr
        LEFT JOIN students s ON s.studentId = cr.reporter_id
        LEFT JOIN students res_s ON res_s.studentId = cr.resolved_by
        ${whereSql}
        ORDER BY cr.created_at DESC
        LIMIT ? OFFSET ?
      `, ...params, limit, offset);

      // Hydrate content previews for items in queue
      const hydratedReports = await Promise.all((reports || []).map(async (r) => {
        let contentPreview = null;
        let contentAuthor = null;
        let moderationStatus = 'active';

        if (r.content_type === 'post') {
          const postRow = await db.get(`
            SELECT p.id, p.content, p.user_id, COALESCE(p.moderation_status, 'active') AS moderation_status, s.name AS author_name, s.role AS author_role
            FROM posts p
            LEFT JOIN students s ON s.studentId = p.user_id
            WHERE p.id = ?
          `, r.content_id);
          if (postRow) {
            contentPreview = postRow.content ? postRow.content.slice(0, 150) : '[No text]';
            contentAuthor = { studentId: postRow.user_id, name: postRow.author_name, role: postRow.author_role };
            moderationStatus = postRow.moderation_status;
          }
        } else if (r.content_type === 'comment') {
          const commentRow = await db.get(`
            SELECT c.id, c.content, c.user_id, c.post_id, COALESCE(c.moderation_status, 'active') AS moderation_status, s.name AS author_name, s.role AS author_role
            FROM post_comments c
            LEFT JOIN students s ON s.studentId = c.user_id
            WHERE c.id = ?
          `, r.content_id);
          if (commentRow) {
            contentPreview = commentRow.content ? commentRow.content.slice(0, 150) : '[No text]';
            contentAuthor = { studentId: commentRow.user_id, name: commentRow.author_name, role: commentRow.author_role, postId: commentRow.post_id };
            moderationStatus = commentRow.moderation_status;
          }
        }

        return {
          ...r,
          contentPreview,
          contentAuthor,
          contentModerationStatus: moderationStatus
        };
      }));

      res.json({
        reports: hydratedReports,
        pagination: { page, limit, total, totalPages }
      });
    } catch (err) {
      console.error('[Admin Moderation Queue Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve moderation queue.' });
    }
  });

  /**
   * 9. GET /api/admin/moderation/posts/:id
   * Admin-only detailed inspection of a post, including moderation state, reports, and audit trail.
   */
  router.get('/moderation/posts/:id', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const postId = Number(req.params.id);
      if (!Number.isInteger(postId) || postId <= 0) {
        return res.status(400).json({ message: 'Invalid post ID.' });
      }

      const post = await db.get(`
        SELECT p.*, s.name AS author_name, s.role AS author_role, s.email AS author_email,
               COALESCE(p.moderation_status, 'active') AS moderation_status,
               mod_admin.name AS moderator_name
        FROM posts p
        LEFT JOIN students s ON s.studentId = p.user_id
        LEFT JOIN students mod_admin ON mod_admin.studentId = p.moderated_by
        WHERE p.id = ?
      `, postId);

      if (!post) {
        return res.status(404).json({ message: 'Post not found.' });
      }

      const reports = await db.all(`
        SELECT cr.*, s.name AS reporter_name, s.role AS reporter_role, s.email AS reporter_email
        FROM content_reports cr
        LEFT JOIN students s ON s.studentId = cr.reporter_id
        WHERE cr.content_type = 'post' AND cr.content_id = ?
        ORDER BY cr.created_at DESC
      `, postId);

      let auditLogs = [];
      try {
        const auditRes = await queryAdminAuditLogs(db, {
          entityType: 'post',
          limit: 20
        });
        auditLogs = (auditRes?.logs || []).filter(l => String(l.entity_id) === String(postId));
      } catch (_) {}

      res.json({
        post: {
          ...post,
          is_removed: post.moderation_status === 'removed'
        },
        reports: reports || [],
        auditLogs
      });
    } catch (err) {
      console.error('[Admin Moderation Post Detail Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve post moderation details.' });
    }
  });

  /**
   * 10. POST /api/admin/moderation/posts/:id/remove
   * Transactionally removes a post with mandatory reason, resolving active reports, and logging audit.
   */
  router.post('/moderation/posts/:id/remove', requireLogin, requireAdminRole, async (req, res) => {
    const postId = Number(req.params.id);
    const reason = (req.body.reason || '').trim();

    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({ message: 'Invalid post ID.' });
    }

    if (!reason || reason.length < 3) {
      return res.status(400).json({ message: 'A valid moderation removal reason (at least 3 characters) is required.' });
    }

    try {
      const runRemove = async (tx) => {
        const post = await tx.get(
          `SELECT id, user_id, title, content, type, category, COALESCE(moderation_status, 'active') AS moderation_status
           FROM posts
           WHERE id = ?`,
          postId
        );

        if (!post) {
          const err = new Error('Post not found.');
          err.statusCode = 404;
          throw err;
        }

        if (post.moderation_status === 'removed') {
          const err = new Error('Post is already removed by moderation.');
          err.statusCode = 409;
          throw err;
        }

        const now = new Date().toISOString();
        await tx.run(
          `UPDATE posts
           SET moderation_status = 'removed', moderated_at = ?, moderated_by = ?, moderation_reason = ?
           WHERE id = ?`,
          now, req.adminStudentId, reason, postId
        );

        // Auto-resolve any open reports for this post
        await tx.run(
          `UPDATE content_reports
           SET status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_notes = ?
           WHERE content_type = 'post' AND content_id = ? AND status = 'open'`,
          req.adminStudentId, now, `Post removed by moderator: ${reason}`, postId
        );

        // Record audit inside the same transaction
        await recordAdminAudit(tx, {
          actorUserId: req.adminStudentId,
          action: 'post_removed',
          entityType: 'post',
          entityId: String(postId),
          beforeState: {
            moderation_status: post.moderation_status
          },
          afterState: {
            moderation_status: 'removed',
            moderation_reason: reason
          },
          metadata: {
            postId,
            authorId: post.user_id,
            reason,
            adminId: req.adminStudentId
          },
          required: true,
          tx
        });

        return post;
      };

      const removedPost = typeof db.withTransaction === 'function'
        ? await db.withTransaction(runRemove)
        : await runRemove(db);

      res.json({
        success: true,
        message: 'Post successfully removed by moderation.',
        postId,
        moderation_status: 'removed',
        reason
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      console.error('[Admin Remove Post Error]:', err);
      res.status(500).json({ message: err.message || 'Failed to remove post.' });
    }
  });

  /**
   * 11. POST /api/admin/moderation/posts/:id/restore
   * Transactionally restores a removed post, returning it to its original audience visibility.
   */
  router.post('/moderation/posts/:id/restore', requireLogin, requireAdminRole, async (req, res) => {
    const postId = Number(req.params.id);
    const reason = (req.body.reason || '').trim() || 'Restored by administrator';

    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({ message: 'Invalid post ID.' });
    }

    try {
      const runRestore = async (tx) => {
        const post = await tx.get(
          `SELECT id, user_id, title, content, type, category, COALESCE(moderation_status, 'active') AS moderation_status, moderation_reason
           FROM posts
           WHERE id = ?`,
          postId
        );

        if (!post) {
          const err = new Error('Post not found.');
          err.statusCode = 404;
          throw err;
        }

        if (post.moderation_status !== 'removed') {
          const err = new Error('Post is not removed. Only removed posts can be restored.');
          err.statusCode = 409;
          throw err;
        }

        const now = new Date().toISOString();
        await tx.run(
          `UPDATE posts
           SET moderation_status = 'active', moderated_at = ?, moderated_by = ?, moderation_reason = NULL
           WHERE id = ?`,
          now, req.adminStudentId, postId
        );

        await recordAdminAudit(tx, {
          actorUserId: req.adminStudentId,
          action: 'post_restored',
          entityType: 'post',
          entityId: String(postId),
          beforeState: {
            moderation_status: 'removed',
            previousReason: post.moderation_reason
          },
          afterState: {
            moderation_status: 'active'
          },
          metadata: {
            postId,
            authorId: post.user_id,
            reason,
            adminId: req.adminStudentId
          },
          required: true,
          tx
        });

        return post;
      };

      const restoredPost = typeof db.withTransaction === 'function'
        ? await db.withTransaction(runRestore)
        : await runRestore(db);

      res.json({
        success: true,
        message: 'Post successfully restored to active status.',
        postId,
        moderation_status: 'active'
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      console.error('[Admin Restore Post Error]:', err);
      res.status(500).json({ message: err.message || 'Failed to restore post.' });
    }
  });

  /**
   * 12. GET /api/admin/moderation/comments
   * List comments with moderation filters, search, and pagination.
   */
  router.get('/moderation/comments', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = (page - 1) * limit;

      const status = req.query.status ? String(req.query.status).trim().toLowerCase() : null;
      const postId = req.query.postId ? Number(req.query.postId) : null;
      const search = req.query.search ? String(req.query.search).trim() : null;

      const whereClauses = [];
      const params = [];

      if (status && status !== 'all') {
        whereClauses.push("COALESCE(c.moderation_status, 'active') = ?");
        params.push(status);
      }

      if (postId) {
        whereClauses.push("c.post_id = ?");
        params.push(postId);
      }

      if (search) {
        whereClauses.push("(c.content LIKE ? OR c.user_id LIKE ? OR s.name LIKE ?)");
        const p = `%${search}%`;
        params.push(p, p, p);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const countRow = await db.get(`
        SELECT COUNT(*) AS total
        FROM post_comments c
        LEFT JOIN students s ON s.studentId = c.user_id
        ${whereSql}
      `, ...params);

      const total = Number(countRow?.total || 0);
      const totalPages = Math.ceil(total / limit) || 1;

      const comments = await db.all(`
        SELECT c.id, c.post_id, c.user_id, c.content, c.parent_comment_id, c.reply_to_user_id,
               c.created_at, c.updated_at, c.deleted_at,
               COALESCE(c.moderation_status, 'active') AS moderation_status,
               c.moderated_at, c.moderated_by, c.moderation_reason,
               s.name AS author_name, s.role AS author_role, s.avatarUrl AS author_avatar_url,
               p.title AS post_title,
               COALESCE((SELECT COUNT(*) FROM content_reports cr WHERE cr.content_type = 'comment' AND cr.content_id = c.id AND cr.status = 'open'), 0) AS open_reports_count
        FROM post_comments c
        LEFT JOIN students s ON s.studentId = c.user_id
        LEFT JOIN posts p ON p.id = c.post_id
        ${whereSql}
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?
      `, ...params, limit, offset);

      res.json({
        comments: (comments || []).map(c => ({
          ...c,
          is_removed: c.moderation_status === 'removed',
          is_deleted: Boolean(c.deleted_at),
          open_reports_count: Number(c.open_reports_count || 0)
        })),
        pagination: { page, limit, total, totalPages }
      });
    } catch (err) {
      console.error('[Admin Moderation Comments Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve comments list.' });
    }
  });

  /**
   * 13. GET /api/admin/moderation/comments/:id
   * Admin inspection of comment details including reports and audit logs.
   */
  router.get('/moderation/comments/:id', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const commentId = Number(req.params.id);
      if (!Number.isInteger(commentId) || commentId <= 0) {
        return res.status(400).json({ message: 'Invalid comment ID.' });
      }

      const comment = await db.get(`
        SELECT c.*, s.name AS author_name, s.role AS author_role, s.email AS author_email,
               COALESCE(c.moderation_status, 'active') AS moderation_status,
               p.content AS post_preview, p.title AS post_title,
               mod_admin.name AS moderator_name
        FROM post_comments c
        LEFT JOIN students s ON s.studentId = c.user_id
        LEFT JOIN posts p ON p.id = c.post_id
        LEFT JOIN students mod_admin ON mod_admin.studentId = c.moderated_by
        WHERE c.id = ?
      `, commentId);

      if (!comment) {
        return res.status(404).json({ message: 'Comment not found.' });
      }

      const reports = await db.all(`
        SELECT cr.*, s.name AS reporter_name, s.role AS reporter_role, s.email AS reporter_email
        FROM content_reports cr
        LEFT JOIN students s ON s.studentId = cr.reporter_id
        WHERE cr.content_type = 'comment' AND cr.content_id = ?
        ORDER BY cr.created_at DESC
      `, commentId);

      let auditLogs = [];
      try {
        const auditRes = await queryAdminAuditLogs(db, {
          entityType: 'comment',
          limit: 20
        });
        auditLogs = (auditRes?.logs || []).filter(l => String(l.entity_id) === String(commentId));
      } catch (_) {}

      res.json({
        comment: {
          ...comment,
          is_removed: comment.moderation_status === 'removed',
          is_deleted: Boolean(comment.deleted_at)
        },
        reports: reports || [],
        auditLogs
      });
    } catch (err) {
      console.error('[Admin Moderation Comment Detail Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve comment moderation details.' });
    }
  });

  /**
   * 14. POST /api/admin/moderation/comments/:id/remove
   * Transactionally removes a comment with mandatory reason, resolving active reports, and logging audit.
   */
  router.post('/moderation/comments/:id/remove', requireLogin, requireAdminRole, async (req, res) => {
    const commentId = Number(req.params.id);
    const reason = (req.body.reason || '').trim();

    if (!Number.isInteger(commentId) || commentId <= 0) {
      return res.status(400).json({ message: 'Invalid comment ID.' });
    }

    if (!reason || reason.length < 3) {
      return res.status(400).json({ message: 'A valid moderation removal reason (at least 3 characters) is required.' });
    }

    try {
      const runRemove = async (tx) => {
        const comment = await tx.get(
          `SELECT id, post_id, user_id, content, parent_comment_id, COALESCE(moderation_status, 'active') AS moderation_status
           FROM post_comments
           WHERE id = ?`,
          commentId
        );

        if (!comment) {
          const err = new Error('Comment not found.');
          err.statusCode = 404;
          throw err;
        }

        if (comment.moderation_status === 'removed') {
          const err = new Error('Comment is already removed by moderation.');
          err.statusCode = 409;
          throw err;
        }

        const now = new Date().toISOString();
        await tx.run(
          `UPDATE post_comments
           SET moderation_status = 'removed', moderated_at = ?, moderated_by = ?, moderation_reason = ?
           WHERE id = ?`,
          now, req.adminStudentId, reason, commentId
        );

        // Auto-resolve any open reports for this comment
        await tx.run(
          `UPDATE content_reports
           SET status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_notes = ?
           WHERE content_type = 'comment' AND content_id = ? AND status = 'open'`,
          req.adminStudentId, now, `Comment removed by moderator: ${reason}`, commentId
        );

        await recordAdminAudit(tx, {
          actorUserId: req.adminStudentId,
          action: 'comment_removed',
          entityType: 'comment',
          entityId: String(commentId),
          beforeState: {
            moderation_status: comment.moderation_status
          },
          afterState: {
            moderation_status: 'removed',
            moderation_reason: reason
          },
          metadata: {
            commentId,
            postId: comment.post_id,
            authorId: comment.user_id,
            reason,
            adminId: req.adminStudentId
          },
          required: true,
          tx
        });

        return comment;
      };

      const removedComment = typeof db.withTransaction === 'function'
        ? await db.withTransaction(runRemove)
        : await runRemove(db);

      res.json({
        success: true,
        message: 'Comment successfully removed by moderation.',
        commentId,
        moderation_status: 'removed',
        reason
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      console.error('[Admin Remove Comment Error]:', err);
      res.status(500).json({ message: err.message || 'Failed to remove comment.' });
    }
  });

  /**
   * 15. POST /api/admin/moderation/comments/:id/restore
   * Transactionally restores a removed comment.
   */
  router.post('/moderation/comments/:id/restore', requireLogin, requireAdminRole, async (req, res) => {
    const commentId = Number(req.params.id);
    const reason = (req.body.reason || '').trim() || 'Restored by administrator';

    if (!Number.isInteger(commentId) || commentId <= 0) {
      return res.status(400).json({ message: 'Invalid comment ID.' });
    }

    try {
      const runRestore = async (tx) => {
        const comment = await tx.get(
          `SELECT id, post_id, user_id, content, COALESCE(moderation_status, 'active') AS moderation_status, moderation_reason
           FROM post_comments
           WHERE id = ?`,
          commentId
        );

        if (!comment) {
          const err = new Error('Comment not found.');
          err.statusCode = 404;
          throw err;
        }

        if (comment.moderation_status !== 'removed') {
          const err = new Error('Comment is not removed. Only removed comments can be restored.');
          err.statusCode = 409;
          throw err;
        }

        const now = new Date().toISOString();
        await tx.run(
          `UPDATE post_comments
           SET moderation_status = 'active', moderated_at = ?, moderated_by = ?, moderation_reason = NULL
           WHERE id = ?`,
          now, req.adminStudentId, commentId
        );

        await recordAdminAudit(tx, {
          actorUserId: req.adminStudentId,
          action: 'comment_restored',
          entityType: 'comment',
          entityId: String(commentId),
          beforeState: {
            moderation_status: 'removed',
            previousReason: comment.moderation_reason
          },
          afterState: {
            moderation_status: 'active'
          },
          metadata: {
            commentId,
            postId: comment.post_id,
            authorId: comment.user_id,
            reason,
            adminId: req.adminStudentId
          },
          required: true,
          tx
        });

        return comment;
      };

      const restoredComment = typeof db.withTransaction === 'function'
        ? await db.withTransaction(runRestore)
        : await runRestore(db);

      res.json({
        success: true,
        message: 'Comment successfully restored to active status.',
        commentId,
        moderation_status: 'active'
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      console.error('[Admin Restore Comment Error]:', err);
      res.status(500).json({ message: err.message || 'Failed to restore comment.' });
    }
  });

  /**
   * 16. GET /api/admin/moderation/reports
   * List content reports with filtering and pagination.
   */
  router.get('/moderation/reports', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = (page - 1) * limit;

      const status = req.query.status ? String(req.query.status).trim().toLowerCase() : null;
      const type = req.query.type ? String(req.query.type).trim().toLowerCase() : null;

      const whereClauses = [];
      const params = [];

      if (status && status !== 'all') {
        whereClauses.push('cr.status = ?');
        params.push(status);
      }

      if (type && type !== 'all') {
        whereClauses.push('cr.content_type = ?');
        params.push(type);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const countRow = await db.get(
        `SELECT COUNT(*) AS total FROM content_reports cr ${whereSql}`,
        ...params
      );
      const total = Number(countRow?.total || 0);
      const totalPages = Math.ceil(total / limit) || 1;

      const reports = await db.all(`
        SELECT cr.*, s.name AS reporter_name, s.role AS reporter_role, s.email AS reporter_email,
               res_s.name AS resolver_name
        FROM content_reports cr
        LEFT JOIN students s ON s.studentId = cr.reporter_id
        LEFT JOIN students res_s ON res_s.studentId = cr.resolved_by
        ${whereSql}
        ORDER BY cr.created_at DESC
        LIMIT ? OFFSET ?
      `, ...params, limit, offset);

      res.json({
        reports: reports || [],
        pagination: { page, limit, total, totalPages }
      });
    } catch (err) {
      console.error('[Admin Moderation Reports Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve reports list.' });
    }
  });

  /**
   * 17. POST /api/admin/moderation/reports/:id/resolve
   * Resolves a content report.
   */
  router.post('/moderation/reports/:id/resolve', requireLogin, requireAdminRole, async (req, res) => {
    const reportId = Number(req.params.id);
    const notes = (req.body.resolutionNotes || req.body.notes || '').trim();

    if (!Number.isInteger(reportId) || reportId <= 0) {
      return res.status(400).json({ message: 'Invalid report ID.' });
    }

    try {
      const runResolve = async (tx) => {
        const report = await tx.get('SELECT * FROM content_reports WHERE id = ?', reportId);
        if (!report) {
          const err = new Error('Report not found.');
          err.statusCode = 404;
          throw err;
        }

        const now = new Date().toISOString();
        await tx.run(
          `UPDATE content_reports
           SET status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_notes = ?
           WHERE id = ?`,
          req.adminStudentId, now, notes || 'Resolved by administrator', reportId
        );

        await recordAdminAudit(tx, {
          actorUserId: req.adminStudentId,
          action: 'content_report_resolved',
          entityType: 'content_report',
          entityId: String(reportId),
          beforeState: { status: report.status },
          afterState: { status: 'resolved' },
          metadata: {
            reportId,
            contentType: report.content_type,
            contentId: report.content_id,
            resolutionNotes: notes,
            adminId: req.adminStudentId
          },
          required: true,
          tx
        });

        return report;
      };

      await (typeof db.withTransaction === 'function' ? db.withTransaction(runResolve) : runResolve(db));

      res.json({
        success: true,
        message: 'Report marked as resolved.',
        reportId,
        status: 'resolved'
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
      console.error('[Admin Resolve Report Error]:', err);
      res.status(500).json({ message: err.message || 'Failed to resolve report.' });
    }
  });

  /**
   * 18. POST /api/admin/moderation/reports/:id/dismiss
   * Dismisses a content report.
   */
  router.post('/moderation/reports/:id/dismiss', requireLogin, requireAdminRole, async (req, res) => {
    const reportId = Number(req.params.id);
    const notes = (req.body.resolutionNotes || req.body.notes || '').trim();

    if (!Number.isInteger(reportId) || reportId <= 0) {
      return res.status(400).json({ message: 'Invalid report ID.' });
    }

    try {
      const runDismiss = async (tx) => {
        const report = await tx.get('SELECT * FROM content_reports WHERE id = ?', reportId);
        if (!report) {
          const err = new Error('Report not found.');
          err.statusCode = 404;
          throw err;
        }

        const now = new Date().toISOString();
        await tx.run(
          `UPDATE content_reports
           SET status = 'dismissed', resolved_by = ?, resolved_at = ?, resolution_notes = ?
           WHERE id = ?`,
          req.adminStudentId, now, notes || 'Dismissed by administrator', reportId
        );

        await recordAdminAudit(tx, {
          actorUserId: req.adminStudentId,
          action: 'content_report_dismissed',
          entityType: 'content_report',
          entityId: String(reportId),
          beforeState: { status: report.status },
          afterState: { status: 'dismissed' },
          metadata: {
            reportId,
            contentType: report.content_type,
            contentId: report.content_id,
            resolutionNotes: notes,
            adminId: req.adminStudentId
          },
          required: true,
          tx
        });

        return report;
      };

      await (typeof db.withTransaction === 'function' ? db.withTransaction(runDismiss) : runDismiss(db));

      res.json({
        success: true,
        message: 'Report marked as dismissed.',
        reportId,
        status: 'dismissed'
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
      console.error('[Admin Dismiss Report Error]:', err);
      res.status(500).json({ message: err.message || 'Failed to dismiss report.' });
    }
  });

  /**
   * 19. GET /api/admin/moderation/history
   * Read-only moderation audit history log.
   */
  router.get('/moderation/history', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));

      const result = await queryAdminAuditLogs(db, {
        page,
        limit,
        action: req.query.action || null,
        actor: req.query.actor || null
      });

      // Filter to moderation actions if not filtering by specific action
      if (!req.query.action || req.query.action === 'all') {
        const moderationActions = new Set([
          'post_removed',
          'post_restored',
          'comment_removed',
          'comment_restored',
          'content_report_resolved',
          'content_report_dismissed'
        ]);
        result.logs = (result.logs || []).filter(l => moderationActions.has(l.action));
      }

      res.json(result);
    } catch (err) {
      console.error('[Admin Moderation History Error]:', err);
      res.status(500).json({ message: 'Failed to retrieve moderation history.' });
    }
  });

  return router;
}

module.exports = createAdminDashboardRouter;
module.exports.createAdminDashboardRouter = createAdminDashboardRouter;
