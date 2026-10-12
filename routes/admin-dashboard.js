'use strict';

const express = require('express');
const { queryAdminAuditLogs } = require('../lib/audit-service');

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
        'SELECT studentId, role, name, email, department, avatarUrl FROM students WHERE studentId = ?',
        studentId
      );
      if (!student || student.role !== 'admin') {
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

      const whereClauses = [];
      const params = [];

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
               c.slot_code AS cohort_slot, c.display_name AS cohort_name
        FROM students s
        LEFT JOIN cohorts c ON c.id = s.cohort_id
        ${whereSql}
        ORDER BY s.created_at DESC
        LIMIT ? OFFSET ?
      `;

      const users = await db.all(querySql, ...params, limit, offset);

      res.json({
        users: users || [],
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

      const posts = await db.all(`
        SELECT p.id, p.user_id, p.title, p.content, p.type, p.category,
               COALESCE(p.visibility, 'everyone') AS visibility,
               CASE WHEN (p.type = 'notice' OR p.category = 'notice') AND s.role IN ('admin', 'cr', 'teacher') THEN 1 ELSE 0 END AS is_official,
               p.target_all_semesters, p.audience_scope,
               p.attachment_url, p.created_at, p.edited_at,
               s.name AS author_name, s.role AS author_role, s.avatarUrl AS author_avatar_url,
               COALESCE((SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id), 0) AS likes_count,
               COALESCE((SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id), 0) AS comments_count
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
        is_official: p.is_official !== undefined ? p.is_official : (p.isOfficial !== undefined ? p.isOfficial : 0)
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

  return router;
}

module.exports = createAdminDashboardRouter;
module.exports.createAdminDashboardRouter = createAdminDashboardRouter;
