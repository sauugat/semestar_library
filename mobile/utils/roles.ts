/**
 * Authoritative role resolver for Semester Library Mobile Experience.
 *
 * Strict behavior:
 * - 'admin' (or isAdmin === true) -> 'admin' (Admin Mobile Experience)
 * - 'teacher' | 'faculty'         -> 'teacher' (Teacher Mobile Experience)
 * - 'student' | 'cr'              -> 'student' (Student Mobile Experience)
 * - Any unrecognized / invalid    -> 'unknown' (Explicit unauthorized access state, NEVER silently student)
 */

export type AppRole = 'admin' | 'teacher' | 'student' | 'unknown';

export function resolveAppRole(user?: { role?: string | null; isAdmin?: boolean } | null): AppRole {
  if (!user) return 'unknown';

  const role = typeof user.role === 'string' ? user.role.trim().toLowerCase() : '';

  if (role === 'admin' || user.isAdmin === true) {
    return 'admin';
  }

  if (role === 'teacher' || role === 'faculty') {
    return 'teacher';
  }

  if (role === 'student' || role === 'cr') {
    return 'student';
  }

  return 'unknown';
}
