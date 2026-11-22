'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const aiAssistant = require('../ai-assistant');
const aiChatService = require('../lib/ai-chat-service');
const { createChatHandler, createActionHandler } = require('../lib/chat-http');
const { ensureRagSchema } = require('../lib/rag-schema');
const {
  evaluateAcademicAnswer,
  extractStudentMcqChoice,
  isDeclarativeAtomicProposition,
  generateStructuredMcqForTopic
} = require('../lib/academic-teaching-engine');
const {
  evaluateStudentIntent,
  startOrResumeStudySession
} = require('../lib/study-partner-engine');
const {
  validateInteractiveQuestion,
  stripInternalSessionBlocksFromText,
  sanitizeMessageMetadataForClient
} = require('../lib/message-actions');

function createTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  return {
    isPostgres: false,
    exec: (sql) => sqlite.exec(sql),
    get: async (sql, ...params) => sqlite.prepare(sql).get(...params) || null,
    all: async (sql, ...params) => sqlite.prepare(sql).all(...params) || [],
    run: async (sql, ...params) => {
      const r = sqlite.prepare(sql).run(...params);
      return { lastInsertRowid: Number(r.lastInsertRowid || 0), changes: Number(r.changes || 0) };
    },
    close: () => sqlite.close()
  };
}

async function seedTestDb(db) {
  await aiChatService.ensureSchema(db);
  await ensureRagSchema(db);
  db.exec(`
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
      semester TEXT,
      semester_no INTEGER,
      chapter TEXT,
      deleted_at TEXT,
      hidden_at TEXT,
      moderation_status TEXT
    );
  `);
  await db.run(
    `INSERT INTO students (studentId, name, role, semester, semester_no) VALUES ('stu_logic', 'Saugat', 'student', 'Semester 1', 1)`
  );
  await db.run(
    `INSERT INTO students (studentId, name, role, semester, semester_no) VALUES ('stu_other', 'Other Student', 'student', 'Semester 1', 1)`
  );
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    writableEnded: false,
    destroyed: false,
    status(code) { this.statusCode = code; return this; },
    set(h) { Object.assign(this.headers, h); return this; },
    json(payload) { this.body = payload; this.writableEnded = true; return this; },
    end() { this.writableEnded = true; return this; }
  };
  return res;
}

const ATOMIC_PROP_MCQ = {
  id: 'mcq_prop_1',
  question: 'Which of the following is a valid Atomic Proposition?',
  options: [
    { id: 'A', text: 'Go to your room!' },
    { id: 'B', text: 'Is it raining?' },
    { id: 'C', text: '2 + 2 = 5' },
    { id: 'D', text: 'What time is it?' }
  ],
  correctOptionId: 'C',
  explanation: 'A proposition is a declarative statement that has a definite truth value — it can be either true or false. "2 + 2 = 5" is definitely false and atomic.',
  hint: 'A proposition does not have to be true — it only needs to be a declarative statement that is clearly either true or false.',
  optionExplanations: {
    A: '"Go to your room!" is an imperative command, not a declarative statement.',
    B: '"Is it raining?" is a question, so it has no truth value.',
    D: '"What time is it?" is a question, not a declarative statement.'
  }
};

test('1. Atomic Proposition verification: false declarative statements ("2 + 2 = 5") are valid propositions', () => {
  assert.equal(isDeclarativeAtomicProposition('2 + 2 = 5'), true, '"2 + 2 = 5" is a valid atomic proposition (false declarative)');
  assert.equal(isDeclarativeAtomicProposition('3 + 4 = 7'), true, '"3 + 4 = 7" is a valid atomic proposition');
  assert.equal(isDeclarativeAtomicProposition('The Earth is flat'), true, 'False declarative sentence is a valid proposition');
  assert.equal(isDeclarativeAtomicProposition('Go to your room!'), false, 'Imperative command is not a proposition');
  assert.equal(isDeclarativeAtomicProposition('Is it raining?'), false, 'Question is not a proposition');
  assert.equal(isDeclarativeAtomicProposition('What time is it?'), false, 'Wh-question is not a proposition');
  assert.equal(isDeclarativeAtomicProposition('x + 2 = 5'), false, 'Open variable statement is not a proposition');
});

test('2. Answer normalization & verified activeQuestion evaluation (uppercase, lowercase, natural language, incorrect, ambiguous)', () => {
  const topic = { topicTitle: 'Propositional Logic & Atomic Propositions', subject: 'Discrete Mathematics', subjectCode: 'CIT121' };
  const opts = { activeQuestion: ATOMIC_PROP_MCQ };

  // Correct uppercase letter
  const rUpper = evaluateAcademicAnswer('C', topic, ATOMIC_PROP_MCQ.question, opts);
  assert.equal(rUpper.passed, true, 'Uppercase "C" must be marked CORRECT');
  assert.equal(rUpper.selectedOption, 'C');

  // Correct lowercase letter
  const rLower = evaluateAcademicAnswer('c', topic, ATOMIC_PROP_MCQ.question, opts);
  assert.equal(rLower.passed, true, 'Lowercase "c" must be marked CORRECT');
  assert.equal(rLower.selectedOption, 'C');

  // Natural language variations
  for (const nlAnswer of ['Option C', 'option c', 'The third one', 'third option', "I think it's C", '2 + 2 = 5', '2+2=5']) {
    const res = evaluateAcademicAnswer(nlAnswer, topic, ATOMIC_PROP_MCQ.question, opts);
    assert.equal(res.passed, true, `Natural-language answer "${nlAnswer}" must be marked CORRECT`);
    assert.equal(res.selectedOption, 'C');
  }

  // Incorrect MCQ answer
  const rWrong = evaluateAcademicAnswer('A', topic, ATOMIC_PROP_MCQ.question, opts);
  assert.equal(rWrong.passed, false, 'Option A ("Go to your room!") must be marked INCORRECT');
  assert.equal(rWrong.selectedOption, 'A');
  assert.ok(rWrong.feedback.includes('imperative') || rWrong.feedback.includes('command'), 'Must explain why selected option A is wrong');
  assert.ok(rWrong.hint, 'Must include a hint');

  // Ambiguous answers
  for (const amb of ['maybe', 'hmm', 'A or C', 'between A and C']) {
    const rAmb = evaluateAcademicAnswer(amb, topic, ATOMIC_PROP_MCQ.question, opts);
    assert.equal(rAmb.passed, false);
    assert.equal(rAmb.isAmbiguous, true, `"${amb}" must be flagged as ambiguous rather than rejected as wrong`);
  }

  // Also works even without stored activeQuestion (plain-text MCQ from logs)
  const plainTextQ = `Which is a valid Atomic Proposition?\nA) Go to your room!\nB) Is it raining?\nC) "2 + 2 = 5"\nD) What time is it?`;
  const rPlain = evaluateAcademicAnswer('C', topic, plainTextQ);
  assert.equal(rPlain.passed, true, 'Plain-text Atomic Proposition MCQ must deterministically mark C ("2 + 2 = 5") CORRECT');
});

test('3. Conversational intent classification distinguishes answers, follow-ups, remediation, skip/advance, and topic switch', () => {
  assert.equal(evaluateStudentIntent('C').intent, 'answer_attempt');
  assert.equal(evaluateStudentIntent('c').intent, 'answer_attempt');
  assert.equal(evaluateStudentIntent('Option C').intent, 'answer_attempt');
  assert.equal(evaluateStudentIntent('The third one').intent, 'answer_attempt');
  assert.equal(evaluateStudentIntent("I think it's C").intent, 'answer_attempt');

  assert.equal(evaluateStudentIntent('Why is C correct?').intent, 'followup_question');
  assert.equal(evaluateStudentIntent("I don't understand").intent, 'remediate');
  assert.equal(evaluateStudentIntent('Explain again').intent, 'remediate');
  assert.equal(evaluateStudentIntent('Give me another example').intent, 'remediate');

  const fwd = evaluateStudentIntent("Let's move forward");
  assert.equal(fwd.intent, 'advance_directly');
  assert.equal(fwd.isSkip, false);

  const skip = evaluateStudentIntent('Skip this');
  assert.equal(skip.intent, 'advance_directly');
  assert.equal(skip.isSkip, true);

  assert.equal(evaluateStudentIntent('Stop study session').intent, 'switch_topic');
  assert.equal(evaluateStudentIntent('What is my attendance?').intent, 'switch_topic');
});

test('4. Internal data leakage prevention: HTTP /api/ai/chat separates studySession from conversational reply', async () => {
  const db = createTestDb();
  await seedTestDb(db);
  const conv = await aiChatService.createConversation(db, 'stu_logic', 'Discrete Math Unit 1');

  const fakeAssistant = {
    async handleChat(dbArg, msg, studentInfo, history, convId, opts) {
      return aiAssistant.handleChat(dbArg, msg, studentInfo, history, convId, {
        ...opts,
        generateReply: async () => ({
          reply: [
            '### Step 1: Atomic Propositions',
            'An **atomic proposition** is a simple declarative statement that is clearly either true or false (e.g., `"2 + 2 = 5"` is false, so it IS a valid proposition).',
            'For example, `"Kathmandu is in Nepal"` is true, while `"Go to your room!"` is a command and NOT a proposition.',
            'Formally, a proposition has a single truth value in `{T, F}` and cannot be split into simpler propositions using connectives like AND/OR/NOT.',
            'Worked example: `"2 + 2 = 5"` evaluates to False; `"Is it raining?"` has no truth value because it is a question.',
            'Let us check your understanding with the quick quiz below.',
            '<kyana_actions>' + JSON.stringify({ mcq: ATOMIC_PROP_MCQ, actions: [{ id: 'ex', label: 'Give another example', action: 'explain_example', actionType: 'quick_reply' }] }) + '</kyana_actions>'
          ].join('\n\n')
        })
      });
    }
  };

  const chatHandler = createChatHandler(db, fakeAssistant);
  const res = mockRes();
  await chatHandler({
    user: { studentId: 'stu_logic', role: 'student' },
    body: {
      message: 'Teach me this chapter step by step',
      conversationId: conv.id,
      chapterContext: {
        subject: 'Discrete Mathematics',
        subjectCode: 'CIT121',
        semesterNo: 1,
        unitNumber: 1,
        chapterTitle: 'Unit 1: Logic and Proof',
        learningMode: 'teach'
      }
    }
  }, res);

  assert.equal(res.statusCode, 200);
  // Zero raw JSON or internal leakage in reply
  assert.ok(!res.body.reply.includes('```study_session'), 'HTTP reply must NOT contain ```study_session fence');
  assert.ok(!res.body.reply.includes('STUDY_SESSION'), 'HTTP reply must NOT contain STUDY_SESSION');
  assert.ok(!res.body.reply.includes('"progressPercentage"'), 'HTTP reply must NOT leak progressPercentage JSON');
  assert.ok(!res.body.reply.includes('"checklist"'), 'HTTP reply must NOT leak checklist JSON');
  assert.ok(!res.body.reply.includes('<kyana_actions>'), 'HTTP reply must NOT leak <kyana_actions> tags');

  // Structured session and MCQ are cleanly separated in metadata
  assert.ok(res.body.studySession && typeof res.body.studySession === 'object', 'Structured studySession must be present');
  assert.equal(res.body.studySession.currentStep, 1);
  assert.ok(res.body.interactiveQuestion && res.body.interactiveQuestion.id === 'mcq_prop_1', 'Structured interactiveQuestion must be present');
  assert.equal(res.body.interactiveQuestion.correctOptionId, null, 'correctOptionId must NEVER leak before submission');
  assert.equal(res.body._serverOnly, undefined, '_serverOnly must NEVER leak to client');

  // Also verify stripInternalSessionBlocksFromText strips malformed/raw leaked STUDY_SESSION payloads
  const malformedLeak = 'STUDY_SESSION\n{"course":"CIT121","currentStep":1,"totalSteps":5,"progressPercentage":0,"checklist":[]}\nHere is the lesson.';
  const cleaned = stripInternalSessionBlocksFromText(malformedLeak);
  assert.ok(!cleaned.includes('STUDY_SESSION') && !cleaned.includes('progressPercentage'), 'Malformed raw STUDY_SESSION JSON must be stripped');
  assert.ok(cleaned.includes('Here is the lesson.'));

  db.close();
});

test('5. Interactive Quiz End-to-End: wrong attempts (retry + hint + no premature reveal), correct answer (Continue button, no auto-jump), duplicate protection, cross-student isolation, and topic progression', async () => {
  const db = createTestDb();
  await seedTestDb(db);
  const conv = await aiChatService.createConversation(db, 'stu_logic', 'Discrete Math Quiz');

  // Start a real study session on Step 1
  const sessStart = await startOrResumeStudySession(db, {
    studentId: 'stu_logic',
    conversationId: conv.id,
    subject: 'Discrete Mathematics',
    semesterNo: 1,
    unitNumber: 1,
    chapterQuery: 'Unit 1: Logic'
  });
  const sessionId = sessStart.session.id;

  const validatedMcq = validateInteractiveQuestion(ATOMIC_PROP_MCQ, { sessionId, stepIndex: 1 });
  const savedMsg = await aiChatService.saveAssistantMessage(db, 'stu_logic', conv.id, 'Let us check your understanding of Atomic Propositions.', {
    intent: 'study_partner',
    studySessionId: sessionId,
    currentStepIndex: 1,
    interactiveQuestion: validatedMcq.publicQuestion,
    _serverOnly: { mcqAnswerKey: validatedMcq.serverAnswerKey }
  });

  const actionHandler = createActionHandler(db, aiAssistant);

  // 5a. Cross-student authorization check (other student must get 404)
  const crossRes = mockRes();
  await actionHandler({
    user: { studentId: 'stu_other', role: 'student' },
    body: {
      action: 'submit_mcq_answer',
      actionType: 'multiple_choice',
      conversationId: conv.id,
      payload: { messageId: savedMsg.id, questionId: 'mcq_prop_1', optionId: 'C', sessionId }
    }
  }, crossRes);
  assert.equal(crossRes.statusCode, 404, 'Another student must not be able to submit to this session');

  // 5b. Attempt 1: Wrong option A -> incorrect, hint shown, answer NOT revealed, canRetry = true, progress NOT advanced
  const wrong1 = mockRes();
  await actionHandler({
    user: { studentId: 'stu_logic', role: 'student' },
    body: {
      action: 'submit_mcq_answer',
      actionType: 'multiple_choice',
      conversationId: conv.id,
      payload: { messageId: savedMsg.id, questionId: 'mcq_prop_1', optionId: 'A', sessionId }
    }
  }, wrong1);
  assert.equal(wrong1.statusCode, 200);
  assert.equal(wrong1.body.evaluation.isCorrect, false);
  assert.equal(wrong1.body.evaluation.canRetry, true);
  assert.equal(wrong1.body.evaluation.attempts, 1);
  assert.equal(wrong1.body.interactiveQuestion.submitted, false, 'Must NOT lock quiz after 1 wrong attempt');
  assert.equal(wrong1.body.interactiveQuestion.correctOptionId, null, 'Must NOT reveal correct answer on first wrong attempt');
  assert.ok(wrong1.body.interactiveQuestion.hint, 'Must provide a short hint');
  assert.ok(wrong1.body.interactiveQuestion.feedback.includes('imperative'), 'Must explain why option A is wrong');

  // Confirm study session is STILL on Step 1 (no premature progress advance)
  const sessAfterWrong = await db.get(`SELECT current_step_index, mastered_steps FROM study_partner_sessions WHERE id = ?`, sessionId);
  assert.equal(sessAfterWrong.current_step_index, 1);
  assert.equal(sessAfterWrong.mastered_steps, 0);

  // 5c. Attempt 2: Correct option C ("2 + 2 = 5") -> positive response, explanation, prominent Continue to Next Topic button, NO auto-jump
  const rightRes = mockRes();
  await actionHandler({
    user: { studentId: 'stu_logic', role: 'student' },
    body: {
      action: 'submit_mcq_answer',
      actionType: 'multiple_choice',
      conversationId: conv.id,
      payload: { messageId: savedMsg.id, questionId: 'mcq_prop_1', optionId: 'C', sessionId }
    }
  }, rightRes);
  assert.equal(rightRes.statusCode, 200);
  assert.equal(rightRes.body.evaluation.isCorrect, true);
  assert.equal(rightRes.body.evaluation.awaitingContinue, true);
  assert.equal(rightRes.body.interactiveQuestion.submitted, true);
  assert.equal(rightRes.body.interactiveQuestion.passed, true);
  assert.equal(rightRes.body.interactiveQuestion.correctOptionId, 'C');
  assert.ok(rightRes.body.reply.includes('Correct!'), 'Must display positive response');
  assert.ok(
    rightRes.body.messageActions.actions.some(a => a.action === 'continue_lesson' && a.label.includes('Continue to Next Topic')),
    'Must show prominent Continue to Next Topic button'
  );

  // Confirm step did NOT auto-jump before student clicks Continue
  const sessBeforeContinue = await db.get(`SELECT current_step_index FROM study_partner_sessions WHERE id = ?`, sessionId);
  assert.equal(sessBeforeContinue.current_step_index, 1, 'Must NOT auto-jump to Step 2 before student clicks Continue');

  // 5d. Duplicate submission protection (409 Conflict)
  const dupRes = mockRes();
  await actionHandler({
    user: { studentId: 'stu_logic', role: 'student' },
    body: {
      action: 'submit_mcq_answer',
      actionType: 'multiple_choice',
      conversationId: conv.id,
      payload: { messageId: savedMsg.id, questionId: 'mcq_prop_1', optionId: 'B', sessionId }
    }
  }, dupRes);
  assert.equal(dupRes.statusCode, 409, 'Duplicate submission on solved quiz must return 409');

  // 5e. Click "Continue to Next Topic" -> marks Step 1 MASTERED, updates progress, loads Step 2
  const continueRes = mockRes();
  await actionHandler({
    user: { studentId: 'stu_logic', role: 'student' },
    body: {
      action: 'continue_lesson',
      actionType: 'next_step',
      conversationId: conv.id,
      payload: { sessionId, stepIndex: 1 }
    }
  }, continueRes);
  assert.equal(continueRes.statusCode, 200);
  assert.equal(continueRes.body.currentStepIndex, 2, 'Clicking Continue must advance to Step 2');
  assert.ok(!continueRes.body.reply.includes('```study_session'), 'Next topic HTTP reply must not leak raw study_session fence');
  assert.ok(continueRes.body.studySession && continueRes.body.studySession.currentStep === 2);

  const step1Row = await db.get(`SELECT status FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 1`, sessionId);
  assert.equal(step1Row.status, 'MASTERED', 'Step 1 must be marked MASTERED upon clicking Continue');

  db.close();
});

test('6. Follow-up question while quiz is active keeps active question available and does NOT advance progress', async () => {
  const db = createTestDb();
  await seedTestDb(db);
  const convId = 'conv_followup_quiz';
  const student = { studentId: 'stu_logic', role: 'student', semester: 'Semester 1', semester_no: 1 };
  const chapterContext = {
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    semesterNo: 1,
    unitNumber: 1,
    chapterTitle: 'Unit 1: Logic and Proof',
    learningMode: 'teach'
  };

  const history = [];
  const t1 = await aiAssistant.handleChat(db, 'Teach me this chapter step by step', student, history, convId, {
    chapterContext,
    generateReply: async () => ({
      reply: 'Step 1 explanation of Atomic Propositions.\n<kyana_actions>' + JSON.stringify({ mcq: ATOMIC_PROP_MCQ }) + '</kyana_actions>'
    })
  });
  assert.equal(t1.currentStepIndex, 1);
  assert.equal(t1.interactiveQuestion?.id, 'mcq_prop_1');
  history.push({ role: 'user', content: 'Teach me this chapter step by step' });
  history.push({ role: 'assistant', content: t1.reply });

  // Student asks a follow-up question while quiz is active
  const tFollow = await aiAssistant.handleChat(db, 'Why is C correct?', student, history, convId, {
    chapterContext,
    generateReply: async () => ({
      reply: 'Because "2 + 2 = 5" is a declarative statement with a definite truth value (False).'
    })
  });
  assert.equal(tFollow.interactiveQuestion?.id, 'mcq_prop_1', 'Active MCQ must remain available during follow-up questions');
  const sessRow = await db.get(`SELECT current_step_index FROM study_partner_sessions WHERE id = ?`, t1.studySessionId);
  assert.equal(sessRow.current_step_index, 1, 'Follow-up question must NOT advance progress');

  db.close();
});

test('7. Frontend library.html, chatbot.js, and chatbot.css implement interactive MCQ UI cleanly without syntax errors', () => {
  const libraryHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'library.html'), 'utf8');
  const chatbotJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'chatbot.js'), 'utf8');
  const chatbotCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'chatbot.css'), 'utf8');

  // Verify chatbot.js parses cleanly with zero syntax errors
  assert.doesNotThrow(() => new vm.Script(chatbotJs, { filename: 'chatbot.js' }), 'public/chatbot.js must have zero syntax errors');

  // Verify library.html has internal JSON leakage sanitizer & interactive MCQ renderer
  assert.ok(libraryHtml.includes('stripInternalStudySessionPayload'), 'library.html must strip raw STUDY_SESSION JSON');
  assert.ok(libraryHtml.includes('renderChapterStudySessionCardHtml'), 'library.html must render structured studySession card');
  assert.ok(libraryHtml.includes('renderChapterInteractiveQuizAndActions'), 'library.html must render interactive clickable MCQ card');
  assert.ok(libraryHtml.includes('Check Answer'), 'library.html must include Check Answer button');
  assert.ok(libraryHtml.includes('Checking answer…'), 'library.html must show loading state while evaluating');
  assert.ok(libraryHtml.includes('Continue to Next Topic →'), 'library.html must render Continue to Next Topic button');
  assert.ok(libraryHtml.includes('submit_mcq_answer'), 'library.html must verify answers via backend submit_mcq_answer');

  // Verify chatbot.js has Check Answer & Continue to Next Topic
  assert.ok(chatbotJs.includes('Check Answer'));
  assert.ok(chatbotJs.includes('Continue to Next Topic →'));

  // Verify chatbot.css has monochrome & responsive MCQ styles
  assert.ok(chatbotCss.includes('.kyana-mcq-check-btn'));
  assert.ok(chatbotCss.includes('.kyana-mcq-continue-btn'));
  assert.ok(chatbotCss.includes('.kyana-mcq-hint'));
  assert.ok(chatbotCss.includes('@media (max-width: 640px)'));
});

test('8. State consistency regression: completedConcepts, progressPercentage, checklist statuses, and distinct Unit 1 MCQs stay synchronized', async () => {
  const { advanceStudySessionStep, buildStudySessionPayload } = require('../lib/study-partner-engine');
  const { renderAdaptiveVisualBlockHtml } = require('../public/chatbot.js');
  const db = createTestDb();
  await seedTestDb(db);
  const conv = await aiChatService.createConversation(db, 'stu_logic', 'State Consistency Check');

  const started = await startOrResumeStudySession(db, {
    studentId: 'stu_logic',
    conversationId: conv.id,
    subject: 'Discrete Mathematics',
    semesterNo: 2,
    unitNumber: 1,
    chapterQuery: 'Unit 1: Logic and Induction'
  });
  const sessionId = started.session.id;

  // Step 1 ("Logic and Induction") and Step 3 ("Propositional logic") must both produce verified, distinct MCQs
  const mcqStep1 = generateStructuredMcqForTopic({ stepIndex: 1, topicTitle: 'Logic and Induction' }, started.session);
  const mcqStep3 = generateStructuredMcqForTopic({ stepIndex: 3, topicTitle: 'Propositional logic' }, started.session);
  assert.ok(mcqStep1 && mcqStep1.correctOptionId === 'C', 'Step 1 (Logic and Induction) must generate verified Atomic Proposition MCQ');
  assert.ok(mcqStep3 && mcqStep3.correctOptionId === 'B', 'Step 3 (Propositional logic) must generate distinct Implication MCQ');
  assert.notEqual(mcqStep1.question, mcqStep3.question, 'Consecutive Discrete Math Unit 1 steps must not repeat the identical MCQ');

  // Neutral advance (INTRODUCED, not MASTERED) must keep progressPercentage at 0 and NOT mark Step 1 mastered
  const advNeutral = await advanceStudySessionStep(db, sessionId, 'stu_logic', {
    targetStepIndex: 2,
    markCurrentStatus: 'INTRODUCED',
    conceptExplained: 'Logic and Induction',
    activeQuestion: null
  });
  const stateAfterNeutral = JSON.parse(advNeutral.session.teaching_state_json);
  const payloadAfterNeutral = buildStudySessionPayload(advNeutral.session, advNeutral.topics[1], advNeutral.topics);
  assert.equal(stateAfterNeutral.progressPercentage, 0);
  assert.equal(payloadAfterNeutral.progressPercentage, 0);
  assert.deepEqual(stateAfterNeutral.completedConcepts, []);
  assert.equal(payloadAfterNeutral.checklist[0].status, 'introduced', 'Unmastered prior step must not be marked mastered');

  // Mastered advance must sync completedConcepts, progressPercentage, and mastered_steps across DB & payload
  const advMastered = await advanceStudySessionStep(db, sessionId, 'stu_logic', {
    targetStepIndex: 3,
    markCurrentStatus: 'MASTERED',
    conceptExplained: 'Proposition and Truth Functions',
    conceptCompleted: 'Proposition and Truth Functions',
    activeQuestion: null
  });
  const stateAfterMastered = JSON.parse(advMastered.session.teaching_state_json);
  const payloadAfterMastered = buildStudySessionPayload(advMastered.session, advMastered.topics[2], advMastered.topics);
  const expectedPct = Math.round((1 / advMastered.topics.length) * 100);
  assert.deepEqual(stateAfterMastered.completedConcepts, ['Proposition and Truth Functions']);
  assert.equal(stateAfterMastered.progressPercentage, expectedPct);
  assert.equal(payloadAfterMastered.progressPercentage, expectedPct);
  assert.equal(advMastered.session.mastered_steps, 1);

  // Frontend progress card renderer must honor backend progressPercentage
  const renderedCard = renderAdaptiveVisualBlockHtml('study_session', JSON.stringify(payloadAfterMastered));
  assert.ok(renderedCard.includes(`Step 3 of ${advMastered.topics.length} · ${expectedPct}%`), 'Frontend study_session card must render backend progressPercentage');

  db.close();
});
