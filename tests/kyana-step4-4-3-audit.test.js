'use strict';

/**
 * KYANA STEP 4.4.3 — FINAL DEADLINE AND FALLBACK RELIABILITY AUDIT TEST SUITE
 * ===========================================================================
 * Verifies:
 * 1. Small-budget deadline boundary (1, 5, 10, 20, 50, 100, 300, 600, 1000, 2000, 4000, 10000 ms)
 *    and sub-25ms structured incomplete/deadlineExceeded response.
 * 2. Scope-classifier shared total timeout and remaining budget enforcement across providers.
 * 3. Legacy search failure propagation for both search_posts and search_notices.
 * 4. Integration lifecycle: agent engine callerTimeoutMs propagation and partial retrieval handling.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  universalSearch,
  calculateEffectiveDeadline
} = require('../lib/kyana-universal-retrieval');
const { createTools } = require('../lib/chat-tools');
const { createChatProvider } = require('../lib/chat-provider');
const { isOutOfScopeRequest } = require('../lib/chat-security');

const USER = {
  studentId: 'c808f9d6-1a5e-4ba9-bbf8-bb97a7a40cb2',
  semester: 3,
  department: 'BIT',
  role: 'student',
  authenticated: true
};

function makeOpenAISSEResponse(content) {
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n'
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
  return {
    ok: true,
    headers: new Map(),
    body: stream
  };
}

function makeGeminiSSEResponse(text) {
  const chunks = [
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] })}\n\n`
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
  return {
    ok: true,
    headers: new Map(),
    body: stream
  };
}

// ============================================================================
// 1. SMALL-BUDGET DEADLINE BOUNDARY TESTS
// ============================================================================

const BUDGET_CASES = [
  { budget: 10000, expected: 7500, hasReserve: true },
  { budget: 4000,  expected: 3000, hasReserve: true },
  { budget: 2000,  expected: 1500, hasReserve: true },
  { budget: 1000,  expected: 750,  hasReserve: true },
  { budget: 600,   expected: 500,  hasReserve: true },
  { budget: 300,   expected: 250,  hasReserve: true },
  { budget: 100,   expected: 80,   hasReserve: true },
  { budget: 50,    expected: 40,   hasReserve: true },
  { budget: 20,    expected: 15,   hasReserve: true },
  { budget: 10,    expected: 8,    hasReserve: true },
  { budget: 5,     expected: 3,    hasReserve: true },
  { budget: 1,     expected: 1,    hasReserve: false }
];

for (const { budget, expected, hasReserve } of BUDGET_CASES) {
  test(`1. Deadline calculation: ${budget}ms budget -> effective deadline ${expected}ms`, () => {
    const deadline = calculateEffectiveDeadline(8000, budget);
    assert.equal(deadline, expected);
    assert.ok(deadline <= budget, `Effective deadline (${deadline}ms) must NEVER exceed budget (${budget}ms)`);
    if (hasReserve) {
      assert.ok(deadline < budget, `Must preserve synthesis reserve for ${budget}ms budget`);
    }
  });
}

test('1.13 Boundary inputs (undefined, null, 0, negative, NaN, non-numeric)', () => {
  assert.equal(calculateEffectiveDeadline(8000, undefined), 8000);
  assert.equal(calculateEffectiveDeadline(8000, null), 8000);
  assert.equal(calculateEffectiveDeadline(8000, 0), 8000);
  assert.equal(calculateEffectiveDeadline(8000, -100), 8000);
  assert.equal(calculateEffectiveDeadline(8000, NaN), 8000);
  assert.equal(calculateEffectiveDeadline(8000, 'invalid'), 8000);
});

test('1.14 Sub-25ms budget (10ms) returns structured incomplete result immediately', async () => {
  let queryAttempted = false;
  const mockDb = {
    isPostgres: true,
    all: async () => {
      queryAttempted = true;
      return [];
    }
  };

  const start = Date.now();
  const res = await universalSearch(mockDb, USER, {
    query: 'examination schedule',
    callerTimeoutMs: 10
  });
  const elapsed = Date.now() - start;

  assert.equal(queryAttempted, false, 'Must not dispatch futile DB queries for sub-25ms budget');
  assert.ok(elapsed < 60, `Execution (${elapsed}ms) must return within caller budget (10ms) with execution overhead`);
  assert.equal(res.metadata.deadlineExceeded, true, 'metadata.deadlineExceeded must be true');
  assert.equal(res.metadata.isComplete, false, 'metadata.isComplete must be false');
  assert.equal(res.results.length, 0, 'Must return 0 records on budget timeout');
  assert.ok(res.metadata.sourcesFailed.length > 0, 'Active sources must be listed in sourcesFailed');
  assert.equal(res.metadata.overallDeadlineMs, 8);
});

test('1.15 Sub-25ms budget (1ms) returns structured incomplete result within 20ms', async () => {
  const mockDb = { isPostgres: true, all: async () => [] };
  const start = Date.now();
  const res = await universalSearch(mockDb, USER, {
    query: 'Chapter 5 PHP notes',
    callerTimeoutMs: 1
  });
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 20, `Execution (${elapsed}ms) must return nearly instantaneously`);
  assert.equal(res.metadata.deadlineExceeded, true);
  assert.equal(res.metadata.isComplete, false);
  assert.equal(res.results.length, 0);
  assert.equal(res.metadata.overallDeadlineMs, 1);
});

// ============================================================================
// 2. SCOPE-CLASSIFIER TOTAL TIMEOUT ACROSS PROVIDER FALLBACK PATH
// ============================================================================

test('2.1 Scope Classifier — Primary provider success completes quickly', async () => {
  const mockFetch = async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return makeGeminiSSEResponse('{"in_scope": true, "category": "university", "reason": "campus_inquiry"}');
    }
    return makeOpenAISSEResponse('{"in_scope": true, "category": "university", "reason": "campus_inquiry"}');
  };

  const provider = createChatProvider({
    fetchImpl: mockFetch,
    env: { GEMINI_API_KEY: 'mock_key', GROQ_API_KEY: 'mock_key' }
  });

  const start = Date.now();
  const reply = await provider.generateReply({
    message: 'When do classes resume?',
    timeoutMs: 4000
  });
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 500, `Primary success should be fast (took ${elapsed}ms)`);
  assert.equal(reply.fallbackUsed, false);
  assert.ok(reply.reply.includes('campus_inquiry'));
});

test('2.2 Scope Classifier — Primary timeout (2.6s) triggers fallback (Groq) with remaining budget (~1.4s) and succeeds', async () => {
  let primaryAttempted = false;
  let secondaryAttempted = false;

  const mockFetch = async (url, opts) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      primaryAttempted = true;
      // Primary hangs until aborted
      return new Promise((_, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }

    if (url.includes('groq.com')) {
      secondaryAttempted = true;
      return makeOpenAISSEResponse('{"in_scope": false, "category": "out_of_scope", "reason": "baking_cake"}');
    }

    throw new Error('Unexpected URL: ' + url);
  };

  const provider = createChatProvider({
    fetchImpl: mockFetch,
    env: { GEMINI_API_KEY: 'mock_key', GROQ_API_KEY: 'mock_key' }
  });

  const start = Date.now();
  const reply = await provider.generateReply({
    message: 'How to bake a chocolate cake?',
    timeoutMs: 4000
  });
  const elapsed = Date.now() - start;

  assert.equal(primaryAttempted, true);
  assert.equal(secondaryAttempted, true);
  assert.equal(reply.fallbackUsed, true);
  // Expected duration: ~2600ms (primary attempt cap) + instant secondary response
  assert.ok(elapsed >= 2500, `Must have waited for primary attempt (~2600ms, took ${elapsed}ms)`);
  assert.ok(elapsed < 3500, `Fallback must complete well within the 4000ms total budget (took ${elapsed}ms)`);
  assert.ok(reply.reply.includes('baking_cake'));
});

test('2.3 Scope Classifier — Primary timeout + Fallback timeout is strictly capped at total budget (4000ms)', async () => {
  let primaryAttempted = false;
  let secondaryAttempted = false;

  const mockFetch = async (url, opts) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      primaryAttempted = true;
    } else if (url.includes('groq.com')) {
      secondaryAttempted = true;
    }
    // Both providers hang until aborted
    return new Promise((_, reject) => {
      opts.signal?.addEventListener('abort', () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  const provider = createChatProvider({
    fetchImpl: mockFetch,
    env: { GEMINI_API_KEY: 'mock_key', GROQ_API_KEY: 'mock_key' }
  });

  const start = Date.now();
  try {
    await provider.generateReply({
      message: 'Random prompt',
      timeoutMs: 4000
    });
    assert.fail('Should have failed when all providers timed out');
  } catch (err) {
    const elapsed = Date.now() - start;
    assert.equal(primaryAttempted, true);
    assert.equal(secondaryAttempted, true);
    assert.ok(elapsed >= 3800 && elapsed <= 4300, `Total elapsed time (${elapsed}ms) must be capped near total budget of 4000ms`);
  }
});

test('2.4 Scope Classifier — Both providers failing triggers safe closed refusal', async () => {
  const mockFetch = async () => {
    throw new Error('Provider internal server error 500');
  };

  const provider = createChatProvider({
    fetchImpl: mockFetch,
    env: { GEMINI_API_KEY: 'mock_key', GROQ_API_KEY: 'mock_key' }
  });

  const decision = await isOutOfScopeRequest('Tell me about stock investments', [], USER, {
    classifyFn: async ({ message, systemPrompt }) => {
      const res = await provider.generateReply({ message, systemPrompt, timeoutMs: 2000 });
      return res.reply;
    }
  });

  assert.equal(decision.outOfScope, true, 'Must fail closed on complete provider outage');
  assert.equal(decision.category, 'out_of_scope');
  assert.equal(decision.reason, 'classifier_error_fail_closed');
});

// ============================================================================
// 3. LEGACY SEARCH_POSTS AND SEARCH_NOTICES FAILURE PATHS
// ============================================================================

test('3.1 Successful search_posts returns correct structure without error metadata', async () => {
  const mockDb = {
    isPostgres: true,
    all: async (sql) => {
      if (/FROM posts/i.test(sql)) {
        return [{
          id: 11,
          user_id: USER.studentId,
          content: 'Campus post content',
          type: 'post',
          created_at: '2026-11-09T00:00:00Z',
          author_name: 'Newton Sir',
          author_role: 'teacher'
        }];
      }
      return [];
    }
  };

  const toolkit = createTools(mockDb, { query: 'post', filters: {} }, { academicContext: USER });
  const result = await toolkit.executeTool('search_posts', { query: 'post' });

  assert.ok(Array.isArray(result.posts));
  assert.equal(result.count, 1);
  assert.equal(result.failed, undefined);
  assert.equal(result.error, undefined);
});

test('3.2 Failed search_posts propagates failed: true and sanitized error', async () => {
  const brokenDb = {
    isPostgres: true,
    all: async () => {
      throw new Error('FATAL: password authentication failed for user "admin" on host pg-master.neon.tech:5432 with SELECT * FROM posts');
    }
  };

  const toolkit = createTools(brokenDb, { query: 'post', filters: {} }, { academicContext: USER });
  const result = await toolkit.executeTool('search_posts', { query: 'post' });

  assert.equal(result.failed, true, 'Must flag failed: true');
  assert.equal(result.count, 0);
  assert.ok(Array.isArray(result.posts), 'Must retain array return');
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
  // Verify credentials, hosts, and SQL are never exposed
  assert.ok(!result.error.includes('password'));
  assert.ok(!result.error.includes('pg-master.neon.tech'));
  assert.ok(!result.error.includes('SELECT * FROM'));
});

test('3.3 Successful search_notices returns correct structure without error metadata', async () => {
  const mockDb = {
    isPostgres: true,
    all: async (sql) => {
      if (/FROM posts/i.test(sql)) {
        return [{
          id: 22,
          user_id: USER.studentId,
          title: 'Official Holiday Notice',
          content: 'University closed tomorrow',
          type: 'notice',
          category: 'notice',
          created_at: '2026-11-09T00:00:00Z',
          author_name: 'Campus Admin',
          author_role: 'admin'
        }];
      }
      return [];
    }
  };

  const toolkit = createTools(mockDb, { query: 'holiday', filters: {} }, { academicContext: USER });
  const result = await toolkit.executeTool('search_notices', { query: 'holiday' });

  assert.ok(Array.isArray(result.notices));
  assert.equal(result.count, 1);
  assert.equal(result.failed, undefined);
  assert.equal(result.error, undefined);
});

test('3.4 Failed search_notices propagates failed: true and sanitized error', async () => {
  const brokenDb = {
    isPostgres: true,
    all: async () => {
      throw new Error('Connection pool closed: postgresql://admin:secretPass@pg-pooler.internal:6543/db');
    }
  };

  const toolkit = createTools(brokenDb, { query: 'holiday', filters: {} }, { academicContext: USER });
  const result = await toolkit.executeTool('search_notices', { query: 'holiday' });

  assert.equal(result.failed, true, 'Must flag failed: true');
  assert.equal(result.count, 0);
  assert.ok(Array.isArray(result.notices), 'Must retain array return');
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
  assert.ok(!result.error.includes('secretPass'));
  assert.ok(!result.error.includes('pg-pooler.internal'));
  assert.ok(!result.error.includes('postgresql://'));
});

// ============================================================================
// 4. INTEGRATION LIFECYCLE: AGENT ENGINE TO UNIVERSAL RETRIEVAL
// ============================================================================

test('4.1 Integration — Universal retrieval bounded by agent engine remaining budget', async () => {
  const slowDb = {
    isPostgres: true,
    all: async (sql) => {
      if (/FROM posts/i.test(sql)) {
        await new Promise(r => setTimeout(r, 600));
        return [];
      }
      return [];
    }
  };

  const start = Date.now();
  // Simulate agent engine calling universalSearch with 500ms remaining budget
  const res = await universalSearch(slowDb, USER, {
    query: 'Newton sir post',
    callerTimeoutMs: 500
  });
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 650, `Retrieval (${elapsed}ms) must be constrained by callerTimeoutMs (500ms)`);
  assert.equal(res.metadata.deadlineExceeded, true);
  assert.equal(res.metadata.isComplete, false);
  assert.ok(res.metadata.sourcesFailed.includes('posts'));
});
