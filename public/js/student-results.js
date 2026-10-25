/**
 * Semester Library — University Academic Results Portal (Student Web Module)
 *
 * Consumes the authoritative student published results endpoints:
 * - GET /api/results/my-results
 * - GET /api/results/report-card?semester=<semesterNo>
 *
 * Security & Data Integrity:
 * - Never sends a client-supplied studentId parameter.
 * - Never displays unpublished or draft marks.
 * - Never treats missing or unpublished marks as zero.
 * - Never invents GPA, letter grades, pass/fail status, class rank, or weighted final grades.
 * - Calculates percentages strictly from authoritative published marks and configured maximum marks.
 */
(function (window) {
  'use strict';

  const EXAM_TYPES = [
    'Mid-Term Exam',
    'Pre-Board Exam',
    'Final Exam'
  ];

  const state = {
    loading: false,
    error: null,
    errorStatus: null,
    data: null,
    selectedSemesterFilter: '', // Concrete semester number string (e.g. '1', '2')
    selectedExamFilter: 'ALL',  // 'ALL' | 'Mid-Term Exam' | 'Pre-Board Exam' | 'Final Exam'
    downloadingPdf: false,
    pdfError: null,
    pdfSuccessMessage: null,
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

  function formatNumber(val) {
    if (val === null || val === undefined || val === '') return '—';
    const num = Number(val);
    if (!Number.isFinite(num)) return '—';
    return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
  }

  function formatPercentage(pct, percentageAvailable = true) {
    if (!percentageAvailable || pct === null || pct === undefined || pct === '') return '—';
    const num = Number(pct);
    if (!Number.isFinite(num)) return '—';
    return Number.isInteger(num) ? `${num}%` : `${num.toFixed(2).replace(/\.?0+$/, '')}%`;
  }

  function formatDateDisplay(isoStr) {
    if (!isoStr) return '—';
    try {
      const dt = new Date(isoStr);
      if (Number.isNaN(dt.getTime())) return String(isoStr);
      return dt.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (_) {
      return String(isoStr);
    }
  }

  /**
   * Builds the list of selectable semesters for the student based on available result data
   * and current enrollment context.
   */
  function getAvailableSemestersList(data) {
    if (!data) return [];
    if (Array.isArray(data.availableSemesters) && data.availableSemesters.length > 0) {
      return data.availableSemesters;
    }
    const publishedSems = Array.isArray(data.semesters) ? data.semesters : [];
    const map = new Map();
    for (const s of publishedSems) {
      const no = Number(s.semesterNo);
      if (Number.isInteger(no) && no >= 1 && no <= 8) {
        map.set(no, {
          semesterNo: no,
          semesterLabel: s.semesterLabel || `Semester ${no}`,
          hasPublishedResults: (s.publishedExamsCount || (s.exams && s.exams.length) || 0) > 0,
          publishedSubjectsCount: s.publishedSubjectsCount || (s.subjects ? s.subjects.length : 0),
          publishedExamsCount: s.publishedExamsCount || 0
        });
      }
    }
    const currNo = Number(data.currentSemesterNo);
    if (Number.isInteger(currNo) && currNo >= 1 && currNo <= 8 && !map.has(currNo)) {
      map.set(currNo, {
        semesterNo: currNo,
        semesterLabel: `Semester ${currNo}`,
        hasPublishedResults: false,
        publishedSubjectsCount: 0,
        publishedExamsCount: 0
      });
    }
    return [...map.values()].sort((a, b) => b.semesterNo - a.semesterNo);
  }

  /**
   * Computes or retrieves the authoritative academic summary for a single semester object
   * strictly from valid published exams (never treating missing or unpublished marks as zero).
   */
  function computeSemesterSummary(semesterObj) {
    if (!semesterObj) {
      return {
        publishedSubjectsCount: 0,
        publishedExamsCount: 0,
        unpublishedExamsCount: 0,
        isPartiallyPublished: false,
        totalObtainedMarks: 0,
        totalMaxMarks: 0,
        overallPercentage: null,
        percentageAvailable: false
      };
    }

    if (semesterObj.summary && semesterObj.summary.overallPercentage !== undefined) {
      return semesterObj.summary;
    }

    const subjects = Array.isArray(semesterObj.subjects) ? semesterObj.subjects : [];
    let publishedSubjectsCount = 0;
    let publishedExamsCount = 0;
    let totalObtained = 0;
    let totalMax = 0;

    for (const subj of subjects) {
      const validExams = (subj.exams || []).filter(
        (ex) => ex && ex.status === 'published' && !ex.isMissing && ex.obtainedMarks !== null && ex.obtainedMarks !== undefined
      );
      if (validExams.length > 0) {
        publishedSubjectsCount += 1;
      }
      for (const ex of validExams) {
        publishedExamsCount += 1;
        totalObtained += Number(ex.obtainedMarks);
        totalMax += Number(ex.maxMarks);
      }
    }

    const totalObtainedMarks = Math.round(totalObtained * 100) / 100;
    const totalMaxMarks = Math.round(totalMax * 100) / 100;
    const overallPercentage = totalMaxMarks > 0
      ? Math.round(((totalObtainedMarks / totalMaxMarks) * 100) * 100) / 100
      : null;
    const expectedExams = publishedSubjectsCount * EXAM_TYPES.length;
    const unpublishedExamsCount = Math.max(0, expectedExams - publishedExamsCount);

    return {
      publishedSubjectsCount,
      publishedExamsCount,
      unpublishedExamsCount,
      isPartiallyPublished: publishedExamsCount > 0 && unpublishedExamsCount > 0,
      totalObtainedMarks,
      totalMaxMarks,
      overallPercentage,
      percentageAvailable: publishedExamsCount > 0 && totalMaxMarks > 0
    };
  }

  /**
   * Builds all 3 exam slots (Mid-Term Exam, Pre-Board Exam, Final Exam) for a subject,
   * preserving published results and marking unpublished exams as 'Not Yet Available'
   * without implying zero marks.
   */
  function getSubjectExamSlots(subj) {
    if (Array.isArray(subj.examSlots) && subj.examSlots.length === EXAM_TYPES.length) {
      return subj.examSlots;
    }
    const byType = new Map();
    for (const ex of subj.exams || []) {
      if (ex && ex.status === 'published') {
        byType.set(ex.examType, ex);
      }
    }
    return EXAM_TYPES.map((examType) => {
      const pub = byType.get(examType);
      if (pub) {
        return {
          ...pub,
          isPublished: true
        };
      }
      return {
        examType,
        subjectId: subj.subjectId,
        subjectCode: subj.code || subj.subjectId,
        subjectName: subj.name,
        semesterNo: subj.semesterNo,
        isPublished: false,
        isMissing: false,
        obtainedMarks: null,
        maxMarks: null,
        percentage: null,
        percentageAvailable: false,
        status: 'not_published',
        publicationStatus: 'Not Yet Available',
        publishedAt: null
      };
    });
  }

  function getActiveSemesterNumber() {
    const data = state.data;
    if (!data) return null;
    const semesters = Array.isArray(data.semesters) ? data.semesters : [];
    const avail = getAvailableSemestersList(data);

    if (state.selectedSemesterFilter && state.selectedSemesterFilter !== 'ALL') {
      const parsed = Number(state.selectedSemesterFilter);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 8) {
        return parsed;
      }
    }

    if (semesters.length > 0) {
      return Number(semesters[0].semesterNo);
    }
    if (avail.length > 0) {
      return Number(avail[0].semesterNo);
    }
    return Number(data.currentSemesterNo) || 1;
  }

  function injectStyles() {
    if (window.document.getElementById('sl-student-results-styles')) return;
    const style = window.document.createElement('style');
    style.id = 'sl-student-results-styles';
    style.textContent = `
      .stu-res-root {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--text, #f5f5f5);
        max-width: 1180px;
        margin: 0 auto;
      }
      .stu-res-card {
        background: var(--surface, #141416);
        border: 1.5px solid var(--border, #2a2a2e);
        border-radius: 16px;
        padding: 22px 24px;
        margin-bottom: 20px;
      }
      .stu-res-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        background: var(--surface, #141416);
        border: 1.5px solid var(--border, #2a2a2e);
        border-radius: 16px;
        padding: 16px 20px;
        margin-bottom: 20px;
      }
      .stu-res-select {
        box-sizing: border-box;
        padding: 9px 14px;
        border-radius: 10px;
        border: 1.5px solid var(--border, #2a2a2e);
        background: var(--bg, #0a0a0a);
        color: var(--text, #f5f5f5);
        font-size: 0.88rem;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        outline: none;
        min-width: 195px;
      }
      .stu-res-select:focus-visible {
        border-color: var(--text, #f5f5f5);
      }
      .stu-res-overall-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 14px;
        margin-top: 18px;
      }
      .stu-res-stat-tile {
        background: var(--surface-subtle, rgba(128, 128, 128, 0.06));
        border: 1px solid var(--border, #2a2a2e);
        border-radius: 13px;
        padding: 16px 18px;
      }
      .stu-res-stat-val {
        font-size: 1.6rem;
        font-weight: 800;
        letter-spacing: -0.03em;
        line-height: 1.15;
        color: var(--text, #f5f5f5);
        font-variant-numeric: tabular-nums;
      }
      .stu-res-stat-label {
        font-size: 0.74rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-muted, #a1a1aa);
        margin-top: 6px;
      }
      .stu-res-stat-sub {
        font-size: 0.75rem;
        color: var(--text-muted, #a1a1aa);
        margin-top: 3px;
        line-height: 1.35;
      }
      .stu-res-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 0.73rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        border: 1px solid var(--border, #3f3f46);
        white-space: nowrap;
      }
      .stu-res-badge.published {
        background: #f5f5f5;
        color: #09090b;
        border-color: #f5f5f5;
      }
      [data-theme="light"] .stu-res-badge.published {
        background: #111827;
        color: #ffffff;
        border-color: #111827;
      }
      .stu-res-badge.neutral {
        background: rgba(128, 128, 128, 0.1);
        color: var(--text, #e4e4e7);
        border-color: var(--border, #3f3f46);
      }
      .stu-res-badge.pending {
        background: transparent;
        color: var(--text-muted, #a1a1aa);
        border: 1px dashed var(--border, #3f3f46);
      }
      .stu-res-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 16px;
        border-radius: 10px;
        border: 1.5px solid var(--border, #3f3f46);
        background: var(--surface, #141416);
        color: var(--text, #f5f5f5);
        font-size: 0.84rem;
        font-weight: 700;
        cursor: pointer;
        text-decoration: none;
        font-family: inherit;
        transition: border-color 0.15s ease, opacity 0.15s ease;
      }
      .stu-res-btn:hover:not(:disabled) {
        border-color: var(--text, #f5f5f5);
      }
      .stu-res-btn:focus-visible {
        outline: 2px solid var(--text, #f5f5f5);
        outline-offset: 2px;
      }
      .stu-res-btn:disabled {
        opacity: 0.52;
        cursor: not-allowed;
      }
      .stu-res-btn-primary {
        background: #f5f5f5;
        color: #09090b;
        border-color: #f5f5f5;
      }
      [data-theme="light"] .stu-res-btn-primary {
        background: #111827;
        color: #ffffff;
        border-color: #111827;
      }
      .stu-res-filter-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 16px;
      }
      .stu-res-filter-pills {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .stu-res-filter-pill {
        padding: 7px 14px;
        border-radius: 999px;
        border: 1px solid var(--border, #3f3f46);
        background: transparent;
        color: var(--text-muted, #a1a1aa);
        font-size: 0.78rem;
        font-weight: 700;
        cursor: pointer;
        font-family: inherit;
      }
      .stu-res-filter-pill:focus-visible {
        outline: 2px solid var(--text, #f5f5f5);
        outline-offset: 2px;
      }
      .stu-res-filter-pill.active {
        background: var(--text, #f5f5f5);
        color: var(--bg, #09090b);
        border-color: var(--text, #f5f5f5);
      }
      .stu-res-subject-card {
        background: var(--surface, #141416);
        border: 1.5px solid var(--border, #2a2a2e);
        border-radius: 16px;
        padding: 20px 22px;
        margin-bottom: 16px;
      }
      .stu-res-table-wrap {
        width: 100%;
        overflow-x: auto;
        margin-top: 14px;
        border: 1px solid var(--border, #2a2a2e);
        border-radius: 12px;
        -webkit-overflow-scrolling: touch;
      }
      .stu-res-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.86rem;
        font-variant-numeric: tabular-nums;
      }
      .stu-res-table th,
      .stu-res-table td {
        padding: 11px 14px;
        border-bottom: 1px solid var(--border, #2a2a2e);
        text-align: left;
        vertical-align: middle;
      }
      .stu-res-table th {
        font-size: 0.72rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted, #a1a1aa);
        background: var(--surface-subtle, rgba(128, 128, 128, 0.06));
        white-space: nowrap;
      }
      .stu-res-table tr:last-child td {
        border-bottom: none;
      }
      .stu-res-table tr.unpublished-row td {
        color: var(--text-muted, #a1a1aa);
      }
      .stu-res-progress-track {
        width: 100%;
        max-width: 120px;
        height: 6px;
        border-radius: 999px;
        background: rgba(128, 128, 128, 0.16);
        overflow: hidden;
      }
      .stu-res-progress-fill {
        height: 100%;
        border-radius: 999px;
        background: var(--text, #f5f5f5);
      }
      .stu-res-banner {
        border-radius: 12px;
        padding: 12px 16px;
        margin-bottom: 16px;
        font-size: 0.84rem;
        line-height: 1.45;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        border: 1.5px solid var(--border, #2a2a2e);
        background: var(--surface-subtle, rgba(128, 128, 128, 0.06));
      }
      .stu-res-banner.error {
        border-color: #ef4444;
      }
      @media (max-width: 640px) {
        .stu-res-card {
          padding: 18px 15px;
        }
        .stu-res-toolbar {
          padding: 14px 15px;
        }
        .stu-res-subject-card {
          padding: 16px 14px;
        }
        .stu-res-table th,
        .stu-res-table td {
          padding: 10px 10px;
        }
      }
    `;
    window.document.head.appendChild(style);
  }

  async function loadResults() {
    state.loading = true;
    state.error = null;
    state.errorStatus = null;
    state.pdfError = null;
    render();

    try {
      const res = await authFetch('/api/results/my-results');
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = new Error(
          data.message ||
            (res.status === 401
              ? 'Your session has expired. Please sign in again to view your exam results.'
              : 'Unable to load your published exam results.')
        );
        err.status = res.status;
        throw err;
      }

      state.data = data;

      // Initialize selectedSemesterFilter to the most recent semester with published results (or current semester)
      const avail = getAvailableSemestersList(data);
      const publishedSems = Array.isArray(data.semesters) ? data.semesters : [];
      if (!state.selectedSemesterFilter || state.selectedSemesterFilter === 'ALL') {
        if (publishedSems.length > 0) {
          state.selectedSemesterFilter = String(publishedSems[0].semesterNo);
        } else if (avail.length > 0) {
          state.selectedSemesterFilter = String(avail[0].semesterNo);
        } else {
          state.selectedSemesterFilter = String(data.currentSemesterNo || 1);
        }
      }

      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message || 'Unable to load your published exam results.';
      state.errorStatus = err.status || null;
      render();
    }
  }

  function selectSemester(semesterVal) {
    const clean = String(semesterVal || '').trim();
    if (!clean) return;
    state.selectedSemesterFilter = clean;
    state.pdfError = null;
    state.pdfSuccessMessage = null;
    render();
  }

  function selectExamType(examTypeVal) {
    const clean = String(examTypeVal || 'ALL').trim();
    state.selectedExamFilter = clean;
    render();
  }

  /**
   * Downloads the official A4 PDF Report Card for the currently selected semester.
   */
  async function downloadReportCard(explicitSemesterNo = null) {
    if (state.downloadingPdf) return false;

    const targetSemNo = explicitSemesterNo !== null && explicitSemesterNo !== undefined
      ? Number(explicitSemesterNo)
      : getActiveSemesterNumber();

    if (!targetSemNo || !Number.isInteger(targetSemNo) || targetSemNo < 1 || targetSemNo > 8) {
      state.pdfError = 'Please select a specific semester (Semester 1–8) before downloading a report card.';
      render();
      return false;
    }

    const semesters = (state.data && Array.isArray(state.data.semesters)) ? state.data.semesters : [];
    const semObj = semesters.find((s) => Number(s.semesterNo) === targetSemNo);
    const semSummary = computeSemesterSummary(semObj);

    if (!semObj || semSummary.publishedExamsCount === 0) {
      state.pdfError = `No published examination results are available for Semester ${targetSemNo} to generate a report card.`;
      render();
      return false;
    }

    state.downloadingPdf = true;
    state.pdfError = null;
    state.pdfSuccessMessage = null;
    render();

    try {
      const url = `/api/results/report-card?semester=${encodeURIComponent(String(targetSemNo))}`;
      const res = await authFetch(url);

      if (!res.ok) {
        let errMessage = `Unable to generate the PDF report card for Semester ${targetSemNo}. Please try again.`;
        try {
          const errData = await res.json();
          if (errData && errData.message) {
            errMessage = errData.message;
          }
        } catch (_) {}
        throw new Error(errMessage);
      }

      const studentId = (state.data && (state.data.rollNumber || state.data.studentId)) || 'Student';
      const safeId = String(studentId).replace(/[^a-zA-Z0-9_-]/g, '');
      const filename = `Gandaki_University_Academic_Result_Report_Semester_${targetSemNo}_${safeId}.pdf`;

      let pdfBlob = null;
      if (typeof res.blob === 'function') {
        pdfBlob = await res.blob();
      } else if (typeof res.arrayBuffer === 'function') {
        const ab = await res.arrayBuffer();
        if (typeof window.Blob === 'function') {
          pdfBlob = new window.Blob([ab], { type: 'application/pdf' });
        }
      }

      if (
        pdfBlob &&
        window.URL &&
        typeof window.URL.createObjectURL === 'function' &&
        window.document &&
        typeof window.document.createElement === 'function'
      ) {
        const blobUrl = window.URL.createObjectURL(pdfBlob);
        const link = window.document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        link.style.display = 'none';
        if (window.document.body && typeof window.document.body.appendChild === 'function') {
          window.document.body.appendChild(link);
        }
        if (typeof link.click === 'function') {
          link.click();
        }
        if (link.parentNode && typeof link.parentNode.removeChild === 'function') {
          link.parentNode.removeChild(link);
        }
        const scheduleRevoke = (window && typeof window.setTimeout === "function") ? window.setTimeout : (typeof setTimeout === "function" ? setTimeout : null);
        if (scheduleRevoke) {
          scheduleRevoke(() => {
            try {
              window.URL.revokeObjectURL(blobUrl);
            } catch (_) {}
          }, 1500);
        }
      }

      state.downloadingPdf = false;
      state.pdfSuccessMessage = `Report card for Semester ${targetSemNo} downloaded (${filename}).`;
      render();
      return true;
    } catch (err) {
      state.downloadingPdf = false;
      state.pdfError = err.message || 'Unable to generate the PDF report card right now. Please try again.';
      render();
      return false;
    }
  }

  function render() {
    const container = state.containerEl;
    if (!container) return;

    if (state.loading) {
      container.innerHTML = `
        <div class="stu-res-root">
          <div class="stu-res-card" id="stuResultsLoadingState" role="status" aria-live="polite" style="text-align:center; padding:48px 24px;">
            <div style="font-size:1.05rem; font-weight:800; margin-bottom:6px;">Loading Academic Results…</div>
            <div style="font-size:0.86rem; color:var(--text-muted, #a1a1aa);">
              Retrieving your published semester examination records from Semester Library.
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (state.error) {
      const isAuthExpired = state.errorStatus === 401;
      container.innerHTML = `
        <div class="stu-res-root">
          <div class="stu-res-card" id="stuResultsErrorState" role="alert" style="text-align:center; padding:40px 24px;">
            <div style="font-size:1.08rem; font-weight:800; margin-bottom:8px;">
              ${isAuthExpired ? 'Sign In Required' : 'Could Not Load Academic Results'}
            </div>
            <div style="font-size:0.88rem; color:var(--text-muted, #a1a1aa); max-width:460px; margin:0 auto 18px;">
              ${escapeHtml(state.error)}
            </div>
            ${
              isAuthExpired
                ? `<a href="/login.html" class="stu-res-btn stu-res-btn-primary">Sign In</a>`
                : `<button type="button" class="stu-res-btn stu-res-btn-primary" data-stu-res-action="retry">Retry</button>`
            }
          </div>
        </div>
      `;
      bindEvents(container);
      return;
    }

    const data = state.data;
    if (!data) return;

    const semesters = Array.isArray(data.semesters) ? data.semesters : [];
    const availableSemesters = getAvailableSemestersList(data);
    const hasAnyPublishedResults = Boolean(data.hasPublishedResults && semesters.length > 0);
    const activeSemesterNo = getActiveSemesterNumber();
    const activeSemesterObj = semesters.find((s) => Number(s.semesterNo) === Number(activeSemesterNo)) || null;
    const semSummary = computeSemesterSummary(activeSemesterObj);
    const canDownloadPdf = Boolean(
      activeSemesterObj &&
      semSummary.publishedExamsCount > 0 &&
      !state.downloadingPdf
    );

    if (!hasAnyPublishedResults) {
      container.innerHTML = `
        <div class="stu-res-root">
          <!-- Student Identity & Semester Selector Bar -->
          <div class="stu-res-toolbar" aria-label="Academic Results Controls">
            <div>
              <div style="font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted, #a1a1aa);">
                ${data.cohort ? `${escapeHtml(data.cohort.displayName)} Cohort &middot; ` : ''}${escapeHtml(data.department || 'BIT')} &middot; Student ID: <strong>${escapeHtml(data.rollNumber || data.studentId)}</strong>
              </div>
              <div style="font-size:1rem; font-weight:800; margin-top:3px;">
                ${escapeHtml(data.name)}
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <label for="stuResSemesterSelect" style="font-size:0.78rem; font-weight:700; color:var(--text-muted, #a1a1aa);">
                Semester:
              </label>
              <select id="stuResSemesterSelect" class="stu-res-select" data-stu-res-sem-select aria-label="Select Semester">
                ${availableSemesters
                  .map(
                    (s) => `
                  <option value="${escapeHtml(s.semesterNo)}" ${Number(s.semesterNo) === Number(activeSemesterNo) ? 'selected' : ''}>
                    Semester ${escapeHtml(s.semesterNo)} (No Published Results)
                  </option>
                `
                  )
                  .join('')}
              </select>
              <button type="button" class="stu-res-btn" data-stu-res-action="retry">Refresh</button>
            </div>
          </div>

          <section class="stu-res-card" id="stuResultsEmptyState" style="text-align:center; padding:48px 24px;">
            <div style="font-size:1.15rem; font-weight:800; margin-bottom:8px;">
              Results Are Not Available Yet
            </div>
            <div style="font-size:0.9rem; color:var(--text-muted, #a1a1aa); max-width:540px; margin:0 auto 18px; line-height:1.55;">
              No examination results have been published for your account yet. Once your subject teachers publish marks for <strong>Mid-Term Exam</strong>, <strong>Pre-Board Exam</strong>, or <strong>Final Exam</strong>, your semester summary, subject-wise marks, and downloadable PDF report card will appear here.
            </div>
            <button type="button" class="stu-res-btn stu-res-btn-primary" data-stu-res-action="retry">Check Again</button>
          </section>
        </div>
      `;
      bindEvents(container);
      return;
    }

    const visibleSemesters =
      state.selectedSemesterFilter === 'ALL'
        ? semesters
        : activeSemesterObj
        ? [activeSemesterObj]
        : [];

    container.innerHTML = `
      <div class="stu-res-root">
        <!-- Top Control Bar: Student Context, Semester Selector, and Download Report Card -->
        <div class="stu-res-toolbar" aria-label="Academic Results Controls">
          <div>
            <div style="font-size:0.74rem; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted, #a1a1aa);">
              ${data.cohort ? `${escapeHtml(data.cohort.displayName)} Cohort &middot; ` : ''}${escapeHtml(data.department || 'BIT')} &middot; ID: <strong>${escapeHtml(data.rollNumber || data.studentId)}</strong>
            </div>
            <div style="font-size:1.05rem; font-weight:800; margin-top:2px;">
              ${escapeHtml(data.name)}
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <label for="stuResSemesterSelect" style="font-size:0.78rem; font-weight:700; color:var(--text-muted, #a1a1aa);">
              Semester:
            </label>
            <select id="stuResSemesterSelect" class="stu-res-select" data-stu-res-sem-select aria-label="Select Semester">
              ${availableSemesters
                .map(
                  (sem) => `
                <option value="${escapeHtml(sem.semesterNo)}" ${String(activeSemesterNo) === String(sem.semesterNo) && state.selectedSemesterFilter !== 'ALL' ? 'selected' : ''}>
                  Semester ${escapeHtml(sem.semesterNo)}${sem.hasPublishedResults ? ` (${sem.publishedSubjectsCount} ${sem.publishedSubjectsCount === 1 ? 'Subject' : 'Subjects'})` : ' (No Results Yet)'}
                </option>
              `
                )
                .join('')}
              ${
                semesters.length > 1
                  ? `<option value="ALL" ${state.selectedSemesterFilter === 'ALL' ? 'selected' : ''}>All Published Semesters (${semesters.length})</option>`
                  : ''
              }
            </select>

            <button
              type="button"
              id="stuResDownloadPdfBtn"
              class="stu-res-btn stu-res-btn-primary"
              data-stu-res-action="download-pdf"
              ${canDownloadPdf ? '' : 'disabled'}
              title="${canDownloadPdf ? `Download A4 PDF Report Card for Semester ${escapeHtml(activeSemesterNo)}` : 'Select a semester with published results to download report card'}"
            >
              ${
                state.downloadingPdf
                  ? 'Generating PDF Report…'
                  : `Download Report Card${activeSemesterNo ? ` (Sem ${escapeHtml(activeSemesterNo)})` : ''}`
              }
            </button>

            <button type="button" class="stu-res-btn" data-stu-res-action="retry" title="Refresh published results">
              Refresh
            </button>
          </div>
        </div>

        <!-- PDF Status / Error Banner -->
        ${
          state.pdfError
            ? `
          <div class="stu-res-banner error" id="stuResPdfErrorBanner" role="alert">
            <div>
              <strong>Report Card Download Failed:</strong> ${escapeHtml(state.pdfError)}
            </div>
            <button type="button" class="stu-res-btn" data-stu-res-action="download-pdf">Try Again</button>
          </div>
        `
            : ''
        }
        ${
          state.pdfSuccessMessage
            ? `
          <div class="stu-res-banner" id="stuResPdfSuccessBanner" role="status">
            <div>
              <strong>Report Card Ready:</strong> ${escapeHtml(state.pdfSuccessMessage)}
            </div>
          </div>
        `
            : ''
        }

        <!-- 1. Academic Summary for the Selected Semester -->
        <section class="stu-res-card" aria-label="Published Results Summary">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;">
            <div>
              <div style="font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted, #a1a1aa); margin-bottom:4px;">
                Semester ${escapeHtml(activeSemesterNo)} Academic Summary
              </div>
              <h2 style="margin:0 0 6px; font-size:1.35rem; font-weight:800; letter-spacing:-0.02em;">
                Published Results Summary &mdash; Semester ${escapeHtml(activeSemesterNo)}
              </h2>
              <div style="font-size:0.84rem; color:var(--text-muted, #a1a1aa);">
                Calculated strictly from published examination records in Semester ${escapeHtml(activeSemesterNo)}. Unpublished or pending exams are excluded.
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              ${
                semSummary.publishedExamsCount > 0
                  ? `<span class="stu-res-badge published">${semSummary.isPartiallyPublished ? 'Partially Published' : 'Published Record'}</span>`
                  : `<span class="stu-res-badge pending">No Published Results</span>`
              }
            </div>
          </div>

          <div class="stu-res-overall-grid">
            <div class="stu-res-stat-tile">
              <div class="stu-res-stat-val" data-stu-res-metric="subjects-count">
                ${Number(semSummary.publishedSubjectsCount) || 0}
              </div>
              <div class="stu-res-stat-label">Subjects with Published Results</div>
              <div class="stu-res-stat-sub">Semester ${escapeHtml(activeSemesterNo)} courses with published marks</div>
            </div>

            <div class="stu-res-stat-tile">
              <div class="stu-res-stat-val" data-stu-res-metric="exams-count">
                ${Number(semSummary.publishedExamsCount) || 0}
              </div>
              <div class="stu-res-stat-label">Published Exams</div>
              <div class="stu-res-stat-sub">Completed examination evaluations</div>
            </div>

            <div class="stu-res-stat-tile">
              <div class="stu-res-stat-val" data-stu-res-metric="aggregated-marks">
                ${
                  semSummary.publishedExamsCount > 0
                    ? `${escapeHtml(formatNumber(semSummary.totalObtainedMarks))} / ${escapeHtml(formatNumber(semSummary.totalMaxMarks))}`
                    : '—'
                }
              </div>
              <div class="stu-res-stat-label">Aggregated Published Marks</div>
              <div class="stu-res-stat-sub">Total obtained / total maximum marks</div>
            </div>

            <div class="stu-res-stat-tile">
              <div class="stu-res-stat-val" data-stu-res-metric="overall-percentage">
                ${formatPercentage(semSummary.overallPercentage, semSummary.percentageAvailable)}
              </div>
              <div class="stu-res-stat-label">Overall Percentage</div>
              <div class="stu-res-stat-sub">From aggregated published marks</div>
            </div>
          </div>

          ${
            semSummary.isPartiallyPublished
              ? `
            <div class="stu-res-banner" id="stuResPartialNotice" style="margin-top:16px; margin-bottom:0;">
              <div>
                <strong>Partial Semester Results:</strong> Some examination evaluations in Semester ${escapeHtml(activeSemesterNo)} have not been published yet. Totals and percentages above reflect only the ${semSummary.publishedExamsCount} published ${semSummary.publishedExamsCount === 1 ? 'exam' : 'exams'}.
              </div>
            </div>
          `
              : ''
          }
        </section>

        <!-- 2. Filter Controls (Exam Type & Quick Semester Pills) -->
        <div class="stu-res-filter-bar">
          <div class="stu-res-filter-pills" role="tablist" aria-label="Filter by Exam Type">
            <button
              type="button"
              class="stu-res-filter-pill ${state.selectedExamFilter === 'ALL' ? 'active' : ''}"
              data-stu-res-exam-filter="ALL"
            >
              All Exam Types
            </button>
            ${EXAM_TYPES.map(
              (et) => `
              <button
                type="button"
                class="stu-res-filter-pill ${state.selectedExamFilter === et ? 'active' : ''}"
                data-stu-res-exam-filter="${escapeHtml(et)}"
              >
                ${escapeHtml(et)}
              </button>
            `
            ).join('')}
          </div>

          ${
            availableSemesters.length > 1
              ? `
            <div class="stu-res-filter-pills" role="tablist" aria-label="Filter by Semester">
              ${availableSemesters
                .map(
                  (sem) => `
                <button
                  type="button"
                  class="stu-res-filter-pill ${String(state.selectedSemesterFilter) === String(sem.semesterNo) ? 'active' : ''}"
                  data-stu-res-sem-filter="${escapeHtml(sem.semesterNo)}"
                >
                  Semester ${escapeHtml(sem.semesterNo)}
                </button>
              `
                )
                .join('')}
              ${
                semesters.length > 1
                  ? `
                <button
                  type="button"
                  class="stu-res-filter-pill ${state.selectedSemesterFilter === 'ALL' ? 'active' : ''}"
                  data-stu-res-sem-filter="ALL"
                >
                  All Semesters
                </button>
              `
                  : ''
              }
            </div>
          `
              : ''
          }
        </div>

        <!-- 3. Semester & Subject-Wise Results Breakdown -->
        ${
          visibleSemesters.length === 0
            ? `
          <section class="stu-res-card" id="stuResEmptySemesterState" style="text-align:center; padding:42px 24px;">
            <div style="font-size:1.1rem; font-weight:800; margin-bottom:8px;">
              No Published Results for Semester ${escapeHtml(activeSemesterNo)}
            </div>
            <div style="font-size:0.88rem; color:var(--text-muted, #a1a1aa); max-width:520px; margin:0 auto 18px; line-height:1.5;">
              No examination results have been published for <strong>Semester ${escapeHtml(activeSemesterNo)}</strong> yet. Select another semester above to view your published records or check back once results are released.
            </div>
            ${
              semesters.length > 0
                ? `
              <button
                type="button"
                class="stu-res-btn stu-res-btn-primary"
                data-stu-res-sem-filter="${escapeHtml(semesters[0].semesterNo)}"
              >
                View Semester ${escapeHtml(semesters[0].semesterNo)} Results
              </button>
            `
                : ''
            }
          </section>
        `
            : visibleSemesters
                .map((sem) => {
                  const subjectsWithSlots = (sem.subjects || [])
                    .map((subj) => {
                      const allSlots = getSubjectExamSlots(subj);
                      const visibleSlots =
                        state.selectedExamFilter === 'ALL'
                          ? allSlots
                          : allSlots.filter(
                              (slot) => slot.examType === state.selectedExamFilter && slot.isPublished
                            );
                      return {
                        ...subj,
                        allSlots,
                        visibleSlots
                      };
                    })
                    .filter((subj) => subj.visibleSlots.length > 0);

                  if (subjectsWithSlots.length === 0) {
                    return `
                      <section class="stu-res-card" id="stuResEmptyExamFilterState" style="text-align:center; padding:36px 24px;">
                        <h3 style="margin:0 0 8px; font-size:1.08rem; font-weight:800;">
                          No Published ${escapeHtml(state.selectedExamFilter)} Results in ${escapeHtml(sem.semesterLabel)}
                        </h3>
                        <div style="font-size:0.86rem; color:var(--text-muted, #a1a1aa); margin-bottom:14px;">
                          Results for <strong>${escapeHtml(state.selectedExamFilter)}</strong> have not been published yet for ${escapeHtml(sem.semesterLabel)}.
                        </div>
                        <button type="button" class="stu-res-btn" data-stu-res-exam-filter="ALL">
                          Show All Exam Types
                        </button>
                      </section>
                    `;
                  }

                  return `
                    <section aria-label="${escapeHtml(sem.semesterLabel)} Results" style="margin-bottom:28px;">
                      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
                        <h3 style="margin:0; font-size:1.18rem; font-weight:800; letter-spacing:-0.02em;">
                          ${escapeHtml(sem.semesterLabel)} &middot; Subject-Wise Results (${subjectsWithSlots.length} ${subjectsWithSlots.length === 1 ? 'Subject' : 'Subjects'})
                        </h3>
                      </div>

                      ${subjectsWithSlots
                        .map((subj) => {
                          const publishedInSubj = (subj.exams || []).filter(
                            (e) => e && e.status === 'published' && !e.isMissing
                          );
                          const subjObtained = publishedInSubj.reduce((acc, e) => acc + Number(e.obtainedMarks || 0), 0);
                          const subjMax = publishedInSubj.reduce((acc, e) => acc + Number(e.maxMarks || 0), 0);
                          const subjPct = subjMax > 0
                            ? Math.round(((subjObtained / subjMax) * 100) * 100) / 100
                            : null;

                          return `
                            <article class="stu-res-subject-card" data-result-subject="${escapeHtml(subj.code || subj.subjectId)}">
                              <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                                <div>
                                  <div style="display:flex; align-items:center; gap:8px; margin-bottom:5px; flex-wrap:wrap;">
                                    <span style="font-size:0.75rem; font-weight:800; padding:3px 9px; border-radius:6px; background:rgba(128,128,128,0.14); border:1px solid var(--border, #3f3f46); font-family:ui-monospace, SFMono-Regular, Menlo, monospace;">
                                      ${escapeHtml(subj.code || subj.subjectId)}
                                    </span>
                                    <span style="font-size:0.78rem; color:var(--text-muted, #a1a1aa); font-weight:600;">
                                      Semester ${escapeHtml(subj.semesterNo)}
                                    </span>
                                    ${
                                      subj.creditHours
                                        ? `<span style="font-size:0.76rem; color:var(--text-muted, #a1a1aa);">&middot; ${escapeHtml(subj.creditHours)} Cr.</span>`
                                        : ''
                                    }
                                  </div>
                                  <h4 style="margin:0; font-size:1.08rem; font-weight:800; line-height:1.35;">
                                    ${escapeHtml(subj.name)}
                                  </h4>
                                </div>

                                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                  ${
                                    publishedInSubj.length > 0
                                      ? `
                                    <span class="stu-res-badge neutral" title="Aggregated published marks for ${escapeHtml(subj.code)}">
                                      Published Total: ${escapeHtml(formatNumber(subjObtained))} / ${escapeHtml(formatNumber(subjMax))} (${formatPercentage(subjPct, subjPct !== null)})
                                    </span>
                                  `
                                      : ''
                                  }
                                  <span class="stu-res-badge ${publishedInSubj.length === EXAM_TYPES.length ? 'published' : 'neutral'}">
                                    ${publishedInSubj.length} of ${EXAM_TYPES.length} Exams Published
                                  </span>
                                </div>
                              </div>

                              <div class="stu-res-table-wrap">
                                <table class="stu-res-table" aria-label="${escapeHtml(subj.name)} Exam Results">
                                  <thead>
                                    <tr>
                                      <th>Exam Type</th>
                                      <th>Obtained Marks</th>
                                      <th>Maximum Marks</th>
                                      <th>Percentage</th>
                                      <th>Publication Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    ${subj.visibleSlots
                                      .map((slot) => {
                                        if (!slot.isPublished) {
                                          return `
                                            <tr class="unpublished-row" data-exam-slot="${escapeHtml(slot.examType)}" data-exam-published="false">
                                              <td style="font-weight:700;">${escapeHtml(slot.examType)}</td>
                                              <td>&mdash;</td>
                                              <td>&mdash;</td>
                                              <td>&mdash;</td>
                                              <td>
                                                <span class="stu-res-badge pending">Not Yet Available</span>
                                              </td>
                                            </tr>
                                          `;
                                        }

                                        const isMissing = Boolean(
                                          slot.isMissing || slot.obtainedMarks === null || slot.obtainedMarks === undefined
                                        );
                                        const pctText = isMissing
                                          ? 'Missing Marks'
                                          : formatPercentage(slot.percentage, slot.percentageAvailable);
                                        const barWidth =
                                          !isMissing && Number.isFinite(Number(slot.percentage))
                                            ? Math.max(0, Math.min(100, Number(slot.percentage)))
                                            : 0;

                                        return `
                                          <tr data-exam-slot="${escapeHtml(slot.examType)}" data-exam-published="true">
                                            <td style="font-weight:700;">${escapeHtml(slot.examType)}</td>
                                            <td style="font-weight:800;">
                                              ${
                                                isMissing
                                                  ? '<span style="color:var(--text-muted, #a1a1aa);">Missing</span>'
                                                  : escapeHtml(formatNumber(slot.obtainedMarks))
                                              }
                                            </td>
                                            <td>${escapeHtml(formatNumber(slot.maxMarks))}</td>
                                            <td>
                                              <div style="display:flex; align-items:center; gap:10px;">
                                                <strong style="min-width:50px;">${escapeHtml(pctText)}</strong>
                                                ${
                                                  !isMissing
                                                    ? `
                                                  <div class="stu-res-progress-track" aria-hidden="true">
                                                    <div class="stu-res-progress-fill" style="width:${barWidth}%;"></div>
                                                  </div>
                                                `
                                                    : ''
                                                }
                                              </div>
                                            </td>
                                            <td>
                                              <span class="stu-res-badge published">Published</span>
                                              ${
                                                slot.publishedAt
                                                  ? `<span style="font-size:0.74rem; color:var(--text-muted, #a1a1aa); margin-left:6px;">${escapeHtml(formatDateDisplay(slot.publishedAt))}</span>`
                                                  : ''
                                              }
                                            </td>
                                          </tr>
                                        `;
                                      })
                                      .join('')}
                                  </tbody>
                                </table>
                              </div>
                            </article>
                          `;
                        })
                        .join('')}
                    </section>
                  `;
                })
                .join('')
        }
      </div>
    `;

    bindEvents(container);
  }

  function bindEvents(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return;

    container.querySelectorAll('[data-stu-res-action="retry"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        loadResults();
      });
    });

    container.querySelectorAll('[data-stu-res-action="download-pdf"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        downloadReportCard();
      });
    });

    const semSelect = container.querySelector('[data-stu-res-sem-select]');
    if (semSelect) {
      semSelect.addEventListener('change', (e) => {
        selectSemester(e.target && e.target.value ? e.target.value : '');
      });
    }

    container.querySelectorAll('[data-stu-res-exam-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectExamType(btn.getAttribute('data-stu-res-exam-filter') || 'ALL');
      });
    });

    container.querySelectorAll('[data-stu-res-sem-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectSemester(btn.getAttribute('data-stu-res-sem-filter') || '');
      });
    });
  }

  async function mount(containerOrSelector) {
    injectStyles();
    const el =
      typeof containerOrSelector === 'string'
        ? window.document.querySelector(containerOrSelector)
        : containerOrSelector;
    if (!el) return;

    state.containerEl = el;
    await loadResults();
  }

  window.StudentResultsDashboard = {
    EXAM_TYPES,
    mount,
    injectStyles,
    loadResults,
    selectSemester,
    selectExamType,
    downloadReportCard,
    formatPercentage,
    getState: () => state
  };
})(window);
