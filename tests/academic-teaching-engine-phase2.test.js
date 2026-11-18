'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  DISCIPLINES,
  SCOPE_CATEGORIES,
  detectAcademicDiscipline,
  resolveTeachingStrategy,
  classifyAcademicQuestionScope,
  createTeachingState,
  updateTeachingStateOnTurn,
  formatTeachingStatePromptContext,
  generateSubjectAdaptiveCheckpoint
} = require('../lib/academic-teaching-engine');

const {
  startOrResumeStudySession,
  advanceStudySessionStep,
  buildStudyPartnerLlmPrompt
} = require('../lib/study-partner-engine');

const {
  analyzeChapterStudentQuestion
} = require('../lib/chapter-tutor-engine');

const { ensureRagSchema } = require('../lib/rag-schema');
const { formatRow, formatRows } = require('../db');
const { createClient } = require('@libsql/client');

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
    },
    close() {
      try { client.close(); } catch (_) {}
    }
  };
  await ensureRagSchema(db);
  return db;
}

test('Phase 2: Discipline Detection & Adaptive Strategy Resolution across University Catalog', (t) => {
  // 1. Mathematics (Discrete Math & Calculus)
  const mathStrat = resolveTeachingStrategy('Discrete Mathematics', 'CIT121', 'Propositional Logic and Implication');
  assert.equal(mathStrat.discipline, DISCIPLINES.MATHEMATICS);
  assert.ok(mathStrat.depthRulesText.includes('MATHEMATICS & LOGIC'));
  assert.ok(mathStrat.sectionTitles[2].includes('Derivation, Truth Table'));

  // 2. Programming (C & Java)
  const progStrat = resolveTeachingStrategy('Computer Programming II (Java)', 'CIT122', 'Inheritance and Polymorphism');
  assert.equal(progStrat.discipline, DISCIPLINES.PROGRAMMING);
  assert.ok(progStrat.depthRulesText.includes('PROGRAMMING & ALGORITHMS'));
  assert.ok(progStrat.sectionTitles[2].includes('Complete Commented Code Example'));

  // 3. Physics & Electronics (Basic Electronics)
  const physStrat = resolveTeachingStrategy('Basic Electronics', 'ELX111', 'Kirchhoff Laws and Circuit Mesh');
  assert.equal(physStrat.discipline, DISCIPLINES.PHYSICS);
  assert.ok(physStrat.depthRulesText.includes('PHYSICS & ELECTRONICS'));
  assert.ok(physStrat.sectionTitles[1].includes('Governing Laws, Equations & SI Units'));

  // 4. Database Systems (DBMS)
  const dbStrat = resolveTeachingStrategy('Database Management System', 'CIT213', 'Normalization up to 3NF');
  assert.equal(dbStrat.discipline, DISCIPLINES.DATABASE);
  assert.ok(dbStrat.depthRulesText.includes('DATABASE MANAGEMENT SYSTEMS'));
  assert.ok(dbStrat.sectionTitles[2].includes('SQL Query or Schema Normalization'));

  // 5. Computer Networks (Networking)
  const netStrat = resolveTeachingStrategy('Computer Networks', 'CIT221', 'TCP Three-Way Handshake');
  assert.equal(netStrat.discipline, DISCIPLINES.NETWORKING);
  assert.ok(netStrat.depthRulesText.includes('COMPUTER NETWORKING'));
  assert.ok(netStrat.sectionTitles[2].includes('Step-by-Step Packet Flow'));

  // 6. Automata & Computation Theory
  const autoStrat = resolveTeachingStrategy('Theory of Computation', 'CIT222', 'Deterministic Finite Automata (DFA)');
  assert.equal(autoStrat.discipline, DISCIPLINES.AUTOMATA);
  assert.ok(autoStrat.depthRulesText.includes('AUTOMATA & COMPUTATION THEORY'));
  assert.ok(mathStrat.sectionTitles[2].includes('Derivation') || autoStrat.sectionTitles[2].includes('Transition Table'));

  // 7. Graph Theory
  const graphStrat = resolveTeachingStrategy('Discrete Mathematics', 'CIT121', 'Dijkstras Shortest Path Algorithm');
  assert.equal(graphStrat.discipline, DISCIPLINES.GRAPH_THEORY);
  assert.ok(graphStrat.depthRulesText.includes('GRAPH THEORY'));
  assert.ok(graphStrat.sectionTitles[1].includes('Graph Topology'));

  // 8. General Theory
  const theoryStrat = resolveTeachingStrategy('Basics of IT', 'CIT112', 'Generations of Computing Systems');
  assert.equal(theoryStrat.discipline, DISCIPLINES.THEORY);
  assert.ok(theoryStrat.depthRulesText.includes('CONCEPTUAL & THEORY SUBJECTS'));
});

test('Phase 2: Academic Question Scope Classification (5 Categories)', (t) => {
  const context = {
    activeSubject: 'Discrete Mathematics',
    activeSubjectCode: 'CIT121',
    activeUnitNumber: 1,
    activeChapterTitle: 'Unit 1: Logic and Induction',
    syllabusTopics: ['Propositional Logic', 'Truth Tables', 'Implication', 'Mathematical Induction'],
    courseUnits: [
      { unitNumber: 1, title: 'Unit 1: Logic and Induction', topics: ['Propositional Logic', 'Implication'] },
      { unitNumber: 2, title: 'Unit 2: Sets and Relations', topics: ['Set Operations', 'Equivalence Relations'] },
      { unitNumber: 5, title: 'Unit 5: Graph Theory', topics: ['Trees', 'Shortest Paths', 'Dijkstra'] }
    ]
  };

  // 1. Direct active chapter question
  const activeQ = classifyAcademicQuestionScope('Explain the truth table for implication', context);
  assert.equal(activeQ.scopeType, SCOPE_CATEGORIES.ACTIVE_CHAPTER);
  assert.equal(activeQ.targetUnit, 1);

  // 2. Prerequisite concept
  const prereqQ = classifyAcademicQuestionScope('What is a set before we do induction?', context);
  assert.equal(prereqQ.scopeType, SCOPE_CATEGORIES.PREREQUISITE_CONCEPT);

  // 3. Question from another unit of same course
  const crossUnitQ = classifyAcademicQuestionScope('Explain Dijkstra algorithm in Unit 5', context);
  assert.equal(crossUnitQ.scopeType, SCOPE_CATEGORIES.OTHER_COURSE_CHAPTER);
  assert.equal(crossUnitQ.targetUnit, 5);
  assert.equal(crossUnitQ.targetTitle, 'Unit 5: Graph Theory');

  // 4. General academic / computing concept outside course syllabus
  const generalQ = classifyAcademicQuestionScope('How does an operating system manage virtual memory paging?', context);
  assert.equal(generalQ.scopeType, SCOPE_CATEGORIES.GENERAL_ACADEMIC);

  // 5. Strict non-academic query
  const nonAcademicQ = classifyAcademicQuestionScope('Who won the premier league football match yesterday?', context);
  assert.equal(nonAcademicQ.scopeType, SCOPE_CATEGORIES.NON_ACADEMIC);
});

test('Phase 2: Structured Teaching State Initialization, Persistence, and Prompt Context', async (t) => {
  const db = await createTestDb();

  const sessRes = await startOrResumeStudySession(db, {
    studentId: 'student_teaching_state_test',
    conversationId: 'conv_teaching_state_test',
    subject: 'Discrete Mathematics',
    subjectCode: 'CIT121',
    semesterNo: 2,
    unitNumber: 1,
    chapterQuery: 'Logic and Induction'
  });

  const session = sessRes.session;
  assert.ok(session.teaching_state_json, 'Session must persist teaching_state_json');

  const parsedState = JSON.parse(session.teaching_state_json);
  assert.equal(parsedState.subjectCode, 'CIT121');
  assert.equal(parsedState.discipline, DISCIPLINES.MATHEMATICS);
  assert.equal(parsedState.activeStepIndex, 1);
  assert.equal(parsedState.flowState, 'EXPLAIN');

  // Update state with turn progress
  const updatedState = updateTeachingStateOnTurn(parsedState, {
    conceptExplained: 'Propositional Logic',
    exampleSolved: 'Implication Truth Table Row 3',
    questionAsked: 'Under what condition is P -> Q false?',
    studentAnswer: { text: 'When P is true and Q is false', passed: true }
  });

  assert.ok(updatedState.explainedConcepts.includes('Propositional Logic'));
  assert.ok(updatedState.understoodConcepts.includes('Propositional Logic'));
  assert.equal(updatedState.studentAnswers.length, 1);

  // Prompt formatting verification
  const promptSummary = formatTeachingStatePromptContext(updatedState);
  assert.ok(promptSummary.includes('STRUCTURED TEACHING STATE & PROGRESSION MEMORY'));
  assert.ok(promptSummary.includes('Concepts Already Taught & Explained: "Propositional Logic"'));
  assert.ok(promptSummary.includes('Concepts Student Has Demonstrated Comprehension Of: "Propositional Logic"'));

  // Test buildStudyPartnerLlmPrompt includes discipline and state
  session.teaching_state = updatedState;
  const prompt = buildStudyPartnerLlmPrompt({
    session,
    step: sessRes.topics[0],
    topics: sessRes.topics,
    noteChunks: []
  });

  assert.ok(prompt.includes('Academic Discipline: Mathematics & Formal Logic Methodology'), 'Prompt must show discipline');
  assert.ok(prompt.includes('STRUCTURED TEACHING STATE & PROGRESSION MEMORY'), 'Prompt must include structured teaching memory');
  assert.ok(prompt.includes('📐 **Formal Mathematical Definitions, Notation & Theorems**'), 'Must use math section headers');
});

test('Phase 2: Advancement vs Mastery Separation (Advancing does not falsely mark MASTERED)', async (t) => {
  const db = await createTestDb();

  const sessRes = await startOrResumeStudySession(db, {
    studentId: 'student_mastery_sep_test',
    conversationId: 'conv_mastery_sep_test',
    subject: 'Computer Programming II (Java)',
    subjectCode: 'CIT122',
    semesterNo: 2,
    unitNumber: 2,
    chapterQuery: 'Introduction to Java'
  });

  const sessionId = sessRes.session.id;

  // 1. Student merely advances ("next") without evaluation pass
  const advanceRes = await advanceStudySessionStep(db, sessionId, 'student_mastery_sep_test', {
    targetStepIndex: 2,
    markCurrentStatus: 'INTRODUCED',
    coverageState: 'INTRODUCED'
  });

  assert.equal(advanceRes.currentStepIndex, 2);

  // Check step 1 in DB
  const step1Topic = await db.get(
    `SELECT * FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 1`,
    sessionId
  );
  assert.equal(step1Topic.status, 'INTRODUCED', 'Merely advancing must set status to INTRODUCED, not MASTERED');
  assert.equal(step1Topic.coverage_state, 'INTRODUCED', 'coverage_state must be INTRODUCED');
  assert.equal(step1Topic.mastered_at, null, 'mastered_at must remain null');
  assert.equal(advanceRes.session.mastered_steps, 0, 'mastered_steps must remain 0');

  // 2. Student passes a genuine assessment on step 2
  const masteredRes = await advanceStudySessionStep(db, sessionId, 'student_mastery_sep_test', {
    targetStepIndex: 3,
    markCurrentStatus: 'MASTERED',
    coverageState: 'MASTERED'
  });

  assert.equal(masteredRes.currentStepIndex, 3);
  const step2Topic = await db.get(
    `SELECT * FROM study_partner_topic_progress WHERE session_id = ? AND step_index = 2`,
    sessionId
  );
  assert.equal(step2Topic.status, 'MASTERED', 'Verified answer must set status to MASTERED');
  assert.equal(step2Topic.coverage_state, 'MASTERED');
  assert.ok(step2Topic.mastered_at, 'mastered_at must be set');
  assert.equal(masteredRes.session.mastered_steps, 1, 'mastered_steps must increment to 1');
});

test('Phase 2: Natural Student Interruption & Seamless Session Continuation', async (t) => {
  const db = await createTestDb();
  const realAiAssistant = require('../ai-assistant');
  const aiChatService = require('../lib/ai-chat-service');

  await aiChatService.ensureSchema(db);
  const studentId = 'student_interruption_test';
  const convId = 'conv_interruption_test';

  // Seed conversation
  await aiChatService.createConversation(db, studentId, 'Java Chat', 'CIT122|s2|u2');
  await db.run(`UPDATE ai_conversations SET id = ? WHERE student_id = ?`, convId, studentId);

  // 1. Student starts lesson
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
        reply: 'Welcome to Java! ```study_session {"course":"Java","unit":"Unit 2","currentStep":1,"totalSteps":5,"prompt":"Step 1"}``` Here is step 1.'
      })
    }
  );

  assert.equal(turn1.intent, 'study_partner');

  // Verify active session was created
  const sess = await db.get(
    `SELECT * FROM study_partner_sessions WHERE conversation_id = ? AND status = 'ACTIVE'`,
    convId
  );
  assert.ok(sess, 'Active study session must exist');
  assert.equal(sess.current_step_index, 1);

  // Save turn 1 assistant message to DB
  await aiChatService.saveAssistantMessage(db, studentId, convId, turn1.reply, turn1.metadata || {
    studySessionId: sess.id,
    currentStepIndex: 1,
    studySession: { step: 1 }
  });

  // 2. Student interrupts with a clarifying question: "What is bytecode?"
  const turn2 = await realAiAssistant.handleChat(
    db,
    'What is bytecode and why does Java use it?',
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
        reply: 'Bytecode is an intermediate representation executed by the JVM.'
      })
    }
  );

  // Assert that clarifying turn answered without destroying the session
  assert.equal(turn2.intent, 'chapter_tutor');
  assert.ok(turn2.metadata?.inStudySession, 'Metadata must indicate student is in an ongoing study session');
  assert.ok(turn2.metadata?.wasClarifyingInterruption, 'Must record clarifying interruption');

  // Save turn 2 assistant message to DB with metadata
  await aiChatService.saveAssistantMessage(db, studentId, convId, turn2.reply, turn2.metadata);

  // 3. Student says "Got it, next"
  // Even though previous turn was chapter_tutor Q&A, lastWasLesson detects inStudySession interruption!
  const turn3 = await realAiAssistant.handleChat(
    db,
    'got it, next',
    { studentId, authenticated: true, currentSemester: 2 },
    [{ role: 'assistant', content: turn2.reply, metadata: turn2.metadata }],
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
        reply: 'Here is Step 2: Java Platform Independence. ```study_session {"currentStep":2}```'
      })
    }
  );

  // Assert session successfully advanced to Step 2!
  assert.equal(turn3.intent, 'study_partner', 'Must resume study partner loop after interruption');
  const sessAfterAdvance = await db.get(
    `SELECT current_step_index FROM study_partner_sessions WHERE id = ?`,
    sess.id
  );
  assert.equal(sessAfterAdvance.current_step_index, 2, 'Session must advance from step 1 to 2 seamlessly');
});
