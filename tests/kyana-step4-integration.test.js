'use strict';

/**
 * KYANA STEP 4 — DEFAULT UNIVERSAL RETRIEVAL INTEGRATION & ROUTING RELIABILITY TEST SUITE
 * =======================================================================================
 * Tests all 14 scenarios required by Section E:
 *  1. Academic notice queries trigger universal search automatically.
 *  2. Academic event queries ("project defense", "presentation") trigger universal search automatically.
 *  3. Assignment search triggers universal search first.
 *  4. Study materials/notes questions trigger universal search first.
 *  5. Routine inquiries with semester trigger universal search.
 *  6. Greetings and casual smalltalk do NOT trigger universal search.
 *  7. Out-of-scope questions do NOT trigger universal search.
 *  8. Personal attendance queries route to get_my_attendance (NOT universal search).
 *  9. Personal marks queries route to get_my_results (NOT universal search).
 * 10. Personal submission status queries route to check_submission_status (NOT universal search).
 * 11. Partial source failures report sourcesFailed without crashing.
 * 12. Fallback path preserves retrieved evidence and resource cards.
 * 13. Model does not invent missing semesters for routine or syllabus.
 * 14. "Explain polymorphism" does not inherit semester 2 from "semester 2 routine".
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  handleChat,
  routeQuery,
  runKyanaAgentLoop,
  understandRequest,
  shouldUseKyanaAgentEngine
} = require('../ai-assistant');
const { createTools, formatToolResult } = require('../lib/chat-tools');
const { universalSearch } = require('../lib/kyana-universal-retrieval');

const STUDENT_USER = {
  studentId: 'c808f9d6-1a5e-4ba9-bbf8-bb97a7a40cb2',
  semester: 3,
  department: 'BIT',
  role: 'student',
  authenticated: true
};

function createMockDb(overrides = {}) {
  return {
    isPostgres: true,
    all: async () => [],
    get: async () => null,
    query: async () => ({ rows: [] }),
    ...overrides
  };
}

test('1. Academic notice queries trigger universal search automatically', async () => {
  const query = 'Hamro exam notice k cha?';
  const toolsExecuted = [];

  const mockDb = createMockDb();
  const res = await runKyanaAgentLoop({
    db: mockDb,
    message: query,
    history: [],
    academicContext: STUDENT_USER,
    generateReply: async () => 'Notice info found.',
    onBeforeToolCall: (name) => {
      toolsExecuted.push(name);
    }
  });

  assert.ok(res.handled, 'Agent loop must handle the request');
  assert.ok(toolsExecuted.includes('universal_search'), 'Must automatically execute universal_search');
  assert.equal(toolsExecuted[0], 'universal_search', 'universal_search must be the first tool executed');
});

test('2. Academic event queries ("project defense", "presentation") trigger universal search automatically', async () => {
  const queries = [
    'Hamro project defense kaile ho?',
    'When is our proposal presentation?'
  ];

  for (const query of queries) {
    const toolsExecuted = [];
    const mockDb = createMockDb();
    const res = await runKyanaAgentLoop({
      db: mockDb,
      message: query,
      history: [],
      academicContext: STUDENT_USER,
      generateReply: async () => 'Event info found.',
      onBeforeToolCall: (name) => {
        toolsExecuted.push(name);
      }
    });

    assert.ok(res.handled, `Agent loop must handle "${query}"`);
    assert.ok(toolsExecuted.includes('universal_search'), `Must execute universal_search for "${query}"`);
    assert.equal(toolsExecuted[0], 'universal_search', `universal_search must be first for "${query}"`);
  }
});

test('3. Assignment search triggers universal search first', async () => {
  const query = 'DSA assignment ke cha?';
  const toolsExecuted = [];

  const mockDb = createMockDb();
  const res = await runKyanaAgentLoop({
    db: mockDb,
    message: query,
    history: [],
    academicContext: STUDENT_USER,
    generateReply: async () => 'Assignment info found.',
    onBeforeToolCall: (name) => {
      toolsExecuted.push(name);
    }
  });

  assert.ok(res.handled, 'Agent loop must handle assignment search');
  assert.equal(toolsExecuted[0], 'universal_search', 'universal_search must be the first-pass tool');
});

test('4. Study materials/notes questions trigger universal search first', async () => {
  const query = 'Chapter 5 PHP notes';
  const toolsExecuted = [];

  const mockDb = createMockDb();
  const res = await runKyanaAgentLoop({
    db: mockDb,
    message: query,
    history: [],
    academicContext: STUDENT_USER,
    generateReply: async () => 'Notes info found.',
    onBeforeToolCall: (name) => {
      toolsExecuted.push(name);
    }
  });

  assert.ok(res.handled, 'Agent loop must handle notes search');
  assert.equal(toolsExecuted[0], 'universal_search', 'universal_search must be the first-pass tool');
});

test('5. Routine inquiries with semester trigger universal search', async () => {
  const query = 'Semester 3 routine';
  const toolsExecuted = [];

  const mockDb = createMockDb();
  const res = await runKyanaAgentLoop({
    db: mockDb,
    message: query,
    history: [],
    academicContext: STUDENT_USER,
    generateReply: async () => 'Routine found.',
    onBeforeToolCall: (name) => {
      toolsExecuted.push(name);
    }
  });

  assert.ok(res.handled, 'Agent loop must handle routine with semester');
  assert.equal(toolsExecuted[0], 'universal_search', 'universal_search must be the first-pass tool for routine with semester');
});

test('6. Greetings and casual smalltalk do NOT trigger universal search', async () => {
  const greetings = ['Hello bro', 'Namaste', 'Hi there'];

  for (const msg of greetings) {
    const shouldRun = shouldUseKyanaAgentEngine(msg, [], STUDENT_USER);
    assert.equal(shouldRun, false, `Smalltalk "${msg}" must not invoke Kyana Agent Engine`);

    const route = routeQuery(msg);
    assert.notEqual(route.kind, 'universal_search');
    assert.ok(['direct', 'scope_check', 'smalltalk'].includes(route.kind), `Route for "${msg}" must be direct, smalltalk, or scope_check`);
  }
});

test('7. Out-of-scope questions do NOT trigger universal search', async () => {
  const outOfScope = ['How to bake a chocolate cake?', 'Who won the premier league yesterday?'];

  for (const msg of outOfScope) {
    const shouldRun = shouldUseKyanaAgentEngine(msg, [], STUDENT_USER);
    assert.equal(shouldRun, false, `Out-of-scope query "${msg}" must not invoke Agent Engine`);

    const route = routeQuery(msg);
    assert.equal(route.kind, 'scope_check', `Route for "${msg}" must be scope_check`);
  }
});

test('8. Personal attendance queries route to get_my_attendance (NOT universal search)', async () => {
  const query = 'my attendance in java';
  const toolsExecuted = [];

  const mockDb = createMockDb();
  const res = await runKyanaAgentLoop({
    db: mockDb,
    message: query,
    history: [],
    academicContext: STUDENT_USER,
    generateReply: async () => 'Attendance is 85%.',
    onBeforeToolCall: (name) => {
      toolsExecuted.push(name);
    }
  });

  assert.ok(res.handled, 'Agent loop must handle attendance query');
  assert.ok(toolsExecuted.includes('get_my_attendance'), 'Must execute get_my_attendance');
  assert.ok(!toolsExecuted.includes('universal_search'), 'Must NOT execute universal_search for personal attendance');
});

test('9. Personal marks queries route to get_my_results (NOT universal search)', async () => {
  const query = 'my marks in dsa';
  const toolsExecuted = [];

  const mockDb = createMockDb();
  const res = await runKyanaAgentLoop({
    db: mockDb,
    message: query,
    history: [],
    academicContext: STUDENT_USER,
    generateReply: async () => 'Marks are published.',
    onBeforeToolCall: (name) => {
      toolsExecuted.push(name);
    }
  });

  assert.ok(res.handled, 'Agent loop must handle personal marks query');
  assert.ok(toolsExecuted.includes('get_my_results'), 'Must execute get_my_results');
  assert.ok(!toolsExecuted.includes('universal_search'), 'Must NOT execute universal_search for personal marks');
});

test('10. Personal submission status queries route to check_submission_status (NOT universal search)', async () => {
  const query = 'have I submitted the dsa assignment?';
  const toolsExecuted = [];

  const mockDb = createMockDb();
  const res = await runKyanaAgentLoop({
    db: mockDb,
    message: query,
    history: [],
    academicContext: STUDENT_USER,
    generateReply: async () => 'Submission status verified.',
    onBeforeToolCall: (name) => {
      toolsExecuted.push(name);
    }
  });

  assert.ok(res.handled, 'Agent loop must handle submission status check');
  assert.ok(toolsExecuted.includes('check_submission_status'), 'Must execute check_submission_status');
  assert.ok(!toolsExecuted.includes('universal_search'), 'Must NOT execute universal_search for personal submission checks');
});

test('11. Partial source failures report sourcesFailed without crashing', async () => {
  // Simulate a DB where routine queries fail with a timeout/error
  const failingDb = {
    isPostgres: true,
    all: async (sql) => {
      if (typeof sql === 'string' && sql.includes('FROM routine')) {
        throw new Error('Connection timeout to routine database table');
      }
      return [];
    },
    get: async () => null,
    query: async () => ({ rows: [] })
  };

  const res = await universalSearch(failingDb, STUDENT_USER, {
    query: 'algorithms',
    semester: 3
  });

  // Verify resilience
  assert.ok(res, 'universalSearch must return result object despite source failure');
  assert.ok(res.metadata, 'metadata must be present');
  assert.equal(res.metadata.isComplete, false, 'isComplete must be false when a source fails');
  assert.ok(Array.isArray(res.metadata.sourcesFailed), 'sourcesFailed must be an array');
  assert.ok(res.metadata.sourcesFailed.includes('routine'), 'sourcesFailed must report routine');

  // Verify formatted tool output transparency
  const formatted = formatToolResult('universal_search', res);
  assert.match(formatted, /routine/, 'Formatted output must mention routine failure');
  assert.match(formatted, /temporary issue|partial/i, 'Formatted output must disclose partial status');
});

test('12. Fallback path preserves retrieved evidence and resource cards', async () => {
  const mockDb = createMockDb();
  const res = await runKyanaAgentLoop({
    db: mockDb,
    message: 'Project defense notice',
    history: [],
    academicContext: STUDENT_USER,
    generateReply: async () => {
      throw new Error('LLM provider rate limit exceeded');
    },
    failTools: null,
    onBeforeToolCall: (name) => {}
  });

  // Verify graceful degradation
  assert.ok(res.handled, 'Must handle request in fallback mode');
  assert.ok(res.reply && typeof res.reply === 'string', 'Must provide verified fallback reply');
  assert.ok(Array.isArray(res.resourceCards), 'resourceCards must be an array');
  assert.ok(Array.isArray(res.agentTrace.steps), 'agentTrace must be preserved');
});

test('13. Model does not invent missing semesters for routine or syllabus', async () => {
  const route = routeQuery('routine');
  assert.equal(route.filters.semester, null, 'User route has no semester');

  const toolkit = createTools(createMockDb(), route);
  // Model attempts to invent semester: 4
  const routineRes = await toolkit.executeTool('get_routine', { semester: 4 });
  assert.match(routineRes.clarification, /Which semester/, 'Model-supplied semester must not override omitted semester for routine');

  const syllabusRoute = routeQuery('syllabus');
  const syllabusToolkit = createTools(createMockDb(), syllabusRoute);
  const syllabusRes = await syllabusToolkit.executeTool('get_syllabus', { semester: 4 });
  assert.match(syllabusRes.clarification, /Which semester/, 'Model-supplied semester must not override omitted semester for syllabus');
});

test('14. "Explain polymorphism" does not inherit semester 2 from "semester 2 routine"', async () => {
  const history = [
    { role: 'user', content: 'semester 2 routine' },
    { role: 'assistant', content: 'Here is the Semester 2 routine...' }
  ];

  const route = routeQuery('explain polymorphism', history);
  assert.equal(route.filters.semester, null, '"explain polymorphism" must NOT inherit semester 2 from previous routine query');
  assert.equal(route.kind, 'direct', 'Academic tutoring question must route to direct without tools');
});
