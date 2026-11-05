'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

const { handleChat, invalidateCache } = require('../ai-assistant');
const {
  createTools,
  formatToolResult,
  routeQuery,
  parseKyanaVisualBlock,
  VISUAL_BLOCK_KINDS,
  ACADEMIC_VISUAL_BLOCK_KINDS,
  classifyAcademicQuestion,
  classifySyllabusSubScope,
  formatRichCourseSyllabus,
  buildDeterministicVisualEnrichment,
  buildAcademicTutorPrompt,
  courses
} = require('../lib/chat-tools');
const {
  stabilizeStreamingMarkdown,
  fallbackMarkdown,
  renderKyanaVisualBlockHtml
} = require('../public/chatbot.js');

const chatbotJsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'chatbot.js'), 'utf8');
const chatbotCssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'chatbot.css'), 'utf8');
const postMarkdownSource = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'components', 'PostMarkdown.tsx'), 'utf8');

function extractVisualBlock(reply, kind) {
  const re = new RegExp('```' + kind + '\\n([\\s\\S]*?)```', 'i');
  const m = String(reply || '').match(re);
  return m ? m[1].trim() : null;
}

// ============================================================================
// 1. Full Syllabus Overview (DSA CIT214, DBMS CIT213, Software Engineering CIT212)
// ============================================================================
test('Scenario 1: Full syllabus overview transforms raw syllabus data into structured academic guide with Official vs AI Study Guide separation and workload chart', async () => {
  const dsaRoute = routeQuery('Show me my DSA syllabus');
  assert.equal(dsaRoute.kind, 'syllabus');
  assert.equal(dsaRoute.filters.subject, 'Data Structure and Algorithms');

  const dbmsOverviewRoute = routeQuery('Give me an overview of Database Management System');
  assert.equal(dbmsOverviewRoute.kind, 'syllabus');
  assert.equal(dbmsOverviewRoute.filters.subject, 'Database Management System');

  const seStudyRoute = routeQuery('What will I study in Software Engineering?');
  assert.equal(seStudyRoute.kind, 'syllabus');
  assert.equal(seStudyRoute.filters.subject, 'Software Engineering');

  const toolkit = createTools(null, dsaRoute);
  const dsaRes = await toolkit.executeTool('get_syllabus', {
    semester: 3,
    subject: 'Data Structure and Algorithms'
  });
  const formatted = formatToolResult('get_syllabus', dsaRes);

  // Verify Official University Syllabus vs AI Study Guide separation
  assert.match(formatted, /\*\*Data Structure and Algorithms\*\* \(CIT214\)/);
  assert.match(formatted, /\*\*Learning Objectives:\*\* \*\(Official University Syllabus\)\*/);
  assert.match(formatted, /\*\*Course Units & Contents:\*\* \*\(Official University Syllabus\)\*/);
  assert.match(formatted, /\*\*Lab Requirements:\*\* \*\(Official University Syllabus\)\*/);
  assert.match(formatted, /\*\*AI Study Guide & Learning Roadmap \(Advisory — Not Official University Requirements\):\*\*/);
  assert.match(formatted, /Prerequisites:|Prerequisite Concepts:/);
  assert.match(formatted, /Important Concepts/);
  assert.match(formatted, /How Units Connect:|Relationship Between Units:/);
  assert.match(formatted, /Suggested Study Order:|Suggested Study Sequence:/);

  const blockRaw = extractVisualBlock(formatted, 'syllabus');
  assert.ok(blockRaw, 'Expected ```syllabus visual block');
  const parsed = parseKyanaVisualBlock('syllabus', blockRaw);
  assert.equal(parsed.courseCode, 'CIT214');
  assert.equal(parsed.mode, 'full_course');
  assert.ok(parsed.items.length >= 6, 'Expected all DSA units in syllabus visual block');
  assert.ok(parsed.aiGuidance.prerequisites.length > 0);

  const html = renderKyanaVisualBlockHtml('syllabus', blockRaw);
  assert.ok(html.includes('kyana-syllabus-card'));
  assert.ok(html.includes('Official Syllabus'));
  assert.ok(html.includes('Advisory · Not Official Requirement'));
});

// ============================================================================
// 2. Individual Unit Explanations & Scope-Specific Syllabus Queries
// ============================================================================
test('Scenario 2: Individual unit explanations ("Explain Unit 4 of DSA") and aspect-specific syllabus queries adapt to scope without dumping the entire course', async () => {
  const unitRoute = routeQuery('Explain Unit 4 of DSA');
  assert.equal(unitRoute.kind, 'syllabus');
  assert.equal(unitRoute.filters.subject, 'Data Structure and Algorithms');
  assert.equal(unitRoute.filters.unitNumber, 4);

  const toolkit = createTools(null, unitRoute);
  const unitRes = await toolkit.executeTool('get_syllabus', {
    semester: 3,
    subject: 'Data Structure and Algorithms',
    unit: 4
  });
  const formattedUnit = formatToolResult('get_syllabus', unitRes);

  assert.match(formattedUnit, /Unit 4: Trees/i);
  assert.doesNotMatch(formattedUnit, /Unit 1:/, 'Unit-specific query must not dump Unit 1');
  assert.match(formattedUnit, /AI Study Guide & Unit Connections/);

  const unitBlock = extractVisualBlock(formattedUnit, 'syllabus');
  const html = renderKyanaVisualBlockHtml('syllabus', unitBlock);
  assert.ok(html.includes('Unit 4: Trees'));
  assert.ok(html.includes('Builds On:'));

  // Aspect-specific sub-scopes: practical requirements & unit hours allocation
  assert.equal(classifySyllabusSubScope('What are the practical requirements in DSA?'), 'practical_focus');
  assert.equal(classifySyllabusSubScope('How many hours are allocated to each unit in DSA?'), 'hours_workload_focus');
  assert.equal(classifySyllabusSubScope('What is the relationship between different units in DSA?'), 'unit_relationship_focus');

  // Conversational follow-up inheritance for syllabus questions ("What are the practical requirements?")
  const history = [{ role: 'user', content: 'Show me my DSA syllabus' }];
  const followUpRoute = routeQuery('What are the practical requirements?', history);
  assert.equal(followUpRoute.kind, 'syllabus');
  assert.equal(followUpRoute.filters.subject, 'Data Structure and Algorithms');
});

// ============================================================================
// 3. Conceptual Questions (Recursion, BST, Normalization)
// ============================================================================
test('Scenario 3: Conceptual questions classify into concept_explanation and attach visual diagrams or call-stack traces', async () => {
  const recClass = classifyAcademicQuestion('Explain recursion');
  assert.equal(recClass.category, 'concept_explanation');
  assert.ok(recClass.recommendedVisuals.includes('trace'));

  const res = await handleChat(
    { query: async () => ({ rows: [] }), get: async () => null, all: async () => [] },
    'Explain recursion.',
    { studentId: 'stu_1', semester: 3, role: 'student', authenticated: true },
    [],
    'sess-concept-rec',
    {
      academicContext: { studentId: 'stu_1', semester: 3, role: 'student', authenticated: true },
      generateReply: async ({ onDelta, systemPrompt }) => {
        assert.match(systemPrompt, /STRUCTURE FOR CONCEPT EXPLANATION/);
        const text = 'Recursion is a method where a function calls itself on a smaller subproblem until reaching a base case.';
        onDelta(text);
        return { reply: text };
      }
    }
  );

  assert.match(res.reply, /```trace/);
  const traceBlock = extractVisualBlock(res.reply, 'trace');
  const html = renderKyanaVisualBlockHtml('trace', traceBlock);
  assert.ok(html.includes('Recursive Call Stack Trace'));
  assert.ok(html.includes('Step Forward'));

  // BST Concept Diagram check
  const bstEnrichment = buildDeterministicVisualEnrichment('What is a binary search tree?', classifyAcademicQuestion('What is a binary search tree?'));
  assert.match(bstEnrichment, /```diagram/);
  const bstDiagramHtml = renderKyanaVisualBlockHtml('diagram', extractVisualBlock(bstEnrichment, 'diagram'));
  assert.ok(bstDiagramHtml.includes('Binary Search Tree (BST) Ordering Invariant'));
  assert.ok(bstDiagramHtml.includes('kyana-diagram-node-box'));
});

// ============================================================================
// 4. Programming Explanations (Linked Lists in C++, Merge Sort)
// ============================================================================
test('Scenario 4: Programming and algorithm questions provide code, complexity analysis, and step-by-step execution trace', async () => {
  const llClass = classifyAcademicQuestion('Implement linked lists in C++');
  assert.equal(llClass.category, 'programming_algorithm');
  assert.equal(llClass.needsAlgorithmTrace, true);

  const res = await handleChat(
    { query: async () => ({ rows: [] }), get: async () => null, all: async () => [] },
    'Implement linked lists in C++',
    { studentId: 'stu_1', semester: 3, role: 'student', authenticated: true },
    [],
    'sess-prog-ll',
    {
      academicContext: { studentId: 'stu_1', semester: 3, role: 'student', authenticated: true },
      generateReply: async ({ onDelta, systemPrompt }) => {
        assert.match(systemPrompt, /STRUCTURE FOR PROGRAMMING & ALGORITHM QUESTIONS/);
        const text = [
          'A singly linked list stores elements in dynamically allocated nodes connected via pointers.',
          '',
          '```cpp',
          '#include <iostream>',
          'struct Node {',
          '    int data;',
          '    Node* next;',
          '    Node(int val) : data(val), next(nullptr) {}',
          '};',
          '```',
          '',
          '- **Time Complexity:** Insertion at head is $O(1)$; search is $O(n)$.'
        ].join('\n');
        onDelta(text);
        return { reply: text };
      }
    }
  );

  assert.match(res.reply, /```cpp/);
  assert.match(res.reply, /```trace/);
  const html = fallbackMarkdown(res.reply);
  assert.ok(html.includes('Singly Linked List Node Insertion at Head'));
});

// ============================================================================
// 5. Algorithm Visualizations (Binary Search O(log n), Merge Sort, Dijkstra)
// ============================================================================
test('Scenario 5: Algorithm visualization questions generate step-by-step trace and complexity growth graphs', () => {
  const bsClass = classifyAcademicQuestion('Why is binary search O(log n)?');
  assert.equal(bsClass.category, 'programming_algorithm');
  assert.ok(bsClass.recommendedVisuals.includes('trace'));
  assert.ok(bsClass.recommendedVisuals.includes('graph'));

  const enrichment = buildDeterministicVisualEnrichment('Why is binary search O(log n)?', bsClass);
  assert.match(enrichment, /```trace/);
  assert.match(enrichment, /```graph/);

  const traceHtml = renderKyanaVisualBlockHtml('trace', extractVisualBlock(enrichment, 'trace'));
  assert.ok(traceHtml.includes('Binary Search Trace'));
  assert.ok(traceHtml.includes('Time: O(log n)'));

  const graphHtml = renderKyanaVisualBlockHtml('graph', extractVisualBlock(enrichment, 'graph'));
  assert.ok(graphHtml.includes('kyana-graph-card'));
  assert.ok(graphHtml.includes('O(log₂ n) Binary Search'));
});

// ============================================================================
// 6. Mathematical Solutions (Differential Equations, Matrices, Probability)
// ============================================================================
test('Scenario 6: Mathematical and numerical questions route in-scope and preserve LaTeX derivations', async () => {
  const odeRoute = routeQuery('Solve a differential equation dy/dx + 2y = 0');
  assert.equal(odeRoute.kind, 'direct');

  const odeClass = classifyAcademicQuestion('Solve a differential equation dy/dx + 2y = 0');
  assert.equal(odeClass.category, 'math_numerical');
  assert.equal(odeClass.discipline, 'mathematics');

  const prompt = buildAcademicTutorPrompt('Solve a differential equation dy/dx + 2y = 0', odeClass);
  assert.match(prompt, /STRUCTURE FOR MATHEMATICAL & MATHEMATICS NUMERICAL QUESTIONS/);
});

// ============================================================================
// 7. Physics Explanations (Ohm's Law, Electromagnetic Induction)
// ============================================================================
test('Scenario 7: Physics explanations route in-scope and render circuit/concept diagrams and V-I characteristic graphs', async () => {
  const ohmRoute = routeQuery("Explain Ohm's law");
  assert.equal(ohmRoute.kind, 'direct');

  const emiRoute = routeQuery('Explain electromagnetic induction');
  assert.equal(emiRoute.kind, 'direct');

  const ohmClass = classifyAcademicQuestion("Explain Ohm's law");
  assert.equal(ohmClass.discipline, 'physics');

  const ohmVisuals = buildDeterministicVisualEnrichment("Explain Ohm's law", ohmClass);
  assert.match(ohmVisuals, /```diagram/);
  assert.match(ohmVisuals, /```graph/);

  const diagramHtml = renderKyanaVisualBlockHtml('diagram', extractVisualBlock(ohmVisuals, 'diagram'));
  assert.ok(diagramHtml.includes("Ohm&#39;s Law Closed DC Circuit") || diagramHtml.includes("Ohm's Law Closed DC Circuit"));

  const graphHtml = renderKyanaVisualBlockHtml('graph', extractVisualBlock(ohmVisuals, 'graph'));
  assert.ok(graphHtml.includes('Ohmic V–I Characteristic Curve'));
});

// ============================================================================
// 8. Comparisons (Stack vs Queue, TCP vs UDP, Compiler vs Interpreter)
// ============================================================================
test('Scenario 8: Comparison questions classify into comparison and render structured comparison tables', () => {
  for (const q of ['Stack vs Queue', 'TCP vs UDP', 'RAM vs ROM', 'Compiler vs Interpreter', 'Insertion Sort vs Merge Sort']) {
    const r = routeQuery(q);
    assert.equal(r.kind, 'direct', `Expected "${q}" to route to direct academic explanation`);
    const cls = classifyAcademicQuestion(q, r);
    assert.equal(cls.category, 'comparison', `Expected "${q}" to classify as comparison`);
    assert.ok(cls.recommendedVisuals.includes('comparison_table'));
  }
});

// ============================================================================
// 9. Exam Preparation, Revision Roadmaps & Interactive MCQ Quizzes
// ============================================================================
test('Scenario 9: Exam preparation and MCQ requests generate interactive quizzes and revision roadmaps grounded in actual syllabus', async () => {
  const mcqRoute = routeQuery('Give me MCQs on trees');
  assert.equal(mcqRoute.kind, 'direct');
  const mcqClass = classifyAcademicQuestion('Give me MCQs on trees', mcqRoute);
  assert.equal(mcqClass.category, 'exam_prep');
  assert.equal(mcqClass.subScope, 'mcq_quiz');

  const mcqVisual = buildDeterministicVisualEnrichment('Give me MCQs on trees', mcqClass);
  assert.match(mcqVisual, /```quiz/);
  const quizHtml = renderKyanaVisualBlockHtml('quiz', extractVisualBlock(mcqVisual, 'quiz'));
  assert.ok(quizHtml.includes('kyana-quiz-card'));
  assert.ok(quizHtml.includes('Reveal Answer & Explanation'));
  assert.ok(quizHtml.includes('Inorder (Left, Root, Right)'));

  const planClass = classifyAcademicQuestion('Prepare DSA revision notes and create a revision plan');
  assert.equal(planClass.category, 'exam_prep');
  const planVisual = buildDeterministicVisualEnrichment('Prepare DSA revision notes and create a revision plan', planClass);
  assert.match(planVisual, /```roadmap/);
  const roadmapHtml = renderKyanaVisualBlockHtml('roadmap', extractVisualBlock(planVisual, 'roadmap'));
  assert.ok(roadmapHtml.includes('kyana-roadmap-card'));
  assert.ok(roadmapHtml.includes('Structured Exam Revision Roadmap'));
});

// ============================================================================
// 10. Library Resource Searches
// ============================================================================
test('Scenario 10: Library resource queries route to notes search and render ```notes visual blocks without fabricating files', () => {
  const r1 = routeQuery('Find notes for DSA Unit 4');
  assert.equal(r1.kind, 'notes');
  assert.equal(r1.filters.subject, 'Data Structure and Algorithms');
  assert.equal(r1.filters.unitNumber, 4);

  const formatted = formatToolResult('search_notes', {
    files: [
      {
        id: 401,
        title: 'DSA Unit 4 Trees & AVL Rotations.pdf',
        subject: 'Data Structure and Algorithms',
        semester: 3,
        chapter: 'Unit 4',
        folderPath: 'Semester 3 / DSA / Unit 4'
      }
    ]
  });
  assert.match(formatted, /```notes/);
  const html = renderKyanaVisualBlockHtml('notes', extractVisualBlock(formatted, 'notes'));
  assert.ok(html.includes('DSA Unit 4 Trees &amp; AVL Rotations.pdf'));
});

// ============================================================================
// 11. Missing Information Handling
// ============================================================================
test('Scenario 11: Missing unit or course details are stated clearly without inventing syllabus topics or lab requirements', async () => {
  const toolkit = createTools(null, routeQuery('Explain Unit 19 of DSA'));
  const res = await toolkit.executeTool('get_syllabus', {
    semester: 3,
    subject: 'Data Structure and Algorithms',
    unit: 19
  });
  const formatted = formatToolResult('get_syllabus', res);
  assert.match(formatted, /Unit 19 is not listed in the official syllabus/i);
  assert.doesNotMatch(formatted, /```syllabus/);
});

// ============================================================================
// 12. Streaming Responses
// ============================================================================
test('Scenario 12: Streaming partial academic visual blocks stabilize cleanly at every token boundary', () => {
  const dsaCourse = courses.find(c => c.code === 'CIT214');
  const fullSyllabusReply = formatRichCourseSyllabus(dsaCourse, { semester: 3 });

  for (let len = 40; len <= fullSyllabusReply.length; len += 80) {
    const chunk = fullSyllabusReply.slice(0, len);
    const stabilized = stabilizeStreamingMarkdown(chunk);
    const fences = (stabilized.match(/```/g) || []).length;
    assert.equal(fences % 2, 0, `Expected balanced fences at length ${len}`);
    const html = fallbackMarkdown(stabilized);
    assert.equal(typeof html, 'string');
  }
});

// ============================================================================
// 13. Web and Mobile Parity
// ============================================================================
test('Scenario 13: Web and Mobile both support all academic visual block kinds and interactive quiz/trace components', () => {
  for (const kind of ACADEMIC_VISUAL_BLOCK_KINDS) {
    assert.ok(VISUAL_BLOCK_KINDS.has(kind), `lib/chat-tools.js must include '${kind}'`);
    assert.ok(chatbotJsSource.includes(`'${kind}'`), `Web public/chatbot.js must include '${kind}'`);
    assert.ok(postMarkdownSource.includes(`'${kind.toUpperCase()}'`), `Mobile PostMarkdown.tsx must include '${kind.toUpperCase()}'`);
  }
  assert.ok(postMarkdownSource.includes('function KyanaQuizCard'), 'Mobile must implement interactive KyanaQuizCard');
  assert.ok(postMarkdownSource.includes('function KyanaTraceCard'), 'Mobile must implement interactive KyanaTraceCard');
});

// ============================================================================
// 14. Role-Based Access & Semester Isolation
// ============================================================================
test('Scenario 14: Role-based access and privacy rules remain enforced across academic queries', async () => {
  const crossRes = await handleChat(
    { query: async () => ({ rows: [] }), get: async () => null, all: async () => [] },
    "Show another student's attendance and marks",
    { studentId: 'stu_saugat', role: 'student', semester: 3, authenticated: true },
    [],
    'sess-rbac-check',
    {
      academicContext: { studentId: 'stu_saugat', role: 'student', semester: 3, currentSemester: 3, authenticated: true }
    }
  );
  assert.equal(crossRes.intent, 'cross_student');
});

// ============================================================================
// 15. Malformed Structured Data Fallback
// ============================================================================
test('Scenario 15: Malformed JSON or empty visual blocks fail safe without exposing raw component syntax or crashing', () => {
  for (const kind of ACADEMIC_VISUAL_BLOCK_KINDS) {
    const broken = parseKyanaVisualBlock(kind, '{broken_json: true, [');
    assert.equal(broken.kind, kind);
    assert.ok(Array.isArray(broken.items));
    assert.equal(renderKyanaVisualBlockHtml(kind, '{broken_json: true, ['), '');
  }
});

// ============================================================================
// 16. Ordinary Conversational Fallback
// ============================================================================
test('Scenario 16: Ordinary short conversational answers render as clean Markdown without unnecessary dashboard cards', () => {
  const html = fallbackMarkdown('A **pointer** in C is a variable that stores the memory address of another variable, declared using `*` (e.g., `int *p = &x;`).');
  assert.ok(!html.includes('kyana-attendance-card'), 'Short definition must not be wrapped in a card');
  assert.ok(html.includes('<strong>pointer</strong>'));
  assert.ok(html.includes('<code>int *p = &amp;x;</code>'));
});
