'use strict';

/**
 * Kyana AI — Notice Retrieval & Grounding Regression Tests
 *
 * Covers:
 * 1. Admin NOTICE stored in `posts` (type='status', category='NOTICE') is found by class-resumption query ("Hamro class kaile bata xa?")
 * 2. Notice published yesterday about tomorrow's classes is still retrieved
 * 3. Romanized Nepali, Devanagari, and English queries retrieve the same relevant notice
 * 4. Regular student post is NOT treated as an official notice (even if category='NOTICE' or title claims to be official)
 * 5. Notice for another restricted semester is NOT exposed
 * 6. Answer does NOT invent an exact class resumption date and distinguishes publication date from effective date
 * 7. Dedicated official notices (type='notice') and admin NOTICE posts (type='status', category='NOTICE') can both be retrieved
 * 8. A superseded notice does not incorrectly override a newer relevant notice
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { handleChat, invalidateCache, clearPaginationState, routeQuery } = require('../ai-assistant');
const { searchNotices, searchPosts } = require('../lib/ai-search-tools');
const { searchKnowledge } = require('../lib/knowledge-search');
const { buildPostKnowledge } = require('../lib/knowledge-builder');
const { onPostSaved } = require('../lib/knowledge-sync');

function createTestDb() {
  const client = createClient({ url: ':memory:' });
  return {
    isPostgres: false,
    client,
    async exec(sql) {
      const stmts = sql
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);
      for (const s of stmts) {
        await client.execute(s);
      }
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

describe('Kyana AI — Critical Notice Retrieval & Unified Policy Regression Suite', () => {
  let db;

  const sem3StudentContext = {
    authenticated: true,
    studentId: 'STU_SEM3',
    name: 'Aarav Sharma',
    role: 'student',
    semester: 'Semester III',
    currentSemester: 3,
    cohortId: 'COHORT_2025',
    cohort: { id: 'COHORT_2025', name: 'Venus', currentSemester: 3 },
    canViewAllCohorts: false
  };

  before(async () => {
    db = createTestDb();
    await db.exec(`
      CREATE TABLE students (
        studentId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        department TEXT DEFAULT 'BIT',
        semester TEXT DEFAULT 'Semester III',
        cohort_id TEXT DEFAULT 'COHORT_2025',
        avatarUrl TEXT
      );
      CREATE TABLE cohorts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        current_semester INTEGER NOT NULL DEFAULT 3,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'status',
        category TEXT NOT NULL DEFAULT 'general',
        subject TEXT,
        semester TEXT,
        semester_no INTEGER,
        cohort_id TEXT,
        audience_scope TEXT NOT NULL DEFAULT 'all_students',
        visibility TEXT NOT NULL DEFAULT 'everyone',
        target_all_semesters INTEGER NOT NULL DEFAULT 1,
        attachment_url TEXT,
        moderation_status TEXT NOT NULL DEFAULT 'active',
        hidden_at TEXT,
        deleted_at TEXT,
        edited_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE post_target_semesters (
        post_id INTEGER NOT NULL,
        semester INTEGER NOT NULL,
        PRIMARY KEY (post_id, semester)
      );
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        originalName TEXT,
        storedName TEXT,
        title TEXT,
        semester TEXT,
        semester_no INTEGER,
        subject TEXT,
        chapter TEXT,
        uploadedBy TEXT,
        cohort_id TEXT,
        audience_scope TEXT DEFAULT 'all_students',
        uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE note_search_documents (
        id INTEGER PRIMARY KEY,
        content TEXT,
        indexed_at TEXT
      );
      CREATE TABLE routine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        semester INTEGER,
        subject_name TEXT,
        subject_code TEXT,
        exam_date TEXT,
        calendar TEXT DEFAULT 'BS',
        exam_time TEXT,
        room TEXT
      );
      CREATE TABLE assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        description TEXT,
        instructions TEXT,
        subject TEXT,
        semester TEXT,
        semester_no INTEGER,
        deadline TEXT,
        language TEXT,
        createdBy TEXT,
        cohort_id TEXT,
        audience_scope TEXT DEFAULT 'all_students',
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
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

    // Seed users across roles
    await db.run(
      `INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)`,
      'ADMIN_SAUGAT', 'Sau Gat', 'admin', 'All', null
    );
    await db.run(
      `INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)`,
      'TEACHER_RAMESH', 'Dr. Ramesh Adhikari', 'teacher', 'Semester III', 'COHORT_2025'
    );
    await db.run(
      `INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)`,
      'CR_SEM3', 'Sita Gurung', 'cr', 'Semester III', 'COHORT_2025'
    );
    await db.run(
      `INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)`,
      'STU_SEM3', 'Aarav Sharma', 'student', 'Semester III', 'COHORT_2025'
    );
    await db.run(
      `INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)`,
      'STU_PRANKSTER', 'Admin Official Notice Fake', 'student', 'Semester III', 'COHORT_2025'
    );
    await db.run(
      `INSERT INTO cohorts (id, name, current_semester, status) VALUES (?, ?, ?, ?)`,
      'COHORT_2025', 'Venus', 3, 'active'
    );

    // 1. Seed the exact production Admin NOTICE post stored in `posts` with type='status' and category='NOTICE'
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      101,
      'ADMIN_SAUGAT',
      'Resumption of Regular Classes',
      'This is to inform all BIT students that regular academic classes will resume following the Dashain vacation as per the updated academic schedule. All students are requested to attend their respective classes regularly and follow the timetable provided by the department.',
      'status',
      'NOTICE',
      'everyone',
      1,
      'all_students',
      '2026-11-03T09:00:00Z'
    );

    // Also index post 101 into knowledge_resources for V3 path testing
    const post101Row = await db.get(`SELECT p.*, s.role AS author_role, s.name AS author_name FROM posts p JOIN students s ON s.studentId = p.user_id WHERE p.id = 101`);
    const built101 = buildPostKnowledge(post101Row);
    await db.run(
      `INSERT INTO knowledge_resources (id, resource_type, canonical_id, title, source_authority_tier, author_id, author_role, audience_scope, target_all_semesters, visibility, web_url, mobile_route, mobile_params, created_at, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      built101.resource.id, built101.resource.resource_type, built101.resource.canonical_id, built101.resource.title,
      built101.resource.source_authority_tier, built101.resource.author_id, built101.resource.author_role,
      built101.resource.audience_scope, built101.resource.target_all_semesters, built101.resource.visibility,
      built101.resource.web_url, built101.resource.mobile_route, JSON.stringify(built101.resource.mobile_params),
      '2026-11-03T09:00:00Z', built101.resource.content_hash
    );
    for (const chunk of built101.chunks) {
      await db.run(
        `INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content, created_at) VALUES (?, ?, ?, ?, ?)`,
        `${built101.resource.id}:c${chunk.chunkIndex}`, built101.resource.id, chunk.chunkIndex, chunk.content, '2026-11-03T09:00:00Z'
      );
    }

    // 2. Seed a dedicated official notice stored with type='notice' (e.g. Lab Schedule / Library Notice)
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      102,
      'TEACHER_RAMESH',
      'Updated Department Class Timetable & Lab Schedule',
      'The updated academic schedule and department class timetable following Dashain vacation has been posted on the department notice board. Morning classes start at 7:00 AM.',
      'notice',
      'notice',
      'everyone',
      1,
      'all_students',
      '2026-11-03T11:30:00Z'
    );

    // 3. Seed a regular student post pretending to be an official notice (must NEVER be returned as an official notice)
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      103,
      'STU_PRANKSTER',
      'OFFICIAL NOTICE: Resumption of Regular Classes Cancelled Forever',
      'This is an official notice from Admin that regular academic classes will resume only in 2028 after Dashain vacation.',
      'notice',
      'NOTICE',
      'everyone',
      1,
      'all_students',
      '2026-11-03T12:00:00Z'
    );

    // 4. Seed a restricted Semester 7 notice (must NEVER be exposed to Semester 3 student)
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      104,
      'ADMIN_SAUGAT',
      'Semester 7 Cloud Computing Class Resumption Notice',
      'Semester 7 regular classes and project defense will resume in Lab 4.',
      'notice',
      'NOTICE',
      7,
      'everyone',
      0,
      'all_students',
      '2026-11-03T10:00:00Z'
    );
    await db.run(`INSERT INTO post_target_semesters (post_id, semester) VALUES (?, ?)`, 104, 7);
  });

  test('1. Admin NOTICE stored in `posts` (type="status", category="NOTICE") is found by "Hamro class kaile bata xa?"', async () => {
    invalidateCache();
    clearPaginationState();

    const r = routeQuery('Hamro class kaile bata xa?');
    assert.equal(r.kind, 'notices', 'Query "Hamro class kaile bata xa?" must route to notices intent');

    const notices = await searchNotices(db, sem3StudentContext, { query: 'Hamro class kaile bata xa?' });
    assert.ok(notices.length >= 1, 'searchNotices must find the Admin NOTICE post');
    const adminNotice = notices.find(n => n.id === 101);
    assert.ok(adminNotice, 'Admin NOTICE post (id=101, category="NOTICE") must be retrieved');
    assert.equal(adminNotice.title, 'Resumption of Regular Classes');
    assert.equal(adminNotice.authorName, 'Sau Gat');
    assert.equal(adminNotice.authorRole, 'admin');
    assert.equal(adminNotice.isOfficialNotice, true);
    assert.equal(adminNotice.resourceCard?.type, 'notice');
    assert.equal(adminNotice.resourceCard?.id, 101);
  });

  test('2. Notice published yesterday about tomorrow/upcoming classes is still retrieved today', async () => {
    // Query with a relative date ("Bholi class suru hunxa?" / "Tomorrow class xa?") where dateInfo resolves to tomorrow,
    // while the notice was published yesterday (2026-11-03).
    const yesterdayDateInfo = {
      expression: 'tomorrow',
      date: '2026-11-04',
      unresolvable: false
    };

    const notices = await searchNotices(db, sem3StudentContext, {
      query: 'Tomorrow class suru hunxa?',
      dateInfo: yesterdayDateInfo
    });
    assert.ok(
      notices.some(n => n.id === 101),
      'Notice published yesterday (2026-11-03) about class resumption must remain eligible when asking about tomorrow (2026-11-04)'
    );

    // Also verify V3 searchKnowledge does not discard the notice due to created_at !== tomorrow
    const prevFlag = process.env.KYANA_KNOWLEDGE_V3;
    const prevUsers = process.env.KYANA_KNOWLEDGE_V3_USERS;
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
    try {
      const v3Results = await searchKnowledge(db, sem3StudentContext, 'Tomorrow class suru hunxa?', {
        dateInfo: yesterdayDateInfo
      });
      assert.ok(
        v3Results.some(r => Number(r.canonicalId) === 101),
        'V3 searchKnowledge must not exclude a class-resumption notice published yesterday when asking about tomorrow'
      );
    } finally {
      if (prevFlag === undefined) delete process.env.KYANA_KNOWLEDGE_V3;
      else process.env.KYANA_KNOWLEDGE_V3 = prevFlag;
      if (prevUsers === undefined) delete process.env.KYANA_KNOWLEDGE_V3_USERS;
      else process.env.KYANA_KNOWLEDGE_V3_USERS = prevUsers;
    }
  });

  test('3. Romanized Nepali, Devanagari, and English queries (including all 6 required test queries) retrieve the same relevant notice', async () => {
    const queries = [
      'Hamro class kaile bata ho?',
      'Class kahile suru hunxa?',
      'When do our classes start?',
      'Dashain pachi class kaile start hunxa?',
      'Is there any update about regular BIT classes?',
      'Hamro class kaile bata xa?',
      'When do classes start?',
      'Any update about class resumption?',
      'हाम्रो कक्षा कहिले बाट सुरु हुन्छ?'
    ];

    for (const q of queries) {
      const r = routeQuery(q);
      assert.equal(r.kind, 'notices', `Query "${q}" must route to notices intent (got ${r.kind})`);

      const found = await searchNotices(db, sem3StudentContext, { query: q });
      assert.ok(
        found.some(n => n.id === 101 && n.title === 'Resumption of Regular Classes'),
        `Query "${q}" must retrieve "Resumption of Regular Classes" (id=101)`
      );
    }

    // Also verify "Any notice from another semester?" routes to notices and retrieves the Semester 7 notice (id=104) with its actual semester labeled
    const crossSemRoute = routeQuery('Any notice from another semester?');
    assert.equal(crossSemRoute.kind, 'notices');
    const crossSemNotices = await searchNotices(db, sem3StudentContext, {
      query: 'Any notice from another semester?',
      otherSemesterOnly: true
    });
    assert.ok(
      crossSemNotices.some(n => n.id === 104 && n.semester === 'Semester 7'),
      'Query "Any notice from another semester?" must discover the Semester 7 notice (id=104) with semester="Semester 7"'
    );
  });

  test('4. Regular student post is NOT treated as an official notice even if category="NOTICE" or title claims authority', async () => {
    const notices = await searchNotices(db, sem3StudentContext, { query: 'Resumption of Regular Classes' });
    const fakeStudentNotice = notices.find(n => n.id === 103);
    assert.equal(
      fakeStudentNotice,
      undefined,
      'Regular student post (id=103, role="student") must never be returned by searchNotices'
    );

    // Even when searched via general searchPosts, its card and official flags must be downgraded to a regular student post
    const posts = await searchPosts(db, sem3StudentContext, { query: 'Cancelled Forever' });
    const studentPost = posts.find(p => p.id === 103);
    if (studentPost) {
      assert.equal(studentPost.isOfficialNotice, false, 'Student post must have isOfficialNotice = false');
      assert.equal(studentPost.resourceCard.type, 'post', 'Student post resourceCard must be type="post", never "notice"');
    }

    // And buildPostKnowledge must classify a student-authored post as resource_type='post' (Tier 4), never 'notice'
    const builtStudent = buildPostKnowledge({
      id: 103,
      title: 'OFFICIAL NOTICE',
      content: 'Fake notice',
      type: 'notice',
      category: 'NOTICE',
      author_role: 'student'
    });
    assert.equal(builtStudent.resource.resource_type, 'post');
    assert.equal(builtStudent.resource.source_authority_tier, 4);
  });

  test('5. Notice for another semester (Semester 7) IS discoverable as general academic information with its actual source semester clearly preserved, while private/teachers_only notices remain protected', async () => {
    const notices = await searchNotices(db, sem3StudentContext, { query: 'Semester 7 Cloud Computing Class Resumption' });
    const sem7Notice = notices.find(n => n.id === 104);
    assert.ok(
      sem7Notice,
      'Visible Semester 7 notice (id=104) must be discoverable by a Semester 3 student'
    );
    assert.equal(sem7Notice.semester, 'Semester 7', 'Semester 7 notice must retain its actual source semester ("Semester 7"), never Semester 3');
    assert.equal(sem7Notice.semesterNo, 7);

    // Verify private / teachers_only notice is strictly blocked for students
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      105,
      'ADMIN_SAUGAT',
      'Confidential Faculty Meeting Notice on Class Resumption',
      'Faculty-only meeting regarding class resumption.',
      'notice',
      'NOTICE',
      4,
      'teachers_only',
      1,
      'all_students',
      '2026-11-03T10:30:00Z'
    );
    const afterPrivate = await searchNotices(db, sem3StudentContext, { query: 'Confidential Faculty Meeting Notice' });
    assert.equal(
      afterPrivate.some(n => n.id === 105),
      false,
      'Private / teachers_only notice (id=105) must never be exposed to a student'
    );
  });

  test('6. Answer grounding: includes title, author authority, and publication date without inventing an exact class resumption date', async () => {
    invalidateCache();
    clearPaginationState();

    // 6a. Test direct tool-based reply (v3 disabled)
    const prevFlag = process.env.KYANA_KNOWLEDGE_V3;
    process.env.KYANA_KNOWLEDGE_V3 = 'false';
    try {
      const chatRes = await handleChat({
        db,
        message: 'Hamro class kaile bata ho?',
        studentInfo: sem3StudentContext,
        academicContext: sem3StudentContext
      });

      assert.ok(chatRes.reply.includes('Resumption of Regular Classes'), 'Reply must include the notice title');
      assert.ok(chatRes.reply.includes('Sau Gat'), 'Reply must include the author name');
      assert.ok(/Admin/i.test(chatRes.reply), 'Reply must include the author authority (Admin)');
      assert.ok(chatRes.reply.includes('2026-11-03'), 'Reply must state the publication date');
      assert.ok(
        /publication date,\s*NOT the class start date/i.test(chatRes.reply) ||
        /No exact class resumption calendar date is stated/i.test(chatRes.reply),
        'Reply must clearly distinguish publication date from class start date and note that the schedule/timetable determines the exact date'
      );
      assert.ok(
        Array.isArray(chatRes.resourceCards) && chatRes.resourceCards.some(c => c.type === 'notice' && c.id === 101),
        'Reply must preserve the notice resource card for post 101'
      );
    } finally {
      if (prevFlag === undefined) delete process.env.KYANA_KNOWLEDGE_V3;
      else process.env.KYANA_KNOWLEDGE_V3 = prevFlag;
    }

    // 6b. Test V3 knowledge path with LLM grounding verification
    invalidateCache();
    clearPaginationState();
    const prevUsers = process.env.KYANA_KNOWLEDGE_V3_USERS;
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
    try {
      let capturedSystemPrompt = '';
      const v3Res = await handleChat({
        db,
        message: 'Hamro class kaile bata xa?',
        studentInfo: sem3StudentContext,
        academicContext: sem3StudentContext,
        generateReply: async ({ systemPrompt, onDelta }) => {
          capturedSystemPrompt = systemPrompt;
          const groundedText =
            'Official college notice **"Resumption of Regular Classes"** (published by Admin Sau Gat on 2026-11-03) anusar Dashain vacation pachi regular BIT classes updated academic schedule ra department timetable anusar suru hunxa. Notice ma kunai exact class start date tokiyako xaina (2026-11-03 yo notice publish vako date ho); exact date ko lagi department ko updated timetable hernu hola.\n<referenced_records>\npost:101\n</referenced_records>';
          if (onDelta) onDelta(groundedText);
          return { reply: groundedText };
        }
      });

      assert.ok(
        capturedSystemPrompt.includes('NEVER infer or invent an exact class starting/resumption calendar date'),
        'V3 knowledgePrompt must instruct the model never to invent an exact class resumption date'
      );
      assert.ok(
        capturedSystemPrompt.includes('Published Date: 2026-11-03'),
        'V3 evidence block must explicitly label Published Date'
      );
      assert.ok(v3Res.reply.includes('Resumption of Regular Classes'));
      assert.ok(!v3Res.reply.includes('<referenced_records>'), 'Reference trailer must be stripped from user-facing reply');
      assert.ok(
        v3Res.resourceCards.some(c => c.type === 'notice' && c.id === 101),
        'V3 reply must attach the validated notice resource card'
      );
    } finally {
      if (prevFlag === undefined) delete process.env.KYANA_KNOWLEDGE_V3;
      else process.env.KYANA_KNOWLEDGE_V3 = prevFlag;
      if (prevUsers === undefined) delete process.env.KYANA_KNOWLEDGE_V3_USERS;
      else process.env.KYANA_KNOWLEDGE_V3_USERS = prevUsers;
    }
  });

  test('7. Unified notice retrieval: dedicated official notices (type="notice") and admin NOTICE posts (type="status", category="NOTICE") are both retrieved together', async () => {
    const notices = await searchNotices(db, sem3StudentContext, { query: 'Dashain vacation classes schedule' });
    const ids = notices.map(n => n.id);
    assert.ok(ids.includes(101), 'Must retrieve Admin post with type="status" and category="NOTICE" (id=101)');
    assert.ok(ids.includes(102), 'Must retrieve Teacher official notice with type="notice" (id=102)');
  });

  test('8. Supersession handling: a superseded older notice does not override a newer relevant notice on the same topic', async () => {
    // Seed an older notice (Oct 20) and a newer updated notice (Nov 5) on the same topic
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      201,
      'ADMIN_SAUGAT',
      'Winter Vacation Class Resumption Notice',
      'Regular BIT classes after winter vacation will resume according to the preliminary winter schedule.',
      'status',
      'NOTICE',
      'everyone',
      1,
      'all_students',
      '2026-10-20T08:00:00Z'
    );
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      202,
      'ADMIN_SAUGAT',
      'Updated Notice: Revised Winter Vacation Class Resumption',
      'This updated notice supersedes the earlier winter vacation notice. Regular BIT classes after winter vacation will resume as per the revised department schedule.',
      'status',
      'NOTICE',
      'everyone',
      1,
      'all_students',
      '2026-11-05T09:00:00Z'
    );

    const notices = await searchNotices(db, sem3StudentContext, { query: 'winter vacation class resumption' });
    const idxNewer = notices.findIndex(n => n.id === 202);
    const idxOlder = notices.findIndex(n => n.id === 201);
    assert.ok(idxNewer !== -1, 'Newer notice (id=202) must be retrieved');
    assert.ok(idxOlder !== -1, 'Older notice (id=201) can still be present in results');
    assert.ok(idxNewer < idxOlder, 'Newer updated notice (id=202) must rank above the superseded older notice (id=201)');
    assert.equal(notices[idxOlder].superseded, true, 'Older notice (id=201) must be marked as superseded');
    assert.equal(notices[idxOlder].supersededBy, 202, 'Older notice must reference supersededBy = 202');
  });
});
