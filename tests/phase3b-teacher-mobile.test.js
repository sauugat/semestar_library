'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(os.tmpdir(), `phase3b_mobile_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const app = require('../server');
const db = require('../db');
const { ensureTeacherSchema } = require('../lib/teacher-service');

let server;
let baseUrl;

const teacherPassword = 'TeacherMobile_Pass123!';
const studentPassword = 'StudentMobile_Pass123!';
let teacherToken = '';
let studentToken = '';

test.before(async () => {
  await db.initSchema();
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const hashTeacher = bcrypt.hashSync(teacherPassword, 10);
  const hashStudent = bcrypt.hashSync(studentPassword, 10);

  // 1. Seed canonical subject
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    'sub_bct101', 'BCT101', 'Computer Fundamentals', 1, 'Computer Engineering', 3
  );

  // 2. Seed Teacher account
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?)`,
    't_mobile_prof', 'Professor Mobile', 'mobile_prof@gandaki.edu.np', 'teacher', hashTeacher, 'Semester 1'
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, ?, ?)`,
    'T_UUID_MOB', 't_mobile_prof', 'Associate Professor', 'active'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_mob_1', 'T_UUID_MOB', 'sub_bct101'
  );

  // 3. Seed Student account (Semester 2)
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'stu_mobile_test', 'Mobile Student', 'mobile_stu@gandaki.edu.np', 'student', hashStudent, 'Semester 2'
  );

  // 4. Authenticate Teacher via mobile login
  const teacherLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 't_mobile_prof', password: teacherPassword }),
  });
  assert.equal(teacherLoginRes.status, 200, 'Teacher mobile login must succeed');
  const teacherLoginData = await teacherLoginRes.json();
  teacherToken = teacherLoginData.token;
  assert.equal(teacherLoginData.user.role, 'teacher');

  // 5. Authenticate Student via mobile login
  const studentLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'stu_mobile_test', password: studentPassword }),
  });
  assert.equal(studentLoginRes.status, 200, 'Student mobile login must succeed');
  const studentLoginData = await studentLoginRes.json();
  studentToken = studentLoginData.token;
  assert.equal(studentLoginData.user.role, 'student');
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch {}
});

test('PHASE 3B: Mobile Teacher Experience & Role Isolation Suite', async (t) => {
  // --- SUBTEST 1: TEACHER API AUTHORIZATION & DATA SCOPING ---
  await t.test('1. Teacher can access /api/teacher/dashboard-init with mobile token', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/dashboard-init`, {
      headers: { Authorization: `Bearer ${teacherToken}`, Accept: 'application/json' },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.user.role, 'teacher');
    assert.ok(Array.isArray(json.assignedSubjects));
    assert.equal(json.assignedSubjects[0].code, 'BCT101');
  });

  await t.test('2. Student cannot access /api/teacher/dashboard-init (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/dashboard-init`, {
      headers: { Authorization: `Bearer ${studentToken}`, Accept: 'application/json' },
    });
    assert.equal(res.status, 403, 'Student access to teacher dashboard must be blocked');
  });

  await t.test('3. Teacher can access /api/teacher/subjects and /api/teacher/notes', async () => {
    const subRes = await fetch(`${baseUrl}/api/teacher/subjects`, {
      headers: { Authorization: `Bearer ${teacherToken}`, Accept: 'application/json' },
    });
    assert.equal(subRes.status, 200);
    const subJson = await subRes.json();
    assert.ok(Array.isArray(subJson.subjects));
    assert.equal(subJson.subjects[0].code, 'BCT101');

    const notesRes = await fetch(`${baseUrl}/api/teacher/notes`, {
      headers: { Authorization: `Bearer ${teacherToken}`, Accept: 'application/json' },
    });
    assert.equal(notesRes.status, 200);
    const notesJson = await notesRes.json();
    assert.ok(Array.isArray(notesJson.notes));
  });

  await t.test('4. Student cannot access /api/teacher/subjects or /api/teacher/notes', async () => {
    const subRes = await fetch(`${baseUrl}/api/teacher/subjects`, {
      headers: { Authorization: `Bearer ${studentToken}`, Accept: 'application/json' },
    });
    assert.equal(subRes.status, 403);

    const notesRes = await fetch(`${baseUrl}/api/teacher/notes`, {
      headers: { Authorization: `Bearer ${studentToken}`, Accept: 'application/json' },
    });
    assert.equal(notesRes.status, 403);
  });

  // --- SUBTEST 2: MOBILE UI & NAVIGATION ARCHITECTURE AUDIT ---
  await t.test('5. FloatingTabBar defines separate STUDENT_TAB_CONFIGS and TEACHER_TAB_CONFIGS', () => {
    const tabBarPath = path.resolve(__dirname, '../mobile/components/navigation/FloatingTabBar.tsx');
    const content = fs.readFileSync(tabBarPath, 'utf8');

    // Verify Teacher tabs
    assert.ok(content.includes('export const TEACHER_TAB_CONFIGS'), 'Must export TEACHER_TAB_CONFIGS');
    assert.ok(content.includes("label: 'Dashboard'"), 'Teacher tab 1 must be Dashboard');
    assert.ok(content.includes("label: 'My Materials'"), 'Teacher tab 2 must be My Materials');
    assert.ok(content.includes("label: 'Chat'"), 'Teacher tab 3 must be Chat');
    assert.ok(content.includes("label: 'Notices'"), 'Teacher tab 4 must be Notices');
    assert.ok(content.includes("label: 'Profile'"), 'Teacher tab 5 must be Profile');

    // Verify Student tabs
    assert.ok(content.includes('export const STUDENT_TAB_CONFIGS'), 'Must export STUDENT_TAB_CONFIGS');
    assert.ok(content.includes("label: 'Home'"), 'Student tab 1 must be Home');
    assert.ok(content.includes("label: 'Library'"), 'Student tab 2 must be Library');
    assert.ok(content.includes("label: 'Games'"), 'Student tab 4 must be Games');
  });

  await t.test('6. TabLayout dynamically renders tab labels based on user role', () => {
    const layoutPath = path.resolve(__dirname, '../mobile/app/(tabs)/_layout.tsx');
    const content = fs.readFileSync(layoutPath, 'utf8');

    assert.ok(
      content.includes("isTeacher ? 'Dashboard' : 'Home'"),
      'Tab 1 title must dynamically switch between Dashboard and Home'
    );
    assert.ok(
      content.includes("isTeacher ? 'My Materials' : 'Library'"),
      'Tab 2 title must dynamically switch between My Materials and Library'
    );
    assert.ok(
      content.includes("isTeacher ? 'Notices' : 'Games'"),
      'Tab 4 title must dynamically switch between Notices and Games'
    );
  });

  await t.test('7. Library screen isolates StudentLibraryView from TeacherMaterialsView', () => {
    const libPath = path.resolve(__dirname, '../mobile/app/(tabs)/library.tsx');
    const content = fs.readFileSync(libPath, 'utf8');

    assert.ok(
      content.includes('export default function LibraryScreen()'),
      'LibraryScreen root entry exists'
    );
    assert.ok(
      content.includes('if (isTeacher) {') && content.includes('<TeacherMaterialsView />'),
      'Teachers must be directed to TeacherMaterialsView'
    );
    assert.ok(
      content.includes('return <StudentLibraryView />;'),
      'Students must be directed to StudentLibraryView'
    );
  });

  await t.test('8. Games screen routes teachers to TeacherNoticesView and students to GamesView', () => {
    const gamesPath = path.resolve(__dirname, '../mobile/app/(tabs)/games.tsx');
    const content = fs.readFileSync(gamesPath, 'utf8');

    assert.ok(
      content.includes('isTeacher ? <TeacherNoticesView /> : <GamesView />'),
      'Teachers must render TeacherNoticesView and students GamesView'
    );
  });

  await t.test('9. TeacherMaterialsView reuses backend APIs and prevents unauthorized publishing', () => {
    const materialsViewPath = path.resolve(__dirname, '../mobile/components/teacher/TeacherMaterialsView.tsx');
    const content = fs.readFileSync(materialsViewPath, 'utf8');

    assert.ok(content.includes('/api/teacher/dashboard-init'), 'Must query /api/teacher/dashboard-init');
    assert.ok(content.includes('/api/teacher/subjects'), 'Must query /api/teacher/subjects');
    assert.ok(content.includes('/api/teacher/notes'), 'Must query /api/teacher/notes');
    assert.ok(content.includes('/api/teacher/assignments'), 'Must query /api/teacher/assignments');
  });

  await t.test('10. UploadNoteModal restricts teachers to assigned subjects and locks custom subject creation', () => {
    const modalPath = path.resolve(__dirname, '../mobile/components/UploadNoteModal.tsx');
    const content = fs.readFileSync(modalPath, 'utf8');

    assert.ok(
      content.includes('availableSubjects') && content.includes('if (isTeacher) {'),
      'Available subjects must be filtered to assigned subjects for teachers'
    );
    assert.ok(
      content.includes('customActionLabel={isTeacher ? undefined : "+ Custom Subject"}'),
      'Custom subject creation must be hidden for teachers'
    );
    assert.ok(
      content.includes('disabled={isTeacher}'),
      'Semester selection must be disabled for teachers'
    );
    assert.ok(
      content.includes('You are only authorized to upload materials to your assigned subjects.'),
      'Upload action must validate against assigned subjects for teachers'
    );
  });

  await t.test('11. Chat screen prevents teachers from infiltrating student class cohort groups', () => {
    const chatPath = path.resolve(__dirname, '../mobile/app/(tabs)/chat.tsx');
    const content = fs.readFileSync(chatPath, 'utf8');

    assert.ok(
      content.includes('else if (isTeacher) {') && content.includes('setStudentConfig(null);'),
      'Teachers must not be assigned student cohort chat configs'
    );
  });

  await t.test('12. AuthContext isolates cache between accounts on login and logout', () => {
    const authPath = path.resolve(__dirname, '../mobile/context/AuthContext.tsx');
    const content = fs.readFileSync(authPath, 'utf8');

    assert.ok(
      content.includes('await clearAppQueryCache();'),
      'Query cache must be cleared to prevent cross-account leakage'
    );
    assert.ok(
      content.includes('await clearChatDb();'),
      'Local chat DB must be cleared on logout'
    );
    assert.ok(
      content.includes('await clearAllDmCache();'),
      'Local DM cache must be cleared on logout'
    );
  });

  await t.test('13. TeacherMaterialsView deduplicates subject requests using dashboard-init data', () => {
    const materialsPath = path.resolve(__dirname, '../mobile/components/teacher/TeacherMaterialsView.tsx');
    const content = fs.readFileSync(materialsPath, 'utf8');

    assert.ok(
      content.includes('hasInitSubjects') && content.includes('enabled: Boolean(!hasInitSubjects && !isInitLoading)'),
      'teacher-subjects query must be disabled when dashboard-init provides subjects'
    );
  });

  await t.test('14. AuthContext clears chat DB and DM cache on direct login and setSession', () => {
    const authPath = path.resolve(__dirname, '../mobile/context/AuthContext.tsx');
    const content = fs.readFileSync(authPath, 'utf8');

    // Verify login() block includes chat and dm cache clearing
    const loginMatches = content.match(/if \(res\.status === 200 && data\.token\) \{[\s\S]*?setUser\(data\.user\);/);
    assert.ok(loginMatches, 'login() success block must exist');
    assert.ok(loginMatches[0].includes('await clearChatDb();'), 'login() must clear chat DB');
    assert.ok(loginMatches[0].includes('await clearAllDmCache();'), 'login() must clear DM cache');

    // Verify setSession() block includes chat and dm cache clearing
    const setSessionMatches = content.match(/const setSession = async[\s\S]*?void registerPushToken\(\);/);
    assert.ok(setSessionMatches, 'setSession() block must exist');
    assert.ok(setSessionMatches[0].includes('await clearChatDb();'), 'setSession() must clear chat DB');
    assert.ok(setSessionMatches[0].includes('await clearAllDmCache();'), 'setSession() must clear DM cache');
  });

  await t.test('15. clearChatDb preserves pending outgoing messages while clearing confirmed messages', () => {
    const chatDbPath = path.resolve(__dirname, '../mobile/services/chat-db.ts');
    const content = fs.readFileSync(chatDbPath, 'utf8');

    assert.ok(
      content.includes('DELETE FROM chat_cache_v3 WHERE id > 0;'),
      'clearChatDb must delete only confirmed messages (id > 0) when preservePending is true'
    );
  });

  await t.test('16. clearAllDmCache preserves durable outbox by default', () => {
    const dmDbPath = path.resolve(__dirname, '../mobile/services/dm-db.ts');
    const content = fs.readFileSync(dmDbPath, 'utf8');

    assert.ok(
      content.includes('const preserveOutbox = options?.preserveOutbox ?? true;') &&
      content.includes('if (!preserveOutbox) {'),
      'clearAllDmCache must preserve durable outbox by default'
    );
  });
});
