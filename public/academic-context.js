/**
 * Semester Library - Authoritative Academic Context Client Service
 *
 * Provides a single shared loader and cache for /api/academic-context across
 * web dashboard, library, and assignment views.
 */
(function (root) {
  'use strict';

  const CACHE_KEY = 'sl_academic_context_cache_v1';
  let memoryCache = null;
  let inFlightPromise = null;

  const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

  function semNumberToRoman(num) {
    const n = Number(num);
    if (n >= 1 && n <= 8) return ROMANS[n - 1];
    return 'I';
  }

  function formatDisplayLabel(data) {
    if (!data || !data.authenticated) {
      return '';
    }
    if (data.canViewAllCohorts || data.role === 'teacher' || data.role === 'admin') {
      return 'All Cohorts';
    }
    if (data.academicStatus === 'unassigned' || !data.cohort) {
      return 'Class Unassigned';
    }
    const cohortName = data.cohort.displayName || data.cohort.name || data.cohort.slotCode || 'Cohort';
    const sem = data.cohort.currentSemester || data.currentSemester || 1;
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
    const currentSem = cohort ? Number(cohort.currentSemester || 1) : null;
    const isUnassigned = !cohort || data.academicStatus === 'unassigned';

    return {
      authenticated: true,
      role: role,
      studentId: data.studentId || '',
      name: data.name || '',
      cohort: cohort,
      currentSemester: currentSem,
      semesterRoman: currentSem ? semNumberToRoman(currentSem) : null,
      academicStatus: isUnassigned ? 'unassigned' : (cohort?.status || 'active'),
      canViewAllCohorts: Boolean(data.canViewAllCohorts || isStaff),
      canManageCohorts: Boolean(data.canManageCohorts || role === 'admin'),
      cohorts: Array.isArray(data.cohorts) ? data.cohorts : [],
      isStudent: isStudent,
      isStaff: isStaff,
      isUnassigned: isUnassigned,
      displayLabel: formatDisplayLabel(data)
    };
  }

  async function fetchAcademicContext(options = {}) {
    const force = Boolean(options.force);

    if (!force && memoryCache) {
      return memoryCache;
    }

    if (!force) {
      try {
        const cachedRaw = sessionStorage.getItem(CACHE_KEY);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          if (parsed && typeof parsed === 'object') {
            memoryCache = parsed;
            return parsed;
          }
        }
      } catch (_) {}
    }

    if (inFlightPromise) {
      return inFlightPromise;
    }

    inFlightPromise = (async () => {
      try {
        const res = await fetch('/api/academic-context', {
          headers: { 'Accept': 'application/json' },
          cache: 'no-store'
        });

        if (res.status === 401) {
          const anon = normalizeContext(null);
          memoryCache = anon;
          try { sessionStorage.removeItem(CACHE_KEY); } catch (_) {}
          return anon;
        }

        if (!res.ok) {
          throw new Error(`Academic context fetch failed (${res.status})`);
        }

        const raw = await res.json();
        const ctx = normalizeContext(raw);
        memoryCache = ctx;
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(ctx));
        } catch (_) {}
        return ctx;
      } catch (err) {
        console.warn('[AcademicContext] Load warning:', err.message);
        if (memoryCache) return memoryCache;
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
      el.textContent = ctx.displayLabel || '';
      el.title = ctx.isUnassigned
        ? 'Your cohort has not been assigned by university staff yet.'
        : `Active Class: ${ctx.displayLabel}`;
      el.style.display = 'inline-flex';
    }).catch(() => {
      el.style.display = 'none';
    });
  }

  // Auto-listen to window auth changes & storage
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === 'user' || e.key === 'token' || e.key === 'sl_auth_state') {
        invalidateAcademicContext();
      }
    });
  }

  const AcademicContext = {
    getAcademicContext: fetchAcademicContext,
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
