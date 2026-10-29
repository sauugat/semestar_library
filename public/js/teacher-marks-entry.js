/**
 * Semester Library — Teacher Marks Entry Workspace (Web Module)
 *
 * Implements the end-to-end teacher Marks Entry workflow:
 *   Marks Entry -> Select Subject -> Select Exam Type -> Enter Marks -> Save Draft -> Publish Results
 *
 * Supported Exam Types (exact labels):
 *   1. Mid-Term Exam
 *   2. Pre-Board Exam
 *   3. Final Exam
 *
 * Consumes authoritative Marks APIs:
 * - GET  /api/marks/teacher/context
 * - GET  /api/marks/roster?subjectId=...&examType=...
 * - POST /api/marks/config
 * - POST /api/marks/draft
 * - POST /api/marks/publish
 * - PUT  /api/marks/published
 * - GET  /api/marks/audit?subjectId=...&examType=...
 */
(function (window) {
  'use strict';

  const EXAM_TYPES = [
    'Mid-Term Exam',
    'Pre-Board Exam',
    'Final Exam'
  ];

  const state = {
    initialized: false,
    loadingContext: false,
    loadingRoster: false,
    savingConfig: false,
    savingDraft: false,
    publishing: false,
    loadingAudit: false,

    contextError: null,
    rosterError: null,
    actionError: null,
    actionSuccessMessage: null,

    // Context from GET /api/marks/teacher/context
    role: 'teacher',
    userId: '',
    userName: '',
    subjects: [],
    cohorts: [],

    // Selection state
    selectedSubjectId: '',
    selectedCohortId: '',
    selectedExamType: 'Mid-Term Exam',

    // Roster & Exam state from GET /api/marks/roster
    rosterSubject: null,
    rosterCohort: null,
    examConfig: null,
    configsByExamType: {},
    students: [],
    summary: null,

    // Form state
    maxMarksInput: '',
    initialMaxMarksSnapshot: '',
    marksByStudentId: {}, // { [studentId]: string }
    initialMarksSnapshot: '{}',
    validationErrorsByStudentId: {},
    maxMarksValidationError: null,

    // Filter & Search state
    studentSearchQuery: '',
    statusFilter: 'ALL', // 'ALL' | 'MISSING' | 'DRAFT' | 'PUBLISHED'

    // Published results editing guard
    isEditingPublished: false,
    editReason: '',

    // Audit modal state
    auditModalOpen: false,
    auditLogs: [],

    containerEl: null,
    beforeUnloadBound: false
  };

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function authFetch(url, options = {}) {
    if (window.SemesterAuth && typeof window.SemesterAuth.authFetch === 'function') {
      return window.SemesterAuth.authFetch(url, options);
    }
    return window.fetch(url, options);
  }

  function calculatePercentage(obtainedRaw, maxRaw) {
    if (obtainedRaw === null || obtainedRaw === undefined || String(obtainedRaw).trim() === '') {
      return null;
    }
    const obt = Number(obtainedRaw);
    const max = Number(maxRaw);
    if (!Number.isFinite(obt) || !Number.isFinite(max) || max <= 0 || obt < 0 || obt > max) {
      return null;
    }
    return Math.round(((obt / max) * 100) * 100) / 100;
  }

  function formatPercentage(pct) {
    if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return '—';
    const num = Number(pct);
    return Number.isInteger(num) ? `${num}%` : `${num.toFixed(2).replace(/\.?0+$/, '')}%`;
  }

  function renderPassFail(pct) {
    if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) {
      return '<span style="color:var(--teach-text-secondary, #a3a3a3); font-weight:600;">—</span>';
    }
    const isPass = Number(pct) >= 45;
    const color = isPass ? '#22c55e' : '#ef4444';
    return `<span style="font-weight:700; color:${color};">${isPass ? 'Pass' : 'Fail'}</span>`;
  }

  function formatTimestamp(isoStr) {
    if (!isoStr) return '—';
    try {
      const dt = new Date(isoStr);
      if (Number.isNaN(dt.getTime())) return String(isoStr);
      return dt.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return String(isoStr);
    }
  }

  function hasUnsavedChanges() {
    const currentMarksJson = JSON.stringify(state.marksByStudentId || {});
    const marksDirty = currentMarksJson !== state.initialMarksSnapshot;
    const maxDirty = String(state.maxMarksInput || '').trim() !== String(state.initialMaxMarksSnapshot || '').trim();
    return marksDirty || maxDirty;
  }

  function discardUnsavedChanges() {
    try {
      state.marksByStudentId = JSON.parse(state.initialMarksSnapshot || '{}');
    } catch (_) {
      state.marksByStudentId = {};
    }
    state.maxMarksInput = state.initialMaxMarksSnapshot;
    state.validationErrorsByStudentId = {};
    state.maxMarksValidationError = null;
    state.actionError = null;
    state.isEditingPublished = false;
    state.editReason = '';
  }

  function confirmDiscardIfDirty() {
    if (!hasUnsavedChanges()) return true;
    if (typeof window.confirm === 'function') {
      const ok = window.confirm('You have unsaved marks changes. Discard unsaved changes?');
      if (ok) discardUnsavedChanges();
      return ok;
    }
    discardUnsavedChanges();
    return true;
  }

  function validateMaxMarksValue(rawVal) {
    const trimmed = String(rawVal === null || rawVal === undefined ? '' : rawVal).trim();
    if (!trimmed) {
      return { valid: false, value: null, error: 'Maximum marks is required.' };
    }
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      return { valid: false, value: null, error: 'Maximum marks must be a valid number.' };
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num <= 0) {
      return { valid: false, value: null, error: 'Maximum marks must be greater than zero.' };
    }
    if (num > 10000) {
      return { valid: false, value: null, error: 'Maximum marks cannot exceed 10,000.' };
    }
    return { valid: true, value: Math.round(num * 100) / 100, error: null };
  }

  function validateStudentMarkValue(rawVal, maxMarksNum) {
    const trimmed = String(rawVal === null || rawVal === undefined ? '' : rawVal).trim();
    if (trimmed === '') {
      return { valid: true, isMissing: true, value: null, error: null };
    }
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      return { valid: false, isMissing: false, value: null, error: 'Enter a valid numeric mark.' };
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
      return { valid: false, isMissing: false, value: null, error: 'Invalid numeric value.' };
    }
    if (num < 0) {
      return { valid: false, isMissing: false, value: null, error: 'Obtained marks cannot be negative.' };
    }
    if (maxMarksNum !== null && Number.isFinite(maxMarksNum) && maxMarksNum > 0 && num > maxMarksNum) {
      return {
        valid: false,
        isMissing: false,
        value: null,
        error: `Cannot exceed maximum marks (${maxMarksNum}).`
      };
    }
    return { valid: true, isMissing: false, value: Math.round(num * 100) / 100, error: null };
  }

  function runAllClientValidations() {
    const maxCheck = validateMaxMarksValue(state.maxMarksInput);
    state.maxMarksValidationError = maxCheck.error;
    const maxVal = maxCheck.valid ? maxCheck.value : null;

    const studentErrors = {};
    let hasStudentError = false;

    for (const stu of state.students) {
      const rawMark = state.marksByStudentId[stu.studentId];
      const markCheck = validateStudentMarkValue(rawMark, maxVal);
      if (!markCheck.valid) {
        studentErrors[stu.studentId] = markCheck.error;
        hasStudentError = true;
      }
    }

    state.validationErrorsByStudentId = studentErrors;
    return {
      valid: maxCheck.valid && !hasStudentError,
      maxMarks: maxVal,
      hasStudentError
    };
  }

  function getSelectedSubjectObj() {
    if (!state.selectedSubjectId) return null;
    const norm = String(state.selectedSubjectId).trim().toLowerCase();
    return (
      (state.subjects || []).find(
        (s) =>
          String(s.id || '').toLowerCase() === norm ||
          String(s.code || '').toLowerCase() === norm ||
          String(s.name || '').toLowerCase() === norm
      ) || state.rosterSubject || null
    );
  }

  function getLiveTableMetrics() {
    const maxCheck = validateMaxMarksValue(state.maxMarksInput);
    const effectiveMax = maxCheck.valid
      ? maxCheck.value
      : (state.examConfig && state.examConfig.configured ? Number(state.examConfig.maxMarks) : null);

    let totalStudents = state.students.length;
    let enteredCount = 0;
    let missingCount = 0;
    let draftCount = 0;
    let publishedCount = 0;
    let sumPct = 0;
    let pctCount = 0;

    for (const stu of state.students) {
      const rawVal = state.marksByStudentId[stu.studentId];
      const trimmed = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : '';
      if (trimmed === '') {
        missingCount += 1;
      } else {
        enteredCount += 1;
        if (stu.entryStatus === 'published') {
          publishedCount += 1;
        } else {
          draftCount += 1;
        }
        const pct = calculatePercentage(trimmed, effectiveMax);
        if (pct !== null) {
          sumPct += pct;
          pctCount += 1;
        }
      }
    }

    return {
      totalStudents,
      enteredCount,
      missingCount,
      draftCount,
      publishedCount,
      effectiveMax,
      averagePercentage: pctCount > 0 ? Math.round((sumPct / pctCount) * 100) / 100 : null
    };
  }

  function getFilteredStudents() {
    const query = String(state.studentSearchQuery || '').trim().toLowerCase();
    const filter = state.statusFilter || 'ALL';

    return (state.students || []).filter((stu) => {
      if (query) {
        const nameMatch = String(stu.name || '').toLowerCase().includes(query);
        const idMatch = String(stu.studentId || '').toLowerCase().includes(query);
        const userMatch = String(stu.username || '').toLowerCase().includes(query);
        if (!nameMatch && !idMatch && !userMatch) return false;
      }

      const rawVal = state.marksByStudentId[stu.studentId];
      const hasEnteredVal = rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '';
      const effectiveStatus = !hasEnteredVal
        ? 'MISSING'
        : stu.entryStatus === 'published'
        ? 'PUBLISHED'
        : 'DRAFT';

      if (filter === 'MISSING' && effectiveStatus !== 'MISSING') return false;
      if (filter === 'DRAFT' && effectiveStatus !== 'DRAFT') return false;
      if (filter === 'PUBLISHED' && effectiveStatus !== 'PUBLISHED') return false;
      return true;
    });
  }

  function injectStyles() {
    if (window.document.getElementById('sl-teacher-marks-styles')) return;
    const style = window.document.createElement('style');
    style.id = 'sl-teacher-marks-styles';
    style.textContent = `
      .sl-marks-root {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--teach-text-primary, var(--text, #111827));
      }
      .sl-marks-panel {
        background: var(--teach-surface, var(--surface, #ffffff));
        border: 1.5px solid var(--teach-border, var(--border, rgba(0, 0, 0, 0.13)));
        border-radius: 16px;
        padding: 22px 24px;
        margin-bottom: 20px;
      }
      .sl-marks-subject-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 20px;
        margin-bottom: 28px;
      }
      .sl-marks-subject-card {
        background: var(--teach-surface, var(--surface, #ffffff));
        border: 1.5px solid var(--teach-border, var(--border, rgba(0, 0, 0, 0.13)));
        border-radius: 20px;
        padding: 24px 26px;
        min-height: 160px;
        box-sizing: border-box;
        box-shadow: var(--teach-shadow-sm, 0 2px 6px rgba(0, 0, 0, 0.04));
        cursor: pointer;
        text-align: left;
        color: inherit;
        font-family: inherit;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
        width: 100%;
      }
      .sl-marks-subject-card:hover,
      .sl-marks-subject-card:focus-visible {
        border-color: var(--teach-text-primary, #111827);
        transform: translateY(-2px);
        box-shadow: var(--teach-shadow-md, 0 8px 24px -4px rgba(0, 0, 0, 0.12));
        outline: none;
      }
      .sl-marks-code-badge {
        font-size: 12px;
        font-weight: 700;
        padding: 4px 10px;
        border-radius: 7px;
        background: var(--teach-surface-subtle, #f3f4f6);
        border: 1px solid var(--teach-border, rgba(0, 0, 0, 0.1));
        color: var(--teach-text-primary, #111827);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .sl-marks-exam-tabs {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 20px;
      }
      .sl-marks-exam-tab {
        padding: 14px 16px;
        border-radius: 12px;
        border: 1.5px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface, #141414);
        color: var(--teach-text-secondary, #a3a3a3);
        font-family: inherit;
        cursor: pointer;
        text-align: left;
        transition: all 0.15s ease;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .sl-marks-exam-tab:hover {
        border-color: var(--teach-text-primary, #f5f5f5);
        color: var(--teach-text-primary, #f5f5f5);
      }
      .sl-marks-exam-tab.active {
        background: var(--teach-btn-primary-bg, #f5f5f5);
        color: var(--teach-btn-primary-text, #0a0a0a);
        border-color: var(--teach-btn-primary-bg, #f5f5f5);
      }
      .sl-marks-exam-tab-title {
        font-size: 0.92rem;
        font-weight: 800;
        letter-spacing: -0.01em;
      }
      .sl-marks-exam-tab-meta {
        font-size: 0.75rem;
        font-weight: 600;
        opacity: 0.82;
      }
      .sl-marks-stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }
      .sl-marks-stat-card {
        background: var(--teach-surface-subtle, #1c1c1c);
        border: 1px solid var(--teach-border-subtle, #242424);
        border-radius: 12px;
        padding: 13px 14px;
      }
      .sl-marks-stat-val {
        font-size: 1.35rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        line-height: 1.15;
      }
      .sl-marks-stat-lbl {
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--teach-text-secondary, #a3a3a3);
        margin-top: 4px;
      }
      .sl-marks-config-bar {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        padding: 16px 18px;
        border-radius: 12px;
        background: var(--teach-surface-subtle, #1c1c1c);
        border: 1px solid var(--teach-border, #2a2a2a);
        margin-bottom: 18px;
      }
      .sl-marks-input,
      .sl-marks-select {
        box-sizing: border-box;
        padding: 9px 12px;
        border-radius: 9px;
        border: 1.5px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface, #141414);
        color: var(--teach-text-primary, #f5f5f5);
        font-size: 0.9rem;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s ease;
      }
      .sl-marks-input:focus,
      .sl-marks-select:focus {
        border-color: var(--teach-text-primary, #ffffff);
      }
      .sl-marks-input.invalid {
        border-color: #ef4444 !important;
      }
      .sl-marks-table-wrap {
        width: 100%;
        overflow-x: auto;
        border: 1.5px solid var(--teach-border, #2a2a2a);
        border-radius: 14px;
        background: var(--teach-surface, #141414);
        -webkit-overflow-scrolling: touch;
      }
      .sl-marks-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.88rem;
        font-variant-numeric: tabular-nums;
      }
      .sl-marks-table th,
      .sl-marks-table td {
        padding: 12px 16px;
        border-bottom: 1px solid var(--teach-border-subtle, #242424);
        text-align: left;
        vertical-align: middle;
      }
      .sl-marks-table th {
        font-size: 0.74rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--teach-text-secondary, #a3a3a3);
        background: var(--teach-surface-subtle, #1c1c1c);
        white-space: nowrap;
      }
      .sl-marks-table tr:last-child td {
        border-bottom: none;
      }
      .sl-marks-table tr.missing-row {
        background: rgba(128, 128, 128, 0.03);
      }
      .sl-marks-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 0.74rem;
        font-weight: 700;
        border: 1px solid var(--teach-border, #2a2a2a);
        white-space: nowrap;
      }
      .sl-marks-badge.published {
        background: var(--teach-btn-primary-bg, #f5f5f5);
        color: var(--teach-btn-primary-text, #0a0a0a);
        border-color: var(--teach-btn-primary-bg, #f5f5f5);
      }
      .sl-marks-badge.draft {
        background: var(--teach-surface-subtle, #27272a);
        color: var(--teach-text-primary, #f5f5f5);
        border-color: var(--teach-border, #3f3f46);
      }
      .sl-marks-badge.missing {
        background: transparent;
        color: var(--teach-text-secondary, #a3a3a3);
        border-style: dashed;
      }
      .sl-marks-banner {
        border-radius: 12px;
        padding: 13px 16px;
        margin-bottom: 16px;
        font-size: 0.86rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        border: 1.5px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
      }
      .sl-marks-banner.error {
        border-color: #ef4444;
      }
      .sl-marks-actions-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 18px;
        padding-top: 16px;
        border-top: 1px solid var(--teach-border-subtle, #242424);
      }
      .sl-marks-filter-pill {
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: transparent;
        color: var(--teach-text-secondary, #a3a3a3);
        font-size: 0.76rem;
        font-weight: 700;
        cursor: pointer;
        font-family: inherit;
      }
      .sl-marks-filter-pill.active {
        background: var(--teach-btn-primary-bg, #f5f5f5);
        color: var(--teach-btn-primary-text, #0a0a0a);
        border-color: var(--teach-btn-primary-bg, #f5f5f5);
      }
      @media (max-width: 768px) {
        .sl-marks-panel {
          padding: 16px 14px;
        }
        .sl-marks-exam-tabs {
          grid-template-columns: 1fr;
        }
        .sl-marks-table th,
        .sl-marks-table td {
          padding: 10px 10px;
        }
      }
    `;
    window.document.head.appendChild(style);
  }

  async function loadContext() {
    state.loadingContext = true;
    state.contextError = null;
    render();

    try {
      const res = await authFetch('/api/marks/teacher/context');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Failed to load Marks Entry context.');
      }

      state.role = data.role || 'teacher';
      state.userId = data.userId || '';
      state.userName = data.name || '';
      state.subjects = Array.isArray(data.subjects) ? data.subjects : [];
      state.cohorts = Array.isArray(data.cohorts) ? data.cohorts : [];
      state.loadingContext = false;
      render();
    } catch (err) {
      state.loadingContext = false;
      state.contextError = err.message || 'Unable to load authorized subjects.';
      render();
    }
  }

  async function loadRoster() {
    if (!state.selectedSubjectId) {
      render();
      return;
    }

    state.loadingRoster = true;
    state.rosterError = null;
    state.rosterErrorCode = null;
    state.actionError = null;
    render();

    try {
      const params = new window.URLSearchParams();
      params.set('subjectId', state.selectedSubjectId);
      params.set('examType', state.selectedExamType);
      if (state.selectedCohortId) {
        params.set('cohortId', state.selectedCohortId);
      }

      const res = await authFetch(`/api/marks/roster?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.message || 'Failed to load student marks register.');
        err.code = data.code || (res.status === 403 ? 'FORBIDDEN' : res.status === 400 ? 'INVALID_REQUEST' : 'ROSTER_LOAD_FAILED');
        err.status = res.status;
        throw err;
      }

      applyRosterDataToState(data);
      state.loadingRoster = false;
      render();
    } catch (err) {
      state.loadingRoster = false;
      state.rosterErrorCode = err.code || null;
      state.rosterError = err.message || 'Failed to load student marks register.';
      render();
    }
  }

  function applyRosterDataToState(data, options = {}) {
    state.rosterSubject = data.subject || null;
    state.rosterCohort = data.cohort || null;
    state.examConfig = data.examConfig || null;
    state.configsByExamType = data.configsByExamType || {};
    state.students = Array.isArray(data.students) ? data.students : [];
    state.summary = data.summary || null;

    const maxVal = state.examConfig && state.examConfig.configured && state.examConfig.maxMarks !== null
      ? String(state.examConfig.maxMarks)
      : '';
    state.maxMarksInput = maxVal;
    state.initialMaxMarksSnapshot = maxVal;

    const marksMap = {};
    for (const stu of state.students) {
      marksMap[stu.studentId] =
        stu.obtainedMarks !== null && stu.obtainedMarks !== undefined
          ? String(stu.obtainedMarks)
          : '';
    }
    state.marksByStudentId = marksMap;
    state.initialMarksSnapshot = JSON.stringify(marksMap);
    state.validationErrorsByStudentId = {};
    state.maxMarksValidationError = null;
    if (options.resetEditingPublished !== false) {
      state.isEditingPublished = false;
    }
  }

  async function selectSubject(subjectId, examType = null) {
    if (!confirmDiscardIfDirty()) return;
    state.selectedSubjectId = subjectId ? String(subjectId).trim() : '';
    state.selectedCohortId = '';
    if (examType && EXAM_TYPES.includes(examType)) {
      state.selectedExamType = examType;
    }
    state.actionSuccessMessage = null;
    state.actionError = null;
    state.studentSearchQuery = '';
    state.statusFilter = 'ALL';

    if (typeof window !== 'undefined' && window.location && window.history && typeof window.history.replaceState === 'function') {
      try {
        const url = new window.URL(window.location.href);
        if (state.selectedSubjectId) {
          url.searchParams.set('subject', state.selectedSubjectId);
        } else {
          url.searchParams.delete('subject');
          url.searchParams.delete('subjectId');
        }
        window.history.replaceState({}, '', url.toString());
      } catch (_) {}
    }

    if (!state.selectedSubjectId) {
      render();
      return;
    }
    await loadRoster();
  }

  async function selectExamType(examType) {
    if (!EXAM_TYPES.includes(examType)) return;
    if (state.selectedExamType === examType) return;
    if (!confirmDiscardIfDirty()) return;
    state.selectedExamType = examType;
    state.actionSuccessMessage = null;
    state.actionError = null;
    state.isEditingPublished = false;
    await loadRoster();
  }

  function setMaxMarksInput(val) {
    state.maxMarksInput = String(val === null || val === undefined ? '' : val);
    runAllClientValidations();
  }

  function setStudentMark(studentId, rawVal) {
    const isLockedPublished =
      state.summary &&
      state.summary.isPublished &&
      !state.isEditingPublished;
    if (isLockedPublished) return;

    const maxCheck = validateMaxMarksValue(state.maxMarksInput);
    const effectiveMax = maxCheck.valid
      ? maxCheck.value
      : state.examConfig && state.examConfig.configured
      ? Number(state.examConfig.maxMarks)
      : null;
    if (effectiveMax === null || effectiveMax <= 0) return;

    state.marksByStudentId[studentId] = rawVal === null || rawVal === undefined ? '' : String(rawVal);
    runAllClientValidations();
  }

  async function saveExamConfig(silent = false) {
    if (!state.selectedSubjectId) return false;
    const maxCheck = validateMaxMarksValue(state.maxMarksInput);
    state.maxMarksValidationError = maxCheck.error;
    if (!maxCheck.valid) {
      if (!silent) {
        state.actionError = maxCheck.error;
        render();
      }
      return false;
    }

    state.savingConfig = true;
    if (!silent) {
      state.actionError = null;
      state.actionSuccessMessage = null;
      render();
    }

    try {
      const res = await authFetch('/api/marks/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: state.selectedSubjectId,
          examType: state.selectedExamType,
          maxMarks: maxCheck.value
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update exam configuration.');
      }

      state.examConfig = data.config || state.examConfig;
      if (data.config) {
        state.configsByExamType = {
          ...(state.configsByExamType || {}),
          [state.selectedExamType]: data.config
        };
      }
      if (data.config && data.config.maxMarks) {
        state.maxMarksInput = String(data.config.maxMarks);
        state.initialMaxMarksSnapshot = String(data.config.maxMarks);
      }
      state.savingConfig = false;
      runAllClientValidations();
      if (!silent) {
        state.actionSuccessMessage = `Maximum marks configured to ${maxCheck.value} for ${state.selectedExamType}.`;
        await refreshSubjectCardsInBackground();
        render();
      } else {
        await refreshSubjectCardsInBackground();
      }
      return true;
    } catch (err) {
      state.savingConfig = false;
      if (!silent) {
        state.actionError = err.message || 'Failed to save exam configuration.';
        render();
      }
      return false;
    }
  }

  function buildRecordsPayload() {
    return (state.students || []).map((stu) => {
      const raw = state.marksByStudentId[stu.studentId];
      const trimmed = raw !== undefined && raw !== null ? String(raw).trim() : '';
      return {
        studentId: stu.studentId,
        obtainedMarks: trimmed === '' ? null : Number(trimmed)
      };
    });
  }

  async function saveDraft(silent = false) {
    if (!state.selectedSubjectId) return false;
    const validation = runAllClientValidations();
    if (!validation.valid) {
      if (!silent) {
        state.actionError = state.maxMarksValidationError || 'Please fix validation errors in the marks table before saving.';
        render();
      }
      return false;
    }

    state.savingDraft = true;
    if (!silent) {
      state.actionError = null;
      state.actionSuccessMessage = null;
      render();
    }

    try {
      const records = buildRecordsPayload();
      const res = await authFetch('/api/marks/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: state.selectedSubjectId,
          examType: state.selectedExamType,
          cohortId: state.selectedCohortId || null,
          maxMarks: validation.maxMarks,
          records,
          editPublished: state.isEditingPublished,
          reason: state.editReason || null
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Failed to save draft marks.');
      }

      applyRosterDataToState(data, { resetEditingPublished: false });
      state.savingDraft = false;
      if (!silent) {
        state.actionSuccessMessage = `Draft marks saved for ${state.selectedExamType}.`;
        await refreshSubjectCardsInBackground();
        render();
      } else {
        await refreshSubjectCardsInBackground();
      }
      return true;
    } catch (err) {
      state.savingDraft = false;
      if (!silent) {
        state.actionError = err.message || 'Failed to save draft marks.';
        render();
      }
      return false;
    }
  }

  let marksAutoSaveTimer = null;
  let maxMarksSaveTimer = null;

  async function triggerAutoSaveMarks() {
    if (marksAutoSaveTimer) {
      clearTimeout(marksAutoSaveTimer);
      marksAutoSaveTimer = null;
    }
    if (!state.selectedSubjectId) return;
    const validation = runAllClientValidations();
    if (!validation.valid) return;

    const currentMarksJson = JSON.stringify(state.marksByStudentId || {});
    if (currentMarksJson === state.initialMarksSnapshot) return;

    const statusBar = state.containerEl ? state.containerEl.querySelector('#slMarksStatusBar') : null;
    if (statusBar) statusBar.textContent = 'Saving marks automatically…';

    const success = await saveDraft(true);
    if (statusBar) {
      const metrics = getLiveTableMetrics();
      if (success) {
        statusBar.textContent =
          metrics.missingCount > 0
            ? `${metrics.missingCount} student(s) currently have missing marks.`
            : 'All enrolled students have marks recorded and saved.';
      } else {
        statusBar.textContent = 'Auto-save failed. Check connection.';
      }
    }
  }

  async function triggerAutoSaveMaxMarks() {
    if (maxMarksSaveTimer) {
      clearTimeout(maxMarksSaveTimer);
      maxMarksSaveTimer = null;
    }
    const val = state.maxMarksInput;
    const check = validateMaxMarksValue(val);
    const statusEl = state.containerEl ? state.containerEl.querySelector('#slMarksMaxSaveStatus') : null;

    if (!check.valid) {
      state.maxMarksValidationError = check.error;
      const input = state.containerEl ? state.containerEl.querySelector('#slMarksMaxInput') : null;
      if (input) input.classList.add('invalid');
      if (statusEl) statusEl.textContent = '';
      return;
    }

    if (statusEl) statusEl.textContent = 'Saving…';

    const success = await saveExamConfig(true);
    if (statusEl) {
      statusEl.textContent = success ? 'Saved' : '';
      if (success) {
        setTimeout(() => {
          if (statusEl && statusEl.textContent === 'Saved') statusEl.textContent = '';
        }, 2000);
      }
    }
    updateMaxMarksInView();
  }

  function updateMaxMarksInView() {
    if (!state.containerEl) return;
    const maxCheck = validateMaxMarksValue(state.maxMarksInput);
    const effectiveMax = maxCheck.valid
      ? maxCheck.value
      : state.examConfig && state.examConfig.maxMarks
      ? Number(state.examConfig.maxMarks)
      : null;
    const isLockedPublished = Boolean(state.summary && (state.summary.isPublished || state.summary.hasPublishedMarks)) && !state.isEditingPublished;
    const activeTab = state.containerEl.querySelector('.sl-marks-exam-tab.active .sl-marks-exam-tab-meta');
    if (activeTab) {
      activeTab.textContent = effectiveMax !== null ? `Max Marks: ${effectiveMax}` : 'Max Marks Not Configured';
    }
    state.containerEl.querySelectorAll('[data-marks-max-col]').forEach((td) => {
      td.textContent = effectiveMax !== null ? String(effectiveMax) : '—';
    });
    state.containerEl.querySelectorAll('[data-marks-student-input]').forEach((inp) => {
      if (effectiveMax !== null && effectiveMax > 0) {
        inp.setAttribute('max', String(effectiveMax));
        inp.setAttribute('placeholder', 'Missing');
        if (!isLockedPublished) {
          inp.removeAttribute('disabled');
        }
      } else {
        inp.removeAttribute('max');
        inp.setAttribute('placeholder', 'Enter max marks first');
        inp.setAttribute('disabled', 'disabled');
      }
      const sId = inp.getAttribute('data-marks-student-input');
      updateStudentRowLive(sId);
    });

    const pubBtn = state.containerEl.querySelector('[data-marks-action="publish-results"]');
    if (pubBtn && !isLockedPublished) {
      if (effectiveMax !== null && effectiveMax > 0 && !state.publishing && !state.savingDraft) {
        pubBtn.removeAttribute('disabled');
      } else {
        pubBtn.setAttribute('disabled', 'disabled');
      }
    }
  }

  function updateStudentRowLive(studentId) {
    if (!state.containerEl) return;
    const row = state.containerEl.querySelector(`[data-student-row="${studentId}"]`);
    if (!row) return;

    const rawMark = state.marksByStudentId[studentId] ?? '';
    const trimmed = String(rawMark).trim();
    const isMissing = trimmed === '';
    const maxCheck = validateMaxMarksValue(state.maxMarksInput);
    const effectiveMax = maxCheck.valid
      ? maxCheck.value
      : state.examConfig && state.examConfig.configured
      ? Number(state.examConfig.maxMarks)
      : null;

    const markCheck = validateStudentMarkValue(rawMark, effectiveMax);
    const rowError = markCheck.valid ? null : markCheck.error;
    const pct = !isMissing && !rowError ? calculatePercentage(trimmed, effectiveMax) : null;

    const input = row.querySelector('[data-marks-student-input]');
    if (input) {
      if (rowError) {
        input.classList.add('invalid');
      } else {
        input.classList.remove('invalid');
      }
    }

    let errDiv = row.querySelector('.sl-marks-row-error');
    if (rowError) {
      if (!errDiv) {
        errDiv = window.document.createElement('div');
        errDiv.className = 'sl-marks-row-error';
        errDiv.style.cssText = 'font-size:0.72rem; color:#ef4444; margin-top:4px; font-weight:600;';
        if (input && input.parentElement) input.parentElement.appendChild(errDiv);
      }
      errDiv.textContent = rowError;
    } else if (errDiv) {
      errDiv.remove();
    }

    const pctCell = row.querySelector('[data-marks-pct-col]');
    if (pctCell) {
      pctCell.innerHTML = renderPassFail(pct);
    }

    const badge = row.querySelector('[data-student-status]');
    if (badge) {
      const stu = (state.students || []).find((s) => s.studentId === studentId);
      if (isMissing) {
        badge.className = 'sl-marks-badge missing';
        badge.textContent = 'Missing Marks';
        row.classList.add('missing-row');
      } else {
        badge.className = 'sl-marks-badge published';
        badge.textContent = stu && stu.entryStatus === 'published' && String(stu.obtainedMarks ?? '') === trimmed ? 'Published' : 'Saved';
        row.classList.remove('missing-row');
      }
    }

    updateFilterCountsInToolbar();
  }

  function updateFilterCountsInToolbar() {
    if (!state.containerEl) return;
    const metrics = getLiveTableMetrics();
    const allBtn = state.containerEl.querySelector('[data-marks-status-filter="ALL"]');
    if (allBtn) allBtn.textContent = `All (${metrics.totalStudents})`;
    const missingBtn = state.containerEl.querySelector('[data-marks-status-filter="MISSING"]');
    if (missingBtn) missingBtn.textContent = `Missing (${metrics.missingCount})`;
    const pubBtn = state.containerEl.querySelector('[data-marks-status-filter="PUBLISHED"]');
    if (pubBtn) pubBtn.textContent = `Published (${metrics.publishedCount})`;
  }

  async function publishResults() {
    if (!state.selectedSubjectId) return;
    const validation = runAllClientValidations();
    if (!validation.valid) {
      state.actionError = state.maxMarksValidationError || 'Please fix validation errors before publishing results.';
      render();
      return;
    }

    const metrics = getLiveTableMetrics();
    if (metrics.enteredCount === 0) {
      state.actionError = 'Please enter marks for at least one student before publishing results.';
      render();
      return;
    }

    state.publishing = true;
    state.actionError = null;
    state.actionSuccessMessage = null;
    render();

    try {
      const records = buildRecordsPayload();
      const res = await authFetch('/api/marks/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: state.selectedSubjectId,
          examType: state.selectedExamType,
          cohortId: state.selectedCohortId || null,
          maxMarks: validation.maxMarks,
          records,
          reason: state.editReason || `Published ${state.selectedExamType} results`
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Failed to publish results.');
      }

      applyRosterDataToState(data);
      state.publishing = false;
      state.actionSuccessMessage = `${state.selectedExamType} results published (${data.summary ? data.summary.publishedCount : metrics.enteredCount} students).`;
      await refreshSubjectCardsInBackground();
      render();
    } catch (err) {
      state.publishing = false;
      state.actionError = err.message || 'Failed to publish results.';
      render();
    }
  }

  async function savePublishedEdits() {
    if (!state.selectedSubjectId) return;
    const validation = runAllClientValidations();
    if (!validation.valid) {
      state.actionError = state.maxMarksValidationError || 'Please fix validation errors before saving published changes.';
      render();
      return;
    }

    state.savingDraft = true;
    state.actionError = null;
    state.actionSuccessMessage = null;
    render();

    try {
      const records = buildRecordsPayload();
      const res = await authFetch('/api/marks/published', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: state.selectedSubjectId,
          examType: state.selectedExamType,
          cohortId: state.selectedCohortId || null,
          maxMarks: validation.maxMarks,
          records,
          editPublished: true,
          publish: true,
          reason: state.editReason || `Authorized update to published ${state.selectedExamType} results`
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update published results.');
      }

      applyRosterDataToState(data, { resetEditingPublished: false });
      state.savingDraft = false;
      state.isEditingPublished = false;
      state.editReason = '';
      state.actionSuccessMessage = `Published ${state.selectedExamType} marks updated and recorded in the audit log.`;
      await refreshSubjectCardsInBackground();
      render();
    } catch (err) {
      state.savingDraft = false;
      state.actionError = err.message || 'Failed to update published results.';
      render();
    }
  }

  async function openAuditModal() {
    if (!state.selectedSubjectId) return;
    state.auditModalOpen = true;
    state.loadingAudit = true;
    render();

    try {
      const params = new window.URLSearchParams({
        subjectId: state.selectedSubjectId,
        examType: state.selectedExamType
      });
      const res = await authFetch(`/api/marks/audit?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      state.auditLogs = Array.isArray(data.logs) ? data.logs : [];
      state.loadingAudit = false;
      render();
    } catch (_) {
      state.auditLogs = [];
      state.loadingAudit = false;
      render();
    }
  }

  function closeAuditModal() {
    state.auditModalOpen = false;
    render();
  }

  async function refreshSubjectCardsInBackground() {
    try {
      const res = await authFetch('/api/marks/teacher/context');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.subjects)) {
          state.subjects = data.subjects;
        }
      }
    } catch (_) {}
  }

  function renderSubjectLanding() {
    if (state.loadingContext) {
      return `
        <div class="sl-marks-panel" style="text-align:center; padding:48px 24px;">
          <div style="font-size:1.05rem; font-weight:700; margin-bottom:6px;">Loading Authorized Subjects…</div>
          <div style="font-size:0.86rem; color:var(--teach-text-secondary, #a3a3a3);">
            Fetching your assigned courses and exam configurations.
          </div>
        </div>
      `;
    }

    if (state.contextError) {
      return `
        <div class="sl-marks-panel" role="alert" style="text-align:center; padding:40px 24px;">
          <div style="font-size:1.08rem; font-weight:800; margin-bottom:8px;">Could Not Load Subjects</div>
          <div style="font-size:0.88rem; color:var(--teach-text-secondary, #a3a3a3); max-width:460px; margin:0 auto 18px;">
            ${escapeHtml(state.contextError)}
          </div>
          <button type="button" class="teach-btn teach-btn-primary" data-marks-action="retry-context">Retry</button>
        </div>
      `;
    }

    if (!state.subjects.length) {
      return `
        <div class="sl-marks-panel" style="text-align:center; padding:48px 24px;" id="slMarksSubjectLanding">
          <div style="font-size:1.1rem; font-weight:800; margin-bottom:8px;">No Subjects Assigned</div>
          <div style="font-size:0.88rem; color:var(--teach-text-secondary, #a3a3a3); max-width:480px; margin:0 auto;">
            Your faculty account does not have any active subjects assigned yet. Contact an administrator to assign your teaching subjects.
          </div>
        </div>
      `;
    }

    return `
      <div id="slMarksSubjectLanding">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
          <div>
            <h2 style="margin:0 0 4px; font-size:1.2rem; font-weight:800; letter-spacing:-0.02em;">
              Select a Subject for Marks Entry
            </h2>
            <p style="margin:0; font-size:0.85rem; color:var(--teach-text-secondary, #a3a3a3);">
              Choose one of your authorized subjects to configure exam maximum marks, save draft marks, or publish results.
            </p>
          </div>
        </div>

        <div class="sl-marks-subject-grid">
          ${state.subjects
            .map((sub) => {
              return `
                <button
                  type="button"
                  class="sl-marks-subject-card"
                  data-marks-select-subject="${escapeHtml(sub.id)}"
                >
                  <div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px;">
                      <span class="sl-marks-code-badge">${escapeHtml(sub.code || sub.id)}</span>
                      <span style="font-size:12px; font-weight:700; color:var(--teach-text-secondary, #a3a3a3);">
                        Semester ${escapeHtml(sub.semester)}
                      </span>
                    </div>
                    <div style="font-size:1.12rem; font-weight:800; letter-spacing:-0.02em; margin-bottom:14px; line-height:1.35;">
                      ${escapeHtml(sub.name)}
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; justify-content:space-between; padding-top:12px; border-top:1px solid var(--teach-border-subtle, rgba(128,128,128,0.15)); font-size:0.8rem; font-weight:700;">
                    <span style="color:var(--teach-text-secondary, #a3a3a3);">${escapeHtml(sub.department || 'BIT')}</span>
                    <span>Open Marks Entry &rarr;</span>
                  </div>
                </button>
              `;
            })
            .join('')}
        </div>
      </div>
    `;
  }

  function renderWorkspace() {
    const selectedSubj = getSelectedSubjectObj();
    const metrics = getLiveTableMetrics();
    const filteredStudents = getFilteredStudents();
    const isPublished = Boolean(
      state.summary && (state.summary.isPublished || state.summary.hasPublishedMarks)
    );
    const isLockedPublished = isPublished && !state.isEditingPublished;
    const hasConfiguredMax = metrics.effectiveMax !== null && metrics.effectiveMax > 0;
    const dirty = hasUnsavedChanges();

    return `
      <div id="slMarksEntrySection">
        <!-- Top Navigation -->
        <div class="sl-marks-panel" style="padding:16px 20px;">
          <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
            <button type="button" class="teach-btn teach-btn-secondary" data-marks-action="back-to-subjects">
              &larr; All Subjects
            </button>
            <div>
              <div style="font-size:0.74rem; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:var(--teach-text-secondary, #a3a3a3);">
                ${selectedSubj ? `${escapeHtml(selectedSubj.code)} · Semester ${escapeHtml(selectedSubj.semester)}` : 'Subject Marks Register'}
              </div>
              <h2 style="margin:2px 0 0; font-size:1.25rem; font-weight:800; letter-spacing:-0.02em;">
                ${selectedSubj ? escapeHtml(selectedSubj.name) : ''}
              </h2>
            </div>
          </div>
        </div>

        <!-- Exam Selection Tabs (Mid-Term Exam, Pre-Board Exam, Final Exam) -->
        <div class="sl-marks-exam-tabs" role="tablist" aria-label="Select Exam Type">
          ${EXAM_TYPES.map((examType) => {
            const isActive = state.selectedExamType === examType;
            const cfg = state.configsByExamType && state.configsByExamType[examType];
            const metaText = cfg && cfg.configured
              ? `Max Marks: ${cfg.maxMarks}`
              : 'Max Marks Not Configured';
            return `
              <button
                type="button"
                role="tab"
                aria-selected="${isActive ? 'true' : 'false'}"
                class="sl-marks-exam-tab ${isActive ? 'active' : ''}"
                data-marks-select-exam="${escapeHtml(examType)}"
              >
                <span class="sl-marks-exam-tab-title">${escapeHtml(examType)}</span>
                <span class="sl-marks-exam-tab-meta">${escapeHtml(metaText)}</span>
              </button>
            `;
          }).join('')}
        </div>

        ${
          state.loadingRoster
            ? `
          <div class="sl-marks-panel" style="text-align:center; padding:44px 24px;">
            <div style="font-size:1.02rem; font-weight:700; margin-bottom:6px;">
              Loading ${escapeHtml(state.selectedExamType)} Register…
            </div>
            <div style="font-size:0.85rem; color:var(--teach-text-secondary, #a3a3a3);">
              Fetching enrolled students, exam configuration, and saved marks.
            </div>
          </div>
        `
            : state.rosterError
            ? `
          <div class="sl-marks-panel" role="alert" style="text-align:center; padding:40px 24px;">
            <div style="font-size:1.05rem; font-weight:800; margin-bottom:8px;">
              ${
                state.rosterErrorCode === 'UNAUTHORIZED_SUBJECT' || state.rosterErrorCode === 'FORBIDDEN'
                  ? 'Subject Access Restricted'
                  : state.rosterErrorCode === 'INVALID_REQUEST' || state.rosterErrorCode === 'INVALID_EXAM_TYPE'
                  ? 'Invalid Marks Register Request'
                  : 'Could Not Load Marks Register'
              }
            </div>
            <div style="font-size:0.88rem; color:var(--teach-text-secondary, #a3a3a3); margin-bottom:16px;">
              ${escapeHtml(state.rosterError)}
            </div>
            <button type="button" class="teach-btn teach-btn-primary" data-marks-action="retry-roster">Retry</button>
          </div>
        `
            : `
          <div class="sl-marks-panel">
            <!-- Feedback Banners -->
            ${
              state.actionError
                ? `
              <div class="sl-marks-banner error" role="alert">
                <div><strong>Validation / Save Error:</strong> ${escapeHtml(state.actionError)}</div>
              </div>
            `
                : ''
            }
            ${
              state.actionSuccessMessage
                ? `
              <div class="sl-marks-banner" role="status">
                <div><strong>Success:</strong> ${escapeHtml(state.actionSuccessMessage)}</div>
              </div>
            `
                : ''
            }

            ${
              isLockedPublished
                ? `
              <!-- Published View: Only show "Marks Published", result summary text, and "Edit Marks" button -->
              <div class="sl-marks-banner" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:18px 20px;">
                <div style="display:flex; align-items:center; gap:12px;">
                  <span class="sl-marks-badge published" style="font-size:0.86rem; padding:4px 14px; font-weight:700;">Marks Published</span>
                  <span style="font-size:0.9rem; color:var(--teach-text-secondary, #a3a3a3);">
                    Results for ${escapeHtml(state.selectedExamType)} are published.
                  </span>
                </div>
                <div>
                  <button type="button" class="teach-btn teach-btn-secondary" data-marks-action="enable-published-edit">
                    Edit Marks
                  </button>
                </div>
              </div>
            `
                : `
              <!-- Editing Mode or Unpublished View -->
              ${
                isPublished
                  ? `
                <div class="sl-marks-banner" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:12px 18px;">
                  <div style="display:flex; align-items:center; gap:10px;">
                    <span class="sl-marks-badge published" style="font-size:0.84rem; padding:4px 14px; font-weight:700;">Marks Published</span>
                    <span style="font-size:0.85rem; color:var(--teach-text-secondary, #a3a3a3);">
                      Editing mode active. Marks are saved online and will update for students when published.
                    </span>
                  </div>
                  <div>
                    <button type="button" class="teach-btn teach-btn-secondary" data-marks-action="cancel-published-edit">
                      Done Editing
                    </button>
                  </div>
                </div>
              `
                  : ''
              }

              <!-- Exam Configuration Bar -->
              <div class="sl-marks-config-bar" style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
                <div style="font-size:0.8rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em;">
                  Exam Configuration &middot; ${escapeHtml(state.selectedExamType)}
                </div>

                <div style="display:flex; align-items:center; gap:8px;">
                  <input
                    id="slMarksMaxInput"
                    type="number"
                    min="1"
                    step="any"
                    class="sl-marks-input ${state.maxMarksValidationError ? 'invalid' : ''}"
                    placeholder=""
                    value="${escapeHtml(state.maxMarksInput)}"
                    data-marks-field="max-marks"
                    aria-label="Maximum Marks"
                    style="width:130px;"
                  />
                  <span id="slMarksMaxSaveStatus" style="font-size:0.75rem; font-weight:600; color:var(--teach-text-secondary, #a3a3a3); min-width:44px;"></span>
                </div>
              </div>

              <!-- Search & Status Filter Toolbar -->
              <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
                <input
                  type="search"
                  class="sl-marks-input"
                  placeholder="Search student by name or roll / ID…"
                  value="${escapeHtml(state.studentSearchQuery)}"
                  data-marks-field="student-search"
                  style="min-width:250px; flex:1; max-width:380px;"
                />
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  ${[
                    { id: 'ALL', label: `All (${metrics.totalStudents})` },
                    { id: 'MISSING', label: `Missing (${metrics.missingCount})` },
                    { id: 'PUBLISHED', label: `Published (${metrics.publishedCount})` }
                  ]
                    .map(
                      (f) => `
                    <button
                      type="button"
                      class="sl-marks-filter-pill ${state.statusFilter === f.id ? 'active' : ''}"
                      data-marks-status-filter="${f.id}"
                    >
                      ${escapeHtml(f.label)}
                    </button>
                  `
                    )
                    .join('')}
                </div>
              </div>

              <!-- Student Marks Entry Table -->
              ${
                state.students.length === 0
                  ? `
                <div style="text-align:center; padding:36px 20px; border:1px dashed var(--teach-border, #2a2a2a); border-radius:12px;">
                  <div style="font-weight:700; margin-bottom:6px;">No Enrolled Students Found</div>
                  <div style="font-size:0.85rem; color:var(--teach-text-secondary, #a3a3a3);">
                    No active students are currently enrolled in Semester ${escapeHtml(selectedSubj ? selectedSubj.semester : '')}.
                  </div>
                </div>
              `
                  : filteredStudents.length === 0
                  ? `
                <div style="text-align:center; padding:32px 20px; border:1px dashed var(--teach-border, #2a2a2a); border-radius:12px;">
                  <div style="font-weight:700; margin-bottom:4px;">No Matching Students</div>
                  <div style="font-size:0.84rem; color:var(--teach-text-secondary, #a3a3a3);">
                    Try clearing your search or status filter.
                  </div>
                </div>
              `
                  : `
                <div class="sl-marks-table-wrap">
                  <table class="sl-marks-table" id="slMarksEntryTable">
                    <thead>
                      <tr>
                        <th style="width:48px;">#</th>
                        <th>Student Name</th>
                        <th>Roll No / Student ID</th>
                        <th style="width:170px;">Obtained Marks</th>
                        <th style="width:130px;">Maximum Marks</th>
                        <th style="width:130px;">Pass / Fail</th>
                        <th style="width:150px;">Entry Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${filteredStudents
                        .map((stu, idx) => {
                          const rawMark = state.marksByStudentId[stu.studentId] ?? '';
                          const trimmed = String(rawMark).trim();
                          const isMissing = trimmed === '';
                          const rowError = state.validationErrorsByStudentId[stu.studentId] || null;
                          const pct = !isMissing && !rowError
                            ? calculatePercentage(trimmed, metrics.effectiveMax)
                            : null;

                          const badgeClass = isMissing ? 'missing' : 'published';
                          const badgeText = isMissing
                            ? 'Missing Marks'
                            : stu.entryStatus === 'published' && String(stu.obtainedMarks ?? '') === trimmed
                            ? 'Published'
                            : 'Saved';

                          return `
                            <tr class="${isMissing ? 'missing-row' : ''}" data-student-row="${escapeHtml(stu.studentId)}">
                              <td style="color:var(--teach-text-secondary, #a3a3a3); font-weight:600;">${idx + 1}</td>
                              <td>
                                <div style="font-weight:700;">${escapeHtml(stu.name)}</div>
                              </td>
                              <td style="font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:0.83rem;">
                                ${escapeHtml(stu.rollNumber || stu.studentId)}
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  ${metrics.effectiveMax !== null ? `max="${escapeHtml(metrics.effectiveMax)}"` : ''}
                                  step="any"
                                  class="sl-marks-input ${rowError ? 'invalid' : ''}"
                                  placeholder="${!hasConfiguredMax ? 'Enter max marks first' : 'Missing'}"
                                  value="${escapeHtml(rawMark)}"
                                  data-marks-student-input="${escapeHtml(stu.studentId)}"
                                  ${!hasConfiguredMax ? 'disabled' : ''}
                                  style="width:130px;"
                                />
                                ${
                                  rowError
                                    ? `<div class="sl-marks-row-error" style="font-size:0.72rem; color:#ef4444; margin-top:4px; font-weight:600;">${escapeHtml(rowError)}</div>`
                                    : ''
                                }
                              </td>
                              <td style="font-weight:700;" data-marks-max-col>
                                ${metrics.effectiveMax !== null ? escapeHtml(metrics.effectiveMax) : '—'}
                              </td>
                              <td style="font-weight:800;" data-marks-pct-col>
                                ${renderPassFail(pct)}
                              </td>
                              <td>
                                <span class="sl-marks-badge ${badgeClass}" data-student-status="${escapeHtml(stu.studentId)}">
                                  ${escapeHtml(badgeText)}
                                </span>
                              </td>
                            </tr>
                          `;
                        })
                        .join('')}
                    </tbody>
                  </table>
                </div>
              `
              }

              <!-- Bottom Actions Bar -->
              <div class="sl-marks-actions-bar">
                <div style="font-size:0.82rem; color:var(--teach-text-secondary, #a3a3a3);" id="slMarksStatusBar">
                  ${
                    !hasConfiguredMax
                      ? ''
                      : state.savingDraft
                      ? 'Saving marks automatically…'
                      : metrics.missingCount > 0
                      ? `${metrics.missingCount} student(s) currently have missing marks.`
                      : 'All enrolled students have marks recorded and saved.'
                  }
                </div>

                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                  <button
                    type="button"
                    class="teach-btn teach-btn-primary"
                    data-marks-action="publish-results"
                    ${!hasConfiguredMax || state.savingDraft || state.publishing ? 'disabled' : ''}
                  >
                    ${state.publishing ? 'Publishing…' : 'Publish Results'}
                  </button>
                </div>
              </div>
            `
            }
          </div>
        `
        }

        ${renderAuditModal()}
      </div>
    `;
  }

  function renderAuditModal() {
    if (!state.auditModalOpen) return '';
    return `
      <div class="teach-modal-overlay open" id="slMarksAuditModal" role="dialog" aria-modal="true" aria-label="Marks Audit Log">
        <div class="teach-modal-card" style="max-width:640px; max-height:80vh; overflow-y:auto;">
          <div class="teach-modal-header">
            <h3 class="teach-modal-title">Marks Audit History &middot; ${escapeHtml(state.selectedExamType)}</h3>
            <button type="button" class="teach-modal-close" data-marks-action="close-audit" aria-label="Close">&times;</button>
          </div>
          ${
            state.loadingAudit
              ? `<div style="padding:24px; text-align:center;">Loading audit trail…</div>`
              : state.auditLogs.length === 0
              ? `<div style="padding:24px; text-align:center; color:var(--teach-text-secondary, #a3a3a3);">No audit entries recorded yet for this subject and exam.</div>`
              : `
                <div style="display:flex; flex-direction:column; gap:10px;">
                  ${state.auditLogs
                    .map(
                      (log) => `
                    <div style="padding:12px 14px; border-radius:10px; border:1px solid var(--teach-border, #2a2a2a); background:var(--teach-surface-subtle, #1c1c1c);">
                      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px;">
                        <strong style="font-size:0.85rem;">${escapeHtml(log.action)}</strong>
                        <span style="font-size:0.75rem; color:var(--teach-text-secondary, #a3a3a3);">${escapeHtml(formatTimestamp(log.createdAt))}</span>
                      </div>
                      <div style="font-size:0.8rem; color:var(--teach-text-secondary, #a3a3a3);">
                        By: <strong>${escapeHtml(log.actorName || log.actorUserId)}</strong> (${escapeHtml(log.actorRole)})
                        ${log.reason ? `&middot; Reason: ${escapeHtml(log.reason)}` : ''}
                      </div>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              `
          }
        </div>
      </div>
    `;
  }

  function updateHeroBannerVisibility() {
    if (typeof window === 'undefined' || !window.document || typeof window.document.getElementById !== 'function') return;
    const hero = window.document.getElementById('marksHeroBanner');
    if (!hero) return;
    if (state.selectedSubjectId) {
      if (hero.style && typeof hero.style.setProperty === 'function') {
        hero.style.setProperty('display', 'none', 'important');
      } else {
        hero.style.display = 'none';
      }
    } else {
      if (hero.style && typeof hero.style.removeProperty === 'function') {
        hero.style.removeProperty('display');
      } else {
        hero.style.display = '';
      }
    }
  }

  function render() {
    updateHeroBannerVisibility();
    const container = state.containerEl;
    if (!container) return;

    container.innerHTML = `
      <div class="sl-marks-root">
        ${state.selectedSubjectId ? renderWorkspace() : renderSubjectLanding()}
      </div>
    `;

    bindEvents(container);
  }

  function bindEvents(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return;

    container.querySelectorAll('[data-marks-select-subject]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const subjId = btn.getAttribute('data-marks-select-subject');
        selectSubject(subjId);
      });
    });

    container.querySelectorAll('[data-marks-select-exam]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const exam = btn.getAttribute('data-marks-select-exam');
        selectExamType(exam);
      });
    });

    const subjSelect = container.querySelector('[data-marks-field="subject-select"]');
    if (subjSelect) {
      subjSelect.addEventListener('change', (e) => {
        const nextSubj = e.target.value;
        if (!confirmDiscardIfDirty()) {
          e.target.value = state.selectedSubjectId;
          return;
        }
        selectSubject(nextSubj, state.selectedExamType);
      });
    }

    const maxInput = container.querySelector('[data-marks-field="max-marks"]');
    if (maxInput) {
      maxInput.addEventListener('input', (e) => {
        setMaxMarksInput(e.target.value);
        updateMaxMarksInView();
        if (maxMarksSaveTimer) clearTimeout(maxMarksSaveTimer);
        const check = validateMaxMarksValue(e.target.value);
        if (check.valid) {
          maxInput.classList.remove('invalid');
          maxMarksSaveTimer = setTimeout(() => {
            triggerAutoSaveMaxMarks();
          }, 600);
        } else {
          maxInput.classList.add('invalid');
        }
      });
      maxInput.addEventListener('change', () => {
        triggerAutoSaveMaxMarks();
      });
      maxInput.addEventListener('blur', () => {
        triggerAutoSaveMaxMarks();
      });
      maxInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerAutoSaveMaxMarks();
          const firstMarkInput = container.querySelector('[data-marks-student-input]:not([disabled])');
          if (firstMarkInput) {
            firstMarkInput.focus();
            if (typeof firstMarkInput.select === 'function') firstMarkInput.select();
          }
        }
      });
    }

    const searchInput = container.querySelector('[data-marks-field="student-search"]');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.studentSearchQuery = e.target.value;
        const pos = e.target.selectionStart;
        render();
        const nextSearch = container.querySelector('[data-marks-field="student-search"]');
        if (nextSearch) {
          nextSearch.focus();
          try {
            nextSearch.setSelectionRange(pos, pos);
          } catch (_) {}
        }
      });
    }

    const reasonInput = container.querySelector('[data-marks-field="edit-reason"]');
    if (reasonInput) {
      reasonInput.addEventListener('input', (e) => {
        state.editReason = e.target.value;
      });
    }

    container.querySelectorAll('[data-marks-status-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.statusFilter = btn.getAttribute('data-marks-status-filter') || 'ALL';
        render();
      });
    });

    const markInputs = Array.from(container.querySelectorAll('[data-marks-student-input]'));
    markInputs.forEach((input) => {
      input.addEventListener('input', (e) => {
        const sId = input.getAttribute('data-marks-student-input');
        setStudentMark(sId, e.target.value);
        updateStudentRowLive(sId);

        if (marksAutoSaveTimer) clearTimeout(marksAutoSaveTimer);
        marksAutoSaveTimer = setTimeout(() => {
          triggerAutoSaveMarks();
        }, 500);
      });

      input.addEventListener('change', () => {
        const sId = input.getAttribute('data-marks-student-input');
        setStudentMark(sId, input.value);
        updateStudentRowLive(sId);
        triggerAutoSaveMarks();
      });

      input.addEventListener('blur', () => {
        triggerAutoSaveMarks();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const sId = input.getAttribute('data-marks-student-input');
          setStudentMark(sId, input.value);
          updateStudentRowLive(sId);
          triggerAutoSaveMarks();

          const allInputs = Array.from(container.querySelectorAll('[data-marks-student-input]:not([disabled])'));
          const currentIdx = allInputs.indexOf(input);
          if (currentIdx !== -1 && currentIdx + 1 < allInputs.length) {
            const next = allInputs[currentIdx + 1];
            next.focus();
            if (typeof next.select === 'function') next.select();
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const allInputs = Array.from(container.querySelectorAll('[data-marks-student-input]:not([disabled])'));
          const currentIdx = allInputs.indexOf(input);
          if (currentIdx !== -1 && currentIdx + 1 < allInputs.length) {
            allInputs[currentIdx + 1].focus();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const allInputs = Array.from(container.querySelectorAll('[data-marks-student-input]:not([disabled])'));
          const currentIdx = allInputs.indexOf(input);
          if (currentIdx > 0) {
            allInputs[currentIdx - 1].focus();
          }
        }
      });
    });

    const bindAction = (actionName, handler) => {
      container.querySelectorAll(`[data-marks-action="${actionName}"]`).forEach((btn) => {
        btn.addEventListener('click', handler);
      });
    };

    bindAction('retry-context', () => loadContext());
    bindAction('retry-roster', () => loadRoster());
    bindAction('back-to-subjects', () => selectSubject(''));
    bindAction('save-config', () => saveExamConfig());
    bindAction('save-draft', () => saveDraft());
    bindAction('publish-results', () => publishResults());
    bindAction('save-published-edits', () => savePublishedEdits());
    bindAction('discard-changes', () => {
      discardUnsavedChanges();
      render();
    });
    bindAction('enable-published-edit', () => {
      state.isEditingPublished = true;
      render();
    });
    bindAction('cancel-published-edit', async () => {
      if (marksAutoSaveTimer) {
        clearTimeout(marksAutoSaveTimer);
        marksAutoSaveTimer = null;
      }
      if (hasUnsavedChanges()) {
        await saveDraft(true);
      }
      state.isEditingPublished = false;
      render();
    });
    bindAction('open-audit', () => openAuditModal());
    bindAction('close-audit', () => closeAuditModal());
  }

  async function mount(containerOrSelector, options = {}) {
    injectStyles();
    const el =
      typeof containerOrSelector === 'string'
        ? window.document.querySelector(containerOrSelector)
        : containerOrSelector;
    if (!el) return;

    state.containerEl = el;

    if (!state.beforeUnloadBound && typeof window.addEventListener === 'function') {
      state.beforeUnloadBound = true;
      window.addEventListener('beforeunload', (e) => {
        if (hasUnsavedChanges()) {
          e.preventDefault();
          e.returnValue = '';
        }
      });
    }

    if (options.examType && EXAM_TYPES.includes(options.examType)) {
      state.selectedExamType = options.examType;
    }

    await loadContext();

    if (options.subjectKey) {
      const match = (state.subjects || []).find(
        (s) =>
          String(s.id).toLowerCase() === String(options.subjectKey).toLowerCase() ||
          String(s.code).toLowerCase() === String(options.subjectKey).toLowerCase()
      );
      if (match) {
        state.selectedSubjectId = match.id;
        await loadRoster();
      }
    }
  }

  function unmount() {
    state.containerEl = null;
    if (typeof window !== 'undefined' && window.document && typeof window.document.getElementById === 'function') {
      const hero = window.document.getElementById('marksHeroBanner');
      if (hero && hero.style) {
        if (typeof hero.style.removeProperty === 'function') {
          hero.style.removeProperty('display');
        } else {
          hero.style.display = '';
        }
      }
    }
  }

  window.TeacherMarksEntryWorkspace = {
    EXAM_TYPES,
    mount,
    unmount,
    loadContext,
    loadRoster,
    selectSubject,
    selectExamType,
    setMaxMarksInput,
    setStudentMark,
    saveExamConfig,
    saveDraft,
    publishResults,
    savePublishedEdits,
    openAuditModal,
    closeAuditModal,
    hasUnsavedChanges,
    discardUnsavedChanges,
    calculatePercentage,
    getState: () => state
  };
})(window);
