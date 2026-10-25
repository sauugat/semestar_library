/**
 * Semester Library — Teacher Attendance Workspace (Web Module)
 *
 * Implements:
 * 1. Subject-selection landing page (Library-style monochrome subject cards, scoped to assigned subjects).
 * 2. Alphabetically sorted (case-insensitive) full student attendance register with Present/Absent controls,
 *    keyboard shortcuts (P, A, ArrowUp, ArrowDown with auto-advance and input focus guard), and mouse/touch support.
 * 3. Numbered Monthly Attendance Matrix where each student row shows their independent consecutive attendance
 *    numbers (1, 2, 3...) for Present and 'ABS' for Absent, resetting each month, and Attendance % derived
 *    strictly from underlying attendance records.
 * 4. Month and chronological session navigation, 24-hour teacher edit window enforcement, audit log viewer,
 *    and clickable student detailed attendance history modal.
 *
 * Consumes authoritative Attendance APIs:
 * - GET  /api/attendance/teacher/context
 * - GET  /api/attendance/roster?subjectId=...&cohortId=...&date=...
 * - GET  /api/attendance/monthly?subjectId=...&cohortId=...&month=...
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
    loadingMonthly: false,
    loadingHistory: false,
    loadingAudit: false,
    saving: false,
    contextError: null,
    rosterError: null,
    monthlyError: null,
    saveError: null,
    saveSuccessMessage: null,

    // Context data from GET /api/attendance/teacher/context
    currentNepalDate: '',
    subjects: [],
    cohorts: [],

    // Selection state
    // When selectedSubjectId === '', the teacher is on the Subject-Selection Landing Page.
    selectedSubjectId: '',
    selectedCohortId: '',
    selectedDate: '',
    selectedMonth: '',

    // Search filter in student register
    studentSearchQuery: '',

    // Roster & Session state from GET /api/attendance/roster
    rosterSubject: null,
    rosterCohort: null,
    roster: [],
    existingSession: null,
    marksByStudentId: {}, // { [studentId]: 'present' | 'absent' }
    initialMarksSnapshot: '{}',

    // Stage within a selected subject: 'marking' (register) | 'review' | 'history'
    stage: 'marking',
    currentStudentIndex: 0,
    editReason: '',

    // Monthly attendance matrix state from GET /api/attendance/monthly
    availableMonths: [],
    monthlyCalendarDates: [],
    monthlyMonthLabel: '',
    monthlyDateRangeLabel: '',
    monthlyTeacherName: '',
    monthlySemesterLabel: '',
    monthlySubjectLabel: '',
    monthlySessions: [],
    monthlyRows: [],
    studentHistoryByStudentId: {},

    // Student detail modal state
    selectedStudentDetailId: null,

    // History & Audit
    historySessions: [],
    auditModalSessionId: null,
    auditLogs: [],

    // Teacher Google Drive Attendance Backup UI state
    loadingBackup: false,
    backupConnecting: false,
    backupSyncing: false,
    backupDisconnecting: false,
    backupStatusData: null,
    backupPendingRuns: [],
    backupNoticeMessage: null,
    backupErrorMessage: null,
    backupReconnectRequired: false,
    driveClient: null,
    hasExplicitDriveClient: false,

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

  /**
   * Case-insensitive alphabetical comparator by displayed student name,
   * with deterministic tie-breaker on studentId.
   */
  function compareStudentsAlphabetically(a, b) {
    const nameA = String((a && (a.name || a.studentName || a.displayName || a.studentId || a.student_id)) || '').trim();
    const nameB = String((b && (b.name || b.studentName || b.displayName || b.studentId || b.student_id)) || '').trim();
    const cmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    const idA = String((a && (a.studentId || a.student_id || a.id)) || '').trim();
    const idB = String((b && (b.studentId || b.student_id || b.id)) || '').trim();
    return idA.localeCompare(idB, undefined, { sensitivity: 'base' });
  }

  function sortStudentsAlphabetically(students) {
    if (!Array.isArray(students)) return [];
    return [...students].sort(compareStudentsAlphabetically);
  }

  /**
   * Pure client-side builder for the numbered monthly attendance matrix.
   * Ensures deterministic consecutive numbering per student per month and accurate percentage calculation
   * from underlying attendance records even when computed locally.
   */
  function formatShortDateLabel(yyyyMmDd) {
    if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return String(yyyyMmDd || '');
    const [, m, d] = String(yyyyMmDd).split('-').map(Number);
    const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${shortMonths[m - 1] || m} ${d}`;
  }

  function buildApplicableCalendarDatesForMonth(monthStr, currentNepalDateOverride = null) {
    const cleanMonth = monthStr ? String(monthStr).trim() : '';
    if (!/^\d{4}-\d{2}$/.test(cleanMonth)) return [];
    const todayNepal = String(currentNepalDateOverride || state.currentNepalDate || '').trim();
    const [year, month] = cleanMonth.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    let endDay = daysInMonth;
    if (todayNepal && /^\d{4}-\d{2}-\d{2}$/.test(todayNepal)) {
      const todayMonth = todayNepal.slice(0, 7);
      if (cleanMonth > todayMonth) {
        return [];
      }
      if (cleanMonth === todayMonth) {
        const currentDay = Number(todayNepal.slice(8, 10));
        endDay = Math.min(daysInMonth, Math.max(0, currentDay));
      }
    }

    const dates = [];
    for (let day = 1; day <= endDay; day += 1) {
      const dateStr = `${cleanMonth}-${String(day).padStart(2, '0')}`;
      dates.push({
        date: dateStr,
        dayOfMonth: day,
        label: formatShortDateLabel(dateStr)
      });
    }
    return dates;
  }

  function buildMonthlyAttendanceMatrix({
    students = [],
    sessions = [],
    recordsBySessionId = new Map(),
    month = null,
    currentNepalDate = null
  } = {}) {
    const cleanMonth = month ? String(month).trim() : null;

    const eligibleSessions = (Array.isArray(sessions) ? sessions : []).filter((s) => {
      if (!s) return false;
      const st = String(s.status || 'submitted').toLowerCase();
      if (st !== 'submitted' && st !== 'locked') return false;
      const sDate = String(s.sessionDate || s.session_date || '').trim();
      if (!sDate) return false;
      if (cleanMonth && !sDate.startsWith(`${cleanMonth}-`)) return false;
      return true;
    });

    const chronologicalSessions = [...eligibleSessions].sort((a, b) => {
      const dateA = String(a.sessionDate || a.session_date || '');
      const dateB = String(b.sessionDate || b.session_date || '');
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const subA = String(a.submittedAt || a.submitted_at || '');
      const subB = String(b.submittedAt || b.submitted_at || '');
      if (subA !== subB) return subA.localeCompare(subB);
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const numberedSessions = chronologicalSessions.map((s, idx) => ({
      ...s,
      id: s.id,
      sessionNumber: idx + 1,
      sessionDate: String(s.sessionDate || s.session_date || ''),
      dateLabel: formatShortDateLabel(String(s.sessionDate || s.session_date || '')),
      status: s.status || 'submitted',
      submittedAt: s.submittedAt || s.submitted_at || null,
      editWindow: s.editWindow || null,
      counts: s.counts || null
    }));

    const sessionByDate = new Map();
    for (const sess of numberedSessions) {
      sessionByDate.set(sess.sessionDate, sess);
    }

    let calendarDates = [];
    if (cleanMonth && /^\d{4}-\d{2}$/.test(cleanMonth)) {
      calendarDates = buildApplicableCalendarDatesForMonth(cleanMonth, currentNepalDate).map((d) => {
        const sess = sessionByDate.get(d.date) || null;
        return {
          date: d.date,
          dayOfMonth: d.dayOfMonth,
          label: d.label,
          hasSession: Boolean(sess),
          sessionId: sess ? sess.id : null,
          sessionNumber: sess ? sess.sessionNumber : null,
          status: sess ? sess.status : null
        };
      });
    } else {
      calendarDates = numberedSessions.map((sess) => ({
        date: sess.sessionDate,
        dayOfMonth: Number(String(sess.sessionDate).slice(8, 10)) || sess.sessionNumber,
        label: formatShortDateLabel(sess.sessionDate),
        hasSession: true,
        sessionId: sess.id,
        sessionNumber: sess.sessionNumber,
        status: sess.status
      }));
    }

    const getStatus = (sessionId, studentId) => {
      let sessionRecords = null;
      if (recordsBySessionId instanceof Map) {
        sessionRecords = recordsBySessionId.get(sessionId);
      } else if (recordsBySessionId && typeof recordsBySessionId === 'object') {
        sessionRecords = recordsBySessionId[sessionId];
      }
      if (!sessionRecords) return 'absent';
      if (sessionRecords instanceof Map) {
        const v = sessionRecords.get(studentId);
        if (typeof v === 'string') return v === 'present' ? 'present' : 'absent';
        if (v && typeof v === 'object') return v.status === 'present' ? 'present' : 'absent';
        return 'absent';
      }
      if (Array.isArray(sessionRecords)) {
        const found = sessionRecords.find((r) => String(r.studentId || r.student_id) === String(studentId));
        return found && found.status === 'present' ? 'present' : 'absent';
      }
      if (typeof sessionRecords === 'object') {
        const v = sessionRecords[studentId];
        if (typeof v === 'string') return v === 'present' ? 'present' : 'absent';
        if (v && typeof v === 'object') return v.status === 'present' ? 'present' : 'absent';
      }
      return 'absent';
    };

    const sortedStudents = sortStudentsAlphabetically(students);
    const totalSessions = numberedSessions.length;

    const rows = sortedStudents.map((stu) => {
      const studentId = String(stu.studentId || stu.student_id || '').trim();
      let consecutiveCount = 0;
      let presentCount = 0;
      let absentCount = 0;
      const sessionCells = [];
      const sessionCellByDate = new Map();

      for (const sess of numberedSessions) {
        const st = getStatus(sess.id, studentId);
        if (st === 'present') {
          presentCount += 1;
          consecutiveCount += 1;
          const cell = {
            date: sess.sessionDate,
            dateLabel: sess.dateLabel,
            hasSession: true,
            sessionId: sess.id,
            sessionNumber: sess.sessionNumber,
            sessionDate: sess.sessionDate,
            status: 'present',
            consecutiveCount,
            display: String(consecutiveCount)
          };
          sessionCells.push(cell);
          sessionCellByDate.set(sess.sessionDate, cell);
        } else {
          absentCount += 1;
          const cell = {
            date: sess.sessionDate,
            dateLabel: sess.dateLabel,
            hasSession: true,
            sessionId: sess.id,
            sessionNumber: sess.sessionNumber,
            sessionDate: sess.sessionDate,
            status: 'absent',
            consecutiveCount: null,
            display: 'ABS'
          };
          sessionCells.push(cell);
          sessionCellByDate.set(sess.sessionDate, cell);
        }
      }

      const cells = calendarDates.map((calDate) => {
        const sessCell = sessionCellByDate.get(calDate.date);
        if (sessCell) return sessCell;
        return {
          date: calDate.date,
          dateLabel: calDate.label,
          hasSession: false,
          sessionId: null,
          sessionNumber: null,
          sessionDate: calDate.date,
          status: 'no_session',
          consecutiveCount: null,
          display: '-'
        };
      });

      const rawPercentage = totalSessions > 0 ? (presentCount / totalSessions) * 100 : 0;
      const attendancePercentage = totalSessions > 0 ? Number(rawPercentage.toFixed(1)) : 0;
      const formattedPercentage = totalSessions > 0 ? `${rawPercentage.toFixed(1)}%` : '0.0%';

      return {
        studentId,
        name: String(stu.name || stu.studentName || studentId).trim(),
        username: stu.username || null,
        role: String(stu.role || 'student').toLowerCase(),
        cells,
        dateCells: cells,
        sessionCells,
        presentCount,
        absentCount,
        totalSessions,
        attendancePercentage,
        formattedPercentage
      };
    });

    return {
      month: cleanMonth,
      monthLabel: cleanMonth ? formatMonthLabel(cleanMonth) : '',
      totalSessions,
      totalCalendarDays: calendarDates.length,
      calendarDates,
      dates: calendarDates,
      sessions: numberedSessions,
      rows,
      students: rows
    };
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
    if (!state.selectedSubjectId) return null;
    const norm = String(state.selectedSubjectId).trim().toLowerCase();
    return (
      (state.subjects || []).find(
        (s) =>
          String(s.id || '').toLowerCase() === norm ||
          String(s.code || '').toLowerCase() === norm ||
          String(s.name || '').toLowerCase() === norm
      ) || null
    );
  }

  function getEligibleCohortsForSelectedSubject() {
    const sub = getSelectedSubjectObj();
    if (!sub) return [];
    if (Array.isArray(sub.cohorts)) return sub.cohorts;
    return (state.cohorts || []).filter((c) => Number(c.currentSemester) === Number(sub.semester));
  }

  function getVisibleRoster() {
    const sorted = sortStudentsAlphabetically(state.roster || []);
    const q = String(state.studentSearchQuery || '').trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((stu) => {
      const nameMatch = String(stu.name || '').toLowerCase().includes(q);
      const idMatch = String(stu.studentId || '').toLowerCase().includes(q);
      const userMatch = String(stu.username || '').toLowerCase().includes(q);
      return nameMatch || idMatch || userMatch;
    });
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

  function formatMonthLabel(yyyyMm) {
    if (!yyyyMm || !/^\d{4}-\d{2}$/.test(yyyyMm)) return yyyyMm || '';
    const [y, m] = yyyyMm.split('-').map(Number);
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return `${months[m - 1] || m} ${y}`;
  }

  function stepMonthString(yyyyMm, deltaMonths) {
    if (!yyyyMm || !/^\d{4}-\d{2}$/.test(yyyyMm)) return yyyyMm;
    const [y, m] = yyyyMm.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
    const nextY = dt.getUTCFullYear();
    const nextM = String(dt.getUTCMonth() + 1).padStart(2, '0');
    return `${nextY}-${nextM}`;
  }

  function injectStyles() {
    if (document.getElementById('sl-teacher-attendance-styles')) return;
    const style = document.createElement('style');
    style.id = 'sl-teacher-attendance-styles';
    style.textContent = `
      .sl-att-root {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--teach-text-primary, var(--text, #111827));
      }
      .sl-att-panel {
        background: var(--teach-surface, var(--surface, #ffffff));
        border: 1.5px solid var(--teach-border, var(--border, rgba(0, 0, 0, 0.13)));
        border-radius: 16px;
        padding: 20px 24px;
        margin-bottom: 20px;
      }
      /* Subject Selection Landing Grid (Library-style monochrome cards) */
      .sl-att-subject-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 20px;
        margin-bottom: 28px;
      }
      .sl-att-subject-card {
        background: var(--teach-surface, var(--surface, #ffffff));
        border: 1.5px solid var(--teach-border, var(--border, rgba(0, 0, 0, 0.13)));
        border-radius: 20px;
        padding: 26px 28px;
        min-height: 185px;
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
      .sl-att-subject-card:hover,
      .sl-att-subject-card:focus-visible {
        border-color: var(--teach-text-primary, #111827);
        transform: translateY(-2px);
        box-shadow: var(--teach-shadow-md, 0 8px 24px -4px rgba(0, 0, 0, 0.12));
        outline: none;
      }
      .sl-att-subject-card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
      }
      .sl-att-code-badge {
        font-size: 12px;
        font-weight: 700;
        padding: 4px 10px;
        border-radius: 7px;
        background: var(--teach-surface-subtle, #f3f4f6);
        border: 1px solid var(--teach-border, rgba(0, 0, 0, 0.1));
        color: var(--teach-text-primary, #111827);
        letter-spacing: 0.02em;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .sl-att-sem-pill {
        font-size: 12px;
        font-weight: 600;
        color: var(--teach-text-secondary, #6b7280);
      }
      .sl-att-subject-title {
        font-size: 18.5px;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin: 4px 0 18px;
        color: var(--teach-text-primary, #111827);
        line-height: 1.35;
      }
      .sl-att-subject-card-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding-top: 14px;
        border-top: 1px solid var(--teach-border-subtle, rgba(0, 0, 0, 0.08));
        font-size: 12.5px;
        font-weight: 600;
        color: var(--teach-text-secondary, #6b7280);
      }
      .sl-att-open-label {
        font-weight: 700;
        color: var(--teach-text-primary, #111827);
        white-space: nowrap;
      }
      /* Register Top Header & Controls */
      .sl-att-reg-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
        margin-bottom: 18px;
      }
      .sl-att-back-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        border-radius: 999px;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface, #141414);
        color: var(--teach-text-primary, #f5f5f5);
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
      }
      .sl-att-back-btn:hover {
        background: var(--teach-surface-hover, #242424);
      }
      .sl-att-controls-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
        gap: 14px;
        align-items: end;
      }
      .sl-att-field label {
        display: block;
        font-size: 0.74rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--teach-text-secondary, #a3a3a3);
        margin-bottom: 6px;
      }
      .sl-att-select,
      .sl-att-input {
        width: 100%;
        box-sizing: border-box;
        padding: 9px 12px;
        border-radius: 9px;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-primary, #f5f5f5);
        font-size: 0.88rem;
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
        margin-bottom: 16px;
      }
      .sl-att-stage-tab {
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface, #141414);
        color: var(--teach-text-secondary, #a3a3a3);
        font-size: 0.83rem;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
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
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
      }
      .sl-att-banner.error {
        border-color: var(--teach-text-primary, #f5f5f5);
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-primary, #f5f5f5);
      }
      .sl-att-banner.success {
        border-color: var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-primary, #f5f5f5);
      }
      .sl-att-banner.readonly {
        border-color: var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-secondary, #a3a3a3);
      }
      .sl-att-summary-pills {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(115px, 1fr));
        gap: 10px;
        margin-bottom: 16px;
      }
      .sl-att-stat-box {
        background: var(--teach-surface-subtle, #1c1c1c);
        border: 1px solid var(--teach-border-subtle, #242424);
        border-radius: 10px;
        padding: 10px 12px;
        text-align: center;
      }
      .sl-att-stat-val {
        font-size: 1.2rem;
        font-weight: 700;
        line-height: 1.1;
      }
      .sl-att-stat-lbl {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--teach-text-secondary, #a3a3a3);
        margin-top: 4px;
        font-weight: 600;
      }
      /* Full Student Attendance Register List */
      .sl-att-register-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }
      .sl-att-kbd-hint {
        font-size: 0.78rem;
        color: var(--teach-text-secondary, #a3a3a3);
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .sl-att-kbd {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 5px;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-primary, #f5f5f5);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.73rem;
        font-weight: 700;
      }
      .sl-att-register-table-wrap {
        width: 100%;
        overflow-x: auto;
        border: 1px solid var(--teach-border, #2a2a2a);
        border-radius: 12px;
        background: var(--teach-surface, #141414);
      }
      .sl-att-register-list {
        display: flex;
        flex-direction: column;
      }
      .sl-att-register-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 11px 16px;
        border-bottom: 1px solid var(--teach-border-subtle, #242424);
        background: var(--teach-surface, #141414);
        transition: background 0.12s ease;
        outline: none;
      }
      .sl-att-register-row:last-child {
        border-bottom: none;
      }
      .sl-att-register-row.focused {
        background: var(--teach-surface-subtle, #1c1c1c);
        box-shadow: inset 3px 0 0 var(--teach-text-primary, #f5f5f5);
      }
      .sl-att-student-info {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        flex: 1;
      }
      .sl-att-row-num {
        font-size: 0.78rem;
        font-weight: 700;
        color: var(--teach-text-secondary, #a3a3a3);
        min-width: 24px;
        font-variant-numeric: tabular-nums;
      }
      .sl-att-student-name-btn {
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
        color: var(--teach-text-primary, #f5f5f5);
        font-size: 0.93rem;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        text-align: left;
        text-decoration: none;
      }
      .sl-att-student-name-btn:hover {
        text-decoration: underline;
      }
      .sl-att-student-id-sub {
        font-size: 0.76rem;
        color: var(--teach-text-secondary, #a3a3a3);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        margin-top: 2px;
      }
      .sl-att-row-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      .sl-att-mark-btn {
        padding: 7px 14px;
        border-radius: 8px;
        font-size: 0.8rem;
        font-weight: 700;
        cursor: pointer;
        border: 1.5px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-primary, #f5f5f5);
        font-family: inherit;
        transition: all 0.12s ease;
        min-width: 82px;
        text-align: center;
      }
      .sl-att-mark-btn:hover:not(:disabled) {
        border-color: var(--teach-text-primary, #f5f5f5);
      }
      .sl-att-mark-btn.selected-present {
        background: var(--teach-btn-primary-bg, #f5f5f5);
        color: var(--teach-btn-primary-text, #0a0a0a);
        border-color: var(--teach-btn-primary-bg, #f5f5f5);
      }
      .sl-att-mark-btn.selected-absent {
        background: var(--teach-surface-hover, #27272a);
        color: var(--teach-text-primary, #f5f5f5);
        border-color: var(--teach-text-primary, #f5f5f5);
        text-decoration: none;
      }
      .sl-att-mark-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      /* Monthly Attendance Matrix Table */
      .sl-att-matrix-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }
      .sl-att-month-nav {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .sl-att-session-strip {
        display: flex;
        align-items: center;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 6px;
        margin-bottom: 14px;
      }
      .sl-att-session-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 11px;
        border-radius: 999px;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-secondary, #a3a3a3);
        font-size: 0.76rem;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        font-family: inherit;
      }
      .sl-att-session-chip.active {
        background: var(--teach-btn-primary-bg, #f5f5f5);
        color: var(--teach-btn-primary-text, #0a0a0a);
        border-color: var(--teach-btn-primary-bg, #f5f5f5);
      }
      .sl-att-matrix-scroll {
        width: 100%;
        overflow-x: auto;
        border: 1px solid var(--teach-border, #2a2a2a);
        border-radius: 12px;
        background: var(--teach-surface, #141414);
        -webkit-overflow-scrolling: touch;
      }
      .sl-att-matrix-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 0.83rem;
        font-variant-numeric: tabular-nums;
      }
      .sl-att-matrix-table th,
      .sl-att-matrix-table td {
        padding: 9px 12px;
        border-bottom: 1px solid var(--teach-border-subtle, #242424);
        border-right: 1px solid var(--teach-border-subtle, #242424);
        text-align: right;
        white-space: nowrap;
      }
      .sl-att-matrix-table th:last-child,
      .sl-att-matrix-table td:last-child {
        border-right: none;
      }
      .sl-att-matrix-table tbody tr:last-child td {
        border-bottom: none;
      }
      .sl-att-matrix-table thead th {
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-secondary, #a3a3a3);
        font-weight: 700;
        font-size: 0.76rem;
      }
      .sl-att-matrix-table th.sl-att-col-student,
      .sl-att-matrix-table td.sl-att-col-student {
        position: sticky;
        left: 0;
        z-index: 2;
        text-align: left;
        background: var(--teach-surface, #141414);
        min-width: 190px;
        max-width: 260px;
        border-right: 1.5px solid var(--teach-border, #2a2a2a);
      }
      .sl-att-matrix-table thead th.sl-att-col-student {
        background: var(--teach-surface-subtle, #1c1c1c);
        z-index: 3;
      }
      .sl-att-matrix-session-btn {
        background: transparent;
        border: none;
        padding: 2px 4px;
        color: inherit;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        border-radius: 4px;
      }
      .sl-att-matrix-session-btn:hover {
        color: var(--teach-text-primary, #f5f5f5);
        text-decoration: underline;
      }
      .sl-att-cell-num {
        font-weight: 700;
        color: var(--teach-text-primary, #f5f5f5);
      }
      .sl-att-cell-abs {
        font-weight: 700;
        color: var(--teach-text-secondary, #71717a);
        letter-spacing: 0.02em;
      }
      .sl-att-cell-dash {
        font-weight: 500;
        color: var(--teach-text-secondary, #71717a);
        opacity: 0.65;
        text-align: center;
      }
      .sl-att-cell-pct {
        font-weight: 700;
        color: var(--teach-text-primary, #f5f5f5);
      }
      .sl-att-badge {
        display: inline-flex;
        align-items: center;
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 0.74rem;
        font-weight: 700;
        text-transform: uppercase;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-primary, #f5f5f5);
      }
      .sl-att-badge.present {
        background: var(--teach-btn-primary-bg, #f5f5f5);
        color: var(--teach-btn-primary-text, #0a0a0a);
        border-color: var(--teach-btn-primary-bg, #f5f5f5);
      }
      .sl-att-badge.absent {
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-secondary, #a3a3a3);
        border-color: var(--teach-border, #2a2a2a);
      }
      .sl-att-badge.unmarked {
        background: var(--teach-surface-subtle, #1c1c1c);
        color: var(--teach-text-secondary, #a3a3a3);
        border-color: var(--teach-border, #2a2a2a);
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
      .sl-att-backup-card {
        background: var(--teach-surface, var(--bg-secondary, #141414));
        border: 1px solid var(--teach-border, var(--border, #2a2a2a));
        border-radius: 14px;
        padding: 18px 22px;
        margin-bottom: 20px;
      }
      .sl-att-backup-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      .sl-att-backup-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 6px;
      }
      .sl-att-backup-title {
        font-size: 0.98rem;
        font-weight: 700;
        margin: 0;
        letter-spacing: -0.01em;
      }
      .sl-att-backup-desc {
        font-size: 0.83rem;
        color: var(--teach-text-secondary, #a3a3a3);
        margin: 0;
        line-height: 1.45;
      }
      .sl-att-backup-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .sl-att-backup-meta-row {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--teach-border-subtle, #222222);
        font-size: 0.8rem;
        color: var(--teach-text-secondary, #a3a3a3);
      }
      .sl-att-backup-meta-item strong {
        color: var(--teach-text-primary, #f5f5f5);
      }
      .sl-att-backup-pending-list {
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .sl-att-backup-pending-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        padding: 10px 14px;
        border-radius: 9px;
        background: var(--teach-surface-subtle, #1c1c1c);
        border: 1px solid var(--teach-border-subtle, #242424);
        font-size: 0.8rem;
      }
      .sl-att-backup-art-pills {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .sl-att-backup-art-pill {
        padding: 2px 8px;
        border-radius: 6px;
        font-size: 0.72rem;
        font-weight: 600;
        border: 1px solid var(--teach-border, #2a2a2a);
        background: var(--teach-surface, #141414);
        color: var(--teach-text-secondary, #a3a3a3);
      }
      .sl-att-backup-art-pill.backed_up,
      .sl-att-backup-art-pill.superseded {
        background: var(--teach-btn-primary-bg, #f5f5f5);
        color: var(--teach-btn-primary-text, #0a0a0a);
        border-color: var(--teach-btn-primary-bg, #f5f5f5);
      }
      .sl-att-backup-art-pill.failed,
      .sl-att-backup-art-pill.reconnect_required {
        border-color: var(--teach-text-primary, #f5f5f5);
        color: var(--teach-text-primary, #f5f5f5);
      }
      @media (max-width: 768px) {
        .sl-att-subject-grid {
          grid-template-columns: 1fr;
        }
        .sl-att-panel {
          padding: 16px;
        }
        .sl-att-register-row {
          padding: 10px 12px;
        }
        .sl-att-mark-btn {
          min-width: 68px;
          padding: 7px 10px;
        }
        .sl-att-matrix-table th.sl-att-col-student,
        .sl-att-matrix-table td.sl-att-col-student {
          min-width: 145px;
          max-width: 180px;
        }
        .sl-att-backup-card {
          padding: 14px 16px;
        }
        .sl-att-backup-actions {
          width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Loads teacher attendance context from GET /api/attendance/teacher/context.
   * When presetSubjectKey is NOT provided, keeps selectedSubjectId === '' so the teacher
   * lands on the clean Subject Selection page first.
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
      if (!state.selectedMonth && (state.selectedDate || state.currentNepalDate)) {
        state.selectedMonth = (state.selectedDate || state.currentNepalDate).slice(0, 7);
      }

      // Only auto-select a subject when explicitly requested via presetSubjectKey
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

      syncCohortForSelectedSubject();
      state.loadingContext = false;
      render();

      const initialTasks = [loadBackupStatus()];
      if (state.selectedSubjectId && state.selectedCohortId && state.selectedDate) {
        initialTasks.push(loadRoster(), loadMonthlyMatrix(), loadHistory());
      }
      await Promise.all(initialTasks);
    } catch (err) {
      state.loadingContext = false;
      state.contextError = err.message || 'Unable to load teacher attendance context.';
      render();
    }
  }

  function syncCohortForSelectedSubject() {
    if (!state.selectedSubjectId) {
      state.selectedCohortId = '';
      return;
    }
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
   * Selects an assigned subject from the landing page and opens its attendance register.
   */
  async function selectSubject(subjectKey) {
    if (!confirmDiscardIfDirty()) return;
    if (!subjectKey) {
      state.selectedSubjectId = '';
      state.selectedCohortId = '';
      state.roster = [];
      state.existingSession = null;
      render();
      return;
    }

    const norm = String(subjectKey).trim().toLowerCase();
    const matched = (state.subjects || []).find(
      (s) =>
        String(s.id || '').toLowerCase() === norm ||
        String(s.code || '').toLowerCase() === norm ||
        String(s.name || '').toLowerCase() === norm
    );
    if (!matched) {
      state.saveError = 'Selected subject is not assigned to your teacher profile.';
      render();
      return;
    }

    state.selectedSubjectId = matched.id;
    state.stage = 'marking';
    state.studentSearchQuery = '';
    state.saveError = null;
    state.saveSuccessMessage = null;
    if (!state.selectedDate && state.currentNepalDate) {
      state.selectedDate = state.currentNepalDate;
    }
    if (!state.selectedMonth && state.selectedDate) {
      state.selectedMonth = state.selectedDate.slice(0, 7);
    }

    syncCohortForSelectedSubject();
    render();

    if (state.selectedSubjectId && state.selectedCohortId && state.selectedDate) {
      await Promise.all([loadRoster(), loadMonthlyMatrix(), loadHistory()]);
    }
  }

  function backToSubjects() {
    if (!confirmDiscardIfDirty()) return;
    state.selectedSubjectId = '';
    state.selectedCohortId = '';
    state.roster = [];
    state.existingSession = null;
    state.marksByStudentId = {};
    state.initialMarksSnapshot = '{}';
    state.saveError = null;
    state.saveSuccessMessage = null;
    state.selectedStudentDetailId = null;
    render();
  }

  /**
   * Loads official cohort roster and any existing session for (subjectId, cohortId, date)
   * from GET /api/attendance/roster, sorting students alphabetically by displayed name.
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
      state.roster = sortStudentsAlphabetically(Array.isArray(data.roster) ? data.roster : []);
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
   * Loads the numbered monthly attendance matrix from GET /api/attendance/monthly
   */
  async function loadMonthlyMatrix(monthOverride = null) {
    if (!state.selectedSubjectId || !state.selectedCohortId) {
      state.monthlyCalendarDates = [];
      state.monthlySessions = [];
      state.monthlyRows = [];
      render();
      return;
    }

    const targetMonth =
      monthOverride ||
      state.selectedMonth ||
      (state.selectedDate ? state.selectedDate.slice(0, 7) : '') ||
      (state.currentNepalDate ? state.currentNepalDate.slice(0, 7) : '');

    if (targetMonth) {
      state.selectedMonth = targetMonth;
    }

    state.loadingMonthly = true;
    state.monthlyError = null;
    render();

    try {
      const qs = new URLSearchParams({
        subjectId: state.selectedSubjectId,
        cohortId: state.selectedCohortId
      });
      if (state.selectedMonth) {
        qs.set('month', state.selectedMonth);
      }

      const res = await authFetch(`/api/attendance/monthly?${qs.toString()}`);
      if (res && res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.month) state.selectedMonth = data.month;
        if (data.currentNepalDate) state.currentNepalDate = data.currentNepalDate;
        state.availableMonths = Array.isArray(data.availableMonths) ? data.availableMonths : [];
        state.monthlyCalendarDates = Array.isArray(data.calendarDates)
          ? data.calendarDates
          : buildApplicableCalendarDatesForMonth(state.selectedMonth, state.currentNepalDate);
        state.monthlyMonthLabel = data.monthLabel || formatMonthLabel(state.selectedMonth);
        state.monthlyDateRangeLabel = data.dateRangeLabel || '';
        state.monthlyTeacherName = data.teacherName || (data.teacher && data.teacher.name) || '';
        state.monthlySemesterLabel = data.semesterLabel || '';
        state.monthlySubjectLabel = data.subjectLabel || '';
        state.monthlySessions = Array.isArray(data.sessions) ? data.sessions : [];
        state.monthlyRows = Array.isArray(data.rows) ? data.rows : [];
        state.studentHistoryByStudentId =
          data.studentHistory && typeof data.studentHistory === 'object' ? data.studentHistory : {};
      } else {
        const fallback = buildMonthlyAttendanceMatrix({
          students: state.roster,
          sessions: [],
          recordsBySessionId: new Map(),
          month: state.selectedMonth,
          currentNepalDate: state.currentNepalDate
        });
        state.monthlyCalendarDates = fallback.calendarDates;
        state.monthlySessions = fallback.sessions;
        state.monthlyRows = fallback.rows;
      }
    } catch (_) {
      const fallback = buildMonthlyAttendanceMatrix({
        students: state.roster,
        sessions: [],
        recordsBySessionId: new Map(),
        month: state.selectedMonth,
        currentNepalDate: state.currentNepalDate
      });
      state.monthlyCalendarDates = fallback.calendarDates;
      state.monthlySessions = fallback.sessions;
      state.monthlyRows = fallback.rows;
    } finally {
      state.loadingMonthly = false;
      render();
    }
  }

  async function downloadMonthlySvg() {
    const selectedMonth =
      state.selectedMonth ||
      (state.selectedDate ? state.selectedDate.slice(0, 7) : '') ||
      (state.currentNepalDate ? state.currentNepalDate.slice(0, 7) : '');
    if (!state.selectedSubjectId || !state.selectedCohortId || !selectedMonth) return null;
    const qs = new URLSearchParams({
      subjectId: state.selectedSubjectId,
      cohortId: state.selectedCohortId,
      month: selectedMonth,
      format: 'svg'
    });
    const url = `/api/attendance/monthly?${qs.toString()}`;
    try {
      const res = await authFetch(url);
      if (!res || !res.ok) return null;
      const svgText = await res.text();
      if (typeof window.Blob === 'function' && window.URL && typeof window.URL.createObjectURL === 'function') {
        const blob = new window.Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.setAttribute(
          'download',
          `gandaki_monthly_attendance_${state.selectedSubjectId}_${selectedMonth}.svg`
        );
        if (document.body && typeof document.body.appendChild === 'function') {
          document.body.appendChild(link);
        }
        if (typeof link.click === 'function') link.click();
        if (link.parentNode && typeof link.parentNode.removeChild === 'function') {
          link.parentNode.removeChild(link);
        }
        if (typeof window.URL.revokeObjectURL === 'function') {
          window.URL.revokeObjectURL(blobUrl);
        }
      }
      return svgText;
    } catch (_) {
      return null;
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
   * Sanitizes any backup error string before rendering in the UI so OAuth tokens,
   * refresh tokens, claim tokens, or stack traces are never displayed.
   */
  function sanitizeUiBackupError(rawMessage) {
    if (!rawMessage) return 'Google Drive backup operation failed.';
    if (
      window.AttendanceDriveBackup &&
      typeof window.AttendanceDriveBackup.sanitizeClientErrorMessage === 'function'
    ) {
      return window.AttendanceDriveBackup.sanitizeClientErrorMessage(rawMessage);
    }
    return String(rawMessage)
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
      .replace(/ya29\.[A-Za-z0-9._-]+/g, '[REDACTED_TOKEN]')
      .replace(/1\/\/[A-Za-z0-9._-]+/g, '[REDACTED_TOKEN]')
      .replace(/GOCSPX-[A-Za-z0-9._-]+/g, '[REDACTED_SECRET]')
      .replace(/\b[0-9a-f]{64}\b/gi, '[REDACTED_HEX]')
      .split('\n')[0]
      .trim()
      .slice(0, 220);
  }

  function getOrInitDriveClient() {
    if (state.driveClient) return state.driveClient;
    if (
      window.AttendanceDriveBackup &&
      typeof window.AttendanceDriveBackup.createAttendanceDriveSyncClient === 'function'
    ) {
      state.driveClient = window.AttendanceDriveBackup.createAttendanceDriveSyncClient({
        window,
        backendFetch: authFetch
      });
      return state.driveClient;
    }
    if (window.AttendanceDriveBackup && typeof window.AttendanceDriveBackup.getStatus === 'function') {
      state.driveClient = window.AttendanceDriveBackup;
      return state.driveClient;
    }
    return null;
  }

  function setDriveClient(customClient) {
    state.driveClient = customClient || null;
    state.hasExplicitDriveClient = Boolean(customClient);
  }

  /**
   * Loads authoritative Google Drive backup status and pending backup queue from the backend.
   */
  async function loadBackupStatus({ preserveMessages = false } = {}) {
    state.loadingBackup = true;
    if (!preserveMessages) {
      state.backupErrorMessage = null;
    }
    render();

    try {
      const client = getOrInitDriveClient();
      let statusData = null;
      if (client && typeof client.getStatus === 'function') {
        statusData = await client.getStatus();
      } else {
        const res = await authFetch('/api/attendance/backup/status');
        if (res.ok) {
          statusData = await res.json();
        }
      }

      if (statusData) {
        state.backupStatusData = statusData;
        const connStatus = statusData.connection && statusData.connection.connectionStatus;
        const reconnectRuns = Number(
          statusData.summary && statusData.summary.reconnectRequiredRuns
            ? statusData.summary.reconnectRequiredRuns
            : 0
        );
        if (connStatus === 'reconnect_required' || reconnectRuns > 0) {
          state.backupReconnectRequired = true;
        } else if (connStatus === 'connected' || connStatus === 'disconnected' || connStatus === 'not_configured') {
          state.backupReconnectRequired = false;
        }
      }

      const pendingRes = await authFetch('/api/attendance/backup/pending');
      if (pendingRes && pendingRes.ok) {
        const pendingData = await pendingRes.json().catch(() => ({}));
        state.backupPendingRuns = Array.isArray(pendingData.runs) ? pendingData.runs : [];
      }
    } catch (_) {
      // Keep existing backup status if background fetch fails
    } finally {
      state.loadingBackup = false;
      render();
    }
  }

  async function connectDriveBackup() {
    if (state.backupConnecting || state.backupSyncing || state.backupDisconnecting) return;

    const oauthCfg = state.backupStatusData && state.backupStatusData.oauth;
    if (oauthCfg && !oauthCfg.configured) {
      state.backupErrorMessage = 'Google Drive integration has not been configured for this environment yet.';
      render();
      return;
    }

    const client = getOrInitDriveClient();
    if (!client || typeof client.connectGoogleDrive !== 'function') {
      state.backupErrorMessage = 'Google Drive backup client is not loaded.';
      render();
      return;
    }

    state.backupConnecting = true;
    state.backupErrorMessage = null;
    state.backupNoticeMessage = null;
    render();

    try {
      const res = await client.connectGoogleDrive({ userGesture: true });
      if (res && (res.notConfigured || res.status === 'not_configured')) {
        state.backupConnecting = false;
        await loadBackupStatus({ preserveMessages: true });
        return;
      }

      state.backupConnecting = false;
      state.backupReconnectRequired = false;
      state.backupNoticeMessage = 'Google Drive connected and backup folders verified.';
      await loadBackupStatus({ preserveMessages: true });
    } catch (err) {
      state.backupConnecting = false;
      const errCode = (err && err.code) || '';
      if (errCode === 'OAUTH_CANCELLED') {
        state.backupErrorMessage = 'Google Drive sign-in was cancelled before completion.';
      } else if (errCode === 'OAUTH_SCOPE_MISSING') {
        state.backupErrorMessage = 'Google Drive file permission (drive.file) was not granted. Please reconnect and approve file access.';
      } else {
        state.backupErrorMessage = sanitizeUiBackupError(err && err.message);
      }
      await loadBackupStatus({ preserveMessages: true });
    }
  }

  async function syncDriveBackup({ forceRetry = true } = {}) {
    if (state.backupConnecting || state.backupSyncing || state.backupDisconnecting) return;

    const client = getOrInitDriveClient();
    if (!client || typeof client.syncPendingWork !== 'function') {
      state.backupErrorMessage = 'Google Drive backup sync client is not available.';
      render();
      return;
    }

    state.backupSyncing = true;
    state.backupErrorMessage = null;
    state.backupNoticeMessage = null;
    render();

    try {
      await loadBackupStatus({ preserveMessages: true });
      state.backupSyncing = true;
      render();

      const syncResult = await client.syncPendingWork({ forceRetry: Boolean(forceRetry) });
      state.backupSyncing = false;

      if (syncResult && (syncResult.notConfigured || syncResult.status === 'not_configured')) {
        await loadBackupStatus({ preserveMessages: true });
        return;
      }

      if (syncResult && (syncResult.reconnectRequired || syncResult.status === 'reconnect_required')) {
        state.backupReconnectRequired = true;
        state.backupErrorMessage =
          sanitizeUiBackupError(syncResult.errorMessage) !== 'Google Drive operation failed.' && syncResult.errorMessage
            ? sanitizeUiBackupError(syncResult.errorMessage)
            : 'Google Drive authorization has expired or requires reconnection. Please reconnect Google Drive to sync pending backups.';
        await loadBackupStatus({ preserveMessages: true });
        return;
      }

      const completedCount = Number((syncResult && syncResult.completedArtifacts) || 0);
      const failedCount = Number((syncResult && syncResult.failedArtifacts) || 0);
      const processedRuns = Number((syncResult && syncResult.processedRuns) || 0);

      if (failedCount > 0 && completedCount > 0) {
        state.backupErrorMessage = `Partial backup sync: ${completedCount} artifact${completedCount === 1 ? '' : 's'} backed up, ${failedCount} failed. Completed files are preserved; click Retry Sync to retry remaining items.`;
      } else if (failedCount > 0) {
        const firstErr =
          (syncResult && syncResult.errorMessage) ||
          (Array.isArray(syncResult && syncResult.runs) &&
            syncResult.runs
              .flatMap((r) => r.artifacts || [])
              .find((a) => a.errorMessage)?.errorMessage) ||
          'One or more backup artifacts failed to upload.';
        state.backupErrorMessage = `Backup sync failed (${failedCount} artifact${failedCount === 1 ? '' : 's'}): ${sanitizeUiBackupError(firstErr)}`;
      } else if (processedRuns === 0 || completedCount === 0) {
        state.backupNoticeMessage = 'Everything is up to date. All attendance revisions are backed up to Google Drive.';
      } else {
        state.backupNoticeMessage = `Google Drive backup complete: ${completedCount} artifact${completedCount === 1 ? '' : 's'} synced across ${processedRuns} revision${processedRuns === 1 ? '' : 's'}.`;
      }

      await loadBackupStatus({ preserveMessages: true });
    } catch (err) {
      state.backupSyncing = false;
      if (err && err.reconnectRequired) {
        state.backupReconnectRequired = true;
      }
      state.backupErrorMessage = sanitizeUiBackupError(err && err.message);
      await loadBackupStatus({ preserveMessages: true });
    }
  }

  async function disconnectDriveBackup() {
    if (state.backupConnecting || state.backupSyncing || state.backupDisconnecting) return;

    const confirmed = window.confirm(
      'Disconnect your Google Drive account from Attendance Backup? Existing attendance records and files already backed up in your Google Drive will not be deleted.'
    );
    if (!confirmed) return;

    state.backupDisconnecting = true;
    state.backupErrorMessage = null;
    state.backupNoticeMessage = null;
    render();

    try {
      const client = getOrInitDriveClient();
      if (client && typeof client.disconnectGoogleDrive === 'function') {
        const discRes = await client.disconnectGoogleDrive({ clearFolders: false });
        if (!discRes || !discRes.disconnected) {
          throw new Error('Server did not confirm Google Drive disconnection.');
        }
      } else {
        const res = await authFetch('/api/attendance/backup/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clearFolders: false })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.disconnected) {
          throw new Error(data.message || 'Failed to disconnect Google Drive.');
        }
      }

      state.backupDisconnecting = false;
      state.backupReconnectRequired = false;
      state.backupNoticeMessage = 'Google Drive has been disconnected. Attendance records and completed backups remain intact.';
      await loadBackupStatus({ preserveMessages: true });
    } catch (err) {
      state.backupDisconnecting = false;
      state.backupErrorMessage = `Disconnect failed: ${sanitizeUiBackupError(err && err.message)}`;
      await loadBackupStatus({ preserveMessages: true });
    }
  }

  /**
   * Marks the specified student as 'present' or 'absent' and optionally advances focus to the next student.
   */
  function markStudent(studentId, status, autoAdvance = true) {
    if (state.saving) return;
    const win = getEditWindowStatus(state.existingSession);
    if (state.existingSession && !win.canEdit) return;
    if (status !== 'present' && status !== 'absent') return;

    const visibleRoster = getVisibleRoster();
    const clickedIdx = visibleRoster.findIndex((s) => s.studentId === studentId);
    if (clickedIdx >= 0) {
      state.currentStudentIndex = clickedIdx;
    }

    state.marksByStudentId = {
      ...state.marksByStudentId,
      [studentId]: status
    };
    state.saveError = null;
    state.saveSuccessMessage = null;

    if (autoAdvance && visibleRoster.length > 0) {
      if (state.currentStudentIndex < visibleRoster.length - 1) {
        state.currentStudentIndex += 1;
      }
    }
    render();
  }

  function markAllStudents(status) {
    if (state.saving) return;
    const win = getEditWindowStatus(state.existingSession);
    if (state.existingSession && !win.canEdit) return;
    if (status !== 'present' && status !== 'absent') return;

    const nextMarks = { ...state.marksByStudentId };
    for (const stu of state.roster) {
      nextMarks[stu.studentId] = status;
    }
    state.marksByStudentId = nextMarks;
    state.saveError = null;
    state.saveSuccessMessage = null;
    render();
  }

  /**
   * Handles keyboard attendance marking on the student register:
   * - 'P' / 'p' marks the focused student Present and moves focus to the next student.
   * - 'A' / 'a' marks the focused student Absent and moves focus to the next student.
   * - 'ArrowDown' / 'ArrowUp' navigates focus across students.
   * - Ignores keystrokes when typing in input, textarea, select, or contentEditable elements.
   */
  function handleKeyDown(e) {
    if (!e || !state.selectedSubjectId) return false;
    if (state.auditModalSessionId || state.selectedStudentDetailId) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;

    const target = e.target || (typeof document !== 'undefined' ? document.activeElement : null);
    if (target) {
      const tag = String(target.tagName || '').toUpperCase();
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        Boolean(target.isContentEditable) ||
        (typeof target.getAttribute === 'function' && target.getAttribute('contenteditable') === 'true')
      ) {
        return false;
      }
    }

    const visibleRoster = getVisibleRoster();
    if (!visibleRoster.length) return false;

    const idx = Math.min(Math.max(0, state.currentStudentIndex), visibleRoster.length - 1);
    const key = String(e.key || '');

    if (key === 'ArrowDown') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (idx < visibleRoster.length - 1) {
        state.currentStudentIndex = idx + 1;
        render();
      }
      return true;
    }

    if (key === 'ArrowUp') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (idx > 0) {
        state.currentStudentIndex = idx - 1;
        render();
      }
      return true;
    }

    if (key === 'p' || key === 'P') {
      const win = getEditWindowStatus(state.existingSession);
      if (state.saving || (state.existingSession && !win.canEdit)) return false;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      const focusedStudent = visibleRoster[idx];
      if (focusedStudent) {
        markStudent(focusedStudent.studentId, 'present', true);
        return true;
      }
    }

    if (key === 'a' || key === 'A') {
      const win = getEditWindowStatus(state.existingSession);
      if (state.saving || (state.existingSession && !win.canEdit)) return false;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      const focusedStudent = visibleRoster[idx];
      if (focusedStudent) {
        markStudent(focusedStudent.studentId, 'absent', true);
        return true;
      }
    }

    return false;
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

      if (state.selectedDate && state.selectedDate.length >= 7) {
        state.selectedMonth = state.selectedDate.slice(0, 7);
      }

      // Refresh server-backed roster/session, monthly matrix, history, and backup queue
      await Promise.all([
        loadRoster(),
        loadMonthlyMatrix(state.selectedMonth),
        loadHistory(),
        loadBackupStatus({ preserveMessages: true })
      ]);

      // Automatically sync subject folder Attendance (<Subject Name>) with Daily Attendance (<date>.xlsx)
      // and Monthly Attendance (<Month>.xlsx) when Google Drive has an active authorization token
      try {
        const driveClient = getOrInitDriveClient();
        if (
          driveClient &&
          typeof driveClient.hasValidAccessToken === 'function' &&
          driveClient.hasValidAccessToken() &&
          typeof driveClient.syncSubjectAttendanceToDrive === 'function' &&
          state.selectedSubjectId
        ) {
          const subObj = getSelectedSubjectObj();
          await driveClient.syncSubjectAttendanceToDrive({
            subjectId: state.selectedSubjectId,
            cohortId: state.selectedCohortId,
            subjectName: (subObj && subObj.name) || (state.rosterSubject && state.rosterSubject.name) || state.selectedSubjectId,
            date: state.selectedDate,
            month: state.selectedMonth
          });
        }
      } catch (_) {}

      render();
    } catch (err) {
      // Preserve complete local marking state on error — never silently discard an attendance change
      state.saving = false;
      const errMsg = err.message || 'Network error while saving attendance. Your selections have been preserved.';
      if (err.code === 'EDIT_WINDOW_EXPIRED' && state.existingSession) {
        state.existingSession = { ...state.existingSession, status: 'locked' };
      }
      state.saveError = errMsg;
      render();
    }
  }

  function openStudentDetail(studentId) {
    if (!studentId) return;
    state.selectedStudentDetailId = String(studentId).trim();
    render();
  }

  function closeStudentDetail() {
    state.selectedStudentDetailId = null;
    render();
  }

  async function openSessionByDate(sessionDate, cohortId = null) {
    if (!sessionDate) return;
    if (!confirmDiscardIfDirty()) return;
    if (cohortId) {
      state.selectedCohortId = cohortId;
    }
    state.selectedDate = sessionDate;
    if (sessionDate.length >= 7 && sessionDate.slice(0, 7) !== state.selectedMonth) {
      state.selectedMonth = sessionDate.slice(0, 7);
      await Promise.all([loadRoster(), loadMonthlyMatrix(state.selectedMonth)]);
      return;
    }
    await loadRoster();
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

  let beforeUnloadBound = false;
  function handleBeforeUnload(e) {
    if (hasUnsavedChanges()) {
      e.preventDefault();
      e.returnValue = '';
    }
  }
  function syncBeforeUnloadListener() {
    if (typeof window.addEventListener !== 'function') return;
    const dirty = hasUnsavedChanges();
    if (dirty && !beforeUnloadBound) {
      window.addEventListener('beforeunload', handleBeforeUnload);
      beforeUnloadBound = true;
    } else if (!dirty && beforeUnloadBound) {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      beforeUnloadBound = false;
    }
  }

  let globalKeydownBound = false;
  function bindGlobalKeydown() {
    if (globalKeydownBound || typeof window.addEventListener !== 'function') return;
    window.addEventListener('keydown', handleKeyDown);
    globalKeydownBound = true;
  }

  function unbindGlobalKeydown() {
    if (!globalKeydownBound || typeof window.removeEventListener !== 'function') return;
    window.removeEventListener('keydown', handleKeyDown);
    globalKeydownBound = false;
  }

  function formatBackupTimestamp(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return String(isoStr);
    try {
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return d.toISOString();
    }
  }

  function renderDriveBackupCard() {
    const statusData = state.backupStatusData;
    if (!statusData && state.loadingBackup) {
      return `
        <div class="sl-att-backup-card" id="slAttDriveBackupCard">
          <div class="sl-att-backup-top">
            <div>
              <div class="sl-att-backup-title-row">
                <h3 class="sl-att-backup-title">Attendance Backup</h3>
                <span class="sl-att-badge">Checking…</span>
              </div>
              <p class="sl-att-backup-desc">Checking Google Drive backup status…</p>
            </div>
          </div>
        </div>
      `;
    }

    if (statusData && statusData.role === 'admin') {
      return '';
    }

    const oauth = (statusData && statusData.oauth) || { configured: false };
    const connection = (statusData && statusData.connection) || {
      connected: false,
      connectionStatus: oauth.configured ? 'disconnected' : 'not_configured',
      googleEmail: null,
      lastSyncedAt: null
    };
    const summary = (statusData && statusData.summary) || {
      actionableRuns: 0,
      pendingRuns: 0,
      inProgressRuns: 0,
      failedRuns: 0,
      reconnectRequiredRuns: 0,
      backedUpRuns: 0
    };
    const pendingRuns = Array.isArray(state.backupPendingRuns) ? state.backupPendingRuns : [];
    const isBusy = state.backupConnecting || state.backupSyncing || state.backupDisconnecting;

    const actionableCount = Number(summary.actionableRuns || 0);
    const failedCount = Number(summary.failedRuns || 0);
    const backedUpCount = Number(summary.backedUpRuns || 0);
    const inProgressCount = Number(summary.inProgressRuns || 0);

    const isNotConfigured = !oauth.configured || connection.connectionStatus === 'not_configured';
    const isReconnectRequired =
      !isNotConfigured &&
      (connection.connectionStatus === 'reconnect_required' ||
        Number(summary.reconnectRequiredRuns || 0) > 0 ||
        Boolean(state.backupReconnectRequired));
    const isConnected = !isNotConfigured && !isReconnectRequired && connection.connectionStatus === 'connected';
    const isNotConnected = !isNotConfigured && !isReconnectRequired && !isConnected;

    let badgeLabel = 'Not Connected';
    let badgeClass = '';
    let descriptionText = '';
    let actionsHtml = '';

    if (state.backupConnecting) {
      badgeLabel = 'Connecting…';
      badgeClass = 'present';
      descriptionText = 'Authorizing your Google Drive account and verifying attendance backup folders…';
      actionsHtml = `
        <button type="button" class="teach-btn teach-btn-primary" disabled aria-busy="true">
          Connecting…
        </button>
      `;
    } else if (state.backupSyncing) {
      badgeLabel = 'Syncing…';
      badgeClass = 'present';
      descriptionText = 'Uploading pending attendance snapshots and Excel (.xlsx) workbooks to your Google Drive…';
      actionsHtml = `
        <button type="button" class="teach-btn teach-btn-primary" disabled aria-busy="true">
          Syncing Backups…
        </button>
        <button type="button" class="teach-btn teach-btn-secondary" disabled>
          Disconnect Google Drive
        </button>
      `;
    } else if (state.backupDisconnecting) {
      badgeLabel = 'Disconnecting…';
      badgeClass = '';
      descriptionText = 'Disconnecting your Google Drive account and releasing active sync leases…';
      actionsHtml = `
        <button type="button" class="teach-btn teach-btn-secondary" disabled aria-busy="true">
          Disconnecting…
        </button>
      `;
    } else if (isNotConfigured) {
      badgeLabel = 'Not Configured';
      badgeClass = '';
      descriptionText =
        'Google Drive backup integration has not been configured yet. Classroom attendance submission, 24-hour teacher edits, and session history continue to work normally.';
      actionsHtml = `
        <button
          type="button"
          class="teach-btn teach-btn-secondary"
          data-att-backup-action="connect"
          disabled
          aria-disabled="true"
        >
          Connect Google Drive
        </button>
      `;
    } else if (isReconnectRequired) {
      badgeLabel = 'Reconnection Required';
      badgeClass = 'absent';
      descriptionText =
        'Your Google Drive authorization has expired or been revoked. Reconnect your Google Drive account to resume syncing pending attendance backups. Already completed backup files are preserved.';
      actionsHtml = `
        <button
          type="button"
          class="teach-btn teach-btn-primary"
          data-att-backup-action="reconnect"
          ${isBusy ? 'disabled' : ''}
        >
          Reconnect Google Drive
        </button>
        <button
          type="button"
          class="teach-btn teach-btn-secondary"
          data-att-backup-action="disconnect"
          ${isBusy ? 'disabled' : ''}
        >
          Disconnect Google Drive
        </button>
      `;
    } else if (isConnected) {
      if (failedCount > 0) {
        badgeLabel = 'Sync Attention Needed';
        badgeClass = 'unmarked';
        descriptionText =
          'One or more attendance backup artifacts failed to upload. Already completed artifacts are preserved; retry syncing to finish the remaining items.';
      } else {
        badgeLabel = 'Connected';
        badgeClass = 'present';
        descriptionText =
          actionableCount === 0 && pendingRuns.length === 0
            ? 'Everything is up to date. Immutable JSON snapshots and Excel (.xlsx) workbooks are synced to your Google Drive.'
            : `${actionableCount || pendingRuns.length} attendance backup revision${(actionableCount || pendingRuns.length) === 1 ? ' is' : 's are'} ready to sync to your Google Drive.`;
      }
      actionsHtml = `
        <button
          type="button"
          class="teach-btn teach-btn-primary"
          data-att-backup-action="${failedCount > 0 ? 'retry-sync' : 'sync'}"
          ${isBusy ? 'disabled' : ''}
        >
          ${failedCount > 0 ? 'Retry Sync' : 'Sync Now'}
        </button>
        <button
          type="button"
          class="teach-btn teach-btn-secondary"
          data-att-backup-action="disconnect"
          ${isBusy ? 'disabled' : ''}
        >
          Disconnect Google Drive
        </button>
      `;
    } else if (isNotConnected) {
      badgeLabel = 'Not Connected';
      badgeClass = '';
      descriptionText =
        'Connect your personal Google Drive to back up immutable JSON attendance snapshots and daily/annual Excel (.xlsx) workbooks under your own account.';
      actionsHtml = `
        <button
          type="button"
          class="teach-btn teach-btn-primary"
          data-att-backup-action="connect"
          ${isBusy ? 'disabled' : ''}
        >
          Connect Google Drive
        </button>
      `;
    }

    const lastSyncedFormatted = formatBackupTimestamp(connection.lastSyncedAt);
    const serverErrText =
      !state.backupErrorMessage && ((oauth && oauth.configError) || connection.lastErrorMessage)
        ? sanitizeUiBackupError((oauth && oauth.configError) || connection.lastErrorMessage)
        : null;
    const effectiveErrorMessage = state.backupErrorMessage || serverErrText;
    const attentionRuns = pendingRuns.slice(0, 5);

    return `
      <section class="sl-att-backup-card" id="slAttDriveBackupCard" aria-label="Attendance Backup">
        <div class="sl-att-backup-top">
          <div style="flex: 1; min-width: 240px;">
            <div class="sl-att-backup-title-row">
              <h3 class="sl-att-backup-title">Attendance Backup</h3>
              <span class="sl-att-badge ${badgeClass}" data-att-backup-state="${escapeHtml(connection.connectionStatus || 'not_configured')}">
                ${escapeHtml(badgeLabel)}
              </span>
            </div>
            <p class="sl-att-backup-desc">${escapeHtml(descriptionText)}</p>
          </div>
          <div class="sl-att-backup-actions">
            ${actionsHtml}
          </div>
        </div>

        ${
          !isNotConfigured
            ? `
          <div class="sl-att-backup-meta-row">
            <span class="sl-att-backup-meta-item">
              Drive Status: <strong>${escapeHtml(isReconnectRequired ? 'Reconnection Required' : isConnected ? 'Connected' : 'Disconnected')}</strong>
            </span>
            ${
              connection.googleEmail
                ? `<span class="sl-att-backup-meta-item">Account: <strong>${escapeHtml(connection.googleEmail)}</strong></span>`
                : ''
            }
            ${
              lastSyncedFormatted
                ? `<span class="sl-att-backup-meta-item">Last Synced: <strong>${escapeHtml(lastSyncedFormatted)}</strong></span>`
                : isConnected || isReconnectRequired
                ? `<span class="sl-att-backup-meta-item">Last Synced: <strong>Not synced yet</strong></span>`
                : ''
            }
            <span class="sl-att-backup-meta-item">
              Pending Backups: <strong>${actionableCount}</strong>
            </span>
            <span class="sl-att-backup-meta-item">
              Backed Up: <strong>${backedUpCount}</strong>
            </span>
            ${
              failedCount > 0
                ? `<span class="sl-att-backup-meta-item">Failed: <strong>${failedCount}</strong></span>`
                : ''
            }
            ${
              inProgressCount > 0
                ? `<span class="sl-att-backup-meta-item">In Progress: <strong>${inProgressCount}</strong></span>`
                : ''
            }
          </div>
        `
            : ''
        }

        ${
          effectiveErrorMessage
            ? `
          <div class="sl-att-banner error" role="alert" style="margin-top: 12px; margin-bottom: 0;">
            <span>${escapeHtml(effectiveErrorMessage)}</span>
            ${
              !isBusy && (isConnected || isReconnectRequired)
                ? `<button type="button" class="teach-btn teach-btn-secondary" style="padding: 5px 12px; font-size: 0.78rem;" data-att-backup-action="${isReconnectRequired ? 'reconnect' : 'retry-sync'}">${isReconnectRequired ? 'Reconnect' : 'Retry'}</button>`
                : ''
            }
          </div>
        `
            : ''
        }

        ${
          state.backupNoticeMessage && !effectiveErrorMessage
            ? `
          <div class="sl-att-banner success" role="status" style="margin-top: 12px; margin-bottom: 0;">
            <span>${escapeHtml(state.backupNoticeMessage)}</span>
          </div>
        `
            : ''
        }

        ${
          !isNotConfigured && attentionRuns.length > 0
            ? `
          <div class="sl-att-backup-pending-list" aria-label="Pending attendance backup items">
            ${attentionRuns
              .map((run) => {
                const snapStatus = run.snapshotStatus || 'pending';
                const dailyStatus = run.dailyWorkbookStatus || 'pending';
                const annualStatus = run.annualWorkbookStatus || 'pending';
                const runErr = run.lastErrorMessage ? sanitizeUiBackupError(run.lastErrorMessage) : null;
                return `
                  <div class="sl-att-backup-pending-item">
                    <div>
                      <strong>${escapeHtml(run.subjectCode || run.subjectId || 'Subject')}${run.cohortName ? ' · ' + escapeHtml(run.cohortName) : ''}</strong>
                      <span> &middot; ${escapeHtml(run.sessionDate || '')} (v${Number(run.revisionNo || 1)})</span>
                      ${runErr ? `<div style="font-size: 0.75rem; margin-top: 2px;">${escapeHtml(runErr)}</div>` : ''}
                    </div>
                    <div class="sl-att-backup-art-pills">
                      <span class="sl-att-backup-art-pill ${escapeHtml(snapStatus)}">Snapshot: ${escapeHtml(snapStatus)}</span>
                      <span class="sl-att-backup-art-pill ${escapeHtml(dailyStatus)}">Daily XLSX: ${escapeHtml(dailyStatus)}</span>
                      <span class="sl-att-backup-art-pill ${escapeHtml(annualStatus)}">Annual XLSX: ${escapeHtml(annualStatus)}</span>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        `
            : ''
        }
      </section>
    `;
  }

  /**
   * 1. Renders the Subject-Selection Landing Page (Library-style monochrome subject cards).
   * Shown whenever state.selectedSubjectId === ''.
   */
  function renderSubjectSelectionLanding() {
    return `
      <div class="sl-att-root" id="slAttSubjectLanding">
        <div class="sl-att-subject-grid course-grid-clean" id="slAttSubjectGrid">
          ${state.subjects
            .map((sub) => {
              const cohorts = Array.isArray(sub.cohorts) ? sub.cohorts : [];
              const cohortLabel =
                cohorts.length > 0
                  ? cohorts.map((c) => c.displayName).join(', ')
                  : 'No active cohort';
              return `
                <button
                  type="button"
                  class="sl-att-subject-card course-card-minimal"
                  data-att-select-subject="${escapeHtml(sub.id)}"
                  aria-label="Open attendance register for ${escapeHtml(sub.code)} ${escapeHtml(sub.name)}"
                >
                  <div style="width: 100%;">
                    <div class="sl-att-subject-card-head course-card-head">
                      <span class="sl-att-code-badge course-code-badge">${escapeHtml(sub.code || sub.id)}</span>
                      <span class="sl-att-sem-pill">Semester ${escapeHtml(sub.semester)}</span>
                    </div>
                    <h3 class="sl-att-subject-title course-name-clean">${escapeHtml(sub.name || sub.title || sub.code)}</h3>
                  </div>
                  <div class="sl-att-subject-card-foot course-card-foot" style="width: 100%;">
                    <span>${escapeHtml(cohortLabel)} &middot; Sem ${escapeHtml(sub.semester)}</span>
                    <span class="sl-att-open-label open-label">Open Register &rarr;</span>
                  </div>
                </button>
              `;
            })
            .join('')}
        </div>

        ${state.hasExplicitDriveClient ? renderDriveBackupCard() : ''}
      </div>
    `;
  }

  /**
   * 2. Renders the Full Alphabetical Student Attendance Register with Present/Absent buttons,
   * keyboard shortcut focus state, and saving/saved/error feedback.
   */
  function renderStudentRegisterSection(counts, editWin, isReadOnly) {
    const visibleRoster = getVisibleRoster();
    const idx = visibleRoster.length > 0
      ? Math.min(Math.max(0, state.currentStudentIndex), visibleRoster.length - 1)
      : 0;
    const canSubmit = !isReadOnly && !state.saving && counts.total > 0 && counts.unmarked === 0;
    const isDirty = hasUnsavedChanges();

    let persistenceBadge = '';
    if (state.saving) {
      persistenceBadge = '<span class="sl-att-badge" data-att-save-state="saving">Saving…</span>';
    } else if (state.saveError) {
      persistenceBadge = '<span class="sl-att-badge absent" data-att-save-state="error">Save Error</span>';
    } else if (isDirty) {
      persistenceBadge = '<span class="sl-att-badge unmarked" data-att-save-state="unsaved">Unsaved Changes</span>';
    } else if (state.existingSession) {
      persistenceBadge = '<span class="sl-att-badge present" data-att-save-state="saved">Saved</span>';
    }

    return `
      <section class="sl-att-panel" id="slAttStudentRegisterSection" aria-label="Student Attendance Register">
        <div class="sl-att-register-toolbar">
          <div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <h3 style="margin:0; font-size:1.05rem; font-weight:700;">
                Student Attendance Register (${escapeHtml(state.selectedDate)})
              </h3>
              ${persistenceBadge}
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <input
              type="search"
              id="slAttStudentSearchInput"
              class="sl-att-input"
              style="width:210px; padding:7px 11px; font-size:0.82rem;"
              placeholder="Search student name or ID…"
              value="${escapeHtml(state.studentSearchQuery)}"
              aria-label="Search students in register"
            />
            ${
              !isReadOnly
                ? `
              <button
                type="button"
                class="teach-btn teach-btn-secondary"
                style="padding:7px 12px; font-size:0.78rem;"
                data-att-action="mark-all-present"
                ${state.saving ? 'disabled' : ''}
              >
                All Present
              </button>
              <button
                type="button"
                class="teach-btn teach-btn-secondary"
                style="padding:7px 12px; font-size:0.78rem;"
                data-att-action="mark-all-absent"
                ${state.saving ? 'disabled' : ''}
              >
                All Absent
              </button>
            `
                : ''
            }
          </div>
        </div>

        ${
          visibleRoster.length === 0
            ? `
          <div style="padding:28px 16px; text-align:center; color:var(--teach-text-secondary, #a3a3a3); font-size:0.86rem;">
            No students match "${escapeHtml(state.studentSearchQuery)}".
          </div>
        `
            : `
          <div class="sl-att-register-table-wrap">
            <div class="sl-att-register-list" role="listbox" aria-label="Alphabetical Student List">
              ${visibleRoster
                .map((student, sIdx) => {
                  const currentStatus = state.marksByStudentId[student.studentId] || null;
                  const isFocused = sIdx === idx;
                  return `
                    <div
                      class="sl-att-register-row ${isFocused ? 'focused' : ''}"
                      role="option"
                      aria-selected="${isFocused ? 'true' : 'false'}"
                      tabindex="${isFocused ? '0' : '-1'}"
                      data-att-student-row="${sIdx}"
                      data-att-student-id="${escapeHtml(student.studentId)}"
                    >
                      <div class="sl-att-student-info">
                        <span class="sl-att-row-num">${sIdx + 1}.</span>
                        <div style="min-width:0;">
                          <button
                            type="button"
                            class="sl-att-student-name-btn"
                            data-att-student-detail="${escapeHtml(student.studentId)}"
                            title="View detailed attendance history for ${escapeHtml(student.name)}"
                          >
                            ${escapeHtml(student.name)}
                          </button>
                          <div class="sl-att-student-id-sub">
                            ID: ${escapeHtml(student.studentId)}${student.username ? ` · @${escapeHtml(student.username)}` : ''}${student.role === 'cr' ? ' · CR' : ''}
                          </div>
                        </div>
                      </div>

                      <div class="sl-att-row-controls">
                        <button
                          type="button"
                          class="sl-att-mark-btn ${currentStatus === 'present' ? 'selected-present' : ''}"
                          data-att-mark-student="${escapeHtml(student.studentId)}"
                          data-att-mark-status="present"
                          data-att-review-mark="${escapeHtml(student.studentId)}"
                          data-att-review-status="present"
                          ${isReadOnly || state.saving ? 'disabled' : ''}
                          aria-pressed="${currentStatus === 'present' ? 'true' : 'false'}"
                        >
                          Present (P)
                        </button>
                        <button
                          type="button"
                          class="sl-att-mark-btn ${currentStatus === 'absent' ? 'selected-absent' : ''}"
                          data-att-mark-student="${escapeHtml(student.studentId)}"
                          data-att-mark-status="absent"
                          data-att-review-mark="${escapeHtml(student.studentId)}"
                          data-att-review-status="absent"
                          ${isReadOnly || state.saving ? 'disabled' : ''}
                          aria-pressed="${currentStatus === 'absent' ? 'true' : 'false'}"
                        >
                          Absent (A)
                        </button>
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
        `
        }

        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-top:16px; padding-top:14px; border-top:1px solid var(--teach-border-subtle, #242424);">
          <div style="font-size:0.84rem; color:var(--teach-text-secondary, #a3a3a3);">
            ${
              isReadOnly
                ? 'This session is locked for teacher edits because the 24-hour window has elapsed.'
                : counts.unmarked > 0
                ? `Submission blocked: ${counts.unmarked} student${counts.unmarked === 1 ? ' is' : 's are'} still unmarked.`
                : `All ${counts.total} students marked (${counts.present} Present, ${counts.absent} Absent).`
            }
          </div>
          ${
            !isReadOnly
              ? `
            <button
              type="button"
              class="teach-btn teach-btn-primary"
              data-att-action="submit-session"
              ${canSubmit ? '' : 'disabled'}
              ${state.saving ? 'aria-busy="true"' : ''}
            >
              ${
                state.saving
                  ? 'Saving Attendance…'
                  : state.existingSession
                  ? 'Save Attendance Changes'
                  : 'Confirm & Submit Attendance'
              }
            </button>
          `
              : ''
          }
        </div>
      </section>
    `;
  }

  /**
   * 3 & 4. Renders the Monthly Attendance Matrix with Month Selector, calendar date columns (1st through today or end of past month),
   * independent consecutive student attendance counts, 'ABS' for absences, '-' for non-session dates, Attendance %, and Download SVG.
   */
  function renderMonthlyMatrixSection() {
    const selectedMonth =
      state.selectedMonth ||
      (state.selectedDate ? state.selectedDate.slice(0, 7) : '') ||
      (state.currentNepalDate ? state.currentNepalDate.slice(0, 7) : '');
    const currentNepalMonth = state.currentNepalDate ? state.currentNepalDate.slice(0, 7) : '';

    const sessions = Array.isArray(state.monthlySessions) ? state.monthlySessions : [];
    const sessionByDate = new Map(sessions.map((s) => [s.sessionDate, s]));

    const calendarDates =
      Array.isArray(state.monthlyCalendarDates) && state.monthlyCalendarDates.length > 0
        ? state.monthlyCalendarDates
        : buildApplicableCalendarDatesForMonth(selectedMonth, state.currentNepalDate).map((d) => {
            const sess = sessionByDate.get(d.date) || null;
            return {
              ...d,
              hasSession: Boolean(sess),
              sessionId: sess ? sess.id : null,
              sessionNumber: sess ? sess.sessionNumber : null,
              status: sess ? sess.status : null
            };
          });

    const dateRangeLabel =
      state.monthlyDateRangeLabel ||
      (calendarDates.length > 0
        ? `${calendarDates[0].label} – ${calendarDates[calendarDates.length - 1].label}, ${selectedMonth.slice(0, 4)}`
        : formatMonthLabel(selectedMonth));

    const rows =
      Array.isArray(state.monthlyRows) && state.monthlyRows.length > 0
        ? state.monthlyRows
        : sortStudentsAlphabetically(state.roster || []).map((stu) => ({
            studentId: stu.studentId,
            name: stu.name,
            username: stu.username || null,
            role: stu.role || 'student',
            cells: calendarDates.map((calDate) => ({
              date: calDate.date,
              dateLabel: calDate.label,
              hasSession: false,
              sessionId: null,
              sessionNumber: null,
              sessionDate: calDate.date,
              status: 'no_session',
              consecutiveCount: null,
              display: '-'
            })),
            presentCount: 0,
            absentCount: 0,
            totalSessions: 0,
            attendancePercentage: 0,
            formattedPercentage: '0.0%'
          }));

    const exportSvgUrl =
      state.selectedSubjectId && state.selectedCohortId && selectedMonth
        ? `/api/attendance/monthly?subjectId=${encodeURIComponent(state.selectedSubjectId)}&cohortId=${encodeURIComponent(state.selectedCohortId)}&month=${encodeURIComponent(selectedMonth)}&format=svg`
        : null;

    const exportCsvUrl =
      state.selectedSubjectId && state.selectedCohortId && selectedMonth
        ? `/api/attendance/monthly?subjectId=${encodeURIComponent(state.selectedSubjectId)}&cohortId=${encodeURIComponent(state.selectedCohortId)}&month=${encodeURIComponent(selectedMonth)}&format=csv`
        : null;

    return `
      <section class="sl-att-panel" id="slAttMonthlyMatrixSection" aria-label="Monthly Attendance Matrix">
        <div class="sl-att-matrix-header">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:700;">
              Monthly Attendance Matrix &mdash; ${escapeHtml(formatMonthLabel(selectedMonth))}
            </h3>
          </div>

          <div class="sl-att-month-nav">
            <button
              type="button"
              class="teach-btn teach-btn-secondary"
              style="padding:6px 10px; font-size:0.78rem;"
              data-att-month-step="-1"
              title="Previous Month"
            >
              &larr; Prev Month
            </button>
            <input
              type="month"
              id="slAttMonthInput"
              class="sl-att-input"
              style="width:160px; padding:6px 10px; font-size:0.82rem;"
              value="${escapeHtml(selectedMonth)}"
              ${currentNepalMonth ? `max="${escapeHtml(currentNepalMonth)}"` : ''}
              aria-label="Select attendance month"
            />
            <button
              type="button"
              class="teach-btn teach-btn-secondary"
              style="padding:6px 10px; font-size:0.78rem;"
              data-att-month-step="1"
              ${currentNepalMonth && selectedMonth >= currentNepalMonth ? 'disabled' : ''}
              title="Next Month"
            >
              Next Month &rarr;
            </button>
            ${
              exportSvgUrl
                ? `
              <a
                href="${escapeHtml(exportSvgUrl)}"
                id="slAttDownloadSvgBtn"
                data-att-action="download-svg"
                class="teach-btn teach-btn-primary"
                style="padding:6px 12px; font-size:0.78rem; text-decoration:none;"
                download="gandaki_monthly_attendance_${escapeHtml(state.selectedSubjectId)}_${escapeHtml(selectedMonth)}.svg"
              >
                Download SVG
              </a>
            `
                : ''
            }
            ${
              exportCsvUrl
                ? `
              <a
                href="${escapeHtml(exportCsvUrl)}"
                class="teach-btn teach-btn-secondary"
                style="padding:6px 12px; font-size:0.78rem; text-decoration:none;"
                download
              >
                Export CSV
              </a>
            `
                : ''
            }
          </div>
        </div>

        ${
          sessions.length > 0
            ? `
          <div class="sl-att-session-strip" aria-label="Submitted sessions in ${escapeHtml(selectedMonth)}">
            ${sessions
              .map((sess) => {
                const isSelectedSession = sess.sessionDate === state.selectedDate;
                return `
                  <button
                    type="button"
                    class="sl-att-session-chip ${isSelectedSession ? 'active' : ''}"
                    data-att-open-session-date="${escapeHtml(sess.sessionDate)}"
                    data-att-open-session-cohort="${escapeHtml(state.selectedCohortId)}"
                    title="Open session ${sess.sessionNumber} (${escapeHtml(sess.sessionDate)})"
                  >
                    <span>#${sess.sessionNumber}</span>
                    <span>&middot;</span>
                    <span>${escapeHtml(sess.sessionDate)}</span>
                  </button>
                `;
              })
              .join('')}
          </div>
        `
            : `
          <div style="margin-bottom:12px; font-size:0.82rem; color:var(--teach-text-secondary, #a3a3a3);">
            No submitted class sessions recorded in ${escapeHtml(formatMonthLabel(selectedMonth))} yet.
          </div>
        `
        }

        <div class="sl-att-matrix-scroll">
          <table class="sl-att-matrix-table" id="slAttMonthlyMatrixTable">
            <thead>
              <tr>
                <th class="sl-att-col-student" scope="col">Name</th>
                ${calendarDates
                  .map((calDate) => {
                    if (calDate.hasSession) {
                      return `
                        <th scope="col" data-att-matrix-date="${escapeHtml(calDate.date)}" data-att-matrix-session-num="${calDate.sessionNumber}" data-att-matrix-session-date="${escapeHtml(calDate.date)}">
                          <button
                            type="button"
                            class="sl-att-matrix-session-btn"
                            data-att-open-session-date="${escapeHtml(calDate.date)}"
                            data-att-open-session-cohort="${escapeHtml(state.selectedCohortId)}"
                            title="${escapeHtml(calDate.label)} (${escapeHtml(calDate.date)}) — Session #${calDate.sessionNumber} (Click to open session)"
                          >
                            ${escapeHtml(calDate.label)}
                          </button>
                        </th>
                      `;
                    }
                    return `
                      <th scope="col" data-att-matrix-date="${escapeHtml(calDate.date)}" title="${escapeHtml(calDate.label)} (${escapeHtml(calDate.date)}) — No submitted session">
                        ${escapeHtml(calDate.label)}
                      </th>
                    `;
                  })
                  .join('')}
                <th scope="col">Attendance %</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length === 0
                  ? `
                <tr>
                  <td class="sl-att-col-student" colspan="${calendarDates.length + 2}">No students enrolled in this cohort.</td>
                </tr>
              `
                  : rows
                      .map((row) => {
                        const cells = Array.isArray(row.dateCells)
                          ? row.dateCells
                          : Array.isArray(row.cells)
                            ? row.cells
                            : [];
                        const pctText =
                          row.formattedPercentage ||
                          (row.totalSessions > 0
                            ? `${Number(row.attendancePercentage || 0).toFixed(1)}%`
                            : '0.0%');
                        return `
                          <tr data-att-matrix-student="${escapeHtml(row.studentId)}">
                            <td class="sl-att-col-student">
                              <button
                                type="button"
                                class="sl-att-student-name-btn"
                                data-att-student-detail="${escapeHtml(row.studentId)}"
                                title="View detailed attendance history for ${escapeHtml(row.name)}"
                              >
                                ${escapeHtml(row.name)}
                              </button>
                              <div class="sl-att-student-id-sub">${escapeHtml(row.studentId)}</div>
                            </td>
                            ${cells
                              .map((cell) => {
                                const cellClass =
                                  cell.status === 'present'
                                    ? 'sl-att-cell-num'
                                    : cell.status === 'absent'
                                      ? 'sl-att-cell-abs'
                                      : 'sl-att-cell-dash';
                                const cellTitle =
                                  cell.status === 'present'
                                    ? `${row.name} — ${cell.dateLabel || cell.sessionDate}: Present (#${cell.display})`
                                    : cell.status === 'absent'
                                      ? `${row.name} — ${cell.dateLabel || cell.sessionDate}: Absent (ABS)`
                                      : `${row.name} — ${cell.dateLabel || cell.sessionDate}: No submitted session (-)`;
                                return `
                                  <td
                                    class="${cellClass}"
                                    data-att-cell-date="${escapeHtml(cell.date || cell.sessionDate)}"
                                    data-att-cell-status="${escapeHtml(cell.status)}"
                                    ${cell.sessionNumber ? `data-att-cell-session="${cell.sessionNumber}"` : ''}
                                    title="${escapeHtml(cellTitle)}"
                                  >${escapeHtml(cell.display)}</td>
                                `;
                              })
                              .join('')}
                            <td class="sl-att-cell-pct" data-att-student-pct="${escapeHtml(row.studentId)}">${escapeHtml(pctText)}</td>
                          </tr>
                        `;
                      })
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </section>
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

  /**
   * 5. Renders the Student Detailed Attendance History Modal when a student's name is clicked.
   */
  function renderStudentDetailModal() {
    const stuId = state.selectedStudentDetailId;
    if (!stuId) return '';

    const rosterStu = (state.roster || []).find((s) => s.studentId === stuId) || null;
    const monthRow = (state.monthlyRows || []).find((r) => r.studentId === stuId) || null;
    const hist = (state.studentHistoryByStudentId && state.studentHistoryByStudentId[stuId]) || null;

    const studentName = (hist && hist.name) || (monthRow && monthRow.name) || (rosterStu && rosterStu.name) || stuId;
    const username = (hist && hist.username) || (monthRow && monthRow.username) || (rosterStu && rosterStu.username) || null;
    const role = (hist && hist.role) || (monthRow && monthRow.role) || (rosterStu && rosterStu.role) || 'student';

    const monthPresent = monthRow ? monthRow.presentCount : 0;
    const monthAbsent = monthRow ? monthRow.absentCount : 0;
    const monthTotal = monthRow ? monthRow.totalSessions : 0;
    const monthPct = monthRow ? monthRow.formattedPercentage : '0.0%';

    const overallPresent = hist ? hist.overallPresentCount : monthPresent;
    const overallAbsent = hist ? hist.overallAbsentCount : monthAbsent;
    const overallTotal = hist ? hist.overallTotalSessions : monthTotal;
    const overallPct = hist ? hist.overallFormattedPercentage : monthPct;

    const sessionItems = hist && Array.isArray(hist.sessions)
      ? hist.sessions
      : monthRow && Array.isArray(monthRow.cells)
      ? monthRow.cells.map((c) => ({
          sessionId: c.sessionId,
          month: state.selectedMonth,
          sessionNumberInMonth: c.sessionNumber,
          sessionDate: c.sessionDate,
          status: c.status,
          consecutiveCount: c.consecutiveCount,
          display: c.display
        }))
      : [];

    const sub = getSelectedSubjectObj();

    return `
      <div class="teach-modal-overlay open" id="slAttStudentDetailModal" role="dialog" aria-modal="true" aria-label="Student Attendance History">
        <div class="teach-modal-card" style="max-width:640px;">
          <div class="teach-modal-header">
            <div>
              <h3 class="teach-modal-title">${escapeHtml(studentName)}</h3>
              <div style="font-size:0.8rem; color:var(--teach-text-secondary, #a3a3a3); font-family:monospace; margin-top:2px;">
                ID: ${escapeHtml(stuId)}${username ? ` · @${escapeHtml(username)}` : ''}${role === 'cr' ? ' · CR' : ''}${sub ? ` · ${escapeHtml(sub.code)}` : ''}
              </div>
            </div>
            <button type="button" class="teach-modal-close" data-att-action="close-student-detail" aria-label="Close student history">&times;</button>
          </div>

          <div class="sl-att-summary-pills" style="margin-bottom:16px;">
            <div class="sl-att-stat-box">
              <div class="sl-att-stat-val">${monthPresent}/${monthTotal}</div>
              <div class="sl-att-stat-lbl">${escapeHtml(state.selectedMonth || 'Month')} Attended</div>
            </div>
            <div class="sl-att-stat-box">
              <div class="sl-att-stat-val">${escapeHtml(monthPct)}</div>
              <div class="sl-att-stat-lbl">Monthly %</div>
            </div>
            <div class="sl-att-stat-box">
              <div class="sl-att-stat-val">${overallPresent}/${overallTotal}</div>
              <div class="sl-att-stat-lbl">Overall Attended</div>
            </div>
            <div class="sl-att-stat-box">
              <div class="sl-att-stat-val">${escapeHtml(overallPct)}</div>
              <div class="sl-att-stat-lbl">Overall %</div>
            </div>
          </div>

          <div style="font-size:0.82rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--teach-text-secondary, #a3a3a3); margin-bottom:8px;">
            Chronological Session History (${sessionItems.length})
          </div>

          ${
            sessionItems.length === 0
              ? `
            <div style="padding:24px 16px; text-align:center; color:var(--teach-text-secondary, #a3a3a3); font-size:0.86rem;">
              No submitted attendance sessions recorded for this student yet.
            </div>
          `
              : `
            <div style="max-height:340px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;">
              ${sessionItems
                .map(
                  (item) => `
                <div class="sl-att-review-row" style="padding:10px 14px;">
                  <div>
                    <div style="font-weight:700; font-size:0.88rem;">
                      Session #${item.sessionNumberInMonth} &middot; ${escapeHtml(item.sessionDate)}
                    </div>
                    <div style="font-size:0.76rem; color:var(--teach-text-secondary, #a3a3a3);">
                      Month: ${escapeHtml(item.month || item.sessionDate.slice(0, 7))}
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span class="sl-att-badge ${item.status === 'present' ? 'present' : 'absent'}">
                      ${item.status === 'present' ? `Present (#${escapeHtml(item.display)})` : 'ABS'}
                    </span>
                    <button
                      type="button"
                      class="teach-btn teach-btn-secondary"
                      style="padding:4px 10px; font-size:0.75rem;"
                      data-att-open-session-date="${escapeHtml(item.sessionDate)}"
                      data-att-open-session-cohort="${escapeHtml(state.selectedCohortId)}"
                    >
                      Open Session
                    </button>
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

  function render() {
    syncBeforeUnloadListener();
    const container = state.containerEl;
    if (!container) return;

    if (state.loadingContext) {
      container.innerHTML = `
        <div class="sl-att-root">
          <div class="sl-att-panel" style="text-align:center; padding:40px 20px;">
            <div style="font-weight:700; font-size:1rem; margin-bottom:6px;">Loading Attendance Workspace…</div>
            <div style="font-size:0.85rem; color:var(--teach-text-secondary, #a3a3a3);">Fetching your subjects and active class cohorts.</div>
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

    // 1. Landing Page: Subject Selection (do not show attendance-taking interface before a subject is selected)
    if (!state.selectedSubjectId) {
      container.innerHTML = renderSubjectSelectionLanding();
      bindEvents(container);
      return;
    }

    const selectedSub = getSelectedSubjectObj();
    const eligibleCohorts = getEligibleCohortsForSelectedSubject();
    const counts = getRosterCounts();
    const editWin = getEditWindowStatus(state.existingSession);
    const isReadOnly = Boolean(state.existingSession && !editWin.canEdit);

    let mainStageHtml = '';

    if (!state.selectedCohortId || eligibleCohorts.length === 0) {
      mainStageHtml = `
        <div class="sl-att-panel" style="text-align:center; padding:36px 24px;">
          <div style="font-weight:700; font-size:1rem; margin-bottom:6px;">No Active Cohort in Semester ${escapeHtml(selectedSub ? selectedSub.semester : '')}</div>
          <div style="font-size:0.86rem; color:var(--teach-text-secondary, #a3a3a3);">
            There is currently no active student cohort enrolled in Semester ${escapeHtml(selectedSub ? selectedSub.semester : '')} for ${escapeHtml(selectedSub ? selectedSub.name : 'this subject')}.
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
      mainStageHtml = `
        ${renderHistoryStage()}
        ${renderMonthlyMatrixSection()}
      `;
    } else if (state.roster.length === 0) {
      mainStageHtml = `
        <div class="sl-att-panel" style="text-align:center; padding:36px 24px;">
          <div style="font-weight:700; font-size:1rem; margin-bottom:6px;">No Active Students in Cohort</div>
          <div style="font-size:0.86rem; color:var(--teach-text-secondary, #a3a3a3);">
            This cohort currently has no active enrolled student or CR accounts.
          </div>
        </div>
      `;
    } else {
      mainStageHtml = `
        ${renderStudentRegisterSection(counts, editWin, isReadOnly)}
        ${renderMonthlyMatrixSection()}
      `;
    }

    container.innerHTML = `
      <div class="sl-att-root">
        <!-- Subject Header & Back to Subjects Navigation -->
        <div class="sl-att-reg-topbar">
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <button type="button" class="sl-att-back-btn" data-att-action="back-to-subjects">
              &larr; All Subjects
            </button>
            <div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="sl-att-code-badge">${escapeHtml(selectedSub ? selectedSub.code : state.selectedSubjectId)}</span>
                <span style="font-weight:800; font-size:1.1rem;">${escapeHtml(selectedSub ? selectedSub.name : '')}</span>
                <span class="sl-att-sem-pill">&middot; Semester ${escapeHtml(selectedSub ? selectedSub.semester : '')}</span>
              </div>
            </div>
          </div>
        </div>

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

        <!-- Teacher Google Drive Attendance Backup Card -->
        ${renderDriveBackupCard()}

        ${state.selectedStudentDetailId ? renderStudentDetailModal() : ''}
        ${state.auditModalSessionId ? renderAuditModal() : ''}
      </div>
    `;

    bindEvents(container);
  }

  function bindEvents(container) {
    // Subject card click on Landing Page
    container.querySelectorAll('[data-att-select-subject]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const subId = btn.getAttribute('data-att-select-subject');
        if (subId) selectSubject(subId);
      });
    });

    // Back to All Subjects button
    const backBtn = container.querySelector('[data-att-action="back-to-subjects"]');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        backToSubjects();
      });
    }

    const subjSelect = container.querySelector('#slAttSubjectSelect');
    if (subjSelect) {
      subjSelect.addEventListener('change', async (e) => {
        await selectSubject(e.target.value);
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
        await Promise.all([loadRoster(), loadMonthlyMatrix(state.selectedMonth), loadHistory()]);
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
        await openSessionByDate(nextDate);
      });
    }

    const monthInput = container.querySelector('#slAttMonthInput');
    if (monthInput) {
      monthInput.addEventListener('change', async (e) => {
        const nextMonth = (e.target.value || '').trim();
        if (!/^\d{4}-\d{2}$/.test(nextMonth)) return;
        state.selectedMonth = nextMonth;
        await loadMonthlyMatrix(nextMonth);
      });
    }

    container.querySelectorAll('[data-att-month-step]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const step = Number(btn.getAttribute('data-att-month-step') || 0);
        if (!step) return;
        const baseMonth =
          state.selectedMonth ||
          (state.selectedDate ? state.selectedDate.slice(0, 7) : '') ||
          (state.currentNepalDate ? state.currentNepalDate.slice(0, 7) : '');
        const nextMonth = stepMonthString(baseMonth, step);
        const maxMonth = state.currentNepalDate ? state.currentNepalDate.slice(0, 7) : '';
        if (maxMonth && nextMonth > maxMonth) return;
        state.selectedMonth = nextMonth;
        await loadMonthlyMatrix(nextMonth);
      });
    });

    const searchInput = container.querySelector('#slAttStudentSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.studentSearchQuery = e.target.value || '';
        state.currentStudentIndex = 0;
        render();
        const refreshedInput = container.querySelector('#slAttStudentSearchInput');
        if (refreshedInput && typeof refreshedInput.focus === 'function') {
          refreshedInput.focus();
          try {
            const len = refreshedInput.value.length;
            refreshedInput.setSelectionRange(len, len);
          } catch (_) {}
        }
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
      btn.addEventListener('click', (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        const sId = btn.getAttribute('data-att-mark-student');
        const st = btn.getAttribute('data-att-mark-status');
        markStudent(sId, st, true);
      });
    });

    container.querySelectorAll('[data-att-student-row]').forEach((rowEl) => {
      rowEl.addEventListener('click', (e) => {
        const t = e && e.target;
        if (t && typeof t.closest === 'function' && t.closest('button')) return;
        const idx = Number(rowEl.getAttribute('data-att-student-row'));
        if (Number.isInteger(idx) && idx >= 0) {
          state.currentStudentIndex = idx;
          render();
        }
      });
    });

    container.querySelectorAll('[data-att-student-detail]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        const sId = btn.getAttribute('data-att-student-detail');
        if (sId) openStudentDetail(sId);
      });
    });

    const closeStudentDetailBtn = container.querySelector('[data-att-action="close-student-detail"]');
    if (closeStudentDetailBtn) {
      closeStudentDetailBtn.addEventListener('click', closeStudentDetail);
    }

    const markAllPresentBtn = container.querySelector('[data-att-action="mark-all-present"]');
    if (markAllPresentBtn) {
      markAllPresentBtn.addEventListener('click', () => markAllStudents('present'));
    }

    const markAllAbsentBtn = container.querySelector('[data-att-action="mark-all-absent"]');
    if (markAllAbsentBtn) {
      markAllAbsentBtn.addEventListener('click', () => markAllStudents('absent'));
    }

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
        const sDate = btn.getAttribute('data-att-open-session-date');
        const cId = btn.getAttribute('data-att-open-session-cohort');
        state.selectedStudentDetailId = null;
        state.stage = 'marking';
        await openSessionByDate(sDate, cId);
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

    container.querySelectorAll('[data-att-backup-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const action = btn.getAttribute('data-att-backup-action');
        if (action === 'connect' || action === 'reconnect') {
          connectDriveBackup();
        } else if (action === 'sync') {
          syncDriveBackup({ forceRetry: false });
        } else if (action === 'retry-sync') {
          syncDriveBackup({ forceRetry: true });
        } else if (action === 'disconnect') {
          disconnectDriveBackup();
        }
      });
    });
  }

  function unmount() {
    stopCountdownTicker();
    unbindGlobalKeydown();
  }

  /**
   * Mounts and opens the Teacher Attendance Workspace inside target container.
   */
  async function mount(containerOrSelector, options = {}) {
    injectStyles();
    if (options && options.driveClient) {
      state.driveClient = options.driveClient;
      state.hasExplicitDriveClient = true;
    }
    const el =
      typeof containerOrSelector === 'string'
        ? document.querySelector(containerOrSelector)
        : containerOrSelector;
    if (!el) return;

    state.containerEl = el;
    startCountdownTicker();
    bindGlobalKeydown();

    if (options && options.subjectKey) {
      state.stage = 'marking';
      state.saveError = null;
      state.saveSuccessMessage = null;
      state.initialized = true;
      await loadTeacherContext(options.subjectKey);
    } else if (!state.initialized) {
      state.initialized = true;
      state.selectedSubjectId = '';
      await loadTeacherContext(null);
    } else {
      render();
    }
  }

  window.TeacherAttendanceWorkspace = {
    mount,
    unmount,
    selectSubject,
    backToSubjects,
    loadTeacherContext,
    loadRoster,
    loadMonthlyMatrix,
    downloadMonthlySvg,
    loadHistory,
    loadBackupStatus,
    connectDriveBackup,
    syncDriveBackup,
    disconnectDriveBackup,
    setDriveClient,
    markStudent,
    markAllStudents,
    handleKeyDown,
    submitAttendance,
    openStudentDetail,
    closeStudentDetail,
    openSessionByDate,
    openSessionAuditModal,
    closeAuditModal,
    hasUnsavedChanges,
    discardUnsavedChanges,
    getEditWindowStatus,
    compareStudentsAlphabetically,
    sortStudentsAlphabetically,
    buildApplicableCalendarDatesForMonth,
    buildMonthlyAttendanceMatrix,
    getState: () => state
  };
})(typeof window !== 'undefined' ? window : globalThis);
