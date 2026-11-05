'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { handleChat, invalidateCache, clearPaginationState, routeQuery } = require('../ai-assistant');
const { searchNotes, ensureIndex } = require('../lib/note-search');
const { buildNoteKnowledge } = require('../lib/knowledge-builder');
const topics = require('../lib/chat-topics');

async function createPhase1And2TestDb() {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      semester TEXT DEFAULT 'Semester 2',
      cohort_id TEXT DEFAULT 'cohort_sem2',
      avatarUrl TEXT
    );
    CREATE TABLE cohorts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      current_semester INTEGER NOT NULL DEFAULT 2,
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
      moderation_status TEXT NOT NULL DEFAULT 'active',
      hidden_at TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE post_target_semesters (
      post_id INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      PRIMARY KEY (post_id, semester)
    );
    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      originalName TEXT,
      storedName TEXT,
      subject TEXT,
      chapter TEXT,
      semester TEXT,
      semester_no INTEGER,
      uploadedBy TEXT,
      author_role TEXT DEFAULT 'teacher',
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'all_students',
      visibility TEXT DEFAULT 'everyone',
      deleted_at TEXT,
      hidden_at TEXT,
      uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE note_search_documents (
      id INTEGER PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      extraction_status TEXT NOT NULL DEFAULT 'indexed',
      extraction_error TEXT,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      content_truncated INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE routine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semester INTEGER,
      subject_name TEXT,
      subject_code TEXT,
      exam_date TEXT,
      calendar TEXT DEFAULT 'BS',
      weekday TEXT,
      exam_time TEXT,
      room TEXT,
      exam_type TEXT DEFAULT 'Final'
    );
    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      subject TEXT,
      semester TEXT,
      semester_no INTEGER,
      deadline TEXT,
      createdBy TEXT
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

  const db = {
    isPostgres: false,
    client,
    all: async (sql, ...args) => (await client.execute({ sql, args })).rows.map(r => ({ ...r })),
    get: async (sql, ...args) => {
      const rows = (await client.execute({ sql, args })).rows;
      return rows[0] ? { ...rows[0] } : null;
    },
    run: async (sql, ...args) => {
      const res = await client.execute({ sql, args });
      return {
        changes: Number(res.rowsAffected || 0),
        lastInsertRowid: Number(res.lastInsertRowid || 0)
      };
    },
    exec: async (sql) => await client.executeMultiple(sql),
    close: () => client.close()
  };

  await ensureIndex(db);
  return db;
}

describe('Kyana AI — Phase 1 & Phase 2: Unified Notice/Post Synthesis & Smart PDF Note Citations', () => {
  test('1. Syllabus Topic Graph resolves "what is selector in css" to Web Technology I and formats folder hierarchy', () => {
    const resolved = topics.resolveSyllabusConcept('what is selector in css');
    assert.ok(resolved, 'Must resolve "what is selector in css" to a BIT syllabus concept');
    assert.equal(resolved.canonicalSubject, 'Web Technology I');
    assert.equal(resolved.semesterNum, 2);
    assert.match(resolved.unit, /Cascading Style Sheet/i);

    const folderPath = topics.formatNoteFolderPath(
      { subject: 'Web Technology I', chapter: '3' },
      'what is selector in css'
    );
    assert.equal(folderPath, 'Web Technology I / Chapter 3');
  });

  test('2. PDF Note Search scans inside multi-page PDF for "what is selector in css" (without subject in query) and cites file, folder, and page', async () => {
    const db = await createPhase1And2TestDb();
    try {
      // Seed a PDF note under Web Technology I where the title is generic ("Unit 3 Lecture Handout")
      // and "selector" only appears inside Page 3 of the PDF body!
      const multiPageCssPdf = [
        'Table of Contents\n1. Introduction to Web ...... 1\n2. HTML Basics ............. 2\n3. CSS Styling ............. 3',
        'Page 2: HTML Elements and Forms\nHTML uses markup tags to structure web documents.',
        'Page 3: Cascading Style Sheets (CSS)\nA CSS selector is a pattern used to select and target the HTML elements you want to style.\nTypes of selectors include Universal selector (*), Element selector (p, h1), ID selector (#header), Class selector (.card), and Attribute selector ([type="text"]).'
      ].join('\f');

      await db.run(
        `INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, author_role)
         VALUES (301, 'Unit 3 Lecture Handout', 'web_tech_unit3.pdf', 'web_tech_unit3.pdf', 'Web Technology I', 'Chapter 3: CSS', '2', 2, 'teacher')`
      );
      await db.run(
        `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
         VALUES (301, ?, 'indexed', CURRENT_TIMESTAMP)`,
        multiPageCssPdf
      );

      const studentCtx = {
        authenticated: true,
        studentId: 'stu_sem2',
        role: 'student',
        semester: 'Semester 2',
        currentSemester: 2,
        cohortId: 'cohort_sem2',
        cohort: { id: 'cohort_sem2', currentSemester: 2 }
      };

      // 1. Direct searchNotes check
      const found = await searchNotes(db, {
        query: 'what is selector in css',
        academicContext: studentCtx
      });
      assert.equal(found.length, 1, 'Must find the Web Technology I PDF by scanning inside content');
      assert.equal(found[0].id, 301);
      assert.equal(found[0].folderPath, 'Web Technology I / Chapter 3: CSS');
      assert.deepEqual(found[0].pageNumbers, [3], 'Must extract Page 3 (skipping Page 1 TOC)');
      assert.match(found[0].extractedContent, /CSS selector is a pattern used to select/);

      // 2. Full handleChat check (with LLM synthesizer)
      let capturedPrompt = '';
      const chatRes = await handleChat(
        db,
        'what is selector in css',
        studentCtx,
        [],
        'sess_css_selector',
        {
          academicContext: studentCtx,
          generateReply: async ({ systemPrompt, onDelta }) => {
            capturedPrompt = systemPrompt;
            const replyText = 'This is extracted from **Unit 3 Lecture Handout** (Subject: Web Technology I, Chapter: Chapter 3: CSS, Folder: Web Technology I / Chapter 3: CSS, Page: 3): A CSS selector is a pattern used to select and target the HTML elements you want to style, including Universal, Element, ID, Class, and Attribute selectors.';
            if (onDelta) onDelta(replyText);
            return { reply: replyText };
          }
        }
      );

      assert.match(capturedPrompt, /Folder: Web Technology I \/ Chapter 3: CSS/);
      assert.match(capturedPrompt, /Pages: 3/);
      assert.match(chatRes.reply, /Unit 3 Lecture Handout/);
      assert.match(chatRes.reply, /Web Technology I \/ Chapter 3: CSS/);
      assert.equal(chatRes.resourceCards.length, 1);
      assert.equal(chatRes.resourceCards[0].id, 301);
      assert.equal(chatRes.resourceCards[0].folderPath, 'Web Technology I / Chapter 3: CSS');
    } finally {
      db.close();
    }
  });

  test('3. Unified Notice & Post Synthesis: answers class/schedule questions from a community post when no official notice exists', async () => {
    const db = await createPhase1And2TestDb();
    try {
      await db.run(
        `INSERT INTO students (studentId, name, role, semester, cohort_id)
         VALUES ('cr_saugat', 'Saugat Gurung', 'cr', 'Semester 2', 'cohort_sem2'),
                ('stu_aarav', 'Aarav Sharma', 'student', 'Semester 2', 'cohort_sem2')`
      );

      // Seed a regular status post (type='status', category='general') by CR about tomorrow's Web Tech class time
      await db.run(
        `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, target_all_semesters, visibility, audience_scope, created_at)
         VALUES (401, 'cr_saugat', 'Web Tech Morning Class Update', 'Bholi hamro Web Technology class bihana 7:30 AM dekhi Lab 2 ma suru hunxa hai sathi haru.', 'status', 'general', 2, 0, 'everyone', 'all_students', '2026-11-04T12:00:00Z')`
      );
      await db.run(`INSERT INTO post_target_semesters (post_id, semester) VALUES (401, 2)`);

      const studentCtx = {
        authenticated: true,
        studentId: 'stu_aarav',
        name: 'Aarav Sharma',
        role: 'student',
        semester: 'Semester 2',
        currentSemester: 2,
        cohortId: 'cohort_sem2',
        cohort: { id: 'cohort_sem2', currentSemester: 2 }
      };

      invalidateCache(db);
      clearPaginationState();

      // Ask "Hamro Web Technology class kaile suru hunxa?" -> routes to 'notices', falls back to community post 401 and synthesizes answer!
      const res = await handleChat(db, 'Hamro Web Technology class kaile suru hunxa?', studentCtx, [], 'sess_post_fallback', {
        academicContext: studentCtx
      });

      assert.match(res.reply, /Web Tech Morning Class Update/);
      assert.match(res.reply, /7:30 AM/);
      assert.match(res.reply, /Saugat Gurung/);
      assert.ok(
        res.resourceCards.some(c => c.id === 401),
        'Must attach the community post resourceCard (id=401) when answered from a post'
      );
    } finally {
      db.close();
    }
  });

  test('4. buildNoteKnowledge embeds Folder path and Page number into every chunk header', () => {
    const built = buildNoteKnowledge({
      id: 88,
      title: 'CSS Selectors Reference',
      subject: 'Web Technology I',
      chapter: '3',
      semester: '2',
      semester_no: 2,
      author_role: 'teacher',
      content: 'Page 1 Intro to CSS\fPage 2 ID and Class Selectors'
    });

    assert.equal(built.chunks.length, 2);
    assert.match(built.chunks[0].content, /Folder: Web Technology I \/ Chapter 3 \| Page: 1\]/);
    assert.match(built.chunks[1].content, /Folder: Web Technology I \/ Chapter 3 \| Page: 2\]/);
  });

  test('5. Own-Words Paraphrasing & Savage Senior Tone: rewrites notices, posts, and routine in own words with attached cards instead of exact copy-paste', async () => {
    const db = await createPhase1And2TestDb();
    try {
      await db.run(
        `INSERT INTO students (studentId, name, role, semester, cohort_id)
         VALUES ('admin_1', 'Exam Controller', 'admin', 'Semester 2', 'cohort_sem2'),
                ('stu_sem2', 'Saugat', 'student', 'Semester 2', 'cohort_sem2')`
      );

      const rawOfficialText = 'This is to inform all BIT students that the Mid-Term Examination for Semester 2 will commence from 2082-08-15 at 11:00 AM in Hall B. All students are requested to bring their admit card.';
      await db.run(
        `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, target_all_semesters, visibility, audience_scope, created_at)
         VALUES (501, 'admin_1', 'Semester 2 Mid-Term Exam Notice', ?, 'notice', 'exam', 2, 0, 'everyone', 'all_students', '2026-11-10T09:00:00Z')`,
        rawOfficialText
      );
      await db.run(`INSERT INTO post_target_semesters (post_id, semester) VALUES (501, 2)`);

      const studentCtx = {
        authenticated: true,
        studentId: 'stu_sem2',
        name: 'Saugat',
        role: 'student',
        semester: 'Semester 2',
        currentSemester: 2,
        cohortId: 'cohort_sem2',
        cohort: { id: 'cohort_sem2', currentSemester: 2 }
      };

      invalidateCache(db);
      clearPaginationState();

      // 1. Deterministic own-words paraphrasing + roast opener check
      const detRes = await handleChat(db, 'hamro mid term exam notice k xa?', studentCtx, [], 'sess_savage_notice', {
        academicContext: studentCtx,
        chatMode: 'roast'
      });

      assert.doesNotMatch(
        detRes.reply,
        /This is to inform all BIT students that the Mid-Term Examination/,
        'Must paraphrase formal boilerplate rather than dumping exact verbatim notice text'
      );
      assert.match(detRes.reply, /2082-08-15/);
      assert.match(detRes.reply, /11:00 AM/);
      assert.match(detRes.reply, /Make sure you bring their admit card|all BIT students are informed/i);
      assert.ok(detRes.resourceCards.some(c => c.id === 501 && c.type === 'notice'), 'Must attach the related notice card');

      // 2. Routine own-words + savage LLM synthesis check (synthesizeWithLlm: true)
      await db.run(
        `INSERT INTO routine (id, semester, subject_name, subject_code, exam_date, calendar, exam_time, room)
         VALUES (601, 2, 'Web Technology I', 'CMP 124', '2082-08-15', 'BS', '11:00 AM', '204')`
      );

      let capturedRoutinePrompt = '';
      const routineRes = await handleChat(db, 'hamro exam routine kaile xa?', studentCtx, [], 'sess_savage_routine', {
        academicContext: studentCtx,
        chatMode: 'roast',
        synthesizeWithLlm: true,
        generateReply: async ({ systemPrompt }) => {
          capturedRoutinePrompt = systemPrompt;
          return {
            reply: 'Oho बल्ल होस आयो bro? 💀 Timro Semester 2 ko **Web Technology I** exam **2082-08-15 BS** ma **11:00 AM** dekhi **Room 204** ma xa. Full routine card tala attach gardeko xu, hera!'
          };
        }
      });

      assert.match(capturedRoutinePrompt, /CRITICAL PARAPHRASING RULE/i);
      assert.match(routineRes.reply, /Oho बल्ल होस आयो bro/i);
      assert.match(routineRes.reply, /2082-08-15/);
      assert.ok(routineRes.resourceCards.some(c => c.type === 'routine'), 'Must attach the routine resourceCard');
    } finally {
      db.close();
    }
  });
});
