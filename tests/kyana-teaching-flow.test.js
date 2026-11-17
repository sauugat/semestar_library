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

test('Stepping Detection: 4 words or fewer non-questions ("yes", "oki nexr", "ok", "haan", "next", "nexr") advance active study session, increment step_index by 1, and use neutral feedback for ok/next', async () => {
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

  const testAdvancingWords = [
    'yes', 'oki nexr', 'ok', 'haan', 'next', 'nexr',
    'continue', 'proceed', 'move on', 'skip', "let's go",
    'understood', 'next topic', 'aagi badham', 'go ahead', 'ready'
  ];
  for (const word of testAdvancingWords) {
    const slug = word.replace(/\s+/g, '_');
    const testConvId = `sess_step_${slug}`;
    const wordStudentContext = {
      ...studentContext,
      studentId: `student_step_${slug}`
    };
    const t1 = await handleChat(db, 'teach me this chapter', wordStudentContext, [], testConvId, { chapterContext });
    assert.equal(t1.intent, 'study_partner', 'Must initiate study partner');

    const activeRowBefore = await db.get(`SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`, testConvId);
    assert.ok(activeRowBefore, 'Active study session must be stored in DB');
    const stepBefore = Number(activeRowBefore.current_step_index || 1);
    assert.equal(stepBefore, 1, 'Initial step index must be 1');

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

    // Requirement 5: Assert current_step_index increased by 1 per advance
    const activeRowAfter = await db.get(`SELECT * FROM study_partner_sessions WHERE conversation_id = ?`, testConvId);
    const stepAfter = Number(activeRowAfter.current_step_index);
    assert.equal(stepAfter, stepBefore + 1, `current_step_index must increase by 1 from ${stepBefore} to ${stepBefore + 1} after "${word}"`);

    // Requirement 6: Neutral feedback for "yes", "ha", "haan", "ok", "okay", "oki", "next", "nexr", NOT "nailed this concept"
    assert.ok(!res.reply.includes('nailed this concept'), `Neutral advance "${word}" must NOT claim student nailed this concept`);
    assert.ok(res.reply.includes('Got it, let’s keep going') || res.reply.includes('keep going'), `Neutral advance "${word}" must use neutral transition`);
  }
});

test('Fresh conversation with old ACTIVE session: "show my routine", "thanks" and "latest notices" must NOT route to study_partner or change session', async () => {
  const db = await createTestDb();

  await db.run(
    `INSERT INTO files (id, title, originalName, subject, semester_no, chapter)
     VALUES (?, ?, ?, ?, ?, ?)`,
    350, 'Java Unit 2 Notes', 'unit2_java.pdf', 'Computer Programming II (Java)', 2, 'Unit 2: Introduction to Java'
  );

  const studentContext = {
    authenticated: true,
    studentId: 'student_isolated_conv',
    role: 'student',
    currentSemester: 2
  };

  const oldConvId = 'conv_old_active_session';
  const freshConvId = 'conv_fresh_new_chat';

  const nowIso = new Date().toISOString();
  await db.run(
    `INSERT INTO study_partner_sessions (
      id, student_id, conversation_id, subject, subject_code, semester_no, unit_number,
      chapter_title, status, pedagogical_stage, current_step_index, total_steps, mastered_steps,
      last_interaction_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'TEACHING', 2, 5, 1, ?, ?, ?)`,
    'old_sess_row_1', studentContext.studentId, oldConvId, 'Computer Programming II (Java)', 'CIT122', 2, 2,
    'Unit 2: Introduction to Java', nowIso, nowIso, nowIso
  );

  const testQueries = ['show my routine', 'thanks', 'latest notices'];
  for (const q of testQueries) {
    const res = await handleChat(db, q, studentContext, [], freshConvId, {
      conversationId: freshConvId
    });

    assert.notEqual(res.intent, 'study_partner', `Query "${q}" in fresh conversation must NOT route to study_partner`);

    // Verify old session was untouched
    const oldRow = await db.get(`SELECT * FROM study_partner_sessions WHERE id = ?`, 'old_sess_row_1');
    assert.equal(oldRow.status, 'ACTIVE', 'Old session status must remain ACTIVE');
    assert.equal(Number(oldRow.current_step_index), 2, 'Old session step_index must remain 2');

    // Verify no new session created for freshConvId
    const freshRow = await db.get(`SELECT * FROM study_partner_sessions WHERE conversation_id = ?`, freshConvId);
    assert.equal(freshRow, null, `No study partner session should be created in freshConvId for query "${q}"`);
  }
});

test('Study loop LLM call preserves student raw reply and remediation/example instruction when student asks "explain with an example"', async () => {
  const db = await createTestDb();

  await db.run(
    `INSERT INTO files (id, title, originalName, subject, semester_no, chapter)
     VALUES (?, ?, ?, ?, ?, ?)`,
    360, 'Java Unit 2 Notes', 'unit2_java.pdf', 'Computer Programming II (Java)', 2, 'Unit 2: Introduction to Java'
  );

  const studentContext = {
    authenticated: true,
    studentId: 'student_example_req',
    role: 'student',
    currentSemester: 2
  };

  const chapterContext = {
    subject: 'Computer Programming II (Java)',
    subjectCode: 'CIT122',
    semesterNo: 2,
    unitNumber: 2,
    chapterTitle: 'Unit 2: Introduction to Java',
    fileIds: [360]
  };

  const convId = 'sess_explain_example_test';
  let capturedLlmCall = null;

  const mockGenerateReply = async (payload) => {
    capturedLlmCall = payload;
    return {
      reply: [
        `💡 **Intuitive Real-World Analogy:** Think of Java Bytecode like an international blueprint.`,
        ``,
        `⚙️ **Detailed Technical Architecture & Mechanics:** Java source code is compiled into .class bytecode files.`,
        ``,
        `💻 **Concrete Worked Example (Code or Structural Breakdown):**`,
        '```java',
        'public class Example {',
        '    public static void main(String[] args) {',
        '        System.out.println("Worked Example Demo");',
        '    }',
        '}',
        '```',
        `Line 1 starts class, line 2 is main, line 3 prints to console.`,
        ``,
        `⚖️ **Tradeoffs, Edge Cases & Common Pitfalls:** JVM incurs small overhead compared to compiled C.`,
        ``,
        `🎯 **Checkpoint Question:** What tool compiles .java files into .class files?`
      ].join('\n\n')
    };
  };

  // Turn 1: Start lesson
  const turn1 = await handleChat(db, 'teach me java unit 2', studentContext, [], convId, {
    chapterContext,
    generateReply: mockGenerateReply
  });
  assert.equal(turn1.intent, 'study_partner');

  // Turn 2: Student replies "explain with an example"
  const history = [
    { role: 'user', content: 'teach me java unit 2' },
    { role: 'assistant', content: turn1.reply }
  ];

  capturedLlmCall = null;
  const turn2 = await handleChat(db, 'explain with an example', studentContext, history, convId, {
    chapterContext,
    generateReply: mockGenerateReply
  });

  assert.equal(turn2.intent, 'study_partner');
  assert.ok(capturedLlmCall, 'Mock LLM must be called');

  // Requirement 3: Mock LLM receives "explain with an example" as raw reply / instruction
  const receivedMessage = String(capturedLlmCall.message || '');
  const receivedPrompt = String(capturedLlmCall.systemPrompt || '');
  assert.ok(
    receivedMessage.includes('explain with an example') || receivedPrompt.includes('explain with an example'),
    'Mock LLM must receive student\'s raw text "explain with an example"'
  );
  assert.match(receivedMessage, /Student's raw input: "explain with an example"/);
  assert.match(receivedMessage, /Student requested remediation\/example: "explain with an example"/);
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

test('Prompt attribution & praise rules: syllabus fallback when no notes vs note citation + beyond your notes, and neutral praise rule', () => {
  const { buildStudyPartnerLlmPrompt } = require('../lib/study-partner-engine');

  const session = {
    subject_code: 'CIT122',
    subject: 'Computer Programming II (Java)',
    semester_no: 2,
    unit_number: 2,
    chapter_title: 'Introduction to Java'
  };

  const step = {
    stepIndex: 1,
    topicTitle: 'Java Overview and Environment'
  };

  const studentEval = {
    studentReply: 'haan',
    feedback: 'Got it, let’s keep going to the next concept.'
  };

  // Case A: No note chunks
  const promptNoNotes = buildStudyPartnerLlmPrompt({
    session,
    step,
    topics: [step],
    noteChunks: [],
    studentAnswerEvaluation: studentEval
  });

  assert.ok(
    promptNoNotes.includes('No teacher notes were found for this topic, so this is from the standard syllabus.'),
    'Prompt without notes must require starting with standard syllabus line'
  );
  assert.ok(
    !promptNoNotes.includes('Beyond your notes:*'),
    'Prompt without notes must NOT instruct or use "Beyond your notes"'
  );
  assert.ok(
    promptNoNotes.includes('Only praise the student if they actually answered the checkpoint question with explanation or substance'),
    'Prompt must include rule to only praise substantive answers and suppress praise for yes/ok/next/haan'
  );

  // Case B: With note chunks
  const noteChunks = [
    {
      id: 'chunk_java_1',
      file_title: 'Java Fundamentals Lecture 02',
      page_start: 3,
      page_end: 4,
      clean_content: 'Java source code is compiled into bytecode (.class files) by the javac compiler.'
    }
  ];

  const promptWithNotes = buildStudyPartnerLlmPrompt({
    session,
    step,
    topics: [step],
    noteChunks,
    studentAnswerEvaluation: studentEval
  });

  assert.ok(
    promptWithNotes.includes('Java Fundamentals Lecture 02') && promptWithNotes.includes('Page 3'),
    'Prompt with notes must include file title and page in excerpts'
  );
  assert.ok(
    promptWithNotes.includes('Beyond your notes:*'),
    'Prompt with notes must specify "Beyond your notes" attribution rule for extra material'
  );
  assert.ok(
    promptWithNotes.includes('Ground your explanation directly in the teacher note excerpts') ||
    promptWithNotes.includes('Ground your explanation in the note excerpts'),
    'Prompt with notes must instruct grounding and citing notes'
  );
  assert.ok(
    promptWithNotes.includes('Cite only page numbers that appear in the excerpts below'),
    'Prompt must include rule: "Cite only page numbers that appear in the excerpts below"'
  );
  assert.ok(
    promptWithNotes.includes('An analogy must map to the real concept; do not invent unrelated metaphors'),
    'Prompt must include rule: "An analogy must map to the real concept; do not invent unrelated metaphors"'
  );

  // Case C: Skipping title-slide and short chunks
  const titleSlideAndShortChunks = [
    {
      id: 'chunk_title',
      file_title: 'Java Lecture 02',
      page_start: 1,
      page_end: 1,
      clean_content: 'Introduction to Java Er. Shiva Ram Dam Assistant Professor Gandaki University'
    },
    {
      id: 'chunk_stub',
      file_title: 'Java Lecture 02',
      page_start: 2,
      page_end: 2,
      clean_content: '2.5 Bytecode'
    },
    {
      id: 'chunk_real',
      file_title: 'Java Lecture 02',
      page_start: 3,
      page_end: 3,
      clean_content: 'Java source code is compiled into platform-independent bytecode (.class files) by the javac compiler, which is executed by the JVM.'
    }
  ];

  const promptFiltered = buildStudyPartnerLlmPrompt({
    session,
    step,
    topics: [step],
    noteChunks: titleSlideAndShortChunks,
    studentAnswerEvaluation: studentEval
  });

  assert.ok(!promptFiltered.includes('Assistant Professor Gandaki University'), 'Must skip title slide chunk');
  assert.ok(!promptFiltered.includes('[Note Excerpt 1 — Java Lecture 02, Page 2]'), 'Must skip very short stub chunk');
  assert.ok(promptFiltered.includes('Page 3'), 'Must retain substantive chunk from Page 3');
  assert.ok(promptFiltered.includes('6. If teaching web/CSS/HTML concepts'), 'Rules must be numbered sequentially without duplicate 5');
});

test('Phase 1: "skip" marks the current step SKIPPED, not MASTERED', async (t) => {
  const db = await createTestDb();
  const { startOrResumeStudySession, advanceStudySessionStep } = require('../lib/study-partner-engine');

  const sessRes = await startOrResumeStudySession(db, {
    studentId: 'student_skip_test',
    conversationId: 'conv_skip_test',
    subject: 'Computer Programming II (Java)',
    semesterNo: 2,
    unitNumber: 2,
    chapterQuery: 'Introduction to Java'
  });

  const sessionId = sessRes.session.id;
  const currentStep = sessRes.session.current_step_index; // 1

  // Advance step with "SKIPPED"
  const advance = await advanceStudySessionStep(db, sessionId, 'student_skip_test', {
    targetStepIndex: currentStep + 1,
    markCurrentStatus: 'SKIPPED'
  });

  assert.equal(advance.currentStepIndex, 2, 'Session should advance to step 2');

  const skippedTopic = await db.get(
    `SELECT * FROM study_partner_topic_progress WHERE session_id = ? AND step_index = ?`,
    sessionId, currentStep
  );
  assert.equal(skippedTopic.status, 'SKIPPED', 'Topic status must be SKIPPED, not MASTERED');
  assert.equal(skippedTopic.mastered_at, null, 'Skipped topic should not have mastered_at timestamp');
});

test('Phase 1 Security: /api/ai/chat rejects conversationId owned by another student before writing messages', async (t) => {
  const db = await createTestDb();
  const aiChatService = require('../lib/ai-chat-service');
  const { createChatHandler } = require('../lib/chat-http');

  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);

  // Student A creates a conversation
  const convA = await aiChatService.createConversation(db, 'student_A', 'Private Chat Student A');
  await aiChatService.saveUserMessage(db, 'student_A', convA.id, 'Secret message from A');

  // Helper to mock express req/res
  function mockReqRes({ studentId, conversationId, message, chapterContext }) {
    const req = {
      student: studentId ? { studentId } : null,
      user: studentId ? { studentId } : null,
      session: studentId ? { studentId } : {},
      body: {
        message: message || 'Hello',
        conversationId,
        chapterContext
      }
    };
    let statusCode = 200;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      }
    };
    return { req, res, getStatus: () => statusCode, getBody: () => responseBody };
  }

  // Case 1: Student B attempts to access Student A's conversationId
  const reqResB = mockReqRes({
    studentId: 'student_B',
    conversationId: convA.id,
    message: 'I am attacking student A conversation'
  });

  const handler = createChatHandler(db);
  await handler(reqResB.req, reqResB.res);

  assert.equal(reqResB.getStatus(), 404, 'Must return 404 when student B accesses student A conversation');
  assert.equal(reqResB.getBody()?.message, 'Conversation not found.');

  // Verify Student B's message was NOT saved into Student A's conversation
  const msgsA = await aiChatService.getMessages(db, 'student_A', convA.id);
  assert.equal(msgsA.length, 1, 'Student A conversation must remain untouched');
  assert.equal(msgsA[0].text, 'Secret message from A');

  // Case 2: Unauthenticated user attempts to access Student A's conversationId
  const reqResAnon = mockReqRes({
    studentId: null,
    conversationId: convA.id,
    message: 'Anon sniffing'
  });
  await handler(reqResAnon.req, reqResAnon.res);
  assert.equal(reqResAnon.getStatus(), 404, 'Must return 404 when unauthenticated request supplies existing conversation');
});

test('Phase 1: Chapter Chat Isolation, Reopening, New Chat, and Multi-Session Coexistence', async (t) => {
  const db = await createTestDb();
  const aiChatService = require('../lib/ai-chat-service');
  const { startOrResumeStudySession, advanceStudySessionStep } = require('../lib/study-partner-engine');

  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);
  const studentId = 'test_student_scope_key';

  // 1. Create a chapter chat for CIT122 Unit 2
  const convUnit2 = await aiChatService.createChapterConversation(db, studentId, {
    subjectCode: 'CIT122',
    semesterNo: 2,
    unit: 2,
    title: 'Unit 2 Java Intro'
  });
  assert.equal(convUnit2.scope_key, 'CIT122|s2|u2', 'Scope key must be CIT122|s2|u2');

  // Start study session in Unit 2
  const sessUnit2 = await startOrResumeStudySession(db, {
    studentId,
    conversationId: convUnit2.id,
    subject: 'Computer Programming II (Java)',
    semesterNo: 2,
    unitNumber: 2,
    chapterQuery: 'Introduction to Java'
  });
  assert.equal(sessUnit2.session.current_step_index, 1);

  // Advance Unit 2 to step 2
  await advanceStudySessionStep(db, sessUnit2.session.id, studentId, {
    targetStepIndex: 2,
    markCurrentStatus: 'MASTERED'
  });

  // Save messages in convUnit2
  await aiChatService.saveUserMessage(db, studentId, convUnit2.id, 'teach me java');
  await aiChatService.saveAssistantMessage(db, studentId, convUnit2.id, 'Here is step 1 ```study_session ...```');

  // Test: Reopen chapter CIT122 Unit 2 -> returns same conversation and messages
  const chatsUnit2 = await aiChatService.getChapterConversations(db, studentId, {
    subjectCode: 'CIT122',
    semesterNo: 2,
    unit: 2
  });
  assert.equal(chatsUnit2.length, 1, 'Should find 1 conversation for Unit 2');
  assert.equal(chatsUnit2[0].id, convUnit2.id, 'Reopening chapter returns same conversation');
  assert.equal(chatsUnit2[0].step, 2, 'Session step is preserved at step 2');
  assert.equal(chatsUnit2[0].status, 'ACTIVE');

  const msgs = await aiChatService.getMessages(db, studentId, convUnit2.id);
  assert.equal(msgs.length, 2, 'Loaded messages preserve conversation history');

  // Test: Other chapter (Unit 3) -> different conversation and scope_key
  const chatsUnit3 = await aiChatService.getChapterConversations(db, studentId, {
    subjectCode: 'CIT122',
    semesterNo: 2,
    unit: 3
  });
  assert.equal(chatsUnit3.length, 0, 'Unit 3 has no conversations yet');

  const convUnit3 = await aiChatService.createChapterConversation(db, studentId, {
    subjectCode: 'CIT122',
    semesterNo: 2,
    unit: 3,
    title: 'Unit 3 Java Classes'
  });
  assert.equal(convUnit3.scope_key, 'CIT122|s2|u3');
  assert.notEqual(convUnit3.id, convUnit2.id, 'Other chapter gets a distinct conversation ID');

  // Start study session in Unit 3
  const sessUnit3 = await startOrResumeStudySession(db, {
    studentId,
    conversationId: convUnit3.id,
    subject: 'Computer Programming II (Java)',
    semesterNo: 2,
    unitNumber: 3,
    chapterQuery: 'Java Classes and Objects'
  });
  assert.equal(sessUnit3.session.current_step_index, 1);

  // Test: Switching chapter does not archive other session
  const checkUnit2Sess = await db.get(`SELECT * FROM study_partner_sessions WHERE id = ?`, sessUnit2.session.id);
  assert.equal(checkUnit2Sess.status, 'ACTIVE', 'Unit 2 session must remain ACTIVE when Unit 3 is started');
  assert.equal(checkUnit2Sess.current_step_index, 2, 'Unit 2 session must remain at step 2');

  const checkUnit3Sess = await db.get(`SELECT * FROM study_partner_sessions WHERE id = ?`, sessUnit3.session.id);
  assert.equal(checkUnit3Sess.status, 'ACTIVE', 'Unit 3 session is also ACTIVE');

  // Test: New chat in Unit 2 -> new ID, step 1, old chat/session intact
  const convUnit2New = await aiChatService.createChapterConversation(db, studentId, {
    subjectCode: 'CIT122',
    semesterNo: 2,
    unit: 2,
    title: 'Unit 2 Fresh Chat'
  });
  assert.notEqual(convUnit2New.id, convUnit2.id, 'New chat gets a new conversation ID');

  const sessUnit2New = await startOrResumeStudySession(db, {
    studentId,
    conversationId: convUnit2New.id,
    subject: 'Computer Programming II (Java)',
    semesterNo: 2,
    unitNumber: 2,
    chapterQuery: 'Introduction to Java'
  });
  assert.equal(sessUnit2New.session.current_step_index, 1, 'New chat session starts at step 1');

  // Old chat session still intact at step 2!
  const checkUnit2Old = await db.get(`SELECT * FROM study_partner_sessions WHERE id = ?`, sessUnit2.session.id);
  assert.equal(checkUnit2Old.current_step_index, 2, 'Old chat session remains intact at step 2');
  assert.equal(checkUnit2Old.status, 'ACTIVE');

  // Querying getChapterConversations for Unit 2 now returns 2 chats, newest first
  const allUnit2Chats = await aiChatService.getChapterConversations(db, studentId, {
    subjectCode: 'CIT122',
    semesterNo: 2,
    unit: 2
  });
  assert.equal(allUnit2Chats.length, 2, 'Returns both conversations for Unit 2');
  assert.equal(allUnit2Chats[0].id, convUnit2New.id, 'Newest chat is first');
});

test('Phase 1: "yes" with empty client history advances by 1 using DB ai_messages (lastWasLesson from DB)', async (t) => {
  const db = await createTestDb();
  const aiChatService = require('../lib/ai-chat-service');
  const { startOrResumeStudySession } = require('../lib/study-partner-engine');

  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);
  const studentId = 'test_student_db_stepping';
  // Create conversation and active study session
  const conv = await aiChatService.createConversation(db, studentId, 'Java Lesson', 'CIT122|s2|u2');
  const convId = conv.id;
  const sess = await startOrResumeStudySession(db, {
    studentId,
    conversationId: convId,
    subject: 'Computer Programming II (Java)',
    semesterNo: 2,
    unitNumber: 2,
    chapterQuery: 'Introduction to Java'
  });

  assert.equal(sess.session.current_step_index, 1, 'Initial session step is 1');

  // Persist assistant lesson in ai_messages containing study_session card
  const lessonText = `Here is your lesson on Java Introduction.\n\`\`\`study_session\n{"title":"Java Intro","step":1,"total":5}\n\`\`\`\n🎯 Checkpoint: Do you understand JVM bytecode?`;
  await aiChatService.saveAssistantMessage(db, studentId, convId, lessonText);

  // Student opens chat afresh: sends "yes" with empty client history ([])
  const studentContext = {
    authenticated: true,
    studentId,
    role: 'student',
    currentSemester: 2
  };

  const reply = await handleChat(
    db,
    'yes',
    studentContext,
    [], // EMPTY client history!
    convId,
    () => {},
    null,
    {
      conversationId: convId,
      chapterContext: {
        subject: 'Computer Programming II (Java)',
        subjectCode: 'CIT122',
        semesterNo: 2,
        unitNumber: 2,
        chapterTitle: 'Introduction to Java'
      }
    }
  );

  assert.equal(reply.intent, 'study_partner', 'Must route to study_partner even with empty client history');

  // Verify DB session was advanced to step 2
  const updatedSess = await db.get(`SELECT * FROM study_partner_sessions WHERE id = ?`, sess.session.id);
  assert.equal(updatedSess.current_step_index, 2, 'Session must advance to step 2 via DB lastWasLesson');
});

test('Item 3: after "New Chat" in the same unit, "teach me java unit 2" starts at step 1 and does not resume the old session', async (t) => {
  const db = await createTestDb();
  const aiChatService = require('../lib/ai-chat-service');
  const { startOrResumeStudySession } = require('../lib/study-partner-engine');

  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);
  const studentId = 'student_new_chat_test';
  const studentContext = {
    authenticated: true,
    studentId,
    role: 'student',
    currentSemester: 2
  };

  // 1. First chat (conv1): student learns Java Unit 2 and reaches step 2
  const conv1 = await aiChatService.createChapterConversation(db, studentId, {
    subjectCode: 'CIT122',
    semesterNo: 2,
    unit: 2,
    title: 'Chat 1'
  });

  const sess1 = await startOrResumeStudySession(db, {
    studentId,
    conversationId: conv1.id,
    subject: 'Computer Programming II (Java)',
    semesterNo: 2,
    unitNumber: 2,
    chapterQuery: 'Introduction to Java'
  });
  assert.equal(sess1.session.current_step_index, 1);

  // Advance conv1 to step 2
  await db.run(`UPDATE study_partner_sessions SET current_step_index = 2 WHERE id = ?`, sess1.session.id);
  const checkSess1 = await db.get(`SELECT * FROM study_partner_sessions WHERE id = ?`, sess1.session.id);
  assert.equal(checkSess1.current_step_index, 2, 'Conv 1 session is at step 2');

  // 2. Student clicks "New Chat" in the same chapter -> creates conv2
  const conv2 = await aiChatService.createChapterConversation(db, studentId, {
    subjectCode: 'CIT122',
    semesterNo: 2,
    unit: 2,
    title: 'Chat 2'
  });

  // 3. Student asks "teach me java unit 2" in the new conversation (conv2)
  const reply = await handleChat(
    db,
    'teach me java unit 2',
    studentContext,
    [],
    conv2.id,
    () => {},
    null,
    {
      conversationId: conv2.id,
      chapterContext: {
        subject: 'Computer Programming II (Java)',
        subjectCode: 'CIT122',
        semesterNo: 2,
        unitNumber: 2,
        chapterTitle: 'Introduction to Java'
      }
    }
  );

  assert.equal(reply.intent, 'study_partner');

  // 4. Verify that conv2 created a brand-new session starting at step 1
  const sess2 = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    conv2.id
  );
  assert.ok(sess2, 'Conv 2 must have an active study session');
  assert.notEqual(sess2.id, sess1.session.id, 'Conv 2 must NOT reuse Conv 1 session ID');
  assert.equal(sess2.current_step_index, 1, 'Conv 2 must start fresh at step 1');

  // Conv 1 session must still be intact at step 2
  const sess1After = await db.get(`SELECT * FROM study_partner_sessions WHERE id = ?`, sess1.session.id);
  assert.equal(sess1After.current_step_index, 2, 'Conv 1 session remains at step 2');
});

test('Item 4: GET /api/ai/conversations must not return rows with scope_key set (mobile general chat isolation)', async (t) => {
  const db = await createTestDb();
  const aiChatService = require('../lib/ai-chat-service');

  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);
  const studentId = 'student_general_vs_scoped';

  // 1. Create a general conversation (scope_key = NULL)
  const generalConv = await aiChatService.createConversation(db, studentId, 'General Chat');
  assert.equal(generalConv.scopeKey, null);

  // 2. Create two chapter-scoped conversations (scope_key != NULL)
  const chapterConv1 = await aiChatService.createChapterConversation(db, studentId, {
    subjectCode: 'CIT122',
    semesterNo: 2,
    unit: 2,
    title: 'Java Unit 2 Chat'
  });
  const chapterConv2 = await aiChatService.createChapterConversation(db, studentId, {
    subjectCode: 'CIT121',
    semesterNo: 2,
    unit: 1,
    title: 'Discrete Math Chat'
  });

  // 3. Call getConversations (the backend handler for GET /api/ai/conversations)
  const generalList = await aiChatService.getConversations(db, studentId);

  // 4. Verify only the general conversation is returned; scoped ones are excluded
  assert.equal(generalList.length, 1, 'Must return exactly 1 general conversation');
  assert.equal(generalList[0].id, generalConv.id, 'Returned conversation must be the general one');
  assert.equal(generalList[0].scopeKey, null, 'scopeKey must be null');

  // Verify chapter-scoped conversations are returned by getChapterConversations
  const javaChats = await aiChatService.getChapterConversations(db, studentId, {
    subjectCode: 'CIT122',
    semesterNo: 2,
    unit: 2
  });
  assert.equal(javaChats.length, 1, 'Chapter query returns the chapter chat');
  assert.equal(javaChats[0].id, chapterConv1.id);

  // Verify getOrCreateActiveConversation returns general chat, not chapter chat
  const activeConv = await aiChatService.getOrCreateActiveConversation(db, studentId);
  assert.equal(activeConv.id, generalConv.id, 'getOrCreateActiveConversation must return general conversation');
});

test('Item 2: End-to-end test through createChatHandler (real save path, fake assistant/LLM)', async (t) => {
  const db = await createTestDb();
  const aiChatService = require('../lib/ai-chat-service');
  const { createChatHandler } = require('../lib/chat-http');
  const realAiAssistant = require('../ai-assistant');

  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);
  const studentId = 'e2e_student_real_save';
  const convId = 'conv_e2e_lesson_flow';

  // Seed conversation
  await aiChatService.createConversation(db, studentId, 'Java Chapter Chat', 'CIT122|s2|u2');
  // Update its id to convId
  await db.run(`UPDATE ai_conversations SET id = ? WHERE student_id = ?`, convId, studentId);

  // Fake LLM provider that returns a valid 300+ word lesson when requested
  const fakeGenerateReply = async ({ message, systemPrompt }) => {
    return {
      reply: [
        '### 1. 💡 Intuitive Real-World Analogy',
        'Think of the Java Virtual Machine like a universal power adapter when traveling worldwide.',
        '### 2. ⚙️ Detailed Technical Architecture & Mechanics',
        'Java source code (.java) is compiled by javac into platform-independent bytecode stored in .class files. The Java Virtual Machine loads bytecode, verifies bytecode integrity with the Bytecode Verifier, and executes it via the Execution Engine using a combination of the Interpreter and Just-In-Time (JIT) compiler.',
        '### 3. 💻 Concrete Worked Example (Code or Structural Breakdown)',
        '```java\npublic class HelloWorld {\n  public static void main(String[] args) {\n    System.out.println("Hello, Gandaki University!");\n  }\n}\n```',
        '### 4. ⚖️ Tradeoffs, Edge Cases & Common Pitfalls',
        'Common misconception: Thinking Java bytecode can run on hardware without a JVM. The JVM must be installed specifically for the host operating system.',
        '### 5. 🎯 Checkpoint Question',
        'What file extension is generated after running the javac compiler on a .java source file?'
      ].join('\n\n')
    };
  };

  const assistantWrapper = {
    handleChat(database, userMessage, studentInfo, history, conversationId, options) {
      return realAiAssistant.handleChat(database, userMessage, studentInfo, history, conversationId, {
        ...options,
        generateReply: fakeGenerateReply
      });
    }
  };

  const handler = createChatHandler(db, assistantWrapper);

  function createMockHttp({ message, history, conversationId, chapterContext }) {
    const req = {
      student: { studentId, role: 'student', currentSemester: 2 },
      user: { studentId, role: 'student', currentSemester: 2 },
      session: {
        studentId,
        role: 'student',
        currentSemester: 2,
        save: (cb) => { if (typeof cb === 'function') cb(null); }
      },
      body: {
        message,
        history,
        conversationId,
        chapterContext
      }
    };
    let statusCode = 200;
    let jsonResult = null;
    let responseEnded = false;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonResult = data;
        responseEnded = true;
        return this;
      },
      end() {
        responseEnded = true;
        return this;
      }
    };
    return { req, res, getResult: () => jsonResult, getStatus: () => statusCode };
  }

  const chapterContext = {
    subject: 'Computer Programming II (Java)',
    subjectCode: 'CIT122',
    semesterNo: 2,
    unitNumber: 2,
    chapterTitle: 'Introduction to Java'
  };

  // Turn 1: Authenticated student sends "teach me java unit 2" with chapterContext
  const turn1 = createMockHttp({
    message: 'teach me java unit 2',
    history: [],
    conversationId: convId,
    chapterContext
  });
  await handler(turn1.req, turn1.res);

  assert.equal(turn1.getStatus(), 200, 'Turn 1 must succeed with 200');
  const turn1Result = turn1.getResult();
  assert.equal(turn1Result.intent, 'study_partner');

  // Verify DB messages via aiChatService.getMessages (endpoint GET /api/ai/conversations/:id/messages)
  const storedMessages = await aiChatService.getMessages(db, studentId, convId, 10);
  assert.ok(storedMessages.length >= 2, 'Stored messages must include user and assistant turns');
  const assistantMsg = storedMessages.find(m => m.sender === 'assistant');
  assert.ok(assistantMsg, 'Assistant message must be stored in DB');

  // Assert: stored assistant text or metadata still lets the client render the study_session card
  const hasStudySessionCard = assistantMsg.text.includes('study_session') ||
    (assistantMsg.metadata && (assistantMsg.metadata.studySession || assistantMsg.metadata.intent === 'study_partner'));
  assert.ok(hasStudySessionCard, 'Stored assistant text or metadata must contain the study_session card');

  // Verify session step is initially 1
  const sessionAfterTurn1 = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    convId
  );
  assert.equal(sessionAfterTurn1.current_step_index, 1, 'Initial session step must be 1');

  // Turn 2: Student sends "yes" with history: [] (clean client history)
  const turn2 = createMockHttp({
    message: 'yes',
    history: [],
    conversationId: convId,
    chapterContext
  });
  await handler(turn2.req, turn2.res);

  assert.equal(turn2.getStatus(), 200, 'Turn 2 must succeed with 200');

  // Assert: lastWasLesson was true from DB, session stepped from 1 -> 2
  const sessionAfterTurn2 = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    convId
  );
  assert.equal(sessionAfterTurn2.current_step_index, 2, 'Session step index must advance from 1 to 2');
});

test('Item 3: lib/chat-http.js ownership check fails closed (500) if DB lookup throws', async (t) => {
  const db = await createTestDb();
  const aiChatService = require('../lib/ai-chat-service');
  const { createChatHandler } = require('../lib/chat-http');

  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);

  // Wrap db with a get method that throws on ownership check
  const failingDb = {
    ...db,
    async get(sql, ...args) {
      if (typeof sql === 'string' && sql.includes('SELECT student_id FROM ai_conversations')) {
        throw new Error('Database connection failed or query error');
      }
      return db.get(sql, ...args);
    }
  };

  let assistantCalled = false;
  const dummyAssistant = {
    async handleChat() {
      assistantCalled = true;
      return { reply: 'Should never reach here' };
    }
  };

  const handler = createChatHandler(failingDb, dummyAssistant);

  let statusCode = 200;
  let jsonResult = null;
  const req = {
    student: { studentId: 'student_fail_closed' },
    body: {
      message: 'Hello',
      conversationId: 'conv_any_id'
    }
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResult = data;
      return this;
    }
  };

  await handler(req, res);

  assert.equal(statusCode, 500, 'Must return 500 when conversation ownership check throws');
  assert.equal(assistantCalled, false, 'Assistant must NOT be invoked when ownership check throws');
  assert.ok(jsonResult?.message?.includes('ownership'), 'Error message must reflect ownership verification failure');
});

test('Item 5: Server chapter-chats validation, normalization, and 30-chat cap', async (t) => {
  const db = await createTestDb();
  const aiChatService = require('../lib/ai-chat-service');

  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);
  const studentId = 'student_cap_validation';

  // 1. Validation checks
  const badSubject = aiChatService.normalizeChapterParams({ subjectCode: '' });
  assert.equal(badSubject.valid, false, 'Empty subjectCode must be rejected');

  const longSubject = aiChatService.normalizeChapterParams({ subjectCode: 'A'.repeat(45) });
  assert.equal(longSubject.valid, false, 'subjectCode > 40 chars must be rejected');

  const badSem = aiChatService.normalizeChapterParams({ subjectCode: 'CIT122', semesterNo: 'not_a_number' });
  assert.equal(badSem.valid, false, 'Non-integer semesterNo must be rejected');

  const badUnit = aiChatService.normalizeChapterParams({ subjectCode: 'CIT122', unit: 99 });
  assert.equal(badUnit.valid, false, 'unit > 50 must be rejected');

  const validParams = aiChatService.normalizeChapterParams({ subjectCode: 'cit122', semesterNo: '2', unit: '2' });
  assert.equal(validParams.valid, true);
  assert.equal(validParams.params.subjectCode, 'CIT122');
  assert.equal(validParams.params.semesterNo, 2);
  assert.equal(validParams.params.unit, 2);

  // 2. Cap check: create 30 chapter conversations, then verify 31st is rejected
  for (let i = 1; i <= 30; i++) {
    await aiChatService.createChapterConversation(db, studentId, {
      subjectCode: 'CIT122',
      semesterNo: 2,
      unit: 2,
      title: `Chat ${i}`
    });
  }

  const existingChats = await aiChatService.getChapterConversations(db, studentId, {
    subjectCode: 'CIT122',
    semesterNo: 2,
    unit: 2
  });
  assert.equal(existingChats.length, 30, 'Should have exactly 30 conversations');

  // 31st creation should throw CHAT_LIMIT_REACHED
  await assert.rejects(
    async () => {
      await aiChatService.createChapterConversation(db, studentId, {
        subjectCode: 'CIT122',
        semesterNo: 2,
        unit: 2,
        title: 'Chat 31'
      });
    },
    (err) => err.code === 'CHAT_LIMIT_REACHED' && err.message.includes('Maximum limit of 30 conversations reached'),
    'Should reject 31st conversation with limit message'
  );
});


