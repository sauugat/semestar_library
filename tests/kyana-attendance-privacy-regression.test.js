'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { handleChat } = require('../ai-assistant');
const {
  resolveRequestedRecordOwner,
  isOtherStudentDataRequest
} = require('../lib/chat-security');
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

async function createAttendancePrivacyTestDb() {
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
     VALUES ('coh_sem3', 'earth', 'Earth', 'Earth Cohort', 3, 'active', 'active'),
            ('coh_sem5', 'mars', 'Mars', 'Mars Cohort', 5, 'active', 'active')`
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, email, password, role, department, semester, cohort_id, account_status)
     VALUES ('stu_saugat', 'saugat', 'Saugat', 'saugat@gu.edu.np', 'hash', 'student', 'BIT', 'Semester 3', 'coh_sem3', 'active'),
            ('stu_rahul', 'rahul', 'Rahul Sharma', 'rahul@gu.edu.np', 'hash', 'student', 'BIT', 'Semester 3', 'coh_sem3', 'active'),
            ('stu_empty', 'bina', 'Bina Thapa', 'bina@gu.edu.np', 'hash', 'student', 'BIT', 'Semester 5', 'coh_sem5', 'active'),
            ('tch_ramesh', 'ramesh', 'Dr. Ramesh Adhikari', 'ramesh@gu.edu.np', 'hash', 'teacher', 'BIT', 'Semester 3', NULL, 'active'),
            ('adm_root', 'admin', 'System Admin', 'admin@gu.edu.np', 'hash', 'admin', 'BIT', 'Semester 3', NULL, 'active')`
  );

  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tch_1', 'tch_ramesh', 'Associate Professor', 'active')`
  );

  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
     VALUES ('subj_dbms', 'CIT214', 'Database Management System', 3, 'BIT', 3, 'Theory + Practical', 1),
            ('subj_dsa', 'CIT211', 'Data Structure and Algorithms', 3, 'BIT', 3, 'Theory + Practical', 1),
            ('subj_prob', 'MTH213', 'Fundamentals of Probability and Statistics', 3, 'BIT', 3, 'Theory', 1),
            ('subj_ai', 'CIT312', 'Artificial Intelligence', 5, 'BIT', 3, 'Theory + Practical', 1)`
  );

  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES ('ts_1', 'tch_1', 'subj_dbms'),
            ('ts_2', 'tch_1', 'subj_dsa')`
  );

  await db.run(
    `INSERT INTO attendance_settings (setting_key, setting_value, updated_by)
     VALUES ('eligibility_threshold_percent', '80', 'adm_root')`
  );

  // Seed 20 DBMS sessions (Saugat: 18 present, 2 absent -> 90%)
  for (let i = 1; i <= 20; i++) {
    const sessId = `sess_dbms_${i}`;
    const dayStr = String(i).padStart(2, '0');
    await db.run(
      `INSERT INTO attendance_sessions (id, subject_id, cohort_id, semester_no, teacher_id, recorded_by_user_id, session_date, status, submitted_at)
       VALUES (?, 'subj_dbms', 'coh_sem3', 3, 'tch_1', 'tch_ramesh', ?, 'submitted', '2026-10-${dayStr}T10:00:00Z')`,
      sessId,
      `2026-10-${dayStr}`
    );
    const saugatStatus = i <= 18 ? 'present' : 'absent';
    await db.run(
      `INSERT INTO attendance_records (id, session_id, student_id, status, marked_by)
       VALUES (?, ?, 'stu_saugat', ?, 'tch_ramesh'),
              (?, ?, 'stu_rahul', 'absent', 'tch_ramesh')`,
      `rec_dbms_s_${i}`,
      sessId,
      saugatStatus,
      `rec_dbms_r_${i}`,
      sessId
    );
  }

  // Seed 18 DSA sessions (Saugat: 14 present, 4 absent -> 77.78%)
  for (let i = 1; i <= 18; i++) {
    const sessId = `sess_dsa_${i}`;
    const dayStr = String(i).padStart(2, '0');
    await db.run(
      `INSERT INTO attendance_sessions (id, subject_id, cohort_id, semester_no, teacher_id, recorded_by_user_id, session_date, status, submitted_at)
       VALUES (?, 'subj_dsa', 'coh_sem3', 3, 'tch_1', 'tch_ramesh', ?, 'submitted', '2026-09-${dayStr}T10:00:00Z')`,
      sessId,
      `2026-09-${dayStr}`
    );
    const saugatStatus = i <= 14 ? 'present' : 'absent';
    await db.run(
      `INSERT INTO attendance_records (id, session_id, student_id, status, marked_by)
       VALUES (?, ?, 'stu_saugat', ?, 'tch_ramesh'),
              (?, ?, 'stu_rahul', 'absent', 'tch_ramesh')`,
      `rec_dsa_s_${i}`,
      sessId,
      saugatStatus,
      `rec_dsa_r_${i}`,
      sessId
    );
  }

  // Seed published Mid-Term Exam result for Saugat in DBMS
  await db.run(
    `INSERT INTO exam_configurations (id, subject_id, semester_no, exam_type, max_marks, created_by, updated_by)
     VALUES ('ec_dbms_mid', 'subj_dbms', 3, 'Mid-Term Exam', 30, 'tch_ramesh', 'tch_ramesh')`
  );
  await db.run(
    `INSERT INTO student_marks (id, student_id, subject_id, semester_no, cohort_id, exam_type, obtained_marks, is_absent, max_marks, status, published_at, published_by, created_by, updated_by)
     VALUES ('sm_saugat_1', 'stu_saugat', 'subj_dbms', 3, 'coh_sem3', 'Mid-Term Exam', 27, 0, 30, 'published', '2026-10-25T10:00:00Z', 'tch_ramesh', 'tch_ramesh', 'tch_ramesh'),
            ('sm_rahul_1', 'stu_rahul', 'subj_dbms', 3, 'coh_sem3', 'Mid-Term Exam', 11, 0, 30, 'published', '2026-10-25T10:00:00Z', 'tch_ramesh', 'tch_ramesh', 'tch_ramesh')`
  );

  return db;
}

describe('Kyana AI — Personal Attendance & Results Privacy and Reporting Regression Suite', () => {
  test('1. "Give me my attendance report" & "Give me report of my attendance of all subjects." → ALLOW', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const queries = [
        'Give me my attendance report',
        'Give me report of my attendance of all subjects.',
        'Give me report of my attendance.',
        'Mero attendance report deu.',
        'How much attendance do I have?',
        'Am I eligible for exams?',
        'Show my subject-wise attendance.'
      ];

      for (const q of queries) {
        const ownerCheck = resolveRequestedRecordOwner(q, { studentId: 'stu_saugat', role: 'student' });
        assert.equal(ownerCheck.blocked, false, `Expected ALLOW for "${q}", got blocked`);
        assert.equal(ownerCheck.owner, 'self', `Expected owner="self" for "${q}", got ${ownerCheck.owner}`);

        const res = await handleChat(db, q, { studentId: 'stu_saugat' });
        assert.notEqual(res.intent, 'cross_student', `Query "${q}" must not trigger cross_student refusal`);
        assert.doesNotMatch(res.reply, /can't look up or confirm another student/i);
        assert.match(res.reply, /Database Management System|Eligible|attendance/i);
      }
    } finally {
      db.close();
    }
  });

  test('2. "Show my attendance for all subjects" → ALLOW and renders compact vertical subject breakdown with No records for 0-session subjects', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const res = await handleChat(db, 'Show my attendance for all subjects', { studentId: 'stu_saugat' });
      assert.equal(res.intent, 'attendance');
      assert.match(res.reply, /\*\*Database Management System\*\* \(CIT214\).*90%/);
      assert.match(res.reply, /\*\*Data Structure and Algorithms\*\* \(CIT211\).*77\.78%/);
      assert.match(res.reply, /\*\*Fundamentals of Probability and Statistics\*\* \(MTH213\).*No records/);
      assert.doesNotMatch(res.reply, /Fundamentals of Probability and Statistics \(MTH213\).*0%/);
    } finally {
      db.close();
    }
  });

  test('3. "Mero attendance kati cha?" → ALLOW and returns accurate Nepali/English summary', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const res = await handleChat(db, 'Mero attendance kati cha?', { studentId: 'stu_saugat' });
      assert.equal(res.intent, 'attendance');
      assert.doesNotMatch(res.reply, /Arko student ko marks/i);
      assert.match(res.reply, /32 present/i);
      assert.match(res.reply, /6 missed\/absent/i);
      assert.match(res.reply, /84\.21%/);
      assert.doesNotMatch(res.reply, /Eligible for exams|Required threshold/i);
    } finally {
      db.close();
    }
  });

  test('4. "Show my results" → ALLOW and returns authenticated student\'s published exam marks', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const res = await handleChat(db, 'Show my results', { studentId: 'stu_saugat' });
      assert.equal(res.intent, 'results');
      assert.doesNotMatch(res.reply, /can't look up or confirm another student/i);
      assert.match(res.reply, /Database Management System/);
      assert.match(res.reply, /27 \/ 30/);
      assert.doesNotMatch(res.reply, /11 \/ 30/);
    } finally {
      db.close();
    }
  });

  test('5. "Show attendance of another student" → DENY for ordinary students', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const res = await handleChat(db, 'Show attendance of another student', { studentId: 'stu_saugat' });
      assert.equal(res.intent, 'cross_student');
      assert.match(res.reply, /can't look up or confirm another student's marks, attendance, or personal records/i);
    } finally {
      db.close();
    }
  });

  test('6. "Show all students\' attendance" → DENY for ordinary students, ALLOW for admin permissions', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const resStudent = await handleChat(db, "Show all students' attendance", { studentId: 'stu_saugat' });
      assert.equal(resStudent.intent, 'cross_student');

      const adminCheck = isOtherStudentDataRequest("Show all students' attendance", {
        authenticated: true,
        studentId: 'adm_root',
        role: 'admin'
      });
      assert.equal(adminCheck.blocked, false);
      assert.equal(adminCheck.owner, 'all_students');
    } finally {
      db.close();
    }
  });

  test('7. Unauthenticated attendance requests → Require login', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const resUnauth = await handleChat(db, 'Give me my attendance report', {});
      assert.match(resUnauth.reply, /sign in|log in/i);
    } finally {
      db.close();
    }
  });

  test('8. Empty attendance records → Explain that no attendance data is available and never display 0%', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const resEmpty = await handleChat(db, 'Give me report of my attendance of all subjects.', { studentId: 'stu_empty' });
      assert.equal(resEmpty.intent, 'attendance');
      assert.match(resEmpty.reply, /No attendance records are available|No records/i);
      assert.doesNotMatch(resEmpty.reply, /\b0%/);
    } finally {
      db.close();
    }
  });

  test('9. Attendance percentage → Correct calculation (90%, 77.78%, 84.21%, No records for 0 sessions)', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const res = await handleChat(db, 'Give me report of my attendance of all subjects.', { studentId: 'stu_saugat' });
      assert.match(res.reply, /90%/);
      assert.match(res.reply, /77\.78%/);
      assert.match(res.reply, /84\.21%/);
      assert.doesNotMatch(res.reply, /Required threshold|Exam Eligibility/i);
    } finally {
      db.close();
    }
  });

  test('10. Semester and subject filtering → Correct isolation per student semester and subject', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const resSem3 = await handleChat(db, 'Show my attendance for all subjects', { studentId: 'stu_saugat' });
      assert.match(resSem3.reply, /Semester 3/);
      assert.doesNotMatch(resSem3.reply, /Artificial Intelligence/);

      const resSubj = await handleChat(db, 'What is my attendance in DSA?', { studentId: 'stu_saugat' });
      assert.match(resSubj.reply, /Data Structure and Algorithms.*\(CIT211\)/);
      assert.match(resSubj.reply, /77\.78%/);
      assert.doesNotMatch(resSubj.reply, /Below exam eligibility threshold|Required threshold/i);
    } finally {
      db.close();
    }
  });
});
