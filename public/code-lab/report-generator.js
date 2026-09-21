/**
 * report-generator.js — Shared Report Data Fetching & DOM Rendering for Code Lab
 * Used by both report.html (single report) and submissions.html (bulk ZIP export).
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
    const hasFlags = flagReasons.length > 0;

    // Earliest submission or first event
    const firstSub = (studentData.submissions || []).reduce((earliest, s) => {
      if (!s.submittedAt) return earliest;
      const ts = new Date(s.submittedAt).getTime();
      return !earliest || ts < earliest ? ts : earliest;
    }, null);

    const generatedTimeStr = fmtTime(new Date().toISOString());

      // Compute real grading values for scorecard
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
        if (sub && sub.marksObtained !== null && sub.marksObtained !== undefined) {
          totalMarksObtained += Number(sub.marksObtained);
          marksText = `${sub.marksObtained} / ${maxPts}`;
          anyGraded = true;
          if (!firstGradedBy && sub.gradedBy) firstGradedBy = sub.gradedBy;
          if (!firstGradedAt && sub.gradedAt) firstGradedAt = sub.gradedAt;
        } else {
          allGraded = false;
          marksText = `<span style="font-weight:600; color:#6b7280; font-family:sans-serif; font-size:12.5px;">Not yet graded</span> / ${maxPts}`;
        }

        return {
          q,
          maxPts,
          marksText,
          remarks: sub ? sub.remarks : null
        };
      });

      let totalScoreDisplay = '';
      if (allGraded && questions.length > 0) {
        totalScoreDisplay = `${totalMarksObtained} / ${totalMaxPoints}`;
      } else if (anyGraded) {
        totalScoreDisplay = `${totalMarksObtained} / ${totalMaxPoints} <span style="font-size:12px; font-weight:600; color:#6b7280; font-family:sans-serif;">(partial)</span>`;
      } else {
        totalScoreDisplay = `<span style="font-size:13.5px; font-weight:600; color:#6b7280; font-family:sans-serif;">Not yet graded</span> / ${totalMaxPoints}`;
      }

      let html = `
      <!-- Flagged for Review Banner -->
      ${hasFlags ? `
        <div class="flagged-banner" style="page-break-inside: avoid; break-inside: avoid;">
          <div class="flagged-banner-icon">⚠️</div>
          <div>
            <div class="flagged-banner-title">Flagged for Review</div>
            <div class="flagged-banner-text">
              The automated telemetry system detected anomalous patterns during this student's coding session:
            </div>
            <ul class="flagged-reasons-list">
              ${flagReasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
            </ul>
          </div>
        </div>
      ` : ''}

      <!-- Clock Mismatch Warning Banner -->
      ${clockMismatchDetected ? `
        <div class="clock-warning-banner" style="page-break-inside: avoid; break-inside: avoid;">
          <span style="font-size: 18px;">⚠️</span>
          <div>
            <strong>Clock mismatch detected</strong> — this student's device clock differed from the server by approx. ${fmtDuration(maxDriftMs)}. Duration figures below may be subject to client-side clock drift.
          </div>
        </div>
      ` : ''}

      <!-- Cover & Scorecard -->
      <div class="report-cover-wrapper" style="page-break-after: always; margin-bottom: 36px; padding-bottom: 24px; border-bottom: 2px solid #e5e7eb; page-break-inside: avoid; break-inside: avoid;">
        <div class="cover-card" style="border: 2px solid #111827; border-radius: 16px; padding: 28px 32px; background: #ffffff; page-break-inside: avoid; break-inside: avoid;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 18px; margin-bottom: 22px;">
            <div>
              <div style="font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #4b5563;">Semester Library · Code Lab</div>
              <h1 style="font-size: 26px; font-weight: 800; margin: 4px 0 2px 0; color: #111827; letter-spacing: -0.02em;">Student Submission Evaluation</h1>
              <div style="font-size: 14px; font-weight: 500; color: #6b7280;">Official Archival Report · Tribhuvan University / IOST</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase;">Generated</div>
              <div style="font-size: 12.5px; font-weight: 600; color: #374151;">${escapeHtml(generatedTimeStr)}</div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 26px;">
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 18px;">
              <div style="font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 6px;">Student Profile</div>
              <div style="font-size: 17px; font-weight: 700; color: #111827;">${escapeHtml(studentName)}</div>
              <div style="font-size: 13px; color: #4b5563; margin-top: 2px;">Student ID / Roll: <strong>${escapeHtml(studentId)}</strong></div>
            </div>
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 18px;">
              <div style="font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 6px;">Assignment Info</div>
              <div style="font-size: 16px; font-weight: 700; color: #111827;">${escapeHtml(assignment.title)}</div>
              <div style="font-size: 13px; color: #4b5563; margin-top: 2px;">
                ${assignment.subject ? escapeHtml(assignment.subject) + ' · ' : ''}
                ${assignment.semester ? 'Semester ' + escapeHtml(assignment.semester) : ''}
              </div>
            </div>
          </div>

          <!-- Grading Scorecard Rubric -->
          <div class="scorecard-card" style="border: 1px solid #d1d5db; border-radius: 12px; padding: 18px 22px; background: #ffffff; page-break-inside: avoid; break-inside: avoid;">
            <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #111827; margin-bottom: 12px; display: flex; justify-content: space-between;">
              <span>Instructor Evaluation & Scorecard</span>
              <span style="font-weight: 600; color: #6b7280;">Marks / Max</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${scoredQuestions.map(({ q, marksText, remarks }, idx) => `
                <div style="border-bottom: 1px dashed #e5e7eb; padding-bottom: 8px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 13.5px; font-weight: 600; color: #374151;">Task ${q.questionNumber || (idx + 1)}: ${escapeHtml(q.title)}</span>
                    <span id="scMarks_${q.id}" class="scorecard-task-marks" style="font-family: Menlo, Monaco, Consolas, 'SF Mono', 'Courier New', monospace; font-size: 14px; font-weight: 700; color: #111827;">${marksText}</span>
                  </div>
                  <div id="scRemarks_${q.id}" class="scorecard-task-remarks" style="font-size: 12px; color: #4b5563; margin-top: 3px; font-style: italic; line-height: 1.4; ${remarks ? '' : 'display:none;'}">${remarks ? 'Remarks: ' + escapeHtml(remarks) : ''}</div>
                </div>
              `).join('')}
              <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 10px; font-weight: 800; font-size: 15px;">
                <span>Total Score</span>
                <span id="scTotal" class="scorecard-total-val" style="font-family: Menlo, Monaco, Consolas, 'SF Mono', 'Courier New', monospace; font-size: 17px; color: #111827;">${totalScoreDisplay}</span>
              </div>
              <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid #111827; display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: #4b5563; flex-wrap: wrap; gap: 8px;">
                <span>Graded By: <strong>${firstGradedBy ? escapeHtml(firstGradedBy) : '_______________________'}</strong></span>
                <span>${firstGradedAt ? 'Date: ' + escapeHtml(fmtTime(firstGradedAt)) + ' · ' : ''}Instructor Signature: _______________________</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Report Header -->
      <div class="report-header">
        <h1>${escapeHtml(studentName)} — ${escapeHtml(assignment.title)}</h1>
        <div class="meta">
          ${assignment.subject ? escapeHtml(assignment.subject) + ' · ' : ''}
          ${assignment.semester ? 'Semester ' + escapeHtml(assignment.semester) + ' · ' : ''}
          ${questions.length} question${questions.length !== 1 ? 's' : ''} ·
          Student ID: ${escapeHtml(studentId)}
        </div>
      </div>

      <div class="section-title">Combined Summary (All Questions)</div>
      <div class="stats-row">
        <div class="stat-box">
          <div class="value">${combinedStats.sessionCount}</div>
          <div class="label">Coding session(s)</div>
        </div>
        <div class="stat-box">
          <div class="value">${fmtDuration(combinedStats.totalSpanMs)}</div>
          <div class="label">Total session time</div>
        </div>
        <div class="stat-box">
          <div class="value">${fmtDuration(combinedStats.activeMs)}</div>
          <div class="label">Actually working</div>
        </div>
        <div class="stat-box ${combinedStats.idleMs > 0 ? 'warn' : ''}">
          <div class="value">${fmtDuration(combinedStats.idleMs)}</div>
          <div class="label">Idle on tab</div>
        </div>
        <div class="stat-box">
          <div class="value">${fmtDuration(combinedStats.hiddenMs)}</div>
          <div class="label">Hidden (tab away)</div>
        </div>
        <div class="stat-box">
          <div class="value">${combinedStats.counts.run_clicked || 0}</div>
          <div class="label">Code runs</div>
        </div>
        <div class="stat-box ${combinedStats.counts.paste_attempt ? 'warn' : ''}">
          <div class="value">${combinedStats.counts.paste_attempt || 0}</div>
          <div class="label">Paste attempts</div>
        </div>
        <div class="stat-box ${combinedStats.counts.large_change ? 'warn' : ''}">
          <div class="value">${combinedStats.counts.large_change || 0}</div>
          <div class="label">Large text jumps</div>
        </div>
        <div class="stat-box">
          <div class="value">${combinedStats.counts.tab_hidden || 0}</div>
          <div class="label">Tab switches</div>
        </div>
        ${combinedStats.counts.ai_explain_used ? `
        <div class="stat-box" style="border-left: 3px solid #3b82f6;">
          <div class="value">${combinedStats.counts.ai_explain_used}</div>
          <div class="label">AI explains used</div>
        </div>` : ''}
      </div>

      <div class="section-title">Combined Activity Breakdown</div>
      <canvas id="combinedEventChart_${uid}" height="90"></canvas>
    `;

    // Per-question rendering
    for (const q of questions) {
      const sub = (studentData.submissions || []).find(s => Number(s.questionId) === q.id);
      const maxPts = (sub && sub.maxPoints != null) ? Number(sub.maxPoints) : (q.maxPoints != null ? Number(q.maxPoints) : 10);
      const qEvents = eventsByQuestion[q.id] || [];
      const qStats = computeSessionStats(qEvents);

      // Run vs Submit ratio
      const runEvents = qEvents.filter(e => e.eventType === 'run_clicked');
      const totalRuns = runEvents.length;
      let passedRuns = 0;
      let failedRuns = 0;
      runEvents.forEach(e => {
        let p = {};
        try { p = typeof e.payload === 'string' ? JSON.parse(e.payload || '{}') : (e.payload || {}); } catch (_) { }
        if (p.success === true || p.exitStatus === 'success') {
          passedRuns++;
        } else {
          failedRuns++;
        }
      });

      let runStatText = '';
      if (totalRuns === 0) runStatText = 'Ran 0 times before submitting.';
      else if (totalRuns === 1) runStatText = `Ran 1 time (${passedRuns === 1 ? 'passed' : 'failed'}) before submitting.`;
      else runStatText = `Ran ${totalRuns} times (${passedRuns} passed, ${failedRuns} failed) before submitting.`;

      // Time to first keystroke
      const sessionStartEvent = qEvents.find(e => e.eventType === 'session_start');
      const firstKeystrokeEvent = qEvents.find(e => e.eventType === 'first_keystroke');
      let firstKeystrokeStatText = '';
      let tabSwitchBeforeTypingText = '';

      if (sessionStartEvent && firstKeystrokeEvent) {
        const startTs = new Date(sessionStartEvent.clientTime || sessionStartEvent.createdAt).getTime();
        const keystrokeTs = new Date(firstKeystrokeEvent.clientTime || firstKeystrokeEvent.createdAt).getTime();
        const gapMs = Math.max(keystrokeTs - startTs, 0);
        firstKeystrokeStatText = `Started typing ${fmtDuration(gapMs)} after opening this question.`;

        const windowEvents = qEvents
          .filter(e => {
            const ts = new Date(e.clientTime || e.createdAt).getTime();
            return ts >= startTs && ts <= keystrokeTs;
          })
          .sort((a, b) => new Date(a.clientTime || a.createdAt).getTime() - new Date(b.clientTime || b.createdAt).getTime());

        let tabSwitchesInGap = 0;
        let pendingHide = false;
        for (const we of windowEvents) {
          if (we.eventType === 'tab_hidden') pendingHide = true;
          else if (we.eventType === 'tab_visible' && pendingHide) {
            tabSwitchesInGap++;
            pendingHide = false;
          }
        }
        if (tabSwitchesInGap === 1) tabSwitchBeforeTypingText = 'Switched tabs once before starting to type.';
        else if (tabSwitchesInGap > 1) tabSwitchBeforeTypingText = `Switched tabs ${tabSwitchesInGap} times before starting to type.`;
      }

      // Mild flag check
      let showMildFlag = false;
      if (sub && totalRuns <= 1 && qStats.activeMs < 2.5 * 60 * 1000) {
        showMildFlag = true;
      }

      // Wall-clock timeline
      const sortedQEvents = (qStats.sorted && qStats.sorted.length > 0)
        ? qStats.sorted
        : qEvents.map(e => ({ ...e, ts: new Date(e.clientTime || e.createdAt).getTime() })).sort((a, b) => a.ts - b.ts);

      const firstOpenEv = sortedQEvents.find(e => e.eventType === 'first_open')
        || sortedQEvents.find(e => e.eventType === 'session_start')
        || (sortedQEvents.length > 0 ? sortedQEvents[0] : null);

      let calendarGapHtml = '';
      if (firstOpenEv && sub && sub.submittedAt) {
        const openTs = firstOpenEv.ts;
        const submitTs = new Date(sub.submittedAt).getTime();
        const calendarDiffMs = Math.max(submitTs - openTs, 0);
        calendarGapHtml = `
          <div style="margin-top:6px; padding:7px 11px; background:rgba(0,0,0,0.03); border:1px solid rgba(0,0,0,0.07); border-radius:6px; font-size:12px; color:#4b5563; line-height:1.5;">
            <span style="font-weight:600; color:#111827;">Wall-Clock Timeline:</span>
            First opened: <strong style="color:#1f2937;">${fmtTime(openTs)}</strong>
            · Final submission: <strong style="color:#1f2937;">${fmtTime(sub.submittedAt)}</strong>
            · Calendar time to completion: <strong style="color:#2563eb;">${fmtCalendarDuration(calendarDiffMs)}</strong>
            <span style="font-size:11px; color:#6b7280; margin-left:4px;">(wall-clock time, distinct from active working time)</span>
          </div>
        `;
      }

      // ── Automated Test Cases Section (Item 4) ─────────────────────────
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
          <div style="margin: 14px 0 16px 0; padding: 12px 16px; border-radius: 10px; background: ${allPassed ? '#f0fdf4' : '#fffbeb'}; border: 1px solid ${allPassed ? '#bbf7d0' : '#fde68a'};">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">${allPassed ? '✅' : '⚠️'}</span>
                <span style="font-size: 13.5px; font-weight: 700; color: ${allPassed ? '#166534' : '#92400e'};">
                  Automated Test Cases: Passed ${passedCount}/${totalCount}
                </span>
              </div>
              <span style="font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 980px; background: ${allPassed ? '#dcfce7' : '#fef3c7'}; color: ${allPassed ? '#15803d' : '#b45309'};">
                ${allPassed ? 'All Test Cases Passed' : `${totalCount - passedCount} Failed Case${totalCount - passedCount === 1 ? '' : 's'}`}
              </span>
            </div>

            ${failedCases.length > 0 ? `
              <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(0,0,0,0.1);">
                <div style="font-size: 12px; font-weight: 700; color: #b45309; margin-bottom: 6px;">Failed Test Case Details:</div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${failedCases.map((fc, fcIdx) => `
                    <div style="background: #ffffff; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px; font-size: 12px;">
                      <div style="font-weight: 700; color: #9a3412; margin-bottom: 4px;">Failed Case #${fcIdx + 1}</div>
                      ${fc.input ? `<div style="margin-bottom: 2px;"><strong style="color: #4b5563;">Input (stdin):</strong> <code style="background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-family: Menlo, Monaco, Consolas, 'SF Mono', 'Courier New', monospace;">${escapeHtml(fc.input)}</code></div>` : '<div style="margin-bottom: 2px; color: #6b7280; font-style: italic;">No stdin provided</div>'}
                      <div style="margin-bottom: 2px;"><strong style="color: #4b5563;">Expected Output:</strong> <code style="background: #f0fdf4; color: #166534; padding: 1px 5px; border-radius: 4px; font-family: Menlo, Monaco, Consolas, 'SF Mono', 'Courier New', monospace;">${escapeHtml(fc.expected)}</code></div>
                      <div><strong style="color: #4b5563;">Actual Output:</strong> <code style="background: #fef2f2; color: #991b1b; padding: 1px 5px; border-radius: 4px; font-family: Menlo, Monaco, Consolas, 'SF Mono', 'Courier New', monospace;">${escapeHtml(fc.actual || '— (empty)')}</code></div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        `;
      }

      html += `
        <div class="question-section" style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
          <h3>Task ${q.questionNumber || 1}: ${escapeHtml(q.title)}</h3>
          <div style="font-size:12.5px;color:#6e6e73;margin-bottom:12px;line-height:1.6;">
            <span>Language: <strong style="color:#1d1d1f;">${escapeHtml((q.language || 'c').toUpperCase())}</strong></span>
            ${sub ? ' · Submitted: ' + fmtTime(sub.submittedAt) + (assignment.deadline ? ' ' + deadlineBadge(assignment.deadline, sub.submittedAt) : '') : ' · Not submitted'}
            · Sessions: ${qStats.sessionCount} · Actually working: ${fmtDuration(qStats.activeMs)}
            · Idle on tab: ${fmtDuration(qStats.idleMs)} · Hidden: ${fmtDuration(qStats.hiddenMs)}
            · Pastes: ${qStats.counts.paste_attempt || 0}
            ${qStats.counts.ai_explain_used ? ` · AI explains: ${qStats.counts.ai_explain_used}` : ''}
            ${calendarGapHtml}
            <br>
            <span style="display:inline-block; margin-top:4px; color:#1d1d1f; font-weight:500;">
              <strong>Run vs Submit Ratio:</strong> ${escapeHtml(runStatText)}
            </span>
            <br>
            <span style="display:inline-block; margin-top:3px; color:#1d1d1f; font-weight:500;">
              <strong>Idle on tab (no typing):</strong> ${fmtDuration(qStats.idleMs)}
            </span>
            ${firstKeystrokeStatText ? `
              <br>
              <span style="display:inline-block; margin-top:3px; color:#1d1d1f; font-weight:500;">
                <strong>First Keystroke:</strong> ${escapeHtml(firstKeystrokeStatText)}
                ${tabSwitchBeforeTypingText ? `<span style="color:#b45309; font-weight:600; margin-left:6px;">(${escapeHtml(tabSwitchBeforeTypingText)})</span>` : ''}
              </span>
            ` : ''}
            ${showMildFlag ? `
              <div style="margin-top:6px; display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600; color:#b45309; background:rgba(245, 158, 11, 0.12); padding:3px 9px; border-radius:6px; border:1px solid rgba(245, 158, 11, 0.25);">
                ⚠️ Submitted after ≤1 run attempt.
              </div>` : ''}
          </div>

          ${testCasesHtml}

          ${q.description ? `
            <div class="section-title" style="margin-top:14px;">Problem Statement</div>
            <div class="question-description" style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:12px 14px; font-size:13px; line-height:1.5; color:#374151;">${escapeHtml(q.description)}</div>
          ` : ''}

          ${sub ? `
            <div class="section-title" style="margin-top:10px;">Submitted Code</div>
            <pre style="background:#1e1e1e; color:#d4d4d4; padding:14px; border-radius:10px; font-family: Menlo, Monaco, Consolas, 'SF Mono', 'Courier New', monospace; font-size:12.5px; line-height:1.6; overflow-x:auto;">${escapeHtml(sub.code)}</pre>
            ${sub.stdout ? `
              <div class="section-title">Output</div>
              <pre style="background:#f4f4f5; color:#18181b; padding:12px; border-radius:8px; font-family: Menlo, Monaco, Consolas, 'SF Mono', 'Courier New', monospace; font-size:12px; line-height:1.6; overflow-x:auto;">${escapeHtml(sub.stdout)}</pre>
            ` : ''}
            ${sub.stderr ? `<pre class="stderr" style="background:#fef2f2; color:#b91c1c; padding:10px; border-radius:8px; font-family: Menlo, Monaco, Consolas, 'SF Mono', 'Courier New', monospace; font-size:12px; line-height:1.6; overflow-x:auto;">${escapeHtml(sub.stderr)}</pre>` : ''}
          ` : '<p style="color:#888;font-size:13px;">No code submitted for this question.</p>'}

          <div class="section-title">Code Growth</div>
          <canvas id="growthChart_${q.id}_${uid}" height="70"></canvas>

          <div class="section-title" style="margin-top:16px;">Typing Consistency & Rhythm</div>
          <div id="rhythmNote_${q.id}_${uid}"></div>
          <canvas id="rhythmChart_${q.id}_${uid}" height="70"></canvas>

          ${(data.isTeacher && !isBulk) ? `
            <div class="instructor-eval-box" style="margin-top: 22px; padding: 18px 22px; background: #ffffff; border: 1.5px solid #d1d5db; border-radius: 14px; page-break-inside: avoid; break-inside: avoid; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
                <div style="font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #111827; display: flex; align-items: center; gap: 6px;">
                  <span>Task ${q.questionNumber || 1} Evaluation & Marks</span>
                </div>
                <label style="display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; cursor: pointer; color: #1f2937; background: #f3f4f6; padding: 5px 14px; border-radius: 980px; border: 1px solid #e5e7eb;">
                  <input type="checkbox" class="q-eval-checked" data-qid="${q.id}" ${sub?.checked ? 'checked' : ''} onchange="ReportGenerator.syncScorecard()">
                  <span>Mark as Checked</span>
                </label>
              </div>
              <div style="display: grid; grid-template-columns: 170px 1fr; gap: 16px; align-items: start;">
                <div>
                  <label style="display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #4b5563; margin-bottom: 5px;">Marks Obtained</label>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="number" min="0" max="${maxPts}" step="1" 
                           class="q-eval-marks" data-qid="${q.id}" data-max="${maxPts}"
                           value="${sub?.marksObtained != null ? sub.marksObtained : ''}" 
                           placeholder="—"
                           oninput="ReportGenerator.syncScorecard()"
                           style="width: 75px; padding: 7px 10px; font-size: 15px; font-weight: 700; font-family: Menlo, Monaco, Consolas, monospace; border: 1.5px solid #d1d5db; border-radius: 8px; text-align: center;">
                    <span style="font-size: 14px; font-weight: 700; color: #4b5563;">/ ${maxPts}</span>
                  </div>
                </div>
                <div>
                  <label style="display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #4b5563; margin-bottom: 5px;">Teacher Feedback / Remarks</label>
                  <textarea class="q-eval-remarks" data-qid="${q.id}" 
                            placeholder="Feedback or remarks for student on Task ${q.questionNumber || 1}..." 
                            rows="2"
                            oninput="ReportGenerator.syncScorecard()"
                            style="width: 100%; box-sizing: border-box; padding: 8px 12px; font-size: 13px; font-family: inherit; border: 1.5px solid #d1d5db; border-radius: 8px; resize: vertical;">${escapeHtml(sub?.remarks || '')}</textarea>
                </div>
              </div>
            </div>
          ` : (sub && (sub.marksObtained != null || sub.remarks) ? `
            <div class="student-eval-feedback" style="margin-top: 18px; padding: 14px 18px; background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 12px; page-break-inside: avoid; break-inside: avoid;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #166534; letter-spacing: 0.04em;">Instructor Evaluation</span>
                <span style="font-family: Menlo, Monaco, Consolas, monospace; font-size: 14px; font-weight: 700; color: #15803d;">Score: ${sub.marksObtained != null ? sub.marksObtained : '—'} / ${maxPts} pts</span>
              </div>
              ${sub.remarks ? `<div style="font-size: 13px; color: #166534; line-height: 1.5; font-style: italic;">“${escapeHtml(sub.remarks)}”</div>` : ''}
            </div>
          ` : '')}
        </div>
      `;
    }

    // Event timeline list
    html += `
      <div class="section-title" style="margin-top:28px;">Event Timeline (All Questions)</div>
      <div id="eventList_${uid}"></div>
    `;

    container.innerHTML = html;

    // ── Chart.js Chart Initializations ──────────────────────────────────
    if (typeof Chart !== 'undefined') {
      const chartOptions = { responsive: true, animation: isBulk ? false : true };

      // Combined Event Chart
      const combinedCanvas = container.querySelector(`#combinedEventChart_${uid}`);
      if (combinedCanvas) {
        const labels = Object.keys(combinedStats.counts).map(k => EVENT_LABELS[k] || k);
        const values = Object.values(combinedStats.counts);
        new Chart(combinedCanvas, {
          type: 'bar',
          data: {
            labels,
            datasets: [{ label: 'Count', data: values, backgroundColor: '#2563eb' }]
          },
          options: {
            ...chartOptions,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
          }
        });
      }

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
                <div style="margin-bottom:10px; padding:7px 12px; background:rgba(99, 102, 241, 0.08); border:1px solid rgba(99, 102, 241, 0.22); border-radius:8px; font-size:12px; color:#3730a3; display:inline-flex; align-items:center; gap:6px;">
                  <span>ℹ️</span>
                  <span>Typing rhythm was unusually consistent during this period (${startStr} – ${endStr}).</span>
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
                  backgroundColor: 'rgba(99, 102, 241, 0.08)',
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
            rhythmCanvas.outerHTML = '<p style="color:#888;font-size:12px;">No typing rhythm data recorded (requires continuous typing).</p>';
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
        visibleEvents.forEach(e => {
          const row = document.createElement('div');
          row.className = 'event-row';
          row.style.cssText = 'display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f3f4f6; font-size:13px;';

          let detail = '';
          try {
            const p = JSON.parse(e.payload || '{}');
            if (e.eventType === 'large_change' && typeof p.delta === 'number') {
              detail = ` — +${p.delta} chars`;
              if (p.charsPerSec) detail += ` at ~${p.charsPerSec} chars/sec`;
            } else if (e.eventType === 'run_clicked') {
              detail = p.success ? ' — Passed (Exit 0)' : ` — ${p.exitStatus || 'Failed'}`;
            } else if (e.eventType === 'idle_on_tab') {
              detail = ` — no typing for ${fmtDuration(p.idleMs || 180000)}`;
            } else if (e.eventType === 'idle_ended') {
              detail = ` — idle ended after ${fmtDuration(p.idleMs || 0)}`;
            }
          } catch (_) { }

          row.innerHTML = `
            <span class="type" style="font-weight:500; color:#1f2937;">${escapeHtml((EVENT_LABELS[e.eventType] || e.eventType) + detail)}</span>
            <span class="time" style="color:#6b7280; font-size:12px;">${new Date(e.ts).toLocaleTimeString('en-US', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', second: '2-digit' })} NPT</span>
          `;
          eventListEl.appendChild(row);
        });
      }
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
        if (scMarksEl) scMarksEl.innerHTML = `<span style="font-weight:600; color:#6b7280; font-family:sans-serif; font-size:12.5px;">Not yet graded</span> / ${maxPts}`;
      }

      if (scRemarksEl && remarksInput) {
        const rVal = remarksInput.value.trim();
        if (rVal) {
          scRemarksEl.innerHTML = `Remarks: ${escapeHtml(rVal)}`;
          scRemarksEl.style.display = 'block';
        } else {
          scRemarksEl.innerHTML = '';
          scRemarksEl.style.display = 'none';
        }
      }
    });

    const scTotalEl = container.querySelector('#scTotal');
    if (scTotalEl) {
      if (allGraded && marksInputs.length > 0) {
        scTotalEl.innerHTML = `${totalMarks} / ${totalMax}`;
      } else if (anyGraded) {
        scTotalEl.innerHTML = `${totalMarks} / ${totalMax} <span style="font-size:12px; font-weight:600; color:#6b7280; font-family:sans-serif;">(partial)</span>`;
      } else {
        scTotalEl.innerHTML = `<span style="font-size:13.5px; font-weight:600; color:#6b7280; font-family:sans-serif;">Not yet graded</span> / ${totalMax}`;
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
