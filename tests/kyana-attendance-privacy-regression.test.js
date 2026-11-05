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
const { ensureAuditSchema } = require('../lib/audit-service');
const {
  ensureMarksSchema,
  upsertExamConfiguration,
  saveStudentMarks,
  publishSubjectResults
} = require('../lib/marks-service');

async function createAttendancePrivacyTestDb() {
  const client = createClient({ url: ':memory:' });
  let dbRef = null;
  const db = {
    isPostgres: false,
    client,
    exec: async (sql) => client.executeMultiple(sql),
    all: async (sql, ...params) => {
      const res = await client.execute({ sql, args: params });
      return res.rows.map(r => ({ ...r }));
    },
    get: async (sql, ...params) => {
      const res = await client.execute({ sql, args: params });
      return res.rows[0] ? { ...res.rows[0] } : null;
    },
    run: async (sql, ...params) => {
      const res = await client.execute({ sql, args: params });
      return {
        lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null,
        changes: res.rowsAffected || 0
      };
    },
    withTransaction: async (fn) => fn(dbRef),
    close: async () => client.close()
  };
  dbRef = db;

  await db.exec(`
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
      account_status TEXT DEFAULT 'active'
    );
    CREATE TABLE cohorts (
      id TEXT PRIMARY KEY,
      slot_code TEXT,
      display_name TEXT,
      current_semester INTEGER NOT NULL,
      intake_year INTEGER DEFAULT 2025,
      intake_identifier TEXT DEFAULT '2025-Fall',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      graduated_at TEXT
    );
    CREATE TABLE subjects (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT NOT NULL,
      semester INTEGER,
      department TEXT,
      credit_hours INTEGER,
      nature TEXT,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE teachers (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      designation TEXT,
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE teacher_subjects (
      id TEXT PRIMARY KEY,
      teacher_id TEXT,
      subject_id TEXT,
      assigned_by TEXT
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      title TEXT,
      content TEXT,
      type TEXT DEFAULT 'status',
      category TEXT DEFAULT 'general',
      subject TEXT,
      semester TEXT,
      semester_no INTEGER,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'all_students',
      visibility TEXT DEFAULT 'everyone',
      target_all_semesters INTEGER DEFAULT 1,
      moderation_status TEXT DEFAULT 'active',
      hidden_at TEXT,
      deleted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE routine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semester INTEGER,
      subject_name TEXT,
      subject_code TEXT,
      exam_date TEXT,
      calendar TEXT DEFAULT 'BS',
      weekday TEXT,
      exam_time TEXT,
      room TEXT,
      exam_type TEXT DEFAULT 'Final'
    );
    CREATE TABLE knowledge_resources (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      canonical_id INTEGER,
      canonical_code TEXT,
      title TEXT,
      source_authority_tier INTEGER NOT NULL DEFAULT 4,
      author_id TEXT,
      author_role TEXT,
      cohort_id TEXT,
      semester_no INTEGER,
      audience_scope TEXT DEFAULT 'all_students',
      target_all_semesters INTEGER DEFAULT 1,
      visibility TEXT DEFAULT 'everyone',
      web_url TEXT,
      mobile_route TEXT,
      mobile_params TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      hidden_at TEXT,
      content_hash TEXT
    );
    CREATE TABLE knowledge_chunks (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      embedding_model TEXT,
      page_number INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureTeacherSchema({ exec: db.exec, isPostgres: false });
  await ensureAttendanceSchema(db);
  await ensureMarksSchema(db);
  await ensureAuditSchema(db);

  // Seed cohorts (Semester 3 and Semester 5)
  await db.run(
    `INSERT INTO cohorts (id, slot_code, display_name, current_semester, status)
     VALUES ('coh_sem3', 'earth', 'Earth', 3, 'active'),
            ('coh_sem5', 'mars', 'Mars', 5, 'active')`
  );

  // Seed students, teacher, and admin
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, department, semester, cohort_id, account_status)
     VALUES ('stu_saugat', 'saugat', 'Saugat', 'saugat@gu.edu.np', 'student', 'BIT', 'Semester 3', 'coh_sem3', 'active'),
            ('stu_rahul', 'rahul', 'Rahul Sharma', 'rahul@gu.edu.np', 'student', 'BIT', 'Semester 3', 'coh_sem3', 'active'),
            ('stu_empty', 'bina', 'Bina Thapa', 'bina@gu.edu.np', 'student', 'BIT', 'Semester 5', 'coh_sem5', 'active'),
            ('tch_ramesh', 'ramesh', 'Dr. Ramesh Adhikari', 'ramesh@gu.edu.np', 'teacher', 'BIT', 'Semester 3', NULL, 'active'),
            ('adm_root', 'admin', 'System Admin', 'admin@gu.edu.np', 'admin', 'BIT', 'Semester 3', NULL, 'active')`
  );

  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tch_1', 'tch_ramesh', 'Associate Professor', 'active')`
  );

  // Seed canonical subjects for Semester 3 and Semester 5
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
     VALUES ('subj_dbms', 'CIT214', 'Database Management System', 3, 'BIT', 3, 'Theory + Practical', 1),
            ('subj_dsa', 'CIT211', 'Data Structure and Algorithms', 3, 'BIT', 3, 'Theory + Practical', 1),
            ('subj_prob', 'MTH213', 'Fundamentals of Probability and Statistics', 3, 'BIT', 3, 'Theory', 1),
            ('subj_ai', 'CIT312', 'Artificial Intelligence', 5, 'BIT', 3, 'Theory + Practical', 1)`
  );

  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id, assigned_by)
     VALUES ('ts_1', 'tch_1', 'subj_dbms', 'adm_root'),
            ('ts_2', 'tch_1', 'subj_dsa', 'adm_root')`
  );

  // Configure exam eligibility threshold = 80%
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
  // Note: MTH213 (Fundamentals of Probability and Statistics) has 0 recorded sessions to test 0-session handling.

  // Seed published Mid-Term Exam result for Saugat in DBMS
  await upsertExamConfiguration(db, {
    actorUserId: 'tch_ramesh',
    subjectId: 'CIT214',
    examType: 'Mid-Term Exam',
    maxMarks: 30
  });
  await saveStudentMarks(db, {
    actorUserId: 'tch_ramesh',
    subjectId: 'CIT214',
    examType: 'Mid-Term Exam',
    records: [
      { studentId: 'stu_saugat', obtainedMarks: 27 },
      { studentId: 'stu_rahul', obtainedMarks: 11 }
    ]
  });
  await publishSubjectResults(db, {
    actorUserId: 'tch_ramesh',
    subjectId: 'CIT214',
    examType: 'Mid-Term Exam'
  });

  return db;
}

describe('Kyana AI — Personal Attendance & Results Privacy and Reporting Regression Suite', () => {
  test('1. "Give me my attendance report" & "Give me report of my attendance of all subjects." → ALLOW and returns subject-wise table', async () => {
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
      await db.close();
    }
  });

  test('2. "Show my attendance for all subjects" → ALLOW and renders Markdown table with Subject, Total, Present, Absent, Attendance columns', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const res = await handleChat(db, 'Show my attendance for all subjects', { studentId: 'stu_saugat' });
      assert.equal(res.intent, 'attendance');
      assert.match(res.reply, /\*\*Your Attendance Report/i);
      assert.match(res.reply, /\|\s*Subject\s*\|\s*Total\s*\|\s*Present\s*\|\s*Absent\s*\|\s*Attendance\s*\|/);
      assert.match(res.reply, /\|\s*Database Management System \(CIT214\)\s*\|\s*20\s*\|\s*18\s*\|\s*2\s*\|\s*90%\s*\|/);
      assert.match(res.reply, /\|\s*Data Structure and Algorithms \(CIT211\)\s*\|\s*18\s*\|\s*14\s*\|\s*4\s*\|\s*77\.78%\s*\|/);
      // Subject with 0 sessions (MTH213) handled cleanly without division by zero
      assert.match(res.reply, /\|\s*Fundamentals of Probability and Statistics \(MTH213\)\s*\|\s*0\s*\|\s*0\s*\|\s*0\s*\|\s*0%\s*\|/);
    } finally {
      await db.close();
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
      assert.match(res.reply, /Eligible for exams \(Required threshold: 80%\)/i);
    } finally {
      await db.close();
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
      // Must not leak Rahul's marks (11 / 30)
      assert.doesNotMatch(res.reply, /11 \/ 30/);
    } finally {
      await db.close();
    }
  });

  test('5. "Show attendance of another student" → DENY for ordinary students', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const res = await handleChat(db, 'Show attendance of another student', { studentId: 'stu_saugat' });
      assert.equal(res.intent, 'cross_student');
      assert.match(res.reply, /can't look up or confirm another student's marks, attendance, or personal records/i);

      const resNamed = await handleChat(db, "Show Rahul Sharma's attendance", { studentId: 'stu_saugat' });
      assert.equal(resNamed.intent, 'cross_student');
    } finally {
      await db.close();
    }
  });

  test('6. "Show all students\' attendance" → DENY for ordinary students, ALLOW for admin permissions', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const studentCheck = isOtherStudentDataRequest("Show all students' attendance", {
        authenticated: true,
        studentId: 'stu_saugat',
        role: 'student'
      });
      assert.equal(studentCheck.blocked, true);
      assert.equal(studentCheck.owner, 'all_students');

      const resStudent = await handleChat(db, "Show all students' attendance", { studentId: 'stu_saugat' });
      assert.equal(resStudent.intent, 'cross_student');
      assert.match(resStudent.reply, /can't look up or confirm another student's marks, attendance, or personal records/i);

      // Admin has administrative permissions -> not blocked by cross-student privacy guard
      const adminCheck = isOtherStudentDataRequest("Show all students' attendance", {
        authenticated: true,
        studentId: 'adm_root',
        role: 'admin'
      });
      assert.equal(adminCheck.blocked, false);
      assert.equal(adminCheck.owner, 'all_students');
    } finally {
      await db.close();
    }
  });

  test('7. Unauthenticated attendance requests → Require login', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const resUnauth = await handleChat(db, 'Give me my attendance report', {});
      assert.match(resUnauth.reply, /sign in|log in/i);
      assert.doesNotMatch(resUnauth.reply, /Database Management System/);
    } finally {
      await db.close();
    }
  });

  test('8. Empty attendance records → Explain that no attendance data is available', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const resEmpty = await handleChat(db, 'Give me report of my attendance of all subjects.', { studentId: 'stu_empty' });
      assert.equal(resEmpty.intent, 'attendance');
      assert.match(resEmpty.reply, /No attendance data is available yet/i);
      assert.match(resEmpty.reply, /\|\s*Artificial Intelligence \(CIT312\)\s*\|\s*0\s*\|\s*0\s*\|\s*0\s*\|\s*0%\s*\|/);
      assert.doesNotMatch(resEmpty.reply, /NaN|Infinity/i);
    } finally {
      await db.close();
    }
  });

  test('9. Attendance percentage → Correct calculation (90%, 77.78%, 84.21%, 0% for 0 sessions, configured threshold 80%)', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      const res = await handleChat(db, 'Give me report of my attendance of all subjects.', { studentId: 'stu_saugat' });
      // DBMS: 18/20 = 90%
      assert.match(res.reply, /90%/);
      // DSA: 14/18 = 77.78%
      assert.match(res.reply, /77\.78%/);
      // Probability & Stats: 0/0 = 0%
      assert.match(res.reply, /\|\s*Fundamentals of Probability and Statistics \(MTH213\)\s*\|\s*0\s*\|\s*0\s*\|\s*0\s*\|\s*0%\s*\|/);
      // Overall: 32/38 = 84.21%, threshold = 80%
      assert.match(res.reply, /84\.21%/);
      assert.match(res.reply, /Required threshold: 80%/);
    } finally {
      await db.close();
    }
  });

  test('10. Semester and subject filtering → Correct isolation per student semester and subject', async () => {
    const db = await createAttendancePrivacyTestDb();
    try {
      // Semester 3 student (stu_saugat) only sees Semester 3 subjects (DBMS, DSA, MTH213), never Semester 5 (AI)
      const resSem3 = await handleChat(db, 'Show my attendance for all subjects', { studentId: 'stu_saugat' });
      assert.match(resSem3.reply, /Semester 3/);
      assert.match(resSem3.reply, /Database Management System/);
      assert.doesNotMatch(resSem3.reply, /Artificial Intelligence/);

      // Specific subject query filters to that subject
      const resSubj = await handleChat(db, 'What is my attendance in DSA?', { studentId: 'stu_saugat' });
      assert.match(resSubj.reply, /Data Structure and Algorithms \(CIT211\)/);
      assert.match(resSubj.reply, /77\.78%/);
      assert.match(resSubj.reply, /Below exam eligibility threshold \(Required threshold: 80%\)/);
    } finally {
      await db.close();
    }
  });
});
