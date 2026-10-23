/**
 * Semester Library - Authoritative Academic Context Client Service
 *
 * Provides a single shared loader and cache for /api/academic-context across
 * web dashboard, library, and assignment views.
 */
(function (root) {
  'use strict';

  const CACHE_KEY = 'sl_academic_context_cache_v2';
  let memoryCache = null;
  let inFlightPromise = null;

  const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

  function semNumberToRoman(num) {
    const n = Number(num);
    if (n >= 1 && n <= 8) return ROMANS[n - 1];
    return 'I';
  }

  function parseSemesterNumber(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') {
      return Number.isInteger(val) && val >= 1 && val <= 8 ? val : null;
    }
    const cleaned = String(val).trim().replace(/^(?:semester|sem)\s*/i, '').toUpperCase();
    const parsed = parseInt(cleaned, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 8) {
      return parsed;
    }
    const romanIdx = ROMANS.indexOf(cleaned);
    if (romanIdx !== -1) {
      return romanIdx + 1;
    }
    return null;
  }

  function formatDisplayLabel(data) {
    if (!data || !data.authenticated) {
      return '';
    }
    if (data.canViewAllCohorts || data.role === 'teacher' || data.role === 'admin') {
      return 'All Cohorts';
    }
    if (data.academicStatus === 'unassigned' || !data.cohort) {
      const semNum = parseSemesterNumber(data.currentSemester || data.semester);
      if (semNum) {
        return `Semester ${semNum}`;
      }
      return 'Class Unassigned';
    }
    const cohortName = data.cohort.displayName || data.cohort.name || data.cohort.slotCode || 'Cohort';
    const sem = data.cohort.currentSemester || data.currentSemester || parseSemesterNumber(data.semester) || 1;
    return `${cohortName} • Semester ${sem}`;
  }

  function normalizeContext(data) {
    if (!data || !data.authenticated) {
      return {
        authenticated: false,
        role: 'anonymous',
        cohort: null,
        currentSemester: null,
        semesterRoman: null,
        academicStatus: 'anonymous',
        canViewAllCohorts: false,
        canManageCohorts: false,
        cohorts: [],
        assignedSemesters: [],
        assignedSubjects: [],
        isStudent: false,
        isStaff: false,
        isUnassigned: false,
        displayLabel: ''
      };
    }

    const role = (data.role || 'student').toLowerCase();
    const isStudent = role === 'student' || role === 'cr';
    const isStaff = role === 'teacher' || role === 'admin';
    const cohort = data.cohort || null;
    let currentSem = cohort
      ? Number(cohort.currentSemester || 1)
      : parseSemesterNumber(data.currentSemester || data.semester);
    const isUnassigned = !cohort || data.academicStatus === 'unassigned';

    return {
      authenticated: true,
      role: role,
      studentId: data.studentId || '',
      name: data.name || '',
      semester: data.semester || (currentSem ? `Semester ${currentSem}` : null),
      cohort: cohort,
      currentSemester: currentSem,
      semesterRoman: currentSem ? semNumberToRoman(currentSem) : null,
      academicStatus: isUnassigned ? 'unassigned' : (cohort?.status || 'active'),
      canViewAllCohorts: Boolean(data.canViewAllCohorts || isStaff),
      canManageCohorts: Boolean(data.canManageCohorts || role === 'admin'),
      cohorts: Array.isArray(data.cohorts) ? data.cohorts : [],
      assignedSemesters: Array.isArray(data.assignedSemesters) ? data.assignedSemesters : [],
      assignedSubjects: Array.isArray(data.assignedSubjects) ? data.assignedSubjects : [],
      isStudent: isStudent,
      isStaff: isStaff,
      isUnassigned: isUnassigned,
      displayLabel: formatDisplayLabel(data)
    };
  }

  async function resolveFallbackFromAuth() {
    if (typeof window === 'undefined' || !window.SemesterAuth) return null;
    try {
      let user = null;
      if (typeof window.SemesterAuth.getUser === 'function') {
        user = await window.SemesterAuth.getUser(true).catch(() => null);
        if (!user) {
          user = await window.SemesterAuth.getUser().catch(() => null);
        }
      }
      if (!user && typeof window.SemesterAuth.getUserSync === 'function') {
        user = window.SemesterAuth.getUserSync();
      }
      if (user && (user.studentId || user.email || user.name)) {
        const semNum = parseSemesterNumber(user.semester || user.currentSemester) || 1;
        return normalizeContext({
          authenticated: true,
          role: user.role || 'student',
          studentId: user.studentId || user.username || '',
          name: user.name || '',
          semester: user.semester || `Semester ${semNum}`,
          currentSemester: semNum,
          cohort: user.cohort || null,
          academicStatus: user.cohort ? 'active' : 'unassigned'
        });
      }
    } catch (_) {}
    return null;
  }

  async function fetchAcademicContext(options = {}) {
    const force = Boolean(options.force);

    if (!force && memoryCache && memoryCache.authenticated) {
      return memoryCache;
    }

    if (!force) {
      try {
        const cachedRaw = sessionStorage.getItem(CACHE_KEY);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          if (parsed && typeof parsed === 'object' && parsed.authenticated) {
            const normalized = normalizeContext(parsed);
            memoryCache = normalized;
            return normalized;
          }
        }
      } catch (_) {}
    }

    if (inFlightPromise) {
      return inFlightPromise;
    }

    inFlightPromise = (async () => {
      try {
        const fetcher = (typeof window !== 'undefined' && window.SemesterAuth && typeof window.SemesterAuth.authFetch === 'function')
          ? window.SemesterAuth.authFetch
          : fetch;

        const res = await fetcher('/api/academic-context', {
          headers: { 'Accept': 'application/json' },
          cache: 'no-store'
        });

        if (res.status === 401) {
          try { sessionStorage.removeItem(CACHE_KEY); } catch (_) {}
          const fallbackCtx = await resolveFallbackFromAuth();
          if (fallbackCtx && fallbackCtx.authenticated) {
            memoryCache = fallbackCtx;
            return fallbackCtx;
          }
          memoryCache = null;
          return normalizeContext(null);
        }

        if (!res.ok) {
          throw new Error(`Academic context fetch failed (${res.status})`);
        }

        const raw = await res.json();
        const ctx = normalizeContext(raw);
        if (ctx.authenticated) {
          memoryCache = ctx;
          try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(ctx));
          } catch (_) {}
          return ctx;
        }

        const fallbackCtx = await resolveFallbackFromAuth();
        if (fallbackCtx && fallbackCtx.authenticated) {
          memoryCache = fallbackCtx;
          return fallbackCtx;
        }
        return ctx;
      } catch (err) {
        console.warn('[AcademicContext] Load warning:', err.message);
        if (memoryCache && memoryCache.authenticated) return memoryCache;
        const fallbackCtx = await resolveFallbackFromAuth();
        if (fallbackCtx && fallbackCtx.authenticated) {
          memoryCache = fallbackCtx;
          return fallbackCtx;
        }
        return normalizeContext(null);
      } finally {
        inFlightPromise = null;
      }
    })();

    return inFlightPromise;
  }

  function invalidateAcademicContext() {
    memoryCache = null;
    inFlightPromise = null;
    try {
      sessionStorage.removeItem(CACHE_KEY);
      sessionStorage.removeItem('sl_academic_context_cache_v1');
    } catch (_) {}
  }

  function renderBadge(container, options = {}) {
    if (!container) return null;
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return null;

    fetchAcademicContext().then(ctx => {
      if (!ctx.authenticated) {
        el.style.display = 'none';
        return;
      }

      el.className = 'academic-context-badge' + (ctx.isUnassigned ? ' unassigned' : '') + (options.className ? ' ' + options.className : '');
      el.textContent = '';
      el.style.display = 'none';
    }).catch(() => {
      el.style.display = 'none';
    });
  }

  // Auto-listen to window auth changes & storage
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === 'user' || e.key === 'token' || e.key === 'sl_auth_state' || (e.key && e.key.includes('auth-token'))) {
        invalidateAcademicContext();
      }
    });
  }

  const AcademicContext = {
    getAcademicContext: fetchAcademicContext,
    normalizeContext: normalizeContext,
    parseSemesterNumber: parseSemesterNumber,
    invalidate: invalidateAcademicContext,
    renderBadge: renderBadge,
    semNumberToRoman: semNumberToRoman,
    formatDisplayLabel: formatDisplayLabel
  };

  root.AcademicContext = AcademicContext;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AcademicContext;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
