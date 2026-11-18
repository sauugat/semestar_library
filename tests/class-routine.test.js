const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createClient } = require('@libsql/client');
const { createTransactionAdapter } = require('../lib/db-transaction');
const { ensureRoutineSchema, seedClassRoutines } = require('../lib/routine');
const createRoutineRouter = require('../routes/routine');

async function createTestDb(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'class-routine-test-'));
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
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      semester TEXT,
      cohort_id TEXT
    );
    CREATE TABLE cohorts (
      id TEXT PRIMARY KEY,
      slot_code TEXT,
      display_name TEXT,
      current_semester INTEGER,
      status TEXT
    );
    INSERT INTO cohorts (id, slot_code, display_name, current_semester, status) VALUES
      ('c-1', 'mercury', 'Mercury', 1, 'active'),
      ('c-3', 'venus', 'Venus', 3, 'active'),
      ('c-5', 'earth', 'Earth', 5, 'active'),
      ('c-7', 'mars', 'Mars', 7, 'active');
    INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES
      ('admin-1', 'Admin User', 'admin', NULL, NULL),
      ('teacher-1', 'Teacher User', 'teacher', NULL, NULL),
      ('stu-sem1', 'Student Sem 1', 'student', 'Semester 1', 'c-1'),
      ('stu-sem2', 'Student Sem 2', 'student', 'Semester 2', NULL),
      ('stu-sem3', 'Student Sem 3', 'student', 'Semester 3', 'c-3'),
      ('stu-sem5', 'Student Sem 5', 'student', 'Semester 5', 'c-5'),
      ('stu-sem7', 'Student Sem 7', 'student', 'Semester 7', 'c-7');
  `);
  t.after(() => {
    client.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  return db;
}

function createTestApp(db) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const userId = req.headers['x-test-user'];
    req.session = userId ? { studentId: userId } : {};
    next();
  });
  const requireLogin = (req, res, next) => (
    req.session && req.session.studentId ? next() : res.status(401).json({ error: 'Sign in required' })
  );
  app.use('/api/routine', createRoutineRouter(db, requireLogin));
  return app;
}

function dispatch(app, method, url, body, userId) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = `/api/routine${url}`;
    req.originalUrl = req.url;
    req.headers = {
      'content-type': 'application/json',
      ...(userId ? { 'x-test-user': userId } : {})
    };
    req.body = body;
    req.socket = {};
    req.connection = {};

    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.locals = {};
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.getHeader = (k) => res.headers[k.toLowerCase()];
    res.set = (k, v) => { res.setHeader(k, v); return res; };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => {
      resolve({ status: res.statusCode, body: payload, headers: res.headers });
      return res;
    };
    res.send = (payload) => {
      resolve({ status: res.statusCode, body: payload, headers: res.headers });
      return res;
    };
    res.end = (payload) => {
      resolve({ status: res.statusCode, body: payload, headers: res.headers });
      return res;
    };

    app.handle(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: 404, body: null, headers: res.headers });
    });
  });
}

test('1-4: Semester I, III, V, and VII students receive their exact respective routines', async t => {
  const db = await createTestDb(t);
  await seedClassRoutines(db);
  const app = createTestApp(db);

  for (const [userId, expectedSem, expectedSubject] of [
    ['stu-sem1', 1, 'Computer Programming in C'],
    ['stu-sem3', 3, 'Web Technology II'],
    ['stu-sem5', 5, 'Research Methodology'],
    ['stu-sem7', 7, 'Cloud Computing']
  ]) {
    const res = await dispatch(app, 'GET', '/class', undefined, userId);
    assert.equal(res.status, 200);
    assert.equal(res.body.semester, expectedSem);
    assert.ok(res.body.routine, `Expected routine for ${userId}`);
    assert.equal(res.body.routine.semester, expectedSem);
    assert.equal(res.body.routine.academic_session, 'Aswoj–Chaitra 2083');
    assert.equal(res.body.routine.slots.length, 6);
    assert.ok(
      res.body.routine.entries.some(e => e.subject_name === expectedSubject),
      `Expected canonical subject "${expectedSubject}" in Semester ${expectedSem}`
    );
  }
});

test('5: Students cannot access unauthorized semester routines or unauthenticated requests', async t => {
  const db = await createTestDb(t);
  await seedClassRoutines(db);
  const app = createTestApp(db);

  const unauth = await dispatch(app, 'GET', '/class');
  assert.equal(unauth.status, 401);

  const crossSem = await dispatch(app, 'GET', '/class?semester=3', undefined, 'stu-sem1');
  assert.equal(crossSem.status, 403);

  const ownSem = await dispatch(app, 'GET', '/class?semester=1', undefined, 'stu-sem1');
  assert.equal(ownSem.status, 200);
  assert.equal(ownSem.body.routine.semester, 1);

  // Semester II has no published routine in PDF — must NOT fall back to Semester I or III
  const sem2 = await dispatch(app, 'GET', '/class', undefined, 'stu-sem2');
  assert.equal(sem2.status, 200);
  assert.equal(sem2.body.routine, null);
  assert.match(sem2.body.message, /No class routine has been published/);
});

test('6: Unpublished (draft/archived) routines are not visible to students', async t => {
  const db = await createTestDb(t);
  const app = createTestApp(db);

  const created = await dispatch(app, 'POST', '/class/admin', {
    academic_session: 'Test Draft 2084',
    year: 1,
    semester: 2,
    status: 'draft'
  }, 'admin-1');
  assert.equal(created.status, 201);

  const studentView = await dispatch(app, 'GET', '/class', undefined, 'stu-sem2');
  assert.equal(studentView.status, 200);
  assert.equal(studentView.body.routine, null);

  // Publish it -> now visible
  const pub = await dispatch(app, 'POST', `/class/admin/${created.body.routine.id}/publish`, {}, 'admin-1');
  assert.equal(pub.status, 200);
  assert.equal(pub.body.routine.status, 'published');

  const afterPub = await dispatch(app, 'GET', '/class', undefined, 'stu-sem2');
  assert.equal(afterPub.status, 200);
  assert.equal(afterPub.body.routine.id, created.body.routine.id);

  // Archive it -> hidden again
  await dispatch(app, 'POST', `/class/admin/${created.body.routine.id}/archive`, {}, 'admin-1');
  const afterArch = await dispatch(app, 'GET', '/class', undefined, 'stu-sem2');
  assert.equal(afterArch.body.routine, null);
});

test('7: Admin can create and update routines; students and teachers are rejected', async t => {
  const db = await createTestDb(t);
  const app = createTestApp(db);

  for (const nonAdmin of ['stu-sem1', 'teacher-1']) {
    const r = await dispatch(app, 'POST', '/class/admin', {
      academic_session: 'Blocked 2084',
      year: 1,
      semester: 2
    }, nonAdmin);
    assert.equal(r.status, 403);
  }

  const created = await dispatch(app, 'POST', '/class/admin', {
    academic_session: 'Baishakh–Bhadra 2084',
    year: 1,
    semester: 2
  }, 'admin-1');
  assert.equal(created.status, 201);
  const routineId = created.body.routine.id;
  const slotId = created.body.routine.slots[0].id;

  const entryRes = await dispatch(app, 'POST', `/class/admin/${routineId}/entry`, {
    day_of_week: 'Monday',
    slot_id: slotId,
    subject_name: 'Discrete Mathematics',
    faculty_name: 'Dr. Test',
    faculty_type: 'FT',
    class_type: 'Theory'
  }, 'admin-1');
  assert.equal(entryRes.status, 200);
  assert.equal(entryRes.body.routine.entries.length, 1);
  assert.equal(entryRes.body.routine.entries[0].subject_name, 'Discrete Mathematics');
});

test('8-9: Lab/Practical periods are identified and empty periods are preserved', async t => {
  const db = await createTestDb(t);
  await seedClassRoutines(db);
  const app = createTestApp(db);

  const sem1 = await dispatch(app, 'GET', '/class', undefined, 'stu-sem1');
  const labs = sem1.body.routine.entries.filter(e => e.class_type === 'Lab');
  const practicals = sem1.body.routine.entries.filter(e => e.class_type === 'Practical');
  assert.ok(labs.length >= 6, 'Semester I should have Lab periods');
  assert.equal(practicals.length, 2, 'Semester I Friday 11:50-1:30 C(Pr) spans 2 slots');

  const sem5 = await dispatch(app, 'GET', '/class', undefined, 'stu-sem5');
  const emptyMondaySlot2 = sem5.body.routine.entries.find(
    e => e.day_of_week === 'Monday' && e.slot_order === 2
  );
  assert.ok(emptyMondaySlot2, 'Empty period on Monday slot 2 must be preserved');
  assert.equal(emptyMondaySlot2.is_empty, true);
  assert.equal(emptyMondaySlot2.class_type, 'Empty');
  assert.equal(emptyMondaySlot2.subject_name, null);
});

test('10: Multiple academic sessions do not overwrite one another', async t => {
  const db = await createTestDb(t);
  await seedClassRoutines(db);
  const app = createTestApp(db);

  const listBefore = await dispatch(app, 'GET', '/class/admin?semester=1', undefined, 'admin-1');
  assert.equal(listBefore.body.routines.length, 1);
  const oldId = listBefore.body.routines[0].id;

  const replaced = await dispatch(app, 'POST', `/class/admin/${oldId}/replace`, {
    academic_session: 'Baishakh–Bhadra 2084',
    copyEntries: true,
    archiveOld: true,
    publish: true
  }, 'admin-1');
  assert.equal(replaced.status, 201);

  const listAfter = await dispatch(app, 'GET', '/class/admin?semester=1', undefined, 'admin-1');
  assert.equal(listAfter.body.routines.length, 2);
  const oldRow = listAfter.body.routines.find(r => r.id === oldId);
  const newRow = listAfter.body.routines.find(r => r.id === replaced.body.routine.id);
  assert.equal(oldRow.status, 'archived');
  assert.equal(newRow.status, 'published');
});

test('11: Seed/import can run repeatedly without duplication and fixes OCR typos', async t => {
  const db = await createTestDb(t);
  const first = await seedClassRoutines(db);
  assert.equal(first.created, 4);
  assert.equal(first.skipped, 0);

  const second = await seedClassRoutines(db);
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 4);

  const count = await db.get('SELECT COUNT(*) AS total FROM class_routines');
  assert.equal(Number(count.total), 4);

  const typos = await db.all(
    `SELECT subject_name FROM class_routine_entries
     WHERE subject_name LIKE '%Technolgy%' OR subject_name LIKE '%Reseach%' OR subject_name LIKE '%witn%'`
  );
  assert.equal(typos.length, 0, 'All PDF OCR typos must be normalized');
});

test('12: Mobile and desktop rendering structures are present and monochrome', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'routine.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'routine-admin.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'routine.js'), 'utf8');
  const mobileTsx = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'app', 'routine.tsx'), 'utf8');

  assert.match(html, /id="classRoutineContainer"/);
  assert.match(html, /id="subjectDetailModal"/);
  assert.match(js, /class-grid-table/);
  assert.match(js, /class-mobile-cards/);
  assert.match(css, /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.class-grid-wrap\s*\{\s*display:\s*none\s*\}[\s\S]*?\.class-mobile-view\s*\{\s*display:\s*block\s*\}/);

  assert.doesNotMatch(mobileTsx, /COMING SOON/);
  assert.match(mobileTsx, /WORKING_DAYS/);
  assert.match(mobileTsx, /\/api\/routine\/class/);
  assert.match(mobileTsx, /Faculty Type/);
});

test('13: Partial seed failure rolls back completely', async t => {
  const db = await createTestDb(t);
  const badDataset = {
    university: 'Gandaki University',
    program: 'Bachelor of Information Technology',
    academic_session: 'Broken Seed 2085',
    status: 'published',
    time_slots: [
      { slot_order: 1, start_time: '11:00', end_time: '11:50', duration_minutes: 50, label: '11:00–11:50', is_break: false }
    ],
    semesters: [
      {
        year: 1,
        semester: 1,
        entries: [
          { day: 'Monday', slot_order: 1, subject: 'Valid Subject', class_type: 'Theory' },
          { day: 'Tuesday', slot_order: 99, subject: 'Broken Subject', class_type: 'Theory' }
        ]
      }
    ]
  };

  await assert.rejects(() => seedClassRoutines(db, badDataset), /Missing slot_order 99/);

  const routinesCount = await db.get('SELECT COUNT(*) AS c FROM class_routines');
  const slotsCount = await db.get('SELECT COUNT(*) AS c FROM class_routine_slots');
  const entriesCount = await db.get('SELECT COUNT(*) AS c FROM class_routine_entries');
  assert.equal(Number(routinesCount.c), 0);
  assert.equal(Number(slotsCount.c), 0);
  assert.equal(Number(entriesCount.c), 0);
});

test('14: Re-running seed recovers safely from incomplete previous routine and preserves unrelated sessions', async t => {
  const db = await createTestDb(t);
  await db.run(
    `INSERT INTO class_routines (university, program, academic_session, year, semester, status)
     VALUES ('Gandaki University', 'BIT', 'Unrelated 2082', 1, 1, 'published')`
  );
  await db.run(
    `INSERT INTO class_routines (university, program, academic_session, year, semester, status)
     VALUES ('Gandaki University', 'Bachelor of Information Technology', 'Aswoj–Chaitra 2083', 1, 1, 'published')`
  );

  const result = await seedClassRoutines(db);
  assert.equal(result.recovered, 1);
  assert.equal(result.created, 3);
  assert.equal(result.skipped, 0);

  const sem1 = await db.get(
    `SELECT id FROM class_routines WHERE academic_session = 'Aswoj–Chaitra 2083' AND semester = 1`
  );
  const slots = await db.get('SELECT COUNT(*) AS c FROM class_routine_slots WHERE routine_id = ?', sem1.id);
  const entries = await db.get('SELECT COUNT(*) AS c FROM class_routine_entries WHERE routine_id = ?', sem1.id);
  assert.equal(Number(slots.c), 6);
  assert.equal(Number(entries.c), 30);

  const unrelated = await db.get(`SELECT status FROM class_routines WHERE academic_session = 'Unrelated 2082'`);
  assert.equal(unrelated.status, 'published');
});

test('15: verifyStartupReady creates and verifies missing class routine tables on existing DB', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-ready-test-'));
  const dbFile = path.join(temp, 'existing.db');
  const client = createClient({ url: `file:${dbFile}` });
  await client.executeMultiple(`
    CREATE TABLE students (studentId TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE posts (id INTEGER PRIMARY KEY, content TEXT);
  `);
  client.close();

  const prevEnv = { NODE_ENV: process.env.NODE_ENV, DB_PATH: process.env.DB_PATH, SKIP: process.env.SEMESTER_DB_SKIP_INIT };
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = dbFile;
  process.env.SEMESTER_DB_SKIP_INIT = '1';
  delete require.cache[require.resolve('../db')];

  try {
    const dbMod = require('../db');
    const ready = await dbMod.verifyStartupReady();
    assert.equal(ready.ready, true);
    assert.equal(ready.mode, 'fast-check');

    const tables = await dbMod.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('class_routines', 'class_routine_slots', 'class_routine_entries')"
    );
    assert.equal(tables.length, 3);
    await dbMod.close();
  } finally {
    process.env.NODE_ENV = prevEnv.NODE_ENV;
    if (prevEnv.DB_PATH === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = prevEnv.DB_PATH;
    if (prevEnv.SKIP === undefined) delete process.env.SEMESTER_DB_SKIP_INIT;
    else process.env.SEMESTER_DB_SKIP_INIT = prevEnv.SKIP;
    delete require.cache[require.resolve('../db')];
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('16: Asia/Kathmandu timezone boundaries around midnight and UTC+05:45 offset', async () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'routine.js'), 'utf8');
  const mobileTsx = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'app', 'routine.tsx'), 'utf8');
  assert.match(js, /345 \* 60 \* 1000/);
  assert.match(mobileTsx, /345 \* 60 \* 1000/);

  const noop = () => ({ hidden: false, style: {}, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {}, addEventListener() {}, append() {}, replaceChildren() {}, querySelectorAll: () => [] });
  const sandbox = {
    document: { getElementById: noop, createElement: noop, addEventListener() {} },
    window: { addEventListener() {}, location: { search: '' } },
    location: { search: '' },
    fetch: async () => ({ ok: true, json: async () => ({ routine: null }) }),
    URLSearchParams,
    URL,
    history: { pushState() {} }
  };
  sandbox.window.window = sandbox.window;
  const fn = new Function('window', 'document', 'location', 'fetch', 'URLSearchParams', 'URL', 'history', js + '; return window.__routineHelpers;');
  const helpers = fn(sandbox.window, sandbox.document, sandbox.location, sandbox.fetch, URLSearchParams, URL, sandbox.history);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(helpers.getTodayWeekday(new Date('2026-04-12T18:14:59Z')), 'Sunday');
  assert.equal(helpers.getCurrentKathmanduMinutes(new Date('2026-04-12T18:14:59Z')), 23 * 60 + 59);
  assert.equal(helpers.getTodayWeekday(new Date('2026-04-12T18:15:00Z')), 'Monday');
  assert.equal(helpers.getCurrentKathmanduMinutes(new Date('2026-04-12T18:15:00Z')), 0);
  const sampleRoutine = {
    slots: [{ id: 1, start_time: '11:00', end_time: '11:50', label: '11:00–11:50', is_break: false }],
    entries: [{ slot_id: 1, day_of_week: 'Monday', subject_name: 'C Programming', is_empty: false }]
  };
  const live = helpers.findCurrentOrUpcoming(sampleRoutine, new Date('2026-04-13T05:15:00Z'));
  assert.equal(live.state, 'current');
  assert.equal(live.day, 'Monday');
});

test('17: Admin dashboard uses safe data attributes and event delegation (no inline JS interpolation)', () => {
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-dashboard.html'), 'utf8');
  assert.doesNotMatch(adminHtml, /onclick="openReplaceRoutineModal\(/);
  assert.match(adminHtml, /data-routine-action="replace"/);
  assert.match(adminHtml, /data-routine-session=/);
  assert.match(adminHtml, /dataset\.routineDelegated/);
});

test('18-19: Transactional replace rolls back on failure and preserves archived routines', async t => {
  const db = await createTestDb(t);
  await seedClassRoutines(db);
  const app = createTestApp(db);

  const before = await db.get(`SELECT id, status FROM class_routines WHERE semester = 1 AND status = 'published'`);
  assert.ok(before);

  const origWithTx = db.withTransaction;
  db.withTransaction = async (cb) => origWithTx(async (tx) => {
    const origRun = tx.run.bind(tx);
    let insertSlotCalls = 0;
    tx.run = async (sql, ...args) => {
      if (/INSERT INTO class_routine_slots/i.test(sql)) {
        insertSlotCalls += 1;
        if (insertSlotCalls === 2) throw new Error('Simulated DB failure mid-replace');
      }
      return origRun(sql, ...args);
    };
    return cb(tx);
  });

  const failedReplace = await dispatch(app, 'POST', `/class/admin/${before.id}/replace`, {
    academic_session: 'Failed 2084',
    archiveOld: true,
    publish: true
  }, 'admin-1');
  assert.equal(failedReplace.status, 500);

  const stillPublished = await db.get('SELECT status FROM class_routines WHERE id = ?', before.id);
  assert.equal(stillPublished.status, 'published');

  db.withTransaction = origWithTx;
  const okReplace = await dispatch(app, 'POST', `/class/admin/${before.id}/replace`, {
    academic_session: 'Baishakh–Bhadra 2084',
    archiveOld: true,
    publish: true
  }, 'admin-1');
  assert.equal(okReplace.status, 201);

  const archivedOld = await db.get('SELECT status, archived_at FROM class_routines WHERE id = ?', before.id);
  assert.equal(archivedOld.status, 'archived');
  assert.ok(archivedOld.archived_at);
});

test('20: Multi-slot Lab/Practical rendering merges consecutive blocks without merging Theory', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'routine.js'), 'utf8');
  assert.match(js, /entry\.class_type === 'Lab' \|\| entry\.class_type === 'Practical'/);
  assert.match(js, /if \(span > 1\) td\.colSpan = span;/);
  assert.match(js, /class-cell-merged/);
});

test('21-22: SWR registers /api/routine/class refresh and isolates /api/routine cache per user', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'routine.js'), 'utf8');
  const swrJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'swr.js'), 'utf8');

  assert.match(js, /endpoints:\s*\['\/api\/routine',\s*'\/api\/routine\/class'\]/);
  assert.doesNotMatch(js, /userScoped:\s*false/);
  assert.match(js, /userScoped:\s*true/);
  assert.match(swrJs, /\/\^\\\/api\\\/routine\/i.*public:\s*false/);
});
