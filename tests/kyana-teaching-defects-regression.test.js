'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const {
  evaluateAcademicAnswer,
  extractNumericalValueAndUnit,
  normalizeUnit,
  isNumericalMatch,
  DISCIPLINES
} = require('../lib/academic-teaching-engine');

const {
  evaluateCheckpointReply,
  startOrResumeStudySession,
  advanceStudySessionStep
} = require('../lib/study-partner-engine');

const { ensureRagSchema } = require('../lib/rag-schema');
const { formatRow, formatRows } = require('../db');
const realAiAssistant = require('../ai-assistant');

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

  await ensureRagSchema(db);
  return db;
}

// ----------------------------------------------------------------------------
// DEFECT REGRESSION TESTS
// ----------------------------------------------------------------------------

test('P0-1 & Regression 1 + 8: Clarification during active teaching checkpoint followed by checkpoint answer', async (t) => {
  const db = await createTestDb();
  const studentId = 'student_p0_clarify_test';
  const convId = 'conv_p0_clarify_test';

  const chapterContext = {
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    semesterNo: 1,
    unitNumber: 1,
    chapterTitle: 'Propositional Logic',
    learningMode: 'teach'
  };

  // Turn 1: Start lesson in Teach Mode
  const turn1 = await realAiAssistant.handleChat(
    db,
    'Teach me this chapter step by step',
    { studentId, authenticated: true, currentSemester: 1 },
    [],
    convId,
    {
      conversationId: convId,
      chapterContext,
      generateReply: async () => ({
        reply: 'Step 1: Conditional Statements (Implications)\n```study_session\n{"step":1}\n```\n🎯 Checkpoint Question: Under what condition is P → Q false?'
      })
    }
  );

  assert.equal(turn1.intent, 'study_partner');
  assert.equal(turn1.currentStepIndex, 1);

  // Verify session is active in DB at Step 1
  const session1 = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    convId
  );
  assert.ok(session1, 'Active session must exist in DB');
  assert.equal(session1.current_step_index, 1);
  assert.equal(session1.mastered_steps, 0);

  // Turn 2: Student asks a clarifying question during active teaching:
  // "What is the difference between an axiom and a theorem?"
  const turn2 = await realAiAssistant.handleChat(
    db,
    'What is the difference between an axiom and a theorem?',
    { studentId, authenticated: true, currentSemester: 1 },
    [{ role: 'assistant', content: turn1.reply }],
    convId,
    {
      conversationId: convId,
      chapterContext,
      generateReply: async () => ({
        reply: 'An axiom is a foundational statement accepted without proof as a starting point, whereas a theorem is a logical statement that has been proven true using axioms, definitions, and rules of inference.'
      })
    }
  );

  // Must route to chapter_tutor / clarification, NOT study_partner checkpoint evaluation
  assert.equal(turn2.intent, 'chapter_tutor', 'Clarifying question must route to chapter_tutor');
  assert.ok(turn2.metadata?.wasClarifyingInterruption, 'Must be marked as wasClarifyingInterruption');
  assert.ok(turn2.metadata?.inStudySession, 'Must preserve inStudySession context');
  assert.ok(turn2.reply.includes('axiom'), 'Reply must answer the student question');

  // Session in DB must be preserved: still ACTIVE, still at Step 1, ZERO mastered steps!
  const sessionAfterQ = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    convId
  );
  assert.equal(sessionAfterQ.current_step_index, 1, 'Current step must NOT advance upon clarification');
  assert.equal(sessionAfterQ.mastered_steps, 0, 'Mastery must NOT be awarded for clarification');

  const topicAfterQ = await db.get(
    `SELECT * FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 1`,
    session1.id
  );
  assert.notEqual(topicAfterQ.status, 'MASTERED', 'Topic progress status must NOT be MASTERED');

  // Turn 3: Student now answers the checkpoint question: "P is true and Q is false"
  const turn3 = await realAiAssistant.handleChat(
    db,
    'P is true and Q is false',
    { studentId, authenticated: true, currentSemester: 1 },
    [
      { role: 'assistant', content: turn1.reply },
      { role: 'user', content: 'What is the difference between an axiom and a theorem?' },
      { role: 'assistant', content: turn2.reply }
    ],
    convId,
    {
      conversationId: convId,
      chapterContext,
      generateReply: async () => ({
        reply: 'Step 2: Logical Equivalences\n```study_session\n{"step":2}\n```\n🎯 Checkpoint Question: State De Morgan’s Laws.'
      })
    }
  );

  assert.equal(turn3.intent, 'study_partner', 'Checkpoint answer must route to study_partner');
  assert.equal(turn3.currentStepIndex, 2, 'Session must now advance to step 2');

  const sessionAfterAnswer = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    convId
  );
  assert.equal(sessionAfterAnswer.current_step_index, 2);
  assert.equal(sessionAfterAnswer.mastered_steps, 1, 'Mastered steps must increment to 1');

  const topic1Mastered = await db.get(
    `SELECT * FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 1`,
    session1.id
  );
  assert.equal(topic1Mastered.status, 'MASTERED', 'Step 1 must be marked MASTERED');
});

test('P0-2 & Regression 2: Correct short answer evaluates to full credit', (t) => {
  const topic = { topicTitle: 'Conditional Statements', subject: 'Discrete Mathematics', subjectCode: 'CIT121' };
  const question = 'Under what condition is P → Q false?';

  const res1 = evaluateAcademicAnswer('when P is true and Q is false', topic, question);
  assert.equal(res1.passed, true);
  assert.equal(res1.score, 1.0);
  assert.equal(res1.format, 'math');

  const res2 = evaluateAcademicAnswer('P is true, Q is false', topic, question);
  assert.equal(res2.passed, true);
  assert.equal(res2.score, 1.0);
});

test('P0-2 & Regression 3: Incorrect answers containing question keywords strictly fail (no semantic false positives)', (t) => {
  const mathTopic = { topicTitle: 'Conditional Statements', subject: 'Discrete Mathematics', subjectCode: 'CIT121' };
  const mathQuestion = 'Under what condition is P → Q false?';

  // Replying just "false" (repeating a word from the prompt)
  const failFalse = evaluateAcademicAnswer('false', mathTopic, mathQuestion);
  assert.equal(failFalse.passed, false, 'Answering "false" must fail');
  assert.equal(failFalse.score, 0.0);
  assert.equal(failFalse.misconception, 'Stated truth value instead of condition');

  // Replying "condition is false"
  const failCondFalse = evaluateAcademicAnswer('condition is false', mathTopic, mathQuestion);
  assert.equal(failCondFalse.passed, false, 'Answering "condition is false" must fail');
  assert.equal(failCondFalse.score, 0.0);

  // Networking: Replying "Network layer" to Transport layer question
  const netTopic = { topicTitle: 'Transport Layer Protocols', subject: 'Computer Networks', subjectCode: 'CIT221' };
  const netQuestion = 'Which OSI layer provides end-to-end transport?';

  const failNet = evaluateAcademicAnswer('Network layer', netTopic, netQuestion);
  assert.equal(failNet.passed, false, 'Answering "Network layer" to Transport question must fail');
  assert.equal(failNet.score, 0.0);
  assert.ok(failNet.misconception.includes('network layer'), 'Misconception must diagnose network layer confusion');

  // Replying "Transport layer" passes
  const passTransport = evaluateAcademicAnswer('Transport layer', netTopic, netQuestion);
  assert.equal(passTransport.passed, true, 'Answering "Transport layer" must pass');
  assert.equal(passTransport.score, 1.0);
});

test('P0-2 & Regression 4: Partially correct answer provides constructive partial credit and prompts for missing condition', (t) => {
  const topic = { topicTitle: 'Conditional Statements', subject: 'Discrete Mathematics', subjectCode: 'CIT121' };
  const question = 'Under what condition is P → Q false?';

  // Missing Q condition
  const partP = evaluateAcademicAnswer('when P is true', topic, question);
  assert.equal(partP.passed, false);
  assert.equal(partP.score, 0.5);
  assert.equal(partP.isPartialCredit, true);
  assert.equal(partP.misconception, 'Omitted condition for Q');
  assert.ok(partP.feedback.includes('Q'), 'Feedback must prompt for Q');

  // Missing P condition
  const partQ = evaluateAcademicAnswer('Q is false', topic, question);
  assert.equal(partQ.passed, false);
  assert.equal(partQ.score, 0.5);
  assert.equal(partQ.isPartialCredit, true);
  assert.equal(partQ.misconception, 'Omitted condition for P');
  assert.ok(partQ.feedback.includes('P'), 'Feedback must prompt for P');
});

test('P0-2 & Regression 5: Alternative correct terminology and typo tolerance in formal logic', (t) => {
  const topic = { topicTitle: 'Conditional Statements', subject: 'Discrete Mathematics', subjectCode: 'CIT121' };
  const question = 'Under what condition is P → Q false?';

  const variations = [
    'T then F',
    'true implies false',
    'tru implies fals',
    'antecedent true consequent false',
    'antecedent is true and consequent is false',
    'premise true, conclusion false',
    'T -> F = F',
    'P=T and Q=F',
    'when p is tru and q is fals'
  ];

  for (const text of variations) {
    const res = evaluateAcademicAnswer(text, topic, question);
    assert.equal(res.passed, true, `Variation "${text}" must pass`);
    assert.equal(res.score, 1.0);
  }
});

test('P1-3 & Regression 6: Re-clicking Teach Me during active session resumes at current step (does not restart from Step 1)', async (t) => {
  const db = await createTestDb();
  const studentId = 'student_p1_reclick_test';
  const convId = 'conv_p1_reclick_test';

  const chapterContext = {
    subject: 'Computer Programming II (Java)',
    subjectCode: 'CIT122',
    semesterNo: 2,
    unitNumber: 2,
    chapterTitle: 'Object Oriented Programming',
    learningMode: 'teach'
  };

  // 1. Start lesson
  const turn1 = await realAiAssistant.handleChat(
    db,
    'Teach me this chapter step by step',
    { studentId, authenticated: true, currentSemester: 2 },
    [],
    convId,
    {
      conversationId: convId,
      chapterContext,
      generateReply: async () => ({
        reply: 'Step 1: Classes\n```study_session\n{"step":1}\n```\n🎯 Checkpoint: What is a class?'
      })
    }
  );

  // Advance to Step 2
  await realAiAssistant.handleChat(
    db,
    'next',
    { studentId, authenticated: true, currentSemester: 2 },
    [{ role: 'assistant', content: turn1.reply }],
    convId,
    {
      conversationId: convId,
      chapterContext,
      generateReply: async () => ({
        reply: 'Step 2: Objects\n```study_session\n{"step":2}\n```\n🎯 Checkpoint: What is an instance?'
      })
    }
  );

  // Advance to Step 3
  const turn3 = await realAiAssistant.handleChat(
    db,
    'next',
    { studentId, authenticated: true, currentSemester: 2 },
    [{ role: 'assistant', content: 'Step 2: Objects' }],
    convId,
    {
      conversationId: convId,
      chapterContext,
      generateReply: async () => ({
        reply: 'Step 3: Encapsulation\n```study_session\n{"step":3}\n```\n🎯 Checkpoint: Why do we use private fields?'
      })
    }
  );

  assert.equal(turn3.currentStepIndex, 3, 'Must be on Step 3');

  // Verify DB state
  const sessionBeforeReclick = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    convId
  );
  assert.equal(sessionBeforeReclick.current_step_index, 3);

  // 2. Student re-clicks "Teach Me" quick chip (sends "Continue teaching this chapter" or "Teach me this chapter step by step")
  const turnReclick = await realAiAssistant.handleChat(
    db,
    'Continue teaching this chapter',
    { studentId, authenticated: true, currentSemester: 2 },
    [{ role: 'assistant', content: turn3.reply }],
    convId,
    {
      conversationId: convId,
      chapterContext,
      generateReply: async () => ({
        reply: 'Resuming Step 3: Encapsulation'
      })
    }
  );

  assert.equal(turnReclick.intent, 'study_partner');
  assert.equal(turnReclick.currentStepIndex, 3, 'Must remain on Step 3 upon re-clicking Teach Me (not restarted to 1, not skipped to 4)');

  const sessionAfterReclick = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    convId
  );
  assert.equal(sessionAfterReclick.current_step_index, 3, 'DB session must still be on Step 3');
  assert.equal(sessionAfterReclick.id, sessionBeforeReclick.id, 'Session ID must be preserved (not replaced)');
});

test('P1-3 & Regression 7: Switching modes and returning to Teach Me preserves conversation history and step progress', async (t) => {
  const db = await createTestDb();
  const studentId = 'student_p1_modeswitch_test';
  const convId = 'conv_p1_modeswitch_test';

  const baseChapterContext = {
    subject: 'Computer Programming II (Java)',
    subjectCode: 'CIT122',
    semesterNo: 2,
    unitNumber: 2,
    chapterTitle: 'Object Oriented Programming'
  };

  // 1. Start lesson on Teach mode
  const turn1 = await realAiAssistant.handleChat(
    db,
    'Teach me this chapter step by step',
    { studentId, authenticated: true, currentSemester: 2 },
    [],
    convId,
    {
      conversationId: convId,
      chapterContext: { ...baseChapterContext, learningMode: 'teach' },
      generateReply: async () => ({
        reply: 'Step 1: Classes\n```study_session\n{"step":1}\n```\n🎯 Checkpoint: What is a class?'
      })
    }
  );

  // Advance to Step 2
  await realAiAssistant.handleChat(
    db,
    'next',
    { studentId, authenticated: true, currentSemester: 2 },
    [{ role: 'assistant', content: turn1.reply }],
    convId,
    {
      conversationId: convId,
      chapterContext: { ...baseChapterContext, learningMode: 'teach' }
    }
  );

  const sessionAtStep2 = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    convId
  );
  assert.equal(sessionAtStep2.current_step_index, 2);

  // 2. Student switches to "explain" mode and asks a question
  const turnExplain = await realAiAssistant.handleChat(
    db,
    'Explain how abstract classes differ from interfaces',
    { studentId, authenticated: true, currentSemester: 2 },
    [{ role: 'assistant', content: 'Step 2: Inheritance' }],
    convId,
    {
      conversationId: convId,
      chapterContext: { ...baseChapterContext, learningMode: 'explain' },
      generateReply: async () => ({
        reply: 'Abstract classes can have state and constructor methods, while interfaces typically define pure contracts.'
      })
    }
  );

  assert.equal(turnExplain.intent, 'chapter_tutor', 'Explain mode must route to chapter_tutor');

  // Verify session at Step 2 is still untouched in DB
  const sessionAfterExplain = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    convId
  );
  assert.equal(sessionAfterExplain.current_step_index, 2);

  // 3. Student switches back to "teach" mode
  const turnReturnTeach = await realAiAssistant.handleChat(
    db,
    'Continue teaching this chapter',
    { studentId, authenticated: true, currentSemester: 2 },
    [{ role: 'assistant', content: turnExplain.reply }],
    convId,
    {
      conversationId: convId,
      chapterContext: { ...baseChapterContext, learningMode: 'teach' },
      generateReply: async () => ({
        reply: 'Resuming Step 2: Inheritance'
      })
    }
  );

  assert.equal(turnReturnTeach.intent, 'study_partner');
  assert.equal(turnReturnTeach.currentStepIndex, 2, 'Must resume at Step 2');
});

test('P1-4 & Regression 9: Clarification or confusion never awarded MASTERED in LLM fallback evaluation', async (t) => {
  const db = await createTestDb();
  const studentId = 'student_p1_nomastery_test';
  const convId = 'conv_p1_nomastery_test';

  const chapterContext = {
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    semesterNo: 1,
    unitNumber: 1,
    chapterTitle: 'Propositional Logic',
    learningMode: 'teach'
  };

  // Start lesson
  const turn1 = await realAiAssistant.handleChat(
    db,
    'Teach me this chapter step by step',
    { studentId, authenticated: true, currentSemester: 1 },
    [],
    convId,
    {
      conversationId: convId,
      chapterContext,
      generateReply: async () => ({
        reply: 'Step 1: Propositions\n```study_session\n{"step":1}\n```\n🎯 Checkpoint Question: Is "x + 2 = 5" a proposition? Why or why not?'
      })
    }
  );

  // Student expresses confusion: "bujhina, can you explain with an example?"
  // Even if the LLM evaluate hook returned passed=true, the engine must NEVER advance or mark mastered!
  const turnConfuse = await realAiAssistant.handleChat(
    db,
    'bujhina, can you explain with an example?',
    { studentId, authenticated: true, currentSemester: 1 },
    [{ role: 'assistant', content: turn1.reply }],
    convId,
    {
      conversationId: convId,
      chapterContext,
      generateReply: async () => ({
        reply: '{"passed": true, "feedback": "Good question"}'
      })
    }
  );

  // Step must NOT advance
  const session = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    convId
  );
  assert.equal(session.current_step_index, 1, 'Must remain on Step 1');
  assert.equal(session.mastered_steps, 0, 'Must NOT award mastery');

  const topicProgress = await db.get(
    `SELECT * FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 1`,
    session.id
  );
  assert.notEqual(topicProgress.status, 'MASTERED', 'Topic status must not be MASTERED');
});

test('P2-5 & Regression 10: Numerical answers evaluate with and without spaces in units (20V vs 20 V)', (t) => {
  const topic = { topicTitle: 'Ohm’s Law & Circuit Analysis', subject: 'Basic Electrical & Electronics', subjectCode: 'PHY101' };
  const question = 'Calculate the voltage across a 10 ohm resistor carrying 2 A of current. [Answer: 20V]';

  // Without space
  const resNoSpace = evaluateAcademicAnswer('20V', topic, question);
  assert.equal(resNoSpace.passed, true, '"20V" must pass');
  assert.equal(resNoSpace.score, 1.0);
  assert.equal(resNoSpace.format, 'calculation');

  // With space
  const resWithSpace = evaluateAcademicAnswer('20 V', topic, question);
  assert.equal(resWithSpace.passed, true, '"20 V" must pass');
  assert.equal(resWithSpace.score, 1.0);
  assert.equal(resWithSpace.format, 'calculation');

  // Spelled-out unit
  const resSpelled = evaluateAcademicAnswer('20 volts', topic, question);
  assert.equal(resSpelled.passed, true, '"20 volts" must pass');
  assert.equal(resSpelled.score, 1.0);

  // Lowercase unit
  const resLower = evaluateAcademicAnswer('20v', topic, question);
  assert.equal(resLower.passed, true, '"20v" must pass');
  assert.equal(resLower.score, 1.0);
});

test('P2-5 & Regression 11: Incorrect units evaluate to partial credit with unit mismatch misconception (20A vs 20V)', (t) => {
  const topic = { topicTitle: 'Ohm’s Law & Circuit Analysis', subject: 'Basic Electrical & Electronics', subjectCode: 'PHY101' };
  const question = 'Calculate the voltage across a 10 ohm resistor carrying 2 A of current. [Answer: 20V]';

  // Wrong unit: 20A instead of 20V
  const resWrongUnit = evaluateAcademicAnswer('20A', topic, question);
  assert.equal(resWrongUnit.passed, false, '"20A" must not pass for voltage');
  assert.equal(resWrongUnit.score, 0.5, 'Must award 0.5 partial credit for correct number');
  assert.equal(resWrongUnit.isPartialCredit, true);
  assert.equal(resWrongUnit.misconception, 'Incorrect unit of measurement');
  assert.ok(resWrongUnit.feedback.includes('unit is wrong') || resWrongUnit.feedback.includes('Amperes'), 'Feedback must explain unit mismatch');

  // Also with space: 20 A
  const resWrongUnitSpace = evaluateAcademicAnswer('20 A', topic, question);
  assert.equal(resWrongUnitSpace.passed, false);
  assert.equal(resWrongUnitSpace.score, 0.5);
  assert.equal(resWrongUnitSpace.isPartialCredit, true);
});

test('P2-5 & Regression 12: Numerical answers evaluate with floating-point tolerance (19.99 vs 20.0)', (t) => {
  const topic = { topicTitle: 'Circuit Calculations', subject: 'Basic Electrical Engineering' };
  const question = 'Find the output voltage. [Answer: 20.0V]';

  // 19.99 V (0.05% error, within 1% tolerance)
  const res1999 = evaluateAcademicAnswer('19.99 V', topic, question);
  assert.equal(res1999.passed, true, '19.99 V must pass within 1% tolerance of 20.0 V');
  assert.equal(res1999.score, 1.0);

  // 20.01 V (0.05% error, within 1% tolerance)
  const res2001 = evaluateAcademicAnswer('20.01V', topic, question);
  assert.equal(res2001.passed, true, '20.01 V must pass within 1% tolerance of 20.0 V');
  assert.equal(res2001.score, 1.0);

  // 20.5 V (2.5% error, exceeds 1% tolerance)
  const res205 = evaluateAcademicAnswer('20.5 V', topic, question);
  assert.equal(res205.passed, false, '20.5 V must fail (exceeds 1% tolerance)');
  assert.equal(res205.score, 0.0);
});

test('P2-5 Helper Unit Tests: extractNumericalValueAndUnit, normalizeUnit, isNumericalMatch', (t) => {
  // normalizeUnit
  assert.equal(normalizeUnit('Volts'), 'v');
  assert.equal(normalizeUnit('V'), 'v');
  assert.equal(normalizeUnit('Amperes'), 'a');
  assert.equal(normalizeUnit('Amps'), 'a');
  assert.equal(normalizeUnit('A'), 'a');
  assert.equal(normalizeUnit('ohms'), 'ohm');
  assert.equal(normalizeUnit('Ω'), 'ohm');
  assert.equal(normalizeUnit('Hz'), 'hz');
  assert.equal(normalizeUnit('seconds'), 's');

  // isNumericalMatch
  assert.equal(isNumericalMatch(20.0, 20.0), true);
  assert.equal(isNumericalMatch(19.99, 20.0, 0.01), true);
  assert.equal(isNumericalMatch(20.1, 20.0, 0.01), true);
  assert.equal(isNumericalMatch(20.3, 20.0, 0.01), false);

  // extractNumericalValueAndUnit
  const parsed1 = extractNumericalValueAndUnit('20V');
  assert.equal(parsed1.value, 20);
  assert.equal(parsed1.unit, 'v');

  const parsed2 = extractNumericalValueAndUnit('20 V');
  assert.equal(parsed2.value, 20);
  assert.equal(parsed2.unit, 'v');

  const parsed3 = extractNumericalValueAndUnit('1/2');
  assert.equal(parsed3.value, 0.5);

  const parsed4 = extractNumericalValueAndUnit('-15.5 mA');
  assert.equal(parsed4.value, -15.5);
  assert.equal(parsed4.unit, 'ma');
});
