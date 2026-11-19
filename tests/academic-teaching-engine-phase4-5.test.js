'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  DISCIPLINES,
  detectAcademicDiscipline,
  evaluateAcademicAnswer
} = require('../lib/academic-teaching-engine');

const {
  buildLearningModeDirective,
  answerWithChapterContext
} = require('../lib/chapter-tutor-engine');

const {
  ensureRagSchema
} = require('../lib/rag-schema');

const {
  ensureSchema: ensureChatSchema,
  getChapterConversations
} = require('../lib/ai-chat-service');

const {
  formatRow,
  formatRows
} = require('../db');

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
  await ensureChatSchema(db);
  return db;
}

test('Phase 4: Learning Mode Directives and Delegation across all 7 Modes', async (t) => {
  await t.test('1. buildLearningModeDirective returns distinct, tailored instructions for each mode', () => {
    const solveDirective = buildLearningModeDirective('solve');
    assert.match(solveDirective, /SOLVE WITH ME/i);
    assert.match(solveDirective, /Do NOT reveal the final answer/i);
    assert.match(solveDirective, /Socratic/i);

    const practiceDirective = buildLearningModeDirective('practice');
    assert.match(practiceDirective, /PRACTICE ME/i);
    assert.match(practiceDirective, /focused practice exercises/i);
    assert.match(practiceDirective, /MCQ/i);

    const reviseDirective = buildLearningModeDirective('revise');
    assert.match(reviseDirective, /REVISE/i);
    assert.match(reviseDirective, /High-yield/i);
    assert.match(reviseDirective, /core concepts|formulas/i);

    const testDirective = buildLearningModeDirective('test');
    assert.match(testDirective, /TEST MY UNDERSTANDING/i);
    assert.match(testDirective, /assessment/i);
    assert.match(testDirective, /3-question/i);

    const explainDirective = buildLearningModeDirective('explain');
    assert.match(explainDirective, /EXPLAIN THIS/i);
    assert.match(explainDirective, /Analogy|Formal/i);

    const teachDirective = buildLearningModeDirective('teach');
    assert.match(teachDirective, /TEACH ME/i);

    const askDirective = buildLearningModeDirective('ask');
    assert.match(askDirective, /ASK ANYTHING/i);
  });

  await t.test('2. answerWithChapterContext delegates to Study Partner when learningMode is "teach"', async () => {
    const db = await createTestDb();
    try {
      const result = await answerWithChapterContext(db, {
        message: 'Hello, teach me',
        chapterContext: {
          subject: 'Discrete Mathematics',
          subjectCode: 'CIT121',
          semesterNo: 1,
          unitNumber: 1,
          chapterTitle: 'Propositional Logic',
          learningMode: 'teach'
        }
      });
      assert.strictEqual(result.delegateToStudyPartner, true);
    } finally {
      db.close();
    }
  });

  await t.test('3. answerWithChapterContext applies solve mode Socratic prompt when learningMode is "solve"', async () => {
    const db = await createTestDb();
    try {
      let capturedSystemPrompt = '';
      const fakeGenerateFn = async ({ systemPrompt }) => {
        capturedSystemPrompt = systemPrompt;
        return 'What do you think is the first step in applying De Morgan’s Laws?';
      };

      const result = await answerWithChapterContext(db, {
        message: 'How do I prove ¬(p ∧ q) ≡ ¬p ∨ ¬q?',
        chapterContext: {
          subject: 'Discrete Mathematics',
          subjectCode: 'CIT121',
          semesterNo: 1,
          unitNumber: 1,
          chapterTitle: 'Propositional Logic',
          learningMode: 'solve'
        },
        generateReplyFn: fakeGenerateFn
      });

      assert.strictEqual(result.delegateToStudyPartner, false);
      assert.match(capturedSystemPrompt, /SOLVE WITH ME/i);
      assert.match(capturedSystemPrompt, /Do NOT reveal the final answer/i);
    } finally {
      db.close();
    }
  });
});

test('Phase 5: KaTeX LaTeX Precision, Shielding, Duplicate Symbol Prevention & Table Rendering', async (t) => {
  const libraryHtmlPath = path.join(__dirname, '..', 'public', 'library.html');
  const libraryHtml = fs.readFileSync(libraryHtmlPath, 'utf8');

  const cssPath = path.join(__dirname, '..', 'public', 'style.v4.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  await t.test('1. Duplicate KaTeX symbols prevention rule exists in both library.html and style.v4.css', () => {
    assert.match(libraryHtml, /\.katex-mathml\s*\{[^}]*display:\s*none\s*!important/i);
    assert.match(cssContent, /\.katex-mathml\s*\{[^}]*display:\s*none\s*!important/i);
  });

  await t.test('2. fallbackRenderChapterMarkdown shields LaTeX math containing < and > from HTML entity corruption', () => {
    const fnMatch = libraryHtml.match(/function fallbackRenderChapterMarkdown\(text\)\s*\{[\s\S]*?\n\s*return finalHtml;\s*\n\s*\}/);
    assert.ok(fnMatch, 'fallbackRenderChapterMarkdown must be present in library.html');

    const sandbox = {
      escapeHtml: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      fallbackRenderChapterMarkdown: null
    };
    vm.runInNewContext(fnMatch[0], sandbox);
    const renderer = sandbox.fallbackRenderChapterMarkdown;
    assert.strictEqual(typeof renderer, 'function');

    // Test math containing < and >
    const mathInput = 'Let $a < b$ and $x > y$. Also consider formula: $$P \\to (Q < R)$$';
    const output = renderer(mathInput);

    // Assert that the raw math blocks were NOT converted to &lt; or &gt;
    assert.ok(output.includes('$a < b$'), `Expected raw math $a < b$ to be preserved, got: ${output}`);
    assert.ok(output.includes('$x > y$'), `Expected raw math $x > y$ to be preserved, got: ${output}`);
    assert.ok(output.includes('$$P \\to (Q < R)$$'), `Expected display math $$P \\to (Q < R)$$ to be preserved, got: ${output}`);
  });

  await t.test('3. fallbackRenderChapterMarkdown renders markdown tables with .md-table and th/td headers', () => {
    const fnMatch = libraryHtml.match(/function fallbackRenderChapterMarkdown\(text\)\s*\{[\s\S]*?\n\s*return finalHtml;\s*\n\s*\}/);
    const sandbox = {
      escapeHtml: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      fallbackRenderChapterMarkdown: null
    };
    vm.runInNewContext(fnMatch[0], sandbox);
    const renderer = sandbox.fallbackRenderChapterMarkdown;

    const tableMarkdown = `
Here is the logic truth table:

| P | Q | P ∧ Q |
|---|---|---|
| T | T | T |
| T | F | F |
| F | T | F |
| F | F | F |
`;
    const output = renderer(tableMarkdown);
    assert.ok(output.includes('<table class="md-table">'), 'Output should contain <table class="md-table">');
    assert.ok(output.includes('<th>P</th>'), 'Output should contain header <th>P</th>');
    assert.ok(output.includes('<td>T</td>'), 'Output should contain data cell <td>T</td>');
  });

  await t.test('4. fallbackRenderChapterMarkdown formats fenced code blocks with .md-code-block', () => {
    const fnMatch = libraryHtml.match(/function fallbackRenderChapterMarkdown\(text\)\s*\{[\s\S]*?\n\s*return finalHtml;\s*\n\s*\}/);
    const sandbox = {
      escapeHtml: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      fallbackRenderChapterMarkdown: null
    };
    vm.runInNewContext(fnMatch[0], sandbox);
    const renderer = sandbox.fallbackRenderChapterMarkdown;

    const codeMarkdown = '```java\npublic class Solution {\n  public static void main(String[] args) {\n    System.out.println("Hello");\n  }\n}\n```';
    const output = renderer(codeMarkdown);
    assert.ok(output.includes('<pre class="md-code-block"><code class="language-java">'), `Expected formatted code block, got: ${output}`);
    assert.ok(output.includes('System.out.println(&quot;Hello&quot;);') || output.includes('System.out.println("Hello");'));
  });

  await t.test('5. renderMathInChapterBubble prevents redundant re-renders via data-math-rendered flag', () => {
    assert.match(libraryHtml, /function renderMathInChapterBubble\(el\)\s*\{[^}]*dataset\.mathRendered === '1'/);
    assert.match(libraryHtml, /ignoredClasses:\s*\['katex',\s*'katex-html',\s*'katex-mathml',\s*'md-code-block'\]/);
  });
});

test('Phase 6: Mastery Tracking, Progress Separation & Multi-Discipline Verification', async (t) => {
  const libraryHtmlPath = path.join(__dirname, '..', 'public', 'library.html');
  const libraryHtml = fs.readFileSync(libraryHtmlPath, 'utf8');

  await t.test('1. library.html contains all 7 quick bar chips and mode switcher logic', () => {
    assert.match(libraryHtml, /id="chipModeAsk"[^>]*setChapterKyanaMode\('ask'/);
    assert.match(libraryHtml, /id="chipModeTeach"[^>]*setChapterKyanaMode\('teach'/);
    assert.match(libraryHtml, /id="chipModeExplain"[^>]*setChapterKyanaMode\('explain'/);
    assert.match(libraryHtml, /id="chipModeSolve"[^>]*setChapterKyanaMode\('solve'/);
    assert.match(libraryHtml, /id="chipModePractice"[^>]*setChapterKyanaMode\('practice'/);
    assert.match(libraryHtml, /id="chipModeRevise"[^>]*setChapterKyanaMode\('revise'/);
    assert.match(libraryHtml, /id="chipModeTest"[^>]*setChapterKyanaMode\('test'/);
    assert.match(libraryHtml, /window\.setChapterKyanaMode\s*=\s*function/);
  });

  await t.test('2. getChapterConversations returns step, totalSteps, and masteredSteps', async () => {
    const db = await createTestDb();
    try {
      const studentId = 'student_test_101';
      const convId = 'conv_chap_001';
      const scopeKey = 'CIT121|s1|u1';

      await db.run(
        `INSERT INTO ai_conversations (id, student_id, title, scope_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        convId, studentId, 'Logic Chat', scopeKey
      );

      await db.run(
        `INSERT INTO study_partner_sessions
         (id, student_id, conversation_id, subject, subject_code, semester_no, unit_number, chapter_title, current_step_index, total_steps, mastered_steps, status, last_interaction_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`,
        'sess_001', studentId, convId, 'Discrete Mathematics', 'CIT121', 1, 1, 'Propositional Logic', 2, 5, 1, 'IN_PROGRESS'
      );

      const convs = await getChapterConversations(db, studentId, { subjectCode: 'CIT121', semesterNo: 1, unit: 1 });
      assert.strictEqual(convs.length, 1);
      assert.strictEqual(convs[0].id, convId);
      assert.strictEqual(convs[0].session.currentStepIndex, 2);
      assert.strictEqual(convs[0].session.totalSteps, 5);
      assert.strictEqual(convs[0].session.masteredSteps, 1);
      assert.strictEqual(convs[0].session.current_step_index, 2);
      assert.strictEqual(convs[0].session.total_steps, 5);
      assert.strictEqual(convs[0].session.mastered_steps, 1);
    } finally {
      db.close();
    }
  });

  await t.test('3. UI Context pill updates with Step X of Y · Z Mastered format', () => {
    assert.match(libraryHtml, /Step \$\{current\} of \$\{total\} · \$\{mastered\} Mastered/);
  });

  await t.test('4. Comprehensive Multi-Subject Catalog Verification across 6 University Disciplines', () => {
    // Subject 1: CIT121 Discrete Mathematics (Logic & Sets)
    const discMath = detectAcademicDiscipline('Discrete Mathematics', 'CIT121', 'Propositional Logic');
    assert.strictEqual(discMath, DISCIPLINES.MATHEMATICS);
    const mathEval = evaluateAcademicAnswer({
      question: 'Under what condition is the implication P → Q false?',
      expectedConcept: 'Implication truth table condition',
      studentAnswer: 'P is True and Q is False',
      discipline: discMath
    });
    assert.strictEqual(mathEval.passed, true);
    assert.strictEqual(mathEval.score, 1.0);

    // Subject 2: CIT122 Object-Oriented Programming (Java)
    const discJava = detectAcademicDiscipline('Object-Oriented Programming Java', 'CIT122', 'Unit 2');
    assert.strictEqual(discJava, DISCIPLINES.PROGRAMMING);
    const javaEval = evaluateAcademicAnswer({
      question: 'What executes Java bytecode platform-independently?',
      expectedConcept: 'JVM Java Virtual Machine',
      studentAnswer: 'JVM',
      discipline: discJava
    });
    assert.strictEqual(javaEval.passed, true);
    assert.strictEqual(javaEval.score, 1.0);

    // Subject 3: CIT214 Data Structures & Algorithms
    const discDsa = detectAcademicDiscipline('Data Structures and Algorithms', 'CIT214', 'Linked Lists and Queues');
    assert.strictEqual(discDsa, DISCIPLINES.PROGRAMMING);
    const dsaEval = evaluateAcademicAnswer({
      question: 'What is the time complexity to insert at the beginning of a singly linked list with a head pointer?',
      expectedConcept: 'O(1) constant time insertion',
      studentAnswer: 'O(1)',
      discipline: discDsa
    });
    assert.strictEqual(dsaEval.passed, true);
    assert.strictEqual(dsaEval.score, 1.0);

    // Subject 4: CIT212 Database Management Systems
    const discDb = detectAcademicDiscipline('Database Management Systems', 'CIT212', 'Relational SQL');
    assert.strictEqual(discDb, DISCIPLINES.DATABASE);
    const dbEval = evaluateAcademicAnswer({
      question: 'Write a SQL query to select all students with grade A from students table',
      expectedConcept: 'SELECT query with WHERE clause',
      studentAnswer: "SELECT * FROM students WHERE grade = 'A';",
      discipline: discDb
    });
    assert.strictEqual(dbEval.passed, true);
    assert.strictEqual(dbEval.score, 1.0);

    // Subject 5: CIT221 Computer Networks
    const discNet = detectAcademicDiscipline('Computer Networks', 'CIT221', 'OSI Transport Layer');
    assert.strictEqual(discNet, DISCIPLINES.NETWORKING);
    const netEval = evaluateAcademicAnswer({
      question: 'Which OSI layer handles end-to-end communication, segmentation, and reliability?',
      expectedConcept: 'Transport Layer Layer 4',
      studentAnswer: 'Transport layer',
      discipline: discNet
    });
    assert.strictEqual(netEval.passed, true);
    assert.strictEqual(netEval.score, 1.0);

    // Subject 6: ELX111 Basic Electrical & Electronics Engineering
    const discElec = detectAcademicDiscipline('Basic Electrical and Electronics Engineering', 'ELX111', 'Circuit Theory');
    assert.strictEqual(discElec, DISCIPLINES.PHYSICS);
    const elecEval = evaluateAcademicAnswer({
      question: "State Ohm's Law formula relating voltage, current, and resistance",
      expectedConcept: 'V = I * R',
      studentAnswer: 'V = IR',
      discipline: discElec
    });
    assert.strictEqual(elecEval.passed, true);
    assert.strictEqual(elecEval.score, 1.0);
  });
});
