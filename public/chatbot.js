/**
 * Semester Library — Kyana AI Workspace Engine
 * Visual Philosophy: LOGO = Identity · LIGHT & MOTION = Intelligence (Kyana Aura)
 * Clean Architecture: Gemini/ChatGPT/Claude Maturity with Original Identity
 */

(function () {
  'use strict';

  // --- 1. Pure Helper Utilities (Shared with Tests & Node) ---

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function safeLink(value, externalOnly = false) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const trimmed = value.trim();
    if (trimmed.startsWith('//') || /^(?:javascript|data|vbscript):/i.test(trimmed)) return null;
    try {
      const url = new URL(trimmed, 'https://semester-library.local/');
      if (!['https:', 'http:'].includes(url.protocol)) return null;
      if (externalOnly && !/^https?:\/\//i.test(trimmed)) return null;
      return trimmed;
    } catch (_) {
      return null;
    }
  }

  /**
   * Stabilizes incomplete streaming Markdown so partial code fences, math blocks,
   * tables, and inline emphasis render cleanly without layout jumps or flickering.
   */
  function stabilizeStreamingMarkdown(rawMarkdown) {
    if (!rawMarkdown || typeof rawMarkdown !== 'string') return '';
    let text = String(rawMarkdown).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 1. Check for unclosed fenced code block (``` or ~~~)
    const lines = text.split('\n');
    let openFence = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!openFence) {
        const m = line.match(/^\s*(`{3,}|~{3,})([\w+#.-]*)[ \t]*$/);
        if (m) {
          openFence = m[1];
        }
      } else {
        const closeRe = new RegExp(`^\\s*${openFence[0]}{${openFence.length},}[ \\t]*$`);
        if (closeRe.test(line)) {
          openFence = null;
        }
      }
    }
    if (openFence) {
      return `${text}\n${openFence}`;
    }

    // 2. Stabilize unclosed block LaTeX ($$ or \[) outside code blocks
    const { text: withoutCode, tokenMap } = protectCodeBlocks(text);
    let stabilized = withoutCode;

    const doubleDollarMatches = stabilized.match(/\$\$/g) || [];
    if (doubleDollarMatches.length % 2 === 1) {
      stabilized += '\n$$';
    }
    const openBracketCount = (stabilized.match(/\\\[/g) || []).length;
    const closeBracketCount = (stabilized.match(/\\\]/g) || []).length;
    if (openBracketCount > closeBracketCount) {
      stabilized += '\n\\]';
    }
    const openParenCount = (stabilized.match(/\\\(/g) || []).length;
    const closeParenCount = (stabilized.match(/\\\)/g) || []).length;
    if (openParenCount > closeParenCount) {
      stabilized += '\\)';
    }

    // 3. Stabilize incomplete trailing Markdown table delimiter row
    const sLines = stabilized.split('\n');
    if (sLines.length >= 2) {
      const prevLine = sLines[sLines.length - 2].trim();
      const lastLine = sLines[sLines.length - 1].trim();
      if (prevLine.includes('|') && /^\|?[\s|:-]*$/.test(lastLine) && lastLine.includes('|') && !/^\s*\|?(\s*:?-{1,}:?\s*\|)+\s*:?-{1,}:?\s*\|?\s*$/.test(lastLine)) {
        const colCount = prevLine.replace(/^\||\|$/g, '').split('|').length;
        sLines[sLines.length - 1] = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
        stabilized = sLines.join('\n');
      }
    }

    // 4. Stabilize unclosed inline tokens on the final line
    const finalLines = stabilized.split('\n');
    let last = finalLines[finalLines.length - 1] || '';
    if (last && !/^\s*(?:`|~|>|#|-|\*|\d+\.|\|)/.test(last)) {
      const backticks = (last.match(/`/g) || []).length;
      if (backticks % 2 === 1) last += '`';
      const bolds = (last.match(/\*\*/g) || []).length;
      if (bolds % 2 === 1) last += '**';
      const strikes = (last.match(/~~/g) || []).length;
      if (strikes % 2 === 1) last += '~~';
      finalLines[finalLines.length - 1] = last;
      stabilized = finalLines.join('\n');
    }

    return restoreCodeBlocks(stabilized, tokenMap);
  }

  function protectCodeBlocks(markdown) {
    if (!markdown) return { text: '', tokenMap: new Map() };
    const tokenMap = new Map();
    let counter = 0;

    // Fenced code blocks (``` or ~~~) - both closed fences and unclosed streaming fences
    const fencedRegex = /(^|\n)(`{3,}|~{3,})([\w+-]*)\r?\n([\s\S]*?)(?:\r?\n\2[ \t]*(?=\r?\n|$)|$)/g;
    let text = String(markdown).replace(fencedRegex, (match, prefix) => {
      const id = `___KYANA_PROTECTED_CODE_${counter++}___`;
      tokenMap.set(id, match);
      return (prefix || '') + id;
    });

    // Inline code (`...`)
    const inlineRegex = /(`+)([\s\S]*?[^`])\1(?!`)/g;
    text = text.replace(inlineRegex, (match) => {
      const id = `___KYANA_PROTECTED_CODE_${counter++}___`;
      tokenMap.set(id, match);
      return id;
    });

    return { text, tokenMap };
  }

  function restoreCodeBlocks(text, tokenMap) {
    if (!text || !tokenMap || tokenMap.size === 0) return text;
    let restored = text;
    for (const [token, original] of tokenMap.entries()) {
      restored = restored.split(token).join(original);
    }
    if (/___KYANA_PROTECTED_CODE_\d+___/.test(restored)) {
      for (const [token, original] of tokenMap.entries()) {
        restored = restored.split(token).join(original);
      }
    }
    return restored;
  }

  function parseAttendanceBlock(rawBlock) {
    const lines = String(rawBlock || '').replace(/\r\n/g, '\n').split('\n');
    const data = {
      hasOverview: false,
      hasRecords: false,
      semester: null,
      overallPct: null,
      isLow: false,
      attendedLabel: '0 / 0',
      present: 0,
      absent: 0,
      totalClasses: 0,
      recordedSubjects: 0,
      totalSubjects: 0,
      recordedItems: [],
      unrecordedItems: []
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (/^Overview:/i.test(line)) {
        data.hasOverview = true;
        const parts = line.replace(/^Overview:\s*/i, '').split('|').map(p => p.trim());
        const first = parts[0] || '';
        if (/No records/i.test(first)) {
          data.hasRecords = false;
          data.overallPct = null;
          data.isLow = false;
        } else {
          const pctMatch = first.match(/(\d+(?:\.\d+)?)%/);
          if (pctMatch) {
            data.hasRecords = true;
            data.overallPct = Number(pctMatch[1]);
            data.isLow = data.overallPct < 50 || /Low Attendance/i.test(first);
          }
        }
        for (const part of parts.slice(1)) {
          const attMatch = part.match(/^(\d+)\s*\/\s*(\d+)\s+classes/i);
          if (attMatch) {
            data.present = Number(attMatch[1]);
            data.totalClasses = Number(attMatch[2]);
            data.attendedLabel = `${attMatch[1]} / ${attMatch[2]}`;
            continue;
          }
          const presMatch = part.match(/^Present:\s*(\d+)/i);
          if (presMatch) {
            data.present = Number(presMatch[1]);
            continue;
          }
          const absMatch = part.match(/^Absent:\s*(\d+)/i);
          if (absMatch) {
            data.absent = Number(absMatch[1]);
            continue;
          }
          const subjMatch = part.match(/^(\d+)\s+of\s+(\d+)\s+subjects/i);
          if (subjMatch) {
            data.recordedSubjects = Number(subjMatch[1]);
            data.totalSubjects = Number(subjMatch[2]);
            continue;
          }
          const semMatch = part.match(/^Semester\s+(\d+)/i);
          if (semMatch) {
            data.semester = Number(semMatch[1]);
          }
        }
        continue;
      }

      const itemMatch = line.match(/^[-•*]\s+\*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?:\s*(.+)$/);
      if (itemMatch) {
        const name = itemMatch[1].trim();
        const code = (itemMatch[2] || '').trim();
        const rest = itemMatch[3].trim();
        if (/\*\*No records\*\*|^No records$/i.test(rest)) {
          data.unrecordedItems.push({ name, code });
        } else {
          const pctMatch = rest.match(/\*\*(\d+(?:\.\d+)?)%\*\*|(\d+(?:\.\d+)?)%/);
          if (pctMatch) {
            const pct = Number(pctMatch[1] ?? pctMatch[2]);
            const isLow = pct < 50 || /Low Attendance/i.test(rest);
            const classesMatch = rest.match(/(\d+)\s+recorded\s+class/i) || rest.match(/out\s+of\s+(\d+)\s+class/i);
            const presMatch = rest.match(/Present:\s*(\d+)/i) || rest.match(/(\d+)\s+present/i);
            const absMatch = rest.match(/Absent:\s*(\d+)/i) || rest.match(/(\d+)\s+(?:missed\/)?absent/i);
            const present = presMatch ? Number(presMatch[1]) : 0;
            const absent = absMatch ? Number(absMatch[1]) : 0;
            const classes = classesMatch ? Number(classesMatch[1]) : (present + absent);
            data.recordedItems.push({
              name,
              code,
              pct,
              isLow,
              classes,
              present,
              absent
            });
          }
        }
      }
    }

    if (!data.hasOverview && (data.recordedItems.length > 0 || data.unrecordedItems.length > 0)) {
      const totalPres = data.recordedItems.reduce((acc, r) => acc + r.present, 0);
      const totalAbs = data.recordedItems.reduce((acc, r) => acc + r.absent, 0);
      const totalCls = data.recordedItems.reduce((acc, r) => acc + r.classes, 0);
      data.present = totalPres;
      data.absent = totalAbs;
      data.totalClasses = totalCls;
      data.attendedLabel = `${totalPres} / ${totalCls}`;
      data.recordedSubjects = data.recordedItems.length;
      data.totalSubjects = data.recordedItems.length + data.unrecordedItems.length;
      if (totalCls > 0) {
        data.hasRecords = true;
        data.overallPct = Math.round((totalPres / totalCls) * 10000) / 100;
        data.isLow = data.overallPct < 50;
      }
    }

    return data;
  }

  function renderAttendanceChartHtml(rawBlock) {
    const data = parseAttendanceBlock(rawBlock);
    if (!data.hasOverview && data.recordedItems.length === 0 && data.unrecordedItems.length === 0) {
      return '';
    }

    const pillClass = !data.hasRecords ? 'is-empty' : (data.isLow ? 'is-low' : 'is-recorded');
    const pillText = !data.hasRecords ? 'No records' : (data.isLow ? 'Low Attendance' : 'Recorded data');
    const overallPctStr = data.hasRecords && data.overallPct !== null ? `${data.overallPct}%` : 'No records';
    const overallBarWidth = data.hasRecords && data.overallPct !== null
      ? Math.min(100, Math.max(data.overallPct === 0 ? 2 : 0, data.overallPct))
      : 0;
    const scopeHint = data.totalSubjects > 1 && data.recordedSubjects > 0 && data.recordedSubjects < data.totalSubjects
      ? ` · ${data.recordedSubjects} of ${data.totalSubjects} subjects`
      : '';

    let html = `<div class="kyana-attendance-card" data-attendance-rendered="true">
      <div class="kyana-att-header">
        <span class="kyana-att-title">Attendance overview</span>
        <span class="kyana-att-status-pill ${pillClass}">${escapeHtml(pillText)}</span>
      </div>
      <div class="kyana-att-hero-row">
        <div class="kyana-att-hero-col">
          <div class="kyana-att-hero-pct-wrap">
            <span class="kyana-att-hero-pct ${!data.hasRecords ? 'is-norecord' : (data.isLow ? 'is-low' : '')}">${escapeHtml(overallPctStr)}</span>
            ${data.hasRecords && data.isLow ? '<span class="kyana-att-low-badge">Low Attendance</span>' : ''}
          </div>
          <span class="kyana-att-hero-sub">Overall attendance${escapeHtml(scopeHint)}</span>
        </div>
        <div class="kyana-att-hero-col is-right">
          <span class="kyana-att-hero-ratio">${escapeHtml(data.hasRecords ? data.attendedLabel : '0 / 0')}</span>
          <span class="kyana-att-hero-sub">Classes attended</span>
        </div>
      </div>`;

    if (data.hasRecords) {
      html += `
      <div class="kyana-att-bar-track" role="progressbar" aria-valuenow="${data.overallPct}" aria-valuemin="0" aria-valuemax="100">
        <svg class="kyana-att-bar-svg" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
          <rect class="kyana-att-svg-bg" x="0" y="0" width="100" height="8" rx="4"></rect>
          <rect class="kyana-att-svg-fill ${data.isLow ? 'is-low' : ''}" x="0" y="0" width="${overallBarWidth}" height="8" rx="4"></rect>
        </svg>
      </div>
      <div class="kyana-att-stat-grid">
        <div class="kyana-att-stat-box">
          <span class="kyana-att-stat-num">${data.present}</span>
          <span class="kyana-att-stat-label">Present</span>
        </div>
        <div class="kyana-att-stat-box">
          <span class="kyana-att-stat-num">${data.absent}</span>
          <span class="kyana-att-stat-label">Absent</span>
        </div>
      </div>`;
    }

    if (data.recordedItems.length > 0) {
      html += `
      <div class="kyana-att-divider"></div>
      <div class="kyana-att-section-heading">Subject-wise attendance</div>
      <div class="kyana-att-subjects-list">`;

      for (const item of data.recordedItems) {
        const barW = Math.min(100, Math.max(item.pct === 0 ? 2 : 0, item.pct));
        const metaParts = [];
        if (item.code) metaParts.push(item.code);
        metaParts.push(`${item.classes} recorded ${item.classes === 1 ? 'class' : 'classes'}`);

        html += `
        <div class="kyana-att-subj-item" data-subject-code="${escapeHtml(item.code)}" data-subject-pct="${item.pct}">
          <div class="kyana-att-subj-top">
            <div class="kyana-att-subj-info">
              <span class="kyana-att-subj-name">${escapeHtml(item.name)}</span>
              <span class="kyana-att-subj-meta">${escapeHtml(metaParts.join(' · '))}</span>
            </div>
            <div class="kyana-att-subj-pct-col">
              <span class="kyana-att-subj-pct ${item.isLow ? 'is-low' : ''}">${escapeHtml(String(item.pct))}%</span>
              ${item.isLow ? '<span class="kyana-att-low-badge">Low Attendance</span>' : ''}
            </div>
          </div>
          <div class="kyana-att-bar-track" role="progressbar" aria-valuenow="${item.pct}" aria-valuemin="0" aria-valuemax="100">
            <svg class="kyana-att-bar-svg" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
              <rect class="kyana-att-svg-bg" x="0" y="0" width="100" height="8" rx="4"></rect>
              <rect class="kyana-att-svg-fill ${item.isLow ? 'is-low' : ''}" x="0" y="0" width="${barW}" height="8" rx="4"></rect>
            </svg>
          </div>
          <div class="kyana-att-subj-counts">
            <span>Present: ${item.present}</span>
            <span>Absent: ${item.absent}</span>
          </div>
        </div>`;
      }
      html += `</div>`;
    }

    if (data.unrecordedItems.length > 0) {
      html += `
      <div class="kyana-att-divider"></div>
      <div class="kyana-att-section-heading">${data.recordedItems.length > 0 ? 'Other subjects' : 'Subjects'}</div>
      <div class="kyana-att-other-list">`;

      for (const u of data.unrecordedItems) {
        html += `
        <div class="kyana-att-other-row" data-subject-code="${escapeHtml(u.code)}" data-subject-status="no-records">
          <span class="kyana-att-other-name">${escapeHtml(u.name)}</span>
          <span class="kyana-att-norecord-pill">No records</span>
        </div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }


  const VISUAL_BLOCK_KINDS = new Set([
    'attendance',
    'results',
    'assignments',
    'notes',
    'notices',
    'routine',
    'posts',
    'directory',
    'syllabus',
    'diagram',
    'flowchart',
    'graph',
    'trace',
    'comparison',
    'quiz',
    'roadmap',
    'complexity'
  ]);

  function parseKyanaVisualBlock(kind, rawBlock) {
    const normKind = String(kind || '').trim().toLowerCase();
    const text = String(rawBlock || '').replace(/\r\n/g, '\n').trim();
    if (normKind === 'attendance') {
      return { kind: 'attendance', ...parseAttendanceBlock(text) };
    }

    if (text.startsWith('{') && ['syllabus', 'diagram', 'flowchart', 'graph', 'trace', 'quiz', 'roadmap', 'comparison', 'complexity'].includes(normKind)) {
      try {
        const parsedJson = JSON.parse(text);
        if (parsedJson && typeof parsedJson === 'object') {
          const items =
            parsedJson.units ||
            parsedJson.nodes ||
            parsedJson.steps ||
            parsedJson.series ||
            parsedJson.questions ||
            parsedJson.items ||
            (parsedJson.unit ? [parsedJson.unit] : []);
          return {
            kind: normKind,
            ...parsedJson,
            items: Array.isArray(items) ? items : []
          };
        }
      } catch (_) {
        return { kind: normKind, items: [] };
      }
    }

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    if (normKind === 'results') {
      const items = [];
      let aggregateLabel = null;
      let aggregateScore = null;
      let aggregatePct = null;

      for (const line of lines) {
        const aggMatch = line.match(/\*\*([^*]*Aggregate[^*]*):\*\*\s*([0-9.]+\s*\/\s*[0-9.]+)(?:\s*\(([^)]+)\))?/i);
        if (aggMatch) {
          aggregateLabel = aggMatch[1].trim().replace(/:$/, '');
          aggregateScore = aggMatch[2].trim();
          const pctM = (aggMatch[3] || '').match(/(\d+(?:\.\d+)?)%/);
          if (pctM) aggregatePct = Number(pctM[1]);
          continue;
        }

        const bulletMatch = line.match(/^(?:[-•*]|\d+\.)\s+\*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?\s*(?:—|-|:)\s*(.+)$/);
        if (bulletMatch) {
          const subject = bulletMatch[1].trim();
          const code = (bulletMatch[2] || '').trim();
          const rest = bulletMatch[3].trim();
          const examMatch = rest.match(/\*([^*]+)\*/);
          const examType = examMatch ? examMatch[1].trim() : 'Exam';
          const semMatch = rest.match(/\(Semester\s+(\d+)\)/i);
          const semester = semMatch ? Number(semMatch[1]) : null;
          const isAbsent = /\bAbsent\b/i.test(rest);
          const isUnpublished = /\b(?:Unpublished|Pending|Not published)\b/i.test(rest);
          const scoreMatch = rest.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
          const pctMatch = rest.match(/(\d+(?:\.\d+)?)%/);
          const obtained = scoreMatch ? Number(scoreMatch[1]) : null;
          const max = scoreMatch ? Number(scoreMatch[2]) : null;
          const pct = pctMatch
            ? Number(pctMatch[1])
            : (obtained !== null && max ? Math.round((obtained / max) * 10000) / 100 : null);
          const isLow = isAbsent || (pct !== null && pct < 40);
          const scoreLabel = isAbsent
            ? (rest.match(/Absent\s*\([^)]+\)/i)?.[0] || 'Absent')
            : (isUnpublished ? 'Unpublished' : (scoreMatch ? `${obtained} / ${max}` : rest.replace(/\*[^*]+\*[:\s—-]*/g, '').replace(/\*\*/g, '').trim()));

          items.push({
            subject,
            code,
            examType,
            semester,
            obtained,
            max,
            pct,
            isAbsent,
            isUnpublished,
            isLow,
            scoreLabel
          });
        }
      }

      if (!aggregatePct && items.length > 0) {
        const scored = items.filter(i => i.obtained !== null && i.max !== null && !i.isAbsent);
        if (scored.length > 0) {
          const sumObt = scored.reduce((a, b) => a + b.obtained, 0);
          const sumMax = scored.reduce((a, b) => a + b.max, 0);
          if (sumMax > 0) {
            if (!aggregateScore) aggregateScore = `${Math.round(sumObt * 100) / 100} / ${Math.round(sumMax * 100) / 100}`;
            aggregatePct = Math.round((sumObt / sumMax) * 10000) / 100;
          }
        }
      }

      return {
        kind: 'results',
        aggregateLabel: aggregateLabel || 'Overall score',
        aggregateScore,
        aggregatePct,
        items
      };
    }

    if (normKind === 'assignments') {
      const items = [];
      let currentItem = null;

      for (const rawLine of text.split('\n')) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        if (/^[-*]\s+\*\*([^*]+)\*\*/.test(trimmed) && !/^•/.test(trimmed) && !/^\s{2,}/.test(rawLine)) {
          const m = trimmed.match(/^[-*]\s+\*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?(?:\s*\[([^\]]+)\])?(?:\s*(?:—|-|:)\s*(.+))?$/);
          if (m) {
            const title = m[1].trim();
            const subject = (m[2] || 'General').trim();
            const semester = (m[3] || '').trim();
            const tail = (m[4] || '').trim();
            const isOverdue = /\b(?:Missed|Overdue)\b/i.test(tail);
            const isChecked = /\b(?:Checked|Graded)\b/i.test(tail);
            const isSubmitted = isChecked || /\bSubmitted\b/i.test(tail);
            const dueMatch = tail.match(/(?:due|Deadline:|Was due on)\s*\*\*?([^*(]+?)\*\*?(?:\s*\(|$)/i);
            const deadline = dueMatch ? dueMatch[1].trim() : null;
            const statusLabel = isOverdue ? 'Overdue' : (isChecked ? 'Checked' : (isSubmitted ? 'Submitted' : 'Pending'));

            currentItem = {
              title,
              subject,
              semester,
              deadline,
              statusLabel,
              isOverdue,
              isSubmitted,
              isChecked,
              author: null,
              description: null,
              questions: null,
              grade: null,
              details: []
            };
            items.push(currentItem);
            continue;
          }
        }

        if (currentItem && /^[•*-]\s+/.test(trimmed)) {
          const cleanDetail = trimmed.replace(/^[•*-]\s+/, '');
          const kv = cleanDetail.match(/^\*\*([^:]+):\*\*\s*(.+)$/);
          if (kv) {
            const k = kv[1].trim().toLowerCase();
            const v = kv[2].trim().replace(/\*\*/g, '');
            if (k === 'author') currentItem.author = v;
            else if (k === 'description') currentItem.description = v;
            else if (k.startsWith('questions')) currentItem.questions = v;
            else if (k.includes('submission status')) {
              currentItem.statusLabel = v;
              if (/Overdue|Missed/i.test(v)) currentItem.isOverdue = true;
              if (/Submitted/i.test(v) && !/Not submitted/i.test(v)) currentItem.isSubmitted = true;
            } else if (k.includes('grade')) {
              currentItem.grade = v;
              if (/Checked/i.test(v)) currentItem.isChecked = true;
            } else {
              currentItem.details.push(`${kv[1].trim()}: ${v}`);
            }
          }
        }
      }
      return { kind: 'assignments', items };
    }

    if (normKind === 'notes') {
      const items = [];
      for (const line of lines) {
        const m = line.match(/^[-•*]\s+\*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?(.*)$/);
        if (m) {
          const title = m[1].trim();
          const metaRaw = (m[2] || '').trim();
          const extra = (m[3] || '').trim();
          const parts = metaRaw.split('|').map(p => p.trim());
          const primaryParts = (parts[0] || '').split(',').map(p => p.trim()).filter(Boolean);
          const subject = primaryParts[0] || 'Study Material';
          const semester = primaryParts.find(p => /semester/i.test(p)) || null;
          const chapter = primaryParts.find(p => /chapter|unit/i.test(p)) || null;
          const folderPart = parts.find(p => /^Folder:/i.test(p));
          const folder = folderPart ? folderPart.replace(/^Folder:\s*/i, '').trim() : null;
          const ext = (title.match(/\.([a-zA-Z0-9]{2,4})$/)?.[1] || 'PDF').toUpperCase();
          items.push({
            title,
            subject,
            semester,
            chapter,
            folder,
            fileType: ext,
            extra: extra.replace(/^[:\s—-]+/, '').trim() || null
          });
        }
      }
      return { kind: 'notes', items };
    }

    if (normKind === 'routine') {
      const items = [];
      for (const line of lines) {
        const m = line.match(/^[-•*]\s+\*\*([^*]+)\*\*\s*(?:—|-)\s*(.+)$/);
        if (m) {
          const subject = m[1].trim();
          const rest = m[2].trim();
          const dayMatch = rest.match(/\(([^)]+)\)/);
          const day = dayMatch ? dayMatch[1].trim() : null;
          const roomMatch = rest.match(/Room\s+([^,]+)/i);
          const room = roomMatch ? roomMatch[1].trim() : null;
          const timeMatch = rest.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i);
          const time = timeMatch ? timeMatch[1].trim() : null;
          const datePart = rest.split(',')[0].replace(/\([^)]*\)/g, '').trim();
          items.push({ subject, date: datePart, day, time, room, rawMeta: rest });
        }
      }
      return { kind: 'routine', items };
    }

    if (normKind === 'notices' || normKind === 'posts' || normKind === 'directory') {
      const items = [];
      for (const line of lines) {
        const m = line.match(/^[-•*]\s+\*\*([^*]+)\*\*(?:\s*\[([^\]]+)\])?(?:\s*\(([^)]+)\))?(?:\s*(?:—|-|:)\s*(.+))?$/);
        if (m) {
          items.push({
            title: m[1].trim(),
            badge: (m[2] || m[3] || '').trim() || null,
            meta: (m[2] && m[3] ? m[3] : '').trim() || null,
            summary: (m[4] || '').trim().replace(/\*\*/g, '') || null,
            isOfficial: normKind === 'notices' && !/community|student post/i.test(m[2] || '')
          });
        }
      }
      return { kind: normKind, items };
    }

    if (normKind === 'syllabus') {
      const items = [];
      let courseTitle = null;
      let courseCode = null;
      let semester = null;
      let credits = null;
      let nature = null;
      let totalHours = null;
      let objectives = null;
      let labs = null;
      let textbooks = null;
      let currentUnit = null;

      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;

        const courseMatch = line.match(/^[-*]\s+\*\*Course:\*\*\s*([^(]+?)(?:\s*\(([^)]+)\))?(?:\s*[·•|]\s*(.+))?$/i);
        if (courseMatch) {
          courseTitle = courseMatch[1].trim();
          courseCode = (courseMatch[2] || '').trim();
          const meta = courseMatch[3] || '';
          const semM = meta.match(/Semester\s+(\d+)/i);
          if (semM) semester = Number(semM[1]);
          const credM = meta.match(/(\d+)\s*Credits?/i);
          if (credM) credits = credM[1];
          const natM = meta.match(/Nature:\s*([A-Za-z +]+)/i);
          if (natM) nature = natM[1].trim();
          const hrsM = meta.match(/Total:\s*(\d+\s*hrs?)/i);
          if (hrsM) totalHours = hrsM[1].trim();
          continue;
        }

        const semHeaderMatch = line.match(/^[-*]\s+\*\*Semester:\*\*\s*(.+)$/i);
        if (semHeaderMatch) {
          courseTitle = semHeaderMatch[1].trim();
          continue;
        }

        const objMatch = line.match(/^[-*]\s+\*\*Objectives?:\*\*\s*(.+)$/i);
        if (objMatch) {
          objectives = objMatch[1].trim();
          continue;
        }

        const labMatch = line.match(/^[-*]\s+\*\*Labs?:\*\*\s*(.+)$/i);
        if (labMatch) {
          labs = labMatch[1].trim();
          continue;
        }

        const tbMatch = line.match(/^[-*]\s+\*\*Textbooks?:\*\*\s*(.+)$/i);
        if (tbMatch) {
          textbooks = tbMatch[1].trim();
          continue;
        }

        const unitMatch = line.match(/^[-*]\s+\*\*(?:Unit\s+)?(\d{1,2}):\s*([^*]+)\*\*(?:\s*[—–-]\s*(.+))?$/i);
        if (unitMatch) {
          const uNum = Number(unitMatch[1]);
          const uTitle = unitMatch[2].trim();
          const rest = unitMatch[3] || '';
          const hrsM = rest.match(/(\d+\s*hrs?)/i);
          const pctM = rest.match(/(\d+(?:\.\d+)?)%/);
          currentUnit = {
            unitNumber: uNum,
            title: uTitle,
            hours: hrsM ? hrsM[1].trim() : null,
            pct: pctM ? Number(pctM[1]) : null,
            topics: ''
          };
          items.push(currentUnit);
          continue;
        }

        if (currentUnit && /^[•*-]\s*(?:Topics?:)?\s*(.+)$/i.test(line)) {
          const tMatch = line.match(/^[•*-]\s*(?:Topics?:)?\s*(.+)$/i);
          if (tMatch) {
            currentUnit.topics = currentUnit.topics ? `${currentUnit.topics}; ${tMatch[1].trim()}` : tMatch[1].trim();
          }
          continue;
        }

        const courseListMatch = line.match(/^[-*]\s+\*\*([^*:]+):\*\*\s*(.+)$/);
        if (courseListMatch && !line.startsWith('- **Unit')) {
          const code = courseListMatch[1].trim();
          const rest = courseListMatch[2].trim();
          const parts = rest.split(/[·•|]/).map(p => p.trim());
          items.push({
            code,
            title: parts[0] || code,
            credits: parts[1] || null,
            nature: parts[2] || null,
            details: parts.slice(3).join(' · ') || null
          });
        }
      }

      return {
        kind: 'syllabus',
        courseTitle,
        courseCode,
        semester,
        credits,
        nature,
        totalHours,
        objectives,
        labs,
        textbooks,
        items
      };
    }

    if (normKind === 'diagram') {
      let title = 'System Architecture & Concept Diagram';
      const diagramLines = [];
      for (const line of lines) {
        const titleMatch = line.match(/^\[([A-Za-z0-9\s_-]+)\]$/);
        if (titleMatch && diagramLines.length === 0) {
          title = titleMatch[1].trim();
        } else if (line.startsWith('- ') || line.startsWith('* ')) {
          diagramLines.push(line.replace(/^[-*]\s+/, ''));
        } else if (/[|\-+_=><]/.test(line)) {
          diagramLines.push(line);
        }
      }
      const items = diagramLines.filter(l => l.trim().length > 0);
      return {
        kind: 'diagram',
        title,
        diagramText: diagramLines.join('\n').trim(),
        items
      };
    }

    if (normKind === 'flowchart' || normKind === 'trace') {
      const items = [];
      for (const line of lines) {
        const stepMatch = line.match(/^(?:\[([^\]]+)\]|([A-Za-z0-9\s_-]+:))\s*(.+)$/);
        if (stepMatch) {
          const stepLabel = (stepMatch[1] || stepMatch[2] || 'Step').replace(/:$/, '').trim();
          const content = stepMatch[3].trim();
          items.push({ label: stepLabel, content });
        } else if (/^[-*]\s+/.test(line)) {
          items.push({ label: `Step ${items.length + 1}`, content: line.replace(/^[-*]\s+/, '').trim() });
        }
      }
      return { kind: normKind, items };
    }

    if (normKind === 'comparison') {
      const items = [];
      for (const line of lines) {
        if (line.includes('|')) {
          const parts = line.split('|').map(p => p.trim().replace(/^[-*]\s+/, ''));
          if (parts.length >= 2) {
            const col1 = parts[0].replace(/\*\*/g, '').trim();
            const col2 = parts[1].replace(/\*\*/g, '').trim();
            const col3 = parts[2] ? parts[2].replace(/\*\*/g, '').trim() : null;
            items.push({ col1, col2, col3 });
          }
        }
      }
      return { kind: 'comparison', items };
    }

    if (normKind === 'quiz') {
      let question = null;
      const options = [];
      let answer = null;
      let explanation = null;

      for (const line of lines) {
        const qMatch = line.match(/^[-*]\s+\*\*Question:\*\*\s*(.+)$/i);
        if (qMatch) { question = qMatch[1].trim(); continue; }

        const optMatch = line.match(/^[-*]\s+\*\*Option\s+([A-D]):\*\*\s*(.+)$/i);
        if (optMatch) {
          options.push({ key: optMatch[1].toUpperCase(), text: optMatch[2].trim() });
          continue;
        }

        const ansMatch = line.match(/^[-*]\s+\*\*Answer:\*\*\s*(.+)$/i);
        if (ansMatch) { answer = ansMatch[1].trim(); continue; }

        const expMatch = line.match(/^[-*]\s+\*\*Explanation:\*\*\s*(.+)$/i);
        if (expMatch) { explanation = expMatch[1].trim(); continue; }
      }
      const items = options.map(o => ({ key: o.key, text: o.text }));
      return {
        kind: 'quiz',
        question,
        options,
        answer,
        explanation,
        items
      };
    }

    if (normKind === 'roadmap') {
      const items = [];
      for (const line of lines) {
        const m = line.match(/^[-*]\s+\[([ xX])\]\s+\*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?(?:\s*[—–-]\s*(.+))?$/);
        if (m) {
          const done = m[1].toLowerCase() === 'x';
          const title = m[2].trim();
          const tag = (m[3] || '').trim();
          const desc = (m[4] || '').trim();
          items.push({ done, title, tag, desc });
        }
      }
      return { kind: 'roadmap', items };
    }

    if (normKind === 'complexity') {
      const items = [];
      for (const line of lines) {
        if (line.includes('|')) {
          const parts = line.split('|').map(p => p.trim().replace(/^[-*]\s+/, ''));
          if (parts.length >= 2) {
            items.push({
              label: parts[0].replace(/\*\*/g, '').trim(),
              best: parts[1] ? parts[1].replace(/\*\*/g, '').trim() : null,
              average: parts[2] ? parts[2].replace(/\*\*/g, '').trim() : null,
              worst: parts[3] ? parts[3].replace(/\*\*/g, '').trim() : null,
              space: parts[4] ? parts[4].replace(/\*\*/g, '').trim() : null
            });
          }
        }
      }
      return { kind: 'complexity', items };
    }

    return { kind: normKind, items: [] };
  }

  function renderKyanaVisualBlockHtml(kind, rawBlock) {
    const normKind = String(kind || '').trim().toLowerCase();
    if (normKind === 'attendance') {
      return renderAttendanceChartHtml(rawBlock);
    }

    const parsed = parseKyanaVisualBlock(normKind, rawBlock);
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return '';
    }

    if (normKind === 'results') {
      const hasAgg = parsed.aggregatePct !== null || parsed.aggregateScore;
      const aggBarW = parsed.aggregatePct !== null ? Math.min(100, Math.max(2, parsed.aggregatePct)) : 0;
      const aggLow = parsed.aggregatePct !== null && parsed.aggregatePct < 40;

      let html = `<div class="kyana-attendance-card kyana-results-card" data-visual-kind="results">
        <div class="kyana-att-header">
          <span class="kyana-att-title">Academic results</span>
          <span class="kyana-att-status-pill">${parsed.items.length} published ${parsed.items.length === 1 ? 'exam' : 'exams'}</span>
        </div>`;

      if (hasAgg) {
        html += `
        <div class="kyana-att-hero-row">
          <div class="kyana-att-hero-col">
            <div class="kyana-att-hero-pct-wrap">
              <span class="kyana-att-hero-pct ${aggLow ? 'is-low' : ''}">${escapeHtml(parsed.aggregatePct !== null ? `${parsed.aggregatePct}%` : parsed.aggregateScore)}</span>
            </div>
            <span class="kyana-att-hero-sub">${escapeHtml(parsed.aggregateLabel || 'Overall aggregate')}</span>
          </div>
          ${parsed.aggregateScore ? `
          <div class="kyana-att-hero-col is-right">
            <span class="kyana-att-hero-ratio">${escapeHtml(parsed.aggregateScore)}</span>
            <span class="kyana-att-hero-sub">Total marks</span>
          </div>` : ''}
        </div>`;
        if (parsed.aggregatePct !== null) {
          html += `
          <div class="kyana-att-bar-track" role="progressbar" aria-valuenow="${parsed.aggregatePct}" aria-valuemin="0" aria-valuemax="100">
            <svg class="kyana-att-bar-svg" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
              <rect class="kyana-att-svg-bg" x="0" y="0" width="100" height="8" rx="4"></rect>
              <rect class="kyana-att-svg-fill ${aggLow ? 'is-low' : ''}" x="0" y="0" width="${aggBarW}" height="8" rx="4"></rect>
            </svg>
          </div>`;
        }
        html += `<div class="kyana-att-divider"></div>`;
      }

      html += `<div class="kyana-att-subjects-list">`;
      for (const item of parsed.items) {
        const metaParts = [item.code, item.examType, item.semester ? `Semester ${item.semester}` : null].filter(Boolean).join(' · ');
        const barW = item.pct !== null ? Math.min(100, Math.max(item.pct === 0 ? 2 : 0, item.pct)) : 0;

        html += `
        <div class="kyana-att-subj-item" data-subject-code="${escapeHtml(item.code)}">
          <div class="kyana-att-subj-top">
            <div class="kyana-att-subj-info">
              <span class="kyana-att-subj-name">${escapeHtml(item.subject)}</span>
              <span class="kyana-att-subj-meta">${escapeHtml(metaParts)}</span>
            </div>
            <div class="kyana-att-subj-pct-col">
              <span class="kyana-att-subj-pct ${item.isLow ? 'is-low' : ''}">${escapeHtml(item.scoreLabel)}</span>
              ${item.pct !== null ? `<span class="kyana-att-subj-meta">${escapeHtml(String(item.pct))}%</span>` : ''}
              ${item.isAbsent ? '<span class="kyana-att-low-badge">Absent</span>' : (item.isUnpublished ? '<span class="kyana-att-norecord-pill">Unpublished</span>' : '')}
            </div>
          </div>
          ${item.pct !== null && !item.isUnpublished ? `
          <div class="kyana-att-bar-track" role="progressbar" aria-valuenow="${item.pct}" aria-valuemin="0" aria-valuemax="100">
            <svg class="kyana-att-bar-svg" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
              <rect class="kyana-att-svg-bg" x="0" y="0" width="100" height="8" rx="4"></rect>
              <rect class="kyana-att-svg-fill ${item.isLow ? 'is-low' : ''}" x="0" y="0" width="${barW}" height="8" rx="4"></rect>
            </svg>
          </div>` : ''}
        </div>`;
      }
      html += `</div></div>`;
      return html;
    }

    if (normKind === 'assignments') {
      let html = `<div class="kyana-attendance-card kyana-assignments-card" data-visual-kind="assignments">
        <div class="kyana-att-header">
          <span class="kyana-att-title">Assignments</span>
          <span class="kyana-att-status-pill">${parsed.items.length} ${parsed.items.length === 1 ? 'item' : 'items'}</span>
        </div>
        <div class="kyana-att-subjects-list">`;

      for (const item of parsed.items) {
        const metaParts = [item.subject, item.semester, item.author ? `By ${item.author}` : null, item.deadline ? `Due ${item.deadline}` : null].filter(Boolean).join(' · ');
        const pillHtml = item.isOverdue
          ? `<span class="kyana-att-low-badge">${escapeHtml(item.statusLabel)}</span>`
          : `<span class="kyana-att-norecord-pill">${escapeHtml(item.statusLabel)}</span>`;

        html += `
        <div class="kyana-att-subj-item">
          <div class="kyana-att-subj-top">
            <div class="kyana-att-subj-info">
              <span class="kyana-att-subj-name">${escapeHtml(item.title)}</span>
              <span class="kyana-att-subj-meta">${escapeHtml(metaParts)}</span>
            </div>
            <div class="kyana-att-subj-pct-col">${pillHtml}</div>
          </div>
          ${item.description ? `<div class="kyana-att-item-desc">${escapeHtml(item.description)}</div>` : ''}
          ${item.questions ? `<div class="kyana-att-item-sub">${escapeHtml(item.questions)}</div>` : ''}
          ${item.grade ? `<div class="kyana-att-item-sub">Grade: ${escapeHtml(item.grade)}</div>` : ''}
        </div>`;
      }
      html += `</div></div>`;
      return html;
    }

    if (normKind === 'notes') {
      let html = `<div class="kyana-attendance-card kyana-notes-card" data-visual-kind="notes">
        <div class="kyana-att-header">
          <span class="kyana-att-title">Library resources</span>
          <span class="kyana-att-status-pill">${parsed.items.length} ${parsed.items.length === 1 ? 'file' : 'files'}</span>
        </div>
        <div class="kyana-att-other-list">`;

      for (const item of parsed.items) {
        const metaParts = [item.subject, item.semester, item.chapter, item.folder ? `Folder: ${item.folder}` : null].filter(Boolean).join(' · ');
        html += `
        <div class="kyana-att-other-row">
          <div class="kyana-att-subj-info">
            <span class="kyana-att-subj-name">${escapeHtml(item.title)}</span>
            <span class="kyana-att-subj-meta">${escapeHtml(metaParts)}</span>
          </div>
          <span class="kyana-att-norecord-pill">${escapeHtml(item.fileType || 'PDF')}</span>
        </div>`;
      }
      html += `</div></div>`;
      return html;
    }

    if (normKind === 'routine') {
      let html = `<div class="kyana-attendance-card kyana-routine-card" data-visual-kind="routine">
        <div class="kyana-att-header">
          <span class="kyana-att-title">Schedule & routine</span>
          <span class="kyana-att-status-pill">${parsed.items.length} ${parsed.items.length === 1 ? 'session' : 'sessions'}</span>
        </div>
        <div class="kyana-att-other-list">`;

      for (const item of parsed.items) {
        const metaParts = [item.date, item.day, item.time].filter(Boolean).join(' · ');
        html += `
        <div class="kyana-att-other-row">
          <div class="kyana-att-subj-info">
            <span class="kyana-att-subj-name">${escapeHtml(item.subject)}</span>
            <span class="kyana-att-subj-meta">${escapeHtml(metaParts || item.rawMeta)}</span>
          </div>
          ${item.room ? `<span class="kyana-att-norecord-pill">Room ${escapeHtml(item.room)}</span>` : ''}
        </div>`;
      }
      html += `</div></div>`;
      return html;
    }

    if (normKind === 'notices' || normKind === 'posts' || normKind === 'directory') {
      const headingMap = {
        notices: 'Official notices & announcements',
        posts: 'Campus discussions',
        directory: 'Academic overview'
      };
      let html = `<div class="kyana-attendance-card kyana-${normKind}-card" data-visual-kind="${normKind}">
        <div class="kyana-att-header">
          <span class="kyana-att-title">${escapeHtml(headingMap[normKind] || 'Overview')}</span>
          <span class="kyana-att-status-pill">${parsed.items.length} ${parsed.items.length === 1 ? 'item' : 'items'}</span>
        </div>
        <div class="kyana-att-subjects-list">`;

      for (const item of parsed.items) {
        html += `
        <div class="kyana-att-subj-item">
          <div class="kyana-att-subj-top">
            <div class="kyana-att-subj-info">
              <span class="kyana-att-subj-name">${escapeHtml(item.title)}</span>
              ${item.meta ? `<span class="kyana-att-subj-meta">${escapeHtml(item.meta)}</span>` : ''}
            </div>
            ${item.badge ? `<span class="kyana-att-norecord-pill">${escapeHtml(item.badge)}</span>` : ''}
          </div>
          ${item.summary ? `<div class="kyana-att-item-desc">${escapeHtml(item.summary)}</div>` : ''}
        </div>`;
      }
      html += `</div></div>`;
      return html;
    }

    if (normKind === 'syllabus') {
      const creditVal = parsed.credits || parsed.credit || null;
      const totalHrsVal = parsed.totalHours ? (typeof parsed.totalHours === 'number' ? `${parsed.totalHours} hrs` : String(parsed.totalHours)) : null;
      const objVal = parsed.officialObjectives || parsed.objectives || null;
      const labVal = parsed.officialLab || parsed.labs || null;
      const tbVal = parsed.officialTextbooks || parsed.textbooks || null;

      let html = `<div class="kyana-attendance-card kyana-syllabus-card" data-visual-kind="syllabus">
        <div class="kyana-att-header">
          <div class="kyana-att-title-group">
            <span class="kyana-att-title">${escapeHtml(parsed.courseTitle || 'Course Syllabus')}</span>
            ${parsed.courseCode ? `<span class="kyana-syllabus-code-badge">${escapeHtml(parsed.courseCode)}</span>` : ''}
          </div>
          <div class="kyana-syllabus-badges">
            <span class="kyana-att-status-pill kyana-official-badge">Official Syllabus</span>
            ${parsed.semester ? `<span class="kyana-att-status-pill">Semester ${escapeHtml(String(parsed.semester))}</span>` : ''}
            ${creditVal ? `<span class="kyana-att-status-pill">${escapeHtml(String(creditVal))} Cr</span>` : ''}
            ${parsed.nature ? `<span class="kyana-att-status-pill">${escapeHtml(String(parsed.nature))}</span>` : ''}
            ${totalHrsVal ? `<span class="kyana-att-status-pill">${escapeHtml(totalHrsVal)}</span>` : ''}
          </div>
        </div>`;

      if (parsed.instructor) {
        html += `<div class="kyana-syllabus-instructor">Assigned Faculty: <strong>${escapeHtml(parsed.instructor)}</strong></div>`;
      }

      if (objVal) {
        html += `<div class="kyana-syllabus-objectives">
          <span class="kyana-syllabus-section-label">Official University Syllabus · Learning Objectives</span>
          <p>${escapeHtml(objVal)}</p>
        </div>`;
      }

      html += `<div class="kyana-att-subjects-list">`;
      for (const item of parsed.items) {
        if (item.unitNumber) {
          const hrsText = item.teachingHours || item.hours || null;
          const pctVal = item.sharePct !== undefined && item.sharePct !== null ? item.sharePct : (item.pct !== undefined ? item.pct : null);
          const topicStr = Array.isArray(item.topics)
            ? item.topics.map(t => (t.code ? `${t.code} ${t.text}` : t.text)).join(' · ')
            : (item.topics || '');

          html += `
          <div class="kyana-att-subj-item kyana-syllabus-unit-item">
            <div class="kyana-att-subj-top">
              <div class="kyana-att-subj-info">
                <span class="kyana-att-subj-name">Unit ${escapeHtml(String(item.unitNumber))}: ${escapeHtml(item.title)}</span>
                ${hrsText ? `<span class="kyana-att-subj-meta">${escapeHtml(String(hrsText))}${pctVal ? ` · ${pctVal}% of course hours` : ''}</span>` : (item.workloadShare ? `<span class="kyana-att-subj-meta">${escapeHtml(String(item.workloadShare))}</span>` : '')}
              </div>
              ${pctVal ? `<span class="kyana-att-subj-pct">${escapeHtml(String(pctVal))}%</span>` : ''}
            </div>
            ${pctVal ? `
            <div class="kyana-att-bar-track" role="progressbar" aria-valuenow="${pctVal}" aria-valuemin="0" aria-valuemax="100">
              <svg class="kyana-att-bar-svg" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                <rect class="kyana-att-svg-bg" x="0" y="0" width="100" height="8" rx="4"></rect>
                <rect class="kyana-att-svg-fill" x="0" y="0" width="${Math.min(100, Math.max(4, pctVal))}" height="8" rx="4"></rect>
              </svg>
            </div>` : ''}
            ${topicStr ? `<div class="kyana-syllabus-unit-topics">${escapeHtml(topicStr)}</div>` : ''}
          </div>`;
        } else {
          html += `
          <div class="kyana-att-subj-item">
            <div class="kyana-att-subj-top">
              <div class="kyana-att-subj-info">
                <span class="kyana-att-subj-name">${escapeHtml(item.code)}: ${escapeHtml(item.title)}</span>
                ${item.credits ? `<span class="kyana-att-subj-meta">${escapeHtml(String(item.credits))} · ${escapeHtml(item.nature || '')}</span>` : ''}
              </div>
              ${item.details ? `<span class="kyana-att-norecord-pill">${escapeHtml(item.details)}</span>` : ''}
            </div>
          </div>`;
        }
      }
      html += `</div>`;

      if (parsed.connections) {
        html += `<div class="kyana-syllabus-footer-section">
          <span class="kyana-syllabus-section-label">AI Study Guide · Unit Progression</span>
          <p class="kyana-syllabus-footer-text"><strong>Builds On:</strong> ${escapeHtml(parsed.connections.buildsOn || '')} &nbsp;·&nbsp; <strong>Leads To:</strong> ${escapeHtml(parsed.connections.leadsTo || '')}</p>
        </div>`;
      }

      if (labVal) {
        html += `<div class="kyana-syllabus-footer-section">
          <span class="kyana-syllabus-section-label">Official University Syllabus · Laboratory Practicals</span>
          <p class="kyana-syllabus-footer-text">${escapeHtml(labVal)}</p>
        </div>`;
      }
      if (tbVal) {
        html += `<div class="kyana-syllabus-footer-section">
          <span class="kyana-syllabus-section-label">Official University Syllabus · Recommended Textbooks</span>
          <p class="kyana-syllabus-footer-text">${escapeHtml(tbVal)}</p>
        </div>`;
      }

      if (parsed.aiGuidance) {
        const g = parsed.aiGuidance;
        html += `<div class="kyana-syllabus-ai-guide">
          <div class="kyana-syllabus-ai-header">
            <span class="kyana-syllabus-section-label">AI Study Guide & Learning Roadmap</span>
            <span class="kyana-att-norecord-pill">Advisory · Not Official Requirement</span>
          </div>
          ${Array.isArray(g.prerequisites) && g.prerequisites.length ? `<div class="kyana-ai-guide-row"><strong>Prerequisites:</strong> ${escapeHtml(g.prerequisites.join(' · '))}</div>` : ''}
          ${Array.isArray(g.keyConcepts) && g.keyConcepts.length ? `<div class="kyana-ai-guide-row"><strong>High-Focus Concepts:</strong> ${escapeHtml(g.keyConcepts.join(' · '))}</div>` : ''}
          ${Array.isArray(g.studySequence) && g.studySequence.length ? `<div class="kyana-ai-guide-row"><strong>Suggested Study Sequence:</strong> ${escapeHtml(g.studySequence.join(' → '))}</div>` : ''}
          ${Array.isArray(g.studyTips) && g.studyTips.length ? `<div class="kyana-ai-guide-row"><strong>Study Tips:</strong> ${escapeHtml(g.studyTips.join(' '))}</div>` : ''}
        </div>`;
      }

      html += `</div>`;
      return html;
    }

    if (normKind === 'quiz') {
      const questionsList = Array.isArray(parsed.questions) && parsed.questions.length > 0
        ? parsed.questions
        : [{
            id: 'q1',
            question: parsed.question || '',
            options: Array.isArray(parsed.options) ? parsed.options.map(o => typeof o === 'string' ? o : `${o.key}) ${o.text}`) : [],
            correctIndex: 0,
            answer: parsed.answer || '',
            explanation: parsed.explanation || ''
          }];

      let html = `<div class="kyana-attendance-card kyana-quiz-card" data-visual-kind="quiz">
        <div class="kyana-att-header">
          <span class="kyana-att-title">${escapeHtml(parsed.title || 'Interactive Self-Assessment Quiz')}</span>
          <span class="kyana-att-status-pill">${questionsList.length} ${questionsList.length === 1 ? 'question' : 'questions'}</span>
        </div>`;

      questionsList.forEach((q, qIdx) => {
        const opts = Array.isArray(q.options) ? q.options : [];
        const correctIdx = typeof q.correctIndex === 'number' ? q.correctIndex : -1;
        const correctAnswerText = q.answer || (correctIdx >= 0 && opts[correctIdx] ? opts[correctIdx] : '');

        html += `<div class="kyana-quiz-body" data-quiz-index="${qIdx}">
          <div class="kyana-quiz-question">${questionsList.length > 1 ? `<strong>Q${qIdx + 1}.</strong> ` : ''}${escapeHtml(q.question || '')}</div>
          <div class="kyana-quiz-options">`;

        opts.forEach((opt, oIdx) => {
          const optStr = typeof opt === 'string' ? opt : `${opt.key}) ${opt.text}`;
          const isCorrectOpt = oIdx === correctIdx;
          html += `<button type="button" class="kyana-quiz-option" data-correct="${isCorrectOpt ? 'true' : 'false'}" onclick="(function(btn){
            var parent = btn.closest('.kyana-quiz-body');
            if (!parent) return;
            parent.querySelectorAll('.kyana-quiz-option').forEach(function(el){ el.classList.remove('is-selected', 'is-correct', 'is-wrong'); });
            btn.classList.add('is-selected');
            btn.classList.add(btn.getAttribute('data-correct') === 'true' ? 'is-correct' : 'is-wrong');
            var rev = parent.querySelector('.kyana-quiz-reveal-content');
            if (rev && btn.getAttribute('data-correct') === 'true') { rev.style.display = 'block'; }
          })(this)">
            <span class="kyana-quiz-opt-text">${escapeHtml(optStr)}</span>
          </button>`;
        });

        html += `</div>
          <div class="kyana-quiz-action-bar">
            <button type="button" class="kyana-quiz-reveal-btn" onclick="(function(btn){
              var c = btn.closest('.kyana-quiz-body').querySelector('.kyana-quiz-reveal-content');
              if (c) {
                var isHidden = c.style.display === 'none';
                c.style.display = isHidden ? 'block' : 'none';
                btn.textContent = isHidden ? 'Hide Explanation' : 'Reveal Answer & Explanation';
              }
            })(this)">Reveal Answer & Explanation</button>
          </div>
          <div class="kyana-quiz-reveal-content" style="display: none;">
            <div class="kyana-quiz-correct-answer">
              <strong>Correct Answer:</strong> ${escapeHtml(correctAnswerText)}
            </div>
            ${q.explanation ? `<div class="kyana-quiz-explanation">${escapeHtml(q.explanation)}</div>` : ''}
          </div>
        </div>`;
      });

      html += `</div>`;
      return html;
    }

    if (normKind === 'diagram') {
      let html = `<div class="kyana-attendance-card kyana-diagram-card" data-visual-kind="diagram">
        <div class="kyana-att-header">
          <div class="kyana-att-title-group">
            <span class="kyana-att-title">${escapeHtml(parsed.title || 'Architecture & Concept Diagram')}</span>
            ${parsed.subtitle ? `<span class="kyana-att-subj-meta">${escapeHtml(parsed.subtitle)}</span>` : ''}
          </div>
          <span class="kyana-att-status-pill">Concept Diagram</span>
        </div>`;

      if (Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
        html += `<div class="kyana-diagram-nodes-flow">`;
        parsed.nodes.forEach((node, idx) => {
          html += `
          <div class="kyana-diagram-node-box">
            <div class="kyana-diagram-node-title">${escapeHtml(node.label || node.id || `Stage ${idx + 1}`)}</div>
            ${node.detail ? `<div class="kyana-diagram-node-detail">${escapeHtml(node.detail)}</div>` : ''}
          </div>`;
          if (idx < parsed.nodes.length - 1) {
            html += `<div class="kyana-diagram-arrow" aria-hidden="true">↓</div>`;
          }
        });
        html += `</div>`;
      } else if (parsed.diagramText) {
        html += `<div class="kyana-diagram-content"><pre class="kyana-diagram-pre"><code>${escapeHtml(parsed.diagramText)}</code></pre></div>`;
      }

      html += `</div>`;
      return html;
    }

    if (normKind === 'graph') {
      const series = Array.isArray(parsed.series) ? parsed.series : parsed.items;
      let html = `<div class="kyana-attendance-card kyana-graph-card" data-visual-kind="graph">
        <div class="kyana-att-header">
          <div class="kyana-att-title-group">
            <span class="kyana-att-title">${escapeHtml(parsed.title || 'Quantitative & Complexity Graph')}</span>
            ${parsed.subtitle ? `<span class="kyana-att-subj-meta">${escapeHtml(parsed.subtitle)}</span>` : ''}
          </div>
          <span class="kyana-att-status-pill">Visual Plot</span>
        </div>
        <div class="kyana-att-subjects-list">`;

      for (const s of series) {
        const valNum = Number(s.value ?? s.pct ?? 50);
        const barW = Math.min(100, Math.max(4, valNum));
        html += `
        <div class="kyana-att-subj-item">
          <div class="kyana-att-subj-top">
            <span class="kyana-att-subj-name">${escapeHtml(s.label || s.title || '')}</span>
            <span class="kyana-att-subj-pct">${escapeHtml(s.displayValue || `${valNum}`)}</span>
          </div>
          <div class="kyana-att-bar-track" role="progressbar" aria-valuenow="${barW}" aria-valuemin="0" aria-valuemax="100">
            <svg class="kyana-att-bar-svg" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
              <rect class="kyana-att-svg-bg" x="0" y="0" width="100" height="8" rx="4"></rect>
              <rect class="kyana-att-svg-fill" x="0" y="0" width="${barW}" height="8" rx="4"></rect>
            </svg>
          </div>
        </div>`;
      }

      if (parsed.xAxisLabel || parsed.yAxisLabel) {
        html += `<div class="kyana-graph-axes-meta">
          ${parsed.xAxisLabel ? `<span>X-Axis: ${escapeHtml(parsed.xAxisLabel)}</span>` : ''}
          ${parsed.yAxisLabel ? `<span>Y-Axis: ${escapeHtml(parsed.yAxisLabel)}</span>` : ''}
        </div>`;
      }

      html += `</div></div>`;
      return html;
    }

    if (normKind === 'flowchart' || normKind === 'trace') {
      const steps = Array.isArray(parsed.steps) && parsed.steps.length > 0
        ? parsed.steps.map((s, idx) => ({
            label: `Step ${s.step || idx + 1}`,
            action: s.action || s.label || `Step ${idx + 1}`,
            state: Array.isArray(s.state) ? s.state : (s.content ? [s.content] : []),
            highlight: s.highlight || null
          }))
        : parsed.items.map((item, idx) => ({
            label: item.label || `Step ${idx + 1}`,
            action: item.label || `Step ${idx + 1}`,
            state: [item.content || ''],
            highlight: null
          }));

      let html = `<div class="kyana-attendance-card kyana-trace-card" data-visual-kind="${normKind}" data-active-step="all">
        <div class="kyana-att-header">
          <div class="kyana-att-title-group">
            <span class="kyana-att-title">${escapeHtml(parsed.title || 'Step-by-step execution trace')}</span>
            ${parsed.subtitle ? `<span class="kyana-att-subj-meta">${escapeHtml(parsed.subtitle)}</span>` : ''}
          </div>
          <div class="kyana-syllabus-badges">
            ${parsed.complexity?.time ? `<span class="kyana-att-status-pill">Time: ${escapeHtml(parsed.complexity.time)}</span>` : ''}
            ${parsed.complexity?.space ? `<span class="kyana-att-status-pill">Space: ${escapeHtml(parsed.complexity.space)}</span>` : ''}
            <span class="kyana-att-status-pill">${steps.length} ${steps.length === 1 ? 'step' : 'steps'}</span>
          </div>
        </div>
        <div class="kyana-trace-controls">
          <button type="button" class="kyana-trace-ctrl-btn" onclick="(function(btn){
            var card = btn.closest('.kyana-trace-card');
            if (!card) return;
            var items = card.querySelectorAll('.kyana-trace-step-item');
            var cur = card.getAttribute('data-active-step');
            var idx = cur === 'all' ? 0 : Math.max(0, parseInt(cur, 10) - 1);
            card.setAttribute('data-active-step', String(idx));
            items.forEach(function(el, i){ el.style.display = i === idx ? 'flex' : 'none'; });
          })(this)">◀ Step Back</button>
          <button type="button" class="kyana-trace-ctrl-btn" onclick="(function(btn){
            var card = btn.closest('.kyana-trace-card');
            if (!card) return;
            var items = card.querySelectorAll('.kyana-trace-step-item');
            var cur = card.getAttribute('data-active-step');
            var idx = cur === 'all' ? 0 : Math.min(items.length - 1, parseInt(cur, 10) + 1);
            card.setAttribute('data-active-step', String(idx));
            items.forEach(function(el, i){ el.style.display = i === idx ? 'flex' : 'none'; });
          })(this)">Step Forward ▶</button>
          <button type="button" class="kyana-trace-ctrl-btn" onclick="(function(btn){
            var card = btn.closest('.kyana-trace-card');
            if (!card) return;
            card.setAttribute('data-active-step', 'all');
            card.querySelectorAll('.kyana-trace-step-item').forEach(function(el){ el.style.display = 'flex'; });
          })(this)">Show All Steps</button>
        </div>
        <div class="kyana-trace-list">`;

      for (const item of steps) {
        html += `
        <div class="kyana-trace-step-item">
          <span class="kyana-trace-step-badge">${escapeHtml(item.label)}</span>
          <div class="kyana-trace-step-body">
            <div class="kyana-trace-step-action">${escapeHtml(item.action)}</div>
            ${item.state.length > 0 ? `<div class="kyana-trace-state-pills">${item.state.map(st => `<code class="kyana-trace-state-pill">${escapeHtml(st)}</code>`).join('')}</div>` : ''}
            ${item.highlight ? `<div class="kyana-trace-step-highlight">${escapeHtml(item.highlight)}</div>` : ''}
          </div>
        </div>`;
      }
      html += `</div></div>`;
      return html;
    }

    if (normKind === 'comparison') {
      let html = `<div class="kyana-attendance-card kyana-comparison-card" data-visual-kind="comparison">
        <div class="kyana-att-header">
          <span class="kyana-att-title">Feature & Concept Comparison</span>
          <span class="kyana-att-status-pill">${parsed.items.length} criteria</span>
        </div>
        <div class="kyana-comparison-list">`;
      for (const item of parsed.items) {
        html += `
        <div class="kyana-comparison-row">
          <div class="kyana-comp-criteria">${escapeHtml(item.col1)}</div>
          <div class="kyana-comp-val kyana-comp-val1">${escapeHtml(item.col2)}</div>
          ${item.col3 ? `<div class="kyana-comp-val kyana-comp-val2">${escapeHtml(item.col3)}</div>` : ''}
        </div>`;
      }
      html += `</div></div>`;
      return html;
    }

    if (normKind === 'roadmap') {
      const roadItems = Array.isArray(parsed.steps) && parsed.steps.length > 0
        ? parsed.steps.map(s => ({ done: Boolean(s.done), title: s.title || '', tag: s.phase || '', desc: s.detail || '' }))
        : parsed.items;

      let html = `<div class="kyana-attendance-card kyana-roadmap-card" data-visual-kind="roadmap">
        <div class="kyana-att-header">
          <div class="kyana-att-title-group">
            <span class="kyana-att-title">${escapeHtml(parsed.title || 'Learning & Revision Roadmap')}</span>
            ${parsed.subtitle ? `<span class="kyana-att-subj-meta">${escapeHtml(parsed.subtitle)}</span>` : ''}
          </div>
          <span class="kyana-att-status-pill">${roadItems.length} stages</span>
        </div>
        <div class="kyana-roadmap-list">`;
      for (const item of roadItems) {
        html += `
        <div class="kyana-roadmap-item ${item.done ? 'is-completed' : 'is-pending'}" onclick="(function(el){
          el.classList.toggle('is-completed');
          var dot = el.querySelector('.kyana-roadmap-status-dot');
          if (dot) dot.textContent = el.classList.contains('is-completed') ? '✓' : '○';
        })(this)">
          <div class="kyana-roadmap-status-dot">${item.done ? '✓' : '○'}</div>
          <div class="kyana-roadmap-info">
            <div class="kyana-roadmap-title-row">
              ${item.tag ? `<span class="kyana-roadmap-tag">${escapeHtml(item.tag)}</span>` : ''}
              <span class="kyana-roadmap-title">${escapeHtml(item.title)}</span>
            </div>
            ${item.desc ? `<span class="kyana-roadmap-desc">${escapeHtml(item.desc)}</span>` : ''}
          </div>
        </div>`;
      }
      html += `</div></div>`;
      return html;
    }

    if (normKind === 'complexity') {
      let html = `<div class="kyana-attendance-card kyana-complexity-card" data-visual-kind="complexity">
        <div class="kyana-att-header">
          <span class="kyana-att-title">Asymptotic Time & Space Complexity</span>
          <span class="kyana-att-status-pill">Big-O</span>
        </div>
        <div class="kyana-complexity-list">`;
      for (const item of parsed.items) {
        html += `
        <div class="kyana-complexity-row">
          <span class="kyana-comp-op">${escapeHtml(item.label)}</span>
          <div class="kyana-comp-metrics">
            ${item.best ? `<span class="kyana-comp-badge">Best: ${escapeHtml(item.best)}</span>` : ''}
            ${item.average ? `<span class="kyana-comp-badge">Avg: ${escapeHtml(item.average)}</span>` : ''}
            ${item.worst ? `<span class="kyana-comp-badge">Worst: ${escapeHtml(item.worst)}</span>` : ''}
            ${item.space ? `<span class="kyana-comp-badge">Space: ${escapeHtml(item.space)}</span>` : ''}
          </div>
        </div>`;
      }
      html += `</div></div>`;
      return html;
    }

    return '';
  }

  function fallbackMarkdown(text) {
    if (!text || !String(text).trim()) return '';

    function parseInline(raw) {
      if (!raw) return '';
      const inlinePlaceholders = [];
      // 1. Protect inline code (`...`)
      let s = String(raw).replace(/`([^`\n]+)`/g, (_, c) => {
        const idx = inlinePlaceholders.length;
        inlinePlaceholders.push(`<code>${escapeHtml(c)}</code>`);
        return `\x01INLINE_${idx}\x02`;
      });

      // 2. Protect inline LaTeX (\(...\) and $...$)
      s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, expr) => {
        const idx = inlinePlaceholders.length;
        inlinePlaceholders.push(`<span class="kyana-math-inline">$${escapeHtml(expr.trim())}$</span>`);
        return `\x01INLINE_${idx}\x02`;
      });
      s = s.replace(/(^|[^$\\])\$(?!\$)([^$\n]+?)\$(?!\$)/g, (match, prefix, expr) => {
        if (/^\d+(?:[.,]\d+)?$/.test(expr.trim())) return match;
        const idx = inlinePlaceholders.length;
        inlinePlaceholders.push(`<span class="kyana-math-inline">$${escapeHtml(expr.trim())}$</span>`);
        return `${prefix}\x01INLINE_${idx}\x02`;
      });

      // Escape raw HTML for strict XSS prevention
      s = escapeHtml(s);

      // Bold + Italic: ***text***
      s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');

      // Bold: **text** or __text__
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');

      // Italic: *text* or _text_
      s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      s = s.replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');

      // Strikethrough: ~~text~~
      s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

      // Links: [text](url) — supports https://, /path, and relative campus page links
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+|\/[\w./#%?=&-]+|[\w-]+\.html[^\s\)]*)\)/gi, (_, title, url) => {
        const safe = safeLink(url);
        if (!safe) return title;
        return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${title}</a>`;
      });

      // Standalone URLs: https://...
      s = s.replace(/(^|[^"'>])(https?:\/\/[^\s<)]+)/gi, (_, prefix, url) => {
        const safe = safeLink(url, true);
        if (!safe) return prefix + url;
        return `${prefix}<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
      });

      // Restore inline code and math
      s = s.replace(/\x01INLINE_(\d+)\x02/g, (_, idx) => inlinePlaceholders[Number(idx)] || '');
      return s;
    }

    function isTableDelimiter(str) {
      if (!str || !str.includes('|')) return false;
      const cells = str.trim().replace(/^\||\|$/g, '').split('|');
      if (cells.length === 0) return false;
      return cells.every(c => /^\s*:?-{1,}:?\s*$/.test(c));
    }

    function splitTableRow(rowStr) {
      const safe = (rowStr || '').trim().replace(/\\\|/g, '\x00PIPE\x00');
      const unbordered = safe.replace(/^\||\|$/g, '');
      return unbordered.split('|').map(c => c.replace(/\x00PIPE\x00/g, '|').trim());
    }

    const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const codeBlocks = [];
    const mathBlocks = [];
    let textWithoutCode = normalized.replace(/(^|\n)(`{3,}|~{3,})([\w+#.-]*)[ \t]*\n([\s\S]*?)(?:\n\2[ \t]*(?=\n|$)|$)/g, (match, prefix, fence, lang, code) => {
      const index = codeBlocks.length;
      codeBlocks.push({
        lang: (lang || '').trim().toLowerCase() || 'code',
        code: (code || '').replace(/\n+$/, '')
      });
      return `${prefix || ''}\x01BLOCK_CODE_${index}\x02\n`;
    });

    // Extract display LaTeX blocks ($$...$$ and \[...\]) so multiline equations are preserved
    textWithoutCode = textWithoutCode
      .replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => {
        const idx = mathBlocks.length;
        mathBlocks.push(expr.trim());
        return `\n\x01BLOCK_MATH_${idx}\x02\n`;
      })
      .replace(/\\\[([\s\S]*?)\\\]/g, (_, expr) => {
        const idx = mathBlocks.length;
        mathBlocks.push(expr.trim());
        return `\n\x01BLOCK_MATH_${idx}\x02\n`;
      });

    const lines = textWithoutCode.split('\n');
    const output = [];
    const listStack = []; // [{ type: 'ul'|'ol', indent: number }]
    let inQuote = false;
    let quoteLines = [];
    let paraLines = [];

    const flushPara = () => {
      if (paraLines.length > 0) {
        const pText = paraLines.map(l => parseInline(l)).join('<br>');
        output.push(`<p>${pText}</p>`);
        paraLines = [];
      }
    };

    const flushQuote = () => {
      if (inQuote) {
        const qText = quoteLines.map(l => parseInline(l)).join('<br>');
        output.push(`<blockquote>${qText}</blockquote>`);
        quoteLines = [];
        inQuote = false;
      }
    };

    const flushList = () => {
      while (listStack.length > 0) {
        const top = listStack.pop();
        output.push(`</${top.type}>`);
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Fenced Code Block Placeholder
      const codeMatch = trimmed.match(/^\x01BLOCK_CODE_(\d+)\x02$/);
      if (codeMatch) {
        flushQuote();
        flushList();
        flushPara();
        const block = codeBlocks[Number(codeMatch[1])];
        if (block) {
          if (VISUAL_BLOCK_KINDS.has(block.lang)) {
            const visualHtml = renderKyanaVisualBlockHtml(block.lang, block.code);
            if (visualHtml) {
              output.push(visualHtml);
              continue;
            }
          }
          output.push(`<pre><code class="language-${escapeHtml(block.lang)}">${escapeHtml(block.code)}</code></pre>`);
        }
        continue;
      }

      // Display Math Block Placeholder
      const mathMatch = trimmed.match(/^\x01BLOCK_MATH_(\d+)\x02$/);
      if (mathMatch) {
        flushQuote();
        flushList();
        flushPara();
        const expr = mathBlocks[Number(mathMatch[1])];
        if (expr !== undefined) {
          output.push(`<div class="kyana-math-block">$$${escapeHtml(expr)}$$</div>`);
        }
        continue;
      }

      // Horizontal Rule (--- or *** or ___)
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushQuote();
        flushList();
        flushPara();
        output.push('<hr class="kyana-divider">');
        continue;
      }

      // Markdown Table: Header row followed by delimiter row
      if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
        flushQuote();
        flushList();
        flushPara();

        const headerCells = splitTableRow(line);
        const alignCells = splitTableRow(lines[i + 1]);
        const alignments = alignCells.map(c => {
          const t = c.trim();
          const left = t.startsWith(':');
          const right = t.endsWith(':');
          if (left && right) return 'center';
          if (right) return 'right';
          return 'left';
        });

        const dataRows = [];
        let j = i + 2;
        while (j < lines.length) {
          const dLine = lines[j].trim();
          if (!dLine || !dLine.includes('|') || isTableDelimiter(dLine)) break;
          dataRows.push(splitTableRow(dLine));
          j++;
        }
        i = j - 1; // Advance loop index

        let tableHtml = '<div class="kyana-table-wrapper"><table class="kyana-table"><thead><tr>';
        for (let c = 0; c < headerCells.length; c++) {
          const align = alignments[c] || 'left';
          tableHtml += `<th style="text-align: ${align};">${parseInline(headerCells[c])}</th>`;
        }
        tableHtml += '</tr></thead><tbody>';

        for (const row of dataRows) {
          tableHtml += '<tr>';
          for (let c = 0; c < headerCells.length; c++) {
            const align = alignments[c] || 'left';
            tableHtml += `<td style="text-align: ${align};">${parseInline(row[c] || '')}</td>`;
          }
          tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table></div>';
        output.push(tableHtml);
        continue;
      }

      // Headings: #, ##, ###, ####
      const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        flushQuote();
        flushList();
        flushPara();
        const level = hMatch[1].length;
        output.push(`<h${level}>${parseInline(hMatch[2])}</h${level}>`);
        continue;
      }

      // Blockquote: > text
      const qMatch = line.match(/^>\s?(.*)$/);
      if (qMatch) {
        flushList();
        flushPara();
        inQuote = true;
        quoteLines.push(qMatch[1]);
        continue;
      } else {
        flushQuote();
      }

      // Ordered or Unordered list item (supports nested indentation)
      const listMatch = line.match(/^(\s*)([\*\-\+]|\d+\.)\s+(.*)$/);
      if (listMatch) {
        flushQuote();
        flushPara();
        const indent = listMatch[1].replace(/\t/g, '  ').length;
        const listType = /^\d+\./.test(listMatch[2]) ? 'ol' : 'ul';
        const itemContent = parseInline(listMatch[3]);

        while (listStack.length > 0 && indent < listStack[listStack.length - 1].indent) {
          const popped = listStack.pop();
          output.push(`</${popped.type}>`);
        }

        if (listStack.length === 0 || indent > listStack[listStack.length - 1].indent) {
          output.push(`<${listType}>`);
          listStack.push({ type: listType, indent });
        } else if (listStack[listStack.length - 1].type !== listType) {
          const popped = listStack.pop();
          output.push(`</${popped.type}>`);
          output.push(`<${listType}>`);
          listStack.push({ type: listType, indent });
        }

        output.push(`<li>${itemContent}</li>`);
        continue;
      }

      // Non-list line
      flushList();

      // Empty line separates paragraphs
      if (!trimmed) {
        flushPara();
        continue;
      }

      // Regular line in paragraph
      paraLines.push(line);
    }

    flushQuote();
    flushList();
    flushPara();

    return output.join('');
  }

  function normalizeLatexDelimiters(text) {
    if (!text) return '';
    const { text: protectedText, tokenMap } = protectCodeBlocks(text);
    const transformed = protectedText
      .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
      .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
    return restoreCodeBlocks(transformed, tokenMap);
  }

  // Safety Assertion Guardian: Ensures placeholder tokens NEVER reach user-visible UI
  function assertAndCleanPlaceholders(target) {
    if (!target) return target;
    const tokenPattern = /___(?:CHAT_TOK|KYANA_PROTECTED_CODE)_\d+___/g;

    if (typeof target === 'string') {
      if (tokenPattern.test(target)) {
        console.warn('[Kyana Renderer Safety] Detected unprocessed placeholder token in output string. Cleaning...');
        return target.replace(tokenPattern, '');
      }
      return target;
    }

    if (target && target.innerHTML && tokenPattern.test(target.innerHTML)) {
      console.warn('[Kyana Renderer Safety] Detected unprocessed placeholder token in rendered DOM. Cleaning...');
      target.innerHTML = target.innerHTML.replace(tokenPattern, '');
    }
    return target;
  }

  // High-Fidelity Syntax Highlighting Engine (Single-pass lexer, zero temporary placeholders, zero double-escaping)
  function highlightChatCode(rawCode, lang) {
    if (!rawCode) return '';
    const l = (lang || '').toLowerCase();

    // 1. If Prism is loaded and supports the language, use it safely
    const prismLangMap = {
      'c': 'c', 'cpp': 'cpp', 'c++': 'cpp',
      'java': 'java', 'python': 'python', 'py': 'python',
      'javascript': 'javascript', 'js': 'javascript', 'typescript': 'javascript', 'ts': 'javascript',
      'php': 'php',
      'html': 'markup', 'markup': 'markup', 'xml': 'markup',
      'css': 'css', 'json': 'json', 'sql': 'sql', 'bash': 'bash', 'sh': 'bash'
    };
    const pLang = prismLangMap[l] || l;
    if (typeof Prism !== 'undefined' && Prism.languages && Prism.languages[pLang]) {
      try {
        const highlighted = Prism.highlight(rawCode, Prism.languages[pLang], pLang);
        if (highlighted && typeof highlighted === 'string') {
          return assertAndCleanPlaceholders(highlighted);
        }
      } catch (_) { }
    }

    // 2. High-fidelity sequential lexer
    const isHtml = l === 'html' || l === 'xml' || l === 'markup';
    const isPy = l === 'python' || l === 'py';
    const isPhp = l === 'php';
    const isCpp = l === 'cpp' || l === 'c++';
    const isC = l === 'c' || isCpp;

    const keywords = new Set([
      'public', 'private', 'protected', 'class', 'interface', 'static', 'void', 'int',
      'float', 'double', 'char', 'boolean', 'bool', 'long', 'short', 'unsigned', 'signed',
      'String', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
      'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package',
      'def', 'elif', 'from', 'as', 'with', 'lambda', 'yield', 'struct', 'typedef', 'const',
      'virtual', 'override', 'namespace', 'using', 'auto', 'sizeof', 'final', 'abstract',
      'let', 'var', 'function', 'async', 'await', 'select', 'where', 'insert',
      'delete', 'update', 'into', 'values', 'set', 'null', 'undefined', 'true', 'false',
      'True', 'False', 'None', 'self', 'this', 'super', 'template', 'typename', 'pass', 'raise',
      'echo', 'foreach', 'endforeach', 'elseif', 'endif', 'array', 'use', 'trait', 'implements',
      'extends', 'parent', 'global', 'isset', 'empty', 'unset', 'die', 'exit', 'require', 'require_once', 'include_once', 'fn', 'match'
    ]);

    const builtins = new Set([
      'System', 'out', 'println', 'print', 'Scanner', 'cin', 'cout', 'endl', 'cerr',
      'vector', 'string', 'map', 'set', 'list', 'pair', 'printf', 'scanf', 'NULL', 'nullptr',
      'console', 'log', 'warn', 'error', 'document', 'window', 'Math', 'JSON', 'Promise',
      'main', 'len', 'range', 'input', 'count', 'strlen', 'json_encode', 'json_decode', 'PDO'
    ]);

    let html = '';
    let i = 0;
    const len = rawCode.length;

    while (i < len) {
      // Line comments
      if (rawCode.startsWith('//', i)) {
        let end = rawCode.indexOf('\n', i);
        if (end === -1) end = len;
        html += `<span class="token comment">${escapeHtml(rawCode.slice(i, end))}</span>`;
        i = end;
        continue;
      }

      // Block comments
      if (rawCode.startsWith('/*', i)) {
        let end = rawCode.indexOf('*/', i);
        if (end === -1) end = len;
        else end += 2;
        html += `<span class="token comment">${escapeHtml(rawCode.slice(i, end))}</span>`;
        i = end;
        continue;
      }

      // Hash comments (Python/Shell/Ruby - not C/C++ preprocessor)
      if (rawCode[i] === '#' && (isPy || (!isC && !rawCode.slice(i).match(/^#(?:include|define|ifdef|ifndef|endif|pragma)\b/)))) {
        let end = rawCode.indexOf('\n', i);
        if (end === -1) end = len;
        html += `<span class="token comment">${escapeHtml(rawCode.slice(i, end))}</span>`;
        i = end;
        continue;
      }

      // C/C++ Preprocessor Directives (#include <stdio.h>, #define, etc.)
      if (rawCode[i] === '#' && (isC || !l)) {
        const rest = rawCode.slice(i);
        const match = rest.match(/^#(?:include|define|ifdef|ifndef|endif|pragma|undef|if|elif|else)\b[^\r\n]*/);
        if (match) {
          const fullDirective = match[0];
          const dirParts = fullDirective.match(/^(#(?:include|define|ifdef|ifndef|endif|pragma|undef|if|elif|else)\b)(\s*)(<[^>]+>|"[^"]+")?(.*)$/);
          if (dirParts) {
            html += `<span class="token keyword directive">${escapeHtml(dirParts[1])}</span>`;
            if (dirParts[2]) html += dirParts[2];
            if (dirParts[3]) html += `<span class="token string">${escapeHtml(dirParts[3])}</span>`;
            if (dirParts[4]) html += escapeHtml(dirParts[4]);
          } else {
            html += `<span class="token keyword directive">${escapeHtml(fullDirective)}</span>`;
          }
          i += match[0].length;
          continue;
        }
      }

      // Strings & Characters
      if (rawCode[i] === '"' || rawCode[i] === "'" || rawCode[i] === '`') {
        const quote = rawCode[i];
        let j = i + 1;
        let escaped = false;
        while (j < len) {
          if (escaped) {
            escaped = false;
          } else if (rawCode[j] === '\\') {
            escaped = true;
          } else if (rawCode[j] === quote) {
            j++;
            break;
          } else if (rawCode[j] === '\n' && quote !== '`') {
            break;
          }
          j++;
        }
        html += `<span class="token string">${escapeHtml(rawCode.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      // PHP open/close tags (<?php, <?= , ?>)
      if ((isPhp || rawCode.startsWith('<?php', i)) && (rawCode.startsWith('<?php', i) || rawCode.startsWith('<?=', i) || rawCode.startsWith('?>', i))) {
        const phpTag = rawCode.startsWith('<?php', i) ? '<?php' : (rawCode.startsWith('<?=', i) ? '<?=' : '?>');
        html += `<span class="token keyword directive">${escapeHtml(phpTag)}</span>`;
        i += phpTag.length;
        continue;
      }

      // PHP / Shell Variables ($var)
      if (rawCode[i] === '$' && /^[a-zA-Z_]\w*/.test(rawCode.slice(i + 1))) {
        const varMatch = rawCode.slice(i).match(/^\$[a-zA-Z_]\w*/);
        if (varMatch) {
          html += `<span class="token variable">${escapeHtml(varMatch[0])}</span>`;
          i += varMatch[0].length;
          continue;
        }
      }

      // HTML/XML Tags
      if (isHtml && rawCode[i] === '<') {
        const tagMatch = rawCode.slice(i).match(/^<\/?([a-zA-Z][\w:-]*)/);
        if (tagMatch) {
          html += `<span class="token punctuation">&lt;${tagMatch[0].startsWith('</') ? '/' : ''}</span><span class="token tag">${escapeHtml(tagMatch[1])}</span>`;
          i += tagMatch[0].length;
          continue;
        }
      }

      // Numbers
      const numMatch = rawCode.slice(i).match(/^(?:0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?:[fFuUlL]+)?)\b/);
      if (numMatch && (i === 0 || !/[a-zA-Z0-9_]/.test(rawCode[i - 1]))) {
        html += `<span class="token number">${escapeHtml(numMatch[0])}</span>`;
        i += numMatch[0].length;
        continue;
      }

      // Identifiers / Keywords / Builtins / Function calls
      const identMatch = rawCode.slice(i).match(/^[a-zA-Z_]\w*/);
      if (identMatch) {
        const word = identMatch[0];
        const afterPos = i + word.length;
        const isCall = /^\s*\(/.test(rawCode.slice(afterPos));

        if (keywords.has(word)) {
          html += `<span class="token keyword">${escapeHtml(word)}</span>`;
        } else if (builtins.has(word)) {
          html += `<span class="token class-name">${escapeHtml(word)}</span>`;
        } else if (isCall) {
          html += `<span class="token function">${escapeHtml(word)}</span>`;
        } else {
          html += escapeHtml(word);
        }
        i += word.length;
        continue;
      }

      // Multi-character operators
      const multiOpMatch = rawCode.slice(i).match(/^(?:&&|\|\||==|!=|<=|>=|<<|>>|\+=|-=|\*=|\/=|%=|->|\+\+|--|::|=>|\*\*)/);
      if (multiOpMatch) {
        html += `<span class="token operator">${escapeHtml(multiOpMatch[0])}</span>`;
        i += multiOpMatch[0].length;
        continue;
      }

      // Single-character operators
      if (/[+\-*/%!=<>&|^~?]/.test(rawCode[i])) {
        html += `<span class="token operator">${escapeHtml(rawCode[i])}</span>`;
        i++;
        continue;
      }

      // Punctuation
      if (/[{}()\[\];,.]/.test(rawCode[i])) {
        html += `<span class="token punctuation">${escapeHtml(rawCode[i])}</span>`;
        i++;
        continue;
      }

      // Whitespace or any other char
      html += escapeHtml(rawCode[i]);
      i++;
    }

    return html;
  }

  function createEventStreamParser(onEvent) {
    let buffer = '';
    let eventName = 'message';
    let data = [];
    let eventSize = 0;
    function line(value) {
      if (!value) {
        if (data.length) onEvent(eventName, data.join('\n'));
        eventName = 'message';
        data = [];
        eventSize = 0;
        return;
      }
      if (value.startsWith(':')) return;
      const separator = value.indexOf(':');
      const field = separator < 0 ? value : value.slice(0, separator);
      let content = separator < 0 ? '' : value.slice(separator + 1);
      if (content.startsWith(' ')) content = content.slice(1);
      if (field === 'event') eventName = content;
      if (field === 'data') {
        eventSize += content.length;
        if (eventSize > 1024 * 1024) throw new Error('This response is too large. Try a shorter question.');
        data.push(content);
      }
    }
    return {
      feed(chunk, final = false) {
        buffer += chunk;
        let index;
        while ((index = buffer.search(/[\r\n]/)) >= 0) {
          if (!final && buffer[index] === '\r' && index === buffer.length - 1) break;
          const value = buffer.slice(0, index);
          const length = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
          buffer = buffer.slice(index + length);
          line(value);
        }
        if (buffer.length > 1024 * 1024) throw new Error('This response is too large. Try a shorter question.');
      }
    };
  }

  async function readChatResponse(response, onDelta) {
    if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
      const result = await response.json();
      if (!result || typeof result.reply !== 'string') throw new Error('The reply was incomplete. Please try again.');
      return result;
    }
    if (!response.body) throw new Error('Streaming is unavailable. Please try again.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = null;
    let terminal = false;
    const parser = createEventStreamParser((event, raw) => {
      if (terminal || !['delta', 'result', 'error'].includes(event)) return;
      let data;
      try { data = JSON.parse(raw); } catch (_) { throw new Error('The reply was interrupted. Please try again.'); }
      if (event === 'error') throw new Error(typeof data.message === 'string' ? data.message : 'Could not finish the reply. Please try again.');
      if (event === 'delta' && typeof data.text === 'string') onDelta(data.text);
      if (event === 'result') {
        if (!data || typeof data.reply !== 'string') throw new Error('The reply was incomplete. Please try again.');
        result = data;
        terminal = true;
      }
    });
    try {
      while (!terminal) {
        const { value, done } = await reader.read();
        parser.feed(done ? decoder.decode() : decoder.decode(value, { stream: true }), done);
        if (done) break;
      }
      if (!terminal) throw new Error('The reply was interrupted. Please try again.');
      return result;
    } finally {
      await reader.cancel().catch(() => { });
      reader.releaseLock();
    }
  }

  // Pure helpers export for Node unit test runners
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') {
    module.exports = {
      createEventStreamParser,
      readChatResponse,
      escapeHtml,
      safeLink,
      stabilizeStreamingMarkdown,
      protectCodeBlocks,
      restoreCodeBlocks,
      fallbackMarkdown,
      normalizeLatexDelimiters,
      highlightChatCode,
      assertAndCleanPlaceholders,
      parseAttendanceBlock,
      renderAttendanceChartHtml,
      parseKyanaVisualBlock,
      renderKyanaVisualBlockHtml,
      VISUAL_BLOCK_KINDS
    };
    return;
  }

  // Prevent multiple initializations in browser
  if (window.__KYANA_WORKSPACE_INITIALIZED__) return;
  window.__KYANA_WORKSPACE_INITIALIZED__ = true;

  const isFullPage = document.body.classList.contains('sla-fullpage-mode') || window.location.pathname.includes('chatbot.html');
  if (!isFullPage) return;

  // --- 2. Dynamic CDN Asset Loading (Marked, DOMPurify, KaTeX, Prism) ---
  function loadScript(src) {
    return new Promise((resolve) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }

  Promise.all([
    loadScript('https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js')
  ]).then(() => {
    return Promise.all([
      loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-c.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-cpp.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-java.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-python.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-javascript.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-markup.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-css.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-json.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-sql.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-bash.min.js')
    ]);
  }).catch(() => { });

  // --- 3. Component Architecture Definitions ---

  // KyanaCodeBlock Component
  const KyanaCodeBlock = {
    enhance(container) {
      container.querySelectorAll('pre code').forEach((codeBlock) => {
        const pre = codeBlock.parentElement;
        if (pre.parentElement.classList.contains('kyana-code-block')) return;

        const rawCode = codeBlock.textContent || '';
        const langMatch = codeBlock.className.match(/language-(\w+)/);
        const langName = langMatch ? langMatch[1] : 'Code';
        const langKey = langName.toLowerCase();
        const compilerSupported = /^(java|c|cpp|c\+\+|html|css|javascript|js|python|py|sql)$/.test(langKey);

        codeBlock.dataset.rawCode = rawCode;
        codeBlock.innerHTML = highlightChatCode(rawCode, langKey);
        assertAndCleanPlaceholders(codeBlock);

        const wrap = document.createElement('div');
        wrap.className = 'kyana-code-block';

        const header = document.createElement('div');
        header.className = 'kyana-code-header';
        header.innerHTML = `
          <span class="kyana-code-lang">${escapeHtml(langName)}</span>
          <div class="kyana-code-actions">
            <button type="button" class="kyana-code-btn kyana-copy-code-btn">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>Copy</span>
            </button>
            ${compilerSupported ? `
            <button type="button" class="kyana-code-btn kyana-run-compiler-btn" title="Open in Semester Library Code Lab">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                <polygon points="6,3 20,12 6,21"/>
              </svg>
              <span>Run in Compiler</span>
            </button>` : ''}
          </div>
        `;

        const copyBtn = header.querySelector('.kyana-copy-code-btn');
        copyBtn.addEventListener('click', () => {
          const codeToCopy = codeBlock.dataset.rawCode || codeBlock.innerText;
          navigator.clipboard.writeText(codeToCopy).then(() => {
            copyBtn.innerHTML = `<span>✓ Copied!</span>`;
            setTimeout(() => {
              copyBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span>Copy</span>
              `;
            }, 2000);
          });
        });

        const runBtn = header.querySelector('.kyana-run-compiler-btn');
        if (runBtn) {
          runBtn.addEventListener('click', () => {
            try {
              sessionStorage.setItem('pendingCompilerCode', JSON.stringify({
                code: codeBlock.dataset.rawCode || codeBlock.innerText,
                lang: langKey
              }));
              window.location.href = 'compiler.html';
            } catch (_) { }
          });
        }

        pre.className = 'kyana-code-pre';
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(header);
        wrap.appendChild(pre);
      });
    }
  };

  // Markdown Formatter with KaTeX & Streaming Stabilization
  function renderFormattedContent(element, rawMarkdown, streaming = false) {
    if (!element) return;
    const inputMarkdown = streaming ? stabilizeStreamingMarkdown(rawMarkdown) : String(rawMarkdown || '');
    const normalized = normalizeLatexDelimiters(inputMarkdown);
    if (window.marked && typeof window.marked.parse === 'function') {
      try {
        if (!window.__KYANA_MARKED_CONFIGURED__) {
          window.__KYANA_MARKED_CONFIGURED__ = true;
          if (typeof window.marked.use === 'function') {
            window.marked.use({ breaks: true, gfm: true });
          } else if (typeof window.marked.setOptions === 'function') {
            window.marked.setOptions({ breaks: true, gfm: true });
          }
        }
        // Protect block math before marked.parse so underscores/backslashes are not stripped
        const mathHolders = [];
        const inlineMathHolders = [];
        const mathProtected = normalized
          .replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => {
            const idx = mathHolders.length;
            mathHolders.push(`<div class="kyana-math-block">$${escapeHtml(expr.trim())}$</div>`);
            return `\n\n@@KYANA_MATH_BLOCK_${idx}@@\n\n`;
          })
          .replace(/(^|[^$\\])\$(?!\$)([^$\n]+?)\$(?!\$)/g, (m, prefix, expr) => {
            if (/^\d+(?:[.,]\d+)?$/.test(expr.trim())) return m;
            const idx = inlineMathHolders.length;
            inlineMathHolders.push(`<span class="kyana-math-inline">$${escapeHtml(expr.trim())}$</span>`);
            return `${prefix}___KYANA_INLINE_MATH_${idx}___`;
          });
        let parsed = window.marked.parse(mathProtected);
        parsed = parsed.replace(/(?:<p>)?@@KYANA_MATH_BLOCK_(\d+)@@(?:<\/p>)?/g, (_, idx) => mathHolders[Number(idx)] || '');
        parsed = parsed.replace(/___KYANA_INLINE_MATH_(\d+)___/g, (_, idx) => inlineMathHolders[Number(idx)] || '');
        if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
          element.innerHTML = window.DOMPurify.sanitize(parsed, {
            ADD_ATTR: ['target', 'rel', 'class'],
            FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button'],
            FORBID_ATTR: ['style']
          });
        } else {
          element.innerHTML = parsed;
        }
      } catch (_) {
        element.innerHTML = fallbackMarkdown(normalized);
      }
    } else {
      element.innerHTML = fallbackMarkdown(normalized);
    }

    // Ensure all tables are wrapped in horizontally scrollable .kyana-table-wrapper
    element.querySelectorAll('table').forEach(tbl => {
      if (!tbl.classList.contains('kyana-table')) tbl.classList.add('kyana-table');
      if (!tbl.parentElement || !tbl.parentElement.classList.contains('kyana-table-wrapper')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'kyana-table-wrapper';
        tbl.parentNode.insertBefore(wrapper, tbl);
        wrapper.appendChild(tbl);
      }
    });

    assertAndCleanPlaceholders(element);
    element.querySelectorAll('a[target="_blank"]').forEach(link => { link.rel = 'noopener noreferrer'; });

    KyanaCodeBlock.enhance(element);
    assertAndCleanPlaceholders(element);

    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(element, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false }
          ],
          throwOnError: false
        });
      } catch (_) { }
    }

    assertAndCleanPlaceholders(element);
  }

  // KyanaSourceCard Component (Strict Monochrome, No Gradients)
  const KyanaSourceCard = {
    renderSources(container, data) {
      const resourceCards = Array.isArray(data.resourceCards) ? data.resourceCards : [];
      const files = Array.isArray(data.matchedFiles) ? data.matchedFiles : [];
      const courses = Array.isArray(data.matchedCourses) ? data.matchedCourses : [];
      const routines = Array.isArray(data.matchedRoutine) ? data.matchedRoutine : [];
      const webSources = Array.isArray(data.webSources) ? data.webSources.filter(s => s && safeLink(s.url, true)) : [];

      if (!resourceCards.length && !files.length && !courses.length && !routines.length && !webSources.length) return;

      const wrap = document.createElement('div');
      wrap.className = 'kyana-sources-wrap';
      wrap.innerHTML = `
        <div class="kyana-sources-heading">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
          <span>${resourceCards.length ? 'Interactive Resources' : 'Sources & References'}</span>
        </div>
        <div class="kyana-sources-list"></div>
      `;
      const list = wrap.querySelector('.kyana-sources-list');

      // 0. Primary Native Resource Cards
      if (resourceCards.length) {
        resourceCards.forEach(card => {
          const el = document.createElement('a');
          el.className = 'kyana-source-card';
          el.href = ['note', 'post', 'notice', 'assignment', 'post_assignment', 'routine'].includes(card.type) && /^\d+$/.test(String(card.id)) ? `/api/ai/resources/${card.type}/${card.id}/open` : '#';
          if (card.action === 'open_note' || card.type === 'note') {
            el.target = '_blank';
            el.rel = 'noopener noreferrer';
          }
          const iconType = {
            note: 'NOTE',
            routine: 'EXAM',
            notice: 'NOTIF',
            post: 'FEED',
            assignment: 'TASK'
          }[card.type] || 'DOC';
          const actionText = {
            open_note: 'Open Notes',
            view_routine: 'View Routine',
            view_notice: 'View Notice',
            view_post: 'Open Post',
            view_assignment: 'Open Assignment'
          }[card.action] || 'Open';
          const semDisplay = card.semester ? (/^sem/i.test(String(card.semester)) ? String(card.semester) : `Sem ${card.semester}`) : '';
          const pubDisplay = card.publishedDate || (card.createdAt ? String(card.createdAt).slice(0, 10) : '');
          const meta = [card.authority, card.subject, semDisplay, pubDisplay, actionText].filter(Boolean).join(' · ');
          const excerptHtml = card.excerpt
            ? `<span class="kyana-source-excerpt" style="display:block;font-size:11px;opacity:0.78;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(String(card.excerpt).slice(0, 140))}</span>`
            : '';
          el.innerHTML = `
            <div class="kyana-source-left">
              <div class="kyana-source-icon">${escapeHtml(iconType)}</div>
              <div class="kyana-source-info">
                <span class="kyana-source-title">${escapeHtml(card.title || 'Resource')}</span>
                <span class="kyana-source-meta">${escapeHtml(meta)}</span>
                ${excerptHtml}
              </div>
            </div>
            <span class="kyana-source-arrow" aria-hidden="true">&rarr;</span>
          `;
          list.appendChild(el);
        });
      } else {
        // Fallback: Files
        files.forEach(f => {
          const card = document.createElement('a');
          card.className = 'kyana-source-card';
          const rawCardUrl = `/api/files/${encodeURIComponent(f.id)}/view`;
          card.href = window.SemesterAuth && typeof window.SemesterAuth.attachAuthTokenToUrl === 'function'
            ? window.SemesterAuth.attachAuthTokenToUrl(rawCardUrl)
            : rawCardUrl;
          card.target = '_blank';
          card.rel = 'noopener noreferrer';
          const ext = ((f.originalName || f.title || '').split('.').pop() || 'doc').toUpperCase().slice(0, 4);
          const meta = [f.subject || 'Study Notes', f.chapter ? `Ch. ${f.chapter}` : '', f.semester ? `Sem ${f.semester}` : ''].filter(Boolean).join(' · ');
          card.innerHTML = `
            <div class="kyana-source-left">
              <div class="kyana-source-icon">${escapeHtml(ext)}</div>
              <div class="kyana-source-info">
                <span class="kyana-source-title">${escapeHtml(f.title || f.originalName || 'Study Material')}</span>
                <span class="kyana-source-meta">${escapeHtml(meta)}</span>
              </div>
            </div>
            <span class="kyana-source-arrow" aria-hidden="true">&rarr;</span>
          `;
          list.appendChild(card);
        });

        // Fallback: Syllabus
        courses.forEach(c => {
          const card = document.createElement('a');
          card.className = 'kyana-source-card';
          const courseKey = c.code ? `${c.code}-${c.title}` : c.title;
          card.href = `syllabus.html#${encodeURIComponent(c.year || 'Year 1')}/${encodeURIComponent(c.semester)}/${encodeURIComponent(courseKey)}`;
          const meta = [`Semester ${c.semester}`, `${c.credit} Credits`, c.nature || 'Curriculum'].filter(Boolean).join(' · ');
          card.innerHTML = `
            <div class="kyana-source-left">
              <div class="kyana-source-icon">SYL</div>
              <div class="kyana-source-info">
                <span class="kyana-source-title">${escapeHtml(c.title)}</span>
                <span class="kyana-source-meta">${escapeHtml(meta)}</span>
              </div>
            </div>
            <span class="kyana-source-arrow" aria-hidden="true">&rarr;</span>
          `;
          list.appendChild(card);
        });

        // Fallback: Routine
        routines.forEach(r => {
          const card = document.createElement('a');
          card.className = 'kyana-source-card';
          card.href = `routine.html?semester=${encodeURIComponent(r.semester)}`;
          const meta = [`Semester ${r.semester}`, r.date, r.time, r.room ? `Room ${r.room}` : ''].filter(Boolean).join(' · ');
          card.innerHTML = `
            <div class="kyana-source-left">
              <div class="kyana-source-icon">EXAM</div>
              <div class="kyana-source-info">
                <span class="kyana-source-title">${escapeHtml(r.subject)}</span>
                <span class="kyana-source-meta">${escapeHtml(meta)}</span>
              </div>
            </div>
            <span class="kyana-source-arrow" aria-hidden="true">&rarr;</span>
          `;
          list.appendChild(card);
        });
      }

      // Web Sources
      webSources.forEach(s => {
        const card = document.createElement('a');
        card.className = 'kyana-source-card';
        card.href = s.url;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
        card.innerHTML = `
          <div class="kyana-source-left">
            <div class="kyana-source-icon">WEB</div>
            <div class="kyana-source-info">
              <span class="kyana-source-title">${escapeHtml(s.title || s.domain || 'Web Source')}</span>
              <span class="kyana-source-meta">${escapeHtml(s.domain || 'External citation')}</span>
            </div>
          </div>
          <span class="kyana-source-arrow" aria-hidden="true">&rarr;</span>
        `;
        list.appendChild(card);
      });

      container.appendChild(wrap);
    }
  };

  // KyanaResponseActions Component with Subtle Single-Pass Completion Shimmer
  const KyanaResponseActions = {
    render(container, textToCopy, onRegenerate, isFreshComplete = false) {
      const actions = document.createElement('div');
      actions.className = 'kyana-response-actions' + (isFreshComplete ? ' kyana-completion-pulse' : '');
      actions.innerHTML = `
        <button type="button" class="kyana-action-btn kyana-copy-btn" title="Copy response">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>Copy</span>
        </button>
        <button type="button" class="kyana-action-btn kyana-helpful-btn" title="Good response">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
          </svg>
        </button>
        <button type="button" class="kyana-action-btn kyana-unhelpful-btn" title="Bad response">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>
          </svg>
        </button>
        ${onRegenerate ? `
        <button type="button" class="kyana-action-btn kyana-regen-btn" title="Regenerate response">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
          <span>Regenerate</span>
        </button>` : ''}
      `;

      const copyBtn = actions.querySelector('.kyana-copy-btn');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(textToCopy).then(() => {
          copyBtn.innerHTML = `<span>✓ Copied!</span>`;
          setTimeout(() => {
            copyBtn.innerHTML = `
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>Copy</span>
            `;
          }, 2000);
        });
      });

      const helpfulBtn = actions.querySelector('.kyana-helpful-btn');
      helpfulBtn.addEventListener('click', () => {
        helpfulBtn.classList.toggle('active');
        actions.querySelector('.kyana-unhelpful-btn').classList.remove('active');
      });

      const unhelpfulBtn = actions.querySelector('.kyana-unhelpful-btn');
      unhelpfulBtn.addEventListener('click', () => {
        unhelpfulBtn.classList.toggle('active');
        actions.querySelector('.kyana-helpful-btn').classList.remove('active');
      });

      const regenBtn = actions.querySelector('.kyana-regen-btn');
      if (regenBtn && onRegenerate) {
        regenBtn.addEventListener('click', onRegenerate);
      }

      container.appendChild(actions);
    }
  };

  // KyanaUserMessage Component (Strict Monochrome Dark Gray Bubble)
  const KyanaUserMessage = {
    create(text) {
      const row = document.createElement('div');
      row.className = 'kyana-user-row';
      const bubble = document.createElement('div');
      bubble.className = 'kyana-user-bubble';
      bubble.textContent = text;
      row.appendChild(bubble);
      return row;
    }
  };

  // KyanaResponse Component (Clean Typography — No Redundant Header)
  const KyanaResponse = {
    create() {
      const row = document.createElement('div');
      row.className = 'kyana-response-row';
      row.innerHTML = `<div class="kyana-response-doc"></div>`;
      return row;
    }
  };

  // KyanaLogo Component (Official Monochrome Glass-Ribbon Identity)
  const KyanaLogo = {
    render({ size = 28, animated = false, thinking = false, className = '', alt = 'Kyana AI' } = {}) {
      let src = '/images/kyana-mono-header.png';
      if (size >= 64) {
        src = '/images/kyana-mono-hero.png';
      } else if (thinking || size <= 28) {
        src = '/images/kyana-mono-thinking.png';
      }

      const classes = [
        'kyana-logo-comp',
        thinking ? 'kyana-logo-thinking' : '',
        animated ? 'kyana-logo-animated' : '',
        className
      ].filter(Boolean).join(' ');

      return `
        <span class="${classes}" style="width: ${size}px; height: ${size}px;" role="img" aria-label="${escapeHtml(alt)}">
          <span class="kyana-logo-aura" aria-hidden="true"></span>
          <span class="kyana-logo-glass-frame">
            <img class="kyana-logo-img" src="${src}" alt="${escapeHtml(alt)}" width="${size}" height="${size}" />
            <span class="kyana-logo-highlight-sweep" aria-hidden="true"></span>
          </span>
        </span>
      `.trim();
    },

    create({ size = 28, animated = false, thinking = false, className = '', alt = 'Kyana AI' } = {}) {
      const container = document.createElement('div');
      container.innerHTML = this.render({ size, animated, thinking, className, alt });
      return container.firstElementChild;
    }
  };

  // KyanaThinking Component (Monochrome Living Glass Logo + Minimal Status Text)
  const KyanaThinking = {
    create() {
      const wrap = document.createElement('div');
      wrap.className = 'kyana-thinking-wrap';
      wrap.id = 'kyanaThinkingIndicator';
      wrap.innerHTML = `
        <div class="kyana-thinking-mark-slot">
          ${KyanaLogo.render({ size: 24, thinking: true, alt: 'Kyana thinking' })}
        </div>
        <div class="kyana-thinking-status">
          <span>Kyana is thinking</span>
        </div>
      `;
      return wrap;
    }
  };

  // KyanaErrorState Component
  const KyanaErrorState = {
    create(message, onRetry) {
      const card = document.createElement('div');
      card.className = 'kyana-error-card';
      card.innerHTML = `
        <span>${escapeHtml(message || "Kyana couldn't complete that response.")}</span>
        ${onRetry ? `<button type="button" class="kyana-retry-btn">Try again</button>` : ''}
      `;
      if (onRetry) {
        card.querySelector('.kyana-retry-btn').addEventListener('click', onRetry);
      }
      return card;
    }
  };

  // --- 4. Conversation Sessions Storage & History Management ---
  const STORAGE_KEY = 'kyana_chat_sessions_v1';
  const ACTIVE_SESSION_KEY = 'kyana_active_session_id';

  let volatileSessions = [];
  let volatileActiveId = null;
  const SessionStore = {
    getAll() { return structuredClone(volatileSessions); },
    saveAll(sessions) { volatileSessions = structuredClone(sessions.slice(0, 50)); },
    getActiveId() { return volatileActiveId; },
    setActiveId(id) { volatileActiveId = id || null; },
    get(id) {
      return this.getAll().find(s => s.id === id);
    },
    create(initialPrompt = '') {
      const id = 'chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const title = initialPrompt ? (initialPrompt.length > 36 ? initialPrompt.substring(0, 36) + '…' : initialPrompt) : 'New conversation';
      const session = {
        id,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
      };
      const all = this.getAll();
      all.unshift(session);
      this.saveAll(all);
      this.setActiveId(id);
      return session;
    },
    update(session) {
      const all = this.getAll();
      const idx = all.findIndex(s => s.id === session.id);
      if (idx >= 0) {
        session.updatedAt = Date.now();
        all[idx] = session;
        all.sort((a, b) => b.updatedAt - a.updatedAt);
        this.saveAll(all);
      }
    },
    delete(id) {
      const all = this.getAll().filter(s => s.id !== id);
      this.saveAll(all);
      if (this.getActiveId() === id) {
        this.setActiveId(all[0] ? all[0].id : null);
      }
    },
    rename(id, newTitle) {
      const all = this.getAll();
      const session = all.find(s => s.id === id);
      if (session) {
        session.title = newTitle.trim() || 'Untitled';
        this.saveAll(all);
      }
    }
  };

  // Grouping helper
  function groupSessionsByDate(sessions) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOf7Days = startOfToday - 86400000 * 7;

    const groups = {
      today: [],
      yesterday: [],
      previous7Days: [],
      older: []
    };

    sessions.forEach(s => {
      const t = s.updatedAt || s.createdAt || 0;
      if (t >= startOfToday) groups.today.push(s);
      else if (t >= startOfYesterday) groups.yesterday.push(s);
      else if (t >= startOf7Days) groups.previous7Days.push(s);
      else groups.older.push(s);
    });

    return groups;
  }

  // --- 5. Main UI Controller ---

  let activeSession = null;
  let activeRequest = null;
  let isSending = false;
  let userHasScrolledUp = false;

  // DOM Elements
  const appEl = document.getElementById('kyanaApp');
  const sidebarEl = document.getElementById('kyanaSidebar');
  const sidebarCloseBtn = document.getElementById('kyanaSidebarCloseBtn');
  const sidebarOpenBtn = document.getElementById('kyanaSidebarOpenBtn');
  const drawerBackdrop = document.getElementById('kyanaDrawerBackdrop');
  const newChatBtn = document.getElementById('kyanaNewChatBtn');
  const headerNewChatBtn = document.getElementById('kyanaHeaderNewChatBtn');
  const historySearchInput = document.getElementById('kyanaHistorySearchInput');
  const searchClearBtn = document.getElementById('kyanaSearchClearBtn');
  const historyListEl = document.getElementById('kyanaSidebarHistory');
  const viewportEl = document.getElementById('kyanaViewport');
  const welcomeHeroEl = document.getElementById('kyanaWelcomeHero');
  const messagesListEl = document.getElementById('kyanaMessagesList');
  const scrollBottomBtn = document.getElementById('kyanaScrollBottomBtn');
  const composerContainer = document.getElementById('kyanaComposerContainer');
  const composerForm = document.getElementById('kyanaComposerForm');
  const chatInput = document.getElementById('kyanaInput');
  const submitBtn = document.getElementById('kyanaSubmitBtn');
  const attachBtn = document.getElementById('kyanaAttachBtn');
  const attachPopover = document.getElementById('kyanaAttachPopover');
  const renameModal = document.getElementById('kyanaRenameModal');
  const deleteModal = document.getElementById('kyanaDeleteModal');
  const themeToggleBtn = document.getElementById('kyanaThemeToggleBtn');

  // --- 6. Scroll Management & User Scroll Detection ---

  function isAtBottom(tolerance = 80) {
    if (!viewportEl) return true;
    return (viewportEl.scrollHeight - viewportEl.scrollTop - viewportEl.clientHeight) <= tolerance;
  }

  function scrollToBottom(smooth = false) {
    if (!viewportEl) return;
    viewportEl.scrollTo({
      top: viewportEl.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
    userHasScrolledUp = false;
    updateScrollButton();
  }

  function updateScrollButton() {
    if (!scrollBottomBtn) return;
    if (appEl && appEl.classList.contains('is-empty')) {
      scrollBottomBtn.classList.remove('visible');
      return;
    }
    const shouldShow = userHasScrolledUp && (viewportEl.scrollHeight > viewportEl.clientHeight + 100);
    scrollBottomBtn.classList.toggle('visible', shouldShow);
  }

  if (viewportEl) {
    viewportEl.addEventListener('scroll', () => {
      userHasScrolledUp = !isAtBottom();
      updateScrollButton();
    });
  }

  if (scrollBottomBtn) {
    scrollBottomBtn.addEventListener('click', () => {
      scrollToBottom(true);
    });
  }

  // --- 7. Sidebar & Mobile Drawer Toggles ---

  function setSidebarOpen(open) {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      appEl.classList.toggle('sidebar-open', open);
    } else {
      appEl.classList.toggle('sidebar-collapsed', !open);
    }
  }

  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', () => setSidebarOpen(false));
  if (sidebarOpenBtn) sidebarOpenBtn.addEventListener('click', () => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) setSidebarOpen(true);
    else setSidebarOpen(appEl.classList.contains('sidebar-collapsed'));
  });
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', () => setSidebarOpen(false));

  // --- 8. Theme Toggle Integration ---
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      if (typeof window.toggleTheme === 'function') {
        window.toggleTheme();
      } else {
        const curr = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = curr === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        document.body.classList.toggle('dark-mode', next === 'dark');
        try { localStorage.setItem('theme', next); } catch (_) { }
      }
    });
  }

  // --- 9. Composer Auto-Resizing & Enter Handling ---

  function adjustTextareaHeight() {
    if (!chatInput) return;
    chatInput.style.height = 'auto';
    const newHeight = Math.min(chatInput.scrollHeight, 160);
    chatInput.style.height = `${Math.max(newHeight, 24)}px`;

    const hasText = Boolean(chatInput.value.trim());
    if (submitBtn && !isSending) {
      submitBtn.disabled = !hasText;
      submitBtn.classList.toggle('active', hasText);
    }
  }

  if (chatInput) {
    chatInput.addEventListener('input', adjustTextareaHeight);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!isSending) handleSend();
      }
    });
  }

  // Attach quick prompts popover toggle
  if (attachBtn && attachPopover) {
    attachBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = attachPopover.style.display !== 'none';
      attachPopover.style.display = isVisible ? 'none' : 'block';
    });

    document.addEventListener('click', (e) => {
      if (!attachPopover.contains(e.target) && e.target !== attachBtn) {
        attachPopover.style.display = 'none';
      }
    });

    attachPopover.querySelectorAll('.kyana-popover-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        let prompt = '';
        if (action === 'notes') prompt = 'Find study notes for ';
        else if (action === 'routine') prompt = 'Show exam routine for ';
        else if (action === 'syllabus') prompt = 'What is the syllabus for ';
        else if (action === 'questions') prompt = 'Find past questions for ';
        if (prompt && chatInput) {
          chatInput.value = prompt;
          chatInput.focus();
          chatInput.setSelectionRange(prompt.length, prompt.length);
          adjustTextareaHeight();
        }
        attachPopover.style.display = 'none';
      });
    });
  }

  // --- 10. Sidebar History Renderer (Strict Monochrome) ---

  let historyFilter = '';

  function renderHistoryList() {
    if (!historyListEl) return;
    const all = SessionStore.getAll();
    const filtered = historyFilter
      ? all.filter(s => s.title.toLowerCase().includes(historyFilter.toLowerCase()))
      : all;

    if (!filtered.length) {
      historyListEl.innerHTML = `
        <div class="kyana-history-empty">
          <span>${historyFilter ? 'No matching conversations' : 'No conversations yet'}</span>
        </div>
      `;
      return;
    }

    const groups = groupSessionsByDate(filtered);
    const groupDefs = [
      { key: 'today', label: 'TODAY', items: groups.today },
      { key: 'yesterday', label: 'YESTERDAY', items: groups.yesterday },
      { key: 'previous7Days', label: 'PREVIOUS 7 DAYS', items: groups.previous7Days },
      { key: 'older', label: 'OLDER', items: groups.older }
    ];

    historyListEl.innerHTML = '';
    const activeId = activeSession ? activeSession.id : null;

    groupDefs.forEach(g => {
      if (!g.items.length) return;
      const groupEl = document.createElement('div');
      groupEl.className = 'kyana-history-group';
      groupEl.innerHTML = `<div class="kyana-group-label">${escapeHtml(g.label)}</div>`;

      g.items.forEach(s => {
        const itemEl = document.createElement('div');
        itemEl.className = 'kyana-history-item' + (s.id === activeId ? ' active' : '');
        itemEl.dataset.id = s.id;
        itemEl.innerHTML = `
          <span class="kyana-history-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</span>
          <button type="button" class="kyana-item-menu-btn" title="Options" aria-label="Conversation options">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <circle cx="12" cy="12" r="1.5"></circle>
              <circle cx="6" cy="12" r="1.5"></circle>
              <circle cx="18" cy="12" r="1.5"></circle>
            </svg>
          </button>
        `;

        itemEl.addEventListener('click', (e) => {
          if (e.target.closest('.kyana-item-menu-btn')) return;
          loadSession(s.id);
          if (window.innerWidth <= 768) setSidebarOpen(false);
        });

        const menuBtn = itemEl.querySelector('.kyana-item-menu-btn');
        menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showSessionMenu(s, menuBtn);
        });

        groupEl.appendChild(itemEl);
      });

      historyListEl.appendChild(groupEl);
    });
  }

  // Overflow Session Menu (Rename / Delete)
  let activeMenuEl = null;
  function showSessionMenu(session, triggerBtn) {
    if (activeMenuEl) activeMenuEl.remove();

    const menu = document.createElement('div');
    menu.className = 'kyana-attach-popover';
    menu.style.position = 'fixed';
    const rect = triggerBtn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 200)}px`;
    menu.style.zIndex = '2000';

    menu.innerHTML = `
      <button type="button" class="kyana-popover-item kyana-menu-rename">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
        </svg>
        <span>Rename</span>
      </button>
      <button type="button" class="kyana-popover-item kyana-menu-delete" style="color: #ef4444;">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>Delete</span>
      </button>
    `;

    document.body.appendChild(menu);
    activeMenuEl = menu;

    menu.querySelector('.kyana-menu-rename').addEventListener('click', () => {
      menu.remove();
      promptRename(session);
    });

    menu.querySelector('.kyana-menu-delete').addEventListener('click', () => {
      menu.remove();
      promptDelete(session);
    });

    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== triggerBtn) {
        menu.remove();
        activeMenuEl = null;
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  // Rename Dialog
  function promptRename(session) {
    if (!renameModal) return;
    const input = document.getElementById('kyanaRenameInput');
    const confirmBtn = document.getElementById('kyanaRenameConfirmBtn');
    const cancelBtn = document.getElementById('kyanaRenameCancelBtn');
    if (input) input.value = session.title;
    renameModal.style.display = 'flex';
    if (input) {
      input.focus();
      input.select();
    }

    const close = () => { renameModal.style.display = 'none'; };
    cancelBtn.onclick = close;
    confirmBtn.onclick = () => {
      const val = (input.value || '').trim();
      if (val) {
        SessionStore.rename(session.id, val);
        if (activeSession && activeSession.id === session.id) {
          activeSession.title = val;
        }
        renderHistoryList();
      }
      close();
    };
  }

  // Delete Dialog
  function promptDelete(session) {
    if (!deleteModal) return;
    const confirmBtn = document.getElementById('kyanaDeleteConfirmBtn');
    const cancelBtn = document.getElementById('kyanaDeleteCancelBtn');
    deleteModal.style.display = 'flex';

    const close = () => { deleteModal.style.display = 'none'; };
    cancelBtn.onclick = close;
    confirmBtn.onclick = () => {
      SessionStore.delete(session.id);
      if (activeSession && activeSession.id === session.id) {
        startNewChat();
      } else {
        renderHistoryList();
      }
      close();
    };
  }

  // Search filter listener
  if (historySearchInput) {
    historySearchInput.addEventListener('input', (e) => {
      historyFilter = (e.target.value || '').trim();
      if (searchClearBtn) searchClearBtn.style.display = historyFilter ? 'flex' : 'none';
      renderHistoryList();
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      historySearchInput.value = '';
      historyFilter = '';
      searchClearBtn.style.display = 'none';
      renderHistoryList();
      historySearchInput.focus();
    });
  }

  // --- 11. Conversation Session Loader & Messages Viewport ---

  function setConversationState(hasMessages, animateTransition = false) {
    if (!appEl) return;
    if (hasMessages) {
      if (animateTransition && appEl.classList.contains('is-empty')) {
        // FLIP transition on composer
        const capsule = composerForm;
        const firstRect = capsule ? capsule.getBoundingClientRect() : null;

        appEl.classList.remove('is-empty');
        appEl.classList.add('has-messages');

        if (welcomeHeroEl) {
          welcomeHeroEl.classList.add('fade-out');
        }

        if (capsule && firstRect) {
          const lastRect = capsule.getBoundingClientRect();
          const deltaY = firstRect.top - lastRect.top;
          capsule.style.transition = 'none';
          capsule.style.transform = `translateY(${deltaY}px)`;

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              capsule.style.transition = 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)';
              capsule.style.transform = 'translateY(0)';

              const cleanup = () => {
                capsule.style.transition = '';
                capsule.style.transform = '';
                capsule.removeEventListener('transitionend', cleanup);
                if (welcomeHeroEl) {
                  welcomeHeroEl.style.display = 'none';
                  welcomeHeroEl.classList.remove('fade-out');
                }
              };
              capsule.addEventListener('transitionend', cleanup, { once: true });
            });
          });
        } else if (welcomeHeroEl) {
          setTimeout(() => {
            welcomeHeroEl.style.display = 'none';
            welcomeHeroEl.classList.remove('fade-out');
          }, 220);
        }
      } else {
        appEl.classList.remove('is-empty');
        appEl.classList.add('has-messages');
        if (welcomeHeroEl) {
          welcomeHeroEl.style.display = 'none';
          welcomeHeroEl.classList.remove('fade-out');
        }
      }
    } else {
      appEl.classList.add('is-empty');
      appEl.classList.remove('has-messages');
      if (welcomeHeroEl) {
        welcomeHeroEl.style.display = 'flex';
        welcomeHeroEl.classList.remove('fade-out');
      }
      if (scrollBottomBtn) {
        scrollBottomBtn.classList.remove('visible');
      }
    }
  }

  function renderSessionMessages(session) {
    if (!messagesListEl) return;
    messagesListEl.innerHTML = '';

    if (!session || !session.messages || !session.messages.length) {
      setConversationState(false, false);
      return;
    }

    setConversationState(true, false);

    session.messages.forEach((msg, idx) => {
      if (msg.role === 'user') {
        const row = KyanaUserMessage.create(msg.content);
        messagesListEl.appendChild(row);
      } else if (msg.role === 'assistant') {
        const row = KyanaResponse.create();
        const doc = row.querySelector('.kyana-response-doc');
        renderFormattedContent(doc, msg.content || '');
        KyanaSourceCard.renderSources(doc, msg);
        KyanaResponseActions.render(doc, msg.content || '', idx === session.messages.length - 1 ? () => handleRegenerate() : null, false);
        messagesListEl.appendChild(row);
      }
    });

    scrollToBottom();
  }

  async function loadSession(id) {
    cancelActiveRequest();
    const session = SessionStore.get(id);
    if (session) {
      const headers = {};
      const token = window.SemesterAuth?.getAccessToken?.();
      if (token) headers.Authorization = 'Bearer ' + token;
      try {
        const res = await fetch('/api/ai/conversations/' + encodeURIComponent(id) + '/messages', { headers, cache: 'no-store' });
        if (!res.ok) throw new Error('Conversation unavailable');
        const data = await res.json();
        session.messages = (data.messages || []).map(m => ({ ...m.metadata, role: m.sender, content: m.text, timestamp: new Date(m.createdAt).getTime() }));
      } catch { session.messages = []; }
      SessionStore.update(session);
      activeSession = session;
      SessionStore.setActiveId(id);
      renderHistoryList();
      renderSessionMessages(session);
      if (chatInput) chatInput.focus();
    }
  }

  function startNewChat() {
    cancelActiveRequest();
    activeSession = null;
    SessionStore.setActiveId(null);
    renderHistoryList();
    if (messagesListEl) messagesListEl.innerHTML = '';
    setConversationState(false, false);
    if (chatInput) {
      chatInput.value = '';
      adjustTextareaHeight();
      chatInput.focus();
    }
    scrollToBottom();
  }

  if (newChatBtn) newChatBtn.addEventListener('click', startNewChat);
  if (headerNewChatBtn) headerNewChatBtn.addEventListener('click', startNewChat);

  // Suggestion card clicks delegate
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.kyana-suggestion-card');
    if (card && card.dataset.prompt) {
      handleSend(card.dataset.prompt);
    }
  });

  // --- 12. Message Submission & Streaming Execution ---

  function cancelActiveRequest() {
    if (!activeRequest) return;
    activeRequest.controller.abort();
    if (activeRequest.frame != null) cancelAnimationFrame(activeRequest.frame);
    clearTimeout(activeRequest.timeout);
    activeRequest = null;
    removeThinkingIndicator();
    setGeneratingState(false);
  }

  function setGeneratingState(generating) {
    isSending = generating;
    if (appEl) appEl.classList.toggle('is-generating', generating);
    if (!submitBtn) return;

    if (generating) {
      submitBtn.disabled = false;
      submitBtn.classList.add('generating');
      submitBtn.classList.remove('active');
      submitBtn.title = 'Stop generating';
      submitBtn.setAttribute('aria-label', 'Stop generating');
      submitBtn.querySelector('.kyana-send-icon').style.display = 'none';
      submitBtn.querySelector('.kyana-stop-icon').style.display = 'block';
    } else {
      submitBtn.classList.remove('generating');
      submitBtn.querySelector('.kyana-send-icon').style.display = 'block';
      submitBtn.querySelector('.kyana-stop-icon').style.display = 'none';
      submitBtn.title = 'Send message (Enter)';
      submitBtn.setAttribute('aria-label', 'Send message');
      adjustTextareaHeight();
    }
  }

  function showThinkingIndicator() {
    removeThinkingIndicator();
    const ind = KyanaThinking.create();
    messagesListEl.appendChild(ind);
    if (!userHasScrolledUp) scrollToBottom();
  }

  function removeThinkingIndicator() {
    const ind = document.getElementById('kyanaThinkingIndicator');
    if (ind) {
      ind.classList.add('fading');
      setTimeout(() => {
        if (ind && ind.parentNode) ind.remove();
      }, 140);
    }
  }

  async function handleSend(textToSend) {
    const query = (textToSend || (chatInput ? chatInput.value : '')).trim();
    if (!query) return;

    if (isSending) {
      cancelActiveRequest();
      return;
    }

    // Ensure session exists
    if (!activeSession) {
      activeSession = SessionStore.create(query);
      renderHistoryList();
    }

    setConversationState(true, true);

    // Clear input
    if (chatInput) {
      chatInput.value = '';
      adjustTextareaHeight();
    }

    // Append User Message to UI & Session
    const userRow = KyanaUserMessage.create(query);
    messagesListEl.appendChild(userRow);
    activeSession.messages.push({ role: 'user', content: query, timestamp: Date.now() });
    SessionStore.update(activeSession);
    renderHistoryList();
    scrollToBottom();

    setGeneratingState(true);
    showThinkingIndicator();

    const request = {
      controller: new AbortController(),
      frame: null,
      row: null,
      doc: null,
      partial: '',
      timedOut: false
    };
    activeRequest = request;

    request.timeout = setTimeout(() => {
      request.timedOut = true;
      request.controller.abort();
    }, 90000);

    const historyPayload = activeSession.messages.slice(-12).map(m => ({
      role: m.role,
      content: m.content.slice(0, 8000)
    }));

    const reqHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    };
    try {
      const token = window.SemesterAuth?.getAccessToken?.();
      if (token) reqHeaders['Authorization'] = `Bearer ${token}`;
    } catch (_) { }

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: reqHeaders,
        signal: request.controller.signal,
        body: JSON.stringify({
          message: query,
          history: historyPayload,
          stream: true,
          conversationId: activeSession?.id
        })
      });

      if (activeRequest !== request) return;

      if (response.status === 401) {
        removeThinkingIndicator();
        const errRow = KyanaResponse.create();
        const errDoc = errRow.querySelector('.kyana-response-doc');
        errDoc.innerHTML = `<p>Your session has expired. Please <a href="login.html">sign in again</a> to chat.</p>`;
        messagesListEl.appendChild(errRow);
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        removeThinkingIndicator();
        const safeMsg = response.status === 429
          ? (errorData?.message || 'Too many requests. Please wait a moment before sending more messages!')
          : (errorData.message || "Kyana couldn't complete that response.");
        const errRow = KyanaResponse.create();
        const errDoc = errRow.querySelector('.kyana-response-doc');
        errDoc.appendChild(KyanaErrorState.create(safeMsg, () => handleSend(query)));
        messagesListEl.appendChild(errRow);
        return;
      }

      // Read streaming SSE response
      const data = await readChatResponse(response, deltaText => {
        if (activeRequest !== request) return;
        request.partial += deltaText;

        if (!request.row) {
          removeThinkingIndicator();
          request.row = KyanaResponse.create();
          request.doc = request.row.querySelector('.kyana-response-doc');
          messagesListEl.appendChild(request.row);
        }

        if (request.frame == null) {
          request.frame = requestAnimationFrame(() => {
            request.frame = null;
            if (activeRequest !== request) return;
            renderFormattedContent(request.doc, request.partial, true);
            if (!userHasScrolledUp) scrollToBottom();
          });
        }
      });

      if (activeRequest !== request) return;

      removeThinkingIndicator();

      // Final complete render with syntax highlighting, sources, and response action tools
      if (!request.row) {
        request.row = KyanaResponse.create();
        request.doc = request.row.querySelector('.kyana-response-doc');
        messagesListEl.appendChild(request.row);
      }

      request.doc.innerHTML = '';
      renderFormattedContent(request.doc, data.reply || '');
      KyanaSourceCard.renderSources(request.doc, data);
      KyanaResponseActions.render(request.doc, data.reply || '', () => handleRegenerate(), true);

      // Save to session history
      activeSession.messages.push({
        role: 'assistant',
        content: data.reply || '',
        resourceCards: data.resourceCards,
        matchedFiles: data.matchedFiles,
        matchedCourses: data.matchedCourses,
        matchedRoutine: data.matchedRoutine,
        webSources: data.webSources,
        timestamp: Date.now()
      });
      SessionStore.update(activeSession);
      renderHistoryList();
      if (!userHasScrolledUp) scrollToBottom();

    } catch (err) {
      if (activeRequest !== request) return;
      removeThinkingIndicator();

      const isOffline = !navigator.onLine;
      const errorMsg = isOffline
        ? "You're offline. Check your connection and try again."
        : (request.timedOut ? 'That request took too long. Try again.' : "Kyana couldn't complete that response.");

      if (request.partial && request.doc) {
        renderFormattedContent(request.doc, request.partial);
        request.doc.appendChild(KyanaErrorState.create(errorMsg, () => handleSend(query)));
      } else {
        const errRow = KyanaResponse.create();
        const errDoc = errRow.querySelector('.kyana-response-doc');
        errDoc.appendChild(KyanaErrorState.create(errorMsg, () => handleSend(query)));
        messagesListEl.appendChild(errRow);
      }
      scrollToBottom();
    } finally {
      clearTimeout(request.timeout);
      if (activeRequest === request) {
        if (request.frame != null) cancelAnimationFrame(request.frame);
        activeRequest = null;
        setGeneratingState(false);
        if (chatInput) chatInput.focus();
      }
    }
  }

  function handleRegenerate() {
    if (!activeSession || !activeSession.messages.length) return;
    const lastIdx = activeSession.messages.length - 1;
    if (activeSession.messages[lastIdx].role === 'assistant') {
      activeSession.messages.pop();
      const lastUser = activeSession.messages[activeSession.messages.length - 1];
      if (lastUser && lastUser.role === 'user') {
        const query = lastUser.content;
        activeSession.messages.pop();
        SessionStore.update(activeSession);
        renderSessionMessages(activeSession);
        handleSend(query);
      }
    }
  }

  if (composerForm) {
    composerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSend();
    });
  }

  // --- 13. Initialization & External Hooks ---

  // Expose KyanaLogo component on window
  window.KyanaLogo = KyanaLogo;

  // Global helper for external pages (e.g. from Library or Assignment search)
  window.askAiAssistant = function (query) {
    if (query && query.trim()) {
      handleSend(query.trim());
    }
  };

  // Sync conversations from server for authenticated students
  async function syncServerConversations() {
    try {
      const headers = {};
      const token = window.SemesterAuth?.getAccessToken?.();
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch('/api/ai/conversations', { headers });
      if (!res.ok) return;
      const serverConvs = await res.json();
      if (Array.isArray(serverConvs) && serverConvs.length > 0) {
        let changed = false;
        for (const conv of serverConvs) {
          let local = SessionStore.get(conv.id);
          if (!local) {
            local = {
              id: conv.id,
              title: conv.title || 'Chat with Kyana',
              createdAt: new Date(conv.createdAt).getTime() || Date.now(),
              updatedAt: new Date(conv.updatedAt).getTime() || Date.now(),
              messages: []
            };
            const all = SessionStore.getAll();
            all.unshift(local);
            SessionStore.saveAll(all);
            changed = true;
          }
        }
        if (changed) renderHistoryList();
        const activeId = SessionStore.getActiveId() || serverConvs[0].id;
        if (activeId) {
          const msgRes = await fetch('/api/ai/conversations/' + encodeURIComponent(activeId) + '/messages', { headers });
          if (msgRes.ok) {
            const data = await msgRes.json();
            const msgs = data.messages || [];
            const current = SessionStore.get(activeId);
            if (current && msgs.length > 0) {
              current.messages = msgs.map(m => ({
                ...m.metadata,
                role: m.sender === 'user' ? 'user' : 'assistant',
                content: m.text,
                timestamp: new Date(m.createdAt).getTime() || Date.now()
              }));
              SessionStore.update(current);
              loadSession(activeId);
            }
          }
        }
      }
    } catch (_) { }
  }
  syncServerConversations();

  // Auto-send or prefill from URL parameters (?q=... or ?prompt=...)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const initialQuery = urlParams.get('q') || urlParams.get('prompt');
    if (initialQuery && initialQuery.trim()) {
      setTimeout(() => {
        handleSend(initialQuery.trim());
      }, 300);
    }
  } catch (_) { }

})();
