'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { searchNotes, readNoteFileContent, extractRelevantPassage, ensureIndex } = require('../lib/note-search');
const { createTools, routeQuery, formatToolResult, TOOLS } = require('../lib/chat-tools');
const aiAssistant = require('../ai-assistant');

describe('Kyana AI Note File Reading & Inside-Content Attribution', () => {
  // Helper to create an in-memory SQLite database with files and note_search_documents
  async function createTestDb() {
    const client = createClient({ url: 'file::memory:' });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    await client.execute(`
      CREATE TABLE IF NOT EXISTS knowledge_resources (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        canonical_id INTEGER,
        canonical_code TEXT,
        title TEXT NOT NULL,
        source_authority_tier INTEGER NOT NULL,
        author_id TEXT,
        author_role TEXT,
        cohort_id TEXT,
        semester_no INTEGER,
        audience_scope TEXT DEFAULT 'cohort',
        target_all_semesters INTEGER DEFAULT 0,
        visibility TEXT DEFAULT 'everyone',
        web_url TEXT,
        mobile_route TEXT,
        mobile_params TEXT,
        content_hash TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT,
        hidden_at TEXT
      );
    `);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding_model TEXT,
        page_number INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    return { db, client };
  }

  test('1. Shortlists note files and extracts passage inside file matching "css selector"', async () => {
    const { db, client } = await createTestDb();
    try {
      await client.execute({
        sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no, author_role)
              VALUES (1, 'CSS Selectors & Styling', 'web_tech_css.pdf', 'Web Technology I', '2', '1', 1, 'teacher'),
                     (2, 'HTML5 Foundations', 'html5.pdf', 'Web Technology I', '1', '1', 1, 'teacher'),
                     (3, 'Advanced CSS Grid & Flexbox', 'css_layout.pdf', 'Web Technology I', '3', '1', 1, 'student')`,
        args: []
      });

      const cssContent = `
Chapter 2: CSS Selectors and Formatting.
Cascading Style Sheets (CSS) allow web designers to attach formatting rules to HTML documents.
A CSS selector is a pattern used to target and select the specific HTML elements that you want to style.
Common types of CSS selectors include:
1. Element Selector: selects HTML elements based on element name (e.g., p { color: blue; }).
2. ID Selector: uses the id attribute of an HTML element to select a specific unique element (e.g., #intro { font-weight: bold; }).
3. Class Selector: selects elements with a specific class attribute prefixed with a dot (e.g., .highlight { background-color: yellow; }).
4. Attribute Selector: targets elements with specific attributes or attribute values (e.g., input[type="text"]).
5. Pseudo-class Selector: styles an element based on its state, such as a:hover or button:active.
Selectors can be combined using combinators like descendant selector, child combinator (>), and adjacent sibling (+).
      `.trim();

      await client.execute({
        sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
              VALUES (1, ?, 'completed', CURRENT_TIMESTAMP),
                     (2, 'HTML tags and elements for document structure.', 'completed', CURRENT_TIMESTAMP),
                     (3, 'Layout techniques with CSS Grid template columns and Flex direction.', 'completed', CURRENT_TIMESTAMP)`,
        args: [cssContent]
      });

      const results = await searchNotes(db, { query: 'css selector', semester: 1 });
      assert.ok(results.length >= 1, 'Should find matching notes');
      const topNote = results[0];
      assert.strictEqual(topNote.id, 1);
      assert.strictEqual(topNote.title, 'CSS Selectors & Styling');
      assert.strictEqual(topNote.subject, 'Web Technology I');
      assert.strictEqual(topNote.chapter, '2');
      assert.ok(topNote.extractedContent, 'Must contain extracted passage');
      assert.ok(topNote.extractedContent.includes('CSS selector is a pattern'), 'Passage must include definition');
      assert.strictEqual(topNote.content, undefined, 'Raw document content must not pollute file row for backward compatibility');
    } finally {
      client.close();
    }
  });

  test('2. readNoteFileContent reads inside a specific file by ID and returns extracted content with metadata', async () => {
    const { db, client } = await createTestDb();
    try {
      await client.execute({
        sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no)
              VALUES (10, 'DBMS Normalization Notes', 'dbms_norm.pdf', 'Database Management System', '4', '3', 3)`,
        args: []
      });
      const normContent = `
Normalization is the process of organizing data in a database to reduce data redundancy and improve data integrity.
The standard normal forms include:
- First Normal Form (1NF): eliminates repeating groups and requires atomic values.
- Second Normal Form (2NF): in 1NF and all non-key attributes are fully functionally dependent on the primary key.
- Third Normal Form (3NF): in 2NF and eliminates transitive functional dependencies.
- Boyce-Codd Normal Form (BCNF): a stricter version of 3NF where every determinant must be a candidate key.
      `.trim();

      await client.execute({
        sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
              VALUES (10, ?, 'completed', CURRENT_TIMESTAMP)`,
        args: [normContent]
      });

      const academicContext = {
        authenticated: true,
        role: 'student',
        cohort: { currentSemester: 3 }
      };

      const fileData = await readNoteFileContent(db, 10, { query: 'Third Normal Form', academicContext });
      assert.ok(fileData, 'Should retrieve file');
      assert.strictEqual(fileData.id, 10);
      assert.strictEqual(fileData.title, 'DBMS Normalization Notes');
      assert.strictEqual(fileData.subject, 'Database Management System');
      assert.strictEqual(fileData.chapter, '4');
      assert.strictEqual(fileData.hasContent, true);
      assert.ok(fileData.extractedContent.includes('Third Normal Form (3NF)'), 'Should extract relevant passage');
    } finally {
      client.close();
    }
  });

  test('3. executeTool("search_notes") formats extracted content with exact attribution and generates resourceCard', async () => {
    const { db, client } = await createTestDb();
    try {
      await client.execute({
        sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no)
              VALUES (5, 'CSS Basics & Selectors', 'css_notes.pdf', 'Web Technology I', '2', '1', 1)`,
        args: []
      });
      await client.execute({
        sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
              VALUES (5, 'A CSS selector targets HTML elements for styling. Examples are class and id selectors.', 'completed', CURRENT_TIMESTAMP)`,
        args: []
      });

      const academicContext = {
        authenticated: true,
        role: 'student',
        cohort: { currentSemester: 1 }
      };

      const route = routeQuery('what is css selector in notes');
      const toolkit = createTools(db, route, { academicContext });
      const toolResult = await toolkit.executeTool('search_notes', { query: 'css selector' });

      assert.ok(toolResult.files && toolResult.files.length > 0, 'Should return shortlisted files');
      const file = toolResult.files[0];
      assert.strictEqual(file.id, 5);
      assert.strictEqual(file.hasContent, true);
      assert.ok(file.sourceCitation.includes('This is extracted from **CSS Basics & Selectors** (Web Technology I, Chapter 2)'));
      assert.ok(file.resourceCard, 'Should attach resourceCard');
      assert.strictEqual(file.resourceCard.action, 'open_note');
      assert.strictEqual(file.resourceCard.deepLink, '/material/5');
      assert.strictEqual(file.resourceCard.viewUrl, '/api/files/5/view');
      assert.strictEqual(file.resourceCard.downloadUrl, '/api/files/5/download');

      const formatted = formatToolResult('search_notes', toolResult);
      assert.ok(formatted.includes('This is extracted from **CSS Basics & Selectors** (Web Technology I, Chapter 2):'));
      assert.ok(formatted.includes('A CSS selector targets HTML elements'));
    } finally {
      client.close();
    }
  });

  test('4. executeTool("read_note_file") reads inside note file and provides citation', async () => {
    const { db, client } = await createTestDb();
    try {
      await client.execute({
        sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no, audience_scope)
              VALUES (12, 'Computer Networks Transport Layer', 'cn_transport.pdf', 'Data Communication and Computer Networks', '3', '4', 4, 'all_students')`,
        args: []
      });
      await client.execute({
        sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
              VALUES (12, 'TCP provides reliable, connection-oriented data transfer using a three-way handshake.', 'completed', CURRENT_TIMESTAMP)`,
        args: []
      });

      const academicContext = {
        authenticated: true,
        role: 'student',
        cohort: { currentSemester: 4 }
      };

      const route = routeQuery('explain tcp from file 12');
      const toolkit = createTools(db, route, { academicContext });
      const toolResult = await toolkit.executeTool('read_note_file', { file_id: 12, topic: 'TCP' });

      assert.ok(!toolResult.error, 'Should succeed');
      assert.strictEqual(toolResult.id, 12);
      assert.strictEqual(toolResult.hasContent, true);
      assert.ok(toolResult.sourceCitation.includes('This is extracted from **Computer Networks Transport Layer**'));
      assert.ok(toolResult.extractedContent.includes('three-way handshake'));

      const formatted = formatToolResult('read_note_file', toolResult);
      assert.ok(formatted.includes('This is extracted from **Computer Networks Transport Layer**'));
      assert.ok(formatted.includes('three-way handshake'));
    } finally {
      client.close();
    }
  });

  test('5. handleChat: Student asking "what is css selector in uploaded notes" gets extracted content and note card', async () => {
    const { db, client } = await createTestDb();
    try {
      await client.execute({
        sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no, cohort_id, audience_scope)
              VALUES (20, 'Web Tech Selectors Masterclass', 'selectors.pdf', 'Web Technology I', '2', '1', 1, 'cohort_1', 'cohort')`,
        args: []
      });
      await client.execute({
        sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
              VALUES (20, 'A CSS selector links styling declarations to HTML DOM elements. Element, ID, and class selectors are core.', 'completed', CURRENT_TIMESTAMP)`,
        args: []
      });

      const studentInfo = {
        studentId: 'student_sem1',
        role: 'student',
        semester: 'Semester 1'
      };
      const academicContext = {
        authenticated: true,
        studentId: 'student_sem1',
        role: 'student',
        semester: 'Semester 1',
        cohort: { id: 'cohort_1', currentSemester: 1 }
      };

      const result = await aiAssistant.handleChat(
        db,
        'what is css selector in uploaded notes',
        studentInfo,
        [],
        'session_read_test',
        { academicContext }
      );

      assert.ok(result.reply, 'Should have reply');
      assert.ok(result.reply.includes('CSS selector links styling declarations') || result.reply.includes('Web Tech Selectors Masterclass'), 'Reply should reference file content');
      assert.ok(result.reply.includes('This is extracted from'), 'Reply should contain source citation');
      assert.ok(result.resourceCards.length > 0, 'Should return note resource card');
      assert.strictEqual(result.resourceCards[0].id, 20);
      assert.strictEqual(result.resourceCards[0].action, 'open_note');
      assert.strictEqual(result.resourceCards[0].viewUrl, '/api/files/20/view');
    } finally {
      client.close();
    }
  });

  test('6. Semester Authorization: Student in Semester 1 cannot search or read notes belonging to Semester 3', async () => {
    const { db, client } = await createTestDb();
    try {
      await client.execute({
        sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no)
              VALUES (30, 'DBMS Advanced Relational Algebra', 'dbms_ra.pdf', 'Database Management System', '2', '3', 3)`,
        args: []
      });
      await client.execute({
        sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
              VALUES (30, 'Relational algebra operations include selection, projection, and join.', 'completed', CURRENT_TIMESTAMP)`,
        args: []
      });

      const academicContext = {
        authenticated: true,
        studentId: 'student_sem1',
        role: 'student',
        semester: 'Semester 1',
        cohort: { id: 'cohort_1', currentSemester: 1 }
      };

      // Direct tool call to read file 30 belonging to Semester 3
      const route = routeQuery('read file 30');
      const toolkit = createTools(db, route, { academicContext });
      const toolResult = await toolkit.executeTool('read_note_file', { file_id: 30 });
      assert.ok(toolResult.error, 'Should block unauthorized file access');
      assert.match(toolResult.error, /File not found or access denied/i);
    } finally {
      client.close();
    }
  });

  test('7. Scanned or empty PDF without text returns honest indication', async () => {
    const { db, client } = await createTestDb();
    try {
      await client.execute({
        sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no)
              VALUES (40, 'Scanned Handwritten Notes', 'handwritten_scan.pdf', 'Web Technology I', '1', '1', 1)`,
        args: []
      });
      await client.execute({
        sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
              VALUES (40, '', 'empty', CURRENT_TIMESTAMP)`,
        args: []
      });

      const academicContext = {
        authenticated: true,
        studentId: 'student_sem1',
        role: 'student',
        cohort: { currentSemester: 1 }
      };

      const fileData = await readNoteFileContent(db, 40, { query: 'css', academicContext });
      assert.ok(fileData, 'File metadata returned');
      assert.strictEqual(fileData.hasContent, false);
      assert.strictEqual(fileData.extractionStatus, 'empty');
      assert.strictEqual(fileData.extractedContent, '');

      const route = routeQuery('read file 40');
      const toolkit = createTools(db, route, { academicContext });
      const toolResult = await toolkit.executeTool('read_note_file', { file_id: 40 });
      assert.strictEqual(toolResult.hasContent, false);
      const formatted = formatToolResult('read_note_file', toolResult);
      assert.match(formatted, /Could not read inside/i);
    } finally {
      client.close();
    }
  });

  test('8. Kyana AI 3.0: Academic concept question retrieves note from knowledge engine, synthesizes answer, and shows note card', async () => {
    // Test knowledge engine path when KYANA_KNOWLEDGE_V3 is enabled
    const prevFlag = process.env.KYANA_KNOWLEDGE_V3;
    const prevUsers = process.env.KYANA_KNOWLEDGE_V3_USERS;
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
    try {
      const mockNoteRecord = {
        id: 'note:50',
        resourceType: 'note',
        canonicalId: 50,
        title: 'CSS Selectors Master Guide',
        subject: 'Web Technology I',
        chapter: '2',
        semester: 1,
        authorityTier: 3,
        score: 0.92,
        content: '[Type: Note | Title: CSS Selectors Master Guide | Subject: Web Technology I | Chapter: 2]\n\nA CSS selector is used to find or select HTML elements based on element name, id, class, or attribute. For example, .container selects class container.'
      };

      const studentInfo = {
        studentId: 'student_sem1',
        role: 'student',
        semester: 'Semester 1'
      };
      const academicContext = {
        authenticated: true,
        studentId: 'student_sem1',
        role: 'student',
        semester: 'Semester 1',
        cohort: { id: 'cohort_1', currentSemester: 1 }
      };

      const mockDb = {
        isPostgres: false,
        async get(sql, ...params) {
          if (String(sql).includes('FROM files')) {
            return {
              id: 50,
              title: 'CSS Selectors Master Guide',
              subject: 'Web Technology I',
              chapter: '2',
              semester: 'Semester 1',
              semester_no: 1,
              cohort_id: 'cohort_1',
              audience_scope: 'cohort'
            };
          }
          return null;
        },
        async all() { return []; },
        async run() { return { lastInsertRowid: 1 }; }
      };

      let systemPromptSeen = '';
      const mockGenerateReply = async ({ systemPrompt, message }) => {
        systemPromptSeen = systemPrompt;
        return {
          reply: 'This is extracted from **CSS Selectors Master Guide** (Subject: Web Technology I, Chapter: 2):\n\nA CSS selector is used to target and style HTML elements.\n\n<referenced_records>\nnote:50\n</referenced_records>'
        };
      };

      // Mock searchKnowledge for this test
      const searchKnowledgeMod = require('../lib/knowledge-search');
      const origSearch = searchKnowledgeMod.searchKnowledge;
      searchKnowledgeMod.searchKnowledge = async () => [mockNoteRecord];

      try {
        const result = await aiAssistant.handleChat(
          mockDb,
          'what is css selector',
          studentInfo,
          [],
          'session_v3_test',
          {
            academicContext,
            generateReply: mockGenerateReply
          }
        );

        assert.ok(systemPromptSeen.includes('CSS Selectors Master Guide'), 'Knowledge prompt must contain note evidence');
        assert.ok(systemPromptSeen.includes('Type: Note / Study Material'), 'Knowledge prompt must format note authority');
        assert.ok(result.reply.includes('This is extracted from **CSS Selectors Master Guide**'), 'Reply must include extracted attribution');
        assert.strictEqual(result.resourceCards.length, 1, 'Must attach note resource card');
        assert.strictEqual(result.resourceCards[0].id, 50);
        assert.strictEqual(result.resourceCards[0].type, 'note');
        assert.strictEqual(result.resourceCards[0].action, 'open_note');
        assert.strictEqual(result.resourceCards[0].viewUrl, '/api/files/50/view');
        assert.strictEqual(result.resourceCards[0].downloadUrl, '/api/files/50/download');
      } finally {
        searchKnowledgeMod.searchKnowledge = origSearch;
      }
    } finally {
      process.env.KYANA_KNOWLEDGE_V3 = prevFlag;
      process.env.KYANA_KNOWLEDGE_V3_USERS = prevUsers;
    }
  });

  test('9. Kyana AI 3.0: Academic question with no uploaded notes answers from general knowledge without error', async () => {
    const prevFlag = process.env.KYANA_KNOWLEDGE_V3;
    const prevUsers = process.env.KYANA_KNOWLEDGE_V3_USERS;
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
    try {
      const studentInfo = {
        studentId: 'student_sem1',
        role: 'student',
        semester: 'Semester 1'
      };
      const academicContext = {
        authenticated: true,
        studentId: 'student_sem1',
        role: 'student',
        cohort: { currentSemester: 1 }
      };

      const mockDb = {
        isPostgres: false,
        async get() { return null; },
        async all() { return []; },
        async run() { return {}; }
      };

      // Mock searchKnowledge returning empty results
      const searchKnowledgeMod = require('../lib/knowledge-search');
      const origSearch = searchKnowledgeMod.searchKnowledge;
      searchKnowledgeMod.searchKnowledge = async () => [];

      let answered = false;
      const mockGenerateReply = async ({ message }) => {
        answered = true;
        return {
          reply: 'A binary tree is a hierarchical tree data structure in which each node has at most two children.'
        };
      };

      try {
        const result = await aiAssistant.handleChat(
          mockDb,
          'what is a binary tree',
          studentInfo,
          [],
          'session_fallback_test',
          {
            academicContext,
            generateReply: mockGenerateReply
          }
        );

        assert.ok(answered, 'Should call model to answer academic concept directly');
        assert.ok(result.reply.includes('hierarchical tree data structure'), 'Should provide academic explanation');
        assert.ok(!result.reply.includes('bhetiyena'), 'Must not give not-found refusal');
        assert.ok(!result.reply.includes('I couldn’t find any notices'), 'Must not give notices refusal');
      } finally {
        searchKnowledgeMod.searchKnowledge = origSearch;
      }
    } finally {
      process.env.KYANA_KNOWLEDGE_V3 = prevFlag;
      process.env.KYANA_KNOWLEDGE_V3_USERS = prevUsers;
    }
  });

  test('10. Standard path: Direct academic concept question injects semester note passage, cites file, and returns note card', async () => {
    const { db, client } = await createTestDb();
    try {
      await client.execute({
        sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no, author_role, cohort_id, audience_scope)
              VALUES (60, 'Web Technology Complete CSS Guide', 'web_css_guide.pdf', 'Web Technology I', '2', '1', 1, 'teacher', 'cohort_1', 'cohort')`,
        args: []
      });
      await client.execute({
        sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
              VALUES (60, 'Chapter 2 CSS Selectors: A CSS selector targets HTML elements by element name, class (.classname), or ID (#idname). Selectors bind styles to document tree nodes.', 'completed', CURRENT_TIMESTAMP)`,
        args: []
      });

      const studentInfo = {
        studentId: 'student_sem1',
        role: 'student',
        semester: 'Semester 1'
      };
      const academicContext = {
        authenticated: true,
        studentId: 'student_sem1',
        role: 'student',
        semester: 'Semester 1',
        cohort: { id: 'cohort_1', currentSemester: 1 }
      };

      let promptSeen = '';
      const mockGenerateReply = async ({ systemPrompt }) => {
        promptSeen = systemPrompt;
        return {
          reply: 'This is extracted from **Web Technology Complete CSS Guide** (Subject: Web Technology I, Chapter: 2): A CSS selector targets HTML elements by element name, class, or ID.'
        };
      };

      const result = await aiAssistant.handleChat(
        db,
        'what is css selector',
        studentInfo,
        [],
        'session_direct_academic_test',
        {
          academicContext,
          generateReply: mockGenerateReply
        }
      );

      assert.ok(promptSeen.includes('AUTHORIZED CAMPUS STUDY MATERIALS / NOTES:'), 'System prompt must include campus study material evidence');
      assert.ok(promptSeen.includes('Web Technology Complete CSS Guide'), 'System prompt must include file title');
      assert.ok(promptSeen.includes('Chapter 2 CSS Selectors'), 'System prompt must include extracted text');
      assert.ok(result.reply.includes('This is extracted from **Web Technology Complete CSS Guide**'), 'Reply must include extracted file attribution');
      assert.strictEqual(result.resourceCards.length, 1, 'Must attach note resource card');
      assert.strictEqual(result.resourceCards[0].id, 60);
      assert.strictEqual(result.resourceCards[0].action, 'open_note');
      assert.strictEqual(result.resourceCards[0].viewUrl, '/api/files/60/view');
    } finally {
      client.close();
    }
  });

  test('11. Lifecycle hooks: onNoteSaved creates knowledge resources & chunks; onNoteDeleted soft-deletes them', async () => {
    const { db, client } = await createTestDb();
    try {
      const { onNoteSaved, onNoteDeleted } = require('../lib/knowledge-sync');
      const prevFlag = process.env.KYANA_KNOWLEDGE_INDEXING;
      const prevV3 = process.env.KYANA_KNOWLEDGE_V3;
      const prevV3Users = process.env.KYANA_KNOWLEDGE_V3_USERS;
      process.env.KYANA_KNOWLEDGE_INDEXING = 'true';
      process.env.KYANA_KNOWLEDGE_V3 = 'true';
      process.env.KYANA_KNOWLEDGE_V3_USERS = '*';

      try {
        await client.execute({
          sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no, uploadedBy, author_role)
                VALUES (70, 'Digital Logic Notes', 'dl.pdf', 'Digital Logic', '1', '1', 1, 'teacher_1', 'teacher')`,
          args: []
        });
        await client.execute({
          sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
                VALUES (70, 'Page 1: Boolean Algebra and logic gates AND OR NOT.\fPage 2: Karnaugh maps and SOP minimization.', 'completed', CURRENT_TIMESTAMP)`,
          args: []
        });

        // 1. onNoteSaved
        await onNoteSaved(db, { id: 70, uploadedBy: 'teacher_1' });

        const resourceRow = await db.get('SELECT * FROM knowledge_resources WHERE id = ?', 'note:70');
        assert.ok(resourceRow, 'knowledge_resources must contain note:70');
        assert.strictEqual(resourceRow.title, 'Digital Logic Notes');
        assert.strictEqual(resourceRow.resource_type, 'note');
        assert.strictEqual(resourceRow.deleted_at, null);

        const chunkRows = await db.all('SELECT * FROM knowledge_chunks WHERE resource_id = ? ORDER BY chunk_index ASC', 'note:70');
        assert.ok(chunkRows.length >= 2, 'Should create chunk for each page separated by form feed');
        assert.strictEqual(chunkRows[0].page_number, 1);
        assert.strictEqual(chunkRows[1].page_number, 2);

        // 2. onNoteDeleted
        await onNoteDeleted(db, 70);
        const deletedRow = await db.get('SELECT * FROM knowledge_resources WHERE id = ?', 'note:70');
        assert.ok(deletedRow.deleted_at, 'knowledge_resources.deleted_at must be populated after deletion');
      } finally {
        process.env.KYANA_KNOWLEDGE_INDEXING = prevFlag;
        process.env.KYANA_KNOWLEDGE_V3 = prevV3;
        process.env.KYANA_KNOWLEDGE_V3_USERS = prevV3Users;
      }
    } finally {
      client.close();
    }
  });

  test('12. Direct academic query strictly isolates semesters: Semester 1 student asking about relational algebra does NOT receive Semester 3 note', async () => {
    const { db, client } = await createTestDb();
    try {
      await client.execute({
        sql: `INSERT INTO files (id, title, originalName, subject, chapter, semester, semester_no, author_role)
              VALUES (80, 'DBMS Relational Algebra', 'dbms_ra.pdf', 'Database Management System', '3', '3', 3, 'teacher')`,
        args: []
      });
      await client.execute({
        sql: `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
              VALUES (80, 'Relational algebra in Semester 3 covers select, project, cartesian product, and natural join.', 'completed', CURRENT_TIMESTAMP)`,
        args: []
      });

      const studentInfo = {
        studentId: 'student_sem1',
        role: 'student',
        semester: 'Semester 1'
      };
      const academicContext = {
        authenticated: true,
        studentId: 'student_sem1',
        role: 'student',
        semester: 'Semester 1',
        cohort: { id: 'cohort_1', currentSemester: 1 }
      };

      let promptSeen = '';
      const mockGenerateReply = async ({ systemPrompt }) => {
        promptSeen = systemPrompt;
        return {
          reply: 'Relational algebra is a procedural query language used in database systems.'
        };
      };

      const result = await aiAssistant.handleChat(
        db,
        'what is relational algebra',
        studentInfo,
        [],
        'session_isolation_academic_test',
        {
          academicContext,
          generateReply: mockGenerateReply
        }
      );

      assert.ok(!promptSeen.includes('DBMS Relational Algebra'), 'Must NOT inject Semester 3 note into Semester 1 student prompt');
      assert.strictEqual(result.resourceCards.length, 0, 'Must NOT return Semester 3 note card to Semester 1 student');
    } finally {
      client.close();
    }
  });
});
