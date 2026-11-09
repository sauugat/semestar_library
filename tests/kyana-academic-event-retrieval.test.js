'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db');
const { handleChat } = require('../ai-assistant');
const { routeQuery, noticeIntent, assignmentSearchIntent, routineIntent } = require('../lib/chat-tools');
const { understandRequest, shouldUseKyanaAgentEngine } = require('../lib/kyana-agent-engine');
const { searchNotices, searchAssignments } = require('../lib/ai-search-tools');

const STUDENT_USER = {
  studentId: 'c808f9d6-1a5e-4ba9-bbf8-bb97a7a40cb2',
  semester: 3,
  department: 'BIT',
  role: 'student',
  authenticated: true
};

const REFERENCE_DATE = new Date('2026-11-09T12:00:00.000Z');

test('1. "Hamro project defense kaile ho?" routes to notices, retrieves Newton Post 187, and reports date & author', async () => {
  const query = 'Hamro project defense kaile ho?';

  // 1a. Intent & Route checks
  const isNotice = noticeIntent(query);
  assert.equal(isNotice, true, 'noticeIntent must recognize project defense inquiry');

  const route = routeQuery(query);
  assert.equal(route.kind, 'notices', 'routeQuery must route to notices');
  assert.ok(route.query.includes('defense') || route.query.includes('project'), 'query must preserve defense keyword');

  // 1b. Agent Engine Intent checks
  const u = understandRequest(query, [], STUDENT_USER);
  assert.ok(u.intents.includes('notice_lookup'), 'understandRequest must classify under notice_lookup');
  assert.ok(!u.intents.includes('assignment_lookup'), 'must not confuse project defense with assignment');

  // 1c. Actual Database Retrieval
  const notices = await searchNotices(db, STUDENT_USER, { query: route.query });
  assert.ok(Array.isArray(notices) && notices.length > 0, 'searchNotices must find candidate notices');
  const post187 = notices.find(n => Number(n.id) === 187);
  assert.ok(post187, 'Must find Post ID 187');
  assert.equal(post187.authorName, 'newton');
  assert.match(post187.title, /project defense/i);
  assert.match(post187.content, /2083\/08\/07/);

  // 1d. Full Chat Pipeline Execution
  const chatRes = await handleChat(db, query, STUDENT_USER, [], { referenceDate: REFERENCE_DATE });
  assert.ok(chatRes.reply, 'handleChat must return a reply');
  assert.match(chatRes.reply, /2026-11-22|2083\/08\/07|7 Mangsir 2083/i, 'Reply must state the defense date');
  assert.match(chatRes.reply, /newton/i, 'Reply must attribute to teacher newton');
  assert.ok(chatRes.resourceCards.some(c => Number(c.id) === 187), 'Must attach Post 187 resource card');
});

test('2. "When is our project defense?" retrieves Post 187 and communicates upcoming schedule', async () => {
  const query = 'When is our project defense?';

  const route = routeQuery(query);
  assert.equal(route.kind, 'notices');

  const notices = await searchNotices(db, STUDENT_USER, { query: 'project defense' });
  assert.ok(notices.some(n => Number(n.id) === 187));

  const chatRes = await handleChat(db, query, STUDENT_USER, [], { referenceDate: REFERENCE_DATE });
  assert.match(chatRes.reply, /2026-11-22|2083\/08\/07|7 Mangsir 2083/i);
  assert.match(chatRes.reply, /newton/i);
});

test('3. "Project defence kahile ho?" handles British English spelling (defence) and resolves Post 187', async () => {
  const query = 'Project defence kahile ho?';

  const isNotice = noticeIntent(query);
  assert.equal(isNotice, true, 'noticeIntent must recognize British spelling defence');

  const route = routeQuery(query);
  assert.equal(route.kind, 'notices');

  // Must find Post 187 via defence synonym expansion to defense
  const notices = await searchNotices(db, STUDENT_USER, { query: 'defence' });
  assert.ok(notices.some(n => Number(n.id) === 187), 'searchNotices with "defence" must retrieve Post 187');

  const chatRes = await handleChat(db, query, STUDENT_USER, [], { referenceDate: REFERENCE_DATE });
  assert.match(chatRes.reply, /2026-11-22|2083\/08\/07|7 Mangsir 2083/i);
});

test('4. "Project viva date?" routes to notices and matches Project Defense notice', async () => {
  const query = 'Project viva date?';

  const isNotice = noticeIntent(query);
  assert.equal(isNotice, true, 'noticeIntent must recognize viva inquiry');

  const route = routeQuery(query);
  assert.equal(route.kind, 'notices');

  const notices = await searchNotices(db, STUDENT_USER, { query: 'project viva' });
  assert.ok(notices.some(n => Number(n.id) === 187), 'searchNotices with "project viva" must find Post 187');
});

test('5. "Defense schedule?" routes to notices and does not collide with exam routine', async () => {
  const query = 'Defense schedule?';

  const isRoutine = routineIntent(query);
  assert.equal(isRoutine, false, 'routineIntent must NOT hijack defense schedule');

  const isNotice = noticeIntent(query);
  assert.equal(isNotice, true, 'noticeIntent must match defense schedule');

  const route = routeQuery(query);
  assert.equal(route.kind, 'notices', 'Must route to notices, not routine');

  const notices = await searchNotices(db, STUDENT_USER, { query: 'defense' });
  assert.ok(notices.some(n => Number(n.id) === 187));
});

test('6. "Proposal presentation kaile cha?" routes to notices and matches academic presentation inquiry', async () => {
  const query = 'Proposal presentation kaile cha?';

  const isNotice = noticeIntent(query);
  assert.equal(isNotice, true);

  const route = routeQuery(query);
  assert.equal(route.kind, 'notices');

  const u = understandRequest(query, [], STUDENT_USER);
  assert.ok(u.intents.includes('notice_lookup'));
});

test('7. "DSA Project 1 assignment" correctly disambiguates to assignments, not notices', async () => {
  const query = 'DSA Project 1 assignment';

  const isNotice = noticeIntent(query);
  assert.equal(isNotice, false, 'noticeIntent must not match DSA Project 1 assignment');

  const isAssignment = assignmentSearchIntent(query);
  assert.equal(isAssignment, true, 'assignmentSearchIntent must recognize coursework assignment');

  const route = routeQuery(query);
  assert.equal(route.kind, 'assignments', 'Must route to assignments');

  const u = understandRequest(query, [], STUDENT_USER);
  assert.ok(u.intents.includes('assignment_lookup') || u.intents.includes('assignment_deadline'), 'Agent engine must classify as assignment');
  assert.ok(!u.intents.includes('notice_lookup'), 'Agent engine must not classify as notice');
});

test('8. "Submit project tomorrow" correctly routes to assignment deadline and submission checking', async () => {
  const query = 'Submit project tomorrow';

  const isNotice = noticeIntent(query);
  assert.equal(isNotice, false, 'noticeIntent must not match assignment submission');

  const route = routeQuery(query);
  assert.equal(route.kind, 'assignments', 'Must route to assignments');

  const u = understandRequest(query, [], STUDENT_USER);
  assert.ok(
    u.intents.includes('assignment_deadline') || u.intents.includes('assignment_lookup'),
    'understandRequest must flag assignment intent'
  );
  assert.ok(!u.intents.includes('notice_lookup'), 'Must not treat submit project as notice');
});

test('9. Unrelated out-of-scope query is rejected without campus database retrieval', async () => {
  const query = 'How to bake a chocolate cake?';

  const isNotice = noticeIntent(query);
  assert.equal(isNotice, false);

  const route = routeQuery(query);
  assert.equal(route.kind, 'scope_check', 'Must classify as scope_check');

  const chatRes = await handleChat(db, query, STUDENT_USER, [], { referenceDate: REFERENCE_DATE });
  assert.match(
    chatRes.reply,
    /Semester Library|verified records|only help with Gandaki University/i,
    'Must refuse out-of-scope request safely'
  );
  assert.equal(chatRes.resourceCards?.length || 0, 0, 'No resource cards should be attached to out-of-scope refusal');
});

test('10. Student cannot access unauthorized records (privacy & semester isolation)', async () => {
  // Test A: Audience scope isolation
  // Search with semester 8 student context for a notice that might be private/restricted
  const unauthorizedStudent = {
    studentId: 'anon-visitor',
    semester: 8,
    department: 'BBA',
    role: 'guest',
    authenticated: false
  };

  // An unauthenticated guest without valid student context cannot search teacher classroom intelligence
  const { teacherClassroomIntent } = require('../lib/chat-tools');
  const isTeacherIntent = teacherClassroomIntent('teacher classroom summary', STUDENT_USER);
  assert.equal(isTeacherIntent, false, 'Student role must never have access to teacher classroom summary');

  // Direct check that searchNotices honors audience permissions
  const unauthNotices = await searchNotices(db, unauthorizedStudent, { query: 'restricted confidential' });
  assert.equal(unauthNotices.length, 0, 'No unauthorized notices leaked');

  // Verify that Post 187 is public/all_students, so it is authorized for enrolled student
  const verifiedPost = await searchNotices(db, STUDENT_USER, { query: 'Project Defense Notice' });
  assert.ok(verifiedPost.length > 0, 'Enrolled student is authorized for all_students post');
  assert.equal(Boolean(verifiedPost[0].targetAllSemesters), true, 'Post 187 is confirmed targeted to all semesters');
});

test.after(async () => {
  if (db && typeof db.close === 'function') {
    await db.close();
  }
});
