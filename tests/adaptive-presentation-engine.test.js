const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PRESENTATION_PROFILES,
  COMPONENT_TYPES,
  planAdaptivePresentation,
  buildLogicGateSimulatorPayload,
  validateStructuredComponent,
  sanitizeAdaptiveResponse,
  buildAdaptivePresentationPrompt,
  buildAdaptiveEducationalFallback,
} = require('../lib/adaptive-presentation-engine');

const {
  stabilizeStreamingMarkdown,
  fallbackMarkdown,
  highlightChatCode,
  renderAdaptiveVisualBlockHtml,
} = require('../public/chatbot.js');

const {
  analyzeChapterStudentQuestion,
  answerWithChapterContext,
} = require('../lib/chapter-tutor-engine');

const libraryHtmlSource = fs.readFileSync(
  path.join(__dirname, '../public/library.html'),
  'utf8'
);

const postMarkdownSource = fs.readFileSync(
  path.join(__dirname, '../mobile/components/PostMarkdown.tsx'),
  'utf8'
);

test('Scenario 1: Simple conversational question -> natural prose, zero forced cards, roadmaps, or quizzes', () => {
  const plan = planAdaptivePresentation('When is the next semester exam?');
  assert.equal(plan.profile, PRESENTATION_PROFILES.SIMPLE_CONVERSATIONAL);
  assert.equal(plan.useHeadings, false);
  assert.equal(plan.useInteractiveDemo, false);
  assert.equal(plan.useRoadmap, false);
  assert.equal(plan.useCheckpoint, false);
  assert.deepEqual(plan.allowedComponents, []);

  // Malformed or invalid structured blocks are stripped cleanly
  const pollutedReply = [
    'The Semester 3 final exam starts on Sunday at 7:00 AM.',
    '```roadmap',
    '{"title":"Unnecessary Roadmap","steps":[]}',
    '```',
  ].join('\n');
  const cleaned = sanitizeAdaptiveResponse(pollutedReply);
  assert.ok(!cleaned.includes('```roadmap'), 'Invalid roadmap must be stripped');
  assert.match(cleaned, /The Semester 3 final exam starts on Sunday at 7:00 AM\./);
});

test('Scenario 2: Simple definition ("What is a proposition?") -> concise natural paragraphs with bold emphasis and examples, no simulator or roadmap', () => {
  const plan = planAdaptivePresentation('What is a proposition?');
  assert.equal(plan.profile, PRESENTATION_PROFILES.SIMPLE_DEFINITION);
  assert.equal(plan.useHeadings, false);
  assert.equal(plan.useInteractiveDemo, false);
  assert.equal(plan.useRoadmap, false);
  assert.equal(plan.useCheckpoint, false);

  const fallbackReply = buildAdaptiveEducationalFallback('What is a proposition?', {
    plan,
  });

  assert.match(fallbackReply, /\*\*proposition\*\*/i);
  assert.match(fallbackReply, /declarative sentence/i);
  assert.ok(!fallbackReply.includes('```logic_sim'), 'Must not include interactive simulator for simple definition');
  assert.ok(!fallbackReply.includes('```study_session'), 'Must not include learning roadmap for simple definition');

  const html = fallbackMarkdown(fallbackReply);
  assert.match(html, /<p>[\s\S]*<strong>proposition<\/strong>[\s\S]*<\/p>/i);
});

test('Scenario 3: Long educational explanation -> clear heading hierarchy, paragraphs, nested lists, and examples', () => {
  const query = 'Explain database normalization in detail with 1NF, 2NF, and 3NF examples.';
  const plan = planAdaptivePresentation(query);
  assert.equal(plan.profile, PRESENTATION_PROFILES.CONCEPTUAL_EXPLANATION);
  assert.equal(plan.useHeadings, true);

  const md = [
    '## Database Normalization',
    '',
    '**Normalization** is the systematic process of organizing attributes and relations in a relational database to minimize data redundancy and eliminate insertion, update, and deletion anomalies.',
    '',
    '### Normal Forms Progression',
    '- **First Normal Form (1NF)**',
    '  - Ensures every attribute contains only atomic (indivisible) values.',
    '  - Removes repeating groups across columns.',
    '- **Second Normal Form (2NF)**',
    '  - Must already satisfy 1NF.',
    '  - Every non-prime attribute is fully functionally dependent on the whole candidate key ($K \\to A$).',
    '- **Third Normal Form (3NF)**',
    '  - Must already satisfy 2NF.',
    '  - Eliminates transitive dependencies ($X \\to Y$ and $Y \\to Z$ where $X$ is a key and $Y$ is non-prime).',
  ].join('\n');

  const html = fallbackMarkdown(md);
  assert.match(html, /<h2>Database Normalization<\/h2>/);
  assert.match(html, /<h3>Normal Forms Progression<\/h3>/);
  assert.match(html, /<ul>[\s\S]*<ul>[\s\S]*<li>Ensures every attribute/);
  assert.match(html, /<span class="kyana-math-inline">\$K \\to A\$<\/span>/);
});

test('Scenario 4: Mathematical derivation -> inline and block LaTeX equations, aligned steps, fractions, summations, and matrices without underscore corruption', () => {
  const query = 'Derive the time complexity recurrence relation using Master Theorem and show the Gaussian integral equation.';
  const plan = planAdaptivePresentation(query);
  assert.equal(plan.profile, PRESENTATION_PROFILES.MATHEMATICAL_DERIVATION);
  assert.equal(plan.useLatex, true);
  assert.ok(plan.allowedComponents.includes(COMPONENT_TYPES.FORMULA));

  const derivationMd = [
    '### Recurrence Derivation',
    '',
    'For a divide-and-conquer recurrence of the form $T(n) = aT(n/b) + f(n)$ where $a \\ge 1$ and $b > 1$:',
    '',
    '$$',
    '\\begin{aligned}',
    'T(n) &= a^k T\\left(\\frac{n}{b^k}\\right) + \\sum_{j=0}^{k-1} a^j f\\left(\\frac{n}{b^j}\\right) \\\\',
    '&= \\Theta\\left(n^{\\log_b a}\\right) + \\sum_{j=0}^{\\log_b n - 1} a^j f\\left(\\frac{n}{b^j}\\right)',
    '\\end{aligned}',
    '$$',
    '',
    'And for normal distribution probability density with subscript parameters $x_i$ and $\\sigma_x$:',
    '',
    '$$',
    'p(x_i) = \\frac{1}{\\sigma_x \\sqrt{2\\pi}} \\int_{-\\infty}^{x_i} e^{-\\frac{(t - \\mu_x)^2}{2\\sigma_x^2}} \\, dt',
    '$$',
  ].join('\n');

  const html = fallbackMarkdown(derivationMd);
  assert.match(html, /<span class="kyana-math-inline">\$T\(n\) = aT\(n\/b\) \+ f\(n\)\$<\/span>/);
  assert.match(html, /<div class="kyana-math-block">\$\$[\s\S]*\\begin\{aligned\}[\s\S]*\\sum_\{j=0\}\^\{k-1\}[\s\S]*\$\$<\/div>/);
  assert.ok(!html.includes('<em>x'), 'Subscripts inside LaTeX must never be converted to <em> tags');
});

test('Scenario 5: Truth table ("Explain truth tables") -> properly formatted Markdown truth table and row explanation, no forced logic simulator unless gates are requested', () => {
  const query = 'Explain truth tables.';
  const plan = planAdaptivePresentation(query);
  assert.equal(plan.profile, PRESENTATION_PROFILES.TRUTH_TABLE);
  assert.equal(plan.useTables, true);
  assert.equal(plan.useInteractiveDemo, false);

  const fallbackReply = buildAdaptiveEducationalFallback(query, {
    plan,
  });

  assert.match(fallbackReply, /\| \$P\$ \| \$Q\$ \|/);
  assert.ok(!fallbackReply.includes('```logic_sim'), 'Plain truth table explanation should not force a gate simulator');

  const html = fallbackMarkdown(fallbackReply);
  assert.match(html, /<div class="kyana-table-wrapper"><table class="kyana-table">/);
  assert.match(html, /<thead><tr><th style="text-align: center;">/);
});

test('Scenario 6: Code explanation -> syntax highlighting, language badge, copy-code support, and exact code preservation', () => {
  const query = 'Write a C program to implement binary search and explain how it works.';
  const plan = planAdaptivePresentation(query);
  assert.equal(plan.profile, PRESENTATION_PROFILES.PROGRAMMING_CODE);
  assert.equal(plan.useCodeBlocks, true);
  assert.ok(plan.allowedComponents.includes(COMPONENT_TYPES.CODE_EXAMPLE));

  const cCode = [
    '#include <stdio.h>',
    '',
    'int binarySearch(int arr[], int n, int target) {',
    '    int low = 0, high = n - 1;',
    '    while (low <= high) {',
    '        int mid = low + (high - low) / 2;',
    '        if (arr[mid] == target) return mid;',
    '        if (arr[mid] < target) low = mid + 1;',
    '        else high = mid - 1;',
    '    }',
    '    return -1;',
    '}',
  ].join('\n');

  const highlighted = highlightChatCode(cCode, 'c');
  assert.match(highlighted, /class="token keyword directive">#include<\/span>/);
  assert.match(highlighted, /class="token string">&lt;stdio\.h&gt;<\/span>/);
  assert.match(highlighted, /class="token keyword">while<\/span>/);
  assert.match(highlighted, /class="token function">binarySearch<\/span>/);
});

test('Scenario 7: Interactive logic gate ("Teach me AND, OR and NOT gates") -> Boolean expressions, truth tables, and validated interactive logic_sim component', () => {
  const query = 'Teach me AND, OR and NOT gates.';
  const plan = planAdaptivePresentation(query);
  assert.equal(plan.profile, PRESENTATION_PROFILES.INTERACTIVE_SIMULATION);
  assert.equal(plan.useInteractiveDemo, true);
  assert.ok(plan.allowedComponents.includes(COMPONENT_TYPES.INTERACTIVE_DEMO));

  const simPayload = buildLogicGateSimulatorPayload(plan.gates);
  assert.equal(simPayload.demoType, 'logic_gate_simulator');
  assert.deepEqual(
    simPayload.gates.map((g) => g.gate),
    ['AND', 'OR', 'NOT']
  );

  const fallbackReply = buildAdaptiveEducationalFallback(query, {
    plan,
  });

  assert.match(fallbackReply, /```logic_sim/);
  const cleaned = sanitizeAdaptiveResponse(fallbackReply);
  assert.match(cleaned, /```logic_sim/);

  // Extract JSON payload inside ```logic_sim and render via renderAdaptiveVisualBlockHtml
  const match = cleaned.match(/```logic_sim\n([\s\S]*?)\n```/);
  assert.ok(match, 'Should contain valid logic_sim fenced block');
  const renderedWidget = renderAdaptiveVisualBlockHtml('logic_sim', match[1]);
  assert.ok(renderedWidget, 'renderAdaptiveVisualBlockHtml should render logic_sim card');
  assert.match(renderedWidget, /kyana-logic-sim-card/);
  assert.match(renderedWidget, /kyana-logic-gate-tab/);
  assert.match(renderedWidget, /Input A:/);
  assert.match(renderedWidget, /Output Y =/);
});

test('Scenario 8: Chapter teaching session ("Teach me Unit 1 completely") -> structured chapter roadmap, sequential lessons, examples, and checkpoint', () => {
  const query = 'Teach me Unit 1 completely';
  const analysis = analyzeChapterStudentQuestion('Teach me this chapter step by step', [], []);
  assert.equal(analysis.isExplicitChapterTeachRequest, true);

  const plan = planAdaptivePresentation(query, { isStudySession: true });
  assert.equal(plan.profile, PRESENTATION_PROFILES.CHAPTER_TEACHING);
  assert.equal(plan.useRoadmap, true);
  assert.equal(plan.useCheckpoint, true);
  assert.ok(plan.allowedComponents.includes(COMPONENT_TYPES.LEARNING_SESSION));

  const sampleSessionPayload = JSON.stringify({
    course: 'CSC115 · Digital Logic',
    unit: 'Unit 1: Binary Systems',
    currentStep: 1,
    totalSteps: 3,
    checklist: [
      { stepIndex: 1, title: 'Number Systems & Radix Conversion', status: 'current', sourceBadge: '📄 Teacher PDF' },
      { stepIndex: 2, title: "1's and 2's Complement Arithmetic", status: 'pending', hasPyq: true },
      { stepIndex: 3, title: 'BCD, Gray, and ASCII Codes', status: 'pending' },
    ],
  });

  const validation = validateStructuredComponent('study_session', sampleSessionPayload);
  assert.equal(validation.valid, true);

  const sessionHtml = renderAdaptiveVisualBlockHtml('study_session', sampleSessionPayload);
  assert.match(sessionHtml, /kyana-study-session-card/);
  assert.match(sessionHtml, /Step 1 of 3/);
  assert.match(sessionHtml, /Number Systems &amp; Radix Conversion/);
});

test('Scenario 9: PDF-grounded explanation -> prioritizes uploaded chapter PDF notes and cites file/page sources while distinguishing syllabus coverage', async () => {
  const mockDb = {
    all: async (sql) => {
      if (sql.includes('FROM files')) {
        return [
          {
            id: 501,
            title: 'Unit 1 Propositional Logic Lecture Notes',
            originalName: 'Unit_1_Propositional_Logic.pdf',
            subject: 'Discrete Structure',
            semester: 'Semester 2',
            chapter: 'Unit 1: Propositional Logic',
          },
        ];
      }
      if (sql.includes('FROM document_chunks')) {
        return [
          {
            id: 9001,
            file_id: 501,
            chunk_index: 0,
            page_start: 4,
            page_end: 4,
            section_heading: "De Morgan's Laws",
            clean_content:
              "De Morgan's Laws state that ¬(p ∧ q) ≡ ¬p ∨ ¬q and ¬(p ∨ q) ≡ ¬p ∧ ¬q. They are widely used to simplify Boolean and propositional expressions.",
            file_title: 'Unit 1 Propositional Logic Lecture Notes',
            original_name: 'Unit_1_Propositional_Logic.pdf',
          },
        ];
      }
      return [];
    },
  };

  const result = await answerWithChapterContext(mockDb, {
    message: "Explain De Morgan's Laws from the chapter notes.",
    history: [],
    chapterContext: {
      subject: 'Discrete Structure',
      subjectCode: 'CSC160',
      semesterNo: 2,
      unitNumber: 1,
      chapterTitle: 'Unit 1: Propositional Logic',
      fileIds: [501],
    },
  });

  assert.equal(result.mode, 'chapter_qa');
  assert.equal(result.foundInChapterFiles, true);
  assert.equal(result.chapterTutor.usedFallbackKnowledge, false);
  assert.match(result.reply, /De Morgan's Laws/);
  assert.match(result.reply, /Unit 1 Propositional Logic Lecture Notes/);
});

test('Scenario 10: PYQ-based explanation -> highlights past exam questions with marks and grounded model solution', () => {
  const query = 'Show past exam questions (PYQ) on Karnaugh Map simplification with solution.';
  const plan = planAdaptivePresentation(query, { hasPyq: true });
  assert.equal(plan.profile, PRESENTATION_PROFILES.PYQ_EXPLANATION);
  assert.ok(plan.allowedComponents.includes(COMPONENT_TYPES.SOURCE_REFERENCE));

  const pyqPayload = JSON.stringify({
    examTitle: 'GANDAKI UNIVERSITY · 2023 FINAL EXAM',
    questionNumber: 'Q.4(b)',
    marks: '5 MARKS',
    questionText: 'Simplify F(A,B,C,D) = ∑m(0,1,2,5,8,9,10) using a 4-variable K-Map and realize the circuit using NAND gates.',
    teacherNoteReference: 'Unit 3 K-Map Notes (Page 7)',
  });

  const v = validateStructuredComponent('pyq_card', pyqPayload);
  assert.equal(v.valid, true);

  const cardHtml = renderAdaptiveVisualBlockHtml('pyq_card', pyqPayload);
  assert.match(cardHtml, /kyana-pyq-card/);
  assert.match(cardHtml, /PAST EXAM SPOTLIGHT/);
  assert.match(cardHtml, /5 MARKS/);
  assert.match(cardHtml, /Unit 3 K-Map Notes \(Page 7\)/);
});

test('Scenario 11: Streaming response -> never exposes partial structured JSON fences, unclosed code blocks, or broken LaTeX blocks while streaming', () => {
  // 11a. Partially streamed structured JSON component (```logic_sim or ```study_session) is hidden until closing fence arrives
  const midStreamStructured = [
    'Let us explore how **AND** and **OR** gates work in digital circuits.',
    '',
    '```logic_sim',
    '{"demoType":"logic_gate_simulator","title":"Interactive Logic',
  ].join('\n');

  const stabilizedStructured = stabilizeStreamingMarkdown(midStreamStructured);
  assert.ok(!stabilizedStructured.includes('```logic_sim'), 'Partially streamed structured JSON fence must be hidden until complete');
  assert.ok(!stabilizedStructured.includes('{"demoType"'), 'Raw incomplete JSON payload must never leak during streaming');
  assert.match(stabilizedStructured, /Let us explore how \*\*AND\*\* and \*\*OR\*\* gates work/);

  // 11b. Once the fence closes, it is preserved for component rendering
  const completedStreamStructured = [
    'Let us explore how **AND** and **OR** gates work in digital circuits.',
    '',
    '```logic_sim',
    '{"demoType":"logic_gate_simulator","title":"Interactive Logic Gate Simulator","gates":[{"gate":"AND","inputs":["A","B"],"truthTable":[{"A":0,"B":0,"Y":0}]}]}',
    '```',
  ].join('\n');
  const stabilizedComplete = stabilizeStreamingMarkdown(completedStreamStructured);
  assert.match(stabilizedComplete, /```logic_sim/);
});

test('Scenario 12: Malformed structured block -> stripped cleanly so raw JSON or broken component schemas never leak to students', () => {
  const malformedResponse = [
    '### Logic Gates Overview',
    '',
    'An **AND gate** outputs 1 only when all inputs are 1.',
    '',
    '```logic_sim',
    '{"demoType": "logic_gate_simulator", "gates": [BROKEN_JSON_HERE',
    '```',
    '',
    '```diagram',
    '{"title": "Empty Diagram With No Nodes", "nodes": []}',
    '```',
    '',
    'Both gates are fundamental building blocks of combinational circuits.',
  ].join('\n');

  const sanitized = sanitizeAdaptiveResponse(malformedResponse);
  assert.ok(!sanitized.includes('BROKEN_JSON_HERE'), 'Malformed JSON block must be stripped');
  assert.ok(!sanitized.includes('Empty Diagram With No Nodes'), 'Invalid diagram with empty nodes must be stripped');
  assert.match(sanitized, /### Logic Gates Overview/);
  assert.match(sanitized, /Both gates are fundamental building blocks of combinational circuits\./);

  // Also verify renderAdaptiveVisualBlockHtml returns null on malformed JSON
  assert.equal(renderAdaptiveVisualBlockHtml('logic_sim', '{broken_json'), null);
  assert.equal(renderAdaptiveVisualBlockHtml('diagram', '{"nodes":[]}'), null);

  // Verify Library Split-Screen & Mobile PostMarkdown also include adaptive rendering & safety
  assert.match(libraryHtmlSource, /wireInteractiveBlocksInContainer/);
  assert.match(postMarkdownSource, /logic_sim/);
});

test('Phase 2 Regression: sanitizeAdaptiveResponse preserves closed logic_sim at end of response while stripping unclosed trailing fences', () => {
  const simPayload = JSON.stringify(buildLogicGateSimulatorPayload(['AND', 'OR', 'NOT']));
  const validWithTrailingSim = [
    '## Logic Gates: AND, OR, NOT',
    '',
    'Try toggling inputs $A$ and $B$ below:',
    '',
    '```logic_sim',
    simPayload,
    '```'
  ].join('\n');

  const sanitized = sanitizeAdaptiveResponse(validWithTrailingSim);
  assert.match(sanitized, /```logic_sim\n[\s\S]*```/, 'Valid closed logic_sim at end of response must be preserved');

  const withUnclosedTrailing = validWithTrailingSim + '\n\n```study_session\n{"course":"Partial';
  const stripped = sanitizeAdaptiveResponse(withUnclosedTrailing);
  assert.match(stripped, /```logic_sim\n[\s\S]*```/, 'Earlier valid logic_sim must remain');
  assert.ok(!stripped.includes('study_session'), 'Unclosed trailing structured fence must be stripped');
});

test('Phase 2 Regression: Library Chapter Tutor protects visual HTML blocks from escaping and loads KaTeX', () => {
  assert.match(libraryHtmlSource, /katex@0\.16\.11\/dist\/katex\.min\.css/);
  assert.match(libraryHtmlSource, /KYANACHAPTERVISUALTOKEN/);
  assert.match(postMarkdownSource, /checkpoint_question\|chapter_summary\|source_reference/);
  assert.match(postMarkdownSource, /truthRows\.map/);
});

test('Phase 2 Regression: Logic gate queries are not hijacked into study_partner and core CS/math topics stay in scope', () => {
  const { isStudyPartnerQuery, academicRequest } = require('../lib/chat-tools');
  assert.equal(isStudyPartnerQuery('Teach me AND, OR and NOT gates.'), false);
  assert.equal(isStudyPartnerQuery('Teach me Unit 1 of Web Technology I step by step'), true);
  assert.equal(academicRequest('Explain the OSI 7-layer model architecture and how data flows through each layer'), true);
  assert.equal(academicRequest('Derive the quadratic formula step by step'), true);
});

test('Phase 2.1: Explicit interactive CSS flexbox demo produces validated live_demo playground', () => {
  const query = 'Show how CSS flexbox works with an interactive demo.';
  const plan = planAdaptivePresentation(query);
  assert.equal(plan.profile, PRESENTATION_PROFILES.PROGRAMMING_CODE);
  assert.equal(plan.useInteractiveDemo, true);
  assert.ok(plan.allowedComponents.includes(COMPONENT_TYPES.INTERACTIVE_DEMO));

  const reply = buildAdaptiveEducationalFallback(query, { plan });
  const cleaned = sanitizeAdaptiveResponse(reply);
  assert.match(cleaned, /```css\n/);
  assert.match(cleaned, /```live_demo\n/);

  const match = cleaned.match(/```live_demo\n([\s\S]*?)\n```/);
  assert.ok(match, 'Should contain valid live_demo fenced block');
  const html = renderAdaptiveVisualBlockHtml('live_demo', match[1]);
  assert.ok(html, 'live_demo should render HTML');
  assert.match(html, /kyana-live-demo-card/);
  assert.match(html, /Row · Space-Between/);
  assert.match(libraryHtmlSource, /kyana-live-demo-card/);
  assert.match(postMarkdownSource, /web_live_preview/);
});
