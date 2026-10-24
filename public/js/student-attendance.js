/**
 * Semester Library — Student Attendance Dashboard (Web Module)
 *
 * Consumes the authoritative student summary endpoint:
 * - GET /api/attendance/my-summary
 *
 * Security & Privacy:
 * - Never sends a client-supplied studentId query parameter.
 * - Never exposes teacher marking controls, other students' records, audit logs, or admin settings.
 * - Never hardcodes an attendance eligibility threshold (uses backend eligibilityStatus & configuredThreshold).
 */
(function (window) {
  'use strict';

  const state = {
    loading: false,
    error: null,
    errorStatus: null,
    summary: null,
    selectedSubjectFilter: 'ALL',
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

  function formatPercentage(pct, percentageAvailable) {
    if (!percentageAvailable) return '—';
    const num = Number(pct);
    if (!Number.isFinite(num)) return '—';
    return Number.isInteger(num) ? `${num}%` : `${num.toFixed(2).replace(/\.?0+$/, '')}%`;
  }

  /**
   * Formats a YYYY-MM-DD Nepal calendar date string into a human-friendly display label
   * strictly using the literal year, month, and day numbers without UTC-to-local timezone shifts.
   */
  function formatNepalDateString(yyyyMmDd) {
    if (!yyyyMmDd || typeof yyyyMmDd !== 'string') return '—';
    const clean = yyyyMmDd.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const parts = clean.split('-');
    const year = Number(parts[0]);
    const monthIdx = Number(parts[1]) - 1;
    const day = Number(parts[2]);
    if (monthIdx < 0 || monthIdx > 11 || !day) return clean;
    return `${months[monthIdx]} ${day}, ${year} (${clean})`;
  }

  /**
   * Maps backend eligibilityStatus and configuredThreshold to clear display metadata
   * without ever hardcoding a threshold or inferring eligibility from rounded percentages.
   */
  function describeEligibility(eligibilityStatus, configuredThreshold, scopeLabel) {
    const scopePrefix = scopeLabel ? `${scopeLabel}: ` : '';
    const hasThreshold =
      configuredThreshold !== null &&
      configuredThreshold !== undefined &&
      Number.isFinite(Number(configuredThreshold));
    const thresholdText = hasThreshold ? `${Number(configuredThreshold)}%` : null;

    switch (eligibilityStatus) {
      case 'eligible':
        return {
          badgeText: `${scopePrefix}Eligible`,
          badgeClass: 'eligible',
          detailText: thresholdText
            ? `Meets configured minimum requirement (${thresholdText})`
            : 'Meets configured attendance requirement'
        };
      case 'ineligible':
        return {
          badgeText: `${scopePrefix}Below Threshold`,
          badgeClass: 'ineligible',
          detailText: thresholdText
            ? `Below configured minimum requirement (${thresholdText})`
            : 'Below configured attendance requirement'
        };
      case 'not_applicable':
        return {
          badgeText: `${scopePrefix}No Sessions Recorded`,
          badgeClass: 'neutral',
          detailText: 'No attendance sessions have been recorded yet'
        };
      case 'unconfigured':
      default:
        return {
          badgeText: `${scopePrefix}Threshold Unconfigured`,
          badgeClass: 'neutral',
          detailText: 'Eligibility threshold has not been configured by the institution yet'
        };
    }
  }

  function injectStyles() {
    if (window.document.getElementById('sl-student-attendance-styles')) return;
    const style = window.document.createElement('style');
    style.id = 'sl-student-attendance-styles';
    style.textContent = `
      .stu-att-root {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--text, #f5f5f5);
        max-width: 1180px;
        margin: 0 auto;
      }
      .stu-att-card {
        background: var(--surface, #18181b);
        border: 1.5px solid var(--border, #2e2e32);
        border-radius: 18px;
        padding: 24px;
        margin-bottom: 22px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
      }
      .stu-att-overall-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 14px;
        margin-top: 18px;
      }
      .stu-att-stat-tile {
        background: rgba(128, 128, 128, 0.06);
        border: 1px solid var(--border, #2e2e32);
        border-radius: 14px;
        padding: 16px 18px;
      }
      .stu-att-stat-val {
        font-size: 1.75rem;
        font-weight: 800;
        letter-spacing: -0.03em;
        line-height: 1.15;
        color: var(--text, #f5f5f5);
      }
      .stu-att-stat-label {
        font-size: 0.76rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-muted, #a1a1aa);
        margin-top: 6px;
      }
      .stu-att-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        border-radius: 999px;
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        border: 1px solid var(--border, #3f3f46);
      }
      .stu-att-badge.eligible {
        background: #f5f5f5;
        color: #09090b;
        border-color: #f5f5f5;
      }
      .stu-att-badge.ineligible {
        background: rgba(239, 68, 68, 0.14);
        color: #fca5a5;
        border-color: rgba(239, 68, 68, 0.45);
      }
      [data-theme="light"] .stu-att-badge.ineligible {
        background: rgba(220, 38, 38, 0.1);
        color: #b91c1c;
        border-color: rgba(220, 38, 38, 0.35);
      }
      .stu-att-badge.neutral {
        background: rgba(128, 128, 128, 0.12);
        color: var(--text, #e4e4e7);
        border-color: var(--border, #3f3f46);
      }
      .stu-att-badge.present {
        background: #f5f5f5;
        color: #09090b;
        border-color: #f5f5f5;
      }
      [data-theme="light"] .stu-att-badge.present,
      [data-theme="light"] .stu-att-badge.eligible {
        background: #111827;
        color: #ffffff;
        border-color: #111827;
      }
      .stu-att-badge.absent {
        background: rgba(239, 68, 68, 0.14);
        color: #fca5a5;
        border-color: rgba(239, 68, 68, 0.45);
      }
      [data-theme="light"] .stu-att-badge.absent {
        background: rgba(220, 38, 38, 0.1);
        color: #b91c1c;
        border-color: rgba(220, 38, 38, 0.35);
      }
      .stu-att-subjects-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 16px;
        margin-bottom: 26px;
      }
      .stu-att-subject-card {
        background: var(--surface, #18181b);
        border: 1.5px solid var(--border, #2e2e32);
        border-radius: 16px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 14px;
      }
      .stu-att-progress-track {
        width: 100%;
        height: 7px;
        border-radius: 999px;
        background: rgba(128, 128, 128, 0.16);
        overflow: hidden;
      }
      .stu-att-progress-fill {
        height: 100%;
        border-radius: 999px;
        background: var(--text, #f5f5f5);
        transition: width 0.25s ease;
      }
      .stu-att-history-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .stu-att-history-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 13px 16px;
        border-radius: 12px;
        background: rgba(128, 128, 128, 0.05);
        border: 1px solid var(--border, #2e2e32);
        flex-wrap: wrap;
      }
      .stu-att-btn {
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
      }
      .stu-att-btn:hover {
        border-color: var(--text, #f5f5f5);
      }
      .stu-att-filter-pills {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }
      .stu-att-filter-pill {
        padding: 6px 13px;
        border-radius: 999px;
        border: 1px solid var(--border, #3f3f46);
        background: transparent;
        color: var(--text-muted, #a1a1aa);
        font-size: 0.78rem;
        font-weight: 700;
        cursor: pointer;
      }
      .stu-att-filter-pill.active {
        background: var(--text, #f5f5f5);
        color: var(--bg, #09090b);
        border-color: var(--text, #f5f5f5);
      }
      @media (max-width: 640px) {
        .stu-att-card {
          padding: 18px 16px;
        }
        .stu-att-subjects-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    window.document.head.appendChild(style);
  }

  /**
   * Loads the authenticated student's summary from GET /api/attendance/my-summary
   */
  async function loadSummary() {
    state.loading = true;
    state.error = null;
    state.errorStatus = null;
    render();

    try {
      const res = await authFetch('/api/attendance/my-summary');
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = new Error(
          data.message ||
            (res.status === 401
              ? 'Your session has expired. Please sign in again to view your attendance.'
              : 'Unable to load your attendance summary.')
        );
        err.status = res.status;
        throw err;
      }

      state.summary = data;
      if (state.selectedSubjectFilter !== 'ALL' && Array.isArray(data.subjects)) {
        const validFilter = data.subjects.some(
          (s) => s.subjectId === state.selectedSubjectFilter || s.code === state.selectedSubjectFilter
        );
        if (!validFilter) {
          state.selectedSubjectFilter = 'ALL';
        }
      }
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message || 'Unable to load your attendance summary.';
      state.errorStatus = err.status || null;
      render();
    }
  }

  function render() {
    const container = state.containerEl;
    if (!container) return;

    if (state.loading) {
      container.innerHTML = `
        <div class="stu-att-root">
          <div class="stu-att-card" style="text-align:center; padding:48px 24px;">
            <div style="font-size:1.05rem; font-weight:700; margin-bottom:6px;">Loading Your Attendance Summary…</div>
            <div style="font-size:0.86rem; color:var(--text-muted, #a1a1aa);">
              Fetching your cohort attendance records and subject breakdown.
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (state.error) {
      const isAuthExpired = state.errorStatus === 401;
      container.innerHTML = `
        <div class="stu-att-root">
          <div class="stu-att-card" role="alert" style="text-align:center; padding:40px 24px;">
            <div style="font-size:1.08rem; font-weight:800; margin-bottom:8px;">
              ${isAuthExpired ? 'Sign In Required' : 'Could Not Load Attendance'}
            </div>
            <div style="font-size:0.88rem; color:var(--text-muted, #a1a1aa); max-width:460px; margin:0 auto 18px;">
              ${escapeHtml(state.error)}
            </div>
            ${
              isAuthExpired
                ? `<a href="/login.html" class="stu-att-btn">Sign In</a>`
                : `<button type="button" class="stu-att-btn" data-stu-att-action="retry">Retry</button>`
            }
          </div>
        </div>
      `;
      bindEvents(container);
      return;
    }

    const summary = state.summary;
    if (!summary) return;

    // Unassigned cohort state
    if (summary.academicStatus === 'unassigned' || !summary.cohort) {
      container.innerHTML = `
        <div class="stu-att-root">
          <div class="stu-att-card" style="text-align:center; padding:44px 24px;">
            <div style="font-size:1.15rem; font-weight:800; margin-bottom:8px;">Class Cohort Not Assigned Yet</div>
            <div style="font-size:0.9rem; color:var(--text-muted, #a1a1aa); max-width:520px; margin:0 auto 18px; line-height:1.5;">
              Your student account has not been assigned to an active class cohort yet. Once an administrator assigns your cohort, your subject-wise attendance and session history will appear here.
            </div>
            <button type="button" class="stu-att-btn" data-stu-att-action="retry">Refresh Status</button>
          </div>
        </div>
      `;
      bindEvents(container);
      return;
    }

    const overall = summary.overall || {
      totalSessions: 0,
      presentCount: 0,
      absentCount: 0,
      attendancePercentage: 0,
      percentageAvailable: false,
      configuredThreshold: summary.configuredThreshold ?? null,
      eligibilityStatus: summary.eligibilityStatus || 'unconfigured',
      isEligible: null
    };

    const overallElig = describeEligibility(
      overall.eligibilityStatus,
      overall.configuredThreshold,
      'Overall Eligibility'
    );
    const overallPctText = formatPercentage(overall.attendancePercentage, overall.percentageAvailable);
    const subjects = Array.isArray(summary.subjects) ? summary.subjects : [];
    const recentHistory = Array.isArray(summary.recentHistory) ? summary.recentHistory : [];

    const filteredHistory =
      state.selectedSubjectFilter === 'ALL'
        ? recentHistory
        : recentHistory.filter(
            (h) =>
              h.subjectId === state.selectedSubjectFilter ||
              h.subjectCode === state.selectedSubjectFilter
          );

    container.innerHTML = `
      <div class="stu-att-root">
        <!-- 1. Overall Attendance Summary Card -->
        <section class="stu-att-card" aria-label="Overall Attendance Summary">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;">
            <div>
              <div style="font-size:0.76rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted, #a1a1aa); margin-bottom:4px;">
                ${escapeHtml(summary.cohort.displayName)} Cohort &middot; Semester ${escapeHtml(summary.semesterNo)}
              </div>
              <h2 style="margin:0 0 6px; font-size:1.45rem; font-weight:800; letter-spacing:-0.02em;">
                Overall Attendance Summary
              </h2>
              <div style="font-size:0.86rem; color:var(--text-muted, #a1a1aa);">
                ${
                  overall.totalSessions === 0
                    ? 'No attendance has been recorded yet for your current semester.'
                    : `${escapeHtml(overallElig.detailText)}`
                }
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <span class="stu-att-badge ${overallElig.badgeClass}">
                ${escapeHtml(overallElig.badgeText)}
              </span>
              <button type="button" class="stu-att-btn" data-stu-att-action="retry" title="Refresh attendance">
                Refresh
              </button>
            </div>
          </div>

          <div class="stu-att-overall-grid">
            <div class="stu-att-stat-tile">
              <div class="stu-att-stat-val">${overallPctText}</div>
              <div class="stu-att-stat-label">
                ${overall.totalSessions === 0 ? 'No Sessions Recorded' : 'Overall Percentage'}
              </div>
            </div>

            <div class="stu-att-stat-tile">
              <div class="stu-att-stat-val">${Number(overall.totalSessions) || 0}</div>
              <div class="stu-att-stat-label">Total Sessions</div>
            </div>

            <div class="stu-att-stat-tile">
              <div class="stu-att-stat-val">${Number(overall.presentCount) || 0}</div>
              <div class="stu-att-stat-label">Present</div>
            </div>

            <div class="stu-att-stat-tile">
              <div class="stu-att-stat-val">${Number(overall.absentCount) || 0}</div>
              <div class="stu-att-stat-label">Absent</div>
            </div>

            <div class="stu-att-stat-tile">
              <div class="stu-att-stat-val">
                ${
                  overall.configuredThreshold !== null && overall.configuredThreshold !== undefined
                    ? `${Number(overall.configuredThreshold)}%`
                    : 'Not Set'
                }
              </div>
              <div class="stu-att-stat-label">Configured Threshold</div>
            </div>
          </div>
        </section>

        <!-- 2. Subject-Wise Attendance Breakdown -->
        <section aria-label="Subject-Wise Attendance">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 0 14px;">
            <h3 style="margin:0; font-size:1.15rem; font-weight:800; letter-spacing:-0.02em;">
              Subject-Wise Attendance (${subjects.length})
            </h3>
          </div>

          ${
            subjects.length === 0
              ? `
            <div class="stu-att-card" style="text-align:center; padding:32px 20px;">
              <div style="font-weight:700; margin-bottom:4px;">No Subjects Found for Semester ${escapeHtml(summary.semesterNo)}</div>
              <div style="font-size:0.85rem; color:var(--text-muted, #a1a1aa);">
                Subjects for your active semester will appear here once configured.
              </div>
            </div>
          `
              : `
            <div class="stu-att-subjects-grid">
              ${subjects
                .map((sub) => {
                  const subTotal = Number(sub.totalSessions) || 0;
                  const subPresent = Number(sub.presentCount) || 0;
                  const subAbsent = Number(sub.absentCount) || 0;
                  const subHasSessions = Boolean(sub.percentageAvailable && subTotal > 0);
                  const subPctLabel = formatPercentage(sub.attendancePercentage, subHasSessions);
                  const subBarWidth = subHasSessions
                    ? Math.max(0, Math.min(100, Number(sub.attendancePercentage) || 0))
                    : 0;
                  const subElig = describeEligibility(
                    sub.eligibilityStatus,
                    sub.configuredThreshold,
                    null
                  );

                  return `
                    <article class="stu-att-subject-card">
                      <div>
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px;">
                          <span style="font-size:0.75rem; font-weight:800; padding:3px 9px; border-radius:6px; background:rgba(128,128,128,0.14); border:1px solid var(--border, #3f3f46);">
                            ${escapeHtml(sub.code || sub.subjectId)}
                          </span>
                          <span class="stu-att-badge ${subElig.badgeClass}">
                            ${escapeHtml(subElig.badgeText)}
                          </span>
                        </div>

                        <h4 style="margin:0 0 6px; font-size:1.02rem; font-weight:700; line-height:1.35;">
                          ${escapeHtml(sub.name)}
                        </h4>

                        <div style="font-size:0.8rem; color:var(--text-muted, #a1a1aa); margin-bottom:14px;">
                          ${
                            subTotal === 0
                              ? 'No sessions recorded'
                              : `${subPresent} Present &middot; ${subAbsent} Absent &middot; ${subTotal} ${subTotal === 1 ? 'Session' : 'Sessions'}`
                          }
                        </div>
                      </div>

                      <div>
                        <div style="display:flex; align-items:baseline; justify-content:space-between; margin-bottom:6px;">
                          <span style="font-size:0.76rem; color:var(--text-muted, #a1a1aa); font-weight:600;">
                            ${subTotal === 0 ? 'No sessions recorded' : subElig.detailText}
                          </span>
                          <strong style="font-size:1.1rem; font-weight:800;">
                            ${subPctLabel}
                          </strong>
                        </div>
                        <div class="stu-att-progress-track">
                          <div class="stu-att-progress-fill" style="width:${subBarWidth}%;"></div>
                        </div>
                      </div>
                    </article>
                  `;
                })
                .join('')}
            </div>
          `
          }
        </section>

        <!-- 3. Recent Attendance History -->
        <section class="stu-att-card" aria-label="Recent Attendance History">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
            <div>
              <h3 style="margin:0 0 4px; font-size:1.1rem; font-weight:800;">Recent Attendance History</h3>
              <div style="font-size:0.82rem; color:var(--text-muted, #a1a1aa);">
                Individual finalized class sessions recorded for your cohort (Nepal local dates).
              </div>
            </div>
          </div>

          ${
            subjects.length > 1 && recentHistory.length > 0
              ? `
            <div class="stu-att-filter-pills" role="tablist" aria-label="Filter recent history by subject">
              <button
                type="button"
                class="stu-att-filter-pill ${state.selectedSubjectFilter === 'ALL' ? 'active' : ''}"
                data-stu-att-filter="ALL"
              >
                All Subjects (${recentHistory.length})
              </button>
              ${subjects
                .map(
                  (sub) => `
                <button
                  type="button"
                  class="stu-att-filter-pill ${state.selectedSubjectFilter === sub.subjectId ? 'active' : ''}"
                  data-stu-att-filter="${escapeHtml(sub.subjectId)}"
                >
                  ${escapeHtml(sub.code || sub.name)}
                </button>
              `
                )
                .join('')}
            </div>
          `
              : ''
          }

          ${
            recentHistory.length === 0
              ? `
            <div style="text-align:center; padding:28px 16px; color:var(--text-muted, #a1a1aa); font-size:0.88rem;">
              No attendance has been recorded yet. Finalized class sessions will appear here in chronological order.
            </div>
          `
              : filteredHistory.length === 0
              ? `
            <div style="text-align:center; padding:24px 16px; color:var(--text-muted, #a1a1aa); font-size:0.88rem;">
              No recorded sessions for the selected subject filter.
            </div>
          `
              : `
            <div class="stu-att-history-list">
              ${filteredHistory
                .map((item) => {
                  const status = item.status === 'present' ? 'present' : 'absent';
                  return `
                    <div class="stu-att-history-row">
                      <div>
                        <div style="font-weight:700; font-size:0.93rem;">
                          [${escapeHtml(item.subjectCode || item.subjectId)}] ${escapeHtml(item.subjectName || '')}
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-muted, #a1a1aa); margin-top:2px;">
                          Session Date: <strong>${escapeHtml(formatNepalDateString(item.sessionDate))}</strong>
                        </div>
                      </div>

                      <span class="stu-att-badge ${status}">
                        ${status === 'present' ? 'Present' : 'Absent'}
                      </span>
                    </div>
                  `;
                })
                .join('')}
            </div>
          `
          }
        </section>
      </div>
    `;

    bindEvents(container);
  }

  function bindEvents(container) {
    container.querySelectorAll('[data-stu-att-action="retry"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        loadSummary();
      });
    });

    container.querySelectorAll('[data-stu-att-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedSubjectFilter = btn.getAttribute('data-stu-att-filter') || 'ALL';
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
    await loadSummary();
  }

  window.StudentAttendanceDashboard = {
    mount,
    injectStyles,
    loadSummary,
    describeEligibility,
    formatNepalDateString,
    getState: () => state
  };
})(window);
