'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { handleChat } = require('../ai-assistant');
const {
  classifyUserIntent,
  resolveSyllabusTopic,
  routeQuery,
  extractFilters,
  extractChapterFilter,
  courses,
  createTools,
  formatToolResult
} = require('../lib/chat-tools');
const { isOutOfScopeRequest } = require('../lib/chat-security');

// ============================================================================
// 1. Intent Classification (Categories A, B, C, D)
// ============================================================================

test('Intent Classification: Category A (University-specific information & personal records)', () => {
  const catAQuestions = [
    'When does our class resume?',
    'What is my attendance percentage?',
    'Show my results.',
    'What is tomorrow\'s routine?',
    'Has the university published an exam notice?',
    'What did our teacher announce?',
    'Mero attendance report deu',
    'Bida sakiyo class kaile suru huncha?'
  ];

  for (const q of catAQuestions) {
    const intent = classifyUserIntent(q);
    assert.equal(
      intent.category,
      'CATEGORY_A',
      `Expected "${q}" to be classified as CATEGORY_A, got ${intent.category}`
    );
    assert.equal(intent.requiresStrictVerification, true);
    assert.equal(intent.allowsAiKnowledge, false);
  }
});

test('Intent Classification: Category B (Academic learning and teaching)', () => {
  const catBQuestions = [
    'What is session and cookie management?',
    'Explain server-side scripting.',
    'What is an API?',
    'Teach me linked lists.',
    'Explain Newton\'s laws.',
    'How does recursion work?',
    'Give me examples of SQL joins.',
    'What is deadlock in Operating Systems?'
  ];

  for (const q of catBQuestions) {
    const intent = classifyUserIntent(q);
    assert.equal(
      intent.category,
      'CATEGORY_B',
      `Expected "${q}" to be classified as CATEGORY_B, got ${intent.category}`
    );
    assert.equal(intent.isAcademic, true);
    assert.equal(intent.allowsAiKnowledge, true);
  }
});

test('Intent Classification: Category C (Academic syllabus and study guidance)', () => {
  const catCQuestions = [
    'What should I study in Server-Side Scripting?',
    'what i need to study in server side scripting chapter',
    'What are the important topics in this chapter?',
    'Explain the syllabus of Data Structures and Algorithms.',
    'What should I prepare for the practical exam?',
    'Give me an overview of Database Management System',
    'What will I study in Software Engineering?'
  ];

  for (const q of catCQuestions) {
    const intent = classifyUserIntent(q);
    assert.equal(
      intent.category,
      'CATEGORY_C',
      `Expected "${q}" to be classified as CATEGORY_C, got ${intent.category}`
    );
    assert.equal(intent.isAcademic, true);
    assert.equal(intent.allowsAiKnowledge, true);
  }
});

test('Intent Classification: Category D (General writing, programming & problem-solving)', () => {
  const catDQuestions = [
    'Write a PHP program for login.',
    'Debug this JavaScript code.',
    'Solve a differential equation dy/dx + 2y = 0',
    'Help me write an assignment on binary search trees.'
  ];

  for (const q of catDQuestions) {
    const intent = classifyUserIntent(q);
    assert.equal(
      intent.category,
      'CATEGORY_D',
      `Expected "${q}" to be classified as CATEGORY_D, got ${intent.category}`
    );
    assert.equal(intent.isAcademic, true);
    assert.equal(intent.allowsAiKnowledge, true);
  }
});

// ============================================================================
// 2. Syllabus Topic Resolution
// ============================================================================

test('Syllabus Topic Resolution: Server-Side Scripting maps to CIT123 Unit 5', () => {
  const res1 = resolveSyllabusTopic('what i need to study in server side scripting chapter');
  assert.equal(res1.found, true);
  assert.equal(res1.inSyllabus, true);
  assert.equal(res1.course.code, 'CIT123');
  assert.equal(res1.course.title, 'Web Technology I');
  assert.equal(res1.unitNumber, 5);
  assert.ok(res1.unitTitle.includes('PHP'));
  assert.ok(res1.topics.includes('Cookies, Session Tracking'));

  const res2 = resolveSyllabusTopic('session and cookies management');
  assert.equal(res2.found, true);
  assert.equal(res2.inSyllabus, true);
  assert.equal(res2.course.code, 'CIT123');
  assert.equal(res2.unitNumber, 5);
  assert.equal(res2.matchedTopic, '5.6 Cookies, Session Tracking');
});

test('Syllabus Topic Resolution: DSA concepts map to CIT214', () => {
  const resBst = resolveSyllabusTopic('binary search tree');
  assert.equal(resBst.found, true);
  assert.equal(resBst.inSyllabus, true);
  assert.equal(resBst.course.code, 'CIT214');
  assert.equal(resBst.course.title, 'Data Structure and Algorithms');

  const resRec = resolveSyllabusTopic('recursion');
  assert.equal(resRec.found, true);
  assert.equal(resRec.inSyllabus, true);
  assert.ok(resRec.course.code === 'CIT214' || resRec.course.code === 'CIT111');
});

// ============================================================================
// 3. Question 1 End-to-End: "what is session and cookies management"
// ============================================================================

test('Scenario: "what is session and cookies management" explains concept using AI knowledge without generic university refusal', async () => {
  const query = 'what is session and cookies management';

  // 1. Verify Scope & Routing
  const scope = await isOutOfScopeRequest(query);
  assert.equal(scope.outOfScope, false);

  const route = routeQuery(query);
  assert.equal(route.kind, 'direct');

  // 2. Verify handleChat execution with 0 database notes
  let capturedPrompt = '';
  const result = await handleChat(
    null,
    query,
    { studentId: 'stu_1', semester: 2, role: 'student', authenticated: true },
    [],
    'sess-sess-cookie',
    {
      academicContext: { studentId: 'stu_1', semester: 2, role: 'student', authenticated: true },
      generateReply: async ({ systemPrompt, onDelta }) => {
        capturedPrompt = systemPrompt;
        assert.match(systemPrompt, /Web Technology I/);
        assert.match(systemPrompt, /CIT123/);
        assert.match(systemPrompt, /Cookies, Session Tracking/);
        assert.match(systemPrompt, /Never refuse/i);

        const reply = [
          'In web development, HTTP is a **stateless** protocol, meaning each request is independent.',
          'To maintain user state across requests, we use **Sessions** and **Cookies**:',
          '',
          '1. **Cookies:** Stored on the client browser. Sent in HTTP headers with every request.',
          '2. **Sessions:** Stored on the server. The client only holds a unique `session_id` cookie.',
          '',
          '```php',
          '// Starting a session and storing user data in PHP',
          'session_start();',
          '$_SESSION["username"] = "Saugat";',
          '',
          '// Setting a secure cookie',
          'setcookie("user_pref", "dark_mode", time() + 3600, "/", "", true, true);',
          '```',
          '',
          '- **Security:** Always use the `HttpOnly` and `Secure` flags on cookies to prevent XSS and session hijacking.'
        ].join('\n');

        onDelta(reply);
        return { reply };
      }
    }
  );

  assert.ok(!result.reply.includes("I couldn't find that in the university records."));
  assert.ok(!result.reply.includes("Yo kura university records ma bhetiyena."));
  assert.match(result.reply, /session/i);
  assert.match(result.reply, /cookie/i);
  assert.match(result.reply, /php/i);
});

// ============================================================================
// 4. Question 2 End-to-End: "what i need to study in server side scripting chapter"
// ============================================================================

test('Scenario: "what i need to study in server side scripting chapter" retrieves CIT123 Unit 5 and formats structured study roadmap', async () => {
  const query = 'what i need to study in server side scripting chapter';

  // 1. Verify Filter extraction
  const filters = extractFilters(query);
  assert.equal(filters.subject, 'Web Technology I');
  assert.equal(filters.chapter, 'server side scripting');

  // 2. Verify Routing
  const route = routeQuery(query);
  assert.equal(route.kind, 'syllabus');
  assert.equal(route.filters.subject, 'Web Technology I');

  // 3. Verify get_syllabus tool returns Unit 5 of Web Technology I
  const toolkit = createTools(null, route);
  const toolRes = await toolkit.executeTool('get_syllabus', {
    semester: 2,
    subject: 'Web Technology I'
  });

  const formatted = formatToolResult('get_syllabus', toolRes);
  assert.ok(!formatted.includes("I couldn't find that in the university records."));
  assert.match(formatted, /Programming in PHP and MYSQL/i);
  assert.match(formatted, /Cookies, Session Tracking/i);
  assert.match(formatted, /CRUD operation/i);
  assert.match(formatted, /Form Handling/i);

  // 4. Verify handleChat end-to-end
  const result = await handleChat(
    null,
    query,
    { studentId: 'stu_1', semester: 2, role: 'student', authenticated: true },
    [],
    'sess-study-guide',
    {
      academicContext: { studentId: 'stu_1', semester: 2, role: 'student', authenticated: true },
      generateReply: async ({ systemPrompt, onDelta }) => {
        const reply = [
          '### Server-Side Scripting — Learning Roadmap (Web Technology I · Unit 5)',
          '',
          'Based on your official Gandaki University syllabus (CIT123 Unit 5: Programming in PHP and MYSQL), here is what you need to study in sequence:',
          '',
          '```roadmap',
          JSON.stringify({
            title: 'Server-Side Scripting (PHP & MySQL) — Study Roadmap',
            subtitle: 'Gandaki University BIT Semester II · CIT123 Unit 5 (16 Teaching Hours)',
            steps: [
              { phase: 'Topic 1', title: '5.1 PHP Basics & Web Architecture', detail: "PHP's place in the web, execution model, basic syntax." },
              { phase: 'Topic 2', title: '5.2 & 5.3 Variables, Types & Control Structures', detail: 'Data types, operators, conditionals, loops.' },
              { phase: 'Topic 3', title: '5.4 Arrays, Functions & Form Handling', detail: '$_POST, $_GET, form validation.' },
              { phase: 'Topic 4', title: '5.5 Database Connectivity & CRUD', detail: 'MySQL connection, INSERT, SELECT, UPDATE, DELETE.' },
              { phase: 'Topic 5', title: '5.6 Cookies & Session Tracking', detail: 'State management, session_start(), cookie security.' }
            ]
          }),
          '```'
        ].join('\n');
        onDelta(reply);
        return { reply };
      }
    }
  );

  assert.ok(!result.reply.includes("I couldn't find that in the university records."));
  assert.match(result.reply, /syllabus|roadmap/i);
  assert.match(result.reply, /PHP/i);
});

// ============================================================================
// 5. Non-Syllabus Academic Concepts ("What is an API?", "Newton's laws")
// ============================================================================

test('Scenario: General academic concepts outside explicit syllabus explain with AI knowledge and never give generic university refusal', async () => {
  const qApi = 'what is an API?';
  const apiScope = await isOutOfScopeRequest(qApi);
  assert.equal(apiScope.outOfScope, false);

  const apiRes = await handleChat(
    null,
    qApi,
    { studentId: 'stu_1', semester: 3, role: 'student', authenticated: true },
    [],
    'sess-api-q',
    {
      academicContext: { studentId: 'stu_1', semester: 3, role: 'student', authenticated: true },
      generateReply: async ({ onDelta }) => {
        const text = 'An API (Application Programming Interface) allows two software systems to communicate over defined protocols like HTTP.';
        onDelta(text);
        return { reply: text };
      }
    }
  );
  assert.ok(!apiRes.reply.includes("I couldn't find that in the university records."));
  assert.match(apiRes.reply, /API/);

  const qNewton = 'Explain Newton\'s laws.';
  const newtonScope = await isOutOfScopeRequest(qNewton);
  assert.equal(newtonScope.outOfScope, false);

  const newtonRes = await handleChat(
    null,
    qNewton,
    { studentId: 'stu_1', semester: 1, role: 'student', authenticated: true },
    [],
    'sess-newton-q',
    {
      academicContext: { studentId: 'stu_1', semester: 1, role: 'student', authenticated: true },
      generateReply: async ({ onDelta }) => {
        const text = 'Newton\'s laws of motion describe the relationship between a body and the forces acting upon it: 1) Inertia, 2) F = ma, 3) Action and Reaction.';
        onDelta(text);
        return { reply: text };
      }
    }
  );
  assert.ok(!newtonRes.reply.includes("I couldn't find that in the university records."));
  assert.match(newtonRes.reply, /Newton/);
});

// ============================================================================
// 6. Multi-turn Follow-up Context Preservation
// ============================================================================

test('Scenario: Follow-up question preserves prior academic context ("Now explain cookies")', () => {
  const history = [
    { role: 'user', content: 'Explain session management in Web Technology' },
    { role: 'assistant', content: 'Sessions maintain state on the server...' }
  ];

  const followUpRoute = routeQuery('Now explain cookies.', history);
  assert.equal(followUpRoute.kind, 'direct');
  assert.equal(followUpRoute.filters.subject, 'Web Technology I');
});
