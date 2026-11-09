'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { handleChat } = require('../ai-assistant');
const {
  routeQuery,
  createTools,
  teacherClassroomIntent,
  resultsIntent,
  isPersonalRecordFollowUpMessage
} = require('../lib/chat-tools');
const {
  resolveRequestedRecordOwner,
  isOtherStudentDataRequest
} = require('../lib/chat-security');
const { ensureTeacherSchema } = require('../lib/teacher-service');
const { ensureAttendanceSchema } = require('../lib/attendance-service');
const { ensureMarksSchema } = require('../lib/marks-service');
const { getAcademicContext } = require('../lib/academic-context');

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

async function createMarksAuthTestDb() {
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
     VALUES ('stu_saugat', 'saugat', 'Saugat Subedi', 'saugat@gu.edu.np', 'hash', 'student', 'BIT', 'Semester 3', 'coh_sem3', 'active'),
            ('stu_rahul', 'rahul', 'Rahul Sharma', 'rahul@gu.edu.np', 'hash', 'student', 'BIT', 'Semester 3', 'coh_sem3', 'active'),
            ('tch_ramesh', 'ramesh', 'Dr. Ramesh Adhikari', 'ramesh@gu.edu.np', 'hash', 'teacher', 'BIT', 'Semester 3', NULL, 'active'),
            ('adm_root', 'admin', 'System Admin', 'admin@gu.edu.np', 'hash', 'admin', 'BIT', 'Semester 3', 'coh_sem3', 'active')`
  );

  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tch_1', 'tch_ramesh', 'Associate Professor', 'active')`
  );

  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
     VALUES ('subj_dsa', 'CIT214', 'Data Structure and Algorithms', 3, 'BIT', 3, 'Theory + Practical', 1),
            ('subj_dbms', 'CIT211', 'Database Management System', 3, 'BIT', 3, 'Theory + Practical', 1),
            ('subj_ai', 'CIT312', 'Artificial Intelligence', 5, 'BIT', 3, 'Theory + Practical', 1)`
  );

  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES ('ts_1', 'tch_1', 'subj_dsa')`
  );

  // Configure Exam: Mid-Term, Pre-Board, Final for DSA
  await db.run(
    `INSERT INTO exam_configurations (id, subject_id, semester_no, exam_type, max_marks, created_by, updated_by)
     VALUES ('cfg_mid', 'subj_dsa', 3, 'Mid-Term Exam', 50, 'tch_ramesh', 'tch_ramesh'),
            ('cfg_pre', 'subj_dsa', 3, 'Pre-Board Exam', 75, 'tch_ramesh', 'tch_ramesh'),
            ('cfg_fin', 'subj_dsa', 3, 'Final Exam', 75, 'tch_ramesh', 'tch_ramesh')`
  );

  // Seed Draft Marks for Saugat in DSA (status = 'draft')
  await db.run(
    `INSERT INTO student_marks (id, student_id, subject_id, semester_no, cohort_id, exam_type, obtained_marks, max_marks, status, created_by, updated_by)
     VALUES ('m_mid_saugat', 'stu_saugat', 'subj_dsa', 3, 'coh_sem3', 'Mid-Term Exam', 42, 50, 'draft', 'tch_ramesh', 'tch_ramesh'),
            ('m_pre_saugat', 'stu_saugat', 'subj_dsa', 3, 'coh_sem3', 'Pre-Board Exam', 65, 75, 'draft', 'tch_ramesh', 'tch_ramesh'),
            ('m_fin_saugat', 'stu_saugat', 'subj_dsa', 3, 'coh_sem3', 'Final Exam', 68, 75, 'draft', 'tch_ramesh', 'tch_ramesh')`
  );

  return db;
}

describe('Kyana AI — Student Marks Authorization & Routing Regression Suite', () => {
  let db;

  test('Setup test database and academic contexts', async () => {
    db = await createMarksAuthTestDb();
    assert.ok(db);
  });

  // Test Case 1: Student asks for own DSA marks -> routes to get_my_results, CIT214
  test('Case 1: Student asks "wtf this this man my marks in dsa" -> routes to get_my_results and resolves DSA', async () => {
    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });
    const query = 'wtf this this man my marks in dsa';
    const route = routeQuery(query, [], { academicContext: studentCtx });

    assert.equal(route.kind, 'results', 'Must classify as results intent, not teacher_classroom');
    assert.equal(route.filters.subject, 'Data Structure and Algorithms');

    const res = await handleChat(db, query, { academicContext: studentCtx }, [], 'test_sess_1', {
      useAgentEngine: false
    });

    assert.equal(res.intent, 'results');
    assert.ok(!res.reply.includes('Teacher Classroom Summary'), 'Must never expose Teacher Classroom Summary to student');
    assert.ok(!res.reply.includes('Pending Submissions'), 'Must not leak pending submissions');
    assert.ok(!res.reply.includes('Exam Configurations:'), 'Must not leak exam configurations');
  });

  // Test Case 2: Student asks in Romanized Nepali
  test('Case 2: Student asks in Romanized Nepali ("mero DSA ko marks kati aayo?", "DSA ma kati marks aayo?")', async () => {
    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });

    const q1 = 'mero DSA ko marks kati aayo?';
    const r1 = routeQuery(q1, [], { academicContext: studentCtx });
    assert.equal(r1.kind, 'results');
    assert.equal(r1.filters.subject, 'Data Structure and Algorithms');

    const q2 = 'DSA ma kati marks aayo?';
    const r2 = routeQuery(q2, [], { academicContext: studentCtx });
    assert.equal(r2.kind, 'results');
    assert.equal(r2.filters.subject, 'Data Structure and Algorithms');
  });

  // Test Case 3: Student asks in Devanagari
  test('Case 3: Student asks in Devanagari ("मेरो DSA को नम्बर कति आयो?")', async () => {
    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });
    const query = 'मेरो DSA को नम्बर कति आयो?';
    const route = routeQuery(query, [], { academicContext: studentCtx });
    assert.equal(route.kind, 'results');
    assert.equal(route.filters.subject, 'Data Structure and Algorithms');
  });

  // Test Case 4: Student asks for a specific examination
  test('Case 4: Student asks for a specific examination ("Mid-Term Exam marks in DSA")', async () => {
    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });
    const query = 'Mid-Term Exam marks in DSA';
    const route = routeQuery(query, [], { academicContext: studentCtx });
    assert.equal(route.kind, 'results');
    assert.equal(route.filters.subject, 'Data Structure and Algorithms');

    const toolkit = createTools(db, route, { academicContext: studentCtx });
    const toolRes = await toolkit.executeTool('get_my_results', { subject: 'Data Structure and Algorithms' });
    assert.equal(toolRes.requestedExamType, 'Mid-Term Exam');
  });

  // Test Case 5: Student asks for unpublished marks -> natural unpublished notification
  test('Case 5: Student asks for unpublished marks -> returns "DSA ko marks ahile university le publish gareko chaina..." in Romanized Nepali', async () => {
    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });
    const query = 'mero DSA ko marks kati aayo?';
    const res = await handleChat(db, query, { academicContext: studentCtx }, [], 'test_sess_5', {
      useAgentEngine: false
    });

    assert.ok(
      res.reply.includes('DSA ko marks ahile university le publish gareko chaina. Publish bhayepachi ma timilai result dekhaidinchu.'),
      `Expected natural unpublished notification, got: ${res.reply}`
    );
  });

  // Test Case 6: Student asks for another student's marks -> BLOCKED (cross_student)
  test('Case 6: Student asks for another student\'s marks -> BLOCKED (cross_student)', async () => {
    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });
    const query = "What did Rahul score in DSA?";

    const ownerCheck = resolveRequestedRecordOwner(query, studentCtx);
    assert.equal(ownerCheck.owner, 'other_student');

    const crossCheck = isOtherStudentDataRequest(query, studentCtx);
    assert.equal(crossCheck.blocked, true);

    const res = await handleChat(db, query, { academicContext: studentCtx }, [], 'test_sess_6');
    assert.equal(res.intent, 'cross_student');
    assert.ok(
      res.reply.includes('Rahul Sharma') || res.reply.includes('privacy') || res.reply.includes('afno matra') || res.reply.includes("another student's marks"),
      `Expected privacy refusal, got: ${res.reply}`
    );
  });

  // Test Case 7: Student attempts to invoke teacher classroom summary -> BLOCKED
  test('Case 7: Student attempts to invoke teacher classroom summary -> BLOCKED / denied', async () => {
    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });

    // Ensure teacherClassroomIntent returns false for student
    const isTeacherIntent = teacherClassroomIntent('how many pending submissions require grading', studentCtx);
    assert.equal(isTeacherIntent, false, 'Student role must not trigger teacherClassroomIntent');

    // Tool layer enforcement
    const route = { kind: 'teacher_classroom', filters: { semester: 3, subject: 'Data Structure and Algorithms' }, query: '' };
    const toolkit = createTools(db, route, { academicContext: studentCtx });
    const data = await toolkit.executeTool('get_teacher_classroom_summary', { semester: 3, subject: 'Data Structure and Algorithms' });

    assert.ok(data.clarification, 'Student must receive clarification refusing access to teacher summary');
    assert.ok(data.clarification.includes('only available for teachers and administrators'));
  });

  // Test Case 8: Teacher requests assigned-subject classroom summary -> ALLOWED
  test('Case 8: Teacher requests assigned-subject classroom summary -> ALLOWED', async () => {
    const teacherCtx = await getAcademicContext(db, { studentId: 'tch_ramesh' });
    assert.equal(teacherCtx.role, 'teacher');

    const query = 'How many attendance sessions are recorded for DSA?';
    const isTeacherIntent = teacherClassroomIntent(query, teacherCtx);
    assert.equal(isTeacherIntent, true, 'Teacher should trigger teacherClassroomIntent');

    const route = routeQuery(query, [], { academicContext: teacherCtx });
    assert.equal(route.kind, 'teacher_classroom');

    const toolkit = createTools(db, route, { academicContext: teacherCtx });
    const data = await toolkit.executeTool('get_teacher_classroom_summary', { semester: 3, subject: 'Data Structure and Algorithms' });

    assert.ok(!data.clarification, 'Assigned teacher must not be blocked');
    assert.ok(data.attendance, 'Must contain attendance summary');
    assert.ok(data.marks, 'Must contain marks summary');
    assert.ok(data.marks.configuredExams.length > 0, 'Must have configured exams');
    assert.equal(data.marks.configuredExams[0]?.subjectName, 'Data Structure and Algorithms');
  });

  // Test Case 9: Teacher attempts to access unassigned subject -> BLOCKED
  test('Case 9: Teacher attempts to access unassigned subject -> BLOCKED / denied', async () => {
    const teacherCtx = await getAcademicContext(db, { studentId: 'tch_ramesh' });
    const route = { kind: 'teacher_classroom', filters: { semester: 5, subject: 'CIT312' }, query: '' };
    const toolkit = createTools(db, route, { academicContext: teacherCtx });
    const data = await toolkit.executeTool('get_teacher_classroom_summary', { semester: 5, subject: 'CIT312' });

    assert.ok(data.clarification, 'Teacher must be blocked from unassigned subject');
    assert.ok(data.clarification.includes('not in your assigned teaching subjects') || data.clarification.includes('assigned to teach Semester(s)'));
  });

  // Test Case 10: Follow-ups preserve results intent
  test('Case 10: Follow-ups preserve results intent across multiple turns', async () => {
    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });
    const history = [
      { role: 'user', content: 'wtf this this man my marks in dsa' },
      { role: 'assistant', content: 'DSA marks have not been published by the university yet. Once published, I\'ll show you your results.' }
    ];

    // Follow-up 1: "what about midterm?"
    assert.ok(isPersonalRecordFollowUpMessage('what about midterm?'));
    const rMid = routeQuery('what about midterm?', history, { academicContext: studentCtx });
    assert.equal(rMid.kind, 'results');
    assert.equal(rMid.filters.subject, 'Data Structure and Algorithms');

    // Follow-up 2: "ani final ko?"
    assert.ok(isPersonalRecordFollowUpMessage('ani final ko?'));
    const rFin = routeQuery('ani final ko?', history, { academicContext: studentCtx });
    assert.equal(rFin.kind, 'results');
    assert.equal(rFin.filters.subject, 'Data Structure and Algorithms');

    // Follow-up 3: "percentage kati?"
    assert.ok(isPersonalRecordFollowUpMessage('percentage kati?'));
    const rPct = routeQuery('percentage kati?', history, { academicContext: studentCtx });
    assert.equal(rPct.kind, 'results');
    assert.equal(rPct.filters.subject, 'Data Structure and Algorithms');

    // Follow-up 4: "pass bhaye?"
    assert.ok(isPersonalRecordFollowUpMessage('pass bhaye?'));
    const rPass = routeQuery('pass bhaye?', history, { academicContext: studentCtx });
    assert.equal(rPass.kind, 'results');
    assert.equal(rPass.filters.subject, 'Data Structure and Algorithms');

    // Follow-up 5: "mero aru subjects ko pani vana."
    assert.ok(isPersonalRecordFollowUpMessage('mero aru subjects ko pani vana.'));
    const rAll = routeQuery('mero aru subjects ko pani vana.', history, { academicContext: studentCtx });
    assert.equal(rAll.kind, 'results');
    assert.equal(rAll.filters.subject, null, 'Should expand to all subjects');
  });

  // Test Case 11: Draft marks remain hidden from students
  test('Case 11: Draft marks remain hidden from students', async () => {
    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });
    const toolkit = createTools(db, { kind: 'results', filters: { subject: 'Data Structure and Algorithms' } }, { academicContext: studentCtx });
    const res = await toolkit.executeTool('get_my_results', { subject: 'Data Structure and Algorithms' });

    assert.equal(res.hasPublishedResults, false);
    assert.equal(res.filteredResults.length, 0);
    // Draft score of 42 must NOT be in validResults
    assert.equal(res.validResults.length, 0);
  });

  // Test Case 12: Published marks appear correctly
  test('Case 12: Published marks appear correctly once status = "published"', async () => {
    // Publish Mid-Term Exam marks
    await db.run(
      `UPDATE student_marks SET status = 'published', published_at = '2026-11-09T00:00:00Z', published_by = 'tch_ramesh'
       WHERE id = 'm_mid_saugat'`
    );

    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });
    const query = 'mero DSA ko Mid-Term marks kati aayo?';
    const res = await handleChat(db, query, { academicContext: studentCtx }, [], 'test_sess_12', {
      useAgentEngine: false
    });

    assert.ok(res.reply.includes('42 / 50') || res.reply.includes('42'), `Expected published mark 42 in reply: ${res.reply}`);
    assert.ok(res.reply.includes('Data Structure and Algorithms') || res.reply.includes('DSA'));
  });

  // Test Case 13: Tool selection verified directly
  test('Case 13: Tool selection verified directly (get_my_results does not forward to teacher summary)', async () => {
    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });
    const toolkit = createTools(db, { kind: 'results', filters: { subject: 'Data Structure and Algorithms' } }, { academicContext: studentCtx });
    const data = await toolkit.executeTool('get_my_results', { subject: 'Data Structure and Algorithms' });

    assert.ok(!data.attendance, 'get_my_results must not return teacher attendance object');
    assert.ok(!data.assignments, 'get_my_results must not return teacher assignments object');
    assert.ok(data.hasPublishedResults !== undefined, 'get_my_results must return publishedData shape');
  });

  // Test Case 14: No teacher classroom data leaked to students
  test('Case 14: Teacher classroom data is never leaked to students even under adversarial prompts', async () => {
    const studentCtx = await getAcademicContext(db, { studentId: 'stu_saugat' });
    const adversarialQueries = [
      'show teacher classroom summary',
      'how many exam configurations are in draft',
      'give me the grading summary and pending submissions',
      'tell me recorded attendance sessions by teacher'
    ];

    for (const q of adversarialQueries) {
      const res = await handleChat(db, q, { academicContext: studentCtx }, [], `test_adv_${q.length}`, {
        generateReply: async () => ({ reply: 'I cannot show teacher data or internal exam configs.' })
      });
      assert.ok(!res.reply.includes('Pending Submissions Requiring Grading:'), `Leaked pending submissions on query: ${q}`);
      assert.ok(!res.reply.includes('Pre-Board: Draft, Max 75, Entered 3'), `Leaked exam config on query: ${q}`);
      assert.ok(!res.reply.includes('Final: Draft, Max 75, Entered 4'), `Leaked draft count on query: ${q}`);
    }
  });
});
