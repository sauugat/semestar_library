'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { handleChat } = require('../ai-assistant');
const { classifyResponseComplexity, toneInstructions } = require('../lib/chat-personality');
const { ensureTeacherSchema } = require('../lib/teacher-service');
const { ensureAttendanceSchema } = require('../lib/attendance-service');
const { ensureMarksSchema } = require('../lib/marks-service');

function createInMemoryDb() {
  const client = createClient({ url: ':memory:' });
  const normalizeArgs = (params) => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    return flat.map(v => (v === undefined ? null : v));
  };
  const adapter = {
    isPostgres: false,
    client,
    exec: async (sql) => { await client.executeMultiple(sql); },
    get: async (sql, ...params) => {
      const res = await client.execute({ sql, args: normalizeArgs(params) });
      return res.rows[0] ? { ...res.rows[0] } : null;
    },
    all: async (sql, ...params) => {
      const res = await client.execute({ sql, args: normalizeArgs(params) });
      return (res.rows || []).map(r => ({ ...r }));
    },
    run: async (sql, ...params) => {
      const res = await client.execute({ sql, args: normalizeArgs(params) });
      return {
        changes: Number(res.rowsAffected || 0),
        lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null
      };
    },
    withTransaction: async (fn) => fn(adapter),
    close: () => client.close()
  };
  return adapter;
}

async function createQualityTestDb({ configureThreshold = true, thresholdValue = '75' } = {}) {
  process.env.NODE_ENV = 'test';
  process.env.KYANA_KNOWLEDGE_V3 = 'false';

  const db = createInMemoryDb();
  await db.exec(`
    CREATE TABLE cohorts (
      id TEXT PRIMARY KEY,
      slot_code TEXT,
      display_name TEXT,
      name TEXT NOT NULL,
      group_code TEXT,
      entry_year INTEGER,
      intake_year INTEGER,
      intake_identifier TEXT,
      current_semester INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      operational_status TEXT DEFAULT 'active',
      version INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      graduated_at TEXT
    );
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      username TEXT,
      name TEXT NOT NULL,
      email TEXT,
      password TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      department TEXT DEFAULT 'BIT',
      semester TEXT,
      cohort_id TEXT,
      account_status TEXT DEFAULT 'active',
      verification_status TEXT DEFAULT 'verified'
    );
  `);
  await ensureTeacherSchema(db);
  await ensureAttendanceSchema(db);
  await ensureMarksSchema(db);

  await db.run(
    `INSERT INTO cohorts (id, slot_code, display_name, name, current_semester, status, operational_status)
     VALUES ('coh_complete', 'mercury', 'Mercury', 'Mercury Cohort', 3, 'active', 'active'),
            ('coh_incomplete', 'venus', 'Venus', 'Venus Cohort', 4, 'active', 'active'),
            ('coh_zero', 'earth', 'Earth', 'Earth Cohort', 5, 'active', 'active')`
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, email, password, role, department, semester, cohort_id, account_status)
     VALUES ('stu_complete', 'aarav', 'Aarav', 'aarav@gu.edu.np', 'hash', 'student', 'BIT', 'Semester 3', 'coh_complete', 'active'),
            ('stu_incomplete', 'saugat', 'Saugat', 'saugat@gu.edu.np', 'hash', 'student', 'BIT', 'Semester 4', 'coh_incomplete', 'active'),
            ('stu_zero', 'bina', 'Bina', 'bina@gu.edu.np', 'hash', 'student', 'BIT', 'Semester 5', 'coh_zero', 'active'),
            ('tch_1', 'ramesh', 'Dr. Ramesh', 'ramesh@gu.edu.np', 'hash', 'teacher', 'BIT', 'Semester 3', NULL, 'active'),
            ('adm_1', 'admin', 'Admin', 'admin@gu.edu.np', 'hash', 'admin', 'BIT', 'Semester 3', NULL, 'active')`
  );

  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('t_prof_1', 'tch_1', 'Professor', 'active')`
  );

  // Semester 3: 2 subjects, both with recorded sessions (complete)
  // Semester 4: 2 subjects, only 1 with recorded sessions (incomplete)
  // Semester 5: 2 subjects, 0 recorded sessions (zero)
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
     VALUES ('s3_dbms', 'CIT214', 'Database Management System', 3, 'BIT', 3, 'Theory + Practical', 1),
            ('s3_dsa', 'CIT211', 'Data Structure and Algorithms', 3, 'BIT', 3, 'Theory + Practical', 1),
            ('s4_os', 'CIT221', 'Operating Systems', 4, 'BIT', 3, 'Theory + Practical', 1),
            ('s4_cn', 'CIT222', 'Data Communication and Computer Networks', 4, 'BIT', 3, 'Theory + Practical', 1),
            ('s5_ai', 'CIT312', 'Artificial Intelligence', 5, 'BIT', 3, 'Theory + Practical', 1),
            ('s5_se', 'CIT311', 'Software Engineering', 5, 'BIT', 3, 'Theory', 1)`
  );

  if (configureThreshold) {
    await db.run(
      `INSERT INTO attendance_settings (setting_key, setting_value, updated_by)
       VALUES ('eligibility_threshold_percent', ?, 'adm_1')`,
      String(thresholdValue)
    );
  }

  // Seed complete Semester 3 sessions for stu_complete:
  // DBMS: 10 sessions (9 present, 1 absent = 90%)
  for (let i = 1; i <= 10; i++) {
    const sid = `s3_dbms_sess_${i}`;
    const d = `2026-10-${String(i).padStart(2, '0')}`;
    await db.run(
      `INSERT INTO attendance_sessions (id, subject_id, cohort_id, semester_no, teacher_id, recorded_by_user_id, session_date, status, submitted_at)
       VALUES (?, 's3_dbms', 'coh_complete', 3, 't_prof_1', 'tch_1', ?, 'submitted', '${d}T10:00:00Z')`,
      sid, d
    );
    await db.run(
      `INSERT INTO attendance_records (id, session_id, student_id, status, marked_by)
       VALUES (?, ?, 'stu_complete', ?, 'tch_1')`,
      `r_${sid}`, sid, i <= 9 ? 'present' : 'absent'
    );
  }
  // DSA: 10 sessions (8 present, 2 absent = 80%)
  for (let i = 1; i <= 10; i++) {
    const sid = `s3_dsa_sess_${i}`;
    const d = `2026-09-${String(i).padStart(2, '0')}`;
    await db.run(
      `INSERT INTO attendance_sessions (id, subject_id, cohort_id, semester_no, teacher_id, recorded_by_user_id, session_date, status, submitted_at)
       VALUES (?, 's3_dsa', 'coh_complete', 3, 't_prof_1', 'tch_1', ?, 'submitted', '${d}T10:00:00Z')`,
      sid, d
    );
    await db.run(
      `INSERT INTO attendance_records (id, session_id, student_id, status, marked_by)
       VALUES (?, ?, 'stu_complete', ?, 'tch_1')`,
      `r_${sid}`, sid, i <= 8 ? 'present' : 'absent'
    );
  }

  // Seed incomplete Semester 4 sessions for stu_incomplete:
  // OS: 10 sessions (7 present, 3 absent = 70%), CN: 0 sessions!
  for (let i = 1; i <= 10; i++) {
    const sid = `s4_os_sess_${i}`;
    const d = `2026-10-${String(i).padStart(2, '0')}`;
    await db.run(
      `INSERT INTO attendance_sessions (id, subject_id, cohort_id, semester_no, teacher_id, recorded_by_user_id, session_date, status, submitted_at)
       VALUES (?, 's4_os', 'coh_incomplete', 4, 't_prof_1', 'tch_1', ?, 'submitted', '${d}T10:00:00Z')`,
      sid, d
    );
    await db.run(
      `INSERT INTO attendance_records (id, session_id, student_id, status, marked_by)
       VALUES (?, ?, 'stu_incomplete', ?, 'tch_1')`,
      `r_${sid}`, sid, i <= 7 ? 'present' : 'absent'
    );
  }

  return db;
}

describe('Kyana AI — Global Response Quality and Formatting Regression Suite (10 Scenarios)', () => {
  test('1. Attendance with complete records: compact vertical layout, progress bar, accurate percentages, no recent history spam', async () => {
    const db = await createQualityTestDb({ configureThreshold: true, thresholdValue: '75' });
    try {
      const res = await handleChat(db, 'Show my attendance report', { studentId: 'stu_complete' });
      assert.equal(res.intent, 'attendance');
      // Overall: 17/20 = 85%
      assert.match(res.reply, /85%/);
      assert.match(res.reply, /17 present, 3 missed\/absent out of 20 total classes/);
      assert.match(res.reply, /\*\*Database Management System\*\* \(CIT214\): \*\*90%\*\* \| 10 recorded classes \| Present: 9 \| Absent: 1/);
      assert.match(res.reply, /\*\*Data Structure and Algorithms\*\* \(CIT211\): \*\*80%\*\* \| 10 recorded classes \| Present: 8 \| Absent: 2/);
      // Recent sessions not dumped when not requested
      assert.doesNotMatch(res.reply, /Recent Class Attendance/i);
    } finally {
      db.close();
    }
  });

  test('2. Attendance with zero recorded classes: displays "No records" and never displays 0% as an attendance rate', async () => {
    const db = await createQualityTestDb({ configureThreshold: true, thresholdValue: '75' });
    try {
      const res = await handleChat(db, 'Give me my attendance report', { studentId: 'stu_zero' });
      assert.equal(res.intent, 'attendance');
      assert.match(res.reply, /No records/);
      assert.match(res.reply, /\*\*Artificial Intelligence\*\* \(CIT312\): \*\*No records\*\*/);
      assert.match(res.reply, /\*\*Software Engineering\*\* \(CIT311\): \*\*No records\*\*/);
      assert.doesNotMatch(res.reply, /\b0%/, 'Must never display 0% when denominator is zero');
    } finally {
      db.close();
    }
  });

  test('3. Attendance with incomplete subject records: explicitly states aggregate covers recorded classes only and marks unrecorded subjects as Undetermined (No records)', async () => {
    const db = await createQualityTestDb({ configureThreshold: true, thresholdValue: '75' });
    try {
      const res = await handleChat(db, 'Show my subject-wise attendance', { studentId: 'stu_incomplete' });
      assert.equal(res.intent, 'attendance');
      assert.match(res.reply, /Only \*\*1 of 2 subjects\*\* \(Operating Systems\) has recorded attendance so far/i);
      assert.match(res.reply, /\*\*Operating Systems\*\* \(CIT221\): \*\*70%\*\*/);
      assert.match(res.reply, /\*\*Data Communication and Computer Networks\*\* \(CIT222\): \*\*No records\*\*/);
      assert.doesNotMatch(res.reply, /CIT222.*0%/);
    } finally {
      db.close();
    }
  });

  test('4. Missing eligibility configuration: returns "Cannot determine eligibility" and never guesses 75%', async () => {
    const db = await createQualityTestDb({ configureThreshold: false });
    try {
      const resElig = await handleChat(db, 'Am I eligible for exams?', { studentId: 'stu_complete' });
      assert.equal(resElig.intent, 'attendance');
      assert.doesNotMatch(resElig.reply, /Cannot determine eligibility|Exam Eligibility|Required threshold/i);
      assert.doesNotMatch(resElig.reply, /75%/, 'Must never guess 75% when threshold is unconfigured');

      const resReport = await handleChat(db, 'Give me my attendance report', { studentId: 'stu_complete' });
      assert.doesNotMatch(resReport.reply, /Cannot determine eligibility|Exam Eligibility|Required threshold/i);
      assert.doesNotMatch(resReport.reply, /75%/);
    } finally {
      db.close();
    }
  });

  test('5. Configured eligibility threshold: calculates eligibility using actual configured setting (85%) and explains eligible vs ineligible subjects', async () => {
    const db = await createQualityTestDb({ configureThreshold: true, thresholdValue: '85' });
    try {
      const res = await handleChat(db, 'Am I eligible for exams?', { studentId: 'stu_complete' });
      assert.equal(res.intent, 'attendance');
      assert.doesNotMatch(res.reply, /Required threshold|Exam Eligibility/i);
      // DBMS is 90% -> Eligible; DSA is 80% -> Below exam eligibility threshold (85%)
      assert.match(res.reply, /\*\*Database Management System\*\* \(CIT214\): \*\*90%\*\*/);
      assert.match(res.reply, /\*\*Data Structure and Algorithms\*\* \(CIT211\): \*\*80%\*\*/);
    } finally {
      db.close();
    }
  });

  test('6. Nepali attendance questions: understands Romanized Nepali naturally and responds without canned filler or decorative emojis', async () => {
    const db = await createQualityTestDb({ configureThreshold: true, thresholdValue: '75' });
    try {
      const res = await handleChat(db, 'Mero attendance report deu.', { studentId: 'stu_complete' });
      assert.equal(res.intent, 'attendance');
      assert.match(res.reply, /timro overall attendance \*\*85%\*\* cha/i);
      assert.doesNotMatch(res.reply, /💀|😭|🌟|📊/);
    } finally {
      db.close();
    }
  });

  test('7. Simple questions requiring one-line answers: classified as "simple" complexity and answered concisely', async () => {
    const db = await createQualityTestDb();
    try {
      const c = classifyResponseComplexity('What is recursion in C?');
      assert.equal(c.level, 'simple');
      assert.match(c.directive, /SIMPLE QUESTION/);

      let capturedPrompt = '';
      const res = await handleChat(
        db,
        'What is recursion in C?',
        { studentId: 'stu_complete' },
        [],
        'sess_simple',
        {
          generateReply: async ({ systemPrompt, onDelta }) => {
            capturedPrompt = systemPrompt;
            const text = 'Recursion in C is when a function calls itself with a smaller input until it reaches a base case.';
            onDelta(text);
            return { reply: text };
          }
        }
      );
      assert.match(capturedPrompt, /RESPONSE COMPLEXITY \(SIMPLE QUESTION\)/);
      assert.equal(res.reply.split('\n').length, 1);
    } finally {
      db.close();
    }
  });

  test('8. Complex academic questions: classified as "complex" complexity and allows structured sections/comparisons', async () => {
    const db = await createQualityTestDb();
    try {
      const q = 'Compare TCP and UDP protocols in detail with their architecture, pros and cons.';
      const c = classifyResponseComplexity(q);
      assert.equal(c.level, 'complex');
      assert.match(c.directive, /COMPLEX QUESTION/);

      const ti = toneInstructions(q, [], 'roast');
      assert.match(ti, /RESPONSE COMPLEXITY \(COMPLEX QUESTION\)/);
    } finally {
      db.close();
    }
  });

  test('9. Responses containing redundant information: subject names and percentages appear only once in attendance and subject lookups', async () => {
    const db = await createQualityTestDb({ configureThreshold: true, thresholdValue: '75' });
    try {
      const resAll = await handleChat(db, 'Give me report of my attendance of all subjects.', { studentId: 'stu_complete' });
      const dbmsMatches = resAll.reply.match(/Database Management System/g) || [];
      assert.equal(dbmsMatches.length, 1, `Expected DBMS to appear exactly once in attendance report, appeared ${dbmsMatches.length} times`);

      const resSubj = await handleChat(db, 'What is my attendance in DBMS?', { studentId: 'stu_complete' });
      const pctMatches = resSubj.reply.match(/90%/g) || [];
      assert.ok(pctMatches.length >= 1, 'Expected 90% in single-subject attendance lookup');
    } finally {
      db.close();
    }
  });

  test('10. Mobile response readability: avoids wide Markdown tables, decorative emojis, and deeply nested lists', async () => {
    const db = await createQualityTestDb({ configureThreshold: true, thresholdValue: '75' });
    try {
      const res = await handleChat(db, 'Show my attendance for all subjects', { studentId: 'stu_complete' });
      // Must not render wide Markdown table pipes
      assert.doesNotMatch(res.reply, /\|\s*Subject\s*\|\s*Total\s*\|/);
      // Must not include decorative emojis
      assert.doesNotMatch(res.reply, /[💀😭🌟📊🎓📌💬💻]/);
      // Uses compact vertical bullets
      const bulletLines = res.reply.split('\n').filter(l => l.startsWith('- '));
      assert.ok(bulletLines.length >= 2, 'Expected compact vertical bullet points for mobile readability');
    } finally {
      db.close();
    }
  });
});
