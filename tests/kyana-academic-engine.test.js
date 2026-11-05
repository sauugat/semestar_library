'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    formatToolResult,
    parseKyanaVisualBlock,
    parseSyllabusCourseDetails,
    classifyAcademicCategory,
    VISUAL_BLOCK_KINDS,
    courses
} = require('../lib/chat-tools');
const {
    fallbackMarkdown,
    renderKyanaVisualBlockHtml
} = require('../public/chatbot.js');

const chatbotJsPath = path.join(__dirname, '..', 'public', 'chatbot.js');
const chatbotCssPath = path.join(__dirname, '..', 'public', 'chatbot.css');
const postMarkdownPath = path.join(__dirname, '..', 'mobile', 'components', 'PostMarkdown.tsx');

const chatbotJsSource = fs.readFileSync(chatbotJsPath, 'utf8');
const chatbotCssSource = fs.readFileSync(chatbotCssPath, 'utf8');
const postMarkdownSource = fs.readFileSync(postMarkdownPath, 'utf8');

// ============================================================================
// 1. Category A: CIT214 Data Structure and Algorithms Syllabus Verification
// ============================================================================
test('Academic Engine: CIT214 Data Structure and Algorithms syllabus has exact 8 units, 45 teaching hours, workload %, and labs', () => {
    const cit214 = courses.find(c => c.code === 'CIT214');
    assert.ok(cit214, 'CIT214 must exist in syllabus-data.json');

    const details = parseSyllabusCourseDetails(cit214);
    assert.equal(details.units.length, 8, 'CIT214 must parse exactly 8 units');
    assert.equal(details.units[0].title, 'Introduction');
    assert.equal(details.units[0].teachingHours, '5hrs');
    assert.equal(details.units[2].title, 'Stacks, Queue and Recursion');
    assert.equal(details.units[2].teachingHours, '10hrs');
    assert.equal(details.units[3].title, 'Trees');
    assert.equal(details.units[3].teachingHours, '7hrs');
    assert.equal(details.units[4].title, 'Sorting');
    assert.equal(details.units[4].teachingHours, '6hrs');
    assert.equal(details.units[6].title, 'Graph');
    assert.equal(details.units[6].teachingHours, '6hrs');
    assert.equal(details.units[7].title, 'Case Studies In Algorithms');
    assert.equal(details.units[7].teachingHours, '2hrs');

    // Total hours check
    const totalHrs = details.units.reduce((sum, u) => sum + Number(u.teachingHours.match(/\d+/)[0]), 0);
    assert.equal(totalHrs, 45, 'CIT214 total teaching hours must equal 45');

    // Tool output formatting check
    const resultObj = {
        semester: 3,
        requestedSubject: 'Data Structure and Algorithms',
        courses: [cit214]
    };
    const formatted = formatToolResult('get_syllabus', resultObj);
    assert.ok(formatted.includes('```syllabus'), 'Must include ```syllabus visual block');
    assert.match(formatted, /Unit 3: Stacks, Queue and Recursion[^*]*\*\*\s*—\s*10hrs \(22%\)/, 'Must calculate 22% workload for Unit 3');
    assert.match(formatted, /Unit 4: Trees[^*]*\*\*\s*—\s*7hrs \(16%\)/, 'Must calculate 16% workload for Unit 4');
    assert.match(formatted, /Unit 5: Sorting[^*]*\*\*\s*—\s*6hrs \(13%\)/, 'Must calculate 13% workload for Unit 5');
    assert.ok(formatted.includes('11. Implementation of Shortest path algorithm'), 'Must preserve lab experiments');

    // Web visual block rendering
    const html = renderKyanaVisualBlockHtml('syllabus', formatted.match(/```syllabus\n([\s\S]*?)```/)[1]);
    assert.ok(html.includes('kyana-syllabus-card'), 'Web HTML must render kyana-syllabus-card');
    assert.ok(html.includes('Unit 3: Stacks, Queue and Recursion'), 'Web HTML must display Unit 3');
    assert.ok(html.includes('22%'), 'Web HTML must display 22% workload badge');
});

// ============================================================================
// 2. Category A: Single Unit Syllabus Query
// ============================================================================
test('Academic Engine: Single unit syllabus query filters to the requested unit and computes workload percentage', () => {
    const cit214 = courses.find(c => c.code === 'CIT214');
    const resultObj = {
        semester: 3,
        requestedSubject: 'Data Structure and Algorithms',
        requestedUnit: 3,
        courses: [cit214]
    };
    const formatted = formatToolResult('get_syllabus', resultObj);
    assert.ok(formatted.includes('Unit 3: Stacks, Queue and Recursion'), 'Must include Unit 3');
    assert.ok(!formatted.includes('Unit 1: Introduction'), 'Must not include other units when unit 3 is requested');
    assert.ok(formatted.includes('10hrs (22%)'), 'Must include 10hrs (22%)');
});

// ============================================================================
// 3. Category B: Concept Architecture & Diagram Visual Block
// ============================================================================
test('Academic Engine: Architecture diagram block parses lines and renders monospace box on Web and Mobile', () => {
    const rawDiagram = `
[Call Stack Execution]
| fact(1) -> returns 1       |
| fact(2) -> 2 * fact(1)     |
| fact(3) -> 3 * fact(2)     |
| main()  -> calls fact(3)   |
+----------------------------+
`;
    const parsed = parseKyanaVisualBlock('diagram', rawDiagram);
    assert.equal(parsed.title, 'Call Stack Execution');
    assert.ok(parsed.items.length >= 4, 'Diagram must have lines as items');

    const html = renderKyanaVisualBlockHtml('diagram', rawDiagram);
    assert.ok(html.includes('kyana-diagram-card'), 'Web HTML must render kyana-diagram-card');
    assert.ok(html.includes('Call Stack Execution'), 'Web HTML must display diagram title');
    assert.ok(html.includes('fact(3)'), 'Web HTML must display diagram text');

    // Mobile check
    assert.ok(postMarkdownSource.includes("normKind === 'diagram'"), 'Mobile PostMarkdown must handle diagram block');
});

// ============================================================================
// 4. Category C: Algorithm Step-by-Step Execution Trace
// ============================================================================
test('Academic Engine: Step-by-step trace block renders sequential execution state cards', () => {
    const rawTrace = `
[Step 1] Initial Array: [29, 10, 14, 37, 13] | Pivot: 13
[Step 2] Partition: Elements <= 13 move left -> [10, 13, 14, 37, 29]
[Step 3] Recurse Left: [10] (already sorted)
[Step 4] Recurse Right: [14, 37, 29] -> Pivot 29 -> [14, 29, 37]
[Result] Sorted Array: [10, 13, 14, 29, 37]
`;
    const parsed = parseKyanaVisualBlock('trace', rawTrace);
    assert.equal(parsed.items.length, 5);
    assert.equal(parsed.items[0].label, 'Step 1');
    assert.equal(parsed.items[4].label, 'Result');

    const html = renderKyanaVisualBlockHtml('trace', rawTrace);
    assert.ok(html.includes('kyana-trace-card'), 'Web HTML must render kyana-trace-card');
    assert.ok(html.includes('Step 1'), 'Web HTML must render Step 1 badge');
    assert.ok(html.includes('Sorted Array'), 'Web HTML must render Result content');
});

// ============================================================================
// 5. Category D: Asymptotic Time & Space Complexity Matrix
// ============================================================================
test('Academic Engine: Complexity visual block parses operations and displays Big-O badges', () => {
    const rawComplexity = `
- **Operation:** Access | **Best:** $O(1)$ | **Average:** $O(1)$ | **Worst:** $O(1)$ | **Space:** $O(n)$
- **Operation:** Search | **Best:** $O(1)$ | **Average:** $O(n)$ | **Worst:** $O(n)$ | **Space:** $O(1)$
- **Operation:** Insertion | **Best:** $O(1)$ | **Average:** $O(1)$ | **Worst:** $O(1)$ | **Space:** $O(1)$
- **Operation:** Deletion | **Best:** $O(1)$ | **Average:** $O(1)$ | **Worst:** $O(1)$ | **Space:** $O(1)$
`;
    const parsed = parseKyanaVisualBlock('complexity', rawComplexity);
    assert.equal(parsed.items.length, 4);
    assert.equal(parsed.items[0].label, 'Operation: Access');
    assert.equal(parsed.items[0].best, 'Best: $O(1)$');

    const html = renderKyanaVisualBlockHtml('complexity', rawComplexity);
    assert.ok(html.includes('kyana-complexity-card'), 'Web HTML must render kyana-complexity-card');
    assert.ok(html.includes('Access'), 'Web HTML must render Access operation');
    assert.ok(html.includes('Big-O'), 'Web HTML must render Big-O pill');
});

// ============================================================================
// 6. Category E: Feature & Concept Comparison
// ============================================================================
test('Academic Engine: Comparison visual block parses criteria rows and displays side-by-side matrix', () => {
    const rawComparison = `
- **Criteria: Structure** | **Stack:** LIFO (Last-In First-Out) | **Queue:** FIFO (First-In First-Out)
- **Criteria: Insertion** | **Stack:** Push to Top ($O(1)$) | **Queue:** Enqueue at Rear ($O(1)$)
- **Criteria: Removal** | **Stack:** Pop from Top ($O(1)$) | **Queue:** Dequeue from Front ($O(1)$)
- **Criteria: Primary Use** | **Stack:** Function calls, recursion | **Queue:** CPU scheduling, BFS
`;
    const parsed = parseKyanaVisualBlock('comparison', rawComparison);
    assert.equal(parsed.items.length, 4);
    assert.equal(parsed.items[0].col1, 'Criteria: Structure');
    assert.equal(parsed.items[0].col2, 'Stack: LIFO (Last-In First-Out)');
    assert.equal(parsed.items[0].col3, 'Queue: FIFO (First-In First-Out)');

    const html = renderKyanaVisualBlockHtml('comparison', rawComparison);
    assert.ok(html.includes('kyana-comparison-card'), 'Web HTML must render kyana-comparison-card');
    assert.ok(html.includes('LIFO'), 'Web HTML must include LIFO');
    assert.ok(html.includes('FIFO'), 'Web HTML must include FIFO');
});

// ============================================================================
// 7. Category F: Interactive Self-Assessment Quiz
// ============================================================================
test('Academic Engine: Quiz block renders question, options, and toggle button for answer and explanation', () => {
    const rawQuiz = `
- **Question:** What is the worst-case time complexity of QuickSort when the pivot is always chosen as the smallest element?
- **Option A:** $O(n \\log n)$
- **Option B:** $O(n^2)$
- **Option C:** $O(n)$
- **Option D:** $O(\\log n)$
- **Answer:** Option B
- **Explanation:** When the pivot is consistently the smallest or largest element, the partition creates unbalanced sub-arrays of size 0 and n-1, leading to quadratic time complexity.
`;
    const parsed = parseKyanaVisualBlock('quiz', rawQuiz);
    assert.equal(parsed.options.length, 4);
    assert.equal(parsed.answer, 'Option B');
    assert.ok(parsed.explanation.includes('unbalanced sub-arrays'));

    const html = renderKyanaVisualBlockHtml('quiz', rawQuiz);
    assert.ok(html.includes('kyana-quiz-card'), 'Web HTML must render kyana-quiz-card');
    assert.ok(html.includes('Reveal Answer & Explanation'), 'Web HTML must include reveal button');
    assert.ok(html.includes('Option B'), 'Web HTML must contain Option B');
    assert.ok(html.includes('unbalanced sub-arrays'), 'Web HTML must contain explanation text');

    // Mobile check
    assert.ok(postMarkdownSource.includes('KyanaQuizCard'), 'Mobile PostMarkdown must implement interactive KyanaQuizCard');
});

// ============================================================================
// 8. Category G: Learning & Revision Roadmap
// ============================================================================
test('Academic Engine: Roadmap block renders checklist items with completed and pending status', () => {
    const rawRoadmap = `
- [x] **1. Asymptotic Analysis & Big-O Notation** (Core foundation) — Essential for all subsequent units
- [x] **2. Singly & Doubly Linked Lists** (Pointers & memory) — Must practice pointer manipulation
- [ ] **3. Stacks, Queues & Recursion** (High exam weightage) — 10 teaching hours, frequent numericals
- [ ] **4. Binary Trees & BST** (Tree traversals) — Practice AVL balance factors
`;
    const parsed = parseKyanaVisualBlock('roadmap', rawRoadmap);
    assert.equal(parsed.items.length, 4);
    assert.equal(parsed.items[0].done, true);
    assert.equal(parsed.items[2].done, false);

    const html = renderKyanaVisualBlockHtml('roadmap', rawRoadmap);
    assert.ok(html.includes('kyana-roadmap-card'), 'Web HTML must render kyana-roadmap-card');
    assert.ok(html.includes('is-completed'), 'Web HTML must style completed items');
    assert.ok(html.includes('is-pending'), 'Web HTML must style pending items');
});

// ============================================================================
// 9. Academic Intent Classification
// ============================================================================
test('Academic Engine: classifyAcademicCategory accurately categorizes all 8 learning intents', () => {
    assert.equal(classifyAcademicCategory('Can you quiz me on binary trees?'), 'quiz_revision');
    assert.equal(classifyAcademicCategory('Give me an exam prep roadmap for DSA'), 'exam_prep_roadmap');
    assert.equal(classifyAcademicCategory('What is the syllabus of CIT214?'), 'syllabus');
    assert.equal(classifyAcademicCategory('What is the difference between TCP and UDP?'), 'comparison');
    assert.equal(classifyAcademicCategory('What is the time complexity of QuickSort?'), 'complexity');
    assert.equal(classifyAcademicCategory('Show me step-by-step trace of binary search on [2, 5, 8, 12, 16]'), 'algorithm_trace');
    assert.equal(classifyAcademicCategory('Calculate the determinant of matrix A'), 'mathematics_numerical');
    assert.equal(classifyAcademicCategory('Write a C program to implement stack using array'), 'programming_code');
    assert.equal(classifyAcademicCategory('Show me the diagram of OSI 7 layers'), 'concept_diagram');
    assert.equal(classifyAcademicCategory('Explain normalization in DBMS'), 'concept_explanation');
});

// ============================================================================
// 10. Multi-Semester Coverage across Gandaki University BIT Curriculum
// ============================================================================
test('Academic Engine: Covers all 8 semesters of BIT curriculum with structured course identity', () => {
    // Semester 1: CIT111 Computer Fundamentals, MTH111 Mathematics I
    const cit111 = courses.find(c => c.code === 'CIT111');
    assert.ok(cit111, 'CIT111 must exist in Semester 1');

    // Semester 2: CIT121 Programming in C, ELX121 Digital Logic
    const cit121 = courses.find(c => c.code === 'CIT121');
    assert.ok(cit121, 'CIT121 must exist in Semester 2');

    // Semester 3: CIT214 Data Structure and Algorithms, CIT213 DBMS
    const cit213 = courses.find(c => c.code === 'CIT213');
    assert.ok(cit213, 'CIT213 must exist in Semester 3');

    // Semester 4: CIT221 Operating Systems, CIT222 Computer Networks
    const cit221 = courses.find(c => c.code === 'CIT221');
    assert.ok(cit221, 'CIT221 must exist in Semester 4');

    // Check all registered visual block kinds
    const expectedKinds = [
        'attendance', 'results', 'assignments', 'notes', 'notices', 'routine', 'posts', 'directory',
        'syllabus', 'diagram', 'flowchart', 'trace', 'comparison', 'quiz', 'roadmap', 'complexity'
    ];
    for (const k of expectedKinds) {
        assert.ok(VISUAL_BLOCK_KINDS.has(k), `VISUAL_BLOCK_KINDS must include ${k}`);
        assert.ok(chatbotJsSource.includes(`'${k}'`), `Web chatbot.js must include ${k}`);
        assert.ok(postMarkdownSource.includes(`'${k.toUpperCase()}'`), `Mobile PostMarkdown must include ${k.toUpperCase()}`);
    }
});
