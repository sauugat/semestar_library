'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  formatToolResult,
  parseAttendanceBlock,
} = require('../lib/chat-tools');
const {
  stabilizeStreamingMarkdown,
  fallbackMarkdown,
  renderAttendanceChartHtml,
} = require('../public/chatbot.js');

const postMarkdownSource = fs.readFileSync(
  path.join(__dirname, '../mobile/components/PostMarkdown.tsx'),
  'utf8'
);
const chatbotCssSource = fs.readFileSync(
  path.join(__dirname, '../public/chatbot.css'),
  'utf8'
);

const FORBIDDEN_ELIGIBILITY_PATTERNS = [
  /Exam Eligibility/i,
  /Cannot determine eligibility/i,
  /threshold not configured/i,
  /Required threshold/i,
  /Eligible for exams/i,
  /Below exam eligibility threshold/i,
];

function assertNoEligibilityText(text) {
  for (const pattern of FORBIDDEN_ELIGIBILITY_PATTERNS) {
    assert.doesNotMatch(
      text,
      pattern,
      `Attendance response must never contain examination eligibility text (${pattern})`
    );
  }
}

test('1. 100% attendance (Semester 3 example: 1 of 6 subjects recorded, CIT214 with 3 classes, 3 present, 0 absent)', () => {
  const reply = formatToolResult('get_my_attendance', {
    query: 'Show my attendance',
    semesterNo: 3,
    overall: {
      attendancePercentage: 100,
      presentCount: 3,
      absentCount: 0,
      totalSessions: 3,
    },
    subjects: [
      {
        name: 'Data Structure and Algorithms',
        code: 'CIT214',
        attendancePercentage: 100,
        presentCount: 3,
        absentCount: 0,
        totalSessions: 3,
      },
      {
        name: 'Principles of Organization and Management',
        code: 'MGT215',
        attendancePercentage: null,
        presentCount: 0,
        absentCount: 0,
        totalSessions: 0,
      },
      {
        name: 'Web Technology II',
        code: 'CIT212',
        attendancePercentage: null,
        presentCount: 0,
        absentCount: 0,
        totalSessions: 0,
      },
      {
        name: 'Software Engineering',
        code: 'CIT213',
        attendancePercentage: null,
        presentCount: 0,
        absentCount: 0,
        totalSessions: 0,
      },
      {
        name: 'Database Management System',
        code: 'CIT215',
        attendancePercentage: null,
        presentCount: 0,
        absentCount: 0,
        totalSessions: 0,
      },
      {
        name: 'Microprocessor and Computer Architecture',
        code: 'CIT216',
        attendancePercentage: null,
        presentCount: 0,
        absentCount: 0,
        totalSessions: 0,
      },
    ],
  });

  // Clearly communicates 100% based on 3 recorded classes and that only 1 of 6 subjects has recorded attendance
  assert.match(reply, /\*\*100%\*\*/);
  assert.match(reply, /3 present, 0 missed\/absent out of 3 total classes/);
  assert.match(reply, /Only \*\*1 of 6 subjects\*\* \(Data Structure and Algorithms\) has recorded attendance so far/);
  assert.doesNotMatch(reply, /\b0%/, 'Must never display 0% for subjects with zero recorded classes');
  assertNoEligibilityText(reply);

  // Web HTML rendering check
  const html = fallbackMarkdown(reply);
  assert.match(html, /class="kyana-attendance-card"/);
  assert.match(html, /Attendance overview/);
  assert.match(html, /Recorded data/);
  assert.match(html, /3 \/ 3/);
  assert.match(html, /Subject-wise attendance/);
  assert.match(html, /Data Structure and Algorithms/);
  assert.match(html, /CIT214 · 3 recorded classes/);
  assert.match(html, /Other subjects/);
  assert.equal((html.match(/class="kyana-att-subj-item"/g) || []).length, 1, 'Only the 1 recorded subject should be plotted in the bar chart');
  assert.equal((html.match(/class="kyana-att-other-row"/g) || []).length, 5, 'All 5 unrecorded subjects should appear under Other subjects with No records');
  assert.doesNotMatch(html, /Low Attendance/);
});

test('2. Exactly 50% attendance: normal monochromatic styling (not red, no Low Attendance badge)', () => {
  const reply = formatToolResult('get_my_attendance', {
    query: 'Show my attendance',
    semesterNo: 3,
    overall: {
      attendancePercentage: 50,
      presentCount: 5,
      absentCount: 5,
      totalSessions: 10,
    },
    subjects: [
      {
        name: 'Operating Systems',
        code: 'CIT221',
        attendancePercentage: 50,
        presentCount: 5,
        absentCount: 5,
        totalSessions: 10,
      },
    ],
  });

  assert.match(reply, /\*\*50%\*\*/);
  assert.doesNotMatch(reply, /Low Attendance/, '50% must not be labeled Low Attendance');
  assertNoEligibilityText(reply);

  const html = fallbackMarkdown(reply);
  assert.doesNotMatch(html, /is-low/, '50% must use normal monochromatic styling, not red is-low class');
  assert.match(html, /width="50"/);
});

test('3. 49% attendance: displayed in red with "Low Attendance" label', () => {
  const reply = formatToolResult('get_my_attendance', {
    query: 'Show my attendance',
    semesterNo: 3,
    overall: {
      attendancePercentage: 49,
      presentCount: 49,
      absentCount: 51,
      totalSessions: 100,
    },
    subjects: [
      {
        name: 'Operating Systems',
        code: 'CIT221',
        attendancePercentage: 49,
        presentCount: 49,
        absentCount: 51,
        totalSessions: 100,
      },
    ],
  });

  assert.match(reply, /\*\*49%\*\*/);
  assert.match(reply, /Low Attendance/);
  assertNoEligibilityText(reply);

  const html = fallbackMarkdown(reply);
  assert.match(html, /class="kyana-att-hero-pct is-low">49%<\/span>/);
  assert.match(html, /class="kyana-att-subj-pct is-low">49%<\/span>/);
  assert.match(html, /<span class="kyana-att-low-badge">Low Attendance<\/span>/);
  assert.match(html, /class="kyana-att-svg-fill is-low" x="0" y="0" width="49"/);
});

test('4. 0% with recorded classes: displayed as 0% in red with "Low Attendance" (never "No records")', () => {
  const reply = formatToolResult('get_my_attendance', {
    query: 'Show my attendance',
    semesterNo: 3,
    overall: {
      attendancePercentage: 0,
      presentCount: 0,
      absentCount: 4,
      totalSessions: 4,
    },
    subjects: [
      {
        name: 'Computer Networks',
        code: 'CIT222',
        attendancePercentage: 0,
        presentCount: 0,
        absentCount: 4,
        totalSessions: 4,
      },
    ],
  });

  assert.match(reply, /\*\*0%\*\*/);
  assert.match(reply, /Low Attendance/);
  assert.match(reply, /0 present, 4 missed\/absent out of 4 total classes/);
  assert.doesNotMatch(reply, /No records/);
  assertNoEligibilityText(reply);

  const html = fallbackMarkdown(reply);
  assert.match(html, /class="kyana-att-hero-pct is-low">0%<\/span>/);
  assert.match(html, /class="kyana-att-subj-pct is-low">0%<\/span>/);
  assert.match(html, /<span class="kyana-att-low-badge">Low Attendance<\/span>/);
  assert.equal((html.match(/class="kyana-att-subj-item"/g) || []).length, 1);
});

test('5. Zero recorded classes: displays "No records", never 0%, and plots zero chart bars', () => {
  const reply = formatToolResult('get_my_attendance', {
    query: 'Show my attendance',
    semesterNo: 5,
    overall: {
      attendancePercentage: null,
      presentCount: 0,
      absentCount: 0,
      totalSessions: 0,
    },
    subjects: [
      {
        name: 'Artificial Intelligence',
        code: 'CIT312',
        attendancePercentage: null,
        presentCount: 0,
        absentCount: 0,
        totalSessions: 0,
      },
      {
        name: 'Software Engineering',
        code: 'CIT311',
        attendancePercentage: null,
        presentCount: 0,
        absentCount: 0,
        totalSessions: 0,
      },
    ],
  });

  assert.match(reply, /No records/);
  assert.doesNotMatch(reply, /\b0%/, 'Must never display 0% when total recorded classes are zero');
  assert.doesNotMatch(reply, /Low Attendance/);
  assertNoEligibilityText(reply);

  const html = fallbackMarkdown(reply);
  assert.match(html, /class="kyana-att-hero-pct is-norecord">No records<\/span>/);
  assert.equal((html.match(/class="kyana-att-subj-item"/g) || []).length, 0, 'Must not plot any bar chart items when 0 classes are recorded');
  assert.equal((html.match(/class="kyana-att-other-row"/g) || []).length, 2);
});

test('6. Mixed subjects (recorded >=50%, recorded <50%, recorded 0%, and unrecorded No records)', () => {
  const reply = formatToolResult('get_my_attendance', {
    query: 'Give me report of my attendance of all subjects',
    semesterNo: 3,
    overall: {
      attendancePercentage: 55,
      presentCount: 11,
      absentCount: 9,
      totalSessions: 20,
    },
    subjects: [
      {
        name: 'Database Management System',
        code: 'CIT214',
        attendancePercentage: 80,
        presentCount: 8,
        absentCount: 2,
        totalSessions: 10,
      },
      {
        name: 'Operating Systems',
        code: 'CIT221',
        attendancePercentage: 37.5,
        presentCount: 3,
        absentCount: 5,
        totalSessions: 8,
      },
      {
        name: 'Computer Networks',
        code: 'CIT222',
        attendancePercentage: 0,
        presentCount: 0,
        absentCount: 2,
        totalSessions: 2,
      },
      {
        name: 'Web Technology II',
        code: 'CIT212',
        attendancePercentage: null,
        presentCount: 0,
        absentCount: 0,
        totalSessions: 0,
      },
    ],
  });

  assertNoEligibilityText(reply);
  const parsed = parseAttendanceBlock(reply.split('```attendance')[1].split('```')[0]);
  assert.equal(parsed.overallPct, 55);
  assert.equal(parsed.isLow, false);
  assert.equal(parsed.recordedItems.length, 3);
  assert.equal(parsed.unrecordedItems.length, 1);
  assert.equal(parsed.recordedItems[0].isLow, false); // 80%
  assert.equal(parsed.recordedItems[1].isLow, true);  // 37.5%
  assert.equal(parsed.recordedItems[2].isLow, true);  // 0% with 2 classes
  assert.equal(parsed.unrecordedItems[0].name, 'Web Technology II');
});

test('7. Partial attendance data during streaming: stabilizes unclosed fence and renders partial chart cleanly', () => {
  const partialStream = [
    'Your overall recorded attendance in Semester 3 is **100%**, based on **3** recorded classes.',
    '',
    '```attendance',
    'Overview: 100% | 3/3 classes attended | Present: 3 | Absent: 0 | 1 of 6 subjects recorded | Semester 3',
    '- **Data Structure and Algorithms** (CIT214): **100%** | 3 recorded classes | Present: 3 | Absent: 0',
    '- **Principles of Organization and Management** (MGT215): **No',
  ].join('\n');

  const stabilized = stabilizeStreamingMarkdown(partialStream);
  assert.match(stabilized, /```attendance[\s\S]*```$/);

  const html = fallbackMarkdown(stabilized);
  assert.match(html, /class="kyana-attendance-card"/);
  assert.match(html, /Data Structure and Algorithms/);
  assert.match(html, /3 \/ 3/);
});

test('8. Web and Mobile rendering consistency: both platforms implement parseAttendanceBlock, monochromatic bars, red <50% Low Attendance styling, and No records pills', () => {
  assert.equal(typeof renderAttendanceChartHtml, 'function');
  assert.match(chatbotCssSource, /\.kyana-attendance-card\s*\{/);
  assert.match(chatbotCssSource, /\.kyana-att-svg-fill\.is-low\s*\{\s*fill:\s*#ef4444;/);
  assert.match(postMarkdownSource, /export function parseAttendanceBlock/);
  assert.match(postMarkdownSource, /function renderAttendanceCard/);
  assert.match(postMarkdownSource, /VISUAL_BLOCK_KINDS\.includes\(block\.lang\)/);
  assert.match(postMarkdownSource, /Low Attendance/);
  assert.match(postMarkdownSource, /Other subjects/);
});
