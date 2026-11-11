'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const testDbPath = path.join(
  os.tmpdir(),
  `kyana_auth_routing_hotfix_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const app = require('../server');
const db = require('../db');
const {
  createChatRateLimiter,
  getClientId,
  getHourKey,
  getTodayKey,
  hourlyStore,
  dailyStore,
  HOURLY_LIMIT,
  DAILY_LIMIT,
  DEFAULT_HOURLY_LIMIT,
  DEFAULT_DAILY_LIMIT
} = require('../lib/chat-ratelimit');
const { resourceFilter, canReadResource, revalidateCards } = require('../lib/kyana-access');
const { buildAcademicContentFilter } = require('../lib/academic-context');
const { ensureIndex, searchNotes, invalidateSearchCache } = require('../lib/note-search');
const { routeQuery, createTools, studyTeachIntent, subjectAliases } = require('../lib/chat-tools');
const { handleChat } = require('../ai-assistant');

let server;
let baseUrl;
let studentCookie = '';
const TEST_PASSWORD = 'Hotfix_Student99!';

function extractCookieHeader(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    const cookies = res.headers.getSetCookie();
    if (cookies.length > 0) {
      return cookies.map(c => c.split(';')[0]).join('; ');
    }
  }
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : '';
}

function makeResSpy() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    set(k, v) {
      this.headers[k.toLowerCase()] = v;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

test.before(async () => {
  await db.initSchema();
  await ensureIndex(db);

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  await db.run(
    `INSERT OR REPLACE INTO cohorts (id, slot_code, display_name, current_semester, status)
     VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
    'cohort_alpha', 'mercury', 'Batch Alpha (Sem 3)', 3, 'active',
    'cohort_beta', 'venus', 'Batch Beta (Sem 3)', 3, 'active'
  );

  const hash = bcrypt.hashSync(TEST_PASSWORD, 10);
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, cohort_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'stu_alpha_1', 'stu_alpha_1', 'Alpha Student', 'alpha@gandaki.edu.np', 'student', hash, '3', 'BIT', 'cohort_alpha',
    'stu_beta_1', 'stu_beta_1', 'Beta Student', 'beta@gandaki.edu.np', 'student', hash, '3', 'BIT', 'cohort_beta'
  );

  // Seed files across Cohort Alpha, Cohort Beta, legacy NULL cohort, global all_students, and Sem 6 numeric legacy row
  await db.run(
    `INSERT INTO files (id, originalName, storedName, title, semester, semester_no, subject, chapter, sizeBytes, uploadedBy, uploadedAt, cohort_id, audience_scope)
     VALUES
       (9001, 'alpha_trees.pdf', 'alpha_trees.pdf', 'Alpha AVL Trees Notes', '3rd', 3, 'Data Structure and Algorithms', '2', 2048, 'stu_alpha_1', CURRENT_TIMESTAMP, 'cohort_alpha', 'semester'),
       (9002, 'beta_graphs.pdf', 'beta_graphs.pdf', 'Beta Graph Algorithms Notes', '3rd', 3, 'Data Structure and Algorithms', '5', 2048, 'stu_beta_1', CURRENT_TIMESTAMP, 'cohort_beta', 'semester'),
       (9003, 'legacy_linked_list.pdf', 'legacy_linked_list.pdf', 'Singly Linked List Handout', '3rd', 3, 'Data Structure and Algorithms', '2', 2048, 'stu_alpha_1', CURRENT_TIMESTAMP, NULL, 'semester'),
       (9004, 'global_handbook.pdf', 'global_handbook.pdf', 'Campus Study Handbook', NULL, NULL, NULL, NULL, 1024, 'stu_alpha_1', CURRENT_TIMESTAMP, NULL, 'all_students'),
       (9005, 'sem6_compilers.pdf', 'sem6_compilers.pdf', 'Compiler Design Legacy Notes', '6th', 6, 'Compiler Design', '1', 2048, 'stu_alpha_1', CURRENT_TIMESTAMP, NULL, 'semester')`
  );

  await db.run(
    `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
     VALUES
       (9001, 'AVL tree balancing performs single and double rotations on binary search trees.', 'indexed', CURRENT_TIMESTAMP),
       (9002, 'Graph traversal algorithms BFS and DFS for cohort beta.', 'indexed', CURRENT_TIMESTAMP),
       (9003, 'A singly linked list stores elements in dynamically allocated nodes with next pointers.', 'indexed', CURRENT_TIMESTAMP),
       (9004, 'General campus library rules and exam guidelines.', 'indexed', CURRENT_TIMESTAMP),
       (9005, 'Lexical analysis and LR parsing in Semester 6 Compiler Design.', 'indexed', CURRENT_TIMESTAMP)`
  );

  // Seed assignments across Cohort Alpha, Cohort Beta, legacy NULL cohort, and Sem 6 numeric legacy row
  await db.run(
    `INSERT INTO assignments (id, title, description, language, subject, semester, semester_no, cohort_id, audience_scope, createdBy, createdAt)
     VALUES
       (8001, 'Alpha DSA Lab 1', 'Implement linked list', 'c', 'Data Structure and Algorithms', '3rd', 3, 'cohort_alpha', 'semester', 'stu_alpha_1', CURRENT_TIMESTAMP),
       (8002, 'Beta DSA Lab 1', 'Implement BFS queue', 'c', 'Data Structure and Algorithms', '3rd', 3, 'cohort_beta', 'semester', 'stu_beta_1', CURRENT_TIMESTAMP),
       (8003, 'Legacy DSA Lab 0', 'Shared legacy recursion task', 'c', 'Data Structure and Algorithms', '3rd', 3, NULL, 'semester', 'stu_alpha_1', CURRENT_TIMESTAMP),
       (8004, 'Sem 6 Compiler Lab', 'Build lexical analyzer', 'c', 'Compiler Design', '6th', 6, NULL, 'semester', 'stu_alpha_1', CURRENT_TIMESTAMP)`
  );

  const loginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_alpha_1', password: TEST_PASSWORD })
  });
  assert.equal(loginRes.status, 200, 'Test student login should succeed');
  studentCookie = extractCookieHeader(loginRes);
  assert.ok(studentCookie.length > 0, 'Session cookie should be set on login');
});

test.after(async () => {
  hourlyStore.clear();
  dailyStore.clear();
  invalidateSearchCache();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch {}
});

test('1. POST /api/ai/chat requires login (401) and applies per-user hourly & daily rate limits (429)', async () => {
  hourlyStore.clear();
  dailyStore.clear();

  // Unauthenticated request -> 401
  const unauthRes = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ message: 'syllabus of semester 1' })
  });
  assert.equal(unauthRes.status, 401);
  const unauthBody = await unauthRes.json();
  assert.match(unauthBody.message, /Authentication required/i);

  // Authenticated empty message passes limiter (does not increment quota) and fails validation cleanly
  const emptyRes = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: studentCookie },
    body: JSON.stringify({ message: '   ' })
  });
  assert.equal(emptyRes.status, 400);
  assert.equal(hourlyStore.get('student:stu_alpha_1'), undefined);
  assert.equal(dailyStore.get('student:stu_alpha_1'), undefined);

  // Authenticated deterministic syllabus lookup -> 200 and increments both stores
  const okRes = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: studentCookie },
    body: JSON.stringify({ message: 'syllabus of semester 1' })
  });
  assert.equal(okRes.status, 200);
  assert.equal(hourlyStore.get('student:stu_alpha_1')?.count, 1);
  assert.equal(dailyStore.get('student:stu_alpha_1')?.count, 1);

  // Log in a second authenticated student (stu_beta_1) so we verify isolated per-user buckets
  const betaLoginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ studentId: 'stu_beta_1', password: TEST_PASSWORD })
  });
  assert.equal(betaLoginRes.status, 200, 'Second student login should succeed');
  const betaCookie = extractCookieHeader(betaLoginRes);
  assert.ok(betaCookie.length > 0, 'Session cookie should be set for second student');

  // Pre-seed hourly store at configured cap -> 429 HOURLY_RATE_LIMIT_EXCEEDED
  const hourKey = getHourKey();
  const dayKey = getTodayKey();
  hourlyStore.set('student:stu_alpha_1', { period: hourKey, date: hourKey, count: HOURLY_LIMIT });
  const hourlyBlockedRes = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: studentCookie },
    body: JSON.stringify({ message: 'syllabus of semester 1' })
  });
  assert.equal(hourlyBlockedRes.status, 429);
  assert.ok(Number(hourlyBlockedRes.headers.get('retry-after')) >= 1);
  const hourlyBlockedBody = await hourlyBlockedRes.json();
  assert.equal(hourlyBlockedBody.error, 'HOURLY_RATE_LIMIT_EXCEEDED');
  // Daily counter must NOT be burned when hourly cap blocks the request
  assert.equal(dailyStore.get('student:stu_alpha_1')?.count, 1);

  // User B (stu_beta_1) must succeed (200) in its own bucket even while User A is hourly rate-limited (429)
  const betaHourlyOkRes = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: betaCookie },
    body: JSON.stringify({ message: 'syllabus of semester 1' })
  });
  assert.equal(betaHourlyOkRes.status, 200);
  assert.equal(hourlyStore.get('student:stu_beta_1')?.count, 1);
  assert.equal(dailyStore.get('student:stu_beta_1')?.count, 1);
  assert.equal(hourlyStore.get('student:stu_alpha_1')?.count, HOURLY_LIMIT);

  // Reset hourly store for alpha, pre-seed daily store at cap -> 429 DAILY_RATE_LIMIT_EXCEEDED
  hourlyStore.delete('student:stu_alpha_1');
  dailyStore.set('student:stu_alpha_1', { period: dayKey, date: dayKey, count: DAILY_LIMIT });
  const dailyBlockedRes = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: studentCookie },
    body: JSON.stringify({ message: 'syllabus of semester 1' })
  });
  assert.equal(dailyBlockedRes.status, 429);
  assert.ok(Number(dailyBlockedRes.headers.get('retry-after')) >= 1);
  const dailyBlockedBody = await dailyBlockedRes.json();
  assert.equal(dailyBlockedBody.error, 'DAILY_RATE_LIMIT_EXCEEDED');
  // Hourly counter must NOT be burned when daily cap blocks the request
  assert.equal(hourlyStore.get('student:stu_alpha_1'), undefined);

  // User B still succeeds (200) when User A hits the daily cap
  const betaDailyOkRes = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: betaCookie },
    body: JSON.stringify({ message: 'syllabus of semester 1' })
  });
  assert.equal(betaDailyOkRes.status, 200);
  assert.equal(hourlyStore.get('student:stu_beta_1')?.count, 2);
  assert.equal(dailyStore.get('student:stu_beta_1')?.count, 2);
  assert.equal(hourlyStore.get('student:stu_alpha_1'), undefined);
  assert.equal(dailyStore.get('student:stu_alpha_1')?.count, DAILY_LIMIT);

  hourlyStore.clear();
  dailyStore.clear();
});

test('2. Dual rate limiter defaults (60/hour, 300/day), env configuration, pruning, and client ID precedence', () => {
  assert.equal(DEFAULT_HOURLY_LIMIT, 60);
  assert.equal(DEFAULT_DAILY_LIMIT, 300);

  const prevHourEnv = process.env.AI_CHAT_HOURLY_LIMIT;
  const prevDayEnv = process.env.AI_CHAT_DAILY_LIMIT;
  try {
    process.env.AI_CHAT_HOURLY_LIMIT = '2';
    process.env.AI_CHAT_DAILY_LIMIT = '3';
    const localHourStore = new Map();
    const localDayStore = new Map();
    // Stale entries from old hour/day must be pruned
    localHourStore.set('student:stale', { period: '2020-01-01T00', date: '2020-01-01T00', count: 99 });
    localDayStore.set('student:stale', { period: '2020-01-01', date: '2020-01-01', count: 99 });

    let now = new Date(2026, 9, 15, 10, 15, 0);
    const limiter = createChatRateLimiter({
      hourlyStore: localHourStore,
      dailyStore: localDayStore,
      getHourKey: d => getHourKey(d),
      getToday: d => getTodayKey(d),
      now: () => now
    });

    const sendAs = (studentId) => {
      const req = { user: { studentId }, body: { message: 'hello kyana' }, ip: '127.0.0.1' };
      const res = makeResSpy();
      let passed = false;
      limiter(req, res, () => { passed = true; });
      return { passed, res };
    };

    assert.equal(sendAs('s1').passed, true);
    assert.equal(localHourStore.has('student:stale'), false);
    assert.equal(localDayStore.has('student:stale'), false);
    assert.equal(sendAs('s1').passed, true);

    // 3rd request in hour 10 exceeds hourly limit (2) and does NOT burn daily count (still 2/3)
    const hourHit = sendAs('s1');
    assert.equal(hourHit.passed, false);
    assert.equal(hourHit.res.statusCode, 429);
    assert.equal(hourHit.res.body.error, 'HOURLY_RATE_LIMIT_EXCEEDED');
    assert.equal(localDayStore.get('student:s1').count, 2);

    // Advance to hour 11 same day -> 3rd message succeeds, 4th exceeds daily limit (3)
    now = new Date(2026, 9, 15, 11, 5, 0);
    assert.equal(sendAs('s1').passed, true);
    assert.equal(localHourStore.get('student:s1').count, 1);
    assert.equal(localDayStore.get('student:s1').count, 3);

    const dayHit = sendAs('s1');
    assert.equal(dayHit.passed, false);
    assert.equal(dayHit.res.statusCode, 429);
    assert.equal(dayHit.res.body.error, 'DAILY_RATE_LIMIT_EXCEEDED');
    // Hourly count in hour 11 stays 1 (not burned when daily cap fails)
    assert.equal(localHourStore.get('student:s1').count, 1);
  } finally {
    if (prevHourEnv === undefined) delete process.env.AI_CHAT_HOURLY_LIMIT;
    else process.env.AI_CHAT_HOURLY_LIMIT = prevHourEnv;
    if (prevDayEnv === undefined) delete process.env.AI_CHAT_DAILY_LIMIT;
    else process.env.AI_CHAT_DAILY_LIMIT = prevDayEnv;
  }

  assert.equal(getClientId({ user: { studentId: 'u1' }, session: { studentId: 's1' } }), 'student:u1');
  assert.equal(getClientId({ user: { id: 'usr_9' } }), 'user:usr_9');
  assert.equal(getClientId({ session: { studentId: 's2' } }), 'student:s2');
  assert.equal(getClientId({ sessionID: 'sess_1' }), 'session:sess_1');
  assert.equal(getClientId({ ip: '10.0.0.1' }), 'ip:10.0.0.1');
});

test('3. resourceFilter and canReadResource share buildAcademicContentFilter cohort + legacy NULL rule', async () => {
  const ctxAlpha = { authenticated: true, role: 'student', studentId: 'stu_alpha_1', academicStatus: 'active', currentSemester: 3, cohortId: 'cohort_alpha', cohort: { id: 'cohort_alpha', currentSemester: 3 } };
  const ctxBeta = { authenticated: true, role: 'student', studentId: 'stu_beta_1', academicStatus: 'active', currentSemester: 3, cohortId: 'cohort_beta', cohort: { id: 'cohort_beta', currentSemester: 3 } };
  const ctxUnassigned = { authenticated: true, role: 'student', studentId: 'stu_unassigned', academicStatus: 'unassigned', currentSemester: null, cohortId: null, cohort: null };

  // Notes (files) SQL parity with web library buildAcademicContentFilter
  const fAlpha = resourceFilter(ctxAlpha, 'note', 'f');
  const alphaIds = (await db.all(`SELECT f.id FROM files f WHERE ${fAlpha.sql} ORDER BY f.id`, ...fAlpha.params)).map(r => r.id);
  assert.deepEqual(alphaIds, [9001, 9003, 9004]);

  const libAlpha = buildAcademicContentFilter(ctxAlpha, { tableAlias: 'f' });
  const libAlphaIds = (await db.all(`SELECT f.id FROM files f WHERE ${libAlpha.sql} ORDER BY f.id`, ...libAlpha.params)).map(r => r.id);
  assert.deepEqual(alphaIds, libAlphaIds, 'Kyana resourceFilter must match web library buildAcademicContentFilter');

  const fBeta = resourceFilter(ctxBeta, 'note', 'f');
  const betaIds = (await db.all(`SELECT f.id FROM files f WHERE ${fBeta.sql} ORDER BY f.id`, ...fBeta.params)).map(r => r.id);
  assert.deepEqual(betaIds, [9002, 9003, 9004]);

  // Assignments SQL cohort isolation + legacy NULL parity
  const aAlpha = resourceFilter(ctxAlpha, 'assignment', 'a');
  const assignAlphaIds = (await db.all(`SELECT a.id FROM assignments a WHERE ${aAlpha.sql} ORDER BY a.id`, ...aAlpha.params)).map(r => r.id);
  assert.deepEqual(assignAlphaIds, [8001, 8003]);

  const aBeta = resourceFilter(ctxBeta, 'assignment', 'a');
  const assignBetaIds = (await db.all(`SELECT a.id FROM assignments a WHERE ${aBeta.sql} ORDER BY a.id`, ...aBeta.params)).map(r => r.id);
  assert.deepEqual(assignBetaIds, [8002, 8003]);

  // Policy-level canReadResource & revalidateCards stay consistent with resourceFilter (legacy NULL allowed, cross-cohort blocked)
  const fileAlphaRow = await db.get('SELECT * FROM files WHERE id = 9001');
  const fileBetaRow = await db.get('SELECT * FROM files WHERE id = 9002');
  const fileLegacyRow = await db.get('SELECT * FROM files WHERE id = 9003');
  assert.equal(canReadResource(ctxAlpha, fileAlphaRow, 'note'), true);
  assert.equal(canReadResource(ctxAlpha, fileBetaRow, 'note'), false);
  assert.equal(canReadResource(ctxAlpha, fileLegacyRow, 'note'), true);
  assert.equal(canReadResource(ctxUnassigned, fileAlphaRow, 'note'), false);
  assert.equal(canReadResource(ctxUnassigned, fileLegacyRow, 'note'), false);

  const revalidated = await revalidateCards(db, ctxAlpha, [{ type: 'note', id: 9003 }]);
  assert.equal(revalidated.length, 1, 'Legacy cohort_id NULL note must pass revalidateCards for cohort student');
});

test('4. chat-tools search_notes inferred-subject fallback passes academicContext and isolates cohorts', async () => {
  invalidateSearchCache();
  const ctxAlpha = { authenticated: true, role: 'student', studentId: 'stu_alpha_1', academicStatus: 'active', currentSemester: 3, cohortId: 'cohort_alpha', cohort: { id: 'cohort_alpha', currentSemester: 3 } };
  const ctxBeta = { authenticated: true, role: 'student', studentId: 'stu_beta_1', academicStatus: 'active', currentSemester: 3, cohortId: 'cohort_beta', cohort: { id: 'cohort_beta', currentSemester: 3 } };

  // "hashing" predicts 'Data Structure and Algorithms' without matching files 9001/9002 directly,
  // triggering the inferred-subject fallback in lib/chat-tools.js
  const toolsBeta = createTools(db, routeQuery('hashing notes', []), { academicContext: ctxBeta });
  const betaRes = await toolsBeta.executeTool('search_notes', { query: 'hashing' });
  assert.equal(betaRes.inferredSubject, 'Data Structure and Algorithms');
  const betaIds = betaRes.files.map(f => f.id);
  assert.equal(betaIds.includes(9001), false, 'Cohort Beta inferred-subject fallback MUST NOT return Cohort Alpha private file 9001');
  assert.equal(betaIds.includes(9002), true, 'Cohort Beta should still see Cohort Beta DSA notes via inferred-subject fallback');

  const toolsAlpha = createTools(db, routeQuery('hashing notes', []), { academicContext: ctxAlpha });
  const alphaRes = await toolsAlpha.executeTool('search_notes', { query: 'hashing' });
  assert.equal(alphaRes.inferredSubject, 'Data Structure and Algorithms');
  const alphaIds = alphaRes.files.map(f => f.id);
  assert.equal(alphaIds.includes(9002), false, 'Cohort Alpha inferred-subject fallback MUST NOT return Cohort Beta private file 9002');
  assert.equal(alphaIds.includes(9001), true, 'Cohort Alpha should see Cohort Alpha DSA notes');
});

test('5. Curriculum routing, TOOLS enablement, pre-retrieval subject aliases, and note-search STOP_WORDS', async () => {
  // Routing & regex behavior
  const teachRoute = routeQuery('teach me chapter 2 of DSA');
  assert.equal(teachRoute.kind, 'tools');
  assert.equal(teachRoute.filters.subject, 'Data Structure and Algorithms');
  assert.equal(studyTeachIntent('teach me'), true);
  assert.equal(studyTeachIntent('teach me chapter 2 of DSA'), true);
  assert.equal(studyTeachIntent('chapter 2'), true);
  assert.equal(studyTeachIntent('chapter II'), true);
  assert.equal(studyTeachIntent('chapter two'), true);
  assert.equal(studyTeachIntent('unit 1'), true);
  assert.equal(studyTeachIntent('unit III'), true);
  assert.equal(studyTeachIntent('unit two'), true);
  assert.equal(studyTeachIntent('lesson 3'), true);
  assert.equal(studyTeachIntent('module 4'), true);
  assert.equal(studyTeachIntent('unit testing'), false);
  assert.equal(routeQuery('unit testing').kind, 'direct');
  assert.equal(studyTeachIntent('what is unit testing?'), false);
  assert.equal(routeQuery('what is unit testing?').kind, 'direct');
  assert.equal(studyTeachIntent('what is a module in python?'), false);
  assert.equal(routeQuery('what is a module in python?').kind, 'direct');
  assert.equal(studyTeachIntent('what is a variable?'), false);

  // Code requests remain direct even if they contain "chapter"
  assert.equal(routeQuery('Write JavaScript code for chapter 2 binary search').kind, 'direct');

  // Stop words: "teach" and "chapter" must not prevent matching linked-list handout
  invalidateSearchCache();
  const ctxAlpha = { authenticated: true, role: 'student', studentId: 'stu_alpha_1', academicStatus: 'active', currentSemester: 3, cohortId: 'cohort_alpha', cohort: { id: 'cohort_alpha', currentSemester: 3 } };
  const stopWordHits = await searchNotes(db, {
    query: 'teach chapter linked list',
    academicContext: ctxAlpha,
    subject: subjectAliases('Data Structure and Algorithms')
  });
  assert.ok(stopWordHits.some(f => f.id === 9003), 'searchNotes must ignore stop words "teach" and "chapter" and match "linked list"');

  // Verify handleChat tool enabling & pre-retrieval arguments across routes
  const calls = [];
  const captureHandleChat = async (message, customAcademicContext = ctxAlpha) => {
    let seenSearchArgs = null;
    let seenGenerateArgs = null;
    const res = await handleChat({
      db,
      message,
      academicContext: customAcademicContext,
      generateReply: async (args) => {
        seenGenerateArgs = args;
        return { reply: `ok:${message}` };
      },
      toolDependencies: {
        searchNotes: async (_db, args) => {
          seenSearchArgs = args;
          return [];
        }
      }
    });
    calls.push({ message, res, seenSearchArgs, seenGenerateArgs });
    return { res, seenSearchArgs, seenGenerateArgs };
  };

  // A. "teach me chapter 2 of DSA" -> TOOLS enabled (get_syllabus, search_notes, read_note_file) + subject aliases passed to pre-retrieval
  const dsaCall = await captureHandleChat('teach me chapter 2 of DSA');
  const dsaToolNames = dsaCall.seenGenerateArgs.tools.map(t => t.function?.name || t.name);
  assert.ok(dsaToolNames.includes('get_syllabus'));
  assert.ok(dsaToolNames.includes('search_notes'));
  assert.ok(dsaToolNames.includes('read_note_file'));
  assert.deepEqual(dsaCall.seenSearchArgs.subject, subjectAliases('Data Structure and Algorithms'));
  assert.equal(dsaCall.seenSearchArgs.query, 'teach chapter 2');

  // B. "explain DBMS normalization" -> TOOLS enabled because subject is resolved even though route.kind === 'direct'
  const dbmsCall = await captureHandleChat('explain DBMS normalization');
  assert.ok(dbmsCall.seenGenerateArgs.tools.length > 0);
  assert.deepEqual(dbmsCall.seenSearchArgs.subject, subjectAliases('Database Management System'));

  // C. "what is a variable?", "unit testing", and "what is a module in python?" -> MUST keep tools: [] (even when authenticated!)
  const varCall = await captureHandleChat('what is a variable?');
  assert.deepEqual(varCall.seenGenerateArgs.tools, []);
  const unitTestingCall = await captureHandleChat('unit testing');
  assert.deepEqual(unitTestingCall.seenGenerateArgs.tools, []);
  const pythonModuleCall = await captureHandleChat('what is a module in python?');
  assert.deepEqual(pythonModuleCall.seenGenerateArgs.tools, []);

  // D. Code request mentioning chapter -> tools: []
  const codeCall = await captureHandleChat('Write JavaScript code for chapter 2 binary search');
  assert.deepEqual(codeCall.seenGenerateArgs.tools, []);

  // E. Smalltalk containing "teach" -> tools: []
  const smalltalkCall = await captureHandleChat('hey teach me');
  assert.deepEqual(smalltalkCall.seenGenerateArgs.tools, []);
});

test('6. Mobile sendKyanaMessage clears auth token ONLY on genuine matching 401 and forwards 429 server message', async () => {
  const vm = require('vm');
  const ts = require('../mobile/node_modules/typescript');
  const originalXhr = globalThis.XMLHttpRequest;
  const kyanaTsPath = path.resolve(__dirname, '../mobile/services/kyana.ts');
  const kyanaSource = fs.readFileSync(kyanaTsPath, 'utf8');
  const { outputText } = ts.transpileModule(kyanaSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });

  let clearCount = 0;
  let storedToken = 'tok_active_1';
  let xhrBehavior = { mode: 'load', status: 401, responseText: JSON.stringify({ message: 'Authentication required. Please sign in.' }) };

  class MockApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }

  class MockXMLHttpRequest {
    constructor() {
      this.headers = {};
      this.status = 0;
      this.responseText = '';
    }
    open() {}
    setRequestHeader(k, v) { this.headers[k] = v; }
    send() {
      queueMicrotask(() => {
        if (xhrBehavior.mode === 'error') {
          this.status = 0;
          this.onerror?.();
        } else if (xhrBehavior.mode === 'timeout') {
          this.status = 0;
          this.ontimeout?.();
        } else {
          this.status = xhrBehavior.status;
          this.responseText = xhrBehavior.responseText;
          if (typeof xhrBehavior.beforeLoad === 'function') xhrBehavior.beforeLoad();
          this.onload?.();
        }
      });
    }
    abort() {}
  }

  const mockApi = {
    apiFetch: async () => ({}),
    getBaseUrl: async () => 'http://localhost:3000',
    getAuthToken: async () => storedToken,
    clearAuthToken: async () => { clearCount += 1; storedToken = null; },
    ApiError: MockApiError
  };

  globalThis.XMLHttpRequest = MockXMLHttpRequest;

  try {
    const cjsMod = { exports: {} };
    const localRequire = (specifier) => {
      if (specifier === './api') return mockApi;
      return require(specifier);
    };
    const fn = vm.runInThisContext(Module.wrap(outputText), { filename: kyanaTsPath });
    fn(cjsMod.exports, localRequire, cjsMod, kyanaTsPath, path.dirname(kyanaTsPath));
    const { sendKyanaMessage } = cjsMod.exports;

    // 1. Network error (status 0) MUST NOT clear token
    xhrBehavior = { mode: 'error' };
    await assert.rejects(() => sendKyanaMessage({ message: 'hi' }), err => err.status === 0);
    assert.equal(clearCount, 0);
    assert.equal(storedToken, 'tok_active_1');

    // 2. Timeout MUST NOT clear token
    xhrBehavior = { mode: 'timeout' };
    await assert.rejects(() => sendKyanaMessage({ message: 'hi' }), err => err.status === 408);
    assert.equal(clearCount, 0);
    assert.equal(storedToken, 'tok_active_1');

    // 3. 429 forwards exact server daily/hourly message and MUST NOT clear token
    xhrBehavior = { mode: 'load', status: 429, responseText: JSON.stringify({ error: 'DAILY_RATE_LIMIT_EXCEEDED', message: 'Daily limit of 300 reached.' }) };
    await assert.rejects(
      () => sendKyanaMessage({ message: 'hi' }),
      err => err.status === 429 && err.message === 'Daily limit of 300 reached.'
    );
    assert.equal(clearCount, 0);
    assert.equal(storedToken, 'tok_active_1');

    // 4. 401 after a concurrent login rotated storedToken MUST NOT wipe the newer token
    xhrBehavior = {
      mode: 'load',
      status: 401,
      responseText: JSON.stringify({ message: 'Expired token' }),
      beforeLoad: () => { storedToken = 'tok_newer_2'; }
    };
    await assert.rejects(() => sendKyanaMessage({ message: 'hi' }), err => err.status === 401);
    assert.equal(clearCount, 0);
    assert.equal(storedToken, 'tok_newer_2');

    // 5. Genuine matching 401 clears storedToken once
    xhrBehavior = { mode: 'load', status: 401, responseText: JSON.stringify({ message: 'Authentication required. Please sign in.' }) };
    await assert.rejects(
      () => sendKyanaMessage({ message: 'hi' }),
      err => err.status === 401 && err.message === 'Authentication required. Please sign in.'
    );
    assert.equal(clearCount, 1);
    assert.equal(storedToken, null);
  } finally {
    globalThis.XMLHttpRequest = originalXhr;
  }
});

test('7. Legacy cohort_id NULL Semester 6 rows (not all_students) are hidden from Semester 1 students via resourceFilter and canReadResource', async () => {
  await db.run(
    `INSERT INTO files (id, originalName, storedName, title, semester, semester_no, subject, chapter, sizeBytes, uploadedBy, uploadedAt, cohort_id, audience_scope)
     VALUES (9006, 'sem6_dist_legacy.pdf', 'sem6_dist_legacy.pdf', 'Distributed Systems Legacy Handout', 'Semester 6', NULL, 'Distributed Systems', '1', 2048, 'stu_alpha_1', CURRENT_TIMESTAMP, NULL, 'semester')`
  );
  await db.run(
    `INSERT INTO assignments (id, title, description, language, subject, semester, semester_no, cohort_id, audience_scope, createdBy, createdAt)
     VALUES (8005, 'Sem 6 Distributed Lab', 'Implement Lamport clock', 'python', 'Distributed Systems', 'Semester 6', NULL, NULL, 'semester', 'stu_alpha_1', CURRENT_TIMESTAMP)`
  );
  try {
    const ctxSem1 = {
      authenticated: true,
      role: 'student',
      studentId: 'stu_sem1_legacy_check',
      academicStatus: 'active',
      currentSemester: 1,
      cohortId: 'cohort_sem1',
      cohort: { id: 'cohort_sem1', currentSemester: 1 }
    };
    const ctxSem6 = {
      authenticated: true,
      role: 'student',
      studentId: 'stu_sem6_legacy_check',
      academicStatus: 'active',
      currentSemester: 6,
      cohortId: 'cohort_sem6',
      cohort: { id: 'cohort_sem6', currentSemester: 6 }
    };

    // SQL filter: Semester 1 student must see ONLY global 9004, NEVER Sem 6 legacy 9005 (semester_no=6) or 9006 (semester_no=NULL, semester='Semester 6')
    const fSem1Notes = resourceFilter(ctxSem1, 'note', 'f');
    const sem1NoteIds = (await db.all(`SELECT f.id FROM files f WHERE ${fSem1Notes.sql} ORDER BY f.id`, ...fSem1Notes.params)).map(r => r.id);
    assert.deepEqual(sem1NoteIds, [9004]);
    assert.equal(sem1NoteIds.includes(9005), false);
    assert.equal(sem1NoteIds.includes(9006), false);

    // Note: buildAcademicContentFilter alone matches 9006 because semester_no IS NULL, while Kyana resourceFilter Clause 2 blocks it
    const libSem1 = buildAcademicContentFilter(ctxSem1, { tableAlias: 'f' });
    const libSem1NoteIds = (await db.all(`SELECT f.id FROM files f WHERE ${libSem1.sql} ORDER BY f.id`, ...libSem1.params)).map(r => r.id);
    assert.deepEqual(libSem1NoteIds, [9004, 9006]);

    const fSem1Asg = resourceFilter(ctxSem1, 'assignment', 'a');
    const sem1AsgIds = (await db.all(`SELECT a.id FROM assignments a WHERE ${fSem1Asg.sql} ORDER BY a.id`, ...fSem1Asg.params)).map(r => r.id);
    assert.deepEqual(sem1AsgIds, []);
    assert.equal(sem1AsgIds.includes(8004), false);
    assert.equal(sem1AsgIds.includes(8005), false);

    // Confirm those same Sem 6 legacy rows DO resolve for an actual Semester 6 student
    const fSem6Notes = resourceFilter(ctxSem6, 'note', 'f');
    const sem6NoteIds = (await db.all(`SELECT f.id FROM files f WHERE ${fSem6Notes.sql} ORDER BY f.id`, ...fSem6Notes.params)).map(r => r.id);
    assert.deepEqual(sem6NoteIds, [9004, 9005, 9006]);

    // Row-level policy: canReadResource blocks both Sem 6 legacy rows for Semester 1, allows them for Semester 6
    const fileSem6Numeric = await db.get('SELECT * FROM files WHERE id = 9005');
    const fileSem6TextOnly = await db.get('SELECT * FROM files WHERE id = 9006');
    const fileGlobal = await db.get('SELECT * FROM files WHERE id = 9004');
    const asgSem6Numeric = await db.get('SELECT * FROM assignments WHERE id = 8004');
    const asgSem6TextOnly = await db.get('SELECT * FROM assignments WHERE id = 8005');

    assert.equal(canReadResource(ctxSem1, fileSem6Numeric, 'note'), false);
    assert.equal(canReadResource(ctxSem1, fileSem6TextOnly, 'note'), false);
    assert.equal(canReadResource(ctxSem1, asgSem6Numeric, 'assignment'), false);
    assert.equal(canReadResource(ctxSem1, asgSem6TextOnly, 'assignment'), false);
    assert.equal(canReadResource(ctxSem1, fileGlobal, 'note'), true);

    assert.equal(canReadResource(ctxSem6, fileSem6Numeric, 'note'), true);
    assert.equal(canReadResource(ctxSem6, fileSem6TextOnly, 'note'), true);
  } finally {
    await db.run('DELETE FROM files WHERE id = 9006');
    await db.run('DELETE FROM assignments WHERE id = 8005');
  }
});

