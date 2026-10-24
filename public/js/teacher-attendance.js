/**
 * Semester Library — Teacher Attendance Workspace (Web Module)
 *
 * Consumes authoritative Step 2 Attendance APIs:
 * - GET  /api/attendance/teacher/context
 * - GET  /api/attendance/roster?subjectId=...&cohortId=...&date=...
 * - POST /api/attendance/sessions
 * - PUT  /api/attendance/sessions/:id
 * - GET  /api/attendance/sessions?subjectId=...&cohortId=...
 * - GET  /api/attendance/sessions/:id/audit
 */
(function (window) {
  'use strict';

  const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

  const state = {
    initialized: false,
    loadingContext: false,
    loadingRoster: false,
    loadingHistory: false,
    loadingAudit: false,
    saving: false,
    contextError: null,
    rosterError: null,
    saveError: null,
    saveSuccessMessage: null,

    // Context data from GET /api/attendance/teacher/context
    currentNepalDate: '',
    subjects: [],
    cohorts: [],

    // Selection state (preserved across Marking, Review, and History stages)
    selectedSubjectId: '',
    selectedCohortId: '',
    selectedDate: '',

    // Roster & Session state from GET /api/attendance/roster
    rosterSubject: null,
    rosterCohort: null,
    roster: [],
    existingSession: null,
    marksByStudentId: {}, // { [studentId]: 'present' | 'absent' }
    initialMarksSnapshot: '{}',

    // Stage: 'marking' | 'review' | 'history'
    stage: 'marking',
    currentStudentIndex: 0,
    editReason: '',

    // History & Audit
    historySessions: [],
    auditModalSessionId: null,
    auditLogs: [],

    // Live countdown ticker
    countdownTimerId: null,
    containerEl: null
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

  function hasUnsavedChanges() {
    const currentJson = JSON.stringify(state.marksByStudentId || {});
    return currentJson !== state.initialMarksSnapshot;
  }

  function discardUnsavedChanges() {
    try {
      state.marksByStudentId = JSON.parse(state.initialMarksSnapshot || '{}');
    } catch (_) {
      state.marksByStudentId = {};
    }
    state.saveError = null;
  }

  function confirmDiscardIfDirty() {
    if (!hasUnsavedChanges()) return true;
    const confirmed = window.confirm('You have unsaved attendance selections. Discard unsaved changes?');
    if (confirmed) {
      discardUnsavedChanges();
    }
    return confirmed;
  }

  /**
   * Computes remaining edit time from authoritative server submittedAt timestamp.
   */
  function getEditWindowStatus(session) {
    if (!session || !session.submittedAt) {
      return {
        hasSubmittedAt: false,
        canEdit: false,
        remainingMs: 0,
        label: 'Edit window unavailable'
      };
    }

    const submittedMs = new Date(session.submittedAt).getTime();
    if (!Number.isFinite(submittedMs)) {
      return {
        hasSubmittedAt: false,
        canEdit: false,
        remainingMs: 0,
        label: 'Edit window unavailable'
      };
    }

    const expiresAtMs = submittedMs + EDIT_WINDOW_MS;
    const remainingMs = expiresAtMs - Date.now();
    const isLocked = session.status === 'locked';
    const canEdit = !isLocked && remainingMs > 0;

    if (!canEdit) {
      return {
        hasSubmittedAt: true,
        canEdit: false,
        remainingMs: 0,
        expiresAtIso: new Date(expiresAtMs).toISOString(),
        label: '24h edit window expired (Read-Only)'
      };
    }

    const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');

    return {
      hasSubmittedAt: true,
      canEdit: true,
      remainingMs,
      expiresAtIso: new Date(expiresAtMs).toISOString(),
      label: `Editable for ${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s`
    };
  }

  function getSelectedSubjectObj() {
    return (state.subjects || []).find(
      (s) => s.id === state.selectedSubjectId || s.code === state.selectedSubjectId
    ) || null;
  }

  function getEligibleCohortsForSelectedSubject() {
    const sub = getSelectedSubjectObj();
    if (!sub) return [];
    if (Array.isArray(sub.cohorts)) return sub.cohorts;
    return (state.cohorts || []).filter((c) => Number(c.currentSemester) === Number(sub.semester));
  }

  function getRosterCounts() {
    const total = state.roster.length;
    let present = 0;
    let absent = 0;
    let unmarked = 0;

    for (const student of state.roster) {
      const st = state.marksByStudentId[student.studentId];
      if (st === 'present') present += 1;
      else if (st === 'absent') absent += 1;
      else unmarked += 1;
    }

    return {
      total,
      marked: present + absent,
      present,
      absent,
      unmarked
    };
  }

  function injectStyles() {
    if (document.getElementById('sl-teacher-attendance-styles')) return;
    const style = document.createElement('style');
    style.id = 'sl-teacher-attendance-styles';
    style.textContent = `
      .sl-att-root {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--teach-text-primary, var(--text-primary, #f5f5f5));
      }
      .sl-att-panel {
        background: var(--teach-surface, var(--bg-secondary, #141414));
        border: 1px solid var(--teach-border, var(--border, #2a2a2a));
        border-radius: 14px;
        padding: 20px 24px;
        margin-bottom: 20px;
      }
      .sl-att-controls-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 16px;
        align-items: end;
      }
      .sl-att-field label {
        display: block;
        font-size: 0.76rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--teach-text-secondary, var(--text-muted, #a3a3a3));
        margin-bottom: 6px;
      }
      .sl-att-select,
      .sl-att-input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 9px;
        border: 1px solid var(--teach-border, var(--border, #2a2a2a));
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-primary, #f5f5f5);
        font-size: 0.9rem;
        font-family: inherit;
        outline: none;
      }
      .sl-att-select:focus,
      .sl-att-input:focus {
        border-color: var(--teach-text-primary, #ffffff);
      }
      .sl-att-stage-tabs {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 18px;
      }
      .sl-att-stage-tab {
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface, #141414);
        color: var(--teach-text-secondary, #a3a3a3);
        font-size: 0.84rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .sl-att-stage-tab.active {
        background: var(--teach-btn-primary-bg, #f5f5f5);
        color: var(--teach-btn-primary-text, #0a0a0a);
        border-color: var(--teach-btn-primary-bg, #f5f5f5);
      }
      .sl-att-banner {
        border-radius: 10px;
        padding: 12px 16px;
        margin-bottom: 16px;
        font-size: 0.86rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
      }
      .sl-att-banner.error {
        border-color: rgba(239, 68, 68, 0.45);
        background: rgba(239, 68, 68, 0.1);
        color: #fca5a5;
      }
      .sl-att-banner.success {
        border-color: rgba(34, 197, 94, 0.45);
        background: rgba(34, 197, 94, 0.1);
        color: #86efac;
      }
      .sl-att-banner.readonly {
        border-color: rgba(245, 158, 11, 0.45);
        background: rgba(245, 158, 11, 0.1);
        color: #fde68a;
      }
      .sl-att-summary-pills {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 10px;
        margin-bottom: 18px;
      }
      .sl-att-stat-box {
        background: var(--teach-surface-subtle, #1c1c1c);
        border: 1px solid var(--teach-border-subtle, #242424);
        border-radius: 10px;
        padding: 12px 14px;
        text-align: center;
      }
      .sl-att-stat-val {
        font-size: 1.25rem;
        font-weight: 700;
        line-height: 1.1;
      }
      .sl-att-stat-lbl {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--teach-text-secondary, #a3a3a3);
        margin-top: 4px;
        font-weight: 600;
      }
      .sl-att-focus-card {
        background: var(--teach-surface, #141414);
        border: 1px solid var(--teach-border, #2a2a2a);
        border-radius: 16px;
        padding: 28px 24px;
        max-width: 640px;
        margin: 0 auto 20px;
        text-align: center;
      }
      .sl-att-progress-text {
        font-size: 0.8rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--teach-text-secondary, #a3a3a3);
        margin-bottom: 8px;
      }
      .sl-att-progress-bar {
        width: 100%;
        height: 6px;
        background: var(--teach-surface-subtle, #1c1c1c);
        border-radius: 999px;
        overflow: hidden;
        margin-bottom: 22px;
      }
      .sl-att-progress-fill {
        height: 100%;
        background: var(--teach-btn-primary-bg, #f5f5f5);
        transition: width 0.2s ease;
      }
      .sl-att-student-avatar {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        margin: 0 auto 14px;
        background: var(--teach-surface-subtle, #1c1c1c);
        border: 1px solid var(--teach-border, #2a2a2a);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.4rem;
        font-weight: 700;
      }
      .sl-att-student-name {
        font-size: 1.35rem;
        font-weight: 700;
        margin: 0 0 6px;
      }
      .sl-att-student-meta {
        font-size: 0.88rem;
        color: var(--teach-text-secondary, #a3a3a3);
        margin: 0 0 22px;
        font-family: monospace;
      }
      .sl-att-mark-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        margin-bottom: 22px;
      }
      .sl-att-mark-btn {
        padding: 16px 20px;
        border-radius: 12px;
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        border: 2px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-primary, #f5f5f5);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.15s ease;
      }
      .sl-att-mark-btn:hover:not(:disabled) {
        border-color: var(--teach-text-secondary, #a3a3a3);
      }
      .sl-att-mark-btn.selected-present {
        background: #f5f5f5;
        color: #0a0a0a;
        border-color: #f5f5f5;
      }
      .sl-att-mark-btn.selected-absent {
        background: #27272a;
        color: #fca5a5;
        border-color: #ef4444;
      }
      .sl-att-mark-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .sl-att-nav-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-top: 1px solid var(--teach-border-subtle, #222222);
        padding-top: 16px;
      }
      .sl-att-dots {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: center;
        margin-top: 16px;
      }
      .sl-att-dot {
        width: 30px;
        height: 30px;
        border-radius: 8px;
        font-size: 0.75rem;
        font-weight: 700;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-secondary, #a3a3a3);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .sl-att-dot.current {
        outline: 2px solid var(--teach-text-primary, #ffffff);
        outline-offset: 1px;
      }
      .sl-att-dot.present {
        background: #f5f5f5;
        color: #0a0a0a;
        border-color: #f5f5f5;
      }
      .sl-att-dot.absent {
        background: rgba(239, 68, 68, 0.18);
        color: #fca5a5;
        border-color: rgba(239, 68, 68, 0.5);
      }
      .sl-att-review-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 20px;
      }
      .sl-att-review-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 16px;
        border-radius: 10px;
        background: var(--teach-surface-subtle, #1c1c1c);
        border: 1px solid var(--teach-border-subtle, #242424);
        flex-wrap: wrap;
      }
      .sl-att-badge {
        display: inline-flex;
        align-items: center;
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
      }
      .sl-att-badge.present {
        background: #f5f5f5;
        color: #0a0a0a;
      }
      .sl-att-badge.absent {
        background: rgba(239, 68, 68, 0.18);
        color: #fca5a5;
        border: 1px solid rgba(239, 68, 68, 0.4);
      }
      .sl-att-badge.unmarked {
        background: rgba(245, 158, 11, 0.16);
        color: #fde68a;
        border: 1px solid rgba(245, 158, 11, 0.4);
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Loads teacher attendance context from GET /api/attendance/teacher/context
   */
  async function loadTeacherContext(presetSubjectKey = null) {
    state.loadingContext = true;
    state.contextError = null;
    render();

    try {
      const res = await authFetch('/api/attendance/teacher/context');
      if (res.status === 401 || res.status === 403) {
        throw new Error('Only authorized faculty teachers can access classroom attendance.');
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to load attendance context.');
      }

      const data = await res.json();
      state.currentNepalDate = data.currentNepalDate || '';
      state.subjects = Array.isArray(data.subjects) ? data.subjects : [];
      state.cohorts = Array.isArray(data.cohorts) ? data.cohorts : [];

      if (!state.selectedDate && state.currentNepalDate) {
        state.selectedDate = state.currentNepalDate;
      }

      // Resolve initial subject selection
      if (presetSubjectKey) {
        const norm = String(presetSubjectKey).trim().toLowerCase();
        const matched = state.subjects.find(
          (s) =>
            String(s.id || '').toLowerCase() === norm ||
            String(s.code || '').toLowerCase() === norm ||
            String(s.name || '').toLowerCase() === norm
        );
        if (matched) {
          state.selectedSubjectId = matched.id;
        }
      }

      if (!state.selectedSubjectId && state.subjects.length > 0) {
        state.selectedSubjectId = state.subjects[0].id;
      }

      syncCohortForSelectedSubject();
      state.loadingContext = false;
      render();

      if (state.selectedSubjectId && state.selectedCohortId && state.selectedDate) {
        await Promise.all([loadRoster(), loadHistory()]);
      }
    } catch (err) {
      state.loadingContext = false;
      state.contextError = err.message || 'Unable to load teacher attendance context.';
      render();
    }
  }

  function syncCohortForSelectedSubject() {
    const eligible = getEligibleCohortsForSelectedSubject();
    if (eligible.length === 0) {
      state.selectedCohortId = '';
      return;
    }
    const stillValid = eligible.some((c) => c.id === state.selectedCohortId);
    if (!stillValid) {
      state.selectedCohortId = eligible[0].id;
    }
  }

  /**
   * Loads official cohort roster and any existing session for (subjectId, cohortId, date)
   * from GET /api/attendance/roster
   */
  async function loadRoster() {
    if (!state.selectedSubjectId || !state.selectedCohortId || !state.selectedDate) {
      state.roster = [];
      state.existingSession = null;
      render();
      return;
    }

    state.loadingRoster = true;
    state.rosterError = null;
    state.saveError = null;
    render();

    try {
      const qs = new URLSearchParams({
        subjectId: state.selectedSubjectId,
        cohortId: state.selectedCohortId,
        date: state.selectedDate
      });
      const res = await authFetch(`/api/attendance/roster?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || `Failed to load roster (${res.status}).`);
      }

      state.rosterSubject = data.subject || null;
      state.rosterCohort = data.cohort || null;
      state.roster = Array.isArray(data.roster) ? data.roster : [];
      state.existingSession = data.session || null;

      // Populate marks ONLY from server-saved session records (never auto-mark unmarked students)
      const initialMarks = {};
      for (const student of state.roster) {
        if (student.status === 'present' || student.status === 'absent') {
          initialMarks[student.studentId] = student.status;
        }
      }
      state.marksByStudentId = initialMarks;
      state.initialMarksSnapshot = JSON.stringify(initialMarks);
      state.currentStudentIndex = 0;

      // If session already exists and is expired/read-only, open directly on Review view
      const win = getEditWindowStatus(state.existingSession);
      if (state.existingSession && !win.canEdit && state.stage === 'marking') {
        state.stage = 'review';
      }

      state.loadingRoster = false;
      render();
    } catch (err) {
      state.loadingRoster = false;
      state.rosterError = err.message || 'Could not load class roster.';
      state.roster = [];
      state.existingSession = null;
      render();
    }
  }

  /**
   * Loads historical sessions from GET /api/attendance/sessions
   */
  async function loadHistory() {
    if (!state.selectedSubjectId) return;
    state.loadingHistory = true;
    render();

    try {
      const qs = new URLSearchParams({ subjectId: state.selectedSubjectId });
      if (state.selectedCohortId) {
        qs.set('cohortId', state.selectedCohortId);
      }
      const res = await authFetch(`/api/attendance/sessions?${qs.toString()}`);
      if (res.ok) {
        const data = await res.json();
        state.historySessions = Array.isArray(data.sessions) ? data.sessions : [];
      }
    } catch (_) {
      // Keep existing history list on transient background error
    } finally {
      state.loadingHistory = false;
      render();
    }
  }

  /**
   * Marks the current or specified student as 'present' or 'absent'
   */
  function markStudent(studentId, status, autoAdvance = true) {
    if (state.saving) return;
    const win = getEditWindowStatus(state.existingSession);
    if (state.existingSession && !win.canEdit) return;
    if (status !== 'present' && status !== 'absent') return;

    state.marksByStudentId = {
      ...state.marksByStudentId,
      [studentId]: status
    };
    state.saveError = null;
    state.saveSuccessMessage = null;

    if (autoAdvance && state.stage === 'marking' && state.roster.length > 0) {
      if (state.currentStudentIndex < state.roster.length - 1) {
        state.currentStudentIndex += 1;
      }
    }
    render();
  }

  /**
   * Submits or updates the attendance session via POST /api/attendance/sessions
   * or PUT /api/attendance/sessions/:id
   */
  async function submitAttendance() {
    if (state.saving) return;

    const counts = getRosterCounts();
    if (counts.total === 0) {
      state.saveError = 'Cannot submit attendance for an empty roster.';
      render();
      return;
    }

    if (counts.unmarked > 0) {
      state.saveError = `Please mark all students before submitting (${counts.unmarked} student${counts.unmarked === 1 ? '' : 's'} unmarked).`;
      render();
      return;
    }

    const win = getEditWindowStatus(state.existingSession);
    if (state.existingSession && !win.canEdit) {
      state.saveError = 'The 24-hour editing window has expired. An administrator must authorize post-window corrections.';
      render();
      return;
    }

    state.saving = true;
    state.saveError = null;
    state.saveSuccessMessage = null;
    render();

    const recordsPayload = state.roster.map((student) => ({
      studentId: student.studentId,
      status: state.marksByStudentId[student.studentId]
    }));

    try {
      const isEditingExisting = Boolean(state.existingSession && state.existingSession.id);
      const endpoint = isEditingExisting
        ? `/api/attendance/sessions/${encodeURIComponent(state.existingSession.id)}`
        : '/api/attendance/sessions';
      const method = isEditingExisting ? 'PUT' : 'POST';

      const bodyPayload = isEditingExisting
        ? {
            records: recordsPayload,
            reason: state.editReason ? state.editReason.trim() : 'Updated by teacher within 24-hour window'
          }
        : {
            subjectId: state.selectedSubjectId,
            cohortId: state.selectedCohortId,
            sessionDate: state.selectedDate,
            records: recordsPayload
          };

      const res = await authFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.message || `Failed to save attendance (${res.status}).`);
        err.status = res.status;
        err.code = data.code || null;
        throw err;
      }

      state.saving = false;
      state.editReason = '';
      state.saveSuccessMessage = data.created
        ? `Attendance submitted for ${state.selectedDate} (${counts.present} Present, ${counts.absent} Absent).`
        : `Attendance updated for ${state.selectedDate} (${counts.present} Present, ${counts.absent} Absent).`;

      // Refresh server-backed roster/session and history
      await Promise.all([loadRoster(), loadHistory()]);
      state.stage = 'review';
      render();
    } catch (err) {
      // Preserve complete local marking state on error
      state.saving = false;
      const errMsg = err.message || 'Network error while saving attendance. Your selections have been preserved.';
      if (err.code === 'EDIT_WINDOW_EXPIRED' && state.existingSession) {
        state.existingSession = { ...state.existingSession, status: 'locked' };
      }
      state.saveError = errMsg;
      render();
    }
  }

  async function openSessionAuditModal(sessionId) {
    state.auditModalSessionId = sessionId;
    state.loadingAudit = true;
    state.auditLogs = [];
    render();

    try {
      const res = await authFetch(`/api/attendance/sessions/${encodeURIComponent(sessionId)}/audit`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Could not load audit history.');
      }
      state.auditLogs = Array.isArray(data.logs) ? data.logs : [];
    } catch (err) {
      state.auditLogs = [{ error: err.message }];
    } finally {
      state.loadingAudit = false;
      render();
    }
  }

  function closeAuditModal() {
    state.auditModalSessionId = null;
    state.auditLogs = [];
    render();
  }

  function stopCountdownTicker() {
    if (state.countdownTimerId) {
      window.clearInterval(state.countdownTimerId);
      state.countdownTimerId = null;
    }
  }

  function startCountdownTicker() {
    if (state.countdownTimerId) return;
    state.countdownTimerId = window.setInterval(() => {
      if (!state.containerEl) return;
      const badgeEls = state.containerEl.querySelectorAll('[data-att-submitted-at]');
      badgeEls.forEach((el) => {
        const submittedAt = el.getAttribute('data-att-submitted-at');
        const status = el.getAttribute('data-att-session-status') || 'submitted';
        const info = getEditWindowStatus({ submittedAt, status });
        el.textContent = info.label;
        if (!info.canEdit && el.getAttribute('data-att-was-editable') === '1') {
          el.setAttribute('data-att-was-editable', '0');
          render();
        }
      });
    }, 1000);
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', (e) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function render() {
    const container = state.containerEl;
    if (!container) return;

    if (state.loadingContext) {
      container.innerHTML = `
        <div class="sl-att-root">
          <div class="sl-att-panel" style="text-align:center; padding:40px 20px;">
            <div style="font-weight:700; font-size:1rem; margin-bottom:6px;">Loading Attendance Workspace…</div>
            <div style="font-size:0.85rem; color:var(--teach-text-secondary, #a3a3a3);">Fetching your assigned subjects and active class cohorts.</div>
          </div>
        </div>
      `;
      return;
    }

    if (state.contextError) {
      container.innerHTML = `
        <div class="sl-att-root">
          <div class="sl-att-banner error">
            <span>${escapeHtml(state.contextError)}</span>
            <button type="button" class="teach-btn teach-btn-secondary" data-att-action="reload-context">Retry</button>
          </div>
        </div>
      `;
      bindEvents(container);
      return;
    }

    if (!state.subjects.length) {
      container.innerHTML = `
        <div class="sl-att-root">
          <div class="sl-att-panel" style="text-align:center; padding:40px 24px;">
            <div style="font-weight:700; font-size:1.05rem; margin-bottom:6px;">No Active Subjects Assigned</div>
            <div style="font-size:0.86rem; color:var(--teach-text-secondary, #a3a3a3);">
              You do not have any active BIT subjects assigned to your teacher profile yet. Please contact an administrator.
            </div>
          </div>
        </div>
      `;
      return;
    }

    const eligibleCohorts = getEligibleCohortsForSelectedSubject();
    const counts = getRosterCounts();
    const editWin = getEditWindowStatus(state.existingSession);
    const isReadOnly = Boolean(state.existingSession && !editWin.canEdit);

    let mainStageHtml = '';

    if (!state.selectedCohortId || eligibleCohorts.length === 0) {
      const sub = getSelectedSubjectObj();
      mainStageHtml = `
        <div class="sl-att-panel" style="text-align:center; padding:36px 24px;">
          <div style="font-weight:700; font-size:1rem; margin-bottom:6px;">No Active Cohort in Semester ${escapeHtml(sub ? sub.semester : '')}</div>
          <div style="font-size:0.86rem; color:var(--teach-text-secondary, #a3a3a3);">
            There is currently no active student cohort enrolled in Semester ${escapeHtml(sub ? sub.semester : '')} for ${escapeHtml(sub ? sub.name : 'this subject')}.
          </div>
        </div>
      `;
    } else if (state.loadingRoster) {
      mainStageHtml = `
        <div class="sl-att-panel" style="text-align:center; padding:40px 20px;">
          <div style="font-weight:700; font-size:1rem; margin-bottom:6px;">Loading Class Roster…</div>
          <div style="font-size:0.85rem; color:var(--teach-text-secondary, #a3a3a3);">Verifying cohort enrollment and existing session records.</div>
        </div>
      `;
    } else if (state.rosterError) {
      mainStageHtml = `
        <div class="sl-att-banner error">
          <span>${escapeHtml(state.rosterError)}</span>
          <button type="button" class="teach-btn teach-btn-secondary" data-att-action="reload-roster">Try Again</button>
        </div>
      `;
    } else if (state.stage === 'history') {
      mainStageHtml = renderHistoryStage();
    } else if (state.roster.length === 0) {
      mainStageHtml = `
        <div class="sl-att-panel" style="text-align:center; padding:36px 24px;">
          <div style="font-weight:700; font-size:1rem; margin-bottom:6px;">No Active Students in Cohort</div>
          <div style="font-size:0.86rem; color:var(--teach-text-secondary, #a3a3a3);">
            This cohort currently has no active enrolled student or CR accounts.
          </div>
        </div>
      `;
    } else if (state.stage === 'marking') {
      mainStageHtml = renderMarkingStage(counts, editWin, isReadOnly);
    } else {
      mainStageHtml = renderReviewStage(counts, editWin, isReadOnly);
    }

    container.innerHTML = `
      <div class="sl-att-root">
        <!-- Top Selector Bar: Subject, Cohort, Date -->
        <div class="sl-att-panel">
          <div class="sl-att-controls-grid">
            <div class="sl-att-field">
              <label for="slAttSubjectSelect">Assigned Subject</label>
              <select id="slAttSubjectSelect" class="sl-att-select">
                ${state.subjects
                  .map(
                    (s) => `
                  <option value="${escapeHtml(s.id)}" ${s.id === state.selectedSubjectId ? 'selected' : ''}>
                    [${escapeHtml(s.code)}] ${escapeHtml(s.name)} (Sem ${escapeHtml(s.semester)})
                  </option>
                `
                  )
                  .join('')}
              </select>
            </div>

            <div class="sl-att-field">
              <label for="slAttCohortSelect">Active Cohort</label>
              <select id="slAttCohortSelect" class="sl-att-select" ${eligibleCohorts.length === 0 ? 'disabled' : ''}>
                ${
                  eligibleCohorts.length === 0
                    ? '<option value="">No active cohort for this semester</option>'
                    : eligibleCohorts
                        .map(
                          (c) => `
                      <option value="${escapeHtml(c.id)}" ${c.id === state.selectedCohortId ? 'selected' : ''}>
                        ${escapeHtml(c.displayName)} (Sem ${escapeHtml(c.currentSemester)}${c.intakeYear ? ' · ' + escapeHtml(c.intakeYear) : ''})
                      </option>
                    `
                        )
                        .join('')
                }
              </select>
            </div>

            <div class="sl-att-field">
              <label for="slAttDateInput">Session Date (Nepal Time)</label>
              <input
                type="date"
                id="slAttDateInput"
                class="sl-att-input"
                value="${escapeHtml(state.selectedDate)}"
                max="${escapeHtml(state.currentNepalDate)}"
              />
            </div>
          </div>
        </div>

        <!-- Stage Navigation Switcher -->
        <div class="sl-att-stage-tabs" role="tablist" aria-label="Attendance workflow stages">
          <button
            type="button"
            class="sl-att-stage-tab ${state.stage === 'marking' ? 'active' : ''}"
            data-att-stage="marking"
          >
            1. One-by-One Marking (${counts.marked}/${counts.total})
          </button>
          <button
            type="button"
            class="sl-att-stage-tab ${state.stage === 'review' ? 'active' : ''}"
            data-att-stage="review"
          >
            2. Review &amp; Submit (${counts.unmarked === 0 && counts.total > 0 ? 'Ready' : `${counts.unmarked} Unmarked`})
          </button>
          <button
            type="button"
            class="sl-att-stage-tab ${state.stage === 'history' ? 'active' : ''}"
            data-att-stage="history"
          >
            3. Session History (${state.historySessions.length})
          </button>
        </div>

        <!-- Status & Edit Countdown Banners -->
        ${
          state.existingSession
            ? `
          <div class="sl-att-banner ${isReadOnly ? 'readonly' : ''}">
            <div>
              <strong>${isReadOnly ? 'Locked / Read-Only Session:' : 'Existing Submitted Session:'}</strong>
              ${
                isReadOnly
                  ? 'The 24-hour teacher editing window has expired. An administrator must authorize any corrections.'
                  : 'You are viewing saved attendance for this date. You may edit and re-save within the 24-hour window.'
              }
            </div>
            <span
              class="sl-att-badge ${isReadOnly ? 'unmarked' : 'present'}"
              data-att-submitted-at="${escapeHtml(state.existingSession.submittedAt || '')}"
              data-att-session-status="${escapeHtml(state.existingSession.status || 'submitted')}"
              data-att-was-editable="${editWin.canEdit ? '1' : '0'}"
            >
              ${escapeHtml(editWin.label)}
            </span>
          </div>
        `
            : ''
        }

        ${
          state.saveError
            ? `<div class="sl-att-banner error" role="alert"><span>${escapeHtml(state.saveError)}</span></div>`
            : ''
        }

        ${
          state.saveSuccessMessage
            ? `<div class="sl-att-banner success" role="status"><span>${escapeHtml(state.saveSuccessMessage)}</span></div>`
            : ''
        }

        ${mainStageHtml}
        ${state.auditModalSessionId ? renderAuditModal() : ''}
      </div>
    `;

    bindEvents(container);
  }

  function renderSummaryBoxes(counts) {
    return `
      <div class="sl-att-summary-pills">
        <div class="sl-att-stat-box">
          <div class="sl-att-stat-val">${counts.total}</div>
          <div class="sl-att-stat-lbl">Total Roster</div>
        </div>
        <div class="sl-att-stat-box">
          <div class="sl-att-stat-val">${counts.marked}</div>
          <div class="sl-att-stat-lbl">Marked</div>
        </div>
        <div class="sl-att-stat-box">
          <div class="sl-att-stat-val">${counts.present}</div>
          <div class="sl-att-stat-lbl">Present</div>
        </div>
        <div class="sl-att-stat-box">
          <div class="sl-att-stat-val">${counts.absent}</div>
          <div class="sl-att-stat-lbl">Absent</div>
        </div>
        <div class="sl-att-stat-box">
          <div class="sl-att-stat-val">${counts.unmarked}</div>
          <div class="sl-att-stat-lbl">Unmarked</div>
        </div>
      </div>
    `;
  }

  function renderMarkingStage(counts, editWin, isReadOnly) {
    const idx = Math.min(Math.max(0, state.currentStudentIndex), state.roster.length - 1);
    const student = state.roster[idx];
    const currentStatus = state.marksByStudentId[student.studentId] || null;
    const progressPct = counts.total > 0 ? Math.round((counts.marked / counts.total) * 100) : 0;
    const initial = (student.name || 'S').trim().charAt(0).toUpperCase();

    return `
      ${renderSummaryBoxes(counts)}

      <div class="sl-att-focus-card">
        <div class="sl-att-progress-text">
          Student ${idx + 1} of ${counts.total} &middot; ${counts.marked} of ${counts.total} Marked (${progressPct}%)
        </div>
        <div class="sl-att-progress-bar">
          <div class="sl-att-progress-fill" style="width: ${progressPct}%;"></div>
        </div>

        <div class="sl-att-student-avatar">${escapeHtml(initial)}</div>
        <h3 class="sl-att-student-name">${escapeHtml(student.name)}</h3>
        <div class="sl-att-student-meta">
          ID: ${escapeHtml(student.studentId)}${student.username ? ` &middot; @${escapeHtml(student.username)}` : ''}${student.role === 'cr' ? ' &middot; CR' : ''}
        </div>

        <div class="sl-att-mark-actions">
          <button
            type="button"
            class="sl-att-mark-btn ${currentStatus === 'present' ? 'selected-present' : ''}"
            data-att-mark-student="${escapeHtml(student.studentId)}"
            data-att-mark-status="present"
            ${isReadOnly || state.saving ? 'disabled' : ''}
            aria-pressed="${currentStatus === 'present' ? 'true' : 'false'}"
          >
            &#10003; Present
          </button>
          <button
            type="button"
            class="sl-att-mark-btn ${currentStatus === 'absent' ? 'selected-absent' : ''}"
            data-att-mark-student="${escapeHtml(student.studentId)}"
            data-att-mark-status="absent"
            ${isReadOnly || state.saving ? 'disabled' : ''}
            aria-pressed="${currentStatus === 'absent' ? 'true' : 'false'}"
          >
            &#10005; Absent
          </button>
        </div>

        <div class="sl-att-nav-row">
          <button
            type="button"
            class="teach-btn teach-btn-secondary"
            data-att-nav="prev"
            ${idx === 0 ? 'disabled' : ''}
          >
            &larr; Previous
          </button>

          <span style="font-size: 0.82rem; color: var(--teach-text-secondary, #a3a3a3);">
            Status: <strong>${currentStatus ? currentStatus.toUpperCase() : 'UNMARKED'}</strong>
          </span>

          ${
            idx < counts.total - 1
              ? `
            <button
              type="button"
              class="teach-btn teach-btn-secondary"
              data-att-nav="next"
            >
              Next &rarr;
            </button>
          `
              : `
            <button
              type="button"
              class="teach-btn teach-btn-primary"
              data-att-stage="review"
            >
              Review Roster &rarr;
            </button>
          `
          }
        </div>

        <div class="sl-att-dots" aria-label="Jump to student">
          ${state.roster
            .map((s, sIdx) => {
              const st = state.marksByStudentId[s.studentId] || '';
              return `
                <button
                  type="button"
                  class="sl-att-dot ${sIdx === idx ? 'current' : ''} ${st}"
                  data-att-jump="${sIdx}"
                  title="${escapeHtml(s.name)} (${st || 'Unmarked'})"
                >
                  ${sIdx + 1}
                </button>
              `;
            })
            .join('')}
        </div>
      </div>
    `;
  }

  function renderReviewStage(counts, editWin, isReadOnly) {
    const canSubmit = !isReadOnly && !state.saving && counts.total > 0 && counts.unmarked === 0;

    return `
      ${renderSummaryBoxes(counts)}

      <div class="sl-att-panel">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
          <div>
            <h3 style="margin:0 0 4px; font-size:1.05rem;">Roster Review (${escapeHtml(state.selectedDate)})</h3>
            <p style="margin:0; font-size:0.83rem; color:var(--teach-text-secondary, #a3a3a3);">
              ${
                isReadOnly
                  ? 'This session is locked for teacher edits because the 24-hour window has elapsed.'
                  : counts.unmarked > 0
                  ? `You must mark all remaining ${counts.unmarked} unmarked student${counts.unmarked === 1 ? '' : 's'} before submitting.`
                  : 'Verify each student status below, then confirm final submission.'
              }
            </p>
          </div>
          <button type="button" class="teach-btn teach-btn-secondary" data-att-stage="marking">
            &larr; Back to One-by-One Card
          </button>
        </div>

        <div class="sl-att-review-list">
          ${state.roster
            .map((student, idx) => {
              const st = state.marksByStudentId[student.studentId] || 'unmarked';
              return `
                <div class="sl-att-review-row">
                  <div>
                    <div style="font-weight:700; font-size:0.92rem;">
                      ${idx + 1}. ${escapeHtml(student.name)}
                    </div>
                    <div style="font-size:0.78rem; color:var(--teach-text-secondary, #a3a3a3); font-family:monospace;">
                      ${escapeHtml(student.studentId)}${student.username ? ` · @${escapeHtml(student.username)}` : ''}
                    </div>
                  </div>

                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span class="sl-att-badge ${st}">
                      ${st === 'present' ? 'Present' : st === 'absent' ? 'Absent' : 'Unmarked'}
                    </span>
                    ${
                      !isReadOnly
                        ? `
                      <button
                        type="button"
                        class="teach-btn teach-btn-secondary"
                        style="padding:5px 10px; font-size:0.76rem;"
                        data-att-review-mark="${escapeHtml(student.studentId)}"
                        data-att-review-status="present"
                        ${state.saving ? 'disabled' : ''}
                      >
                        Set Present
                      </button>
                      <button
                        type="button"
                        class="teach-btn teach-btn-secondary"
                        style="padding:5px 10px; font-size:0.76rem;"
                        data-att-review-mark="${escapeHtml(student.studentId)}"
                        data-att-review-status="absent"
                        ${state.saving ? 'disabled' : ''}
                      >
                        Set Absent
                      </button>
                      <button
                        type="button"
                        class="teach-btn teach-btn-secondary"
                        style="padding:5px 10px; font-size:0.76rem;"
                        data-att-jump-marking="${idx}"
                      >
                        Card
                      </button>
                    `
                        : ''
                    }
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>

        ${
          !isReadOnly
            ? `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; border-top:1px solid var(--teach-border, #2a2a2a); padding-top:16px;">
            <div style="font-size:0.84rem; color:var(--teach-text-secondary, #a3a3a3);">
              ${
                counts.unmarked > 0
                  ? `Submission blocked: ${counts.unmarked} student${counts.unmarked === 1 ? ' is' : 's are'} still unmarked.`
                  : `All ${counts.total} students marked (${counts.present} Present, ${counts.absent} Absent).`
              }
            </div>
            <button
              type="button"
              class="teach-btn teach-btn-primary"
              data-att-action="submit-session"
              ${canSubmit ? '' : 'disabled'}
            >
              ${
                state.saving
                  ? 'Saving Attendance…'
                  : state.existingSession
                  ? 'Save Attendance Changes'
                  : 'Confirm & Submit Attendance'
              }
            </button>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  function renderHistoryStage() {
    if (state.loadingHistory) {
      return `
        <div class="sl-att-panel" style="text-align:center; padding:36px 20px;">
          Loading session history…
        </div>
      `;
    }

    if (!state.historySessions.length) {
      return `
        <div class="sl-att-panel" style="text-align:center; padding:36px 20px;">
          <div style="font-weight:700; font-size:1rem; margin-bottom:6px;">No Attendance Sessions Recorded Yet</div>
          <div style="font-size:0.85rem; color:var(--teach-text-secondary, #a3a3a3);">
            Submitted sessions for this subject and cohort will appear here with attendance percentages and edit timers.
          </div>
        </div>
      `;
    }

    return `
      <div class="sl-att-panel">
        <h3 style="margin:0 0 14px; font-size:1.05rem;">Recorded Attendance Sessions</h3>
        <div class="sl-att-review-list">
          ${state.historySessions
            .map((sess) => {
              const win = getEditWindowStatus(sess);
              const counts = sess.counts || { total: 0, present: 0, absent: 0, attendancePercentage: 0 };
              return `
                <div class="sl-att-review-row">
                  <div>
                    <div style="font-weight:700; font-size:0.95rem;">
                      ${escapeHtml(sess.sessionDate)} &middot; ${escapeHtml(sess.subjectCode || '')} (${escapeHtml(sess.cohortName || '')})
                    </div>
                    <div style="font-size:0.82rem; color:var(--teach-text-secondary, #a3a3a3); margin-top:2px;">
                      Present: <strong>${counts.present}</strong> &middot; Absent: <strong>${counts.absent}</strong> &middot; Total: <strong>${counts.total}</strong> (${counts.attendancePercentage}%)
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span
                      class="sl-att-badge ${win.canEdit ? 'present' : 'unmarked'}"
                      data-att-submitted-at="${escapeHtml(sess.submittedAt || '')}"
                      data-att-session-status="${escapeHtml(sess.status || 'submitted')}"
                      data-att-was-editable="${win.canEdit ? '1' : '0'}"
                    >
                      ${escapeHtml(win.label)}
                    </span>
                    <button
                      type="button"
                      class="teach-btn teach-btn-secondary"
                      style="padding:6px 12px; font-size:0.78rem;"
                      data-att-open-session-date="${escapeHtml(sess.sessionDate)}"
                      data-att-open-session-cohort="${escapeHtml(sess.cohortId)}"
                    >
                      ${win.canEdit ? 'Review / Edit' : 'View Read-Only'}
                    </button>
                    <button
                      type="button"
                      class="teach-btn teach-btn-secondary"
                      style="padding:6px 12px; font-size:0.78rem;"
                      data-att-open-audit="${escapeHtml(sess.id)}"
                    >
                      Audit Log
                    </button>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;
  }

  function renderAuditModal() {
    return `
      <div class="teach-modal-overlay open" role="dialog" aria-modal="true" aria-label="Attendance Audit History">
        <div class="teach-modal-card" style="max-width:600px;">
          <div class="teach-modal-header">
            <h3 class="teach-modal-title">Session Audit Log</h3>
            <button type="button" class="teach-modal-close" data-att-action="close-audit">&times;</button>
          </div>
          ${
            state.loadingAudit
              ? '<div style="padding:20px 0; text-align:center;">Loading audit trail…</div>'
              : state.auditLogs.length === 0
              ? '<div style="padding:20px 0; text-align:center;">No audit entries found.</div>'
              : `<div style="max-height:360px; overflow-y:auto; display:flex; flex-direction:column; gap:10px;">
                  ${state.auditLogs
                    .map((log) =>
                      log.error
                        ? `<div class="sl-att-banner error">${escapeHtml(log.error)}</div>`
                        : `
                        <div class="sl-att-review-row" style="flex-direction:column; align-items:flex-start;">
                          <div style="font-weight:700; font-size:0.86rem;">
                            ${escapeHtml(log.action)} by ${escapeHtml(log.actorName || log.actorUserId)} (${escapeHtml(log.actorRole)})
                          </div>
                          <div style="font-size:0.78rem; color:var(--teach-text-secondary, #a3a3a3);">
                            ${escapeHtml(log.createdAt || '')}${log.reason ? ` · Reason: ${escapeHtml(log.reason)}` : ''}
                          </div>
                        </div>
                      `
                    )
                    .join('')}
                </div>`
          }
        </div>
      </div>
    `;
  }

  function bindEvents(container) {
    const subjSelect = container.querySelector('#slAttSubjectSelect');
    if (subjSelect) {
      subjSelect.addEventListener('change', async (e) => {
        if (!confirmDiscardIfDirty()) {
          e.target.value = state.selectedSubjectId;
          return;
        }
        state.selectedSubjectId = e.target.value;
        syncCohortForSelectedSubject();
        await Promise.all([loadRoster(), loadHistory()]);
      });
    }

    const cohortSelect = container.querySelector('#slAttCohortSelect');
    if (cohortSelect) {
      cohortSelect.addEventListener('change', async (e) => {
        if (!confirmDiscardIfDirty()) {
          e.target.value = state.selectedCohortId;
          return;
        }
        state.selectedCohortId = e.target.value;
        await Promise.all([loadRoster(), loadHistory()]);
      });
    }

    const dateInput = container.querySelector('#slAttDateInput');
    if (dateInput) {
      dateInput.addEventListener('change', async (e) => {
        const nextDate = (e.target.value || '').trim();
        if (!nextDate) return;
        if (state.currentNepalDate && nextDate > state.currentNepalDate) {
          state.saveError = `Future dates are not permitted. Current Nepal date is ${state.currentNepalDate}.`;
          e.target.value = state.selectedDate;
          render();
          return;
        }
        if (!confirmDiscardIfDirty()) {
          e.target.value = state.selectedDate;
          return;
        }
        state.selectedDate = nextDate;
        await loadRoster();
      });
    }

    container.querySelectorAll('[data-att-stage]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextStage = btn.getAttribute('data-att-stage');
        state.stage = nextStage;
        if (nextStage === 'history') {
          loadHistory();
        } else {
          render();
        }
      });
    });

    container.querySelectorAll('[data-att-mark-student]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sId = btn.getAttribute('data-att-mark-student');
        const st = btn.getAttribute('data-att-mark-status');
        markStudent(sId, st, true);
      });
    });

    container.querySelectorAll('[data-att-review-mark]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sId = btn.getAttribute('data-att-review-mark');
        const st = btn.getAttribute('data-att-review-status');
        markStudent(sId, st, false);
      });
    });

    container.querySelectorAll('[data-att-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = btn.getAttribute('data-att-nav');
        if (dir === 'prev' && state.currentStudentIndex > 0) {
          state.currentStudentIndex -= 1;
          render();
        } else if (dir === 'next' && state.currentStudentIndex < state.roster.length - 1) {
          state.currentStudentIndex += 1;
          render();
        }
      });
    });

    container.querySelectorAll('[data-att-jump]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-att-jump'));
        if (Number.isInteger(idx) && idx >= 0 && idx < state.roster.length) {
          state.currentStudentIndex = idx;
          render();
        }
      });
    });

    container.querySelectorAll('[data-att-jump-marking]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-att-jump-marking'));
        if (Number.isInteger(idx) && idx >= 0 && idx < state.roster.length) {
          state.currentStudentIndex = idx;
          state.stage = 'marking';
          render();
        }
      });
    });

    const submitBtn = container.querySelector('[data-att-action="submit-session"]');
    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        submitAttendance();
      });
    }

    const reloadCtxBtn = container.querySelector('[data-att-action="reload-context"]');
    if (reloadCtxBtn) {
      reloadCtxBtn.addEventListener('click', () => loadTeacherContext());
    }

    const reloadRosterBtn = container.querySelector('[data-att-action="reload-roster"]');
    if (reloadRosterBtn) {
      reloadRosterBtn.addEventListener('click', () => loadRoster());
    }

    container.querySelectorAll('[data-att-open-session-date]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirmDiscardIfDirty()) return;
        const sDate = btn.getAttribute('data-att-open-session-date');
        const cId = btn.getAttribute('data-att-open-session-cohort');
        if (cId) state.selectedCohortId = cId;
        if (sDate) state.selectedDate = sDate;
        state.stage = 'review';
        await loadRoster();
      });
    });

    container.querySelectorAll('[data-att-open-audit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sId = btn.getAttribute('data-att-open-audit');
        if (sId) openSessionAuditModal(sId);
      });
    });

    const closeAuditBtn = container.querySelector('[data-att-action="close-audit"]');
    if (closeAuditBtn) {
      closeAuditBtn.addEventListener('click', closeAuditModal);
    }
  }

  function unmount() {
    stopCountdownTicker();
  }

  /**
   * Mounts and opens the Teacher Attendance Workspace inside target container.
   */
  async function mount(containerOrSelector, options = {}) {
    injectStyles();
    const el =
      typeof containerOrSelector === 'string'
        ? document.querySelector(containerOrSelector)
        : containerOrSelector;
    if (!el) return;

    state.containerEl = el;
    startCountdownTicker();

    if (options.subjectKey) {
      state.stage = 'marking';
      state.saveError = null;
      state.saveSuccessMessage = null;
      await loadTeacherContext(options.subjectKey);
    } else if (!state.initialized) {
      state.initialized = true;
      await loadTeacherContext(null);
    } else {
      render();
    }
  }

  window.TeacherAttendanceWorkspace = {
    mount,
    unmount,
    loadTeacherContext,
    loadRoster,
    loadHistory,
    markStudent,
    submitAttendance,
    hasUnsavedChanges,
    discardUnsavedChanges,
    getState: () => state
  };
})(window);
