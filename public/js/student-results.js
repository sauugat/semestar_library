/**
 * Semester Library — Student Results Dashboard (Web Module)
 *
 * Consumes the authoritative student published results endpoint:
 * - GET /api/results/my-results
 *
 * Security & Privacy:
 * - Never sends a client-supplied studentId parameter.
 * - Never displays unpublished/draft marks.
 * - Never exposes teacher marks-entry or configuration controls.
 * - Calculates percentage strictly as (Obtained Marks / Maximum Marks) * 100
 *   without inventing pass marks, letter grades, GPA conversions, or weighted averages.
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
    selectedSemesterFilter: 'ALL',
    selectedExamFilter: 'ALL',
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

  function formatPercentage(pct, percentageAvailable = true) {
    if (!percentageAvailable || pct === null || pct === undefined) return '—';
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
        background: var(--surface, #18181b);
        border: 1.5px solid var(--border, #2e2e32);
        border-radius: 18px;
        padding: 24px;
        margin-bottom: 22px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
      }
      .stu-res-overall-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
        gap: 14px;
        margin-top: 18px;
      }
      .stu-res-stat-tile {
        background: rgba(128, 128, 128, 0.06);
        border: 1px solid var(--border, #2e2e32);
        border-radius: 14px;
        padding: 16px 18px;
      }
      .stu-res-stat-val {
        font-size: 1.65rem;
        font-weight: 800;
        letter-spacing: -0.03em;
        line-height: 1.15;
        color: var(--text, #f5f5f5);
      }
      .stu-res-stat-label {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-muted, #a1a1aa);
        margin-top: 6px;
      }
      .stu-res-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 11px;
        border-radius: 999px;
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        border: 1px solid var(--border, #3f3f46);
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
        background: rgba(128, 128, 128, 0.12);
        color: var(--text, #e4e4e7);
        border-color: var(--border, #3f3f46);
      }
      .stu-res-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 9px 16px;
        border-radius: 999px;
        border: 1px solid var(--border, #3f3f46);
        background: var(--surface, #18181b);
        color: var(--text, #f5f5f5);
        font-size: 0.84rem;
        font-weight: 700;
        cursor: pointer;
        text-decoration: none;
        font-family: inherit;
      }
      .stu-res-btn:hover {
        border-color: var(--text, #f5f5f5);
      }
      .stu-res-filter-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 18px;
      }
      .stu-res-filter-pills {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .stu-res-filter-pill {
        padding: 6px 13px;
        border-radius: 999px;
        border: 1px solid var(--border, #3f3f46);
        background: transparent;
        color: var(--text-muted, #a1a1aa);
        font-size: 0.78rem;
        font-weight: 700;
        cursor: pointer;
        font-family: inherit;
      }
      .stu-res-filter-pill.active {
        background: var(--text, #f5f5f5);
        color: var(--bg, #09090b);
        border-color: var(--text, #f5f5f5);
      }
      .stu-res-subject-card {
        background: var(--surface, #18181b);
        border: 1.5px solid var(--border, #2e2e32);
        border-radius: 16px;
        padding: 20px 22px;
        margin-bottom: 16px;
      }
      .stu-res-table-wrap {
        width: 100%;
        overflow-x: auto;
        margin-top: 12px;
        border: 1px solid var(--border, #2e2e32);
        border-radius: 12px;
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
        border-bottom: 1px solid var(--border, #2e2e32);
        text-align: left;
      }
      .stu-res-table th {
        font-size: 0.72rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted, #a1a1aa);
        background: rgba(128, 128, 128, 0.06);
      }
      .stu-res-table tr:last-child td {
        border-bottom: none;
      }
      .stu-res-progress-track {
        width: 100%;
        max-width: 140px;
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
      @media (max-width: 640px) {
        .stu-res-card {
          padding: 18px 16px;
        }
        .stu-res-subject-card {
          padding: 16px 14px;
        }
      }
    `;
    window.document.head.appendChild(style);
  }

  async function loadResults() {
    state.loading = true;
    state.error = null;
    state.errorStatus = null;
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
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message || 'Unable to load your published exam results.';
      state.errorStatus = err.status || null;
      render();
    }
  }

  function render() {
    const container = state.containerEl;
    if (!container) return;

    if (state.loading) {
      container.innerHTML = `
        <div class="stu-res-root">
          <div class="stu-res-card" style="text-align:center; padding:48px 24px;">
            <div style="font-size:1.05rem; font-weight:700; margin-bottom:6px;">Loading Your Published Results…</div>
            <div style="font-size:0.86rem; color:var(--text-muted, #a1a1aa);">
              Fetching your official semester and subject exam results.
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
          <div class="stu-res-card" role="alert" style="text-align:center; padding:40px 24px;">
            <div style="font-size:1.08rem; font-weight:800; margin-bottom:8px;">
              ${isAuthExpired ? 'Sign In Required' : 'Could Not Load Exam Results'}
            </div>
            <div style="font-size:0.88rem; color:var(--text-muted, #a1a1aa); max-width:460px; margin:0 auto 18px;">
              ${escapeHtml(state.error)}
            </div>
            ${
              isAuthExpired
                ? `<a href="/login.html" class="stu-res-btn">Sign In</a>`
                : `<button type="button" class="stu-res-btn" data-stu-res-action="retry">Retry</button>`
            }
          </div>
        </div>
      `;
      bindEvents(container);
      return;
    }

    const data = state.data;
    if (!data) return;

    const summary = data.summary || {
      totalPublishedExams: 0,
      subjectsWithResultsCount: 0,
      totalObtainedMarks: 0,
      totalMaxMarks: 0,
      averagePercentage: null,
      percentageAvailable: false,
      examTypeBreakdown: {}
    };

    const semesters = Array.isArray(data.semesters) ? data.semesters : [];
    const hasResults = Boolean(data.hasPublishedResults && semesters.length > 0);

    if (!hasResults) {
      container.innerHTML = `
        <div class="stu-res-root">
          <section class="stu-res-card" aria-label="Results Overview">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;">
              <div>
                <div style="font-size:0.76rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted, #a1a1aa); margin-bottom:4px;">
                  ${data.cohort ? `${escapeHtml(data.cohort.displayName)} Cohort &middot; ` : ''}${escapeHtml(data.semesterLabel || 'Current Semester')}
                </div>
                <h2 style="margin:0 0 6px; font-size:1.4rem; font-weight:800; letter-spacing:-0.02em;">
                  Academic Exam Results
                </h2>
                <div style="font-size:0.86rem; color:var(--text-muted, #a1a1aa);">
                  Student ID: <strong>${escapeHtml(data.rollNumber || data.studentId)}</strong> &middot; ${escapeHtml(data.name)}
                </div>
              </div>
              <button type="button" class="stu-res-btn" data-stu-res-action="retry">Refresh</button>
            </div>
          </section>

          <section class="stu-res-card" id="stuResultsEmptyState" style="text-align:center; padding:48px 24px;">
            <div style="font-size:1.15rem; font-weight:800; margin-bottom:8px;">
              Results Are Not Available Yet
            </div>
            <div style="font-size:0.9rem; color:var(--text-muted, #a1a1aa); max-width:540px; margin:0 auto 18px; line-height:1.55;">
              No exam results have been published for your account yet. Once your subject teachers publish results for <strong>Mid-Term Exam</strong>, <strong>Pre-Board Exam</strong>, or <strong>Final Exam</strong>, they will appear here organized by semester and subject.
            </div>
            <button type="button" class="stu-res-btn" data-stu-res-action="retry">Check Again</button>
          </section>
        </div>
      `;
      bindEvents(container);
      return;
    }

    const visibleSemesters =
      state.selectedSemesterFilter === 'ALL'
        ? semesters
        : semesters.filter((s) => String(s.semesterNo) === String(state.selectedSemesterFilter));

    container.innerHTML = `
      <div class="stu-res-root">
        <!-- 1. Overall Results Summary -->
        <section class="stu-res-card" aria-label="Overall Results Summary">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;">
            <div>
              <div style="font-size:0.76rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted, #a1a1aa); margin-bottom:4px;">
                ${data.cohort ? `${escapeHtml(data.cohort.displayName)} Cohort &middot; ` : ''}${escapeHtml(data.semesterLabel || '')} &middot; ID: ${escapeHtml(data.rollNumber || data.studentId)}
              </div>
              <h2 style="margin:0 0 6px; font-size:1.45rem; font-weight:800; letter-spacing:-0.02em;">
                Published Results Summary
              </h2>
              <div style="font-size:0.85rem; color:var(--text-muted, #a1a1aa);">
                Showing official published marks across your enrolled subjects. Each exam percentage is calculated from its configured maximum marks.
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <span class="stu-res-badge published">Official Published Results</span>
              <button type="button" class="stu-res-btn" data-stu-res-action="retry">Refresh</button>
            </div>
          </div>

          <div class="stu-res-overall-grid">
            <div class="stu-res-stat-tile">
              <div class="stu-res-stat-val">${Number(summary.totalPublishedExams) || 0}</div>
              <div class="stu-res-stat-label">Published Exams</div>
            </div>
            <div class="stu-res-stat-tile">
              <div class="stu-res-stat-val">${Number(summary.subjectsWithResultsCount) || 0}</div>
              <div class="stu-res-stat-label">Subjects with Results</div>
            </div>
            <div class="stu-res-stat-tile">
              <div class="stu-res-stat-val">
                ${escapeHtml(summary.totalObtainedMarks)} / ${escapeHtml(summary.totalMaxMarks)}
              </div>
              <div class="stu-res-stat-label">Recorded Marks Total</div>
            </div>
            <div class="stu-res-stat-tile">
              <div class="stu-res-stat-val">
                ${formatPercentage(summary.averagePercentage, summary.percentageAvailable)}
              </div>
              <div class="stu-res-stat-label">Mean Exam Percentage</div>
            </div>
          </div>
        </section>

        <!-- 2. Filter Controls -->
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
            semesters.length > 1
              ? `
            <div class="stu-res-filter-pills" role="tablist" aria-label="Filter by Semester">
              <button
                type="button"
                class="stu-res-filter-pill ${state.selectedSemesterFilter === 'ALL' ? 'active' : ''}"
                data-stu-res-sem-filter="ALL"
              >
                All Semesters
              </button>
              ${semesters
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
            </div>
          `
              : ''
          }
        </div>

        <!-- 3. Semester & Subject Results Breakdown -->
        ${visibleSemesters
          .map((sem) => {
            const filteredSubjects = (sem.subjects || [])
              .map((subj) => {
                const visibleExams =
                  state.selectedExamFilter === 'ALL'
                    ? subj.exams || []
                    : (subj.exams || []).filter((e) => e.examType === state.selectedExamFilter);
                return { ...subj, visibleExams };
              })
              .filter((subj) => subj.visibleExams.length > 0);

            if (filteredSubjects.length === 0) {
              return `
                <section class="stu-res-card">
                  <h3 style="margin:0 0 8px; font-size:1.15rem; font-weight:800;">
                    ${escapeHtml(sem.semesterLabel)}
                  </h3>
                  <div style="font-size:0.86rem; color:var(--text-muted, #a1a1aa);">
                    No published results for <strong>${escapeHtml(state.selectedExamFilter)}</strong> in ${escapeHtml(sem.semesterLabel)}.
                  </div>
                </section>
              `;
            }

            return `
              <section aria-label="${escapeHtml(sem.semesterLabel)} Results" style="margin-bottom:28px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px;">
                  <h3 style="margin:0; font-size:1.2rem; font-weight:800; letter-spacing:-0.02em;">
                    ${escapeHtml(sem.semesterLabel)} &middot; ${filteredSubjects.length} ${filteredSubjects.length === 1 ? 'Subject' : 'Subjects'}
                  </h3>
                </div>

                ${filteredSubjects
                  .map(
                    (subj) => `
                  <article class="stu-res-subject-card" data-result-subject="${escapeHtml(subj.code || subj.subjectId)}">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                      <div>
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                          <span style="font-size:0.75rem; font-weight:800; padding:3px 9px; border-radius:6px; background:rgba(128,128,128,0.14); border:1px solid var(--border, #3f3f46); font-family:ui-monospace, SFMono-Regular, Menlo, monospace;">
                            ${escapeHtml(subj.code || subj.subjectId)}
                          </span>
                          <span style="font-size:0.78rem; color:var(--text-muted, #a1a1aa); font-weight:600;">
                            Semester ${escapeHtml(subj.semesterNo)}
                          </span>
                        </div>
                        <h4 style="margin:0; font-size:1.08rem; font-weight:800;">
                          ${escapeHtml(subj.name)}
                        </h4>
                      </div>
                      <span class="stu-res-badge neutral">
                        ${subj.visibleExams.length} Published ${subj.visibleExams.length === 1 ? 'Exam' : 'Exams'}
                      </span>
                    </div>

                    <div class="stu-res-table-wrap">
                      <table class="stu-res-table">
                        <thead>
                          <tr>
                            <th>Subject Name</th>
                            <th>Exam Type</th>
                            <th>Obtained Marks</th>
                            <th>Maximum Marks</th>
                            <th>Percentage</th>
                            <th>Publication Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${subj.visibleExams
                            .map((ex) => {
                              const isMissing = Boolean(ex.isMissing || ex.obtainedMarks === null || ex.obtainedMarks === undefined);
                              const pctText = isMissing ? 'Missing Marks' : formatPercentage(ex.percentage, ex.percentageAvailable);
                              const barWidth = !isMissing && Number.isFinite(Number(ex.percentage))
                                ? Math.max(0, Math.min(100, Number(ex.percentage)))
                                : 0;

                              return `
                                <tr>
                                  <td style="font-weight:600;">${escapeHtml(subj.name)}</td>
                                  <td style="font-weight:700;">${escapeHtml(ex.examType)}</td>
                                  <td style="font-weight:800;">
                                    ${isMissing ? '<span style="color:var(--text-muted, #a1a1aa);">Missing</span>' : escapeHtml(ex.obtainedMarks)}
                                  </td>
                                  <td>${escapeHtml(ex.maxMarks)}</td>
                                  <td>
                                    <div style="display:flex; align-items:center; gap:10px;">
                                      <strong style="min-width:52px;">${escapeHtml(pctText)}</strong>
                                      ${
                                        !isMissing
                                          ? `
                                        <div class="stu-res-progress-track">
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
                                      ex.publishedAt
                                        ? `<span style="font-size:0.74rem; color:var(--text-muted, #a1a1aa); margin-left:6px;">${escapeHtml(formatDateDisplay(ex.publishedAt))}</span>`
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
                `
                  )
                  .join('')}
              </section>
            `;
          })
          .join('')}
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

    container.querySelectorAll('[data-stu-res-exam-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedExamFilter = btn.getAttribute('data-stu-res-exam-filter') || 'ALL';
        render();
      });
    });

    container.querySelectorAll('[data-stu-res-sem-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedSemesterFilter = btn.getAttribute('data-stu-res-sem-filter') || 'ALL';
        render();
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
    formatPercentage,
    getState: () => state
  };
})(window);
