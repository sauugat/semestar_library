'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { handleChat } = require('../ai-assistant');
const { ensureRagSchema } = require('../lib/rag-schema');
const { formatRow, formatRows } = require('../db');

async function createTestDb() {
  const client = createClient({ url: ':memory:' });
  const db = {
    client,
    dialect: 'sqlite',
    isPostgres: false,
    async run(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      return client.execute({ sql, args: params });
    },
    async get(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      const res = await client.execute({ sql, args: params });
      return formatRow(res.rows[0] || null);
    },
    async all(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      const res = await client.execute({ sql, args: params });
      return formatRows(res.rows || []);
    },
    async exec(sql) {
      return client.executeMultiple(sql);
    }
  };

  await db.exec(`
    CREATE TABLE files (
      id INTEGER PRIMARY KEY,
      storedName TEXT,
      originalName TEXT,
      title TEXT,
      subject TEXT,
      chapter TEXT,
      semester TEXT,
      semester_no INTEGER,
      cohort_id INTEGER,
      audience_scope TEXT DEFAULT 'all_students',
      visibility TEXT DEFAULT 'everyone',
      previewName TEXT,
      uploadedBy TEXT,
      sizeBytes INTEGER DEFAULT 1024,
      uploadedAt TEXT,
      deleted_at TEXT,
      hidden_at TEXT
    );
  `);

  await ensureRagSchema(db);
  return db;
}

test('Kyana Study Partner End-to-End Teaching Flow: "teach me css" -> "next" -> "bujhina"', async (t) => {
  const db = await createTestDb();

  // Seed sample file for Web Technology I
  await db.run(
    `INSERT INTO files (id, title, originalName, subject, semester_no, chapter)
     VALUES (?, ?, ?, ?, ?, ?)`,
    101, 'Chapter3 Complete Notes GU', 'ch3_web_tech_notes.pdf', 'Web Technology I', 2, 'Introducing Cascading Style Sheet'
  );

  await db.run(
    `INSERT INTO document_chunks (
      id, file_id, doc_version, chunk_index, chunk_level,
      page_start, page_end, chapter, unit, section_heading,
      content, clean_content, content_hash, subject, subject_code, semester_no, created_at
    ) VALUES (?, ?, 1, 1, 'child', 1, 3, 'Unit 3', 'Unit 3', 'Introducing Cascading Style Sheet', 'CSS stands for Cascading Style Sheets.', 'CSS stands for Cascading Style Sheets.', 'hash_css', 'Web Technology I', 'CIT123', 2, ?)`,
    'chk_css_1', 101, new Date().toISOString()
  );

  const studentContext = {
    authenticated: true,
    studentId: 'test_student_css_flow',
    role: 'student',
    currentSemester: 2
  };

  // Turn 1: Student says "teach me css"
  const turn1 = await handleChat(db, 'teach me css', studentContext, [], 'sess_css_test');

  assert.equal(turn1.intent, 'study_partner', 'Turn 1 must route to study_partner');
  assert.ok(!turn1.reply.includes('This is extracted from'), 'Must NOT contain "This is extracted from..."');
  assert.ok(turn1.reply.includes('```study_session'), 'Must render study_session visual block');
  assert.ok(turn1.reply.includes('Cascading Style Sheets') || turn1.reply.includes('presentation language'), 'Explains CSS conceptually');
  assert.ok(turn1.reply.includes('Checkpoint Question') || turn1.reply.includes('🎯 Checkpoint'), 'Includes Socratic checkpoint');

  // Verify Course Isolation on Resource Cards: only Web Technology I notes, NEVER Discrete Math
  for (const card of turn1.resourceCards || []) {
    assert.match(card.subject, /Web Technology/i, 'Cards must strictly belong to active course');
  }

  // Turn 2: Student says "next" to advance to micro-topic 2
  const turn2History = [
    { role: 'user', content: 'teach me css' },
    { role: 'assistant', content: turn1.reply, resourceCards: turn1.resourceCards }
  ];
  const turn2 = await handleChat(db, 'next', studentContext, turn2History, 'sess_css_test');

  assert.equal(turn2.intent, 'study_partner', 'Turn 2 follow-up "next" must route to study_partner');
  assert.ok(!turn2.reply.includes('This is extracted from'), 'Turn 2 must NOT dump raw notes');
  assert.ok(turn2.reply.includes('```study_session'), 'Turn 2 must render updated study_session progress');
  assert.ok(turn2.reply.includes('Step 2') || turn2.reply.includes('mastered') || turn2.reply.includes('Next'), 'Advances to step 2');

  // Turn 3: Student says "bujhina, explain simpler"
  const turn3History = [
    ...turn2History,
    { role: 'user', content: 'next' },
    { role: 'assistant', content: turn2.reply, resourceCards: turn2.resourceCards }
  ];
  const turn3 = await handleChat(db, 'bujhina, explain simpler', studentContext, turn3History, 'sess_css_test');

  assert.equal(turn3.intent, 'study_partner', 'Turn 3 remediation must route to study_partner');
  assert.ok(turn3.reply.includes('simpler') || turn3.reply.includes('analogy') || turn3.reply.includes('house') || turn3.reply.includes('break this down'), 'Triggers pedagogical remediation');
});

test('Stepping Detection: 4 words or fewer non-questions ("yes", "oki nexr", "ok", "haan", "next", "nexr") advance active study session', async () => {
  const db = await createTestDb();

  await db.run(
    `INSERT INTO files (id, title, originalName, subject, semester_no, chapter)
     VALUES (?, ?, ?, ?, ?, ?)`,
    301, 'Java Unit 2 Notes', 'unit2_java.pdf', 'Computer Programming II (Java)', 2, 'Unit 2: Introduction to Java'
  );

  const studentContext = {
    authenticated: true,
    studentId: 'student_stepping_test',
    role: 'student',
    currentSemester: 2
  };

  const chapterContext = {
    subject: 'Computer Programming II (Java)',
    subjectCode: 'CIT122',
    semesterNo: 2,
    unitNumber: 2,
    chapterTitle: 'Unit 2: Introduction to Java',
    fileIds: [301]
  };

  const testAdvancingWords = ['yes', 'oki nexr', 'ok', 'haan', 'next', 'nexr'];
  for (const word of testAdvancingWords) {
    const slug = word.replace(/\s+/g, '_');
    const testConvId = `sess_step_${slug}`;
    const wordStudentContext = {
      ...studentContext,
      studentId: `student_step_${slug}`
    };
    const t1 = await handleChat(db, 'teach me this chapter', wordStudentContext, [], testConvId, { chapterContext });
    assert.equal(t1.intent, 'study_partner', 'Must initiate study partner');

    const activeRow = await db.get(`SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`, testConvId);
    assert.ok(activeRow, 'Active study session must be stored in DB');

    const res = await handleChat(
      db,
      word,
      wordStudentContext,
      [
        { role: 'user', content: 'teach me this chapter' },
        { role: 'assistant', content: t1.reply }
      ],
      testConvId,
      { chapterContext }
    );
    assert.equal(res.intent, 'study_partner', `Word "${word}" must route to study_partner when session is active`);
    assert.ok(res.reply.includes('```study_session'), `Word "${word}" must return study session progress`);
  }
});

test('5-step Java Unit 2 session with short-text mock confirms retry path fires on all steps, sends synthetic instruction & limits history', async () => {
  const db = await createTestDb();

  await db.run(
    `INSERT INTO files (id, title, originalName, subject, semester_no, chapter)
     VALUES (?, ?, ?, ?, ?, ?)`,
    401, 'Java Programming Notes Unit 2', 'java_unit2.pdf', 'Computer Programming II (Java)', 2, 'Unit 2: Introduction to Java'
  );

  await db.run(
    `INSERT INTO document_chunks (
      id, file_id, doc_version, chunk_index, chunk_level,
      page_start, page_end, chapter, unit, section_heading,
      content, clean_content, content_hash, subject, subject_code, semester_no, created_at
    ) VALUES (?, ?, 1, 1, 'child', 1, 4, 'Unit 2: Introduction to Java', 'Unit 2', '2.1 Overview', 'Java is platform independent.', 'Java is platform independent.', 'hash_j2_1', 'Computer Programming II (Java)', 'CIT122', 2, ?)`,
    'chk_j2_1', 401, new Date().toISOString()
  );

  const studentContext = {
    authenticated: true,
    studentId: 'student_java_unit2_5steps',
    role: 'student',
    currentSemester: 2
  };

  const chapterContext = {
    subject: 'Computer Programming II (Java)',
    subjectCode: 'CIT122',
    semesterNo: 2,
    unitNumber: 2,
    chapterTitle: 'Unit 2: Introduction to Java',
    fileIds: [401]
  };

  const convId = 'sess_java_unit2_5step_retry';
  const llmCalls = [];
  let retryCount = 0;

  // Mock generator that returns a short response (<180 words) on first call,
  // and full 300+ word response with DEPTH RULES on retry
  const mockGenerateReply = async ({ message, history, systemPrompt }) => {
    llmCalls.push({
      message,
      historyLength: Array.isArray(history) ? history.length : 0,
      systemPromptSnippet: String(systemPrompt || '').slice(0, 300)
    });

    if (typeof message === 'string' && message.includes('[CRITICAL REMINDER: Your previous response was too brief')) {
      retryCount++;
      return {
        reply: [
          `💡 **Intuitive Real-World Analogy:** Think of Java like a universal translator in a bustling international airport. Instead of re-learning every spoken local dialect on Earth, every pilot speaks standard aviation English. Similarly, Java compiles your human source code into universal Bytecode that runs on any machine with a JVM.`,
          ``,
          `⚙️ **Detailed Technical Architecture & Mechanics:** In the university curriculum, understanding the Java execution pipeline is crucial. First, the \`javac\` compiler reads \`.java\` files and generates architecture-neutral \`.class\` files containing bytecode. At runtime, the Java Virtual Machine (JVM) employs a Class Loader, Bytecode Verifier, and Just-In-Time (JIT) compiler to execute the bytecode natively with optimal performance and memory safety.`,
          ``,
          `> *Beyond your notes:* Modern Java implementations rely on HotSpot adaptive optimization to convert heavily frequented bytecode sections into direct assembly machine instructions.`,
          ``,
          `💻 **Concrete Worked Code Example:**`,
          '```java',
          'public class HelloWorld {',
          '    public static void main(String[] args) {',
          '        // Prints output to standard console stream',
          '        System.out.println("Hello, Gandaki University BIT!");',
          '    }',
          '}',
          '```',
          `Line 1 declares the public class matching the filename. Line 2 defines the static main entry point where program control starts. Line 4 invokes the standard output stream.`,
          ``,
          `⚖️ **Tradeoffs, Edge Cases & Common Pitfalls:** Java requires more memory and initial startup time compared to compiled C programs due to JVM overhead and garbage collection pauses. A common student mistake is forgetting that class names must strictly match the filename on disk.`,
          ``,
          `🎯 **Checkpoint Question:** Why does Java compile source code to Bytecode instead of generating direct platform-specific machine code?`
        ].join('\n\n')
      };
    }

    // Short text under 180 words (approx 35 words) to trigger retry
    return {
      reply: 'Java is an object-oriented programming language designed for platform independence via bytecode. 🎯 Checkpoint Question: What is JVM?'
    };
  };

  const options = {
    chapterContext,
    generateReply: mockGenerateReply
  };

  // Step 1: Start lesson for Unit 2
  const turn1 = await handleChat(db, 'teach me java unit 2', studentContext, [], convId, options);
  assert.equal(turn1.intent, 'study_partner');
  assert.ok(turn1.reply.includes('Universal translator') || turn1.reply.includes('Bytecode'), 'Reply must include expanded lesson');

  // Verify first call used synthetic instruction, not raw student text
  assert.match(llmCalls[0].message, /Teach Step 1 of \d+: "Introduction to Java"/);
  assert.equal(llmCalls[0].historyLength, 0, 'Step 1 should have empty history');
  assert.ok(retryCount >= 1, 'Retry path must fire on Step 1 when first output is short');

  const history = [
    { role: 'user', content: 'teach me java unit 2' },
    { role: 'assistant', content: turn1.reply }
  ];

  // Steps 2 through 5: Advance through all 5 micro-topics in Unit 2
  const advancePrompts = ['next', 'ok', 'haan', 'oki nexr'];
  for (let i = 0; i < advancePrompts.length; i++) {
    const prevRetryCount = retryCount;
    const prompt = advancePrompts[i];
    const turnRes = await handleChat(db, prompt, studentContext, history, convId, options);

    assert.equal(turnRes.intent, 'study_partner', `Turn ${i + 2} with "${prompt}" must route to study_partner`);
    assert.ok(retryCount > prevRetryCount, `Retry path must fire on Step ${i + 2}`);

    // Verify history sent to LLM is strictly limited to at most 2 turns
    const lastCall = llmCalls[llmCalls.length - 1];
    assert.ok(lastCall.historyLength <= 2, `History sent to LLM on step ${i + 2} must be <= 2 turns`);

    // Verify synthetic instruction was sent
    assert.match(llmCalls[llmCalls.length - 2].message, /Teach Step \d+ of \d+:/);

    history.push({ role: 'user', content: prompt });
    history.push({ role: 'assistant', content: turnRes.reply });
  }

  // Confirm retry path fired on all 5 steps (5 initial calls + 5 retry calls = 10 total calls)
  assert.equal(retryCount, 5, 'Retry path must fire exactly once on each of the 5 steps');
  assert.equal(llmCalls.length, 10, 'Expected exactly 10 LLM calls (5 initial short + 5 expanded retries)');
});
