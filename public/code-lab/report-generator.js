/**
 * report-generator.js — Shared Report Data Fetching & DOM Rendering for Code Lab
 * Used by both report.html (single report) and submissions.html (bulk ZIP export).
 *
 * Report Structure:
 *   Page 1 — Cover page (assignment name, sem, subject, teacher, student, submitted date)
 *   Page 2 — Marksheet table (Title | Status | Marks | Remarks)
 *   Page 3+ — Per-question: question → code → result → stats → suspicious graph
 *   Last   — Event timeline + total code time
 */

(function () {
  'use strict';

  const EVENT_LABELS = {
    run_clicked: 'Ran code',
    first_keystroke: 'First keystroke',
    idle_on_tab: 'Idle on tab',
    idle_ended: 'Resumed typing after idle',
    paste_attempt: 'Paste attempt',
    large_change: 'Large text jump',
    tab_hidden: 'Left tab',
    tab_visible: 'Returned to tab',
    submit_clicked: 'Clicked Submit',
    ai_explain_used: 'Used AI error explanation'
  };

  const SESSION_GAP_MS = 5 * 60 * 1000;

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-US', {
        timeZone: 'Asia/Kathmandu',
        dateStyle: 'medium',
        timeStyle: 'short'
      }) + ' NPT';
    } catch (e) {
      return String(iso);
    }
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        timeZone: 'Asia/Kathmandu',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch (e) {
      return String(iso);
    }
  }

  function fmtDuration(ms) {
    if (ms < 0 || !isFinite(ms)) return '—';
    const totalSec = Math.round(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const min = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${min}m`;
    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  }

  function fmtCalendarDuration(ms) {
    if (ms < 0 || !isFinite(ms)) return '—';
    const totalSec = Math.round(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const min = Math.floor((totalSec % 3600) / 60);
    if (days > 0) {
      return `${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    if (hours > 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}, ${min} min${min !== 1 ? 's' : ''}`;
    }
    return `${min} min${min !== 1 ? 's' : ''}`;
  }

  function deadlineBadge(deadline, submittedAt) {
    if (!deadline || !submittedAt) return '';
    const diffMs = new Date(deadline).getTime() - new Date(submittedAt).getTime();
    if (diffMs >= 0) {
      return `<span class="deadline-badge on-time">✅ Submitted ${fmtDuration(diffMs)} before deadline</span>`;
    } else {
      return `<span class="deadline-badge late">⚠️ Submitted ${fmtDuration(Math.abs(diffMs))} late</span>`;
    }
  }

  function computeIdleMs(events) {
    const sorted = (events || [])
      .filter(e => e.clientTime)
      .map(e => {
        let p = {};
        try { p = typeof e.payload === 'string' ? JSON.parse(e.payload || '{}') : (e.payload || {}); } catch (err) { }
        return { ...e, payloadObj: p, ts: new Date(e.clientTime).getTime() };
      })
      .sort((a, b) => a.ts - b.ts);

    let totalIdleMs = 0;
    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i];
      if (ev.eventType === 'idle_on_tab') {
        const initialIdleMs = Number(ev.payloadObj.idleMs) || (3 * 60 * 1000);
        let endedEv = null;
        let nextActiveEv = null;
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[j].eventType === 'idle_ended') {
            endedEv = sorted[j];
            break;
          }
          if (sorted[j].eventType !== 'heartbeat' && sorted[j].eventType !== 'idle_on_tab') {
            if (!nextActiveEv) nextActiveEv = sorted[j];
          }
        }
        if (endedEv && endedEv.payloadObj.idleMs) {
          totalIdleMs += Number(endedEv.payloadObj.idleMs);
        } else if (nextActiveEv) {
          const stretch = (nextActiveEv.ts - ev.ts) + initialIdleMs;
          totalIdleMs += Math.max(stretch, initialIdleMs);
        } else {
          totalIdleMs += initialIdleMs;
        }
      }
    }
    return totalIdleMs;
  }

  function computeSessionStats(events) {
    const sorted = (events || [])
      .filter(e => e.clientTime)
      .map(e => ({ ...e, ts: new Date(e.clientTime).getTime() }))
      .sort((a, b) => a.ts - b.ts);

    let totalSpanMs = 0, hiddenMs = 0, sessionCount = 0;

    if (sorted.length >= 2) {
      const sessions = [[sorted[0]]];
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].ts - sorted[i - 1].ts;
        if (gap > SESSION_GAP_MS) {
          sessions.push([sorted[i]]);
        } else {
          sessions[sessions.length - 1].push(sorted[i]);
        }
      }

      sessions.forEach(session => {
        if (session.length < 2) return;
        sessionCount++;
        totalSpanMs += session[session.length - 1].ts - session[0].ts;

        let hideStart = null;
        session.forEach(e => {
          if (e.eventType === 'tab_hidden') hideStart = e.ts;
          if (e.eventType === 'tab_visible' && hideStart !== null) {
            hiddenMs += (e.ts - hideStart);
            hideStart = null;
          }
        });
      });
    }

    const idleMs = computeIdleMs(events);
    const activeMs = Math.max(totalSpanMs - hiddenMs - idleMs, 0);

    const counts = {};
    (events || []).forEach(e => { counts[e.eventType] = (counts[e.eventType] || 0) + 1; });

    return { sorted, totalSpanMs, hiddenMs, idleMs, activeMs, sessionCount, counts };
  }

  // Compute a suspicious level for a question based on multiple signals
  function computeSuspiciousLevel(qStats, qEvents) {
    const reasons = [];
    let score = 0;

    const pasteCount = qStats.counts.paste_attempt || 0;
    const largeChanges = qStats.counts.large_change || 0;
    const tabChanges = qStats.counts.tab_hidden || 0;
    const aiUsed = qStats.counts.ai_explain_used || 0;
    const runs = qStats.counts.run_clicked || 0;
    const activeMs = qStats.activeMs || 0;

    // Paste attempts
    if (pasteCount >= 3) { score += 3; reasons.push(`${pasteCount} paste attempts (high)`); }
    else if (pasteCount >= 1) { score += 1.5; reasons.push(`${pasteCount} paste attempt(s)`); }

    // Large text jumps (sudden code appearance)
    if (largeChanges >= 2) { score += 3; reasons.push(`${largeChanges} sudden large text jumps`); }
    else if (largeChanges >= 1) { score += 2; reasons.push(`${largeChanges} large text jump detected`); }

    // Very low active time with a submission
    if (activeMs < 60 * 1000 && runs > 0) { score += 3; reasons.push('Submitted in under 1 min of active coding'); }
    else if (activeMs < 2.5 * 60 * 1000 && runs <= 1) { score += 2; reasons.push('Very short active coding time'); }

    // Excessive tab changes (looking up answers)
    if (tabChanges >= 10) { score += 2; reasons.push(`${tabChanges} tab changes (very high)`); }
    else if (tabChanges >= 5) { score += 1; reasons.push(`${tabChanges} tab changes`); }

    // AI usage
    if (aiUsed >= 3) { score += 1.5; reasons.push(`AI explanation used ${aiUsed} times`); }
    else if (aiUsed >= 1) { score += 0.5; reasons.push(`AI explanation used ${aiUsed} time(s)`); }

    let level, levelColor, levelBg;
    if (score >= 6) {
      level = 'Very High';
      levelColor = '#b91c1c';
      levelBg = '#fef2f2';
    } else if (score >= 3.5) {
      level = 'High';
      levelColor = '#d97706';
      levelBg = '#fffbeb';
    } else if (score >= 1.5) {
      level = 'Medium';
      levelColor = '#1d4ed8';
      levelBg = '#eff6ff';
    } else {
      level = 'Low';
      levelColor = '#15803d';
      levelBg = '#f0fdf4';
    }

    return { level, levelColor, levelBg, score, reasons };
  }

  async function fetchReportData(assignmentId, studentId) {
    let assignment = null;
    let questions = [];
    let studentData = null;
    let isTeacher = false;

    // First try the dedicated report endpoint (accessible by both student and teacher)
    try {
      const repRes = await fetch(`/api/code-lab/assignments/${assignmentId}/report/${studentId}`);
      if (repRes.ok) {
        const repJson = await repRes.json();
        assignment = repJson.assignment;
        questions = repJson.questions || [];
        studentData = repJson.studentData;
        isTeacher = Boolean(repJson.isTeacher);
      }
    } catch (_) { }

    if (!studentData) {
      assignment = await fetch(`/api/code-lab/assignments/${assignmentId}`).then(r => r.json());
      questions = assignment.questions || [];
      const allSubmissions = await fetch(`/api/code-lab/assignments/${assignmentId}/submissions`).then(r => r.json());
      const studentList = Array.isArray(allSubmissions) ? allSubmissions : (allSubmissions && allSubmissions.students ? allSubmissions.students : []);
      studentData = studentList.find(s => String(s.studentId) === String(studentId));
      isTeacher = true;
    }

    if (!studentData || !studentData.submissions || studentData.submissions.length === 0) {
      throw new Error('No submission found for this student on this assignment.');
    }

    // Fetch events for ALL questions for this student
    let allEvents = [];
    try {
      allEvents = await fetch(`/api/code-lab/assignments/${assignmentId}/events/${studentId}`).then(r => r.ok ? r.json() : []);
    } catch (_) { }

    const eventsByQuestion = {};
    (allEvents || []).forEach(e => {
      const qId = e.questionId || 'unknown';
      if (!eventsByQuestion[qId]) eventsByQuestion[qId] = [];
      eventsByQuestion[qId].push(e);
    });

    const combinedStats = computeSessionStats(allEvents);

    // Clock mismatch check
    const DRIFT_THRESHOLD_MS = 2 * 60 * 1000;
    let maxDriftMs = 0;
    const batches = {};
    (allEvents || []).forEach(e => {
      if (!e.serverReceivedAt) return;
      (batches[e.serverReceivedAt] = batches[e.serverReceivedAt] || []).push(e);
    });
    Object.entries(batches).forEach(([serverTime, batchEvents]) => {
      const serverTs = new Date(serverTime).getTime();
      batchEvents.forEach(e => {
        if (!e.clientTime) return;
        const drift = Math.abs(new Date(e.clientTime).getTime() - serverTs);
        if (drift > maxDriftMs) maxDriftMs = drift;
      });
    });
    const clockMismatchDetected = maxDriftMs > DRIFT_THRESHOLD_MS;

    // Similarity warnings
    let studentSimWarnings = [];
    try {
      const simResults = await Promise.all(
        questions.map(q =>
          fetch(`/api/code-lab/questions/${q.id}/similarity`)
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        )
      );
      studentSimWarnings = simResults.flat().filter(w =>
        String(w.studentA) === String(studentId) || String(w.studentB) === String(studentId)
      );
    } catch (_) { }

    const pasteCount = combinedStats.counts.paste_attempt || 0;
    const largeChangeCount = combinedStats.counts.large_change || 0;
    const flagReasons = [];
    if (pasteCount > 0) {
      flagReasons.push(`${pasteCount} direct paste attempt${pasteCount === 1 ? '' : 's'} recorded during session.`);
    }
    if (largeChangeCount > 0) {
      flagReasons.push(`${largeChangeCount} sudden large text jump${largeChangeCount === 1 ? '' : 's'} detected.`);
    }
    studentSimWarnings.forEach(w => {
      const otherStudent = String(w.studentA) === String(studentId) ? (w.studentBName || w.studentB) : (w.studentAName || w.studentA);
      flagReasons.push(`High code similarity (${w.similarityPercent}%) detected on Question ${w.questionNumber} with ${otherStudent}.`);
    });

    return {
      isTeacher,
      assignment,
      questions,
      studentData,
      allEvents,
      eventsByQuestion,
      combinedStats,
      clockMismatchDetected,
      maxDriftMs,
      studentSimWarnings,
      flagReasons
    };
  }

  function renderReportDOM(container, data, options = {}) {
    const { isBulk = false, uid = Math.random().toString(36).slice(2, 7) } = options;
    const {
      assignment,
      questions,
      studentData,
      eventsByQuestion,
      combinedStats,
      clockMismatchDetected,
      maxDriftMs,
      studentSimWarnings,
      flagReasons
    } = data;

    const studentName = studentData.studentName || 'Student';
    const studentId = studentData.studentId;

    // Find the latest submission date
    const latestSub = (studentData.submissions || []).reduce((latest, s) => {
      if (!s.submittedAt) return latest;
      const ts = new Date(s.submittedAt).getTime();
      return !latest || ts > latest.ts ? { ts, iso: s.submittedAt } : latest;
    }, null);
    const submittedDateStr = latestSub ? fmtDate(latestSub.iso) : '—';

    const generatedTimeStr = fmtTime(new Date().toISOString());

    // Compute grading values for scorecard / marksheet
    let totalMaxPoints = 0;
    let totalMarksObtained = 0;
    let anyGraded = false;
    let allGraded = questions.length > 0;
    let firstGradedBy = null;
    let firstGradedAt = null;

    const scoredQuestions = questions.map((q, idx) => {
      const sub = (studentData.submissions || []).find(s => Number(s.questionId) === q.id);
      const maxPts = (sub && sub.maxPoints != null) ? Number(sub.maxPoints) : (q.maxPoints != null ? Number(q.maxPoints) : 10);
      totalMaxPoints += maxPts;

      let marksText = '';
      let marksRaw = null;
      if (sub && sub.marksObtained !== null && sub.marksObtained !== undefined) {
        marksRaw = Number(sub.marksObtained);
        totalMarksObtained += marksRaw;
        marksText = `${marksRaw} / ${maxPts}`;
        anyGraded = true;
        if (!firstGradedBy && sub.gradedBy) firstGradedBy = sub.gradedBy;
        if (!firstGradedAt && sub.gradedAt) firstGradedAt = sub.gradedAt;
      } else {
        allGraded = false;
        marksText = `— / ${maxPts}`;
      }

      const isChecked = sub ? Boolean(sub.checked) : false;

      return {
        q,
        maxPts,
        marksText,
        marksRaw,
        isChecked,
        remarks: sub ? sub.remarks : null
      };
    });

    let totalScoreDisplay = '';
    if (allGraded && questions.length > 0) {
      totalScoreDisplay = `${totalMarksObtained} / ${totalMaxPoints}`;
    } else if (anyGraded) {
      totalScoreDisplay = `${totalMarksObtained} / ${totalMaxPoints} <span style="font-size:12px; font-weight:600; color:#6b7280;">(partial)</span>`;
    } else {
      totalScoreDisplay = `— / ${totalMaxPoints}`;
    }

    // ════════════════════════════════════════════════════════════════
    // PAGE 1 — COVER PAGE
    // ════════════════════════════════════════════════════════════════
    let html = `
      <div class="report-cover-wrapper" style="
        min-height: 740px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 30px 0;
        page-break-inside: avoid;
        break-inside: avoid;
        box-sizing: border-box;
      ">
        <div style="
          width: 100%;
          max-width: 600px;
          border: 2.5px solid #1a1a2e;
          border-radius: 20px;
          overflow: hidden;
          background: #ffffff;
          box-shadow: 0 8px 40px rgba(0,0,0,0.07);
        ">
          <!-- Header band -->
          <div style="
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
            padding: 32px 36px 28px;
            text-align: center;
          ">
            <div style="font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.55); margin-bottom: 10px;">
              Gandaki University
            </div>
            <div style="font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; line-height: 1.2; margin-bottom: 6px;">
              Assignment Report
            </div>
            <div style="font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.6);">
              Code Lab — Academic Submission
            </div>
          </div>

          <!-- Info grid -->
          <div style="padding: 32px 36px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tbody>
                <tr>
                  <td colspan="2" style="padding-bottom: 22px;">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 6px;">Assignment Name</div>
                    <div style="font-size: 20px; font-weight: 800; color: #111827; letter-spacing: -0.01em;">${escapeHtml(assignment.title)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="width: 50%; padding-bottom: 18px; vertical-align: top;">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 4px;">Semester</div>
                    <div style="font-size: 15px; font-weight: 700; color: #111827;">${assignment.semester ? 'Semester ' + escapeHtml(String(assignment.semester)) : '—'}</div>
                  </td>
                  <td style="width: 50%; padding-bottom: 18px; vertical-align: top;">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 4px;">Subject</div>
                    <div style="font-size: 15px; font-weight: 700; color: #111827;">${assignment.subject ? escapeHtml(assignment.subject) : '—'}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 18px; vertical-align: top;">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 4px;">Teacher Name</div>
                    <div style="font-size: 15px; font-weight: 700; color: #111827;">${firstGradedBy ? escapeHtml(firstGradedBy) : (assignment.teacherName ? escapeHtml(assignment.teacherName) : '—')}</div>
                  </td>
                  <td style="padding-bottom: 18px; vertical-align: top;">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 4px;">Student Name</div>
                    <div style="font-size: 15px; font-weight: 700; color: #111827;">${escapeHtml(studentName)}</div>
                  </td>
                </tr>
                <tr>
                  <td colspan="2">
                    <div style="border-top: 1.5px dashed #e5e7eb; padding-top: 18px; display: flex; align-items: center; justify-content: space-between;">
                      <div>
                        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 4px;">Submitted Date</div>
                        <div style="font-size: 15px; font-weight: 700; color: #111827;">${submittedDateStr}</div>
                      </div>
                      <div style="text-align: right;">
                        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 4px;">Report Generated</div>
                        <div style="font-size: 12px; font-weight: 600; color: #4b5563;">${escapeHtml(generatedTimeStr)}</div>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Footer band -->
          <div style="
            background: #f9fafb;
            border-top: 1.5px solid #e5e7eb;
            padding: 14px 36px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          ">
            <div style="font-size: 11.5px; font-weight: 600; color: #6b7280;">Student ID: ${escapeHtml(String(studentId))}</div>
            <div style="font-size: 11.5px; font-weight: 600; color: #6b7280;">${questions.length} Question${questions.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>
    `;

    // ════════════════════════════════════════════════════════════════
    // PAGE 2 — MARKSHEET / CHECKED SHEET
    // ════════════════════════════════════════════════════════════════
    html += `
      <div class="marksheet-page page-break-before" style="
        page-break-before: always;
        break-before: page;
        page-break-inside: avoid;
        break-inside: avoid;
        padding: 24px 0 20px;
        box-sizing: border-box;
      ">
        <!-- Marksheet header -->
        <div style="border-bottom: 2.5px solid #1a1a2e; padding-bottom: 18px; margin-bottom: 28px;">
          <div style="font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7280; margin-bottom: 4px;">Gandaki University — Code Lab</div>
          <div style="font-size: 22px; font-weight: 800; color: #111827; letter-spacing: -0.01em;">Assignment Marksheet</div>
          <div style="font-size: 13px; color: #4b5563; margin-top: 4px;">
            ${escapeHtml(assignment.title)}
            ${assignment.subject ? ' · ' + escapeHtml(assignment.subject) : ''}
            ${assignment.semester ? ' · Semester ' + escapeHtml(String(assignment.semester)) : ''}
          </div>
          <div style="font-size: 13px; color: #4b5563; margin-top: 2px;">
            Student: <strong>${escapeHtml(studentName)}</strong> &nbsp;·&nbsp; Submitted: <strong>${submittedDateStr}</strong>
          </div>
        </div>

        <!-- Marksheet table -->
        <table style="
          width: 100%;
          border-collapse: collapse;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', Helvetica, Arial, sans-serif;
          border: 1.5px solid #d1d5db;
          border-radius: 12px;
          overflow: hidden;
        ">
          <thead>
            <tr style="background: #1a1a2e;">
              <th style="padding: 13px 16px; text-align: left; font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.12);">#</th>
              <th style="padding: 13px 16px; text-align: left; font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.12); width: 40%;">Title</th>
              <th style="padding: 13px 16px; text-align: center; font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.12);">Status</th>
              <th style="padding: 13px 16px; text-align: center; font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.12);">Marks</th>
              <th style="padding: 13px 16px; text-align: left; font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #ffffff;">Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${scoredQuestions.map(({ q, maxPts, marksText, marksRaw, isChecked, remarks }, idx) => {
              const isEven = idx % 2 === 0;
              const statusLabel = isChecked ? 'Checked' : 'Unchecked';
              const statusColor = isChecked ? '#15803d' : '#b45309';
              const statusBg = isChecked ? '#dcfce7' : '#fef3c7';
              const statusBorder = isChecked ? '#bbf7d0' : '#fde68a';

              return `
                <tr style="background: ${isEven ? '#ffffff' : '#f9fafb'}; border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 13px 16px; font-size: 13px; font-weight: 700; color: #6b7280; border-right: 1px solid #f3f4f6;">${q.questionNumber || (idx + 1)}</td>
                  <td style="padding: 13px 16px; font-size: 12.5px; font-weight: 600; color: #111827; border-right: 1px solid #f3f4f6; line-height: 1.4; font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;">
                    ${escapeHtml(q.title)}
                  </td>
                  <td style="padding: 13px 16px; text-align: center; border-right: 1px solid #f3f4f6;">
                    ${data.isTeacher && !isBulk
                      ? `<label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:12.5px; font-weight:700; color:${statusColor}; background:${statusBg}; border:1px solid ${statusBorder}; padding:3px 12px; border-radius:980px;">
                           <input type="checkbox" class="q-eval-checked" data-qid="${q.id}" ${isChecked ? 'checked' : ''} onchange="ReportGenerator.syncScorecard()" style="accent-color:${statusColor};">
                           <span class="status-label-text">${statusLabel}</span>
                         </label>`
                      : `<span style="display:inline-block; font-size:13px; font-weight:800; color:#111827; padding:4px 0; letter-spacing:0.02em;">${isChecked ? '☑ Checked' : '☐ Unchecked'}</span>`
                    }
                  </td>
                  <td style="padding: 13px 16px; text-align: center; border-right: 1px solid #f3f4f6;">
                    ${data.isTeacher && !isBulk
                      ? `<div style="display:flex; align-items:center; justify-content:center; gap:5px;">
                           <input type="number" min="0" max="${maxPts}" step="1"
                                  class="q-eval-marks" data-qid="${q.id}" data-max="${maxPts}"
                                  value="${marksRaw != null ? marksRaw : ''}"
                                  placeholder="—"
                                  oninput="ReportGenerator.syncScorecard()"
                                  style="width:60px; padding:5px 8px; font-size:14px; font-weight:700; font-family:Menlo,Monaco,Consolas,monospace; border:1.5px solid #d1d5db; border-radius:7px; text-align:center;">
                           <span style="font-size:13px; font-weight:600; color:#4b5563;">/ ${maxPts}</span>
                         </div>`
                      : `<span id="scMarks_${q.id}" class="scorecard-task-marks" style="font-family:Menlo,Monaco,Consolas,monospace; font-size:14px; font-weight:700; color:#111827;">${marksText}</span>`
                    }
                  </td>
                  <td style="padding: 13px 16px; font-size: 12.5px; color: #4b5563; font-style: italic;">
                    ${data.isTeacher && !isBulk
                      ? `<textarea class="q-eval-remarks" data-qid="${q.id}"
                                  placeholder="Feedback..."
                                  rows="2"
                                  oninput="ReportGenerator.syncScorecard()"
                                  style="width:100%; box-sizing:border-box; padding:6px 10px; font-size:12.5px; font-family:inherit; border:1.5px solid #e5e7eb; border-radius:7px; resize:vertical; color:#374151;">${escapeHtml(remarks || '')}</textarea>`
                      : `<span id="scRemarks_${q.id}" class="scorecard-task-remarks" style="${remarks ? '' : 'color:#9ca3af; font-style:normal;'}">${remarks ? escapeHtml(remarks) : 'No remarks'}</span>`
                    }
                  </td>
                </tr>
              `;
            }).join('')}

            <!-- Total row -->
            <tr style="background: #1a1a2e;">
              <td colspan="3" style="padding: 14px 16px; font-size: 13px; font-weight: 800; color: #ffffff; text-transform: uppercase; letter-spacing: 0.05em;">Total Score</td>
              <td colspan="2" style="padding: 14px 16px; font-size: 16px; font-weight: 800; font-family: Menlo, Monaco, Consolas, monospace; color: #ffffff; text-align: center;">
                <span id="scTotal" class="scorecard-total-val">${totalScoreDisplay}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Teacher signature row -->
        <div style="margin-top: 28px; display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 600; color: #4b5563; border-top: 1.5px solid #e5e7eb; padding-top: 18px;">
          <span>Graded By: <strong>${firstGradedBy ? escapeHtml(firstGradedBy) : '_______________________________'}</strong></span>
          <span>${firstGradedAt ? 'Date: ' + escapeHtml(fmtTime(firstGradedAt)) + '  ·  ' : ''}Instructor Signature: _______________________________</span>
        </div>
      </div>
    `;

    // ════════════════════════════════════════════════════════════════
    // PAGE 3+ — PER-QUESTION ANALYSIS
    // ════════════════════════════════════════════════════════════════

    // Helper: split Prism-highlighted HTML by newlines while keeping valid tags per line
    function splitHighlightedHTML(html) {
      const rawLines = html.split('\n');
      const result = [];
      let openTags = [];

      for (const rawLine of rawLines) {
        const prefix = openTags.join('');
        const fullLine = prefix + rawLine;

        // Track which span tags are still open after this line
        let stack = [];
        const allTags = fullLine.match(/<\/?span[^>]*>/g) || [];
        for (const tag of allTags) {
          if (tag.startsWith('</')) {
            if (stack.length > 0) stack.pop();
          } else {
            stack.push(tag);
          }
        }

        // Close unclosed spans at end of line
        const suffix = stack.slice().reverse().map(() => '</span>').join('');
        result.push(fullLine + suffix);
        openTags = stack;
      }
      return result;
    }

    // Helper: render code with line numbers (IDE-style with syntax highlighting)
    function renderCodeWithLineNumbers(code, language) {
      if (!code) return '';
      const lines = code.split('\n');
      const gutterWidth = String(lines.length).length;

      // Syntax highlighting via Prism.js if available
      const prismLangMap = { 'c': 'c', 'cpp': 'cpp', 'java': 'java', 'python': 'python', 'py': 'python', 'javascript': 'javascript', 'js': 'javascript' };
      const prismLang = prismLangMap[(language || '').toLowerCase()] || 'clike';
      let highlightedLines = lines.map(l => escapeHtml(l));

      if (typeof Prism !== 'undefined' && Prism.languages[prismLang]) {
        try {
          const highlighted = Prism.highlight(code, Prism.languages[prismLang], prismLang);
          highlightedLines = splitHighlightedHTML(highlighted);
        } catch (e) {
          // fallback to plain escaped text
        }
      }

      let rowsHtml = '';
      lines.forEach((line, i) => {
        const num = String(i + 1).padStart(gutterWidth, ' ');
        const lineContent = highlightedLines[i] || escapeHtml(line) || ' ';
        rowsHtml += `
          <div style="display:flex; line-height:1.7;">
            <div style="
              width:${gutterWidth * 9 + 20}px;
              padding:0 12px 0 14px;
              text-align:right;
              color:#6c7086;
              border-right:1px solid rgba(255,255,255,0.07);
              flex-shrink:0;
              user-select:none;
              white-space:pre;
              font-size:13px;
            ">${num}</div>
            <div style="
              padding-left:16px;
              color:#cdd6f4;
              white-space:pre-wrap;
              word-break:break-all;
              flex:1;
              font-size:13.5px;
            ">${lineContent || ' '}</div>
          </div>
        `;
      });

      const langLabel = (language || 'c').toUpperCase();
      const fileExtMap = { 'C': '.c', 'JAVA': '.java', 'PYTHON': '.py', 'CPP': '.cpp', 'JAVASCRIPT': '.js', 'JS': '.js', 'PY': '.py' };
      const ext = fileExtMap[langLabel] || '';
      const fileName = `solution${ext}`;

      return `
        <div style="border:1.5px solid #DADCE0; border-radius:16px; overflow:hidden; margin-bottom:16px;">
          <!-- File tab bar -->
          <div style="
            background:#161B20;
            padding:10px 18px;
            display:flex;
            align-items:center;
            justify-content:space-between;
            border-bottom:1px solid rgba(218,220,224,0.12);
          ">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="display:flex; gap:7px;">
                <span style="width:11px; height:11px; border-radius:50%; background:#ff5f56; display:inline-block;"></span>
                <span style="width:11px; height:11px; border-radius:50%; background:#ffbd2e; display:inline-block;"></span>
                <span style="width:11px; height:11px; border-radius:50%; background:#27c93f; display:inline-block;"></span>
              </div>
              <span style="font-size:12.5px; font-weight:600; color:#E8EAED; font-family:'JetBrains Mono Nerd Font','JetBrains Mono','Fira Code',monospace; margin-left:8px;">${escapeHtml(fileName)}</span>
            </div>
          </div>
          <!-- Code area with syntax highlighting -->
          <div style="
            background:#1E242A;
            padding:14px 0;
            font-family:'JetBrains Mono Nerd Font','JetBrains Mono','Fira Code',ui-monospace,monospace;
            font-weight:500;
            letter-spacing:0.25px;
          ">
            ${rowsHtml}
          </div>
        </div>
      `;
    }

    for (const q of questions) {
      const sub = (studentData.submissions || []).find(s => Number(s.questionId) === q.id);
      const maxPts = (sub && sub.maxPoints != null) ? Number(sub.maxPoints) : (q.maxPoints != null ? Number(q.maxPoints) : 10);
      const qEvents = eventsByQuestion[q.id] || [];
      const qStats = computeSessionStats(qEvents);

      // Counts for this question
      const pasteCount = qStats.counts.paste_attempt || 0;
      const tabChanges = qStats.counts.tab_hidden || 0;
      const aiCount = qStats.counts.ai_explain_used || 0;
      const runEvents = qEvents.filter(e => e.eventType === 'run_clicked');
      const totalRuns = runEvents.length;
      let failedRuns = 0;
      runEvents.forEach(e => {
        let p = {};
        try { p = typeof e.payload === 'string' ? JSON.parse(e.payload || '{}') : (e.payload || {}); } catch (_) { }
        if (!(p.success === true || p.exitStatus === 'success')) failedRuns++;
      });
      const totalErrors = failedRuns;

      // Total code duration
      const codeDuration = qStats.totalSpanMs;

      // Automated Test Cases
      let testCasesHtml = '';
      let parsedResults = null;
      if (sub && sub.testResults) {
        parsedResults = Array.isArray(sub.testResults) ? sub.testResults : (typeof sub.testResults === 'string' ? JSON.parse(sub.testResults) : null);
      }
      if (parsedResults && Array.isArray(parsedResults) && parsedResults.length > 0) {
        const passedCount = parsedResults.filter(tc => tc.passed).length;
        const totalCount = parsedResults.length;
        const allPassed = passedCount === totalCount;
        const failedCases = parsedResults.filter(tc => !tc.passed);

        testCasesHtml = `
          <div style="margin: 10px 0 14px 0; padding: 11px 15px; border-radius: 9px; background: ${allPassed ? '#f0fdf4' : '#fffbeb'}; border: 1px solid ${allPassed ? '#bbf7d0' : '#fde68a'};">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span style="font-size:15px;">${allPassed ? '✅' : '⚠️'}</span>
              <span style="font-size:13px; font-weight:700; color:${allPassed ? '#166534' : '#92400e'};">Test Cases: Passed ${passedCount}/${totalCount}</span>
              <span style="font-size:11.5px; font-weight:700; padding:2px 10px; border-radius:980px; background:${allPassed ? '#dcfce7' : '#fef3c7'}; color:${allPassed ? '#15803d' : '#b45309'};">
                ${allPassed ? 'All Passed' : `${totalCount - passedCount} Failed`}
              </span>
            </div>
            ${failedCases.length > 0 ? `
              <div style="margin-top:9px; display:flex; flex-direction:column; gap:6px;">
                ${failedCases.map((fc, fcIdx) => `
                  <div style="background:#fff; border:1px solid #fed7aa; border-radius:7px; padding:9px 12px; font-size:12px;">
                    <div style="font-weight:700; color:#9a3412; margin-bottom:3px;">Failed Case #${fcIdx + 1}</div>
                    ${fc.input ? `<div><strong style="color:#4b5563;">Input:</strong> <code style="background:#f3f4f6; padding:1px 5px; border-radius:4px;">${escapeHtml(fc.input)}</code></div>` : '<div style="color:#6b7280;font-style:italic;">No stdin</div>'}
                    <div><strong style="color:#4b5563;">Expected:</strong> <code style="background:#f0fdf4; color:#166534; padding:1px 5px; border-radius:4px;">${escapeHtml(fc.expected)}</code></div>
                    <div><strong style="color:#4b5563;">Actual:</strong> <code style="background:#fef2f2; color:#991b1b; padding:1px 5px; border-radius:4px;">${escapeHtml(fc.actual || '— (empty)')}</code></div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }

      // ════════════════════════════════════════════════════════════════
      // PAGE A OF QUESTION — 1 QUESTION (CODE BOX AND RESULT)
      // ════════════════════════════════════════════════════════════════
      html += `
        <div class="question-code-page page-break-before" style="
          page-break-before: always;
          break-before: page;
          page-break-inside: avoid;
          break-inside: avoid;
          padding: 20px 0 16px;
          box-sizing: border-box;
        ">
          <!-- Bordered question card -->
          <div style="
            border: 1.5px solid #d1d5db;
            border-radius: 14px;
            overflow: hidden;
            background: #ffffff;
            box-shadow: 0 1px 4px rgba(0,0,0,0.03);
          ">
            <!-- Question header bar -->
            <div style="
              background: #f9fafb;
              border-bottom: 1.5px solid #d1d5db;
              padding: 16px 20px;
            ">
              <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                <div>
                  <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:#6b7280; margin-bottom:2px;">Question ${q.questionNumber || 1}</div>
                  <div style="font-size:14.5px; font-weight:700; color:#111827; line-height:1.35;">${escapeHtml(q.title)}</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:12px; color:#6b7280;">
                    ${sub ? 'Submitted: ' + fmtTime(sub.submittedAt) + (assignment.deadline ? ' ' + deadlineBadge(assignment.deadline, sub.submittedAt) : '') : '<span style="color:#ef4444; font-weight:600;">Not submitted</span>'}
                  </div>
                </div>
              </div>
            </div>

            <!-- Card body -->
            <div style="padding: 18px 20px;">
              <!-- Problem statement -->
              ${q.description ? `
                <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#6b7280; margin-bottom:6px;">Problem Statement</div>
                <div style="font-size:13px; line-height:1.55; color:#374151; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:10px 14px; margin-bottom:14px; white-space:pre-wrap;">${escapeHtml(q.description)}</div>
              ` : ''}

              <!-- Code (IDE-style with line numbers) -->
              <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#6b7280; margin-bottom:6px;">Code</div>
              ${sub
                ? renderCodeWithLineNumbers(sub.code, q.language)
                : `<div style="padding:14px; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; font-size:13px; color:#b91c1c; margin-bottom:16px;">No code submitted for this question.</div>`
              }

              <!-- Result / Output -->
              ${sub ? `
                <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#6b7280; margin-bottom:6px; margin-top:10px;">Result</div>
                ${testCasesHtml}
                <div style="border:1.5px solid rgba(0,0,0,0.18); border-radius:14px; overflow:hidden; margin-bottom:16px; margin-top:10px;">
                  <div style="background:#11111b; padding:10px 18px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.08);">
                    <span style="font-size:12px; font-weight:700; color:#a6adc8; font-family:Menlo,Monaco,Consolas,monospace; display:flex; align-items:center; gap:6px; letter-spacing:0.03em;">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
                      Terminal Console
                    </span>
                  </div>
                  <div style="background:#181825; padding:18px 22px; font-family:Menlo,Monaco,Consolas,'SF Mono','Courier New',monospace; font-size:13.5px; line-height:1.65; min-height:54px;">
                    ${sub.stdout ? `<pre style="margin:0; color:#cdd6f4; white-space:pre-wrap; word-break:break-word;">${escapeHtml(sub.stdout)}</pre>` : (!parsedResults && !sub.stderr ? `<div style="color:#6c7086; font-family:-apple-system,sans-serif;">No output recorded.</div>` : '')}
                    ${sub.stderr ? `<pre style="margin:${sub.stdout ? '8px' : '0'} 0 0 0; color:#e4e4e7; white-space:pre-wrap; word-break:break-word;">${escapeHtml(sub.stderr)}</pre>` : ''}
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `;

      // ════════════════════════════════════════════════════════════════
      // PAGE B OF QUESTION — SESSION DETAILS, CODE GROWTH, TYPING RHYTHM
      // ════════════════════════════════════════════════════════════════
      html += `
        <div class="question-analytics-page page-break-before" style="
          page-break-before: always;
          break-before: page;
          page-break-inside: avoid;
          break-inside: avoid;
          padding: 20px 0 16px;
          box-sizing: border-box;
        ">
          <!-- Bordered analytics card -->
          <div style="
            border: 1.5px solid #d1d5db;
            border-radius: 14px;
            overflow: hidden;
            background: #ffffff;
            box-shadow: 0 1px 4px rgba(0,0,0,0.03);
          ">
            <!-- Analytics header bar -->
            <div style="
              background: #f9fafb;
              border-bottom: 1.5px solid #d1d5db;
              padding: 16px 20px;
            ">
              <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <div>
                  <div style="font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#374151;">
                    Question ${q.questionNumber || 1} — Activity & Session Analytics
                  </div>
                </div>
              </div>
            </div>

            <!-- Analytics body -->
            <div style="padding: 20px 22px;">
              <!-- 1. SESSION DETAILS -->
              <div>
                <div style="font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#4b5563; margin-bottom:8px;">
                  Session Details
                </div>
                <table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
                  <thead>
                    <tr style="background:#f3f4f6;">
                      <th style="padding:8px 14px; text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#4b5563; border-bottom:1px solid #e5e7eb;">Metric</th>
                      <th style="padding:8px 14px; text-align:center; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#4b5563; border-bottom:1px solid #e5e7eb; width:35%;">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style="border-bottom:1px solid #f3f4f6;">
                      <td style="padding:8px 14px; font-size:12.5px; color:#374151;">Copy/Paste Attempts</td>
                      <td style="padding:8px 14px; text-align:center; font-size:13px; font-weight:700; color:${pasteCount > 0 ? '#dc2626' : '#111827'};">${pasteCount}</td>
                    </tr>
                    <tr style="background:#f9fafb; border-bottom:1px solid #f3f4f6;">
                      <td style="padding:8px 14px; font-size:12.5px; color:#374151;">Total Code Duration</td>
                      <td style="padding:8px 14px; text-align:center; font-size:13px; font-weight:700; color:#111827;">${fmtDuration(codeDuration)}</td>
                    </tr>
                    <tr style="border-bottom:1px solid #f3f4f6;">
                      <td style="padding:8px 14px; font-size:12.5px; color:#374151;">Total Errors (Failed Runs)</td>
                      <td style="padding:8px 14px; text-align:center; font-size:13px; font-weight:700; color:${totalErrors > 0 ? '#dc2626' : '#111827'};">${totalErrors}</td>
                    </tr>
                    <tr style="background:#f9fafb; border-bottom:1px solid #f3f4f6;">
                      <td style="padding:8px 14px; font-size:12.5px; color:#374151;">Total AI Asks</td>
                      <td style="padding:8px 14px; text-align:center; font-size:13px; font-weight:700; color:${aiCount > 0 ? '#1d4ed8' : '#111827'};">${aiCount}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 14px; font-size:12.5px; color:#374151;">Total Tab Changes</td>
                      <td style="padding:8px 14px; text-align:center; font-size:13px; font-weight:700; color:${tabChanges > 4 ? '#b45309' : '#111827'};">${tabChanges}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- 2. CODE GROWTH -->
              <div style="margin-top:18px; border-top:1px solid #e5e7eb; padding-top:14px;">
                <div style="font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#4b5563; margin-bottom:8px;">
                  Code Growth
                </div>
                <div style="background:#fafafa; border:1px solid #e5e7eb; border-radius:8px; padding:10px 14px;">
                  <canvas id="growthChart_${q.id}_${uid}" height="68"></canvas>
                </div>
              </div>

              <!-- 3. TYPING RHYTHM -->
              <div style="margin-top:16px; border-top:1px solid #e5e7eb; padding-top:14px;">
                <div style="font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#4b5563; margin-bottom:6px;">
                  Typing Rhythm
                </div>
                <div id="rhythmNote_${q.id}_${uid}" style="margin-bottom:6px;"></div>
                <div style="background:#fafafa; border:1px solid #e5e7eb; border-radius:8px; padding:10px 14px;">
                  <canvas id="rhythmChart_${q.id}_${uid}" height="68"></canvas>
                </div>
              </div>

              <!-- Teacher eval box (inline, teacher-only) -->
              ${(data.isTeacher && !isBulk) ? `
                <div class="instructor-eval-box" style="display:none;"></div>
              ` : (sub && (sub.marksObtained != null || sub.remarks) ? `
                <div style="margin-top:16px; padding:11px 16px; background:#f0fdf4; border:1.5px solid #bbf7d0; border-radius:9px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
                    <span style="font-size:11px; font-weight:800; text-transform:uppercase; color:#166534; letter-spacing:0.04em;">Instructor Evaluation</span>
                    <span style="font-family:Menlo,Monaco,Consolas,monospace; font-size:13.5px; font-weight:700; color:#15803d;">Score: ${sub.marksObtained != null ? sub.marksObtained : '—'} / ${maxPts} pts</span>
                  </div>
                  ${sub.remarks ? `<div style="font-size:12.5px; color:#166534; line-height:1.45; font-style:italic;">"${escapeHtml(sub.remarks)}"</div>` : ''}
                </div>
              ` : '')}
            </div>
          </div>
        </div>
      `;
    }

    // ════════════════════════════════════════════════════════════════
    // LAST — EVENT TIMELINE + TOTAL CODE TIME
    // ════════════════════════════════════════════════════════════════
    html += `
      <div class="timeline-page page-break-before" style="
        margin-top: 0;
        page-break-before: always;
        break-before: page;
        padding-top: 28px;
        box-sizing: border-box;
      ">
        <div style="border-bottom:2.5px solid #1a1a2e; padding-bottom:12px; margin-bottom:22px;">
          <div style="font-size:11px; font-weight:800; letter-spacing:0.12em; text-transform:uppercase; color:#6b7280; margin-bottom:3px;">Code Lab Report</div>
          <div style="font-size:19px; font-weight:800; color:#111827;">Event Timeline</div>
        </div>

        <div id="eventList_${uid}" style="margin-bottom:32px;"></div>

        <!-- Total code time — the only summary stat -->
        <div style="
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
          border-radius: 14px;
          padding: 20px 26px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        ">
          <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.65);">Total Code Time — Whole Assignment</div>
          <div style="font-size: 26px; font-weight: 800; font-family: Menlo, Monaco, Consolas, monospace; color: #ffffff; letter-spacing: -0.02em;">${fmtDuration(combinedStats.totalSpanMs)}</div>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // ── Chart.js Chart Initializations ──────────────────────────────────
    if (typeof Chart !== 'undefined') {
      const chartOptions = { responsive: true, animation: isBulk ? false : true };

      // Per-question charts
      for (const q of questions) {
        const qEvents = eventsByQuestion[q.id] || [];

        // Growth Chart
        const growthCanvas = container.querySelector(`#growthChart_${q.id}_${uid}`);
        if (growthCanvas) {
          const snapshots = qEvents
            .filter(e => e.eventType === 'code_snapshot' && e.clientTime)
            .map(e => {
              let code = '';
              try { code = JSON.parse(e.payload || '{}').code || ''; } catch (_) { }
              return { ts: new Date(e.clientTime).getTime(), length: code.length };
            })
            .sort((a, b) => a.ts - b.ts);

          if (snapshots.length) {
            new Chart(growthCanvas, {
              type: 'line',
              data: {
                labels: snapshots.map(s => new Date(s.ts).toLocaleTimeString('en-US', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', second: '2-digit' })),
                datasets: [{
                  label: 'Code length',
                  data: snapshots.map(s => s.length),
                  borderColor: '#16a34a',
                  backgroundColor: 'rgba(22,163,74,0.1)',
                  tension: 0.2,
                  fill: true,
                  pointRadius: 2
                }]
              },
              options: {
                ...chartOptions,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true }, x: { ticks: { maxTicksLimit: 6 } } }
              }
            });
          } else {
            growthCanvas.outerHTML = '<p style="color:#888;font-size:12px;">No code snapshots recorded.</p>';
          }
        }

        // Rhythm Chart
        const rhythmCanvas = container.querySelector(`#rhythmChart_${q.id}_${uid}`);
        const rhythmNoteEl = container.querySelector(`#rhythmNote_${q.id}_${uid}`);
        if (rhythmCanvas) {
          const rhythmEvents = qEvents
            .filter(e => e.eventType === 'typing_rhythm' && e.clientTime)
            .map(e => {
              let p = {};
              try { p = typeof e.payload === 'string' ? JSON.parse(e.payload || '{}') : (e.payload || {}); } catch (_) { }
              return {
                ts: new Date(e.clientTime).getTime(),
                avgGapMs: Number(p.avgGapMs) || 0,
                stdDevMs: Number(p.stdDevMs) || 0,
                sampleCount: Number(p.sampleCount) || 0
              };
            })
            .sort((a, b) => a.ts - b.ts);

          if (rhythmEvents.length) {
            let uniformStreak = [];
            let maxUniformStreak = [];
            for (let i = 0; i < rhythmEvents.length; i++) {
              const item = rhythmEvents[i];
              const cv = item.avgGapMs > 0 ? (item.stdDevMs / item.avgGapMs) : 1;
              const isSuspicious = (item.sampleCount >= 5) && ((cv < 0.20 && item.stdDevMs < 45) || item.stdDevMs <= 18);
              if (isSuspicious) {
                uniformStreak.push(item);
                if (uniformStreak.length > maxUniformStreak.length) maxUniformStreak = [...uniformStreak];
              } else {
                uniformStreak = [];
              }
            }

            if (maxUniformStreak.length >= 3 && rhythmNoteEl) {
              const startStr = new Date(maxUniformStreak[0].ts).toLocaleTimeString('en-US', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' NPT';
              const endStr = new Date(maxUniformStreak[maxUniformStreak.length - 1].ts).toLocaleTimeString('en-US', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' NPT';
              rhythmNoteEl.innerHTML = `
                <div style="margin-bottom:8px; padding:6px 12px; background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.22); border-radius:8px; font-size:12px; color:#3730a3; display:inline-flex; align-items:center; gap:6px;">
                  <span>ℹ️</span>
                  <span>Typing rhythm was unusually consistent during ${startStr} – ${endStr}.</span>
                </div>
              `;
            }

            new Chart(rhythmCanvas, {
              type: 'line',
              data: {
                labels: rhythmEvents.map(r => new Date(r.ts).toLocaleTimeString('en-US', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', second: '2-digit' })),
                datasets: [{
                  label: 'Avg Keystroke Gap (ms)',
                  data: rhythmEvents.map(r => r.avgGapMs),
                  borderColor: '#6366f1',
                  backgroundColor: 'rgba(99,102,241,0.08)',
                  tension: 0.2,
                  fill: true,
                  pointRadius: 3
                }]
              },
              options: {
                ...chartOptions,
                plugins: { legend: { display: false } },
                scales: {
                  y: { beginAtZero: true, ticks: { callback: v => v + 'ms' } },
                  x: { ticks: { maxTicksLimit: 6 } }
                }
              }
            });
          } else {
            rhythmCanvas.outerHTML = '<p style="color:#888;font-size:12px;">No typing rhythm data recorded.</p>';
          }
        }
      }
    }

    // Populate Event Timeline List
    const eventListEl = container.querySelector(`#eventList_${uid}`);
    if (eventListEl) {
      const visibleEvents = combinedStats.sorted.filter(e =>
        e.eventType !== 'heartbeat' && e.eventType !== 'session_start' && e.eventType !== 'code_snapshot' && e.eventType !== 'typing_rhythm'
      );
      if (!visibleEvents.length) {
        eventListEl.innerHTML = '<p style="color:#888;font-size:13px;">No notable activity events recorded.</p>';
      } else {
        // Group events by question for clarity
        const questionMap = {};
        questions.forEach(q => { questionMap[q.id] = q; });

        visibleEvents.forEach(e => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:9px 12px; border-bottom:1px solid #f3f4f6; font-size:13px; gap:8px;';

          let detail = '';
          try {
            const p = JSON.parse(e.payload || '{}');
            if (e.eventType === 'large_change' && typeof p.delta === 'number') {
              detail = ` — +${p.delta} chars`;
              if (p.charsPerSec) detail += ` at ~${p.charsPerSec} chars/sec`;
            } else if (e.eventType === 'run_clicked') {
              detail = p.success ? ' — Passed ✓' : ` — ${p.exitStatus || 'Failed ✗'}`;
            } else if (e.eventType === 'idle_on_tab') {
              detail = ` — no typing for ${fmtDuration(p.idleMs || 180000)}`;
            } else if (e.eventType === 'idle_ended') {
              detail = ` — idle ended after ${fmtDuration(p.idleMs || 0)}`;
            }
          } catch (_) { }

          const qLabel = e.questionId && questionMap[e.questionId]
            ? `<span style="font-size:11px; font-weight:700; padding:1px 7px; border-radius:980px; background:#f3f4f6; color:#4b5563; margin-right:8px;">Q${questionMap[e.questionId].questionNumber || e.questionId}</span>`
            : '';

          row.innerHTML = `
            <span style="font-weight:500; color:#1f2937; flex:1;">${qLabel}${escapeHtml((EVENT_LABELS[e.eventType] || e.eventType) + detail)}</span>
            <span style="color:#6b7280; font-size:12px; white-space:nowrap;">${new Date(e.ts).toLocaleTimeString('en-US', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', second: '2-digit' })} NPT</span>
          `;
          eventListEl.appendChild(row);
        });
      }
    }

    // Handle checkbox label text update for teacher marksheet
    if (data.isTeacher && !isBulk) {
      container.querySelectorAll('.q-eval-checked').forEach(cb => {
        cb.addEventListener('change', function () {
          const labelText = this.closest('label')?.querySelector('.status-label-text');
          if (labelText) labelText.textContent = this.checked ? 'Checked' : 'Unchecked';
          const label = this.closest('label');
          if (label) {
            if (this.checked) {
              label.style.color = '#15803d';
              label.style.background = '#dcfce7';
              label.style.borderColor = '#bbf7d0';
            } else {
              label.style.color = '#b45309';
              label.style.background = '#fef3c7';
              label.style.borderColor = '#fde68a';
            }
          }
        });
      });
    }

    return container;
  }

  function syncScorecard(container = document) {
    const marksInputs = container.querySelectorAll('.q-eval-marks');
    let totalMarks = 0;
    let totalMax = 0;
    let anyGraded = false;
    let allGraded = marksInputs.length > 0;
    let allChecked = marksInputs.length > 0;

    marksInputs.forEach(input => {
      const qid = input.dataset.qid;
      const maxPts = Number(input.dataset.max) || 10;
      totalMax += maxPts;
      const val = input.value.trim();
      const scMarksEl = container.querySelector(`#scMarks_${qid}`);
      const scRemarksEl = container.querySelector(`#scRemarks_${qid}`);
      const remarksInput = container.querySelector(`.q-eval-remarks[data-qid="${qid}"]`);
      const checkedInput = container.querySelector(`.q-eval-checked[data-qid="${qid}"]`);

      if (!checkedInput || !checkedInput.checked) {
        allChecked = false;
      }

      if (val !== '') {
        const num = Number(val);
        totalMarks += num;
        anyGraded = true;
        if (scMarksEl) scMarksEl.innerHTML = `${num} / ${maxPts}`;
      } else {
        allGraded = false;
        if (scMarksEl) scMarksEl.innerHTML = `<span style="font-weight:600; color:#6b7280; font-size:12.5px;">—</span> / ${maxPts}`;
      }

      if (scRemarksEl && remarksInput) {
        const rVal = remarksInput.value.trim();
        if (rVal) {
          scRemarksEl.innerHTML = escapeHtml(rVal);
          scRemarksEl.style.display = '';
          scRemarksEl.style.fontStyle = 'italic';
          scRemarksEl.style.color = '#374151';
        } else {
          scRemarksEl.innerHTML = 'No remarks';
          scRemarksEl.style.display = '';
          scRemarksEl.style.fontStyle = 'normal';
          scRemarksEl.style.color = '#9ca3af';
        }
      }
    });

    const scTotalEl = container.querySelector('#scTotal');
    if (scTotalEl) {
      if (allGraded && marksInputs.length > 0) {
        scTotalEl.innerHTML = `${totalMarks} / ${totalMax}`;
      } else if (anyGraded) {
        scTotalEl.innerHTML = `${totalMarks} / ${totalMax} <span style="font-size:12px; font-weight:600; color:rgba(255,255,255,0.6);">(partial)</span>`;
      } else {
        scTotalEl.innerHTML = `— / ${totalMax}`;
      }
    }

    if (window.onReportScorecardSynced) {
      window.onReportScorecardSynced({ totalMarks, totalMax, allChecked, allGraded });
    }
  }

  function getGradingPayload(container = document) {
    const marksInputs = container.querySelectorAll('.q-eval-marks');
    let allChecked = marksInputs.length > 0;
    const grades = [];

    marksInputs.forEach(input => {
      const qid = Number(input.dataset.qid);
      const val = input.value.trim();
      const remarksInput = container.querySelector(`.q-eval-remarks[data-qid="${qid}"]`);
      const checkedInput = container.querySelector(`.q-eval-checked[data-qid="${qid}"]`);

      const checked = Boolean(checkedInput && checkedInput.checked);
      if (!checked) allChecked = false;

      grades.push({
        questionId: qid,
        marksObtained: val !== '' ? Number(val) : null,
        remarks: remarksInput ? remarksInput.value.trim() : '',
        checked
      });
    });

    return { grades, allChecked };
  }

  // Export to global window
  window.ReportGenerator = {
    fetchReportData,
    renderReportDOM,
    syncScorecard,
    getGradingPayload,
    fmtDuration,
    fmtTime,
    escapeHtml
  };
})();
