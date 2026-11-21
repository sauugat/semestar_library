'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { createTransactionAdapter } = require('../lib/db-transaction');
const {
  ensureRoutineSchema,
  seedClassRoutines,
  queryClassSchedule
} = require('../lib/routine');
const {
  routeQuery,
  formatToolResult,
  createTools
} = require('../lib/chat-tools');
const {
  understandRequest
} = require('../lib/kyana-agent-engine');

const postMarkdownSource = fs.readFileSync(
  path.join(__dirname, '../mobile/components/PostMarkdown.tsx'),
  'utf8'
);

async function createTestDb() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kyana-test-db-'));
  const client = createClient({ url: `file:${path.join(temp, 'test.db')}` });
  const db = createTransactionAdapter(client, false);
  db.withTransaction = async (callback) => {
    const txClient = await client.transaction('write');
    try {
      const result = await callback(createTransactionAdapter(txClient, false));
      await txClient.commit();
      return result;
    } catch (err) {
      await txClient.rollback();
      throw err;
    } finally {
      txClient.close();
    }
  };
  await ensureRoutineSchema(db);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      status TEXT NOT NULL DEFAULT 'active',
      cohort_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS student_cohorts (
      id TEXT PRIMARY KEY,
      cohort_name TEXT NOT NULL,
      current_semester INTEGER NOT NULL,
      academic_session TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO student_cohorts (id, cohort_name, current_semester, academic_session, status)
    VALUES ('cohort-sem3', 'BIT 2024 (Batch 2024-2028)', 3, '2024-2028', 'active');
    INSERT INTO students (studentId, name, role, status, cohort_id)
    VALUES ('student-3', 'Aashish Gurung', 'student', 'active', 'cohort-sem3');
  `);
  await seedClassRoutines(db);
  return db;
}

test('1. Intent detection: University schedule queries route to class routine, NOT academic explanation', () => {
  const cases = [
    { query: 'DSA kaile xa class?', expectedType: 'class', expectedSubj: 'Data Structure and Algorithms' },
    { query: 'Hamro class kaile bata ho?', expectedType: 'class', expectedSubj: null },
    { query: 'Bholi kun subject xa?', expectedType: 'class', expectedDay: 'tomorrow' },
    { query: 'Aaja kati baje class xa?', expectedType: 'class', expectedDay: 'today' },
    { query: 'CIT214 ko class time ke ho?', expectedType: 'class', expectedSubj: 'Data Structure and Algorithms' },
    { query: 'Exam routine kaile xa?', expectedType: 'exam', expectedSubj: null },
  ];

  for (const c of cases) {
    const r = routeQuery(c.query, [], {});
    assert.equal(r.kind, 'routine', `routeQuery for "${c.query}" must route to "routine"`);
    assert.equal(r.filters?.routineType, c.expectedType, `routeQuery for "${c.query}" must have routineType "${c.expectedType}"`);
    if (c.expectedSubj) {
      assert.equal(r.filters?.subject, c.expectedSubj, `routeQuery for "${c.query}" should match subject`);
    }

    const u = understandRequest(c.query, [], { currentSemester: 3 });
    assert.ok(u.intents.includes('routine_lookup'), `understandRequest for "${c.query}" must include routine_lookup`);
    assert.equal(u.intents.includes('academic_tutoring'), false, `understandRequest for "${c.query}" must NEVER push academic_tutoring`);
    assert.equal(u.entities?.routineType, c.expectedType, `understandRequest for "${c.query}" should set entities.routineType to "${c.expectedType}"`);
  }
});

test('2. Intent detection: Academic teaching vs personal attendance vs notes retrieval', () => {
  // Academic teaching queries
  const teachQueries = ['DSA ma k padhnu parxa?', 'DBMS explain gara', 'Explain DSA.'];
  for (const tq of teachQueries) {
    const u = understandRequest(tq, [], { currentSemester: 3 });
    assert.ok(u.intents.includes('academic_tutoring'), `"${tq}" must route to academic_tutoring`);
    assert.equal(u.intents.includes('routine_lookup'), false, `"${tq}" must not route to routine_lookup`);
  }

  // Personal attendance
  const att = routeQuery('Mero attendance kati xa?', [], {});
  assert.equal(att.kind, 'attendance');
  const uAtt = understandRequest('Mero attendance kati xa?', [], { currentSemester: 3 });
  assert.ok(uAtt.intents.includes('attendance_lookup'));

  // Notes retrieval
  const notes = routeQuery('DBMS ko notes deu', [], {});
  assert.equal(notes.kind, 'notes');
  const uNotes = understandRequest('DBMS ko notes deu', [], { currentSemester: 3 });
  assert.ok(uNotes.intents.includes('notes_lookup'));
});

test('3. Data retrieval: Query real class routine for Semester 3 DSA and weekdays', async () => {
  const db = await createTestDb();
  const academicContext = { authenticated: true, studentId: 'student-3', currentSemester: 3, role: 'student' };

  // Subject-specific retrieval: DSA in Semester 3
  const dsaRes = await queryClassSchedule(db, {
    semester: 3,
    subject: 'DSA',
    academicContext
  });
  assert.equal(dsaRes.published, true);
  assert.equal(dsaRes.semester, 3);
  assert.ok(dsaRes.entries.length >= 3, 'DSA should have at least 3 weekly sessions in Semester 3');
  const days = dsaRes.entries.map(e => e.day_of_week);
  assert.ok(days.includes('Monday'), 'DSA has Monday lecture');
  assert.ok(days.includes('Wednesday'), 'DSA has Wednesday lecture/lab');
  assert.ok(days.includes('Thursday'), 'DSA has Thursday lecture');

  // Relative / Day-specific retrieval
  const monRes = await queryClassSchedule(db, {
    semester: 3,
    day: 'Monday',
    academicContext
  });
  assert.equal(monRes.published, true);
  assert.ok(monRes.entries.every(e => e.day_of_week === 'Monday'), 'All returned entries must be for Monday');
  assert.ok(monRes.entries.length > 0, 'Monday has classes');

  // Format result through formatToolResult
  const formatted = formatToolResult('get_routine', dsaRes);
  assert.match(formatted, /Class schedule for \*\*Data Structure and Algorithms?\*\*/);
  assert.match(formatted, /\| Day \| Time \| Room \| Type \| Teacher \|/);
  assert.match(formatted, /Monday/);
  assert.match(formatted, /Wednesday/);
  assert.match(formatted, /Thursday/);
});

test('4. Data retrieval: Unavailability, semester ambiguity, and authorization handling', async () => {
  const db = await createTestDb();

  // Missing routine: Semester 8 has no class routine published
  const s8Res = await queryClassSchedule(db, {
    semester: 8,
    academicContext: { authenticated: true, role: 'admin' }
  });
  assert.equal(s8Res.published, false);
  assert.match(s8Res.message, /No class routine has been published for Semester VIII yet/);

  // Ambiguous semester (guest with no semester)
  const noSem = await queryClassSchedule(db, {
    semester: null,
    academicContext: { authenticated: false }
  });
  assert.equal(noSem.needsClarification, true);
  assert.match(noSem.error, /Which semester class routine would you like to see/);

  // Unauthorized access attempt: Student enrolled in Semester 3 querying Semester 5
  const unauthRes = await queryClassSchedule(db, {
    semester: 5,
    academicContext: { authenticated: true, role: 'student', currentSemester: 3 }
  });
  assert.equal(unauthRes.authorized, false);
  assert.match(unauthRes.error, /You('re| are) (registered|enrolled) in Semester 3/);
});

test('5. Academic fallback rules: Schedule and attendance queries NEVER show academic notes disclaimer', () => {
  const DISCLAIMER_PATTERN = /No specific course notes were found in Semester Library covering this topic/i;

  const routineReply = formatToolResult('get_routine', {
    published: true,
    routineType: 'class',
    semester: 3,
    targetSubject: 'Data Structure and Algorithms',
    entries: [
      { day_of_week: 'Monday', time_slot: '11:00–11:50', room_number: 'Room 201', class_type: 'Theory', faculty_name: 'Er. Rajesh Kumar' }
    ]
  });
  assert.doesNotMatch(routineReply, DISCLAIMER_PATTERN, 'Routine reply must never show academic notes disclaimer');

  const attendanceReply = formatToolResult('get_my_attendance', {
    semesterNo: 3,
    overall: { attendancePercentage: 75, presentCount: 3, absentCount: 1, totalSessions: 4 },
    subjects: [
      { name: 'Data Structure and Algorithms', code: 'CIT214', attendancePercentage: 75, presentCount: 3, absentCount: 1, totalSessions: 4 }
    ]
  });
  assert.doesNotMatch(attendanceReply, DISCLAIMER_PATTERN, 'Attendance reply must never show academic notes disclaimer');
});

test('6. Mobile response rendering: Markdown unescaping and native attendance card component', () => {
  // Mobile unescaping verification
  assert.ok(
    postMarkdownSource.includes(".replace(/\\\\([#*_`~\\[\\]()!+-])/g, '$1')"),
    'PostMarkdown.tsx must unescape escaped markdown characters outside code blocks'
  );

  // Attendance card contract verification
  assert.match(postMarkdownSource, /export function parseAttendanceBlock/);
  assert.match(postMarkdownSource, /function renderAttendanceCard/);
  assert.match(postMarkdownSource, /VISUAL_BLOCK_KINDS\.includes\(block\.lang\)/);
  assert.match(postMarkdownSource, /Low Attendance/);
  assert.match(postMarkdownSource, /Other subjects/);
});
