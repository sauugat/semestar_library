'use strict';

const express = require('express');
const {
  createTeacherInvitesBatch,
  listTeacherInvites,
  getTeacherInviteDetail,
  regenerateTeacherInvitePassword,
  reissueTeacherInvite,
  revokeTeacherInvite,
  isTeacherOnboardingEnabled,
  listAllSubjects,
  getTeacherAssignments,
  assignTeacherSubject,
  removeTeacherSubject,
  listTeachersWithAssignments
} = require('../lib/teacher-service');
const { recordAdminAudit } = require('../lib/audit-service');

function createAdminTeachersRouter(arg1, arg2) {
  let db, requireLogin;
  if (arg1 && arg1.db) {
    db = arg1.db;
    requireLogin = arg1.requireLogin || ((req, res, next) => next());
  } else {
    db = arg1;
    requireLogin = arg2 || ((req, res, next) => next());
  }

  const router = express.Router();

  // Strict Admin Guard: verifies user identity and authoritative admin role from database
  const requireAdminRole = async (req, res, next) => {
    const studentId = req.student?.studentId || req.user?.studentId || req.session?.studentId;
    if (!studentId) {
      return res.status(401).json({ message: 'Authentication required. Please sign in.' });
    }

    try {
      const student = await db.get('SELECT studentId, role FROM students WHERE studentId = ?', studentId);
      if (!student || student.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden: Administrator access required.' });
      }
      req.adminStudentId = student.studentId;
      next();
    } catch (err) {
      return res.status(500).json({ message: 'Authorization check failed.' });
    }
  };

  /**
   * 1. GET /api/admin/teacher-invites
   * List teacher invitations with search, filter, pagination, summary counts,
   * and linked active teacher profiles with canonical subjects.
   */
  router.get('/teacher-invites', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const search = req.query.search || '';
      const status = req.query.status || '';
      const page = req.query.page || 1;
      const limit = req.query.limit || 50;

      const result = await listTeacherInvites(db, { search, status, page, limit });
      res.json(result);
    } catch (err) {
      console.error('[Admin Teachers] List error:', err);
      res.status(500).json({ message: 'Failed to list teacher invitations.' });
    }
  });

  /**
   * 2. POST /api/admin/teacher-invites
   * Create single or bulk teacher logins (1–50).
   * Server determines usernames and passwords. Client cannot specify credentials or role.
   * Returns plaintext passwords ONCE in this response.
   */
  router.post('/teacher-invites', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const rawCount = req.body && req.body.count !== undefined ? req.body.count : 1;

      // Strict validation: must be integer between 1 and 50
      if (typeof rawCount !== 'number' || !Number.isInteger(rawCount) || rawCount < 1 || rawCount > 50) {
        return res.status(400).json({
          message: 'Invalid count. Must be an integer between 1 and 50.'
        });
      }

      const result = await createTeacherInvitesBatch(db, {
        count: rawCount,
        createdBy: req.adminStudentId
      });

      console.log(
        `[Admin Teacher Audit] Event: teacher_invite_${rawCount > 1 ? 'bulk_' : ''}created, ` +
        `adminId: ${req.adminStudentId}, count: ${rawCount}, time: ${new Date().toISOString()}`
      );

      await recordAdminAudit(db, {
        actorUserId: req.adminStudentId,
        action: rawCount > 1 ? 'teacher_invite_bulk_created' : 'teacher_invite_created',
        entityType: 'teacher_invite',
        entityId: rawCount === 1 && result.invites?.[0]?.id ? result.invites[0].id : null,
        metadata: {
          count: rawCount,
          usernames: result.invites?.map(i => i.initial_username)
        }
      });

      res.status(201).json(result);
    } catch (err) {
      console.error('[Admin Teachers] Create error:', err);
      res.status(500).json({ message: err.message || 'Failed to create teacher invitations.' });
    }
  });

  /**
   * 3. GET /api/admin/teacher-invites/:id/detail
   * Fetch complete detail for a single invite and any linked active teacher.
   * Excludes student semester and cohort. Never returns password hashes.
   */
  router.get('/teacher-invites/:id/detail', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const inviteId = req.params.id;
      const detail = await getTeacherInviteDetail(db, inviteId);
      if (!detail) {
        return res.status(404).json({ message: 'Teacher invite not found.' });
      }

      res.json(detail);
    } catch (err) {
      console.error('[Admin Teachers] Detail error:', err);
      res.status(500).json({ message: 'Failed to retrieve teacher details.' });
    }
  });

  /**
   * 4. POST /api/admin/teacher-invites/:id/regenerate-password
   * Regenerates a new temporary password for uncompleted invitations.
   * Invalidates previous temporary password immediately.
   * Returns new plaintext password ONCE.
   */
  router.post('/teacher-invites/:id/regenerate-password', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const inviteId = req.params.id;
      const result = await regenerateTeacherInvitePassword(db, inviteId);

      console.log(
        `[Admin Teacher Audit] Event: teacher_invite_password_regenerated, ` +
        `adminId: ${req.adminStudentId}, inviteId: ${inviteId}, time: ${new Date().toISOString()}`
      );

      await recordAdminAudit(db, {
        actorUserId: req.adminStudentId,
        action: 'teacher_invite_password_regenerated',
        entityType: 'teacher_invite',
        entityId: inviteId,
        metadata: {
          temporaryUsername: result.temporary_username || result.initial_username
        }
      });

      res.json(result);
    } catch (err) {
      const status = err.message && err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ message: err.message || 'Failed to regenerate temporary password.' });
    }
  });

  /**
   * 5. POST /api/admin/teacher-invites/:id/reissue
   * Reissues an expired or unused invitation, keeping the temporary username.
   * Generates new temporary password and resets expiration.
   * Returns new plaintext password ONCE.
   */
  router.post('/teacher-invites/:id/reissue', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const inviteId = req.params.id;
      const result = await reissueTeacherInvite(db, inviteId);

      console.log(
        `[Admin Teacher Audit] Event: teacher_invite_reissued, ` +
        `adminId: ${req.adminStudentId}, inviteId: ${inviteId}, time: ${new Date().toISOString()}`
      );

      await recordAdminAudit(db, {
        actorUserId: req.adminStudentId,
        action: 'teacher_invite_reissued',
        entityType: 'teacher_invite',
        entityId: inviteId,
        metadata: {
          temporaryUsername: result.temporary_username || result.initial_username
        }
      });

      res.json(result);
    } catch (err) {
      const status = err.message && err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ message: err.message || 'Failed to reissue teacher invite.' });
    }
  });

  /**
   * 6. POST /api/admin/teacher-invites/:id/revoke
   * Revokes an uncompleted invitation.
   * Invalidates temporary credentials and in-progress setup immediately.
   */
  router.post('/teacher-invites/:id/revoke', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const inviteId = req.params.id;
      const result = await revokeTeacherInvite(db, inviteId);

      console.log(
        `[Admin Teacher Audit] Event: teacher_invite_revoked, ` +
        `adminId: ${req.adminStudentId}, inviteId: ${inviteId}, time: ${new Date().toISOString()}`
      );

      await recordAdminAudit(db, {
        actorUserId: req.adminStudentId,
        action: 'teacher_invite_revoked',
        entityType: 'teacher_invite',
        entityId: inviteId
      });

      res.json(result);
    } catch (err) {
      const status = err.message && err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ message: err.message || 'Failed to revoke teacher invite.' });
    }
  });

  /**
   * 7. GET /api/admin/teacher-invites/:id
   * Alias to detail endpoint supporting either invite ID or initial username.
   */
  router.get('/teacher-invites/:id', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const inviteId = req.params.id;
      const detail = await getTeacherInviteDetail(db, inviteId);
      if (!detail) {
        return res.status(404).json({ message: 'Teacher invite not found.' });
      }

      res.json(detail);
    } catch (err) {
      console.error('[Admin Teachers] Detail error:', err);
      res.status(500).json({ message: 'Failed to retrieve teacher details.' });
    }
  });

  /**
   * 8. GET /api/admin/subjects
   * List available canonical subjects (active only), with optional semester or search filter.
   */
  router.get('/subjects', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const subjects = await listAllSubjects(db, req.query);
      res.json({ subjects });
    } catch (err) {
      console.error('[Admin Teachers] List subjects error:', err);
      res.status(500).json({ message: 'Failed to list subjects.' });
    }
  });

  /**
   * 9. GET /api/admin/teachers/assignments
   * List all faculty teachers with their assigned canonical subjects and derived semesters.
   */
  router.get('/teachers/assignments', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const teachers = await listTeachersWithAssignments(db);
      res.json({ teachers });
    } catch (err) {
      console.error('[Admin Teachers] List assignments error:', err);
      res.status(500).json({ message: 'Failed to load teacher assignments.' });
    }
  });

  /**
   * 10. GET /api/admin/teachers/:id/subjects
   * Get specific teacher's assigned canonical subjects and derived semesters.
   */
  router.get('/teachers/:id/subjects', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const result = await getTeacherAssignments(db, req.params.id);
      if (!result) {
        return res.status(404).json({ message: 'Teacher not found.' });
      }
      res.json(result);
    } catch (err) {
      console.error('[Admin Teachers] Teacher subjects error:', err);
      res.status(500).json({ message: 'Failed to get teacher subjects.' });
    }
  });

  /**
   * 11. POST /api/admin/teachers/:id/subjects
   * Authoritatively assign an existing active canonical subject to a teacher.
   * Body: { subjectId } or { subjectCode }
   */
  router.post('/teachers/:id/subjects', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const subjectInput = req.body && (req.body.subjectId || req.body.subjectCode || req.body.id || req.body.code);
      if (!subjectInput) {
        return res.status(400).json({ message: 'Subject ID or code is required.' });
      }

      const result = await assignTeacherSubject(db, {
        adminId: req.adminStudentId,
        teacherId: req.params.id,
        subjectIdOrCode: subjectInput
      });

      res.status(201).json({
        message: 'Subject assigned successfully.',
        ...result
      });
    } catch (err) {
      console.error('[Admin Teachers] Assign subject error:', err.message);
      const msg = err.message || '';
      let status = 400;
      if (msg.includes('not found')) status = 404;
      else if (msg.includes('already assigned')) status = 409;
      res.status(status).json({ message: msg || 'Failed to assign subject.' });
    }
  });

  /**
   * 12. DELETE /api/admin/teachers/:id/subjects/:subjectId
   * Authoritatively remove an assigned subject from a teacher. Preserves historical materials.
   */
  router.delete('/teachers/:id/subjects/:subjectId', requireLogin, requireAdminRole, async (req, res) => {
    try {
      const result = await removeTeacherSubject(db, {
        adminId: req.adminStudentId,
        teacherId: req.params.id,
        subjectIdOrCode: req.params.subjectId
      });

      res.json({
        message: 'Subject assignment removed successfully.',
        ...result
      });
    } catch (err) {
      console.error('[Admin Teachers] Remove subject error:', err.message);
      const msg = err.message || '';
      let status = 400;
      if (msg.includes('not found')) status = 404;
      res.status(status).json({ message: msg || 'Failed to remove subject assignment.' });
    }
  });

  return router;
}

module.exports = createAdminTeachersRouter;
module.exports.createAdminTeachersRouter = createAdminTeachersRouter;
