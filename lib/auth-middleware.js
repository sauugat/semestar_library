const { verifySupabaseToken } = require('./supabase');

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
      try {
        const { user: supabaseUser, error } = await verifySupabaseToken(token);
        if (!error && supabaseUser && supabaseUser.id) {
          const supabaseUid = supabaseUser.id;
          const userEmail = supabaseUser.email ? supabaseUser.email.toLowerCase().trim() : null;

          // Lookup student in Neon PostgreSQL by supabase_uid or email
          let student = await db.get(
            `SELECT studentId, name, role, department, semester, email, supabase_uid, avatarUrl
             FROM students
             WHERE supabase_uid = ? OR (email IS NOT NULL AND LOWER(email) = ?)`,
            supabaseUid, userEmail || ''
          );

          if (student) {
            // If matched by email but supabase_uid not yet linked, link it now
            if (!student.supabase_uid && userEmail) {
              db.run('UPDATE students SET supabase_uid = ? WHERE studentId = ?', supabaseUid, student.studentId).catch(() => {});
            }

            req.user = {
              supabaseUid,
              studentId: student.studentId,
              name: student.name,
              role: student.role || 'student',
              department: student.department || 'BIT',
              semester: student.semester || 'Semester 1',
              email: student.email || userEmail,
              avatarUrl: student.avatarUrl
            };

            // Maintain req.student and req.session compatibility
            req.student = req.user;
            if (!req.session) req.session = {};
            req.session.studentId = student.studentId;
            req.session.studentName = student.name;
            req.session.role = student.role || 'student';
          }
        }
      } catch (err) {
        console.error('[Auth Middleware] Supabase verification error:', err.message);
      }
    } else {
      // Legacy Mobile Bearer Token Authentication (Preserved for mobile app)
      try {
        const tokenRecord = await db.get(
          'SELECT token, studentId, expiresAt FROM mobile_tokens WHERE token = ?',
          token
        );
        if (tokenRecord) {
          const rawExpiry = tokenRecord.expiresAt || tokenRecord.expiresat;
          const expiresAt = new Date(rawExpiry).getTime();
          if (expiresAt > Date.now()) {
            const sid = tokenRecord.studentId || tokenRecord.studentid;
            const student = await db.get(
              'SELECT studentId, name, role, department, semester, email, avatarUrl FROM students WHERE studentId = ?',
              sid
            );
            if (student) {
              req.user = {
                studentId: student.studentId,
                name: student.name,
                role: student.role || 'student',
                department: student.department || 'BIT',
                semester: student.semester || 'Semester 1',
                email: student.email || null,
                avatarUrl: student.avatarUrl
              };
              req.student = req.user;
              req.mobileToken = token;
              if (!req.session) req.session = {};
              req.session.studentId = student.studentId;
              req.session.studentName = student.name;
              req.session.role = student.role || 'student';
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
    if (!req.user || !req.user.studentId) {
      return res.status(401).json({ message: 'Authentication required. Please sign in.' });
    }
    req.student = req.user;
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }
    next();
  }

  return {
    authenticate,
    requireLogin,
    requireAdmin,
  };
}

module.exports = {
  createAuthMiddleware,
};
