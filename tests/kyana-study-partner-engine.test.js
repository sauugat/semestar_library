'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { ensureRagSchema } = require('../lib/rag-schema');
const {
  startOrResumeStudySession,
  advanceStudySessionStep,
  evaluateStudentIntent,
  evaluateCheckpointReply,
  renderMicroTopicTurn,
  generateCheckpointQuestion
} = require('../lib/study-partner-engine');
const { ingestPyqPaper } = require('../lib/pyq-intelligence');
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
      uploadedAt TEXT
    );
  `);

  await ensureRagSchema(db);
  return db;
}

test('Study Partner Engine: Session Initiation, Persistence & Idempotency', async () => {
  const db = await createTestDb();

  // Seed teacher note for DSA Linked Lists
  await db.run(
    `INSERT INTO files (id, originalName, title, subject, chapter, semester, semester_no)
     VALUES (301, 'DSA_Unit2_Notes.pdf', 'DSA Unit 2 Lecture Notes', 'Data Structure and Algorithms', 'Chapter 2', 'Semester 3', 3)`
  );
  await db.run(
    `INSERT INTO document_chunks (
      id, file_id, doc_version, chunk_index, chunk_level,
      page_start, page_end, chapter, unit, section_heading,
      content, clean_content, content_hash, subject, subject_code, semester_no, created_at
    ) VALUES (?, ?, 1, 1, 'child', 1, 3, 'Chapter 2', 'Unit 2', 'Linked List as an ADT', 'An ADT defines operations.', 'An ADT defines operations.', 'hash', 'Data Structure and Algorithms', 'CIT214', 3, ?);`,
    'chunk_301_1', 301, new Date().toISOString()
  );

  // Turn 1: Semester 3 student initiates session for DSA Chapter 2
  const sessionRes = await startOrResumeStudySession(db, {
    studentId: '26020266',
    conversationId: 'conv_dsa_1',
    subject: 'Data Structure and Algorithms',
    chapterQuery: 'Chapter 2',
    semesterNo: 3
  });

  assert.equal(sessionRes.isResumed, false);
  assert.equal(sessionRes.session.subjectCode || sessionRes.session.subject_code, 'CIT214');
  assert.equal(sessionRes.session.unitNumber || sessionRes.session.unit_number, 2);
  assert.equal(sessionRes.session.currentStepIndex || sessionRes.session.current_step_index, 1);
  assert.ok(sessionRes.topics.length >= 2, 'Should create topic progress rows');

  // Verify first topic is IN_PROGRESS and others are PENDING
  assert.equal(sessionRes.topics[0].status, 'IN_PROGRESS');
  assert.equal(sessionRes.topics[1].status, 'PENDING');

  // Turn 2: Calling again with same studentId and conversationId should resume without duplicating
  const resumedRes = await startOrResumeStudySession(db, {
    studentId: '26020266',
    conversationId: 'conv_dsa_1',
    subject: 'Data Structure and Algorithms',
    chapterQuery: 'Chapter 2',
    semesterNo: 3
  });

  assert.equal(resumedRes.isResumed, true);
  assert.equal(resumedRes.session.id, sessionRes.session.id);
  assert.equal(resumedRes.topics.length, sessionRes.topics.length);
});

test('Study Partner Engine: Step Pacing, Socratic Evaluation & Remediation', async () => {
  const db = await createTestDb();

  // Ingest sample PYQ for DSA
  await ingestPyqPaper(db, {
    subject: 'Data Structure and Algorithms',
    subjectCode: 'CIT214',
    semesterNo: 3,
    examYear: '2080 BS',
    examType: 'Final Exam',
    rawText: '1. What is an Abstract Data Type (ADT)? Explain with example. [5]'
  });

  const sessionRes = await startOrResumeStudySession(db, {
    studentId: '26020266',
    conversationId: 'conv_test_pacing',
    subject: 'Data Structure and Algorithms',
    chapterQuery: 'Chapter 2',
    semesterNo: 3
  });

  const sessionId = sessionRes.session.id;

  // 1. Evaluate intents
  const nextIntent = evaluateStudentIntent('next topic bro');
  assert.equal(nextIntent.intent, 'advance_directly');

  const nepaliNext = evaluateStudentIntent('bujhe agadi badham');
  assert.equal(nepaliNext.intent, 'advance_directly');

  const confuseIntent = evaluateStudentIntent('bujhina simpler example deu');
  assert.equal(confuseIntent.intent, 'remediate');

  const pyqIntent = evaluateStudentIntent('solve 2080 pyq question');
  assert.equal(pyqIntent.intent, 'practice_pyq');

  // 2. Evaluate Checkpoint Answer
  const currentStep = sessionRes.topics[0];
  const evalPass = evaluateCheckpointReply(
    'An ADT focuses on what operations can be performed while hiding how they are implemented.',
    currentStep,
    currentStep.checkpointQuestion
  );
  assert.equal(evalPass.passed, true);
  assert.ok(evalPass.feedback.length > 10);

  // 3. Advance to Step 2
  const advanceRes = await advanceStudySessionStep(db, sessionId, '26020266', {
    targetStepIndex: 2,
    markCurrentStatus: 'MASTERED'
  });

  assert.equal(advanceRes.ok, true);
  assert.equal(advanceRes.currentStepIndex, 2);
  assert.equal(advanceRes.isCompleted, false);

  // Verify in DB that Step 1 is MASTERED and Step 2 is IN_PROGRESS
  const step1 = await db.get(
    `SELECT * FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 1`,
    sessionId
  );
  assert.equal(step1.status, 'MASTERED');
  assert.ok(step1.masteredAt || step1.mastered_at);

  const step2 = await db.get(
    `SELECT * FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 2`,
    sessionId
  );
  assert.equal(step2.status, 'IN_PROGRESS');

  // Verify session stats updated
  const updatedSess = await db.get(`SELECT * FROM study_partner_sessions WHERE id = ?`, sessionId);
  assert.equal(updatedSess.currentStepIndex || updatedSess.current_step_index, 2);
  assert.equal(updatedSess.masteredSteps || updatedSess.mastered_steps, 1);
});

test('Study Partner Engine: Visual Block Rendering & PYQ Spotlight', async () => {
  const db = await createTestDb();

  // Ingest sample PYQ
  await ingestPyqPaper(db, {
    subject: 'Data Structure and Algorithms',
    subjectCode: 'CIT214',
    semesterNo: 3,
    examYear: '2080 BS',
    examType: 'Final Exam',
    rawText: '1. What is an Abstract Data Type (ADT)? [5]'
  });

  const sessionRes = await startOrResumeStudySession(db, {
    studentId: '26020266',
    conversationId: 'conv_visual_test',
    subject: 'Data Structure and Algorithms',
    chapterQuery: 'Chapter 2',
    semesterNo: 3
  });

  const turnText = renderMicroTopicTurn({
    session: sessionRes.session,
    step: sessionRes.topics[0],
    topics: sessionRes.topics
  });

  // Verify required visual blocks
  assert.match(turnText, /```study_session[\s\S]*?```/, 'Must contain ```study_session block');
  assert.match(turnText, /Step 1 of/i, 'Must contain Step 1 header');
  assert.match(turnText, /Checkpoint Question:/i, 'Must contain Checkpoint Question');

  // Verify JSON inside study_session block is valid
  const match = turnText.match(/```study_session\n([\s\S]*?)\n```/);
  assert.ok(match, 'Should extract study_session JSON');
  const parsed = JSON.parse(match[1]);
  assert.equal(parsed.currentStep, 1);
  assert.ok(parsed.checklist.length >= 2);
});
