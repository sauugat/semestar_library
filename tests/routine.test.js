const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { createTransactionAdapter } = require('../lib/db-transaction');
const { ensureRoutineSchema, validateRoutine } = require('../lib/routine');
const { migrateRoutine, previewRoutineMigration } = require('../migrations/001-routine');
const createRoutineRouter = require('../routes/routine');
const { createTools, routeQuery, formatToolResult } = require('../lib/chat-tools');

let postgresDb;
if (process.env.ROUTINE_TEST_POSTGRES === '1') {
  process.env.SEMESTER_DB_SKIP_INIT = '1';
  postgresDb = require('../db');
  if (!postgresDb.isPostgres) throw new Error('PostgreSQL tests need a configured PostgreSQL database.');
  after(() => postgresDb.close());
}

async function database(t) {
  let client, db;
  if (postgresDb) {
    client = await postgresDb.pgPool.connect();
    const schema = `routine_test_${crypto.randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    db = createTransactionAdapter(client, true);
    db.withTransaction = async callback => {
      await client.query('BEGIN');
      try { const result = await callback(db); await client.query('COMMIT'); return result; }
      catch (err) { await client.query('ROLLBACK'); throw err; }
    };
    t.after(async () => {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
      client.release();
    });
  } else {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-test-'));
    client = createClient({ url: `file:${path.join(temp, 'test.db')}` });
    db = createTransactionAdapter(client, false);
    db.withTransaction = async callback => {
      const tx = await client.transaction('write');
      try { const result = await callback(createTransactionAdapter(tx, false)); await tx.commit(); return result; }
      catch (err) { await tx.rollback(); throw err; }
      finally { tx.close(); }
    };
    t.after(() => { client.close(); fs.rmSync(temp, {recursive:true, force:true}); });
  }
  return db;
}
const exam = {semester: 2, subject_name: 'Discrete Mathematics', subject_code: 'CIT121', exam_date: '2083/05/17', calendar: 'BS', exam_time: '11:30 AM – 2:30 PM', room: '204', weekday: 'Wednesday', exam_type: 'Final Examination'};

async function legacyTable(db) {
  await db.exec('CREATE TABLE exam_schedule (id INTEGER PRIMARY KEY, subject TEXT, examDate TEXT, day TEXT, time TEXT, semester TEXT, type TEXT)');
  await db.run('INSERT INTO exam_schedule VALUES (?, ?, ?, ?, ?, ?, ?)', 4, 'Discrete Mathematics', '2083/05/17', null, 'CIT121', 'II', 'Examination');
  await db.run('INSERT INTO exam_schedule VALUES (?, ?, ?, ?, ?, ?, ?)', 9, 'Custom exam', '2026-10-01', 'Thursday', '10:00 AM', 'Semester 3', 'Practical');
}

test('migration preserves admin rows and IDs, separates codes from times, and is repeatable', async t => {
  const db = await database(t);
  await legacyTable(db);
  const preview = await previewRoutineMigration(db);
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0].subject_code, 'CIT121');
  assert.equal(preview.rows[0].exam_time, null);
  assert.equal(preview.rows[0].calendar, 'BS');
  assert.equal(preview.rows[1].calendar, null);
  assert.equal(preview.rows[1].exam_time, '10:00 AM');
  assert.equal(preview.warnings.length, 1);
  assert.equal((await migrateRoutine(db)).inserted, 2);
  const stored = await db.all('SELECT * FROM routine ORDER BY id');
  assert.deepEqual(stored.map(r => r.id), [4, 9]);
  assert.equal(stored[1].semester, 3);
  assert.equal(stored[1].weekday, 'Thursday');
  assert.equal(stored[1].exam_date, '2026/10/01');
  const newRow = await db.run('INSERT INTO routine (subject_name, semester, exam_date) VALUES (?, ?, ?)', 'New', 1, '2083/06/01');
  assert(Number(newRow.lastInsertRowid) > 9, 'generated IDs continue beyond migrated IDs');
  await db.run('DELETE FROM routine');
  assert.equal((await migrateRoutine(db)).inserted, 0, 'deleted exams are never reseeded');
  assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM routine')).count), 0);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM exam_schedule')).count), 2, 'old table remains unchanged');
});

test('fresh database imports the 18 original seeds, with no invented times', async t => {
  const db = await database(t);
  assert.equal((await migrateRoutine(db)).inserted, 18);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM routine WHERE calendar = ? AND exam_time IS NULL', 'BS')).count), 18);
  assert.equal((await migrateRoutine(db)).inserted, 0);
});

test('failed migration rolls back every inserted row and can be retried', async t => {
  const db = await database(t);
  await legacyTable(db);
  const broken = {withTransaction: callback => db.withTransaction(tx => callback({...tx, run: async (sql, ...args) => {
    if (/INSERT INTO routine/.test(sql) && args[0] === 9) throw new Error('Simulated failure');
    return tx.run(sql, ...args);
  }}))};
  await assert.rejects(migrateRoutine(broken), /Simulated failure/);
  assert.equal((await previewRoutineMigration(db)).applied, false);
  assert.equal((await migrateRoutine(db)).inserted, 2);
});

test('migration refuses to overwrite untracked target rows or silently discard invalid legacy rows', async t => {
  const db = await database(t);
  await ensureRoutineSchema(db);
  await db.run('INSERT INTO routine (subject_name, semester, exam_date) VALUES (?, ?, ?)', 'Keep me', 1, '2083/06/01');
  await assert.rejects(migrateRoutine(db), /avoid overwriting/);
  assert.equal((await db.get('SELECT subject_name FROM routine')).subject_name, 'Keep me');
  await legacyTable(db);
  await db.run('UPDATE exam_schedule SET semester = ? WHERE id = ?', 'invalid', 9);
  await assert.rejects(previewRoutineMigration(db), /Nothing was migrated/);
});

test('date and field validation distinguishes AD leap dates from BS dates', () => {
  assert.equal(validateRoutine(exam).value.calendar, 'BS');
  assert.equal(validateRoutine({...exam, exam_date:'2083/02/32'}).value.exam_date, '2083/02/32');
  assert(validateRoutine({...exam, calendar:'AD', exam_date:'2025/02/29'}).error);
  assert.equal(validateRoutine({...exam, calendar:'AD', exam_date:'2024-2-29'}).value.exam_date, '2024/02/29');
  for (const invalid of [{semester:0}, {semester:9}, {semester:'2 OR 1=1'}, {subject_name:' '}, {subject_name:'x'.repeat(251)}, {room:{}}, {calendar:'XX'}, {exam_date:'2083/13/01'}, {exam_date:'2083/01/33'}]) {
    assert(validateRoutine({...exam, ...invalid}).error);
  }
});

async function fixture(t) {
  const db = await database(t);
  await ensureRoutineSchema(db);
  await db.exec("CREATE TABLE students (studentId TEXT PRIMARY KEY, role TEXT); INSERT INTO students VALUES ('admin', 'admin'), ('student', 'student'), ('cr', 'cr');");
  let invalidations = 0;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = {studentId: req.headers['x-test-user']}; next(); });
  const requireLogin = (req, res, next) => req.session.studentId ? next() : res.status(401).json({error:'Sign in'});
  app.use('/api/routine', createRoutineRouter(db, requireLogin, {invalidateCache: () => invalidations++}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (method = 'GET', path = '', body, user) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/routine${path}`, {method, headers: {'Content-Type':'application/json', ...(user ? {'x-test-user':user} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status:response.status, body:await response.json()};
  };
  return {db, request, invalidations:()=>invalidations};
}

test('public read is allowed; every admin endpoint rejects guests, students, CRs and stale accounts', async t => {
  const {request} = await fixture(t);
  assert.equal((await request()).status, 200);
  for (const user of [undefined, 'student', 'cr', 'missing']) {
    for (const [method, path, body] of [['GET','/admin'],['POST','',{...exam,role:'admin'}],['PUT','/1',exam],['DELETE','/1']]) {
      assert.equal((await request(method,path,body,user)).status, user ? 403 : 401);
    }
  }
});

test('admin CRUD persists fields, filters all semesters, and refreshes chatbot results', async t => {
  const {db, request, invalidations} = await fixture(t);
  const created = await request('POST','',exam,'admin');
  assert.equal(created.status,201);
  assert.equal(created.body.room,'204');
  assert.equal(created.body.subject_code,'CIT121');
  assert.equal((await request('GET','/admin',undefined,'admin')).body.length,1);
  assert.equal((await request('GET','?semester=III')).body.length,0);
  assert.equal((await request('GET','?semester=II')).body.length,1);
  const edit = {...exam, subject_name:'Updated <math>', room:'105', semester:3};
  const updated=await request('PUT',`/${created.body.id}`,edit,'admin');
  assert.equal(updated.status,200);
  assert.equal(updated.body.subject_name,'Updated <math>');
  assert.equal((await request('GET','?semester=2')).body.length,0);
  const routine=await createTools(db,routeQuery('semester 3 routine')).executeTool('get_routine',{semester:2});
  assert.equal(routine.routine.length,1);
  assert.equal(routine.routine[0].room,'105');
  assert.match(formatToolResult('get_routine',routine),/BS.*Room 105/);
  assert.equal((await request('DELETE',`/${created.body.id}`,undefined,'admin')).status,200);
  assert.equal((await request()).body.length,0);
  assert.equal(invalidations(),3);
});

test('invalid IDs, missing records and malformed bodies give useful errors without writes', async t => {
  const {request} = await fixture(t);
  for (const id of ['null','undefined','0','-1','2147483648','1.1']) {
    assert.equal((await request('PUT',`/${id}`,exam,'admin')).status,400);
    assert.equal((await request('DELETE',`/${id}`,undefined,'admin')).status,400);
  }
  assert.equal((await request('PUT','/999',exam,'admin')).status,404);
  assert.equal((await request('DELETE','/999',undefined,'admin')).status,404);
  assert.equal((await request('POST','',{...exam,calendar:'XX'},'admin')).status,400);
  assert.equal((await request('POST','',{},'admin')).status,400);
  assert.equal((await request('GET','?semester=null')).status,400);
  assert.equal((await request()).body.length,0);
});

test('a database failure returns JSON and later requests still work', async t => {
  const {db,request} = await fixture(t);
  const all=db.all;
  db.all=async()=>{throw new Error('Temporary failure');};
  const failed=await request();
  assert.equal(failed.status,500);
  assert.match(failed.body.error,/try again/);
  db.all=all;
  assert.equal((await request()).status,200);
});
