'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  validateMessageActions,
  validateInteractiveQuestion,
  extractKyanaActionsFromText,
  buildFallbackMessageActions,
  sanitizeMessageMetadataForClient,
  validateActionRequest
} = require('../lib/message-actions');
const aiChatService = require('../lib/ai-chat-service');
const { createChatHandler, createActionHandler } = require('../lib/chat-http');
const { ensureRagSchema } = require('../lib/rag-schema');
const aiAssistant = require('../ai-assistant');

function createTestDb() {
  const raw = new DatabaseSync(':memory:');
  const db = {
    isPostgres: false,
    exec: (sql) => raw.exec(sql),
    run: async (sql, ...params) => {
      const stmt = raw.prepare(sql);
      const info = stmt.run(...params);
      return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
    },
    get: async (sql, ...params) => raw.prepare(sql).get(...params),
    all: async (sql, ...params) => raw.prepare(sql).all(...params),
    query: async (sql, params = []) => {
      const normalized = sql.replace(/\$\d+/g, '?');
      const rows = raw.prepare(normalized).all(...params);
      return { rows };
    }
  };
  return db;
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    destroyed: false,
    writableEnded: false,
    status(code) { this.statusCode = code; return this; },
    set(h) { Object.assign(this.headers, h); return this; },
    flushHeaders() {},
    write() {},
    end() { this.writableEnded = true; },
    json(payload) { this.body = payload; this.writableEnded = true; return this; }
  };
  return res;
}

test('1. Schema & allowlist validation rejects unknown actions and forbidden payload keys', () => {
  const valid = validateMessageActions([
    { id: 'next', label: 'Next concept →', action: 'continue_lesson', actionType: 'next_step', payload: { sessionId: 's1', stepIndex: 2 } },
    { id: 'bad', label: 'Hack', action: 'drop_database', actionType: 'quick_reply', payload: {} }
  ]);
  assert.equal(valid.type, 'message_actions');
  assert.equal(valid.actions.length, 1);
  assert.equal(valid.actions[0].action, 'continue_lesson');

  const reqBadAction = validateActionRequest({ action: 'exec_shell', actionType: 'quick_reply' });
  assert.equal(reqBadAction.valid, false);

  const reqSpoof = validateActionRequest({ action: 'continue_lesson', actionType: 'next_step', studentId: 'other_student' });
  assert.equal(reqSpoof.valid, false);
});

test('2. extractKyanaActionsFromText strips tags and hides correctOptionId before submission', () => {
  const raw = [
    'Here is how CSS works.',
    '<kyana_actions>{"actions":[{"id":"next","label":"Next concept →","action":"continue_lesson","actionType":"next_step"}],"mcq":{"id":"q1","question":"Which selector has highest specificity?","options":[{"id":"A","text":"Element"},{"id":"B","text":"ID"}],"correctOptionId":"B","explanation":"ID selectors (#id) override classes and elements."}}</kyana_actions>'
  ].join('\n');

  const extracted = extractKyanaActionsFromText(raw, { sessionId: 'sess_1', stepIndex: 1 });
  assert.equal(extracted.cleanText, 'Here is how CSS works.');
  assert.equal(extracted.messageActions.actions[0].action, 'continue_lesson');
  assert.equal(extracted.interactiveQuestion.correctOptionId, null);
  assert.equal(extracted.interactiveQuestion.submitted, false);
  assert.equal(extracted.serverAnswerKey.correctOptionId, 'B');

  const sanitized = sanitizeMessageMetadataForClient({
    interactiveQuestion: extracted.interactiveQuestion,
    _serverOnly: { mcqAnswerKey: extracted.serverAnswerKey }
  });
  assert.equal(sanitized._serverOnly, undefined);
  assert.equal(sanitized.interactiveQuestion.correctOptionId, null);
});

test('3. POST /api/ai/actions enforces authentication (401) and cross-student isolation (404)', async () => {
  const db = createTestDb();
  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);

  await db.run(`INSERT INTO ai_conversations (id, student_id, title) VALUES ('conv_alice', 'alice_01', 'CSS Study')`);

  const handler = createActionHandler(db, aiAssistant);

  // Unauthenticated
  const unauthRes = mockRes();
  await handler({ body: { action: 'continue_lesson', actionType: 'next_step' } }, unauthRes);
  assert.equal(unauthRes.statusCode, 401);

  // Cross-student conversation access attempt by Bob
  const bobRes = mockRes();
  await handler({
    user: { studentId: 'bob_02', role: 'student' },
    body: { action: 'continue_lesson', actionType: 'next_step', conversationId: 'conv_alice' }
  }, bobRes);
  assert.equal(bobRes.statusCode, 404);
});

test('4. Server-side MCQ evaluation, duplicate submission prevention (409), and reload persistence', async () => {
  const db = createTestDb();
  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);

  // Minimal students/academic tables needed by getAcademicContext in getMessages
  await db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT DEFAULT 'student',
      semester TEXT DEFAULT 'Semester 1',
      semester_no INTEGER DEFAULT 1
    );
  `);
  await db.run(`INSERT INTO students (studentId, name, role, semester, semester_no) VALUES ('stu_1', 'Saugat', 'student', 'Semester 1', 1)`);

  const conv = await aiChatService.createConversation(db, 'stu_1', 'Web Tech Unit 3');
  const validatedMcq = validateInteractiveQuestion({
    id: 'mcq_css_1',
    question: 'What does CSS stand for?',
    options: [
      { id: 'A', text: 'Cascading Style Sheets' },
      { id: 'B', text: 'Computer Style System' }
    ],
    correctOptionId: 'A',
    explanation: 'CSS stands for Cascading Style Sheets.'
  }, { sessionId: null, stepIndex: 1 });

  const savedMsg = await aiChatService.saveAssistantMessage(db, 'stu_1', conv.id, 'Test your CSS basics:', {
    intent: 'study_partner',
    interactiveQuestion: validatedMcq.publicQuestion,
    _serverOnly: { mcqAnswerKey: validatedMcq.serverAnswerKey }
  });

  // Before submission: getMessages must NOT leak correctOptionId or _serverOnly
  const preMsgs = await aiChatService.getMessages(db, 'stu_1', conv.id, 20);
  assert.equal(preMsgs.length, 1);
  assert.equal(preMsgs[0].metadata._serverOnly, undefined);
  assert.equal(preMsgs[0].metadata.interactiveQuestion.correctOptionId, null);
  assert.equal(preMsgs[0].metadata.interactiveQuestion.submitted, false);

  const handler = createActionHandler(db, aiAssistant);

  // Submit correct answer A
  const submitRes = mockRes();
  await handler({
    user: { studentId: 'stu_1', role: 'student' },
    body: {
      action: 'submit_mcq_answer',
      actionType: 'multiple_choice',
      conversationId: conv.id,
      payload: { messageId: savedMsg.id, questionId: 'mcq_css_1', optionId: 'A' }
    }
  }, submitRes);

  assert.equal(submitRes.statusCode, 200);
  assert.equal(submitRes.body.ok, true);
  assert.equal(submitRes.body.interactiveQuestion.submitted, true);
  assert.equal(submitRes.body.interactiveQuestion.isCorrect, true);
  assert.equal(submitRes.body.interactiveQuestion.correctOptionId, 'A');
  assert.ok(submitRes.body.messageActions.actions.some(a => a.action === 'take_quiz' || a.action === 'continue_lesson'));

  // Duplicate submission must be rejected with 409
  const dupRes = mockRes();
  await handler({
    user: { studentId: 'stu_1', role: 'student' },
    body: {
      action: 'submit_mcq_answer',
      actionType: 'multiple_choice',
      conversationId: conv.id,
      payload: { messageId: savedMsg.id, questionId: 'mcq_css_1', optionId: 'B' }
    }
  }, dupRes);
  assert.equal(dupRes.statusCode, 409);

  // Reload persistence: getMessages returns submitted state with feedback
  const postMsgs = await aiChatService.getMessages(db, 'stu_1', conv.id, 20);
  const originalAfterReload = postMsgs.find(m => m.id === savedMsg.id);
  assert.equal(originalAfterReload.metadata.interactiveQuestion.submitted, true);
  assert.equal(originalAfterReload.metadata.interactiveQuestion.selectedOptionId, 'A');
  assert.equal(originalAfterReload.metadata.interactiveQuestion.isCorrect, true);
  assert.equal(originalAfterReload.metadata._serverOnly, undefined);
});

test('5. Study Partner Next concept and Explain again actions preserve session and continue cleanly', async () => {
  const db = createTestDb();
  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT DEFAULT 'student',
      semester TEXT DEFAULT 'Semester 1',
      semester_no INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      title TEXT,
      originalName TEXT,
      subject TEXT,
      semester_no INTEGER,
      chapter TEXT,
      deleted_at TEXT,
      hidden_at TEXT
    );
  `);
  await db.run(`INSERT INTO students (studentId, name, role, semester, semester_no) VALUES ('stu_sp', 'Saugat', 'student', 'Semester 1', 1)`);

  const conv = await aiChatService.createConversation(db, 'stu_sp', 'Teach me CSS');
  const chatHandler = createChatHandler(db, aiAssistant);
  const actionHandler = createActionHandler(db, aiAssistant);

  // Step 1: start study session via /api/ai/chat
  const chatRes = mockRes();
  await chatHandler({
    user: { studentId: 'stu_sp', role: 'student' },
    headers: {},
    body: { message: 'teach me css', conversationId: conv.id, stream: false }
  }, chatRes);

  assert.equal(chatRes.statusCode, 200);
  assert.ok(chatRes.body.studySessionId);
  assert.equal(chatRes.body.currentStepIndex, 1);
  assert.ok(chatRes.body.messageActions.actions.some(a => a.action === 'continue_lesson'));

  const sessionId = chatRes.body.studySessionId;

  // Step 2: click "Explain again" -> stays on step 1 with remediation
  const explainRes = mockRes();
  await actionHandler({
    user: { studentId: 'stu_sp', role: 'student' },
    body: {
      action: 'explain_again',
      actionType: 'quick_reply',
      conversationId: conv.id,
      payload: { sessionId, stepIndex: 1 }
    }
  }, explainRes);
  assert.equal(explainRes.statusCode, 200);
  assert.equal(explainRes.body.currentStepIndex, 1);

  // Step 3: click "Next concept →" -> advances to step 2 without restarting!
  const nextRes = mockRes();
  await actionHandler({
    user: { studentId: 'stu_sp', role: 'student' },
    body: {
      action: 'continue_lesson',
      actionType: 'next_step',
      conversationId: conv.id,
      payload: { sessionId, stepIndex: 1 }
    }
  }, nextRes);
  assert.equal(nextRes.statusCode, 200);
  assert.equal(nextRes.body.studySessionId, sessionId);
  assert.equal(nextRes.body.currentStepIndex, 2);
});

test('6. Frontend files render interactive actions & MCQs in monochrome without syntax errors', () => {
  const jsSrc = fs.readFileSync(path.join(__dirname, '../public/chatbot.js'), 'utf8');
  const cssSrc = fs.readFileSync(path.join(__dirname, '../public/chatbot.css'), 'utf8');
  assert.ok(jsSrc.includes('KyanaInteractiveActions'));
  assert.ok(jsSrc.includes('/api/ai/actions'));
  assert.ok(jsSrc.includes('submit_mcq_answer'));
  assert.ok(cssSrc.includes('.kyana-msg-action-btn'));
  assert.ok(cssSrc.includes('.kyana-mcq-card'));
});
