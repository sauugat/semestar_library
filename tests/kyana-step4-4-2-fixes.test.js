'use strict';

/**
 * KYANA STEP 4.4.2 — RELIABILITY FIXES VERIFICATION TEST SUITE
 * ============================================================
 * Tests:
 * 1. Fix 1: Caller Budget Enforcement (7 test cases + elapsed time verification)
 * 2. Fix 2: Legacy search_posts Failure Propagation (success vs DB failure)
 * 3. Fix 3: Defense Preparation Retrieval Intent Routing (4 distinct queries)
 * 4. Fix 4: Scope Classifier Provider Timeout & Provider Degradation
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  universalSearch,
  calculateEffectiveDeadline,
  determineActiveSources
} = require('../lib/kyana-universal-retrieval');
const { createTools } = require('../lib/chat-tools');
const { isOutOfScopeRequest } = require('../lib/chat-security');
const { createChatProvider } = require('../lib/chat-provider');
const { handleChat } = require('../ai-assistant');

const USER = {
  studentId: 'c808f9d6-1a5e-4ba9-bbf8-bb97a7a40cb2',
  semester: 3,
  department: 'BIT',
  role: 'student',
  authenticated: true
};

function makeSSEResponse(content) {
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

// ============================================================================
// FIX 1: CALLER BUDGET ENFORCEMENT
// ============================================================================

test('Fix 1.1 — calculateEffectiveDeadline with 10,000 ms caller budget', () => {
  const deadline = calculateEffectiveDeadline(8000, 10000);
  assert.equal(deadline, 7500); // 10,000 - 2,500 reserve = 7,500 <= 8,000
  assert.ok(deadline < 10000, 'Retrieval deadline must be strictly less than caller budget');
});

test('Fix 1.2 — calculateEffectiveDeadline with 4,000 ms caller budget', () => {
  const deadline = calculateEffectiveDeadline(8000, 4000);
  assert.equal(deadline, 3000); // 4,000 - 1,000 reserve = 3,000
  assert.ok(deadline < 4000, 'Must constrain to caller budget minus reserve');
});

test('Fix 1.3 — calculateEffectiveDeadline with 2,000 ms caller budget', () => {
  const deadline = calculateEffectiveDeadline(8000, 2000);
  assert.equal(deadline, 1500); // 2,000 - 500 reserve = 1,500
  assert.ok(deadline < 2000, 'Must constrain to caller budget minus reserve');
});

test('Fix 1.4 — calculateEffectiveDeadline with 1,000 ms caller budget', () => {
  const deadline = calculateEffectiveDeadline(8000, 1000);
  assert.equal(deadline, 750); // 1,000 - 250 reserve = 750
  assert.ok(deadline < 1000, 'Must constrain to caller budget minus reserve');
});

test('Fix 1.5 — calculateEffectiveDeadline with 300 ms caller budget (< 500ms safe floor)', () => {
  const deadline = calculateEffectiveDeadline(8000, 300);
  assert.equal(deadline, 250); // 300 - 50 reserve = 250
  assert.ok(deadline < 300, 'Must constrain to caller budget minus reserve');
  assert.ok(deadline >= 50, 'Must remain a safe runnable floor');
});

test('Fix 1.6 — calculateEffectiveDeadline with undefined caller budget', () => {
  const deadline = calculateEffectiveDeadline(8000, undefined);
  assert.equal(deadline, 8000, 'Should fall back to configured default deadline');
});

test('Fix 1.7 — calculateEffectiveDeadline with invalid caller budgets (null, 0, negative, NaN, non-numeric)', () => {
  assert.equal(calculateEffectiveDeadline(8000, null), 8000);
  assert.equal(calculateEffectiveDeadline(8000, 0), 8000);
  assert.equal(calculateEffectiveDeadline(8000, -500), 8000);
  assert.equal(calculateEffectiveDeadline(8000, NaN), 8000);
  assert.equal(calculateEffectiveDeadline(8000, 'not-a-number'), 8000);
  assert.equal(calculateEffectiveDeadline(8000, {}), 8000);
});

test('Fix 1.8 — Actual elapsed retrieval time is strictly constrained by callerTimeoutMs (300 ms)', async () => {
  // Mock DB where any query sleeps for 1000ms
  const slowDb = {
    isPostgres: true,
    all: async () => {
      await new Promise(r => setTimeout(r, 1000));
      return [];
    }
  };

  const start = Date.now();
  const res = await universalSearch(slowDb, USER, {
    query: 'Chapter 5 PHP notes',
    callerTimeoutMs: 300
  });
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 450, `Actual elapsed time (${elapsed}ms) must not exceed caller budget (300ms) with overhead`);
  assert.ok(res.metadata.sourcesFailed.length > 0 || res.metadata.deadlineExceeded, 'Should record timeout/deadline exceeded');
  assert.equal(res.metadata.isComplete, false, 'isComplete must be false when deadline exceeded');
});

test('Fix 1.9 — Actual elapsed retrieval time is strictly constrained by callerTimeoutMs (600 ms)', async () => {
  const slowDb = {
    isPostgres: true,
    all: async () => {
      await new Promise(r => setTimeout(r, 1200));
      return [];
    }
  };

  const start = Date.now();
  const res = await universalSearch(slowDb, USER, {
    query: 'DSA assignment',
    callerTimeoutMs: 600
  });
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 750, `Actual elapsed time (${elapsed}ms) must not exceed caller budget (600ms) with overhead`);
  assert.ok(res.metadata.sourcesFailed.length > 0 || res.metadata.deadlineExceeded);
});

// ============================================================================
// FIX 2: LEGACY SEARCH_POSTS FAILURE PROPAGATION
// ============================================================================

test('Fix 2.1 — search_posts tool returns clean array on successful search', async () => {
  const mockDb = {
    isPostgres: true,
    all: async (sql) => {
      if (/FROM posts/i.test(sql)) {
        return [
          {
            id: 101,
            user_id: USER.studentId,
            content: 'Project submission reminder',
            type: 'post',
            created_at: '2026-11-09T10:00:00Z',
            author_name: 'Sir Newton',
            author_role: 'teacher'
          }
        ];
      }
      return [];
    }
  };

  const toolkit = createTools(mockDb, { query: 'submission', filters: {} }, { academicContext: USER });
  const result = await toolkit.executeTool(
    'search_posts',
    { query: 'submission' },
    {
      userMessage: 'Search posts',
      round: 0
    }
  );

  assert.ok(Array.isArray(result.posts), 'result.posts must be an array');
  assert.equal(result.failed, undefined, 'Successful search must not set failed: true');
  assert.equal(result.error, undefined, 'Successful search must not set error');
  assert.equal(result.count, 1);
});

test('Fix 2.2 — search_posts tool detects posts.failed and propagates failure without zero-result masking', async () => {
  const brokenDb = {
    isPostgres: true,
    all: async () => {
      throw new Error('Connection reset by peer (server pg-01.internal:5432 with credentials ***)');
    }
  };

  const toolkit = createTools(brokenDb, { query: 'any post query', filters: {} }, { academicContext: USER });
  const result = await toolkit.executeTool(
    'search_posts',
    { query: 'any post query' },
    {
      userMessage: 'Show posts',
      round: 0
    }
  );

  assert.equal(result.failed, true, 'Failed search must set failed: true');
  assert.ok(typeof result.error === 'string' && result.error.length > 0, 'Must include sanitized error message');
  assert.ok(!/pg-01\.internal|5432|credentials/i.test(result.error), 'Must not expose server host or credentials');
  assert.ok(Array.isArray(result.posts), 'Must retain array posts property for backward compatibility');
  assert.equal(result.count, 0);
});

// ============================================================================
// FIX 3: DEFENSE PREPARATION RETRIEVAL INTENT ROUTING
// ============================================================================

test('Fix 3.1 — "When is our project defense?" stays targeted and does NOT query files/notes', () => {
  const sources = determineActiveSources({
    normalizedQuery: 'when is our project defense',
    rawQuery: 'When is our project defense?'
  });

  assert.ok(sources.includes('notices'), 'Must query notices');
  assert.ok(sources.includes('posts'), 'Must query posts');
  assert.ok(sources.includes('routine'), 'Must query routine');
  assert.ok(!sources.includes('files'), 'Ordinary defense date query must NOT query files');
  assert.ok(!sources.includes('notes'), 'Ordinary defense date query must NOT query notes');
  assert.equal(sources.length, 3, 'Must remain a targeted 3-source search for date inquiry');
});

test('Fix 3.2 — "What should I prepare for my defense?" includes files and notes', () => {
  const sources = determineActiveSources({
    normalizedQuery: 'what should i prepare for my defense',
    rawQuery: 'What should I prepare for my defense?'
  });

  assert.ok(sources.includes('files'), 'Defense preparation query must include files');
  assert.ok(sources.includes('notes'), 'Defense preparation query must include notes');
  assert.ok(sources.includes('notices'), 'Defense preparation query must include notices');
  assert.ok(sources.includes('posts'), 'Defense preparation query must include posts');
});

test('Fix 3.3 — "Where is the project defense template?" includes files and notes', () => {
  const sources = determineActiveSources({
    normalizedQuery: 'where is the project defense template',
    rawQuery: 'Where is the project defense template?'
  });

  assert.ok(sources.includes('files'), 'Defense template query must include files');
  assert.ok(sources.includes('notes'), 'Defense template query must include notes');
  assert.ok(sources.includes('notices'), 'Defense template query must include notices');
});

test('Fix 3.4 — "What are the presentation guidelines?" includes files and notes', () => {
  const sources = determineActiveSources({
    normalizedQuery: 'what are the presentation guidelines',
    rawQuery: 'What are the presentation guidelines?'
  });

  assert.ok(sources.includes('files'), 'Presentation guidelines query must include files');
  assert.ok(sources.includes('notes'), 'Presentation guidelines query must include notes');
});

// ============================================================================
// FIX 4: SCOPE CLASSIFIER PROVIDER TIMEOUT & FALLBACK
// ============================================================================

test('Fix 4.1 — generateReply respects dedicated timeoutMs parameter', async () => {
  const mockFetch = async (url, opts) => {
    return new Promise((resolve, reject) => {
      opts.signal?.addEventListener('abort', () => {
        const err = new Error('The AI request timed out.');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  const provider = createChatProvider({
    fetchImpl: mockFetch,
    env: {
      CHAT_TIMEOUT_MS: '15000',
      GROQ_API_KEY: 'gsk_mock_key',
      CHAT_PROVIDER: 'groq'
    }
  });

  const start = Date.now();
  try {
    await provider.generateReply({
      message: 'test message',
      timeoutMs: 400
    });
    assert.fail('Should have timed out');
  } catch (err) {
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 600, `generateReply should time out around 400ms (took ${elapsed}ms)`);
    assert.equal(err.code, 'PROVIDER_TIMEOUT');
  }
});

test('Fix 4.2 — Primary provider timeout triggers secondary provider fallback within short scope timeout', async () => {
  let primaryCalled = false;
  let secondaryCalled = false;

  const mockFetch = async (url, opts) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      primaryCalled = true;
      // Hang until aborted
      return new Promise((_, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }

    if (url.includes('groq.com')) {
      secondaryCalled = true;
      return makeSSEResponse('{"in_scope": false, "category": "out_of_scope", "reason": "cooking_recipe"}');
    }

    throw new Error('Unknown URL: ' + url);
  };

  const provider = createChatProvider({
    fetchImpl: mockFetch,
    env: {
      CHAT_TIMEOUT_MS: '15000',
      GEMINI_API_KEY: 'gemini_test_key',
      GROQ_API_KEY: 'groq_test_key'
    }
  });

  const start = Date.now();
  const reply = await provider.generateReply({
    message: 'How to bake a chocolate cake?',
    timeoutMs: 350
  });
  const elapsed = Date.now() - start;

  assert.equal(primaryCalled, true, 'Primary provider (Gemini) must have been attempted');
  assert.equal(secondaryCalled, true, 'Secondary provider (Groq) must have taken over after primary timeout');
  assert.ok(reply.fallbackUsed, 'Should record fallbackUsed: true');
  assert.ok(elapsed < 900, `Fallback should complete quickly (~350ms primary timeout + instant Groq response). Elapsed: ${elapsed}ms`);
  assert.ok(reply.reply.includes('cooking_recipe'));
});

test('Fix 4.3 — Both providers failing triggers safe closed refusal', async () => {
  const failingClassifier = async () => {
    throw new Error('All AI providers offline');
  };

  const decision = await isOutOfScopeRequest('Tell me a bedtime story', [], USER, {
    classifyFn: failingClassifier
  });

  assert.equal(decision.outOfScope, true, 'Must fail closed on complete provider outage');
  assert.equal(decision.category, 'out_of_scope');
  assert.equal(decision.reason, 'classifier_error_fail_closed');
});

test('Fix 4.4 — Academic questions remain in scope even during complete provider degradation', async () => {
  const failingClassifier = async () => {
    throw new Error('LLM providers completely dead');
  };

  // Test 1: BIT Syllabus topic
  const dec1 = await isOutOfScopeRequest('What is a binary search tree?', [], USER, {
    classifyFn: failingClassifier
  });
  assert.equal(dec1.outOfScope, false, 'BIT syllabus topic must be allowed deterministically');
  assert.equal(dec1.usedLlm, false, 'Must not rely on LLM for syllabus topics');

  // Test 2: Platform topic
  const dec2 = await isOutOfScopeRequest('Where can I see the exam routine?', [], USER, {
    classifyFn: failingClassifier
  });
  assert.equal(dec2.outOfScope, false, 'Platform routine query must be allowed deterministically');
  assert.equal(dec2.usedLlm, false, 'Must not rely on LLM for platform context');
});
