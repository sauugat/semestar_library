'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createClient } = require('@libsql/client');

const { searchNotes, readNoteFileContent, extractRelevantPassage, ensureIndex, indexNote } = require('../lib/note-search');
const { routeQuery, createTools } = require('../lib/chat-tools');
const aiAssistant = require('../ai-assistant');

describe('File 26 & Kyana RAG Fixes (SMTP Page 5 Extraction & Retrieval)', () => {
  const file26Content = [
    'Chapter 1: Basic Concepts of the Web\nGandaki University Mr. Dammar Khadayat\nIntroduction to the World Wide Web and Web architecture.',
    '1.1.1 What is the Internet?\nThe Internet is a global network of millions of interconnected computers and devices that communicate with each other using a standardized set of rules called protocols, primarily TCP/IP.',
    '1.1.2 Web Browsers and Web Servers\nClient server architecture overview.',
    '1.1.3 HTTP and HTTPS Protocols\nHyperText Transfer Protocol details and requests.',
    '1.1.4 Email Protocols\nSimple Mail Transfer Protocol (SMTP) is a TCP/IP protocol used in sending and receiving email. However, since it is limited in its ability to queue messages at the receiving end, it is usually used with one of two other protocols, POP3 or IMAP, that let the user save messages in a server mailbox and download them periodically from the server. In other words, users typically use a program that uses SMTP for sending an email and either POP3 or IMAP for receiving emails.'
  ].join('\f');

  async function createTestDb() {
    const client = createClient({ url: 'file::memory:' });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY,
        title TEXT,
        originalName TEXT,
        storedName TEXT,
        mimeType TEXT,
        sizeBytes INTEGER,
        uploadedBy TEXT,
        author_role TEXT DEFAULT 'student',
        subject TEXT,
        chapter TEXT,
        semester TEXT,
        semester_no INTEGER,
        cohort_id TEXT,
        audience_scope TEXT DEFAULT 'cohort',
        uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS note_search_documents (
        id INTEGER PRIMARY KEY,
        content TEXT,
        extraction_status TEXT,
        extraction_error TEXT,
        indexed_at TEXT,
        content_truncated INTEGER DEFAULT 0
      );
    `);

    const db = {
      isPostgres: false,
      all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
      get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0] || null,
      run: async (sql, ...args) => await client.execute({ sql, args }),
      exec: async (sql) => await client.executeMultiple(sql),
      close: () => client.close()
    };
    await ensureIndex(db);

    // Populate File 26
    await client.execute({
      sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no, cohort_id, audience_scope, author_role)
            VALUES (26, 'Chapter1 Complete Notes GU', '034b57a5a925ced0a67a1e7a76e48320.pdf', 'Web Technology I', 'Unit 1: Basic Concept', '1', 1, 'cohort_1', 'cohort', 'teacher')`,
      args: []
    });
    await client.execute({
      sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
            VALUES (26, ?, 'completed', CURRENT_TIMESTAMP)`,
      args: [file26Content]
    });

    // Populate 3 competitor files with "Protocol" in title to test that content search is NOT skipped
    await client.execute({
      sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no, cohort_id, audience_scope, author_role)
            VALUES (10, 'Network Protocols Overview', 'net_proto.pdf', 'Web Technology I', '1', '1', 1, 'cohort_1', 'cohort', 'teacher'),
                   (11, 'Internet Protocols Reference', 'inet_proto.pdf', 'Web Technology I', '1', '1', 1, 'cohort_1', 'cohort', 'teacher'),
                   (12, 'Client Server Protocols Guide', 'cs_proto.pdf', 'Web Technology I', '1', '1', 1, 'cohort_1', 'cohort', 'teacher')`,
      args: []
    });
    await client.execute({
      sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
            VALUES (10, 'Overview of generic communication rules and network models.', 'completed', CURRENT_TIMESTAMP),
                   (11, 'IP addressing schemes and packet formats.', 'completed', CURRENT_TIMESTAMP),
                   (12, 'Socket programming and client-side protocols.', 'completed', CURRENT_TIMESTAMP)`,
      args: []
    });

    return { db, client };
  }

  test('1. Passage extractor extracts Page 5 containing SMTP definition across multi-page document', () => {
    const tokens = ['smtp', 'protocol'];
    const passage = extractRelevantPassage(file26Content, tokens);

    assert.ok(passage.startsWith('[Page 5]'), 'Must return Page 5 first (best first)');
    assert.ok(passage.includes('Simple Mail Transfer Protocol (SMTP)'), 'Must contain SMTP explanation from page 5');
    assert.ok(!passage.startsWith('[Page 1]'), 'Should prioritize page 5 over page 1 for SMTP query');
  });

  test('2. searchNotes with "explain SMTP protocol" returns File 26 with Page 5 passage', async () => {
    const { db, client } = await createTestDb();
    try {
      const results = await searchNotes(db, { query: 'explain SMTP protocol', semester: 1 });
      assert.ok(results.length >= 1, 'Should find matching notes');
      const file26 = results.find(r => Number(r.id) === 26);
      assert.ok(file26, 'File 26 must be returned in results');
      assert.strictEqual(file26.title, 'Chapter1 Complete Notes GU');
      assert.ok(file26.extractedContent.startsWith('[Page 5]'), 'Extracted content must cite Page 5 first');
      assert.ok(file26.extractedContent.includes('Simple Mail Transfer Protocol (SMTP)'), 'Must contain SMTP definition');
    } finally {
      client.close();
    }
  });

  test('3. searchNotes with Romanized Nepali "SMTP protocol ko barema notes deu" strips stopwords and returns File 26 on Page 5', async () => {
    const { db, client } = await createTestDb();
    try {
      const results = await searchNotes(db, { query: 'SMTP protocol ko barema notes deu', semester: 1 });
      assert.ok(results.length >= 1, 'Should find matching notes');
      const file26 = results.find(r => Number(r.id) === 26);
      assert.ok(file26, 'File 26 must be returned even with Romanized Nepali particles');
      assert.ok(file26.extractedContent.startsWith('[Page 5]'), 'Extracted content must cite Page 5 first');
      assert.ok(file26.extractedContent.includes('Simple Mail Transfer Protocol (SMTP)'), 'Must contain SMTP explanation');
    } finally {
      client.close();
    }
  });

  test('4. Content search is NOT skipped when 3 metadata matches exist (Reciprocal Rank Fusion merges them)', async () => {
    const { db, client } = await createTestDb();
    try {
      // Files 10, 11, 12 all match metadata for "protocol". File 26 matches content for "SMTP" + "protocol".
      const results = await searchNotes(db, { query: 'SMTP protocol', semester: 1 });
      assert.ok(results.length > 0, 'Results must not be empty');
      const topNote = results[0];
      assert.strictEqual(Number(topNote.id), 26, 'File 26 must rank #1 due to strong content match in RRF');
      assert.ok(topNote.extractedContent.includes('[Page 5]'), 'Top note must extract Page 5');
    } finally {
      client.close();
    }
  });

  test('5. handleChat: "explain SMTP protocol" bypasses academicRequest regex gating, retrieves File 26 and invokes LLM', async () => {
    const { db, client } = await createTestDb();
    try {
      const studentInfo = { studentId: 'student_webtech', semester: 'Semester 1' };
      const academicContext = {
        authenticated: true,
        studentId: 'student_webtech',
        role: 'student',
        semester: 'Semester 1',
        cohort: { id: 'cohort_1', currentSemester: 1 }
      };

      let promptReceived = '';
      const mockGenerateReply = async ({ systemPrompt }) => {
        promptReceived = systemPrompt;
        return {
          reply: 'According to **Chapter1 Complete Notes GU** (Web Technology I, Chapter Unit 1: Basic Concept), Simple Mail Transfer Protocol (SMTP) is a TCP/IP protocol used in sending and receiving email.'
        };
      };

      const result = await aiAssistant.handleChat(
        db,
        'explain SMTP protocol',
        studentInfo,
        [],
        'session_smtp_test',
        { academicContext, generateReply: mockGenerateReply }
      );

      assert.ok(promptReceived.includes('AUTHORIZED CAMPUS STUDY MATERIALS / NOTES:'), 'Must include study material prompt header');
      assert.ok(promptReceived.includes('Chapter1 Complete Notes GU'), 'Must include File 26 title in prompt');
      assert.ok(promptReceived.includes('[Page 5]'), 'Prompt must pass Page 5 extracted passage to LLM');
      assert.ok(promptReceived.includes('Simple Mail Transfer Protocol (SMTP)'), 'Prompt must pass SMTP definition');
      assert.ok(result.resourceCards.some(c => Number(c.id) === 26), 'Must include File 26 in resourceCards');
    } finally {
      client.close();
    }
  });

  test('6. handleChat: "SMTP protocol ko barema notes deu" removes directTool bypass and passes Page 5 to LLM with note cards', async () => {
    const { db, client } = await createTestDb();
    try {
      const studentInfo = { studentId: 'student_webtech', semester: 'Semester 1' };
      const academicContext = {
        authenticated: true,
        studentId: 'student_webtech',
        role: 'student',
        semester: 'Semester 1',
        cohort: { id: 'cohort_1', currentSemester: 1 }
      };

      let promptReceived = '';
      let llmInvoked = false;
      const mockGenerateReply = async ({ systemPrompt }) => {
        llmInvoked = true;
        promptReceived = systemPrompt;
        return {
          reply: 'Yaha tapailai SMTP ko barema notes uplabdha cha. This is extracted from **Chapter1 Complete Notes GU**: Simple Mail Transfer Protocol (SMTP) is a TCP/IP protocol used for emails.'
        };
      };

      const result = await aiAssistant.handleChat(
        db,
        'SMTP protocol ko barema notes deu',
        studentInfo,
        [],
        'session_smtp_nepali_test',
        { academicContext, generateReply: mockGenerateReply }
      );

      assert.strictEqual(llmInvoked, true, 'LLM MUST be invoked (directTool bypass removed)');
      assert.ok(promptReceived.includes('Chapter1 Complete Notes GU'), 'Prompt must include File 26 title');
      assert.ok(promptReceived.includes('[Page 5]'), 'Prompt must include Page 5 citation');
      assert.ok(result.resourceCards.some(c => Number(c.id) === 26), 'Must include File 26 in resourceCards');
      assert.ok(result.reply.includes('SMTP'), 'Reply must answer the question');
    } finally {
      client.close();
    }
  });

  test('7. Relevance threshold: "database normalization form" matches DBMS normalization note and excludes admin form file', async () => {
    const { db, client } = await createTestDb();
    try {
      await client.execute({
        sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no, cohort_id, audience_scope, author_role)
              VALUES (101, 'Database Management System Normalization', 'dbms_norm.pdf', 'Database Management System', '4', '1', 1, 'cohort_1', 'cohort', 'teacher'),
                     (102, 'Student Admission Form', 'admission_form.pdf', 'Administrative', '1', '1', 1, 'cohort_1', 'cohort', 'admin')`,
        args: []
      });
      await client.execute({
        sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
              VALUES (101, 'Database normalization organizes fields and tables of a relational database to minimize redundancy. Normal form guidelines include 1NF, 2NF, 3NF, BCNF.', 'completed', CURRENT_TIMESTAMP),
                     (102, 'Official registration form for new student admission. Fill in personal details, address, and guardian information on this form.', 'completed', CURRENT_TIMESTAMP)`,
        args: []
      });

      const results = await searchNotes(db, { query: 'database normalization form', semester: 1 });
      const foundDbms = results.find(r => Number(r.id) === 101);
      const foundAdmin = results.find(r => Number(r.id) === 102);

      assert.ok(foundDbms, 'DBMS normalization file matching 100% of query terms must be returned');
      assert.strictEqual(foundAdmin, undefined, 'Admin form file matching only 1 of 3 distinct terms (33% < 50%) must NOT be returned');
    } finally {
      client.close();
    }
  });

  test('8. Relevance threshold: Query with no relevant notes returns zero cards and no note context', async () => {
    const { db, client } = await createTestDb();
    try {
      const results = await searchNotes(db, { query: 'astronomy black holes quantum mechanics', semester: 1 });
      assert.strictEqual(results.length, 0, 'Zero notes should pass relevance threshold for unrelated query');

      const studentInfo = { studentId: 'student_1', semester: 'Semester 1' };
      const academicContext = {
        authenticated: true,
        studentId: 'student_1',
        role: 'student',
        semester: 'Semester 1',
        cohort: { id: 'cohort_1', currentSemester: 1 }
      };

      let promptReceived = '';
      const mockGenerateReply = async ({ systemPrompt }) => {
        promptReceived = systemPrompt;
        return { reply: 'Black holes are regions of spacetime where gravity is so strong that nothing can escape.' };
      };

      const result = await aiAssistant.handleChat(
        db,
        'astronomy black holes quantum mechanics',
        studentInfo,
        [],
        'session_unrelated_test',
        { academicContext, generateReply: mockGenerateReply }
      );

      assert.strictEqual(result.resourceCards.filter(c => c.type === 'note').length, 0, 'Must return 0 note resource cards');
      assert.ok(!promptReceived.includes('AUTHORIZED CAMPUS STUDY MATERIALS / NOTES:'), 'Must NOT inject note evidence prompt for unrelated query');
    } finally {
      client.close();
    }
  });

  test('9. Route gating: Note search is skipped for code, notices, posts, assignments, and web routes', async () => {
    const { db, client } = await createTestDb();
    try {
      const studentInfo = { studentId: 'student_1', semester: 'Semester 1' };
      const academicContext = {
        authenticated: true,
        studentId: 'student_1',
        role: 'student',
        semester: 'Semester 1',
        cohort: { id: 'cohort_1', currentSemester: 1 }
      };

      // 1. Code route
      let codePrompt = '';
      await aiAssistant.handleChat(
        db,
        'Write python code to compute fibonacci sequence. Code only.',
        studentInfo,
        [],
        'session_code_test',
        {
          academicContext,
          generateReply: async ({ systemPrompt }) => {
            codePrompt = systemPrompt;
            return { reply: 'def fib(n): return n if n <= 1 else fib(n-1) + fib(n-2)' };
          }
        }
      );
      assert.ok(!codePrompt.includes('AUTHORIZED CAMPUS STUDY MATERIALS / NOTES:'), 'Code route must skip note search');

      // 2. Web route
      let webPrompt = '';
      await aiAssistant.handleChat(
        db,
        'What is the latest score in the premier league match today?',
        studentInfo,
        [],
        'session_web_test',
        {
          academicContext,
          toolDependencies: {
            webSearch: async () => ({ results: ['Arsenal won 2-1'] })
          },
          generateReply: async ({ systemPrompt }) => {
            webPrompt = systemPrompt;
            return { reply: 'Arsenal won 2-1 today.' };
          }
        }
      );
      assert.ok(!webPrompt.includes('AUTHORIZED CAMPUS STUDY MATERIALS / NOTES:'), 'Web route must skip note search');
    } finally {
      client.close();
    }
  });

  test('10. Word-boundary matching: extractRelevantPassage matches whole word "form" and ignores "platform", "information", "format"', () => {
    const text = [
      'Page 1 text discussing an online platform and format conversion tools for digital information.',
      'Page 2 text detailing the normal form rules for database schema design.'
    ].join('\f');

    const passage = extractRelevantPassage(text, ['form']);
    assert.ok(passage.includes('[Page 2]'), 'Must match Page 2 which contains the standalone word "form"');
    assert.ok(!passage.startsWith('[Page 1]'), 'Page 1 containing platform/format/information must not be selected over Page 2');
  });

  test('11. Postgres FTS: searchNotes executes on PGlite (PostgreSQL 18.3) with to_tsquery OR and ranking', async () => {
    const { PGlite } = require('@electric-sql/pglite');
    const pg = new PGlite();
    const ver = await pg.query('SELECT version()');
    console.log('[PGlite Engine Verification]:', ver.rows[0].version);
    assert.ok(ver.rows[0].version.includes('PostgreSQL 18'), 'Engine must be PostgreSQL 18.x via PGlite');

    function toPostgresSql(sql) {
      let idx = 1;
      let inString = false;
      let out = '';
      const transformed = sql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
      for (let i = 0; i < transformed.length; i++) {
        const ch = transformed[i];
        if (ch === "'") {
          if (inString && transformed[i + 1] === "'") {
            out += "''";
            i++;
            continue;
          }
          inString = !inString;
          out += ch;
        } else if (ch === '?' && !inString) {
          out += `$${idx++}`;
        } else {
          out += ch;
        }
      }
      return out;
    }

    const pgDb = {
      isPostgres: true,
      all: async (sql, ...params) => {
        const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        return (await pg.query(toPostgresSql(sql), norm)).rows;
      },
      get: async (sql, ...params) => {
        const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        return (await pg.query(toPostgresSql(sql), norm)).rows[0] || null;
      },
      run: async (sql, ...params) => {
        const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        return { changes: (await pg.query(toPostgresSql(sql), norm)).rowCount || 0 };
      },
      exec: async (sql) => await pg.exec(sql)
    };

    await pgDb.exec(`
      CREATE TABLE files (
        id SERIAL PRIMARY KEY,
        title TEXT,
        originalName TEXT,
        storedName TEXT,
        subject TEXT,
        chapter TEXT,
        semester TEXT,
        semester_no INTEGER,
        cohort_id TEXT,
        audience_scope TEXT,
        uploadedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await ensureIndex(pgDb);

    await pgDb.run(
      'INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, cohort_id, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      26, 'Computer Networks Unit 1', 'dccn1.pdf', '034b57.pdf', 'Computer Networks', '1', '4', 4, 'cohort_1', 'cohort'
    );
    await pgDb.run(
      'INSERT INTO note_search_documents (id, content, extraction_status, indexed_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      26, '1.2.5 SMTP Simple Mail Transfer Protocol and email routing', 'indexed'
    );

    const results = await searchNotes(pgDb, { query: 'explain SMTP protocol' });
    console.log('[PGlite FTS Result Count]:', results.length, 'Title:', results[0]?.title, 'Score:', results[0]?.score);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'Computer Networks Unit 1');
    assert.ok(results[0].score > 0);
    assert.ok(results[0].extractedContent.includes('SMTP Simple Mail Transfer Protocol'));
  });

  test('12. Real Local File 26 PDF: "explain SMTP protocol" and "SMTP protocol ko barema notes deu" index real PDF from uploads/ and extract Page 5', async () => {
    const filePath = path.join(__dirname, '../uploads/034b57a5a925ced0a67a1e7a76e48320.pdf');
    assert.ok(fs.existsSync(filePath), `Real File 26 PDF must exist at ${filePath}`);
    const buffer = fs.readFileSync(filePath);

    const client = createClient({ url: 'file::memory:' });
    await client.execute(`CREATE TABLE files (id INTEGER PRIMARY KEY, title TEXT, originalName TEXT, storedName TEXT, subject TEXT, chapter TEXT, semester TEXT, semester_no INTEGER, cohort_id TEXT, audience_scope TEXT, uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE note_search_documents (id INTEGER PRIMARY KEY, content TEXT, extraction_status TEXT, extraction_error TEXT, indexed_at TEXT, content_truncated INTEGER)`);

    const db = {
      isPostgres: false,
      all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
      get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0] || null,
      run: async (sql, ...args) => await client.execute({ sql, args }),
      exec: async (sql) => await client.executeMultiple(sql),
      close: () => client.close()
    };

    const fileRow = {
      id: 26,
      title: 'Data Communication and Computer Networks Unit 1',
      originalName: 'DCCN_Unit_1.pdf',
      storedName: '034b57a5a925ced0a67a1e7a76e48320.pdf',
      subject: 'Data Communication and Computer Networks',
      chapter: '1',
      semester: '4',
      semester_no: 4,
      cohort_id: 'cohort_1',
      audience_scope: 'cohort'
    };
    await client.execute({
      sql: 'INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, cohort_id, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: Object.values(fileRow)
    });

    await indexNote(db, fileRow, { buffer });

    const q1 = await searchNotes(db, { query: 'explain SMTP protocol' });
    console.log('\n--- Real File 26 Query 1: "explain SMTP protocol" ---');
    console.log(q1[0]?.extractedContent);
    assert.ok(q1[0]?.extractedContent.startsWith('[Page 5]'), 'Query 1 Page 5 must come first (best first)');
    assert.ok(q1[0]?.extractedContent.includes('1.2.5 SMTP — Simple Mail Transfer Protocol'), 'Query 1 must contain SMTP section header');
    assert.ok(!q1[0]?.extractedContent.includes('[Page 2]'), 'Page 2 must drop out (< 50% score)');

    const q2 = await searchNotes(db, { query: 'SMTP protocol ko barema notes deu' });
    console.log('\n--- Real File 26 Query 2: "SMTP protocol ko barema notes deu" ---');
    console.log(q2[0]?.extractedContent);
    assert.ok(q2[0]?.extractedContent.startsWith('[Page 5]'), 'Query 2 Page 5 must come first (best first)');
    assert.ok(q2[0]?.extractedContent.includes('1.2.5 SMTP — Simple Mail Transfer Protocol'), 'Query 2 must contain SMTP section header');
    assert.ok(!q2[0]?.extractedContent.includes('[Page 2]'), 'Page 2 must drop out (< 50% score)');

    client.close();
  });

  test('13. Coverage rule: "explain SMTP protocol" must NOT return a file that only mentions "protocol"', async () => {
    const { db, client } = await createTestDb();
    try {
      await client.execute({
        sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no, cohort_id, audience_scope, author_role)
              VALUES (201, 'Networking Protocols Handbook', 'handbook.pdf', 'Data Communication and Computer Networks', '1', '1', 1, 'cohort_1', 'cohort', 'teacher'),
                     (202, 'Internetworking Protocol Suite', 'suite.pdf', 'Data Communication and Computer Networks', '2', '1', 1, 'cohort_1', 'cohort', 'teacher')`,
        args: []
      });
      await client.execute({
        sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
              VALUES (201, 'Comprehensive handbook on communication protocols, transport layer protocols, and routing protocols.', 'completed', CURRENT_TIMESTAMP),
                     (202, 'Protocol suite analysis discussing protocol stacks, network protocols, and data link protocols.', 'completed', CURRENT_TIMESTAMP)`,
        args: []
      });

      const results = await searchNotes(db, { query: 'explain SMTP protocol', semester: 1 });
      const foundFile26 = results.find(r => Number(r.id) === 26);
      const foundCommonOnly = results.filter(r => [201, 202].includes(Number(r.id)));

      assert.ok(foundFile26, 'File 26 matching the rarest term "smtp" must be returned');
      assert.strictEqual(foundCommonOnly.length, 0, 'Files that only mention "protocol" must NOT be returned');
    } finally {
      client.close();
    }
  });

  test('14. Rarity ranking: a rare-term query ranks the page with the rare term first', () => {
    const docWithRareTerm = [
      'Database systems manage structured records. Relational database engines store tables, columns, rows, and database schemas.',
      'Database normalization is the process of organizing attributes and tables of a relational database to minimize data redundancy.'
    ].join('\f');

    const passage = extractRelevantPassage(docWithRareTerm, ['database', 'normalization']);
    assert.ok(passage.startsWith('[Page 2]'), 'Page 2 containing the rare term "normalization" must rank first');
    assert.ok(passage.includes('Database normalization is the process'), 'Passage must include normalization definition');
    assert.ok(!passage.includes('[Page 1]'), 'Page 1 lacking the rare term must be dropped or ranked below');
  });
});
