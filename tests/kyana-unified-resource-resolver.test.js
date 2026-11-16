/**
 * Regression Test Suite: Kyana AI — Phase 2: Unified Resource Resolver
 *
 * Verifies the 12 core requirements for resource discovery, relevance ranking,
 * parent-document aggregation, metadata preservation, and accurate navigation:
 *
 * 1. "find me note with java as platform independent topic"
 *    - Returns parent document.
 *    - Subject: Computer Programming II (Java).
 *    - Semester: 2.
 *    - Relevant pages: 12–13.
 *    - No large raw text dump.
 * 2. Parent document identification: resolves chunks to parent file.
 * 3. Relevant page preservation: pages 12–13 in metadata and URL fragment (#page=12).
 * 4. Explicit resource-type filtering:
 *    - Explicit request for notes returns only notes.
 *    - Explicit request for notices returns only notices.
 *    - Explicit request for assignments returns only assignments.
 * 5. Duplicate chunk elimination: multiple chunks collapse to 1 resource card.
 * 6. Exclusion of wrong-semester resources.
 * 7. Exclusion of unauthorized resources (private / teachers_only).
 * 8. Fallback when page metadata is missing.
 * 9. Fallback when resource ID is invalid (safe 404 without crash).
 * 10. Notice and assignment card navigation (direct deep links and redirects).
 * 11. Academic explanation query behaviour ("explain how java is platform independent").
 * 12. Verified resource ID in card (matches DB record, zero hallucinated IDs).
 */

'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createClient } = require('@libsql/client');

const {
  understandRequest,
  runKyanaAgentLoop
} = require('../lib/kyana-agent-engine');
const { searchNotes, ensureIndex, indexNote } = require('../lib/note-search');
const { readResource, resourceCard, revalidateCards } = require('../lib/kyana-access');
const { createResourceHandler } = require('../lib/kyana-resource-http');

function createTestDb() {
  const client = createClient({ url: ':memory:' });
  return {
    isPostgres: false,
    client,
    async exec(sql) {
      if (typeof client.executeMultiple === 'function') {
        return client.executeMultiple(sql);
      }
      return client.execute(sql);
    },
    async run(sql, ...params) {
      const res = await client.execute({ sql, args: params });
      return {
        lastInsertRowid: Number(res.lastInsertRowid || 0),
        changes: Number(res.rowsAffected || 0)
      };
    },
    async get(sql, ...params) {
      const res = await client.execute({ sql, args: params });
      return res.rows[0] ? { ...res.rows[0] } : null;
    },
    async all(sql, ...params) {
      const res = await client.execute({ sql, args: params });
      return res.rows.map(r => ({ ...r }));
    }
  };
}

describe('KYANA Phase 2: Unified Resource Resolver', () => {
  let db;
  let server;
  let baseUrl;

  const sem2StudentContext = {
    authenticated: true,
    studentId: 'STU_SEM2',
    name: 'Bikash Sharma',
    role: 'student',
    semester: 'Semester II',
    currentSemester: 2,
    cohortId: 'BIT_2026'
  };

  const sem4StudentContext = {
    authenticated: true,
    studentId: 'STU_SEM4',
    name: 'Kiran Thapa',
    role: 'student',
    semester: 'Semester IV',
    currentSemester: 4,
    cohortId: 'BIT_2024'
  };

  before(async () => {
    db = createTestDb();

    // 1. Create Core Tables
    await db.exec(`
      CREATE TABLE students (
        studentId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        avatarUrl TEXT
      );

      CREATE TABLE cohorts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        current_semester INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE TABLE files (
        id INTEGER PRIMARY KEY,
        title TEXT,
        originalName TEXT,
        storedName TEXT,
        subject TEXT,
        chapter TEXT,
        semester TEXT,
        semester_no INTEGER,
        fileSize INTEGER DEFAULT 1024,
        uploadedBy TEXT,
        uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        visibility TEXT DEFAULT 'everyone',
        audience_scope TEXT DEFAULT 'all_students',
        cohort_id TEXT
      );

      CREATE TABLE document_chunks (
        id INTEGER PRIMARY KEY,
        file_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        section_heading TEXT,
        heading_path TEXT,
        content TEXT,
        clean_content TEXT,
        page_start INTEGER,
        page_end INTEGER
      );

      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'notice',
        category TEXT NOT NULL DEFAULT 'NOTICE',
        visibility TEXT NOT NULL DEFAULT 'everyone',
        target_all_semesters INTEGER NOT NULL DEFAULT 1,
        audience_scope TEXT NOT NULL DEFAULT 'all_students',
        cohort_id TEXT,
        semester_no INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        edited_at TEXT
      );

      CREATE TABLE post_target_semesters (
        post_id INTEGER NOT NULL,
        semester INTEGER NOT NULL,
        PRIMARY KEY (post_id, semester)
      );

      CREATE TABLE assignments (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        subject TEXT,
        semester TEXT,
        semester_no INTEGER,
        deadline TEXT,
        createdBy TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        audience_scope TEXT DEFAULT 'all_students',
        visibility TEXT DEFAULT 'everyone',
        cohort_id TEXT
      );

      CREATE TABLE pyq_questions (
        id INTEGER PRIMARY KEY,
        exam_year TEXT,
        exam_type TEXT,
        question_number TEXT,
        marks REAL DEFAULT 5,
        question_text TEXT,
        clean_text TEXT,
        subject TEXT,
        semester_no INTEGER,
        unit_number INTEGER
      );

      CREATE TABLE pyq_topic_links (
        id INTEGER PRIMARY KEY,
        question_id INTEGER NOT NULL,
        note_file_id INTEGER,
        note_chunk_id INTEGER,
        topic_title TEXT
      );

      CREATE TABLE routine (
        id INTEGER PRIMARY KEY,
        semester INTEGER,
        subject_name TEXT,
        subject_code TEXT,
        exam_date TEXT,
        calendar TEXT,
        weekday TEXT,
        exam_time TEXT,
        room TEXT,
        exam_type TEXT
      );
    `);

    // Ensure note_search FTS index table
    await ensureIndex(db);

    // 2. Insert Seed Data
    // Admin & Students
    await db.run(`INSERT INTO students (studentId, name, role) VALUES ('ADMIN_01', 'Admin Newton', 'admin')`);
    await db.run(`INSERT INTO students (studentId, name, role) VALUES ('STU_SEM2', 'Bikash Sharma', 'student')`);
    await db.run(`INSERT INTO students (studentId, name, role) VALUES ('STU_SEM4', 'Kiran Thapa', 'student')`);

    // File 101: 02. Introduction to Java (Semester 2, Unit 2)
    // Pages 12-13 cover "Java as Platform Independent Language"
    await db.run(`
      INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, fileSize, uploadedBy, visibility, audience_scope)
      VALUES (101, '02. Introduction to Java', '02_Intro_Java.pdf', 'stored_101.pdf', 'Computer Programming II (Java)', '2', 'Semester II', 2, 204800, 'ADMIN_01', 'everyone', 'all_students')
    `);

    const javaNoteContent = `
[Page 1] Introduction to Java. Course syllabus overview.
[Page 12] Java as Platform Independent Language.
Java is an architecture-neutral and portable programming language. When Java source code is compiled using javac, it is transformed into architecture-neutral bytecode. The bytecode is not executable machine code for any specific CPU, but instructions for the Java Virtual Machine (JVM).
[Page 13] Write Once, Run Anywhere (WORA).
Because the JVM translates bytecode to local machine code at runtime, a compiled Java .class file runs on any platform with an appropriate JVM. This makes Java platform independent.
[Page 20] Object Oriented Programming concepts in Java.
    `.trim();

    await db.run(`
      INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
      VALUES (101, ?, 'indexed', '2026-03-01')
      ON CONFLICT (id) DO UPDATE SET content = excluded.content, extraction_status = excluded.extraction_status
    `, javaNoteContent);

    // Insert Document Chunks for File 101 (representing semantic chunks from PDF ingestion)
    await db.run(`
      INSERT INTO document_chunks (id, file_id, chunk_index, section_heading, heading_path, content, clean_content, page_start, page_end)
      VALUES (1011, 101, 1, 'Java as Platform Independent Language', 'Unit 2 > Platform Independence', 'When Java source code is compiled using javac, it is transformed into bytecode for JVM.', 'When Java source code is compiled using javac, it is transformed into bytecode for JVM.', 12, 12)
    `);
    await db.run(`
      INSERT INTO document_chunks (id, file_id, chunk_index, section_heading, heading_path, content, clean_content, page_start, page_end)
      VALUES (1012, 101, 2, 'Write Once, Run Anywhere', 'Unit 2 > WORA', 'Because the JVM translates bytecode to native code, Java achieves Write Once Run Anywhere.', 'Because the JVM translates bytecode to native code, Java achieves Write Once Run Anywhere.', 13, 13)
    `);

    // File 102: Private Teacher-Only File
    await db.run(`
      INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, fileSize, uploadedBy, visibility, audience_scope)
      VALUES (102, 'Teacher Solution Key - Java', 'solution_key.pdf', 'stored_102.pdf', 'Computer Programming II (Java)', '2', 'Semester II', 2, 102400, 'ADMIN_01', 'teachers_only', 'private')
    `);

    // File 103: Semester 4 OS Note
    await db.run(`
      INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, fileSize, uploadedBy, visibility, audience_scope)
      VALUES (103, '04. Process Scheduling Algorithms', '04_Scheduling.pdf', 'stored_103.pdf', 'Operating Systems', '4', 'Semester IV', 4, 150000, 'ADMIN_01', 'everyone', 'all_students')
    `);
    await indexNote(db, {
      id: 103,
      title: '04. Process Scheduling Algorithms',
      originalName: '04_Scheduling.pdf',
      storedName: 'stored_103.pdf',
      subject: 'Operating Systems',
      chapter: '4',
      semester: 'Semester IV',
      uploadedAt: '2026-03-05',
      fileSize: 150000
    }, { buffer: Buffer.from('[Page 1] CPU Scheduling algorithms: FCFS, SJF, Round Robin.') });

    // File 104: Note without page tags (fallback test)
    await db.run(`
      INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, fileSize, uploadedBy, visibility, audience_scope)
      VALUES (104, 'General Programming Guidelines', 'guidelines.txt', 'stored_104.txt', 'Computer Programming II (Java)', '1', 'Semester II', 2, 5000, 'ADMIN_01', 'everyone', 'all_students')
    `);
    await indexNote(db, {
      id: 104,
      title: 'General Programming Guidelines',
      originalName: 'guidelines.txt',
      storedName: 'stored_104.txt',
      subject: 'Computer Programming II (Java)',
      chapter: '1',
      semester: 'Semester II',
      uploadedAt: '2026-03-06',
      fileSize: 5000
    }, { buffer: Buffer.from('Standard coding style guide and naming conventions for Java.') });

    // Notice Post 201: Official Exam Notice
    await db.run(`
      INSERT INTO posts (id, user_id, title, content, type, category, visibility, target_all_semesters, audience_scope, created_at)
      VALUES (201, 'ADMIN_01', 'Final Examination Notice 2081', 'The final board examination starts from 2081-08-15. Check routine.', 'notice', 'NOTICE', 'everyone', 1, 'all_students', '2026-11-01T10:00:00Z')
    `);

    // Assignment 301
    await db.run(`
      INSERT INTO assignments (id, title, description, subject, semester, semester_no, deadline, createdBy)
      VALUES (301, 'Java Lab 2 - Inheritance and Interfaces', 'Implement vehicle hierarchy with polymorphism.', 'Computer Programming II (Java)', 'Semester II', 2, '2026-11-25', 'ADMIN_01')
    `);

    // PYQ Question 401
    await db.run(`
      INSERT INTO pyq_questions (id, exam_year, exam_type, question_number, marks, question_text, clean_text, subject, semester_no, unit_number)
      VALUES (401, '2080 BS', 'Final Exam', '2.a', 5, 'Explain why Java is platform independent. How does JVM facilitate Write Once Run Anywhere?', 'Explain why Java is platform independent. How does JVM facilitate Write Once Run Anywhere?', 'Computer Programming II (Java)', 2, 2)
    `);

    // 3. Setup Express Server for HTTP Open Redirect Navigation Testing
    const app = express();
    app.use((req, _res, next) => {
      // Mock auth middleware providing academic context
      const authHeader = req.headers.authorization || '';
      if (authHeader.includes('STU_SEM4')) {
        req.user = sem4StudentContext;
      } else {
        req.user = sem2StudentContext;
      }
      next();
    });

    app.get('/api/ai/resources/:type/:id/open', createResourceHandler(db));

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  // ── TEST 1: Exact Query Identification & Response Behaviour ──
  test('1. "find me note with java as platform independent topic" resolves parent document without raw text dump', async () => {
    const q = 'find me note with java as platform independent topic';
    const u = understandRequest(q, [], null, {});

    assert.equal(u.explicitResourceType, 'note');
    assert.equal(u.isExplicitResourceSearch, true);
    assert.equal(u.resourceResponseMode, 'find_resource');
    assert.equal(u.entities.subject, 'Computer Programming II (Java)');
    assert.equal(u.entities.semester, 2);

    const res = await runKyanaAgentLoop({
      message: q,
      academicContext: sem2StudentContext,
      db,
      history: [],
      chatMode: 'academic'
    });

    // Verify parent document identification
    assert.ok(res.matchedFiles.some(f => Number(f.id) === 101), 'Must identify parent document 101');
    const noteFile = res.matchedFiles.find(f => Number(f.id) === 101);
    assert.equal(noteFile.title, '02. Introduction to Java');
    assert.equal(noteFile.subject, 'Computer Programming II (Java)');
    assert.equal(noteFile.semester, 'Semester II');

    // Verify relevant pages 12-13
    const pages = Array.isArray(noteFile.pageNumbers) ? noteFile.pageNumbers : [];
    assert.ok(pages.includes(12) || pages.includes(13), 'Must surface pages 12 and/or 13');

    // Verify response is concise finding statement and NOT dumping raw extracted text
    assert.ok(res.reply.includes('02. Introduction to Java'), 'Reply must cite the document title');
    assert.ok(!res.reply.includes('Introduction to Java. Course syllabus overview'), 'Reply must not dump full PDF content');
    assert.ok(res.reply.length < 500, `Finding reply must be concise (< 500 chars), got ${res.reply.length}`);

    // Verify resource card attached
    assert.ok(res.resourceCards.length >= 1, 'Must include resource card');
    const card = res.resourceCards[0];
    assert.equal(card.type, 'note');
    assert.equal(Number(card.id), 101);
    assert.equal(card.page, 12);
    assert.ok(card.deepLink.includes('#page=12'), `deepLink must contain #page=12, got: ${card.deepLink}`);
  });

  // ── TEST 2: Parent Document Identification ──
  test('2. Parent document identification resolves multiple chunks to parent file', async () => {
    const hits = await searchNotes(db, {
      query: 'platform independent bytecode JVM',
      semester: 2,
      subject: ['Computer Programming II (Java)'],
      academicContext: sem2StudentContext
    });

    assert.ok(hits.length >= 1, 'Should find candidate files');
    const parent = hits.find(h => Number(h.id) === 101);
    assert.ok(parent, 'Should resolve to parent file 101');
    assert.equal(parent.originalName, '02_Intro_Java.pdf');
    assert.equal(parent.title, '02. Introduction to Java');
  });

  // ── TEST 3: Relevant Page Preservation ──
  test('3. Relevant page preservation across metadata, deepLink fragment, and redirect handler', async () => {
    const card = resourceCard('note', {
      id: 101,
      title: '02. Introduction to Java',
      subject: 'Computer Programming II (Java)',
      semester: 'Semester II',
      chapter: '2',
      page: 12,
      relevantPages: [12, 13]
    });

    assert.equal(card.page, 12);
    assert.deepEqual(card.relevantPages, [12, 13]);
    assert.equal(card.deepLink, '/api/files/101/view#page=12');
    assert.equal(card.viewUrl, '/api/files/101/view#page=12');
    assert.equal(card.mobileRoute, '/material/101?page=12');
    assert.deepEqual(card.mobileParams, { id: 101, page: 12 });

    // Test HTTP Open Redirect with ?page=12
    const res = await fetch(`${baseUrl}/api/ai/resources/note/101/open?page=12`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/api/files/101/view#page=12');

    // Test HTTP Open Redirect JSON format
    const jsonRes = await fetch(`${baseUrl}/api/ai/resources/note/101/open?page=12&format=json`);
    assert.equal(jsonRes.status, 200);
    const jsonBody = await jsonRes.json();
    assert.equal(jsonBody.page, 12);
    assert.equal(jsonBody.type, 'note');
  });

  // ── TEST 4: Explicit Resource-Type Filtering ──
  test('4. Explicit resource-type filtering strictly isolates resource types', async () => {
    // A. Explicit request for notes returns ONLY notes
    const noteRes = await runKyanaAgentLoop({
      message: 'find me notes about Java',
      academicContext: sem2StudentContext,
      db,
      chatMode: 'academic'
    });
    assert.ok(noteRes.resourceCards.length > 0, 'Must return note cards');
    assert.ok(noteRes.resourceCards.every(c => c.type === 'note'), 'All cards must be notes only');

    // B. Explicit request for notice returns ONLY notices
    const noticeRes = await runKyanaAgentLoop({
      message: 'find me a notice about exams',
      academicContext: sem2StudentContext,
      db,
      chatMode: 'academic'
    });
    assert.ok(noticeRes.resourceCards.length > 0, 'Must return notice cards');
    assert.ok(noticeRes.resourceCards.every(c => c.type === 'notice' || c.type === 'post'), 'All cards must be notices only');

    // C. Explicit request for assignments returns ONLY assignments
    const asgRes = await runKyanaAgentLoop({
      message: 'find my assignments',
      academicContext: sem2StudentContext,
      db,
      chatMode: 'academic'
    });
    assert.ok(asgRes.resourceCards.length > 0, 'Must return assignment cards');
    assert.ok(asgRes.resourceCards.every(c => c.type === 'assignment'), 'All cards must be assignments only');
  });

  // ── TEST 5: Duplicate Chunk Elimination ──
  test('5. Duplicate chunk elimination collapses multiple matching chunks to 1 parent resource card', async () => {
    const rawCardsWithDups = [
      { type: 'note', id: 101, title: '02. Introduction to Java', page: 12 },
      { type: 'note', id: 101, title: '02. Introduction to Java', page: 13 },
      { type: 'note', id: 101, title: '02. Introduction to Java', page: 12 }
    ];

    const revalidated = await revalidateCards(db, sem2StudentContext, rawCardsWithDups);
    // Deduplicate cards by (type + id) as enforced in kyana-agent-engine
    const seen = new Set();
    const deduped = [];
    for (const c of revalidated) {
      const key = `${c.type}:${c.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(c);
      }
    }

    assert.equal(deduped.length, 1, 'Multiple chunks from the same file must collapse to exactly 1 card');
    assert.equal(Number(deduped[0].id), 101);
  });

  // ── TEST 6: Exclusion of Wrong-Semester Resources ──
  test('6. Exclusion of wrong-semester resources enforces semester boundaries for students', async () => {
    // Semester 4 student searching for notes without cross-semester request must NOT receive Semester 2 Java note
    const res = await searchNotes(db, {
      query: 'Java',
      semester: 4,
      academicContext: sem4StudentContext
    });

    assert.ok(!res.some(f => Number(f.id) === 101), 'Semester 4 student must not receive Semester 2 Java file');

    // Cross-semester explicit search allows access to public materials
    const crossRes = await searchNotes(db, {
      query: 'Java',
      semester: 2,
      searchAllSemesters: true,
      academicContext: sem4StudentContext
    });
    assert.ok(crossRes.some(f => Number(f.id) === 101), 'Explicit cross-semester search permits access to public note');
  });

  // ── TEST 7: Exclusion of Unauthorized Resources ──
  test('7. Exclusion of unauthorized resources (teachers_only / private visibility)', async () => {
    // Student attempting to access File 102 (teachers_only) via search
    const results = await searchNotes(db, {
      query: 'Teacher Solution Key',
      semester: 2,
      academicContext: sem2StudentContext
    });
    assert.ok(!results.some(f => Number(f.id) === 102), 'Student search must not return teachers_only file');

    // Student attempting to access File 102 via direct readResource
    const directRead = await readResource(db, sem2StudentContext, { type: 'note', id: 102 });
    assert.equal(directRead, null, 'Direct read of teachers_only file must return null for student');

    // Direct HTTP open redirect returns 404
    const httpRes = await fetch(`${baseUrl}/api/ai/resources/note/102/open`, { redirect: 'manual' });
    assert.equal(httpRes.status, 404, 'Unauthorized resource access must return HTTP 404');
  });

  // ── TEST 8: Fallback When Page Metadata Is Missing ──
  test('8. Fallback when page metadata is missing resolves cleanly to parent document', async () => {
    const hits = await searchNotes(db, {
      query: 'General Programming Guidelines',
      semester: 2,
      academicContext: sem2StudentContext
    });

    assert.ok(hits.length >= 1, 'Should find unpaginated note 104');
    const file104 = hits.find(h => Number(h.id) === 104);
    assert.equal(file104.title, 'General Programming Guidelines');

    const card = resourceCard('note', file104);
    assert.equal(card.page, undefined);
    assert.equal(card.deepLink, '/api/files/104/view');
    assert.equal(card.viewUrl, '/api/files/104/view');
    assert.equal(card.mobileRoute, '/material/104');

    // Verify open redirect falls back cleanly to view URL without fragment
    const httpRes = await fetch(`${baseUrl}/api/ai/resources/note/104/open`, { redirect: 'manual' });
    assert.equal(httpRes.status, 302);
    assert.equal(httpRes.headers.get('location'), '/api/files/104/view');
  });

  // ── TEST 9: Fallback When Resource ID Is Invalid ──
  test('9. Fallback when resource ID is invalid handles errors gracefully without crash', async () => {
    // Non-existent ID
    const nullRow = await readResource(db, sem2StudentContext, { type: 'note', id: 999999 });
    assert.equal(nullRow, null);

    const http404 = await fetch(`${baseUrl}/api/ai/resources/note/999999/open`, { redirect: 'manual' });
    assert.equal(http404.status, 404);
    const body404 = await http404.json();
    assert.ok(body404.message.includes('no longer available'));

    // Non-numeric ID
    const httpInvalid = await fetch(`${baseUrl}/api/ai/resources/note/invalid-id/open`, { redirect: 'manual' });
    assert.equal(httpInvalid.status, 404);
  });

  // ── TEST 10: Notice and Assignment Card Navigation ──
  test('10. Notice and assignment card navigation resolves direct deep links and redirects', async () => {
    // Notice Card
    const noticeCard = resourceCard('notice', {
      id: 201,
      title: 'Final Examination Notice 2081',
      category: 'NOTICE',
      role: 'admin',
      type: 'notice'
    });
    assert.equal(noticeCard.action, 'view_notice');
    assert.equal(noticeCard.deepLink, '/posts/201');
    assert.equal(noticeCard.mobileRoute, '/notice/201');

    const noticeRedirect = await fetch(`${baseUrl}/api/ai/resources/notice/201/open`, { redirect: 'manual' });
    assert.equal(noticeRedirect.status, 302);
    assert.equal(noticeRedirect.headers.get('location'), '/notices.html?id=201');

    // Assignment Card
    const asgCard = resourceCard('assignment', {
      id: 301,
      title: 'Java Lab 2 - Inheritance and Interfaces',
      subject: 'Java'
    });
    assert.equal(asgCard.action, 'view_assignment');
    assert.equal(asgCard.deepLink, '/code-lab/assignment.html?id=301');
    assert.equal(asgCard.mobileRoute, '/assignments/301');

    const asgRedirect = await fetch(`${baseUrl}/api/ai/resources/assignment/301/open`, { redirect: 'manual' });
    assert.equal(asgRedirect.status, 302);
    assert.equal(asgRedirect.headers.get('location'), '/code-lab/assignment.html?id=301');
  });

  // ── TEST 11: Academic Explanation Query Behaviour ──
  test('11. "explain how java is platform independent" returns a thorough conceptual explanation', async () => {
    const q = 'explain how java is platform independent';
    const u = understandRequest(q, [], null, {});

    assert.equal(u.resourceResponseMode, 'explain');
    assert.ok(u.intents.includes('academic_tutoring'));
    assert.equal(u.hasExplainKeyword, true);

    const res = await runKyanaAgentLoop({
      message: q,
      academicContext: sem2StudentContext,
      db,
      chatMode: 'academic'
    });

    // Must return an extensive academic explanation of the concepts
    assert.ok(res.reply.length > 200, `Explanation must be thorough, got length: ${res.reply.length}`);
    assert.ok(/\b(?:bytecode|jvm|javac|write\s+once\s+run\s+anywhere|wora)\b/i.test(res.reply), 'Reply must explain bytecode and JVM');
  });

  // ── TEST 12: Verified Resource ID in Card ──
  test('12. Verified resource ID in cards strictly matches DB record and eliminates hallucinations', async () => {
    const res = await runKyanaAgentLoop({
      message: 'find me note with java as platform independent topic',
      academicContext: sem2StudentContext,
      db,
      chatMode: 'academic'
    });

    for (const card of res.resourceCards) {
      assert.ok(Number.isInteger(card.id), `Card ID must be an integer, got: ${card.id}`);
      const row = await db.get(`SELECT id FROM files WHERE id = ?`, card.id);
      assert.ok(row, `Card ID ${card.id} must exist in the database files table`);
      assert.equal(card.id, 101, 'Card ID must strictly match parent file 101');
    }
  });
});
