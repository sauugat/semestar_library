'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const crypto = require('crypto');
const { PGlite } = require('@electric-sql/pglite');

const { createAuthMiddleware } = require('../lib/auth-middleware');
const { createResourceHandler } = require('../lib/kyana-resource-http');
const { getAcademicContext, assertContentAccess } = require('../lib/academic-context');
const { readResource, canReadResource, resourceCard } = require('../lib/kyana-access');
const { READ_ONLY_TOOLS } = require('../lib/chat-security');
const { understandRequest, executeToolCalls, synthesizeVerifiedAgentResponse } = require('../lib/kyana-agent-engine');
const { searchPyqQuestions } = require('../lib/pyq-intelligence');
const { resolveProductKnowledge } = require('../lib/kyana-product-knowledge');

const JWT_SECRET = 'phase4-audit-test-secret-key-must-be-32-chars-long!';
process.env.SUPABASE_JWT_SECRET = JWT_SECRET;

function makeJwt(payload, secret = JWT_SECRET) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

// In-memory test DB adapter
function createMockDb() {
  const files = [
    {
      id: 101,
      title: '02. Introduction to Java',
      originalName: '02_Intro_Java.pdf',
      storedName: '02_Intro_Java.pdf',
      subject: 'Computer Programming II (Java)',
      semester: 2,
      semester_no: 2,
      cohort_id: 'MERCURY',
      audience_scope: 'all_students',
      visibility: 'everyone',
      uploadedBy: 'TEA_JAVA'
    },
    {
      id: 103,
      title: '04. Computer Networks Note',
      originalName: '04_Networks.pdf',
      storedName: '04_Networks.pdf',
      subject: 'Computer Networks',
      semester: 4,
      semester_no: 4,
      cohort_id: 'VENUS',
      audience_scope: 'all_students',
      visibility: 'everyone',
      uploadedBy: 'TEA_NET'
    },
    {
      id: 104,
      title: 'Faculty Solution Manual - Java',
      originalName: 'Java_Faculty_Manual.pdf',
      storedName: 'Java_Faculty_Manual.pdf',
      subject: 'Computer Programming II (Java)',
      semester: 2,
      semester_no: 2,
      cohort_id: 'MERCURY',
      audience_scope: 'teachers_only',
      visibility: 'teachers_only',
      uploadedBy: 'TEA_JAVA'
    },
    {
      id: 107,
      title: 'Confidential Teacher Draft - Java',
      originalName: 'Java_Confidential_Draft.pdf',
      storedName: 'Java_Confidential_Draft.pdf',
      subject: 'Computer Programming II (Java)',
      semester: 2,
      semester_no: 2,
      cohort_id: 'MERCURY',
      audience_scope: 'private',
      visibility: 'private',
      uploadedBy: 'TEA_JAVA'
    },
    {
      id: 108,
      title: '01. Propositional Logic',
      originalName: '01_Logic.pdf',
      storedName: '01_Logic.pdf',
      subject: 'Discrete Mathematics',
      semester: 2,
      semester_no: 2,
      cohort_id: 'MERCURY',
      audience_scope: 'all_students',
      visibility: 'everyone',
      uploadedBy: 'TEA_MATH'
    }
  ];

  const students = [
    {
      studentId: 'STU_SEM2',
      username: 'student_sem2',
      name: 'Alice Student',
      role: 'student',
      semester: 2,
      cohort_id: 'MERCURY',
      supabase_uid: 'uid-student-sem2',
      email: 'alice@gandaki.edu.np',
      account_status: 'active'
    },
    {
      studentId: 'TEA_JAVA',
      username: 'teacher_java',
      name: 'Dr. Java Teacher',
      role: 'teacher',
      semester: null,
      cohort_id: null,
      supabase_uid: 'uid-teacher-java',
      email: 'javateacher@gandaki.edu.np',
      account_status: 'active',
      assignedSemesters: [2],
      assignedSubjects: ['Computer Programming II (Java)'],
      teacherSemesters: [2],
      teacherSubjectAliases: ['computer programming ii (java)', 'java', 'programming in java']
    },
    {
      studentId: 'ADMIN_USER',
      username: 'admin_master',
      name: 'Super Admin',
      role: 'admin',
      semester: null,
      cohort_id: null,
      supabase_uid: 'uid-admin-master',
      email: 'admin@gandaki.edu.np',
      account_status: 'active'
    }
  ];

  const noteChunks = [
    {
      chunk_id: 1011,
      file_id: 101,
      page_number: 12,
      topic_title: 'Java as Platform Independent Language',
      unit_number: 2,
      chunk_text: 'Java is platform independent because bytecode executes on any standard JVM.'
    },
    {
      chunk_id: 1012,
      file_id: 101,
      page_number: 13,
      topic_title: 'JVM and Bytecode Portability',
      unit_number: 2,
      chunk_text: 'Write once, run anywhere principle of platform independence.'
    }
  ];

  return {
    files,
    students,
    noteChunks,
    async get(sql, ...params) {
      const lower = sql.toLowerCase();
      if (lower.includes('from students') && lower.includes('supabase_uid = ?')) {
        const uid = params[0];
        return students.find(s => s.supabase_uid === uid) || null;
      }
      if (lower.includes('from students') && lower.includes('studentid = ?')) {
        const sid = params[0];
        return students.find(s => s.studentId === sid) || null;
      }
      if (lower.includes('from files') && lower.includes('id = ?')) {
        const fid = Number(params[0]);
        return files.find(f => f.id === fid) || null;
      }
      if (lower.includes('from teacher_subjects')) {
        return null;
      }
      return null;
    },
    async all(sql, ...params) {
      const lower = sql.toLowerCase();
      if (lower.includes('from teacher_subjects')) {
        return [];
      }
      if (lower.includes('from post_target_semesters')) {
        return [];
      }
      if (lower.includes('from files')) {
        return files;
      }
      if (lower.includes('from note_chunks')) {
        return noteChunks;
      }
      return [];
    },
    async run() {
      return { changes: 1 };
    }
  };
}

test('KYANA Phase 4: Production Readiness Audit', async (t) => {
  const db = createMockDb();
  let server;
  let baseUrl;

  // Set up Express test harness using REAL middleware and routes
  const app = express();
  app.use(express.json());

  // 1. Auth middleware from lib/auth-middleware.js
  const authMiddleware = createAuthMiddleware(db);
  app.use(async (req, res, next) => {
    try {
      await authMiddleware.authenticate(req, res, () => {});
      next();
    } catch (e) {
      next(e);
    }
  });

  // 2. Production requireLogin implementation mirroring server.js
  function requireLogin(req, res, next) {
    if (req.user && req.user.studentId) {
      req.student = req.user;
      return next();
    }
    return res.status(401).json({ message: 'Authentication required. Please sign in.' });
  }

  // 3. Mount /api/ai/resources/:type/:id/open exactly as in server.js:7527
  app.get('/api/ai/resources/:type/:id/open', requireLogin, createResourceHandler(db));

  // 4. Mount /api/files/:id/view exactly as in server.js:4379
  app.get('/api/files/:id/view', requireLogin, async (req, res) => {
    const [file, context] = await Promise.all([
      db.get('SELECT * FROM files WHERE id = ?', req.params.id),
      getAcademicContext(db, req)
    ]);

    if (!file || !assertContentAccess(context, file)) {
      return res.status(404).json({ message: 'File not found' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
    return res.status(200).send(`%PDF-1.4 binary content for file ${file.id}`);
  });

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  t.after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  // Generate test tokens
  const studentToken = makeJwt({
    sub: 'uid-student-sem2',
    email: 'alice@gandaki.edu.np',
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  });

  const teacherToken = makeJwt({
    sub: 'uid-teacher-java',
    email: 'javateacher@gandaki.edu.np',
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  });

  const adminToken = makeJwt({
    sub: 'uid-admin-master',
    email: 'admin@gandaki.edu.np',
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  });

  const expiredToken = makeJwt({
    sub: 'uid-student-sem2',
    email: 'alice@gandaki.edu.np',
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    iat: Math.floor(Date.now() / 1000) - 7200
  });

  const malformedToken = 'invalid.bearer.token.garbage';

  // ────────────────────────────────────────────────────────────────────────
  // SECTION 1: AUTHENTICATION TESTING
  // ────────────────────────────────────────────────────────────────────────
  await t.test('Section 1 — Authentication testing on both resource endpoints', async (st) => {
    await st.test('1.1. No authentication token returns 401 on /api/files/:id/view', async () => {
      const res = await fetch(`${baseUrl}/api/files/101/view`);
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.match(body.message, /authentication required/i);
    });

    await st.test('1.2. No authentication token returns 401 on /api/ai/resources/:type/:id/open', async () => {
      const res = await fetch(`${baseUrl}/api/ai/resources/note/101/open`, { redirect: 'manual' });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.match(body.message, /authentication required/i);
    });

    await st.test('1.3. Malformed token returns 401 on /api/files/:id/view', async () => {
      const res = await fetch(`${baseUrl}/api/files/101/view`, {
        headers: { Authorization: `Bearer ${malformedToken}` }
      });
      assert.equal(res.status, 401);
    });

    await st.test('1.4. Malformed token returns 401 on /api/ai/resources/:type/:id/open', async () => {
      const res = await fetch(`${baseUrl}/api/ai/resources/note/101/open`, {
        headers: { Authorization: `Bearer ${malformedToken}` },
        redirect: 'manual'
      });
      assert.equal(res.status, 401);
    });

    await st.test('1.5. Expired token returns 401 on /api/files/:id/view', async () => {
      const res = await fetch(`${baseUrl}/api/files/101/view`, {
        headers: { Authorization: `Bearer ${expiredToken}` }
      });
      assert.equal(res.status, 401);
    });

    await st.test('1.6. Expired token returns 401 on /api/ai/resources/:type/:id/open', async () => {
      const res = await fetch(`${baseUrl}/api/ai/resources/note/101/open`, {
        headers: { Authorization: `Bearer ${expiredToken}` },
        redirect: 'manual'
      });
      assert.equal(res.status, 401);
    });

    await st.test('1.7. Valid student token passes authentication and allows own semester note', async () => {
      const res = await fetch(`${baseUrl}/api/files/101/view`, {
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type').startsWith('application/pdf'));
    });

    await st.test('1.8. Valid teacher token passes authentication and allows assigned subject note', async () => {
      const res = await fetch(`${baseUrl}/api/files/101/view`, {
        headers: { Authorization: `Bearer ${teacherToken}` }
      });
      assert.equal(res.status, 200);
    });

    await st.test('1.9. Valid admin token passes authentication and allows any note', async () => {
      const res = await fetch(`${baseUrl}/api/files/104/view`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.status, 200);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // SECTION 2: AUTHORIZATION MATRIX
  // ────────────────────────────────────────────────────────────────────────
  await t.test('Section 2 — Authorization Matrix across direct and redirect access', async (st) => {
    // 1. Student requesting own semester note (ID 101, Sem 2) -> Allowed
    await st.test('2.1. Student: Own semester note -> Allowed (direct 200, open 302)', async () => {
      const direct = await fetch(`${baseUrl}/api/files/101/view`, {
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(direct.status, 200);

      const open = await fetch(`${baseUrl}/api/ai/resources/note/101/open?page=12`, {
        headers: { Authorization: `Bearer ${studentToken}` },
        redirect: 'manual'
      });
      assert.equal(open.status, 302);
      assert.equal(open.headers.get('location'), '/api/files/101/view#page=12');
    });

    // 2. Student requesting different restricted semester note (ID 103, Sem 4) -> Denied (404)
    await st.test('2.2. Student: Different restricted semester note -> Denied (direct 404, open 404)', async () => {
      const direct = await fetch(`${baseUrl}/api/files/103/view`, {
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(direct.status, 404);

      const open = await fetch(`${baseUrl}/api/ai/resources/note/103/open`, {
        headers: { Authorization: `Bearer ${studentToken}` },
        redirect: 'manual'
      });
      assert.equal(open.status, 404);
      assert.equal(open.headers.get('location'), null, 'Must NEVER set Location redirect on 404');
    });

    // 3. Student requesting teachers_only note (ID 104, Sem 2) -> Denied (404)
    await st.test('2.3. Student: teachers_only note -> Denied (direct 404, open 404)', async () => {
      const direct = await fetch(`${baseUrl}/api/files/104/view`, {
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(direct.status, 404);

      const open = await fetch(`${baseUrl}/api/ai/resources/note/104/open`, {
        headers: { Authorization: `Bearer ${studentToken}` },
        redirect: 'manual'
      });
      assert.equal(open.status, 404);
      assert.equal(open.headers.get('location'), null);
    });

    // 4. Student requesting private note (ID 107, Sem 2) -> Denied (404)
    await st.test('2.4. Student: private note -> Denied (direct 404, open 404)', async () => {
      const direct = await fetch(`${baseUrl}/api/files/107/view`, {
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(direct.status, 404);

      const open = await fetch(`${baseUrl}/api/ai/resources/note/107/open`, {
        headers: { Authorization: `Bearer ${studentToken}` },
        redirect: 'manual'
      });
      assert.equal(open.status, 404);
      assert.equal(open.headers.get('location'), null);
    });

    // 5. Teacher requesting assigned subject note (ID 101, Java) -> Allowed
    await st.test('2.5. Teacher: Assigned subject note -> Allowed (direct 200, open 302)', async () => {
      const direct = await fetch(`${baseUrl}/api/files/101/view`, {
        headers: { Authorization: `Bearer ${teacherToken}` }
      });
      assert.equal(direct.status, 200);

      const open = await fetch(`${baseUrl}/api/ai/resources/note/101/open`, {
        headers: { Authorization: `Bearer ${teacherToken}` },
        redirect: 'manual'
      });
      assert.equal(open.status, 302);
      assert.equal(open.headers.get('location'), '/api/files/101/view');
    });

    // 6. Teacher requesting unassigned subject note (ID 108, Discrete Math) -> Denied (404)
    await st.test('2.6. Teacher: Unassigned subject note -> Denied (direct 404, open 404)', async () => {
      const direct = await fetch(`${baseUrl}/api/files/108/view`, {
        headers: { Authorization: `Bearer ${teacherToken}` }
      });
      assert.equal(direct.status, 404);

      const open = await fetch(`${baseUrl}/api/ai/resources/note/108/open`, {
        headers: { Authorization: `Bearer ${teacherToken}` },
        redirect: 'manual'
      });
      assert.equal(open.status, 404);
      assert.equal(open.headers.get('location'), null);
    });

    // 7. Teacher with valid assignment in req.user and empty DB lookup -> Correctly evaluated
    await st.test('2.7. Teacher: Valid assignment in req.user with empty DB lookup correctly evaluated', async () => {
      const context = await getAcademicContext(db, {
        user: {
          studentId: 'TEA_JAVA',
          role: 'teacher',
          assignedSemesters: [2],
          assignedSubjects: ['Computer Programming II (Java)'],
          teacherSubjectAliases: ['computer programming ii (java)', 'java']
        }
      });
      assert.deepEqual(context.assignedSemesters, [2]);
      assert.deepEqual(context.assignedSubjects, ['Computer Programming II (Java)']);

      // Allowed for Java note 101
      const note101 = await db.get('SELECT * FROM files WHERE id = ?', 101);
      assert.equal(assertContentAccess(context, note101), true);

      // Denied for Discrete Math note 108
      const note108 = await db.get('SELECT * FROM files WHERE id = ?', 108);
      assert.equal(assertContentAccess(context, note108), false);
    });

    // 8. Unauthenticated requesting protected resource -> Denied (401)
    await st.test('2.8. Unauthenticated: Any protected resource -> Denied (401)', async () => {
      const direct = await fetch(`${baseUrl}/api/files/101/view`);
      assert.equal(direct.status, 401);

      const open = await fetch(`${baseUrl}/api/ai/resources/note/101/open`, { redirect: 'manual' });
      assert.equal(open.status, 401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // SECTION 3: FILE CONFIDENTIALITY & ZERO LEAK INSPECTION
  // ────────────────────────────────────────────────────────────────────────
  await t.test('Section 3 — File Confidentiality & Zero Leak Inspection on Denials', async (st) => {
    const deniedUrls = [
      { name: 'Direct Sem 4 file view as Sem 2 student', url: `${baseUrl}/api/files/103/view`, token: studentToken },
      { name: 'Direct teachers_only file view as student', url: `${baseUrl}/api/files/104/view`, token: studentToken },
      { name: 'Direct private file view as student', url: `${baseUrl}/api/files/107/view`, token: studentToken },
      { name: 'Open redirect Sem 4 note as Sem 2 student', url: `${baseUrl}/api/ai/resources/note/103/open`, token: studentToken },
      { name: 'Open redirect teachers_only note as student', url: `${baseUrl}/api/ai/resources/note/104/open`, token: studentToken },
      { name: 'Direct unassigned subject file view as teacher', url: `${baseUrl}/api/files/108/view`, token: teacherToken },
      { name: 'Open redirect unassigned subject note as teacher', url: `${baseUrl}/api/ai/resources/note/108/open`, token: teacherToken },
      { name: 'Direct file view unauthenticated', url: `${baseUrl}/api/files/101/view`, token: null },
      { name: 'Open redirect unauthenticated', url: `${baseUrl}/api/ai/resources/note/101/open`, token: null }
    ];

    for (const item of deniedUrls) {
      await st.test(`Confidentiality Check: ${item.name}`, async () => {
        const headers = item.token ? { Authorization: `Bearer ${item.token}` } : {};
        const res = await fetch(item.url, { headers, redirect: 'manual' });

        assert.ok([401, 404].includes(res.status), `Must return 401 or 404, got ${res.status}`);

        // 1. Response body inspection
        const bodyText = await res.text();
        assert.ok(!bodyText.includes('%PDF-1.4'), 'Must NEVER disclose binary PDF bytes');
        assert.ok(!bodyText.includes('storage/v1/object/public'), 'Must NEVER disclose Supabase storage bucket URLs');
        assert.ok(!bodyText.includes('library_files/'), 'Must NEVER disclose internal storage folder structure');
        assert.ok(!bodyText.includes('token='), 'Must NEVER disclose signed URL tokens');
        assert.ok(!bodyText.includes('/uploads/'), 'Must NEVER disclose local file upload paths');

        // 2. Response headers inspection
        assert.equal(res.headers.get('location'), null, 'Location header must be NULL on access denial');

        // 3. Response JSON inspection
        let bodyJson = null;
        try { bodyJson = JSON.parse(bodyText); } catch (_) {}
        assert.ok(bodyJson !== null, 'Response body must be clean JSON');
        assert.ok(bodyJson.message || bodyJson.error, 'Must contain a clean user-facing error message');
      });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // SECTION 4: TOOL SECURITY & READ-ONLY INTEGRITY
  // ────────────────────────────────────────────────────────────────────────
  await t.test('Section 4 — Tool Security: search_pyqs and get_product_knowledge', async (st) => {
    await st.test('4.1. Both tools are registered in READ_ONLY_TOOLS set', () => {
      assert.ok(READ_ONLY_TOOLS.has('search_pyqs'), 'search_pyqs must be in READ_ONLY_TOOLS');
      assert.ok(READ_ONLY_TOOLS.has('get_product_knowledge'), 'get_product_knowledge must be in READ_ONLY_TOOLS');
    });

    await st.test('4.2. get_product_knowledge executes in-memory without side effects', () => {
      const res = resolveProductKnowledge('what is the full form of kyana', {
        academicContext: { studentId: 'STU_SEM2', role: 'student' }
      });
      assert.ok(res);
      const text = res.answer || res.reply || res.factSheet || '';
      assert.match(text, /Knowledge Yielding Academic Navigation Assistant/i);
      assert.equal(res.primaryTopic, 'kyana_identity');
    });

    await st.test('4.3. search_pyqs executes read-only SELECT and does not execute writes', async () => {
      let executedWrite = false;
      const readOnlySpyDb = {
        async all(sql) {
          if (/INSERT|UPDATE|DELETE|DROP|ALTER/i.test(sql)) {
            executedWrite = true;
          }
          return [];
        }
      };
      await searchPyqQuestions(readOnlySpyDb, { query: 'database normalization', limit: 5 });
      assert.equal(executedWrite, false, 'searchPyqQuestions must NEVER execute write queries');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // SECTION 5: POSTGRESQL PARITY TESTING (ISOLATED REAL POSTGRESQL ENGINE)
  // ────────────────────────────────────────────────────────────────────────
  await t.test('Section 5 — PostgreSQL Parity Verification using isolated PGlite', async (st) => {
    const pg = new PGlite();

    // Create real PostgreSQL tables matching production schemas
    await pg.exec(`
      CREATE TABLE files (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        original_name TEXT,
        stored_name TEXT,
        subject TEXT,
        semester INTEGER,
        semester_no INTEGER,
        cohort_id TEXT,
        audience_scope TEXT DEFAULT 'all_students',
        visibility TEXT DEFAULT 'everyone',
        uploaded_by TEXT
      );

      CREATE TABLE students (
        student_id TEXT PRIMARY KEY,
        username TEXT,
        name TEXT,
        role TEXT,
        department TEXT,
        semester INTEGER,
        cohort_id TEXT,
        email TEXT,
        account_status TEXT DEFAULT 'active'
      );

      CREATE TABLE cohorts (
        id TEXT PRIMARY KEY,
        slot_code TEXT,
        display_name TEXT,
        current_semester INTEGER,
        status TEXT DEFAULT 'active'
      );

      INSERT INTO cohorts (id, slot_code, display_name, current_semester, status)
      VALUES ('MERCURY', 'mercury', 'Mercury (Semester 2)', 2, 'active');

      INSERT INTO files (id, title, original_name, stored_name, subject, semester, semester_no, cohort_id, audience_scope, visibility, uploaded_by)
      VALUES
        (101, '02. Introduction to Java', '02_Intro_Java.pdf', '02_Intro_Java.pdf', 'Computer Programming II (Java)', 2, 2, 'MERCURY', 'all_students', 'everyone', 'TEA_JAVA'),
        (103, '04. Computer Networks', '04_Networks.pdf', '04_Networks.pdf', 'Computer Networks', 4, 4, 'VENUS', 'all_students', 'everyone', 'TEA_NET'),
        (104, 'Faculty Solution Manual - Java', 'Faculty_Manual.pdf', 'Faculty_Manual.pdf', 'Computer Programming II (Java)', 2, 2, 'MERCURY', 'teachers_only', 'teachers_only', 'TEA_JAVA');

      INSERT INTO students (student_id, username, name, role, department, semester, cohort_id, email, account_status)
      VALUES
        ('STU_SEM2', 'student_sem2', 'Alice Student', 'student', 'BIT', 2, 'MERCURY', 'alice@gandaki.edu.np', 'active'),
        ('TEA_JAVA', 'teacher_java', 'Dr. Java Teacher', 'teacher', 'BIT', NULL, NULL, 'javateacher@gandaki.edu.np', 'active');
    `);

    // Helper formatRow mimicking db.js
    function formatPgRow(r) {
      if (!r) return null;
      const copy = { ...r };
      if (r.student_id) copy.studentId = r.student_id;
      if (r.original_name) copy.originalName = r.original_name;
      if (r.stored_name) copy.storedName = r.stored_name;
      if (r.uploaded_by) copy.uploadedBy = r.uploaded_by;
      if (r.cohort_id) copy.cohortId = r.cohort_id;
      return copy;
    }

    const pgAdapter = {
      isPostgres: true,
      async get(sql, ...params) {
        let idx = 1;
        const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
        const res = await pg.query(pgSql, params);
        return formatPgRow(res.rows[0]);
      },
      async all(sql, ...params) {
        let idx = 1;
        const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
        const res = await pg.query(pgSql, params);
        return res.rows.map(formatPgRow);
      },
      async run(sql, ...params) {
        let idx = 1;
        const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
        const res = await pg.query(pgSql, params);
        return { changes: res.affectedRows || 0 };
      }
    };

    await st.test('5.1. PostgreSQL queries resolve files and students correctly with $1, $2 placeholders', async () => {
      const file = await pgAdapter.get('SELECT * FROM files WHERE id = ?', 101);
      assert.ok(file);
      assert.equal(file.title, '02. Introduction to Java');
      assert.equal(file.semester_no, 2);

      const stu = await pgAdapter.get('SELECT * FROM students WHERE student_id = ?', 'STU_SEM2');
      assert.ok(stu);
      assert.equal(stu.name, 'Alice Student');
    });

    await st.test('5.2. PostgreSQL authoritative access evaluation preserves semester and teacher isolation', async () => {
      const studentContext = {
        authenticated: true,
        studentId: 'STU_SEM2',
        role: 'student',
        semester: 2,
        currentSemester: 2,
        cohort: { id: 'MERCURY', currentSemester: 2 },
        cohortId: 'MERCURY'
      };

      const note101 = await pgAdapter.get('SELECT * FROM files WHERE id = ?', 101);
      assert.equal(assertContentAccess(studentContext, note101), true);

      const note103 = await pgAdapter.get('SELECT * FROM files WHERE id = ?', 103);
      assert.equal(assertContentAccess(studentContext, note103), false);

      const note104 = await pgAdapter.get('SELECT * FROM files WHERE id = ?', 104);
      assert.equal(assertContentAccess(studentContext, note104), false);
    });

    await pg.close();
  });

  // ────────────────────────────────────────────────────────────────────────
  // SECTION 6: EXACT RESOURCE NAVIGATION END-TO-END TRACE
  // ────────────────────────────────────────────────────────────────────────
  await t.test('Section 6 — Exact Resource Navigation: "02. Introduction to Java", ID 101, page 12', async (st) => {
    const q = 'find me note with java as platform independent topic';
    const understanding = understandRequest(q, [], null, {});

    await st.test('6.1. Retrieval returns the correct parent document', () => {
      assert.equal(understanding.isExplicitResourceSearch, true);
      assert.equal(understanding.explicitResourceType, 'note');
      assert.match(understanding.rawMessage, /java as platform independent topic/i);
    });

    await st.test('6.2. Resource card contains correct parent resource ID 101 and metadata', () => {
      const parentRow = db.files.find(f => f.id === 101);
      const card = resourceCard('note', parentRow);

      assert.equal(card.id, 101);
      assert.equal(card.title, '02. Introduction to Java');
      assert.equal(card.type, 'note');
      assert.equal(card.subject, 'Computer Programming II (Java)');
      assert.equal(card.semester, 'Semester 2');
    });

    await st.test('6.3. Web redirect accurately navigates to /api/files/101/view#page=12', async () => {
      const res = await fetch(`${baseUrl}/api/ai/resources/note/101/open?page=12`, {
        headers: { Authorization: `Bearer ${studentToken}` },
        redirect: 'manual'
      });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/api/files/101/view#page=12');
    });

    await st.test('6.4. Missing page metadata falls back safely to /api/files/101/view without fragment', async () => {
      const res = await fetch(`${baseUrl}/api/ai/resources/note/101/open`, {
        headers: { Authorization: `Bearer ${studentToken}` },
        redirect: 'manual'
      });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/api/files/101/view');
    });

    await st.test('6.5. Mobile navigation metadata provides correct routes with and without page', async () => {
      // With page parameter
      const resPage = await fetch(`${baseUrl}/api/ai/resources/note/101/open?format=json&page=12`, {
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(resPage.status, 200);
      const cardPage = await resPage.json();
      assert.equal(cardPage.mobileRoute, '/material/101?page=12');
      assert.deepEqual(cardPage.mobileParams, { id: 101, page: 12 });

      // Fallback without page parameter
      const resNoPage = await fetch(`${baseUrl}/api/ai/resources/note/101/open?format=json`, {
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(resNoPage.status, 200);
      const cardNoPage = await resNoPage.json();
      assert.equal(cardNoPage.mobileRoute, '/material/101');
      assert.deepEqual(cardNoPage.mobileParams, { id: 101 });
    });
  });
});
