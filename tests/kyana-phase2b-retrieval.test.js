'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { handleChat, invalidateCache } = require('../ai-assistant');
const {
  createTools,
  formatToolResult,
  routeQuery,
  extractFilters,
  searchQuery,
  parseSyllabusCourseDetails
} = require('../lib/chat-tools');
const {
  extractRelevantPassages,
  extractRelevantPassage,
  readNoteFileContent,
  searchNotes,
  isTocOrIndexPassage
} = require('../lib/note-search');
const { academicSearchTerms, queryTerms } = require('../lib/knowledge-relevance');
const { buildAssignmentKnowledge } = require('../lib/knowledge-builder');
const { onAssignmentSaved } = require('../lib/knowledge-sync');
const { searchKnowledge } = require('../lib/knowledge-search');
const {
  parseNepaliDateExpression,
  bsToAd,
  adToBs,
  matchesDateFilter
} = require('../lib/nepali-dates');

async function createPhase2BTestDb() {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(`
    CREATE TABLE cohorts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      program TEXT NOT NULL DEFAULT 'BIT',
      admission_year INTEGER NOT NULL,
      current_semester INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      semester TEXT,
      cohort_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      avatarUrl TEXT
    );

    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      originalName TEXT,
      storedName TEXT,
      subject TEXT,
      semester TEXT,
      semester_no INTEGER,
      chapter TEXT,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'all_students',
      uploadedBy TEXT,
      uploadDate TEXT,
      uploadedAt TEXT,
      deleted_at TEXT,
      hidden_at TEXT
    );

    CREATE TABLE file_blobs (
      storedName TEXT PRIMARY KEY,
      data BLOB,
      mimeType TEXT,
      updatedAt TEXT
    );

    CREATE TABLE note_search_documents (
      id INTEGER PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      extraction_status TEXT NOT NULL DEFAULT 'ok',
      extraction_error TEXT,
      indexed_at TEXT NOT NULL,
      content_truncated INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE library_custom_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      chapter TEXT NOT NULL
    );

    CREATE TABLE library_chapter_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      original_chapter TEXT NOT NULL,
      new_chapter TEXT,
      is_deleted INTEGER DEFAULT 0
    );

    CREATE TABLE routine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_name TEXT NOT NULL,
      subject_code TEXT,
      exam_date TEXT NOT NULL,
      calendar TEXT DEFAULT 'BS',
      weekday TEXT,
      exam_time TEXT,
      room TEXT,
      semester INTEGER NOT NULL,
      exam_type TEXT DEFAULT 'Final'
    );

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'status',
      category TEXT DEFAULT 'general',
      semester_no INTEGER,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'all_students',
      target_all_semesters INTEGER DEFAULT 0,
      visibility TEXT DEFAULT 'everyone',
      moderation_status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE post_target_semesters (
      post_id INTEGER NOT NULL,
      semester INTEGER NOT NULL
    );

    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      language TEXT DEFAULT 'sql',
      subject TEXT,
      semester TEXT,
      semester_no INTEGER,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'cohort',
      deadline TEXT,
      pdfUrl TEXT,
      pdfName TEXT,
      createdBy TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE assignment_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignmentId INTEGER NOT NULL,
      questionNumber INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT,
      starterCode TEXT,
      language TEXT DEFAULT 'sql',
      maxPoints INTEGER NOT NULL DEFAULT 10
    );

    CREATE TABLE knowledge_resources (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      canonical_id INTEGER,
      canonical_code TEXT,
      title TEXT NOT NULL,
      source_authority_tier INTEGER NOT NULL,
      author_id TEXT,
      author_role TEXT NOT NULL DEFAULT 'student',
      cohort_id TEXT,
      semester_no INTEGER,
      audience_scope TEXT NOT NULL DEFAULT 'cohort',
      target_all_semesters INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'everyone',
      web_url TEXT NOT NULL,
      mobile_route TEXT NOT NULL,
      mobile_params TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      hidden_at TEXT,
      content_hash TEXT NOT NULL
    );

    CREATE TABLE knowledge_chunks (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-001',
      page_number INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE knowledge_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      operation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      scheduled_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  const db = {
    client,
    get: async (sql, ...args) => {
      const res = await client.execute({ sql, args });
      return res.rows[0] || null;
    },
    all: async (sql, ...args) => {
      const res = await client.execute({ sql, args });
      return res.rows || [];
    },
    run: async (sql, ...args) => {
      const res = await client.execute({ sql, args });
      return {
        changes: Number(res.rowsAffected || 0),
        lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null
      };
    },
    getFileBlob: async (storedName) => {
      const res = await client.execute({
        sql: 'SELECT data, mimeType FROM file_blobs WHERE storedName = ?',
        args: [storedName]
      });
      const row = res.rows[0];
      if (!row) return null;
      return {
        buffer: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data),
        mimeType: row.mimeType
      };
    },
    close: () => client.close()
  };

  // Seed Cohort + Student (Semester 3)
  await db.run(
    `INSERT INTO cohorts (id, name, program, admission_year, current_semester, status)
     VALUES ('cohort_2025', 'BIT 2025', 'BIT', 2025, 3, 'active')`
  );
  await db.run(
    `INSERT INTO students (studentId, name, email, role, semester, cohort_id, status)
     VALUES ('STU_S3', 'Aarav Sharma', 'aarav@gu.edu.np', 'student', 'III', 'cohort_2025', 'active')`
  );
  await db.run(
    `INSERT INTO students (studentId, name, email, role, semester, cohort_id, status)
     VALUES ('TCH_1', 'Ramesh Adhikari', 'ramesh@gu.edu.np', 'teacher', 'III', NULL, 'active')`
  );

  // Multi-page PDF note with Table of Contents on Page 1 and actual explanation on Pages 4 & 5
  const multiPageDbmsContent = [
    // Page 1: Table of Contents
    `Table of Contents\n1. Introduction to Database Systems .................... 1\n2. Entity-Relationship Model ........................... 2\n3. Relational Algebra and SQL .......................... 3\n4. Database Normalization (1NF, 2NF, 3NF, BCNF) ........ 4\n5. Transaction Management & Concurrency Control ........ 6`,
    // Page 2: Intro
    `Chapter 1: Introduction to Database Systems\nA Database Management System (DBMS) is software designed to store, retrieve, define, and manage data in a database.`,
    // Page 3: ER Model
    `Chapter 2: Entity-Relationship Model\nAn ER diagram shows entities, attributes, and relationships.`,
    // Page 4: Actual Normalization Explanation
    `Chapter 5: Database Normalization\nDatabase normalization is a systematic design process used to organize relational tables to minimize data redundancy and prevent update, insertion, and deletion anomalies.\nFirst Normal Form (1NF) requires atomic column values with no repeating groups.\nSecond Normal Form (2NF) requires 1NF and removes partial functional dependencies on composite primary keys.`,
    // Page 5: 3NF & BCNF Explanation
    `Third Normal Form (3NF) and BCNF\nA relation is in Third Normal Form (3NF) if it is in 2NF and contains no transitive functional dependencies for non-prime attributes.\nBoyce-Codd Normal Form (BCNF) is a stronger version of 3NF where for every non-trivial functional dependency X -> Y, X must be a superkey of the relation.`
  ].join('\f');

  await db.run(
    `INSERT INTO files (id, title, originalName, storedName, subject, semester, semester_no, chapter, cohort_id, audience_scope, uploadedBy, uploadDate)
     VALUES (101, 'DBMS Complete Lecture Notes', 'dbms-complete.pdf', 'dbms-complete.pdf', 'Database Management System', 'III', 3, 'Chapter 5: Normalization', 'cohort_2025', 'all_students', 'TCH_1', '2026-10-01')`
  );
  await db.run(
    `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
     VALUES (101, ?, 'ok', '2026-10-01T10:00:00Z')`,
    multiPageDbmsContent
  );

  // Additional Chapter-specific notes for Chapter 2 & Chapter 3
  await db.run(
    `INSERT INTO files (id, title, originalName, storedName, subject, semester, semester_no, chapter, cohort_id, audience_scope, uploadedBy, uploadDate)
     VALUES (102, 'DBMS Chapter 2 ER Data Modeling', 'dbms-ch2.pdf', 'dbms-ch2.pdf', 'Database Management System', 'III', 3, 'Chapter 2: ER Data Modeling', 'cohort_2025', 'all_students', 'TCH_1', '2026-10-02')`
  );
  await db.run(
    `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
     VALUES (102, ?, 'ok', '2026-10-02T10:00:00Z')`,
    `Page 1 Header\fChapter 2: Entity-Relationship Data Modeling\nEntities represent real-world objects. Weak entities depend on an identifying owner entity and use a partial key (discriminator).`
  );

  await db.run(
    `INSERT INTO files (id, title, originalName, storedName, subject, semester, semester_no, chapter, cohort_id, audience_scope, uploadedBy, uploadDate)
     VALUES (103, 'DBMS Chapter 3 Relational Data Modeling', 'dbms-ch3.pdf', 'dbms-ch3.pdf', 'Database Management System', 'III', 3, 'Chapter 3: Relational Data Modeling', 'cohort_2025', 'all_students', 'TCH_1', '2026-10-03')`
  );
  await db.run(
    `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
     VALUES (103, ?, 'ok', '2026-10-03T10:00:00Z')`,
    `Chapter 3: Relational Data Modeling\nRelational algebra operations include selection (sigma), projection (pi), natural join, and Cartesian product.`
  );

  await db.run(
    `INSERT INTO files (id, title, originalName, storedName, subject, semester, semester_no, chapter, cohort_id, audience_scope, uploadedBy, uploadDate)
     VALUES (104, 'OS Chapter 3 Deadlock Notes', 'os-ch3-deadlock.pdf', 'os-ch3-deadlock.pdf', 'Operating Systems', 'III', 3, 'Chapter 3: Deadlocks', 'cohort_2025', 'all_students', 'TCH_1', '2026-10-04')`
  );
  await db.run(
    `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
     VALUES (104, ?, 'ok', '2026-10-04T10:00:00Z')`,
    `Table of Contents\n1. Process Management ... 1\n2. CPU Scheduling ... 2\n3. Deadlocks ... 3\fChapter 3: Deadlocks in Operating Systems\nA deadlock happens when a set of processes are blocked because each process holds a resource and waits for another resource acquired by another process.\nThe four Coffman conditions are Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait. Banker's algorithm prevents deadlock by checking safe state.`
  );

  return db;
}

describe('Kyana AI — Phase 2B: Academic Retrieval Intelligence', () => {
  let db;

  beforeEach(async () => {
    db = await createPhase2BTestDb();
    invalidateCache(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  test('1. Multi-passage note retrieval: deprioritizes TOC, returns top 2–3 explanatory passages, deduplicates, and preserves page numbers & metadata', async () => {
    const tocSample = `Table of Contents\n1. Introduction .................... 1\n2. Normalization ................... 4\n3. Transactions .................... 8`;
    assert.equal(isTocOrIndexPassage(tocSample), true);

    const studentCtx = {
      authenticated: true,
      studentId: 'STU_S3',
      role: 'student',
      semester: 'III',
      currentSemester: 3,
      cohortId: 'cohort_2025',
      cohort: { id: 'cohort_2025', currentSemester: 3 }
    };

    // Read note content for "normalization 3NF BCNF"
    const noteRead = await readNoteFileContent(db, 101, {
      query: 'normalization 3NF BCNF',
      academicContext: studentCtx
    });

    assert.ok(noteRead);
    assert.equal(noteRead.hasContent, true);
    assert.equal(noteRead.title, 'DBMS Complete Lecture Notes');
    assert.equal(noteRead.subject, 'Database Management System');
    assert.equal(noteRead.chapter, 'Chapter 5: Normalization');

    // Must extract from pages 4 and 5 (explanatory content), NOT page 1 (Table of Contents)
    assert.ok(Array.isArray(noteRead.passages));
    assert.ok(noteRead.passages.length >= 2 && noteRead.passages.length <= 3);
    assert.ok(noteRead.pageNumbers.includes(4), `Expected page 4 in ${JSON.stringify(noteRead.pageNumbers)}`);
    assert.ok(noteRead.pageNumbers.includes(5), `Expected page 5 in ${JSON.stringify(noteRead.pageNumbers)}`);
    assert.ok(!noteRead.pageNumbers.includes(1), 'Must not pick Page 1 Table of Contents over explanatory pages');
    assert.match(noteRead.extractedContent, /\[Page 4\]/);
    assert.match(noteRead.extractedContent, /\[Page 5\]/);
    assert.match(noteRead.extractedContent, /Boyce-Codd Normal Form/);

    // Verify deduplication on near-identical passages across pages
    const dupDoc = [
      `Normalization reduces data redundancy and prevents update anomalies in relational databases. First Normal Form requires atomic values.`,
      `Normalization reduces data redundancy and prevents update anomalies in relational databases. First Normal Form requires atomic values.`,
      `Third Normal Form removes transitive dependencies where a non-key attribute depends on another non-key attribute.`
    ].join('\f');
    const dedupResult = extractRelevantPassages(dupDoc, ['normalization', 'normal', 'form']);
    assert.equal(dedupResult.passages.length, 2, 'Should deduplicate identical passages');
  });

  test('2. Chapter-aware note search: filters by chapter/unit number and asks clarification when chapter keyword is ambiguous', async () => {
    const studentCtx = {
      authenticated: true,
      studentId: 'STU_S3',
      role: 'student',
      semester: 'III',
      currentSemester: 3,
      cohortId: 'cohort_2025',
      cohort: { id: 'cohort_2025', currentSemester: 3 }
    };

    // "DBMS chapter 2 notes deu" -> routes to notes with subject=Database Management System, chapter=Chapter 2
    const routeCh2 = routeQuery('DBMS chapter 2 notes deu');
    assert.equal(routeCh2.kind, 'notes');
    assert.equal(routeCh2.filters.subject, 'Database Management System');
    assert.equal(routeCh2.filters.chapter, 'Chapter 2');

    const toolkitCh2 = createTools(db, routeCh2, { academicContext: studentCtx });
    const resCh2 = await toolkitCh2.executeTool('search_notes', {
      query: routeCh2.query,
      subject: routeCh2.filters.subject,
      chapter: routeCh2.filters.chapter
    });
    assert.ok(!resCh2.clarification);
    assert.equal(resCh2.files.length, 1);
    assert.equal(resCh2.files[0].id, 102);
    assert.equal(resCh2.files[0].chapter, 'Chapter 2: ER Data Modeling');
    assert.ok(resCh2.files[0].pageNumbers.includes(2));
    assert.match(resCh2.files[0].sourceCitation, /Chapter 2: ER Data Modeling, Pages? .*2/);

    // "OS ko chapter 3 ma deadlock kata xa?" -> matches OS Chapter 3 note on Page 2 (skipping TOC on Page 1)
    // Operating Systems is a Semester 4 course in BIT syllabus
    await db.run(`UPDATE files SET semester = 'IV', semester_no = 4 WHERE id = 104`);
    const sem4StudentCtx = {
      ...studentCtx,
      semester: 'IV',
      currentSemester: 4,
      cohort: { id: 'cohort_2025', currentSemester: 4 }
    };
    const routeOs = routeQuery('OS ko chapter 3 ma deadlock kata xa?');
    assert.equal(routeOs.kind, 'notes');
    assert.equal(routeOs.filters.subject, 'Operating Systems');
    assert.equal(routeOs.filters.chapter, 'Chapter 3');

    const toolkitOs = createTools(db, routeOs, { academicContext: sem4StudentCtx });
    const resOs = await toolkitOs.executeTool('search_notes', {
      query: routeOs.query,
      subject: routeOs.filters.subject,
      chapter: routeOs.filters.chapter
    });
    assert.equal(resOs.files.length, 1);
    assert.equal(resOs.files[0].id, 104);
    assert.deepEqual(resOs.files[0].pageNumbers, [2]);
    assert.match(resOs.files[0].extractedContent, /Coffman conditions/);

    // Ambiguous chapter keyword ("chapter: data modeling" matches both Chapter 2 ER Data Modeling and Chapter 3 Relational Data Modeling)
    const routeAmbig = routeQuery('DBMS chapter: data modeling notes deu');
    const toolkitAmbig = createTools(db, routeAmbig, { academicContext: studentCtx });
    const resAmbig = await toolkitAmbig.executeTool('search_notes', {
      query: '',
      subject: 'Database Management System',
      chapter: 'data modeling'
    });
    assert.ok(resAmbig.clarification, 'Expected clarification for ambiguous chapter name');
    assert.match(resAmbig.clarification, /Which chapter of Database Management System do you mean/i);
    assert.match(resAmbig.clarification, /Chapter 2: ER Data Modeling/);
    assert.match(resAmbig.clarification, /Chapter 3: Relational Data Modeling/);
  });

  test('3. Bilingual query normalization: supports English, Romanized Nepali, Devanagari, and mixed queries without losing technical terms', async () => {
    const studentCtx = {
      authenticated: true,
      studentId: 'STU_S3',
      role: 'student',
      semester: 'III',
      currentSemester: 3,
      cohortId: 'cohort_2025',
      cohort: { id: 'cohort_2025', currentSemester: 3 }
    };

    // Devanagari query: "ऑपररेटिङ सिस्टम को नोट्स देखाऊ."
    const devRoute = routeQuery('ऑपररेटिङ सिस्टम को नोट्स देखाऊ.');
    assert.equal(devRoute.kind, 'notes');
    assert.equal(devRoute.filters.subject, 'Operating Systems');
    const devFiles = await searchNotes(db, {
      query: devRoute.query,
      subject: ['Operating Systems', 'os'],
      academicContext: studentCtx
    });
    assert.equal(devFiles.length, 1);
    assert.equal(devFiles[0].id, 104);

    // Mixed Romanized Nepali query: "DBMS ko normalization note deu."
    const romRoute = routeQuery('DBMS ko normalization note deu.');
    assert.equal(romRoute.kind, 'notes');
    assert.equal(romRoute.filters.subject, 'Database Management System');
    assert.equal(romRoute.query, 'normalization');

    // "Deadlock kasari hunxa?" preserves 'deadlock' and strips 'kasari' & 'hunxa'
    const deadlockTerms = academicSearchTerms('Deadlock kasari hunxa?');
    assert.ok(deadlockTerms.includes('deadlock'));
    assert.ok(!deadlockTerms.includes('kasari'));
    assert.ok(!deadlockTerms.includes('hunxa'));

    // Deictic follow-up in Devanagari: "यो chapter को summary देऊ।"
    const history = [{ role: 'user', content: 'DBMS chapter 2 notes deu' }];
    const followUpRoute = routeQuery('यो chapter को summary देऊ।', history);
    assert.equal(followUpRoute.kind, 'notes');
    assert.equal(followUpRoute.filters.subject, 'Database Management System');
    assert.equal(followUpRoute.filters.chapter, 'Chapter 2');
  });

  test('4. Assignment PDF & structured questions indexing: indexes questions, starter code, and extracted PDF text in knowledge base', async () => {
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';

    try {
      await db.run(
        `INSERT INTO assignments (id, title, description, instructions, language, subject, semester, semester_no, cohort_id, audience_scope, deadline, pdfUrl, pdfName, createdBy, createdAt)
         VALUES (501, 'DBMS SQL Lab Assignment', 'Relational queries lab', 'Submit clean SQL queries.', 'sql', 'Database Management System', 'Semester 3', 3, 'cohort_2025', 'cohort', '2026-11-05T23:59:00Z', '/api/code-lab/pdf/dbms_lab_spec.txt', 'dbms_lab_spec.txt', 'TCH_1', '2026-10-20T10:00:00Z')`
      );
      await db.run(
        `INSERT INTO assignment_questions (assignmentId, questionNumber, title, description, starterCode, language, maxPoints)
         VALUES (501, 1, 'Department Salary Aggregation', 'Write a query using GROUP BY and HAVING to list departments with average salary above 60000.', 'SELECT dept_id, AVG(salary) FROM employees GROUP BY dept_id;', 'sql', 15)`
      );
      await db.run(
        `INSERT INTO file_blobs (storedName, data, mimeType, updatedAt)
         VALUES ('dbms_lab_spec.txt', ?, 'text/plain', '2026-10-20T10:00:00Z')`,
        Buffer.from('Page 1 specification: Use window functions RANK() and DENSE_RANK() for employee ranking.\fPage 2 rubric: Ensure foreign key constraints ON DELETE CASCADE are demonstrated.', 'utf8')
      );

      const assignmentRow = await db.get('SELECT * FROM assignments WHERE id = 501');
      await onAssignmentSaved(db, assignmentRow, { keywordOnly: true });

      const chunks = await db.all('SELECT * FROM knowledge_chunks WHERE resource_id = ? ORDER BY chunk_index ASC', 'assignment:501');
      assert.ok(chunks.length >= 2, `Expected multiple chunks including PDF pages, got ${chunks.length}`);
      const combinedText = chunks.map(c => c.content).join('\n');
      assert.match(combinedText, /Department Salary Aggregation/);
      assert.match(combinedText, /GROUP BY and HAVING/);
      assert.match(combinedText, /SELECT dept_id, AVG\(salary\)/);
      assert.match(combinedText, /DENSE_RANK\(\)/);
      assert.match(combinedText, /ON DELETE CASCADE/);

      // Verify student can retrieve the indexed assignment PDF & question content via searchKnowledge
      const studentCtx = {
        authenticated: true,
        studentId: 'STU_S3',
        role: 'student',
        semester: 'III',
        currentSemester: 3,
        cohortId: 'cohort_2025',
        cohort: { id: 'cohort_2025', currentSemester: 3 }
      };
      const found = await searchKnowledge(db, studentCtx, 'DENSE_RANK window functions assignment', {
        searchMode: 'keyword_only'
      });
      assert.ok(found.length > 0, 'Expected searchKnowledge to find assignment by PDF content');
      assert.equal(found[0].resourceType, 'assignment');
      assert.equal(found[0].canonicalId, 501);
    } finally {
      delete process.env.KYANA_KNOWLEDGE_V3;
      delete process.env.KYANA_KNOWLEDGE_V3_USERS;
    }
  });

  test('5. Syllabus responses: includes unit numbers, titles, topics, teaching hours, learning objectives, textbooks, and lab requirements', async () => {
    // 1. Specific subject syllabus query
    const routeSubj = routeQuery('Show me the syllabus for Database Management System in semester 3');
    assert.equal(routeSubj.kind, 'syllabus');
    const toolkitSubj = createTools(db, routeSubj);
    const resSubj = await toolkitSubj.executeTool('get_syllabus', {
      semester: 3,
      subject: 'Database Management System'
    });
    const formattedSubj = formatToolResult('get_syllabus', resSubj);

    assert.match(formattedSubj, /Learning Objectives:/);
    assert.match(formattedSubj, /Unit 1: Introduction.*5hrs/);
    assert.match(formattedSubj, /Unit 5: Relational Database Design.*7hrs/);
    assert.match(formattedSubj, /Normalization, Different Normal Forms/i);
    assert.match(formattedSubj, /Lab Requirements:/);
    assert.match(formattedSubj, /minimum 10 laboratory exercises/i);

    // 2. Specific unit syllabus query + textbooks check on Microprocessor (Semester 2)
    const routeUnit = routeQuery('What is in Unit 2 of Microprocessor and Computer Architecture syllabus?');
    assert.equal(routeUnit.kind, 'syllabus');
    assert.equal(routeUnit.filters.unitNumber, 2);
    const toolkitUnit = createTools(db, routeUnit);
    const resUnit = await toolkitUnit.executeTool('get_syllabus', {
      subject: 'Microprocessor and Computer Architecture',
      unit: 2
    });
    const formattedUnit = formatToolResult('get_syllabus', resUnit);
    assert.match(formattedUnit, /Unit 2:/);
    assert.ok(!/Unit 1:/.test(formattedUnit), 'Should filter to the requested unit when unit is specified');
    assert.match(formattedUnit, /Textbooks & References:/);
    assert.match(formattedUnit, /Ramesh S\. Gaonkar/);
  });

  test('6. Date-range and BS/AD filtering: converts between BS and AD, normalizes slash dates, supports ranges, and asks clarification on invalid dates', async () => {
    // Verify BS <-> AD conversion accuracy
    // 2080-01-01 BS === 2023-04-14 AD
    assert.equal(bsToAd('2080-01-01'), '2023-04-14');
    assert.equal(adToBs('2023-04-14'), '2080-01-01');
    // Slash-formatted BS date round-trip
    const sampleAd = bsToAd('2083/07/20');
    assert.ok(sampleAd);
    assert.equal(adToBs(sampleAd), '2083-07-20');

    // Seed routine with slash-formatted BS dates and AD dates in Semester 3
    // Suppose referenceDate is sampleAd (which corresponds to 2083-07-20 BS)
    const tomorrowBs = '2083/07/21';
    const tomorrowAd = bsToAd(tomorrowBs);
    const nextWeekBs = '2083/07/25';

    await db.run(
      `INSERT INTO routine (subject_name, subject_code, exam_date, calendar, weekday, exam_time, room, semester, exam_type)
       VALUES ('Database Management System', 'CIT213', ?, 'BS', 'Wednesday', '10:00 AM', 'Room 201', 3, 'Final')`,
      tomorrowBs
    );
    await db.run(
      `INSERT INTO routine (subject_name, subject_code, exam_date, calendar, weekday, exam_time, room, semester, exam_type)
       VALUES ('Operating Systems', 'CIT214', ?, 'BS', 'Sunday', '10:00 AM', 'Room 202', 3, 'Final')`,
      nextWeekBs
    );

    // Parse "bholi" relative to sampleAd (2083-07-20 BS)
    const refDateObj = new Date(`${sampleAd}T06:00:00Z`);
    const bholiInfo = parseNepaliDateExpression('bholi exam routine', refDateObj);
    assert.equal(bholiInfo.date, tomorrowAd);
    assert.equal(bholiInfo.bsDate, '2083-07-21');

    // matchesDateFilter matches slash-formatted BS record against bholiInfo (without comparing BS string to AD string)
    assert.equal(matchesDateFilter('2083/07/21', bholiInfo, 'BS'), true);
    assert.equal(matchesDateFilter('2083/07/25', bholiInfo, 'BS'), false);

    // Explicit BS date range: "2083/07/20 dekhi 2083/07/22 samma"
    const routeRange = routeQuery('semester 3 routine 2083/07/20 dekhi 2083/07/22 samma');
    assert.equal(routeRange.kind, 'routine');
    assert.equal(routeRange.filters.dateInfo.bsStartDate, '2083-07-20');
    assert.equal(routeRange.filters.dateInfo.bsEndDate, '2083-07-22');

    const toolkitRange = createTools(db, routeRange);
    const resRange = await toolkitRange.executeTool('get_routine', { semester: 3 });
    assert.equal(resRange.routine.length, 1);
    assert.equal(resRange.routine[0].subject, 'Database Management System');

    // Invalid BS date (e.g. Kartik 35) asks for clarification instead of guessing
    const routeInvalid = routeQuery('semester 3 routine 2083-07-32');
    // Note: 32 in Kartik (which has 30 days in 2083 BS)
    const invalidDateInfo = parseNepaliDateExpression('routine on Kartik 35 2083');
    assert.equal(invalidDateInfo.unresolvable, true);
    const routeUnresolvable = { ...routeQuery('semester 3 routine'), filters: { semester: 3, subjects: [], dateInfo: invalidDateInfo } };
    const resInvalid = await createTools(db, routeUnresolvable).executeTool('get_routine', { semester: 3 });
    assert.ok(resInvalid.clarification);
    assert.match(resInvalid.clarification, /Could not resolve|verify the date/i);
  });
});
