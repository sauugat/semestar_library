'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const aiAssistant = require('../ai-assistant');
const { createTools, routeQuery } = require('../lib/chat-tools');
const aiSearch = require('../lib/ai-search-tools');

describe('Kyana AI Platform Intelligence & Semester Authorization', () => {
  // Mock DB helper
  function createMockDb() {
    return {
      isPostgres: false,
      async get(sql, ...params) {
        return null;
      },
      async all(sql, ...params) {
        return [];
      },
      async run(sql, ...params) {
        return { lastInsertRowid: 1 };
      },
      async exec(sql) {
        return true;
      }
    };
  }

  test('1. Student registered in Semester 2 explicitly requesting Semester 4 notes is allowed to retrieve Semester 4 notes', async () => {
    const db = createMockDb();
    const route = routeQuery('find me 4th-semester notes on database');

    const academicContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_sem2', currentSemester: 2 }
    };

    let searchCalledWith = null;
    const mockSearchNotes = async (db, params) => {
      searchCalledWith = params;
      return [
        {
          id: 401,
          title: 'DBMS Semester 4 Notes',
          originalName: 'dbms_sem4.pdf',
          subject: 'Database Management System',
          semester: 'Semester 4',
          matchType: 'metadata',
          score: 100
        }
      ];
    };

    const toolkit = createTools(db, route, {
      academicContext,
      searchNotes: mockSearchNotes
    });

    const result = await toolkit.executeTool('search_notes', { query: 'database' });

    assert.ok(result.files && result.files.length === 1, 'Explicit cross-semester note request must succeed');
    assert.strictEqual(searchCalledWith.semester, 4, 'Search must target the explicitly requested Semester 4');
    assert.strictEqual(result.files[0].semester, 'Semester 4');
  });

  test('2. Student in Semester 2 asking for a named subject from another semester (DBMS -> Semester 3) resolves the subject semester and retrieves it', async () => {
    const db = createMockDb();
    const route = routeQuery('find me DBMS notes');

    const academicContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_sem2', currentSemester: 2 }
    };

    let searchCalledWith = null;
    const mockSearchNotes = async (db, params) => {
      searchCalledWith = params;
      return [
        {
          id: 301,
          title: 'DBMS Normalization Notes',
          originalName: 'dbms_norm.pdf',
          subject: 'Database Management System',
          semester: 'Semester 3',
          matchType: 'metadata',
          score: 100
        }
      ];
    };

    const toolkit = createTools(db, route, {
      academicContext,
      searchNotes: mockSearchNotes
    });

    const result = await toolkit.executeTool('search_notes', { query: 'dbms' });

    assert.ok(result.files && result.files.length === 1, 'Named cross-semester subject note request must succeed');
    assert.strictEqual(searchCalledWith.semester, 3, 'Must resolve Database Management System to Semester 3');
  });

  test('3. Student in Semester 2 asking for Semester 2 notes is allowed and scoped to semester 2', async () => {
    const db = createMockDb();
    const route = routeQuery('give me Web Technology I notes');

    const academicContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_sem2', currentSemester: 2 }
    };

    let searchCalledWith = null;
    const mockSearchNotes = async (db, params) => {
      searchCalledWith = params;
      return [
        {
          id: 42,
          title: 'HTML & CSS Intro',
          originalName: 'web_tech_1.pdf',
          subject: 'Web Technology I',
          semester: 'Semester 2',
          matchType: 'metadata',
          score: 100
        }
      ];
    };

    const toolkit = createTools(db, route, {
      academicContext,
      searchNotes: mockSearchNotes
    });

    const result = await toolkit.executeTool('search_notes', { query: 'web technology 1' });

    assert.ok(result.files, 'Should return matching files');
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(searchCalledWith.semester, 2, 'Search must be strictly bound to Semester 2');

    // Verify rich resourceCard attached
    const card = result.files[0].resourceCard;
    assert.ok(card, 'resourceCard must be present');
    assert.strictEqual(card.type, 'note');
    assert.strictEqual(card.id, 42);
    assert.strictEqual(card.action, 'open_note');
    assert.strictEqual(card.mobileRoute, '/material/42');
  });

  test('4. Student in Semester 2 asking for routine is restricted to Semester 2', async () => {
    const db = createMockDb();
    // Asking for semester 4 routine
    const route = routeQuery('show me semester 4 exam routine');

    const academicContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_sem2', currentSemester: 2 }
    };

    const toolkit = createTools(db, route, { academicContext });
    const result = await toolkit.executeTool('get_routine', { semester: 4 });

    assert.ok(result.clarification, 'Expected clarification blocking semester 4 routine for semester 2 student');
    assert.match(result.clarification, /Semester 2/i);
  });

  test('5. Teacher or Admin can query any semester without restriction', async () => {
    const db = createMockDb();
    const route = routeQuery('find me 4th-semester DBMS notes');

    const teacherContext = {
      authenticated: true,
      role: 'teacher',
      canViewAllCohorts: true
    };

    let searchCalledWith = null;
    const mockSearchNotes = async (db, params) => {
      searchCalledWith = params;
      return [
        {
          id: 99,
          title: 'DBMS Chapter 1',
          subject: 'Database Management System',
          semester: 'Semester 4'
        }
      ];
    };

    const toolkit = createTools(db, route, {
      academicContext: teacherContext,
      searchNotes: mockSearchNotes
    });

    const result = await toolkit.executeTool('search_notes', { query: 'dbms' });
    assert.ok(result.files, 'Teacher should successfully retrieve notes');
    assert.strictEqual(searchCalledWith.semester, 4, 'Teacher allowed to query requested semester');
  });

  test('5b. Teacher with assigned semesters [2] is restricted and blocked from querying Semester 4', async () => {
    const db = createMockDb();
    const route = routeQuery('find me 4th-semester DBMS notes');

    const teacherContext = {
      authenticated: true,
      role: 'teacher',
      assignedSemesters: [2]
    };

    const toolkit = createTools(db, route, {
      academicContext: teacherContext
    });

    const result = await toolkit.executeTool('search_notes', { query: 'dbms' });
    assert.ok(result.clarification, 'Expected clarification blocking semester 4 notes for teacher assigned to semester 2');
    assert.match(result.clarification, /assigned to teach Semester\(s\) 2/i);
  });

  test('6. Post & notice filter allows cross-semester general academic information while enforcing visibility and cohort_only rules', () => {
    const studentContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_mercury', currentSemester: 2 }
    };

    const filter = aiSearch.buildPostSemesterFilter(studentContext, { tableAlias: 'p' });
    assert.ok(filter.sql.includes("'students_only'"), 'Must enforce student visibility rules');
    assert.ok(filter.sql.includes("'cohort_only'"), 'Must protect strictly cohort_only posts');
    assert.ok(filter.params.includes('cohort_mercury'), 'Must parameterize student cohort');
  });

  test('7. Assignment semester filter enforces student semester and cohort isolation', () => {
    const studentContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_mercury', currentSemester: 2 }
    };

    const filter = aiSearch.buildAssignmentSemesterFilter(studentContext, { tableAlias: 'a' });
    assert.ok(filter.sql.includes('cohort_id = ?'), 'Must check student cohort');
    assert.ok(filter.sql.includes('semester_no = ?'), 'Must check student semester_no');
    assert.ok(filter.params.includes('cohort_mercury'), 'Must include cohort ID param');
    assert.ok(filter.params.includes(2), 'Must include semester number param');
  });

  test('8. handleChat aggregates all resource cards and formats responses with platform cards', async () => {
    const db = createMockDb();
    const studentInfo = {
      studentId: 'std_123',
      role: 'student',
      semester: 'Semester 2'
    };

    const academicContext = {
      authenticated: true,
      role: 'student',
      studentId: 'std_123',
      semester: 'Semester 2',
      cohort: { id: 'c2', currentSemester: 2 }
    };

    const mockSearchNotes = async () => [
      {
        id: 77,
        title: 'OOP Java Notes',
        originalName: 'oop.pdf',
        subject: 'Computer Programming II (Java)',
        semester: 'Semester 2',
        resourceCard: {
          type: 'note',
          id: 77,
          title: 'OOP Java Notes',
          action: 'open_note',
          deepLink: '/material/77',
          mobileRoute: '/material/77'
        }
      }
    ];

    const result = await aiAssistant.handleChat(
      db,
      'notes on java',
      studentInfo,
      [],
      'session_test',
      {
        academicContext,
        toolDependencies: { searchNotes: mockSearchNotes }
      }
    );

    assert.ok(result.reply, 'Should produce a reply');
    assert.ok(Array.isArray(result.resourceCards), 'Should return resourceCards array');
    assert.strictEqual(result.resourceCards.length, 1);
    assert.strictEqual(result.resourceCards[0].id, 77);
    assert.strictEqual(result.resourceCards[0].mobileRoute, '/material/77');
  });
});

describe('Kyana AI — Global Academic Information Access & Semester-Aware Retrieval (12 Required Scenarios)', () => {
  const { createClient } = require('@libsql/client');
  const { searchNotes } = require('../lib/note-search');
  const { buildPostKnowledge } = require('../lib/knowledge-builder');
  const { searchKnowledge } = require('../lib/knowledge-search');
  const { canReadResource, resolveRetrievalPolicy, RETRIEVAL_POLICIES } = require('../lib/kyana-access');

  let db;

  const sem3Student = {
    authenticated: true,
    studentId: 'STU_SEM3_AARAV',
    name: 'Aarav Sharma',
    role: 'student',
    semester: 'Semester 3',
    currentSemester: 3,
    cohortId: 'COHORT_SEM3',
    cohort: { id: 'COHORT_SEM3', name: 'Mercury', currentSemester: 3 },
    canViewAllCohorts: false
  };

  const sem7Student = {
    authenticated: true,
    studentId: 'STU_SEM7_BIKASH',
    name: 'Bikash KC',
    role: 'student',
    semester: 'Semester 7',
    currentSemester: 7,
    cohortId: 'COHORT_SEM7',
    cohort: { id: 'COHORT_SEM7', name: 'Saturn', currentSemester: 7 },
    canViewAllCohorts: false
  };

  const teacherSem3 = {
    authenticated: true,
    studentId: 'TCH_SEM3',
    name: 'Dr. Ramesh Adhikari',
    role: 'teacher',
    assignedSemesters: [3],
    assignedSubjects: [{ id: 'CIT214', code: 'CIT214', name: 'Database Management System', semester: 3 }],
    canViewAllCohorts: false
  };

  const adminCtx = {
    authenticated: true,
    studentId: 'ADMIN_SAUGAT',
    name: 'Sau Gat',
    role: 'admin',
    canViewAllCohorts: true
  };

  test('Setup in-memory SQLite database and verify all 12 required regression scenarios', async (t) => {
    const client = createClient({ url: ':memory:' });
    db = {
      isPostgres: false,
      client,
      async exec(sql) {
        await client.executeMultiple(sql);
      },
      async run(sql, ...params) {
        const res = await client.execute({ sql, args: params.map(v => (v === undefined ? null : v)) });
        return { lastInsertRowid: Number(res.lastInsertRowid || 0), changes: Number(res.rowsAffected || 0) };
      },
      async get(sql, ...params) {
        const res = await client.execute({ sql, args: params.map(v => (v === undefined ? null : v)) });
        return res.rows[0] ? { ...res.rows[0] } : null;
      },
      async all(sql, ...params) {
        const res = await client.execute({ sql, args: params.map(v => (v === undefined ? null : v)) });
        return res.rows.map(r => ({ ...r }));
      }
    };

    await db.exec(`
      CREATE TABLE students (
        studentId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        department TEXT DEFAULT 'BIT',
        semester TEXT,
        cohort_id TEXT,
        avatarUrl TEXT
      );
      CREATE TABLE cohorts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        current_semester INTEGER NOT NULL,
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
        target_all_semesters INTEGER NOT NULL DEFAULT 0,
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
        visibility TEXT DEFAULT 'everyone',
        moderation_status TEXT DEFAULT 'active',
        hidden_at TEXT,
        deleted_at TEXT,
        uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE note_search_documents (
        id INTEGER PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        extraction_status TEXT NOT NULL DEFAULT 'ok',
        extraction_error TEXT,
        indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        content_truncated INTEGER DEFAULT 0
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
        visibility TEXT DEFAULT 'everyone',
        moderation_status TEXT DEFAULT 'active',
        hidden_at TEXT,
        deleted_at TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE assignment_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignmentId INTEGER NOT NULL,
        questionNumber INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        description TEXT,
        language TEXT DEFAULT 'sql',
        maxPoints INTEGER DEFAULT 10
      );
      CREATE TABLE submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignmentId INTEGER NOT NULL,
        questionId INTEGER,
        studentId TEXT NOT NULL,
        code TEXT,
        questionTitle TEXT,
        submittedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE submission_grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        questionId INTEGER NOT NULL,
        studentId TEXT NOT NULL,
        marksObtained REAL,
        remarks TEXT,
        checked INTEGER DEFAULT 0,
        released INTEGER DEFAULT 0
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
        target_all_semesters INTEGER DEFAULT 0,
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

    await db.run(`INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES ('ADMIN_SAUGAT', 'Sau Gat', 'admin', 'All', NULL)`);
    await db.run(`INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES ('TCH_SEM3', 'Dr. Ramesh Adhikari', 'teacher', 'Semester 3', 'COHORT_SEM3')`);
    await db.run(`INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES ('STU_SEM3_AARAV', 'Aarav Sharma', 'student', 'Semester 3', 'COHORT_SEM3')`);
    await db.run(`INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES ('STU_SEM4_ANITA', 'Anita Thapa', 'student', 'Semester 4', 'COHORT_SEM4')`);

    // Seed Notice 501: 3 November 2026 Admin NOTICE about resumption of regular BIT classes (stored with audience_scope='cohort' and cohort_id=NULL to test legacy/cohort edge case as well)
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, visibility, target_all_semesters, audience_scope, cohort_id, created_at)
       VALUES (501, 'ADMIN_SAUGAT', 'Resumption of Regular Classes',
       'This is to inform all BIT students that regular academic classes will resume following the Dashain vacation as per the updated academic schedule. All students are requested to attend their respective classes regularly and follow the timetable provided by the department.',
       'status', 'NOTICE', 'everyone', 1, 'cohort', NULL, '2026-11-03T09:00:00Z')`
    );

    // Seed Post 502: Semester 4 Admin Announcement
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, visibility, target_all_semesters, audience_scope, cohort_id, created_at)
       VALUES (502, 'ADMIN_SAUGAT', 'Semester 4 Operating Systems Workshop Announcement',
       'An intensive Operating Systems kernel workshop will be held for Semester 4 students in Hall B.',
       'status', 'ANNOUNCEMENT', 4, 'everyone', 0, 'cohort', 'COHORT_SEM4', '2026-11-02T10:00:00Z')`
    );
    await db.run(`INSERT INTO post_target_semesters (post_id, semester) VALUES (502, 4)`);

    // Seed Post 503: Semester 5 Official Notice
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, visibility, target_all_semesters, audience_scope, cohort_id, created_at)
       VALUES (503, 'ADMIN_SAUGAT', 'Semester 5 AI Lab Viva Official Schedule Notice',
       'The Semester 5 Artificial Intelligence practical viva examination schedule has been published by the department.',
       'notice', 'NOTICE', 5, 'everyone', 0, 'all_students', NULL, '2026-11-01T11:00:00Z')`
    );
    await db.run(`INSERT INTO post_target_semesters (post_id, semester) VALUES (503, 5)`);

    // Seed Post 504: Private / Teachers-Only Post
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (504, 'ADMIN_SAUGAT', 'Private Faculty Moderation Briefing',
       'Restricted internal exam moderation guidelines for faculty members only.',
       'notice', 'NOTICE', 3, 'teachers_only', 1, 'all_students', '2026-11-01T12:00:00Z')`
    );

    // Seed Post 505: Strictly cohort_only post for Cohort Sem 4
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, visibility, target_all_semesters, audience_scope, cohort_id, created_at)
       VALUES (505, 'ADMIN_SAUGAT', 'Private Cohort Sem 4 Internal Discussion',
       'Strictly restricted to cohort_sem4 members only.',
       'status', 'general', 4, 'everyone', 0, 'cohort_only', 'COHORT_SEM4', '2026-11-01T13:00:00Z')`
    );

    // Index posts 501, 502, 503, 504 into knowledge_resources for V3 path testing
    for (const pid of [501, 502, 503, 504]) {
      const pRow = await db.get(`SELECT p.*, s.role AS author_role, s.name AS author_name FROM posts p JOIN students s ON s.studentId = p.user_id WHERE p.id = ?`, pid);
      const targetSems = (await db.all(`SELECT semester FROM post_target_semesters WHERE post_id = ?`, pid)).map(r => r.semester);
      const built = buildPostKnowledge({ ...pRow, target_semesters: targetSems });
      await db.run(
        `INSERT INTO knowledge_resources (id, resource_type, canonical_id, title, source_authority_tier, author_id, author_role, cohort_id, semester_no, audience_scope, target_all_semesters, visibility, web_url, mobile_route, mobile_params, created_at, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        built.resource.id, built.resource.resource_type, built.resource.canonical_id, built.resource.title,
        built.resource.source_authority_tier, built.resource.author_id, built.resource.author_role,
        built.resource.cohort_id, built.resource.semester_no, built.resource.audience_scope,
        built.resource.target_all_semesters, built.resource.visibility, built.resource.web_url,
        built.resource.mobile_route, JSON.stringify(built.resource.mobile_params), pRow.created_at, built.resource.content_hash
      );
      for (const ch of built.chunks) {
        await db.run(
          `INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content, created_at) VALUES (?, ?, ?, ?, ?)`,
          `${built.resource.id}:c${ch.chunkIndex}`, built.resource.id, ch.chunkIndex, ch.content, pRow.created_at
        );
      }
    }

    // Seed Notes: Semester 3 DBMS note (id=701), Semester 4 DBMS Advanced note (id=702), Semester 4 OS note (id=703), Private note (id=704)
    await db.run(
      `INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, audience_scope, visibility)
       VALUES (701, 'DBMS Semester 3 Relational Model Notes', 'dbms-sem3.pdf', 'dbms-sem3.pdf', 'Database Management System', 'Chapter 1', 'Semester 3', 3, 'all_students', 'everyone'),
              (702, 'DBMS Semester 4 Distributed Databases Notes', 'dbms-sem4.pdf', 'dbms-sem4.pdf', 'Database Management System', 'Chapter 6', 'Semester 4', 4, 'all_students', 'everyone'),
              (703, 'Operating Systems Process Scheduling Notes', 'os-sem4.pdf', 'os-sem4.pdf', 'Operating Systems', 'Chapter 2', 'Semester 4', 4, 'all_students', 'everyone'),
              (704, 'Restricted Faculty Answer Key PDF', 'faculty-key.pdf', 'faculty-key.pdf', 'Database Management System', 'Chapter 1', 'Semester 3', 3, 'all_students', 'teachers_only')`
    );
    await db.run(
      `INSERT INTO note_search_documents (id, content, extraction_status) VALUES
       (701, 'Relational database management system concepts for Semester 3.', 'ok'),
       (702, 'Distributed database management system notes for Semester 4.', 'ok'),
       (703, 'Operating Systems CPU scheduling and deadlock notes for Semester 4.', 'ok'),
       (704, 'Private faculty answer key for DBMS.', 'ok')`
    );

    // Seed Assignments & Submissions: Semester 3 Assignment (id=801) and Semester 4 Assignment (id=802, with Anita's submission)
    await db.run(
      `INSERT INTO assignments (id, title, description, subject, semester, semester_no, cohort_id, audience_scope, visibility, deadline, createdBy)
       VALUES (801, 'Semester 3 DBMS ER Diagram Assignment', 'Design an ER schema for a university.', 'Database Management System', 'Semester 3', 3, 'COHORT_SEM3', 'all_students', 'everyone', '2026-11-20', 'TCH_SEM3'),
              (802, 'Semester 4 OS Shell Scripting Assignment', 'Build a custom POSIX shell in C.', 'Operating Systems', 'Semester 4', 4, 'COHORT_SEM4', 'all_students', 'everyone', '2026-11-25', 'TCH_SEM3')`
    );
    await db.run(
      `INSERT INTO assignment_questions (id, assignmentId, questionNumber, title, description, maxPoints)
       VALUES (901, 801, 1, 'ER Diagram Question', 'Draw entities.', 10),
              (902, 802, 1, 'Process Forking', 'Use fork and execvp.', 20)`
    );
    await db.run(
      `INSERT INTO submissions (id, assignmentId, questionId, studentId, code, questionTitle, submittedAt)
       VALUES (1001, 802, 902, 'STU_SEM4_ANITA', 'int main() { fork(); }', 'Process Forking', '2026-11-02T10:00:00Z')`
    );
    await db.run(
      `INSERT INTO submission_grades (id, questionId, studentId, marksObtained, remarks, checked, released)
       VALUES (1101, 902, 'STU_SEM4_ANITA', 19, 'Private feedback for Anita.', 1, 1)`
    );

    await t.test('Scenario 1: Semester 3 student can retrieve a Semester 4 admin announcement with actual source semester preserved', async () => {
      const notices = await aiSearch.searchNotices(db, sem3Student, { query: 'Operating Systems Workshop Announcement' });
      const sem4Ann = notices.find(n => n.id === 502);
      assert.ok(sem4Ann, 'Semester 3 student must retrieve the Semester 4 admin announcement (id=502)');
      assert.equal(sem4Ann.semester, 'Semester 4', 'Must preserve actual source semester ("Semester 4")');
      assert.equal(sem4Ann.authorRole, 'admin');
      assert.equal(sem4Ann.originalReference, '/posts/502');
    });

    await t.test('Scenario 2: Semester 3 student can retrieve a Semester 5 official notice without mislabeling it as Semester 3', async () => {
      const chatRes = await aiAssistant.handleChat({
        db,
        message: 'Is there any notice for Semester 5 AI lab viva?',
        studentInfo: sem3Student,
        academicContext: sem3Student
      });
      assert.ok(chatRes.reply.includes('Semester 5 AI Lab Viva Official Schedule Notice'), 'Must include Semester 5 notice title');
      assert.ok(chatRes.reply.includes('Semester: Semester 5'), 'Must label the notice as Semester 5, not Semester 3');
      assert.ok(
        chatRes.reply.includes('This notice concerns Semester 5 (you are registered in Semester 3)'),
        'Must clearly explain which semester the notice concerns'
      );
    });

    await t.test('Scenario 3: BIT-wide notices are accessible to all BIT semesters', async () => {
      const resSem3 = await aiSearch.searchNotices(db, sem3Student, { query: 'Resumption of Regular Classes' });
      const resSem7 = await aiSearch.searchNotices(db, sem7Student, { query: 'Resumption of Regular Classes' });
      assert.ok(resSem3.some(n => n.id === 501), 'BIT-wide notice must be accessible to Semester 3 student');
      assert.ok(resSem7.some(n => n.id === 501), 'BIT-wide notice must be accessible to Semester 7 student');
    });

    await t.test('Scenario 4: Student can search all semester syllabuses as well as other-semester syllabuses', async () => {
      const allSylRes = await aiAssistant.handleChat({
        db,
        message: 'Show me the syllabus for all semesters',
        studentInfo: sem3Student,
        academicContext: sem3Student
      });
      assert.match(allSylRes.reply, /BIT All-Semesters Syllabus \(Semesters 1–8\)/);
      assert.match(allSylRes.reply, /Semester 1 Syllabus/);
      assert.match(allSylRes.reply, /Semester 4 Syllabus/);
      assert.match(allSylRes.reply, /Semester 8 Syllabus/);

      const sem5SylRes = await aiAssistant.handleChat({
        db,
        message: 'Show me Semester 5 syllabus',
        studentInfo: sem3Student,
        academicContext: sem3Student
      });
      assert.match(sem5SylRes.reply, /Semester 5 syllabus/i);
    });

    await t.test('Scenario 5: Normal notes searches remain limited to the student\'s assigned semester (never silently mixing other-semester notes)', async () => {
      const chatRes = await aiAssistant.handleChat({
        db,
        message: 'Give me DBMS notes.',
        studentInfo: sem3Student,
        academicContext: sem3Student,
        toolDependencies: {
          searchNotes: (dbArg, opts) => searchNotes(dbArg, opts)
        }
      });
      const returnedIds = chatRes.matchedFiles.map(f => f.id);
      assert.ok(returnedIds.includes(701), 'Must return Semester 3 DBMS note (id=701)');
      assert.ok(!returnedIds.includes(702), 'Must NOT silently mix Semester 4 DBMS note (id=702) into normal Semester 3 results');
    });

    await t.test('Scenario 6: Explicit requests for other-semester notes, all-semester notes, and named cross-semester subjects work', async () => {
      // 6a. "Give me DBMS notes from Semester 4." -> Search Semester 4 only
      const sem4NotesRes = await aiAssistant.handleChat({
        db,
        message: 'Give me DBMS notes from Semester 4.',
        studentInfo: sem3Student,
        academicContext: sem3Student,
        toolDependencies: {
          searchNotes: (dbArg, opts) => searchNotes(dbArg, opts)
        }
      });
      const sem4Ids = sem4NotesRes.matchedFiles.map(f => f.id);
      assert.deepEqual(sem4Ids, [702], 'Explicit Semester 4 DBMS notes request must return only the Semester 4 DBMS note (id=702)');

      // 6b. "Show me all available DBMS notes." -> Search all semesters
      const allNotesRes = await aiAssistant.handleChat({
        db,
        message: 'Show me all available DBMS notes.',
        studentInfo: sem3Student,
        academicContext: sem3Student,
        toolDependencies: {
          searchNotes: (dbArg, opts) => searchNotes(dbArg, opts)
        }
      });
      const allIds = allNotesRes.matchedFiles.map(f => f.id);
      assert.ok(allIds.includes(701) && allIds.includes(702), 'All available DBMS notes request must return both Semester 3 (701) and Semester 4 (702) notes');

      // 6c. Explicitly naming a subject from another semester ("Give me Operating Systems notes") resolves Semester 4
      const osNotesRes = await aiAssistant.handleChat({
        db,
        message: 'Give me Operating Systems notes.',
        studentInfo: sem3Student,
        academicContext: sem3Student,
        toolDependencies: {
          searchNotes: (dbArg, opts) => searchNotes(dbArg, opts)
        }
      });
      assert.ok(osNotesRes.matchedFiles.some(f => f.id === 703), 'Named cross-semester subject (Operating Systems -> Sem 4) must retrieve note 703');
    });

    await t.test('Scenario 7: Normal assignment searches remain semester-scoped', async () => {
      const defaultAssgn = await aiSearch.searchAssignments(db, sem3Student, { query: 'assignment' });
      const ids = defaultAssgn.map(a => a.id);
      assert.ok(ids.includes(801), 'Default assignment search must return Semester 3 assignment (id=801)');
      assert.ok(!ids.includes(802), 'Default assignment search must NOT include Semester 4 assignment (id=802)');
    });

    await t.test('Scenario 8: Explicit cross-semester assignment information requests work without exposing submissions or grades', async () => {
      const crossAssgnRes = await aiAssistant.handleChat({
        db,
        message: 'Show me assignments from Semester 4',
        studentInfo: sem3Student,
        academicContext: sem3Student
      });
      assert.equal(crossAssgnRes.matchedAssignments.length, 1);
      assert.equal(crossAssgnRes.matchedAssignments[0].id, 802);
      assert.equal(crossAssgnRes.matchedAssignments[0].semester, 'Semester 4');
      assert.equal(crossAssgnRes.matchedAssignments[0].studentSubmission, null, 'Cross-semester assignment must never expose any student submission or grading record');
      assert.ok(!/Private feedback for Anita|fork\(\)/i.test(crossAssgnRes.reply), 'Reply must never leak another student submission or remarks');
    });

    await t.test('Scenario 9: Attendance and marks remain strictly personal', async () => {
      assert.equal(resolveRetrievalPolicy(sem3Student, { type: 'attendance' }).policy, RETRIEVAL_POLICIES.PERSONAL_ACADEMIC_RECORDS);
      assert.equal(resolveRetrievalPolicy(sem3Student, { type: 'results' }).policy, RETRIEVAL_POLICIES.PERSONAL_ACADEMIC_RECORDS);

      const crossAtt = await aiAssistant.handleChat({
        db,
        message: "Show me Anita Thapa's attendance",
        studentInfo: sem3Student,
        academicContext: sem3Student
      });
      assert.equal(crossAtt.intent, 'cross_student');

      const crossMarks = await aiAssistant.handleChat({
        db,
        message: "What are Anita Thapa's marks?",
        studentInfo: sem3Student,
        academicContext: sem3Student
      });
      assert.equal(crossMarks.intent, 'cross_student');
    });

    await t.test('Scenario 10: Private posts and restricted resources remain protected', async () => {
      const notices = await aiSearch.searchNotices(db, sem3Student, { query: 'Private Faculty Moderation Briefing' });
      assert.equal(notices.some(n => n.id === 504), false, 'teachers_only notice (id=504) must remain hidden from students');

      const posts = await aiSearch.searchPosts(db, sem3Student, { query: 'Private Cohort Sem 4 Internal Discussion' });
      assert.equal(posts.some(p => p.id === 505), false, 'cohort_only post for another cohort (id=505) must remain hidden');

      const files = await searchNotes(db, { query: 'Restricted Faculty Answer Key', academicContext: sem3Student, searchAllSemesters: true });
      assert.equal(files.some(f => f.id === 704), false, 'teachers_only file (id=704) must remain hidden from students even when searching all semesters');
      assert.equal(canReadResource(sem3Student, { type: 'note', visibility: 'teachers_only', semester_no: 3 }), false);
    });

    await t.test('Scenario 11: Existing teacher and admin permissions remain intact', async () => {
      // Teacher restricted to Semester 3 DBMS cannot access Semester 4 notes
      const tBlocked = await aiAssistant.handleChat({
        db,
        message: 'Show me Semester 4 Operating Systems notes',
        studentInfo: teacherSem3,
        academicContext: teacherSem3
      });
      assert.match(tBlocked.reply, /assigned to teach Semester\(s\) 3/i);

      // Admin can access teachers_only notices and all semesters
      const adminNotices = await aiSearch.searchNotices(db, adminCtx, { query: 'Private Faculty Moderation Briefing' });
      assert.ok(adminNotices.some(n => n.id === 504), 'Admin must be able to retrieve teachers_only notices');
    });

    await t.test('Scenario 12: The 3 November class-resumption notice is found by the original query and all 6 required test queries', async () => {
      const sixQueries = [
        'Hamro class kaile bata ho?',
        'Class kahile suru hunxa?',
        'When do our classes start?',
        'Dashain pachi class kaile start hunxa?',
        'Is there any update about regular BIT classes?',
        'Any notice from another semester?'
      ];

      for (const q of sixQueries) {
        aiAssistant.invalidateCache(db);
        aiAssistant.clearPaginationState();
        const chatRes = await aiAssistant.handleChat({
          db,
          message: q,
          studentInfo: sem3Student,
          academicContext: sem3Student
        });
        assert.ok(
          !chatRes.reply.includes('No matching notices found for your semester'),
          `Query "${q}" must NEVER return "No matching notices found for your semester"`
        );
        if (q === 'Any notice from another semester?') {
          assert.ok(
            chatRes.matchedNotices.some(n => n.id === 502 || n.id === 503),
            'Query "Any notice from another semester?" must return notices from Semester 4 or Semester 5'
          );
        } else {
          assert.ok(
            chatRes.matchedNotices.some(n => n.id === 501 && n.title === 'Resumption of Regular Classes'),
            `Query "${q}" must retrieve the 3 November class-resumption notice (id=501)`
          );
        }
      }
    });
  });
});

