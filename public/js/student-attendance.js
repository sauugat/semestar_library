/**
 * Semester Library — Student Attendance Dashboard (Web Module)
 *
 * Consumes the authoritative student summary endpoint:
 * - GET /api/attendance/my-summary
 *
 * Security & Privacy:
 * - Never sends a client-supplied studentId query parameter.
 * - Never exposes teacher marking controls, other students' records, audit logs, or admin settings.
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
    if (!percentageAvailable) return '0%';
    const num = Number(pct);
    if (!Number.isFinite(num)) return '0%';
    return Number.isInteger(num) ? `${num}%` : `${num.toFixed(1).replace(/\.0$/, '')}%`;
  }

  // Verified 2070–2090 BS calendar table (synchronized with lib/temporal-intelligence.js & mobile/utils/nepaliDate.ts)
  const BS_MONTH_DAYS = {
    2070: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
    2071: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2072: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2073: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2074: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
    2075: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
    2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
    2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
    2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
    2085: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
    2086: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
    2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
    2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
    2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
    2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30]
  };
  const ANCHOR_BS_YEAR = 2070;
  const ANCHOR_AD_MS = Date.UTC(2013, 3, 14);
  const MS_PER_DAY = 86400000;
  const BS_MONTH_NAMES_EN = [
    'Baishakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
    'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'
  ];

  function adToBs(adDateStr) {
    if (!adDateStr || typeof adDateStr !== 'string') return null;
    const trimmed = adDateStr.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    const [y, m, d] = trimmed.split('-').map(Number);
    const targetUtcMs = Date.UTC(y, m - 1, d);
    const check = new Date(targetUtcMs);
    if (
      Number.isNaN(targetUtcMs) ||
      check.getUTCFullYear() !== y ||
      check.getUTCMonth() + 1 !== m ||
      check.getUTCDate() !== d
    ) {
      return null;
    }
    let diffDays = Math.round((targetUtcMs - ANCHOR_AD_MS) / MS_PER_DAY);
    if (diffDays < 0) return null;
    let bsYear = ANCHOR_BS_YEAR;
    while (true) {
      const months = BS_MONTH_DAYS[bsYear];
      if (!months) return null;
      const yearDays = months.reduce((acc, days) => acc + days, 0);
      if (diffDays >= yearDays) {
        diffDays -= yearDays;
        bsYear += 1;
      } else {
        break;
      }
    }
    let bsMonth = 1;
    const months = BS_MONTH_DAYS[bsYear];
    for (let mi = 0; mi < 12; mi += 1) {
      if (diffDays >= months[mi]) {
        diffDays -= months[mi];
        bsMonth += 1;
      } else {
        break;
      }
    }
    const bsDay = diffDays + 1;
    const monthNameEn = BS_MONTH_NAMES_EN[bsMonth - 1];
    const dateStr = `${bsYear}-${String(bsMonth).padStart(2, '0')}-${String(bsDay).padStart(2, '0')}`;
    return { year: bsYear, month: bsMonth, day: bsDay, monthNameEn, dateStr, formattedEn: `${bsDay} ${monthNameEn} ${bsYear}` };
  }

  /**
   * Formats a YYYY-MM-DD Nepal calendar date string into Bikram Sambat (BS) display format
   * without UTC-to-local timezone shifts.
   */
  function formatNepalDateString(yyyyMmDd) {
    if (!yyyyMmDd || typeof yyyyMmDd !== 'string') return '—';
    const clean = yyyyMmDd.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    const bs = adToBs(clean);
    if (bs) {
      return `${bs.formattedEn} BS`;
    }
    return clean;
  }

  function isBelowAlertLevel(percentage, totalSessions, eligibilityStatus, configuredThreshold) {
    if (!totalSessions || totalSessions <= 0) return false;
    if (eligibilityStatus === 'ineligible') return true;
    if (configuredThreshold !== null && configuredThreshold !== undefined && Number.isFinite(Number(configuredThreshold))) {
      return Number(percentage) < Number(configuredThreshold);
    }
    return Number(percentage) < 50;
  }

  /**
   * Maps backend eligibilityStatus and configuredThreshold to optional display metadata.
   * Returns empty strings when threshold is unconfigured so the UI stays clean and uncluttered.
   */
  function describeEligibility(eligibilityStatus, configuredThreshold) {
    const hasThreshold =
      configuredThreshold !== null &&
      configuredThreshold !== undefined &&
      Number.isFinite(Number(configuredThreshold));
    const thresholdText = hasThreshold ? `${Number(configuredThreshold)}%` : null;

    switch (eligibilityStatus) {
      case 'eligible':
        return {
          badgeText: 'Eligible',
          badgeClass: 'eligible',
          detailText: thresholdText ? `Meets ${thresholdText} requirement` : ''
        };
      case 'ineligible':
        return {
          badgeText: thresholdText ? `Below ${thresholdText}` : 'Low Attendance',
          badgeClass: 'ineligible',
          detailText: thresholdText ? `Below ${thresholdText} requirement` : ''
        };
      case 'not_applicable':
      case 'unconfigured':
      default:
        return {
          badgeText: '',
          badgeClass: 'neutral',
          detailText: ''
        };
    }
  }

  function sortSubjectsByRecency(subjects, recentHistory) {
    const recencyRank = new Map();
    (recentHistory || []).forEach((item, index) => {
      if (item.subjectId && !recencyRank.has(item.subjectId)) {
        recencyRank.set(item.subjectId, index);
      }
      if (item.subjectCode && !recencyRank.has(item.subjectCode)) {
        recencyRank.set(item.subjectCode, index);
      }
    });

    return [...(subjects || [])].sort((a, b) => {
      const rankA = recencyRank.get(a.subjectId) ?? recencyRank.get(a.code) ?? Number.POSITIVE_INFINITY;
      const rankB = recencyRank.get(b.subjectId) ?? recencyRank.get(b.code) ?? Number.POSITIVE_INFINITY;
      if (rankA !== rankB) return rankA - rankB;

      const aHas = (Number(a.totalSessions) || 0) > 0 ? 1 : 0;
      const bHas = (Number(b.totalSessions) || 0) > 0 ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;

      return (Number(b.totalSessions) || 0) - (Number(a.totalSessions) || 0);
    });
  }

  function renderCircularRingSvg(percentage, hasSessions, isLow, label) {
    const size = 144;
    const stroke = 11;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = hasSessions ? Math.max(0, Math.min(100, Number(percentage) || 0)) : 0;
    const dashOffset = circumference - (clamped / 100) * circumference;
    const strokeColor = !hasSessions ? 'var(--stu-att-track)' : isLow ? '#ef4444' : '#16a34a';
    const pctColor = !hasSessions ? 'var(--text-muted, #71717a)' : isLow ? '#ef4444' : 'var(--text, #111827)';

    return `
      <div class="stu-att-ring-wrap" aria-label="Overall attendance ${escapeHtml(label)}">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="stu-att-ring-svg">
          <circle
            cx="${size / 2}"
            cy="${size / 2}"
            r="${radius}"
            fill="none"
            stroke="var(--stu-att-track)"
            stroke-width="${stroke}"
          />
          ${
            clamped > 0
              ? `<circle
                  cx="${size / 2}"
                  cy="${size / 2}"
                  r="${radius}"
                  fill="none"
                  stroke="${strokeColor}"
                  stroke-width="${stroke}"
                  stroke-linecap="round"
                  stroke-dasharray="${circumference.toFixed(2)}"
                  stroke-dashoffset="${dashOffset.toFixed(2)}"
                  transform="rotate(-90 ${size / 2} ${size / 2})"
                />`
              : ''
          }
        </svg>
        <div class="stu-att-ring-center">
          <div class="stu-att-ring-pct" style="color:${pctColor};">${escapeHtml(label)}</div>
          <div class="stu-att-ring-sub">Overall</div>
        </div>
      </div>
    `;
  }

  function renderSubjectBarChartSvg(subjects) {
    if (!subjects || subjects.length === 0) return '';
    const chartW = 540;
    const chartH = 196;
    const padLeft = 36;
    const padRight = 14;
    const padTop = 24;
    const padBottom = 34;
    const plotW = chartW - padLeft - padRight;
    const plotH = chartH - padTop - padBottom;
    const count = subjects.length;
    const slotW = plotW / Math.max(1, count);
    const barW = Math.min(44, Math.max(18, slotW * 0.52));

    const gridLines = [0, 50, 100]
      .map((val) => {
        const y = padTop + plotH - (val / 100) * plotH;
        return `
          <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${chartW - padRight}" y2="${y.toFixed(1)}"
            stroke="var(--stu-att-grid)" stroke-width="1" ${val === 0 ? '' : 'stroke-dasharray="3,4"'} />
          <text x="${padLeft - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="stu-att-chart-axis">${val}%</text>
        `;
      })
      .join('');

    const bars = subjects
      .map((sub, idx) => {
        const total = Number(sub.totalSessions) || 0;
        const hasSessions = Boolean(sub.percentageAvailable && total > 0);
        const pct = hasSessions ? Math.max(0, Math.min(100, Number(sub.attendancePercentage) || 0)) : 0;
        const isLow = isBelowAlertLevel(pct, total, sub.eligibilityStatus, sub.configuredThreshold);
        const cx = padLeft + idx * slotW + slotW / 2;
        const x = cx - barW / 2;
        const barH = hasSessions ? Math.max(4, (pct / 100) * plotH) : 0;
        const y = padTop + plotH - barH;
        const fill = !hasSessions ? 'var(--stu-att-track)' : isLow ? '#ef4444' : '#16a34a';
        const codeLabel = String(sub.code || sub.subjectId || '').slice(0, 8);
        const valLabel = hasSessions ? formatPercentage(pct, true) : '—';

        return `
          <g>
            <rect x="${x.toFixed(1)}" y="${padTop}" width="${barW.toFixed(1)}" height="${plotH}" rx="7" fill="var(--stu-att-bar-bg)" />
            ${
              barH > 0
                ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="7" fill="${fill}" />`
                : ''
            }
            <text x="${cx.toFixed(1)}" y="${(hasSessions ? Math.max(13, y - 6) : padTop + plotH - 6).toFixed(1)}"
              text-anchor="middle" class="stu-att-chart-val" style="fill:${hasSessions ? (isLow ? '#ef4444' : 'var(--text, #111827)') : 'var(--text-muted, #71717a)'};">
              ${escapeHtml(valLabel)}
            </text>
            <text x="${cx.toFixed(1)}" y="${chartH - 12}" text-anchor="middle" class="stu-att-chart-code">
              ${escapeHtml(codeLabel)}
            </text>
          </g>
        `;
      })
      .join('');

    return `
      <div class="stu-att-chart-card">
        <div class="stu-att-chart-head">
          <div>
            <div class="stu-att-chart-title">Subject Attendance Overview</div>
            <div class="stu-att-chart-sub">Attendance rate across all ${subjects.length} subjects</div>
          </div>
          <div class="stu-att-chart-legend">
            <span><i style="background:#16a34a;"></i>Good</span>
            <span><i style="background:#ef4444;"></i>Low</span>
          </div>
        </div>
        <svg viewBox="0 0 ${chartW} ${chartH}" class="stu-att-chart-svg" role="img" aria-label="Subject attendance bar chart">
          ${gridLines}
          ${bars}
        </svg>
      </div>
    `;
  }

  function injectStyles() {
    if (window.document.getElementById('sl-student-attendance-styles')) return;
    const style = window.document.createElement('style');
    style.id = 'sl-student-attendance-styles';
    style.textContent = `
      .stu-att-root {
        --stu-att-track: rgba(128, 128, 128, 0.16);
        --stu-att-bar-bg: rgba(128, 128, 128, 0.08);
        --stu-att-grid: rgba(128, 128, 128, 0.16);
        --stu-att-inner-bg: rgba(128, 128, 128, 0.05);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--text, #111827);
        max-width: 1180px;
        margin: 0 auto;
      }
      [data-theme="dark"] .stu-att-root,
      html.dark .stu-att-root {
        --stu-att-track: #26262a;
        --stu-att-bar-bg: rgba(255, 255, 255, 0.04);
        --stu-att-grid: rgba(255, 255, 255, 0.08);
        --stu-att-inner-bg: rgba(255, 255, 255, 0.035);
      }
      .stu-att-card {
        background: var(--surface, #ffffff);
        border: 1.5px solid var(--border, rgba(0, 0, 0, 0.12));
        border-radius: 20px;
        padding: 24px;
        margin-bottom: 22px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
      }
      .stu-att-top-grid {
        display: grid;
        grid-template-columns: minmax(320px, 1fr) minmax(340px, 1.2fr);
        gap: 20px;
        margin-bottom: 26px;
        align-items: stretch;
      }
      .stu-att-summary-card {
        background: var(--surface, #ffffff);
        border: 1.5px solid var(--border, rgba(0, 0, 0, 0.12));
        border-radius: 22px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 20px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
      }
      .stu-att-summary-card.low-alert {
        border-color: rgba(239, 68, 68, 0.42);
      }
      .stu-att-summary-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .stu-att-kicker {
        font-size: 0.74rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted, #6b7280);
        margin-bottom: 4px;
      }
      .stu-att-summary-title {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .stu-att-summary-body {
        display: flex;
        align-items: center;
        gap: 22px;
      }
      .stu-att-ring-wrap {
        position: relative;
        width: 144px;
        height: 144px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .stu-att-ring-svg {
        display: block;
      }
      .stu-att-ring-center {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }
      .stu-att-ring-pct {
        font-size: 1.7rem;
        font-weight: 800;
        letter-spacing: -0.03em;
        line-height: 1.1;
      }
      .stu-att-ring-sub {
        font-size: 0.76rem;
        font-weight: 600;
        color: var(--text-muted, #71717a);
        margin-top: 2px;
      }
      .stu-att-divider {
        width: 1px;
        align-self: stretch;
        background: var(--border, rgba(0, 0, 0, 0.1));
      }
      .stu-att-stats-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
      }
      .stu-att-stat-row-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 11px 14px;
        border-radius: 14px;
        background: var(--stu-att-inner-bg);
        border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
      }
      .stu-att-stat-icon {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .stu-att-stat-icon.present {
        background: rgba(22, 163, 74, 0.12);
        color: #16a34a;
      }
      .stu-att-stat-icon.absent {
        background: rgba(239, 68, 68, 0.12);
        color: #ef4444;
      }
      .stu-att-stat-icon.total {
        background: rgba(128, 128, 128, 0.12);
        color: var(--text, #111827);
      }
      .stu-att-stat-num {
        font-size: 1.25rem;
        font-weight: 800;
        line-height: 1.1;
      }
      .stu-att-stat-num.present { color: #16a34a; }
      .stu-att-stat-num.absent { color: #ef4444; }
      .stu-att-stat-lbl {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--text-muted, #6b7280);
        margin-top: 1px;
      }
      .stu-att-chart-card {
        background: var(--surface, #ffffff);
        border: 1.5px solid var(--border, rgba(0, 0, 0, 0.12));
        border-radius: 22px;
        padding: 22px 24px 16px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
      }
      .stu-att-chart-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      .stu-att-chart-title {
        font-size: 1.02rem;
        font-weight: 800;
        letter-spacing: -0.015em;
      }
      .stu-att-chart-sub {
        font-size: 0.78rem;
        color: var(--text-muted, #6b7280);
        margin-top: 2px;
      }
      .stu-att-chart-legend {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        font-size: 0.74rem;
        font-weight: 600;
        color: var(--text-muted, #6b7280);
      }
      .stu-att-chart-legend span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .stu-att-chart-legend i {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .stu-att-chart-svg {
        width: 100%;
        height: auto;
        display: block;
      }
      .stu-att-chart-axis {
        font-size: 10px;
        font-weight: 600;
        fill: var(--text-muted, #71717a);
      }
      .stu-att-chart-val {
        font-size: 10.5px;
        font-weight: 700;
      }
      .stu-att-chart-code {
        font-size: 10.5px;
        font-weight: 700;
        fill: var(--text-muted, #71717a);
      }
      .stu-att-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: 0 0 14px;
      }
      .stu-att-section-title {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        font-size: 1.12rem;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .stu-att-subjects-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
        gap: 14px;
        margin-bottom: 24px;
      }
      .stu-att-subject-row {
        background: var(--surface, #ffffff);
        border: 1.5px solid var(--border, rgba(0, 0, 0, 0.12));
        border-radius: 18px;
        padding: 18px 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        transition: border-color 0.15s ease, transform 0.15s ease;
      }
      .stu-att-subject-row:hover {
        border-color: var(--text, #111827);
      }
      .stu-att-subject-row.low-alert {
        border-color: rgba(239, 68, 68, 0.4);
      }
      .stu-att-subject-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .stu-att-code-pill {
        font-size: 0.74rem;
        font-weight: 700;
        padding: 4px 10px;
        border-radius: 999px;
        background: var(--stu-att-inner-bg);
        border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
        color: var(--text-muted, #6b7280);
        letter-spacing: 0.02em;
      }
      .stu-att-subject-right {
        display: flex;
        align-items: baseline;
        gap: 5px;
      }
      .stu-att-subject-pct {
        font-size: 1.18rem;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .stu-att-subject-frac {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--text-muted, #6b7280);
      }
      .stu-att-subject-name {
        margin: 0;
        font-size: 0.98rem;
        font-weight: 700;
        line-height: 1.35;
      }
      .stu-att-subject-meta {
        font-size: 0.8rem;
        color: var(--text-muted, #6b7280);
      }
      .stu-att-progress-track {
        width: 100%;
        height: 7px;
        border-radius: 999px;
        background: var(--stu-att-track);
        overflow: hidden;
      }
      .stu-att-progress-fill {
        height: 100%;
        border-radius: 999px;
        transition: width 0.25s ease;
      }
      .stu-att-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 11px;
        border-radius: 999px;
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        border: 1px solid transparent;
      }
      .stu-att-badge.eligible,
      .stu-att-badge.present {
        background: rgba(22, 163, 74, 0.12);
        color: #16a34a;
        border-color: rgba(22, 163, 74, 0.28);
      }
      .stu-att-badge.ineligible,
      .stu-att-badge.absent {
        background: rgba(239, 68, 68, 0.12);
        color: #ef4444;
        border-color: rgba(239, 68, 68, 0.28);
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
        border-radius: 14px;
        background: var(--stu-att-inner-bg);
        border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
        flex-wrap: wrap;
      }
      .stu-att-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 7px 14px;
        border-radius: 999px;
        border: 1px solid var(--border, rgba(0, 0, 0, 0.15));
        background: var(--surface, #ffffff);
        color: var(--text, #111827);
        font-size: 0.8rem;
        font-weight: 700;
        cursor: pointer;
        text-decoration: none;
        font-family: inherit;
      }
      .stu-att-btn:hover {
        border-color: var(--text, #111827);
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
        border: 1px solid var(--border, rgba(0, 0, 0, 0.14));
        background: transparent;
        color: var(--text-muted, #6b7280);
        font-size: 0.78rem;
        font-weight: 700;
        cursor: pointer;
        font-family: inherit;
      }
      .stu-att-filter-pill.active {
        background: var(--text, #111827);
        color: var(--bg, #ffffff);
        border-color: var(--text, #111827);
      }
      .stu-att-footer-notice {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 18px;
        border-radius: 14px;
        background: var(--surface, #ffffff);
        border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
        font-size: 0.82rem;
        color: var(--text-muted, #6b7280);
      }
      @media (max-width: 900px) {
        .stu-att-top-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 640px) {
        .stu-att-card,
        .stu-att-summary-card,
        .stu-att-chart-card {
          padding: 18px 16px;
        }
        .stu-att-summary-body {
          flex-direction: column;
        }
        .stu-att-divider {
          width: 100%;
          height: 1px;
        }
        .stu-att-stats-col {
          width: 100%;
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
            <div style="font-size:1.05rem; font-weight:700; margin-bottom:6px;">Loading Your Attendance…</div>
            <div style="font-size:0.86rem; color:var(--text-muted, #6b7280);">
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
            <div style="font-size:0.88rem; color:var(--text-muted, #6b7280); max-width:460px; margin:0 auto 18px;">
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
            <div style="font-size:0.9rem; color:var(--text-muted, #6b7280); max-width:520px; margin:0 auto 18px; line-height:1.5;">
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

    const overallHasSessions = Boolean(overall.percentageAvailable && (Number(overall.totalSessions) || 0) > 0);
    const overallPctText = formatPercentage(overall.attendancePercentage, overallHasSessions);
    const overallIsLow = isBelowAlertLevel(
      overall.attendancePercentage,
      overall.totalSessions,
      overall.eligibilityStatus,
      overall.configuredThreshold
    );
    const overallElig = describeEligibility(overall.eligibilityStatus, overall.configuredThreshold);

    const recentHistory = Array.isArray(summary.recentHistory) ? summary.recentHistory : [];
    const subjects = sortSubjectsByRecency(
      Array.isArray(summary.subjects) ? summary.subjects : [],
      recentHistory
    );

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
        <!-- 1. Top Overview: App-style Circular Progress Ring + Subject Comparison Chart -->
        <div class="stu-att-top-grid">
          <section class="stu-att-summary-card ${overallIsLow ? 'low-alert' : ''}" aria-label="Overall Attendance Summary">
            <div class="stu-att-summary-head">
              <div>
                <div class="stu-att-kicker">
                  ${escapeHtml(summary.cohort.displayName)} Cohort &middot; Semester ${escapeHtml(summary.semesterNo)}
                </div>
                <h2 class="stu-att-summary-title">Overall Attendance</h2>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                ${
                  overallElig.badgeText
                    ? `<span class="stu-att-badge ${overallElig.badgeClass}">${escapeHtml(overallElig.badgeText)}</span>`
                    : ''
                }
                <button type="button" class="stu-att-btn" data-stu-att-action="retry" title="Refresh attendance">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                  Refresh
                </button>
              </div>
            </div>

            <div class="stu-att-summary-body">
              ${renderCircularRingSvg(overall.attendancePercentage, overallHasSessions, overallIsLow, overallPctText)}
              <div class="stu-att-divider"></div>
              <div class="stu-att-stats-col">
                <div class="stu-att-stat-row-card">
                  <div class="stu-att-stat-icon present" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                  <div>
                    <div class="stu-att-stat-num present">${Number(overall.presentCount) || 0}</div>
                    <div class="stu-att-stat-lbl">Present</div>
                  </div>
                </div>

                <div class="stu-att-stat-row-card">
                  <div class="stu-att-stat-icon absent" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </div>
                  <div>
                    <div class="stu-att-stat-num absent">${Number(overall.absentCount) || 0}</div>
                    <div class="stu-att-stat-lbl">Absent</div>
                  </div>
                </div>

                <div class="stu-att-stat-row-card">
                  <div class="stu-att-stat-icon total" aria-hidden="true">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  </div>
                  <div>
                    <div class="stu-att-stat-num">${Number(overall.totalSessions) || 0}</div>
                    <div class="stu-att-stat-lbl">Total Sessions</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          ${renderSubjectBarChartSvg(subjects)}
        </div>

        <!-- 2. Subject-Wise Attendance Cards (matching mobile app style) -->
        <section aria-label="Subject-Wise Attendance">
          <div class="stu-att-section-head">
            <h3 class="stu-att-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
              Subject-Wise Attendance (${subjects.length})
            </h3>
          </div>

          ${
            subjects.length === 0
              ? `
            <div class="stu-att-card" style="text-align:center; padding:32px 20px;">
              <div style="font-weight:700; margin-bottom:4px;">No Subjects Found for Semester ${escapeHtml(summary.semesterNo)}</div>
              <div style="font-size:0.85rem; color:var(--text-muted, #6b7280);">
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
                  const subIsLow = isBelowAlertLevel(
                    sub.attendancePercentage,
                    subTotal,
                    sub.eligibilityStatus,
                    sub.configuredThreshold
                  );
                  const barColor = !subHasSessions ? 'var(--stu-att-track)' : subIsLow ? '#ef4444' : '#16a34a';
                  const pctColor = !subHasSessions ? 'var(--text-muted, #71717a)' : subIsLow ? '#ef4444' : 'var(--text, #111827)';
                  const subElig = describeEligibility(sub.eligibilityStatus, sub.configuredThreshold);

                  return `
                    <article class="stu-att-subject-row ${subIsLow ? 'low-alert' : ''}">
                      <div class="stu-att-subject-top">
                        <div style="display:flex; align-items:center; gap:8px;">
                          <span class="stu-att-code-pill">${escapeHtml(sub.code || sub.subjectId)}</span>
                          ${
                            subElig.badgeText
                              ? `<span class="stu-att-badge ${subElig.badgeClass}">${escapeHtml(subElig.badgeText)}</span>`
                              : ''
                          }
                        </div>
                        <div class="stu-att-subject-right">
                          <span class="stu-att-subject-pct" style="color:${pctColor};">${subPctLabel}</span>
                          ${
                            subHasSessions
                              ? `<span class="stu-att-subject-frac">(${subPresent}/${subTotal})</span>`
                              : ''
                          }
                        </div>
                      </div>

                      <div>
                        <h4 class="stu-att-subject-name">${escapeHtml(sub.name)}</h4>
                        <div class="stu-att-subject-meta" style="margin-top:4px;">
                          ${
                            subTotal === 0
                              ? 'No sessions recorded'
                              : `${subPresent} Present &middot; ${subAbsent} Absent &middot; ${subTotal} ${subTotal === 1 ? 'Session' : 'Sessions'}`
                          }
                        </div>
                      </div>

                      <div class="stu-att-progress-track">
                        <div class="stu-att-progress-fill" style="width:${subBarWidth}%; background:${barColor};"></div>
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
              <h3 style="margin:0 0 3px; font-size:1.08rem; font-weight:800;">Recent Attendance History</h3>
              <div style="font-size:0.8rem; color:var(--text-muted, #6b7280);">
                Individual finalized class sessions recorded for your cohort.
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
            <div style="text-align:center; padding:26px 16px; color:var(--text-muted, #6b7280); font-size:0.86rem;">
              No attendance has been recorded yet. Finalized class sessions will appear here in chronological order.
            </div>
          `
              : filteredHistory.length === 0
              ? `
            <div style="text-align:center; padding:22px 16px; color:var(--text-muted, #6b7280); font-size:0.86rem;">
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
                        <div style="font-weight:700; font-size:0.92rem;">
                          <span style="color:var(--text-muted, #6b7280); font-weight:700; margin-right:6px;">${escapeHtml(item.subjectCode || item.subjectId)}</span>
                          ${escapeHtml(item.subjectName || '')}
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-muted, #6b7280); margin-top:2px;">
                          ${escapeHtml(formatNepalDateString(item.sessionDate))}
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

        <!-- 4. Teacher Update Footer Notice -->
        <div class="stu-att-footer-notice">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <span>Attendance is automatically updated by your teachers.</span>
        </div>
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
