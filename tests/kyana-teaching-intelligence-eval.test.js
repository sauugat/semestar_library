'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createClient } = require('@libsql/client');
const { formatRow, formatRows } = require('../db');
const { ensureRagSchema } = require('../lib/rag-schema');
const { ensureSchema } = require('../lib/ai-chat-service');
const { createChatHandler } = require('../lib/chat-http');
const { handleChat } = require('../ai-assistant');
const {
  evaluateAcademicAnswer,
  detectAcademicDiscipline,
  DISCIPLINES
} = require('../lib/academic-teaching-engine');
const { TEST_SCENARIOS } = require('../scripts/benchmark-teaching-baseline');

function createTestDb() {
  const client = createClient({ url: ':memory:' });
  return {
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
    },
    close() {
      try { client.close(); } catch (_) {}
    }
  };
}

test('Teaching Intelligence: Multi-Discipline Answer Evaluation Suite (32 Scenarios)', async (t) => {
  for (const s of TEST_SCENARIOS) {
    const result = evaluateAcademicAnswer(s.studentAnswer, {
      topicTitle: s.topic,
      subject: s.subject,
      subjectCode: s.subjectCode
    }, s.question);

    assert.equal(
      result.passed,
      s.expectedPass,
      `Scenario ${s.id} (${s.subjectCode} - ${s.topic}): expected passed=${s.expectedPass}, got ${result.passed}. Feedback: ${result.feedback}`
    );

    if (s.expectedScore !== undefined) {
      const actualScore = result.score ?? (result.passed ? 1.0 : 0.0);
      assert.ok(
        Math.abs(actualScore - s.expectedScore) < 0.05,
        `Scenario ${s.id}: expected score=${s.expectedScore}, got ${actualScore}`
      );
    }

    if (s.expectedClarification) {
      assert.equal(
        result.isClarification,
        true,
        `Scenario ${s.id}: expected isClarification=true, got ${Boolean(result.isClarification)}`
      );
    }

    if (s.expectedMisconception) {
      assert.ok(
        result.misconception,
        `Scenario ${s.id}: expected misconception to be diagnosed`
      );
    }
  }
});

test('Teaching Intelligence: Elimination of Confident False-Positive Keyword Echoes', (t) => {
  // Test case 1: UDP claiming packet delivery guarantee
  const udpTrap = evaluateAcademicAnswer(
    'UDP guarantees packet delivery and automatically retransmits dropped segments using sliding windows',
    { topicTitle: 'Transport Layer Protocols', subjectCode: 'CIT223' },
    'Why is UDP preferred over TCP for live video streaming and DNS queries?'
  );
  assert.equal(udpTrap.passed, false, 'Confident false claim about UDP reliability must strictly fail');
  assert.equal(udpTrap.score, 0.0);
  assert.ok(udpTrap.misconception.includes('TCP reliability mechanisms to UDP'));

  // Test case 2: Equivalence relation with asymmetric keyword
  const equivTrap = evaluateAcademicAnswer(
    'An equivalence relation is reflexive, asymmetric, and transitive',
    { topicTitle: 'Equivalence Relations', subjectCode: 'CIT121' },
    'What three properties must a relation satisfy to be an equivalence relation?'
  );
  assert.equal(equivTrap.passed, false, 'Asymmetric property must fail equivalence relation');
  assert.equal(equivTrap.score, 0.0);
  assert.ok(equivTrap.misconception.includes('asymmetric'));

  // Test case 3: KCL claiming equal current splitting
  const kclTrap = evaluateAcademicAnswer(
    'KCL states that current splits equally across every junction and voltage remains constant throughout all resistors',
    { topicTitle: 'Kirchhoff\'s Laws', subjectCode: 'ELX111' },
    'What does Kirchhoff\'s Current Law (KCL) state regarding a junction or node in a circuit?'
  );
  assert.equal(kclTrap.passed, false, 'Equal current split claim must fail KCL');
  assert.equal(kclTrap.score, 0.0);
});

test('Teaching Intelligence: HTTP Sanitization Preserves learningMode in chapterContext', async (t) => {
  const db = createTestDb();
  await ensureRagSchema(db);
  await ensureSchema(db);

  let capturedChapterContext = null;
  const mockAssistant = {
    async handleChat(dbParam, message, studentInfo, history, conversationId, options) {
      capturedChapterContext = options?.chapterContext;
      return {
        reply: 'Mock reply for learning mode',
        intent: 'chapter_tutor',
        currentStepIndex: 1
      };
    }
  };

  const handler = createChatHandler(db, mockAssistant);

  const req = {
    body: {
      message: 'Can we solve this step by step?',
      history: [],
      conversationId: 'conv_mode_test_1',
      chapterContext: {
        subject: 'Discrete Mathematics',
        subjectCode: 'CIT121',
        semesterNo: 1,
        unitNumber: 2,
        chapterTitle: 'Predicate Logic',
        fileIds: [10],
        learningMode: 'solve'
      }
    },
    user: { studentId: 'student_mode_1' }
  };

  const res = {
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };

  await handler(req, res);

  assert.ok(capturedChapterContext, 'chapterContext must be delivered to assistant');
  assert.equal(capturedChapterContext.learningMode, 'solve', 'learningMode "solve" must be preserved through HTTP sanitization');
  assert.equal(capturedChapterContext.subjectCode, 'CIT121');

  db.close();
});

test('Teaching Intelligence: Multi-Stage Misconception Remediation & Retry Progression', async (t) => {
  const db = createTestDb();
  await ensureRagSchema(db);
  await ensureSchema(db);

  const student = { studentId: 'student_remediation_test', currentSemester: 1, authenticated: true };
  const convId = 'conv_remediation_flow_1';
  const chapterContext = {
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    semesterNo: 1,
    unitNumber: 1,
    chapterTitle: 'Propositional Logic',
    learningMode: 'teach'
  };

  const history = [];

  // Turn 1: Start Lesson
  const t1 = await handleChat(
    db,
    'Teach me this chapter step by step',
    student,
    history,
    convId,
    {
      chapterContext,
      generateReply: async () => ({
        reply: 'Step 1: Conditional Statements\n```study_session\n{"step":1}\n```\n🎯 Checkpoint Question: Under what condition is P → Q false?'
      })
    }
  );
  assert.equal(t1.currentStepIndex, 1);
  history.push({ role: 'user', content: 'Teach me this chapter step by step' });
  history.push({ role: 'assistant', content: t1.reply });

  // Turn 2: Student gives incorrect answer containing misconception (false premise implies false)
  const t2 = await handleChat(
    db,
    'when both P and Q are false',
    student,
    history,
    convId,
    {
      chapterContext,
      generateReply: async () => ({
        reply: 'Remediation Step 1\n```study_session\n{"step":1}\n```\n🎯 Checkpoint Question (Try Again): Under what condition is P → Q false?'
      })
    }
  );
  assert.equal(t2.currentStepIndex, 1, 'Incorrect answer must preserve current step');
  assert.ok(t2.reply.includes('⚠️ **Identified Misconception:**') || t2.reply.includes('vacuously TRUE') || t2.reply.includes('Common pitfall'), 'Must identify misconception');
  assert.ok(t2.reply.includes('Checkpoint Question (Try Again):') || t2.reply.includes('Checkpoint Question'), 'Must prompt retry');

  // Check database progress logged as REVISION_NEEDED
  const rowAfterFailure = await db.get(
    `SELECT coverage_state, attempts_count, misconception_log FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 1`,
    t1.studySessionId
  );
  assert.equal(rowAfterFailure.coverage_state, 'REVISION_NEEDED');
  assert.equal(rowAfterFailure.attempts_count, 1);

  // Turn 3: Student asks a clarification question during retry
  const t3 = await handleChat(
    db,
    'Wait, what is the antecedent and consequent again?',
    student,
    history,
    convId,
    {
      chapterContext,
      generateReply: async () => ({
        reply: 'In P → Q, P is the antecedent (premise) and Q is the consequent (conclusion).'
      })
    }
  );
  assert.equal(t3.intent, 'chapter_tutor', 'Clarification question routes to chapter_tutor');
  assert.equal(t3.metadata?.wasClarifyingInterruption, true, 'Flagged as clarifying interruption');

  // Verify step index was NOT advanced by clarification
  const sessAfterClarification = await db.get(
    `SELECT current_step_index FROM study_partner_sessions WHERE id = ?`,
    t1.studySessionId
  );
  assert.equal(sessAfterClarification.current_step_index, 1, 'Clarification must not advance step');

  // Turn 4: Student provides revised correct answer using alternative terminology
  const t4 = await handleChat(
    db,
    'The antecedent is true and the consequent is false',
    student,
    history,
    convId,
    {
      chapterContext,
      generateReply: async () => ({
        reply: 'Step 2: Logical Equivalences\n```study_session\n{"step":2}\n```\n🎯 Checkpoint Question: What is De Morgan’s Law?'
      })
    }
  );
  assert.equal(t4.currentStepIndex, 2, 'Revised correct answer must advance to Step 2');

  // Check database topic 1 is now MASTERED
  const rowAfterPass = await db.get(
    `SELECT coverage_state FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 1`,
    t1.studySessionId
  );
  assert.equal(rowAfterPass.coverage_state, 'MASTERED', 'Topic 1 must now be marked MASTERED');

  db.close();
});
