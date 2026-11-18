'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const {
  parseMcqQuestion,
  extractStudentMcqChoice,
  evaluateAcademicAnswer,
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

test('Phase 3: MCQ Parsing, Student Option Extraction & Structured Evaluation', (t) => {
  const mcqQuestion = `Quick check: Which of the following is true about an Abstract Data Type (ADT)?
(A) It specifies how data is physically arranged in CPU memory.
(B) It defines what operations can be performed while hiding implementation details.
(C) It can only store primitive integer values.
(D) It cannot be implemented using arrays or pointers.`;

  const parsed = parseMcqQuestion(mcqQuestion);
  assert.equal(parsed.isMcq, true, 'Must identify question as MCQ');
  assert.equal(Object.keys(parsed.options).length, 4, 'Must extract 4 options');
  assert.equal(parsed.options.A, 'It specifies how data is physically arranged in CPU memory.');
  assert.equal(parsed.options.B, 'It defines what operations can be performed while hiding implementation details.');

  // Test extraction of student choices across variations
  assert.equal(extractStudentMcqChoice('B', parsed), 'B');
  assert.equal(extractStudentMcqChoice('Option B', parsed), 'B');
  assert.equal(extractStudentMcqChoice('(B)', parsed), 'B');
  assert.equal(extractStudentMcqChoice('ans is B', parsed), 'B');
  assert.equal(extractStudentMcqChoice('I choose A', parsed), 'A');
  assert.equal(extractStudentMcqChoice('it defines what operations can be performed while hiding implementation details', parsed), 'B');

  // Evaluate correct choice (B)
  const evalCorrect = evaluateAcademicAnswer('Option B', { topicTitle: 'Abstract Data Types (ADT)' }, mcqQuestion);
  assert.equal(evalCorrect.passed, true);
  assert.equal(evalCorrect.score, 1.0);
  assert.equal(evalCorrect.format, 'mcq');
  assert.equal(evalCorrect.selectedOption, 'B');
  assert.ok(evalCorrect.feedback.includes('Spot on!'));

  // Evaluate incorrect choice (A)
  const evalIncorrect = evaluateAcademicAnswer('A', { topicTitle: 'Abstract Data Types (ADT)' }, mcqQuestion);
  assert.equal(evalIncorrect.passed, false);
  assert.equal(evalIncorrect.score, 0.0);
  assert.equal(evalIncorrect.format, 'mcq');
  assert.equal(evalIncorrect.selectedOption, 'A');
  assert.ok(evalIncorrect.misconception);
  assert.ok(evalIncorrect.feedback.includes('correct choice is'));
});

test('Phase 3: Concise 1-2 Word Answers Pass Accurately (Eliminating 3-word rule penalty)', (t) => {
  // 1. Programming Complexity: "O(log n)"
  const evalBinarySearch = evaluateAcademicAnswer(
    'O(log n)',
    { topicTitle: 'Binary Search Algorithm' },
    'What is the worst-case time complexity of binary search?'
  );
  assert.equal(evalBinarySearch.passed, true, 'O(log n) must pass for binary search');
  assert.equal(evalBinarySearch.score, 1.0);

  // 2. Data Structure: "stack"
  const evalStack = evaluateAcademicAnswer(
    'stack',
    { topicTitle: 'Stack Data Structure' },
    'Which fundamental data structure operates strictly on a LIFO basis?'
  );
  assert.equal(evalStack.passed, true, '1-word answer "stack" must pass');
  assert.equal(evalStack.score, 1.0);

  // 3. Database Normalization: "3NF"
  const eval3NF = evaluateAcademicAnswer(
    '3NF',
    { topicTitle: 'Relational Database Normalization' },
    'Which normal form eliminates transitive functional dependencies?'
  );
  assert.equal(eval3NF.passed, true, '1-word answer "3NF" must pass');
  assert.equal(eval3NF.score, 1.0);

  // 4. Mathematics Boolean: "True"
  const evalTruth = evaluateAcademicAnswer(
    'True',
    { topicTitle: 'Set Theory Basics' },
    'Is the empty set a subset of every set? (True or False)'
  );
  assert.equal(evalTruth.passed, true, '1-word answer "True" must pass');
  assert.equal(evalTruth.score, 1.0);
});

test('Phase 3: Nonsense & Off-Topic Answers Fail (Eliminating 3-word rule loophole)', (t) => {
  // In the legacy system, any 3+ words passed (e.g. "cats are blue and nice" -> passed: true).
  // The new intelligent evaluator must reject it!
  const evalNonsense1 = evaluateAcademicAnswer(
    'cats are blue and nice',
    { topicTitle: 'Introduction to Java Virtual Machine (JVM)' },
    'What is bytecode and why does Java use it for platform independence?'
  );
  assert.equal(evalNonsense1.passed, false, 'Irrelevant 5-word sentence must NOT pass');
  assert.equal(evalNonsense1.score, 0.0);
  assert.ok(evalNonsense1.misconception.includes('Off-topic') || evalNonsense1.misconception.includes('irrelevant'));

  const evalNonsense2 = evaluateAcademicAnswer(
    'the weather is pleasant today outside',
    { topicTitle: 'Propositional Logic and Implication' },
    'Under what condition is the implication P -> Q false?'
  );
  assert.equal(evalNonsense2.passed, false, 'Weather statement must NOT pass logic question');
  assert.equal(evalNonsense2.score, 0.0);
});

test('Phase 3: Surrender & Uncertainty Triggers Step-by-Step Remediation', (t) => {
  const variations = ["I don't know", "idk", "no idea", "not sure", "confused, please explain", "thaha chaina"];

  for (const v of variations) {
    const res = evaluateAcademicAnswer(
      v,
      { topicTitle: 'Propositional Logic Implication' },
      'Under what condition is P -> Q false?'
    );
    assert.equal(res.passed, false, `Surrender phrase "${v}" must not pass`);
    assert.equal(res.isSurrender, true, `Must be flagged as isSurrender for "${v}"`);
    assert.equal(res.score, 0.0);
    assert.ok(res.feedback.includes("That's what I'm here for") || res.feedback.includes("Let's clarify"));
  }
});

test('Phase 3: Partial Credit & Misconception Diagnosis in Discrete Math & Logic', (t) => {
  const question = 'Under what condition is the implication P -> Q false?';
  const topic = { topicTitle: 'Propositional Logic & Conditionals' };

  // 1. Partial Credit: Student named P is true, but omitted Q
  const evalPartial = evaluateAcademicAnswer('when P is true', topic, question);
  assert.equal(evalPartial.passed, false, 'Partial answer should not fully pass');
  assert.equal(evalPartial.score, 0.5, 'Must award 0.5 partial credit');
  assert.equal(evalPartial.isPartialCredit, true);
  assert.ok(evalPartial.feedback.includes('first part right') || evalPartial.feedback.includes('truth value of $Q$'));

  // 2. Specific Misconception Diagnosis: Student said "when both are false"
  const evalMisconception = evaluateAcademicAnswer('when both P and Q are false', topic, question);
  assert.equal(evalMisconception.passed, false);
  assert.equal(evalMisconception.score, 0.0);
  assert.ok(evalMisconception.misconception.includes('Believed false premise'));
  assert.ok(evalMisconception.feedback.includes('vacuously TRUE'));

  // 3. Full Correct Answer
  const evalFull = evaluateAcademicAnswer('When P is true and Q is false', topic, question);
  assert.equal(evalFull.passed, true);
  assert.equal(evalFull.score, 1.0);
  assert.ok(evalFull.feedback.includes('Spot on!'));
});

test('Phase 3: SQL Query Assessment and Syntax Validation', (t) => {
  const question = 'Write a SQL query to select all students with grade A from the Students table.';
  const topic = { topicTitle: 'SQL Data Query Language (DQL)' };

  // Valid SQL
  const evalSql = evaluateAcademicAnswer(
    'SELECT * FROM Students WHERE grade = "A"',
    topic,
    question
  );
  assert.equal(evalSql.passed, true);
  assert.equal(evalSql.score, 1.0);
  assert.equal(evalSql.format, 'sql');

  // Invalid non-SQL answer
  const evalNonSql = evaluateAcademicAnswer('just look at the table', topic, question);
  assert.equal(evalNonSql.passed, false);
  assert.equal(evalNonSql.score, 0.0);
});

test('Phase 3: End-to-End Remediation Turn Integration & Topic Progress Database Logging', async (t) => {
  const db = await createTestDb();
  const studentId = 'student_phase3_test';
  const convId = 'conv_phase3_eval';

  // 1. Start Session
  const turn1 = await realAiAssistant.handleChat(
    db,
    'teach me java unit 2',
    { studentId, authenticated: true, currentSemester: 2 },
    [],
    convId,
    {
      conversationId: convId,
      chapterContext: {
        subject: 'Computer Programming II (Java)',
        subjectCode: 'CIT122',
        semesterNo: 2,
        unitNumber: 2,
        chapterTitle: 'Introduction to Java'
      },
      generateReply: async () => ({
        reply: 'Step 1: Introduction to JVM\n```study_session\n{"step":1}\n```\n🎯 Checkpoint Question: What is bytecode and why does Java use it?'
      })
    }
  );

  assert.equal(turn1.intent, 'study_partner');

  // 2. Student replies with an incorrect/nonsense answer: "the sky is purple"
  const turn2 = await realAiAssistant.handleChat(
    db,
    'the sky is purple',
    { studentId, authenticated: true, currentSemester: 2 },
    [{ role: 'assistant', content: turn1.reply }],
    convId,
    {
      conversationId: convId,
      chapterContext: {
        subject: 'Computer Programming II (Java)',
        subjectCode: 'CIT122',
        semesterNo: 2,
        unitNumber: 2,
        chapterTitle: 'Introduction to Java'
      },
      generateReply: async () => ({
        reply: 'That does not address the question. Bytecode is an intermediate language.'
      })
    }
  );

  // Assert that session stayed on step 1 and entered remediation mode
  assert.equal(turn2.intent, 'study_partner');
  assert.equal(turn2.currentStepIndex, 1, 'Must NOT advance step on incorrect answer');

  // Check database record for topic progress
  const topicRow = await db.get(
    `SELECT * FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 1`,
    turn1.studySessionId
  );
  assert.ok(topicRow, 'Topic progress row must exist');
  assert.equal(topicRow.coverage_state, 'REVISION_NEEDED', 'Coverage state must mark REVISION_NEEDED');
  assert.equal(topicRow.attempts_count, 1, 'Attempts count must increment to 1');
  assert.equal(topicRow.student_last_answer, 'the sky is purple');
  assert.ok(topicRow.misconception_log.includes('Off-topic') || topicRow.misconception_log.includes('irrelevant'));

  // 3. Student now replies with the correct answer: "bytecode is intermediate code executed by JVM"
  const turn3 = await realAiAssistant.handleChat(
    db,
    'Java compiles into bytecode, which is an intermediate representation executed by the JVM on any platform.',
    { studentId, authenticated: true, currentSemester: 2 },
    [{ role: 'assistant', content: turn2.reply }],
    convId,
    {
      conversationId: convId,
      chapterContext: {
        subject: 'Computer Programming II (Java)',
        subjectCode: 'CIT122',
        semesterNo: 2,
        unitNumber: 2,
        chapterTitle: 'Introduction to Java'
      },
      generateReply: async () => ({
        reply: 'Step 2: Basic Java Syntax\n```study_session\n{"step":2}\n```\n🎯 Checkpoint: What is a class?'
      })
    }
  );

  // Assert that session has now MASTERED step 1 and advanced to step 2!
  assert.equal(turn3.intent, 'study_partner');
  assert.equal(turn3.currentStepIndex, 2, 'Must advance to step 2 upon correct answer');

  const updatedTopicRow = await db.get(
    `SELECT * FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 1`,
    turn1.studySessionId
  );
  assert.equal(updatedTopicRow.status, 'MASTERED', 'Status must be marked MASTERED');
  assert.equal(updatedTopicRow.coverage_state, 'MASTERED', 'Coverage state must be MASTERED');
  assert.equal(updatedTopicRow.exercise_score, 1.0, 'Exercise score must be 1.0');
  assert.ok(updatedTopicRow.mastered_at, 'mastered_at timestamp must be set');
});
