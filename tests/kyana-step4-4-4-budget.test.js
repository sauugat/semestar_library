/**
 * Kyana Step 4.4.4 — Agent Budget Propagation Correction Test Suite
 *
 * Validates:
 * 1. Strict remaining-budget propagation from agent engine into universal_search:
 *    - Never increases remaining turn budget.
 *    - Never passes a 500ms minimum when less time remains.
 *    - 300ms remaining budget produces an effective deadline <= 250ms (never 500ms).
 *    - 0ms or negative remaining budget halts immediately without executing DB queries.
 *    - Sub-25ms budget (10ms) fast-returns structured incomplete/deadline-exceeded metadata without DB queries.
 *    - Preserves successfully retrieved records when retrieval completes within budget.
 *    - Never mistakes an incomplete/deadline-exceeded search for a complete empty result.
 * 2. Timeout Chain Verification across 10000ms, 1000ms, 500ms, 300ms, 100ms, 10ms, 0ms.
 * 3. Four explicit separate legacy search tests:
 *    - Successful search_posts
 *    - Failed search_posts (propagates failed: true, sanitized error, no zero-result masking)
 *    - Successful search_notices
 *    - Failed search_notices (propagates failed: true, sanitized error, no zero-result masking)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createAgentToolRegistry,
  runKyanaAgentLoop,
  synthesizeVerifiedAgentResponse
} = require('../lib/kyana-agent-engine');

const {
  universalSearch,
  calculateEffectiveDeadline
} = require('../lib/kyana-universal-retrieval');

const { createTools } = require('../lib/chat-tools');
const aiSearch = require('../lib/ai-search-tools');

const USER = {
  id: 1,
  studentId: '2024-BIT-001',
  role: 'student',
  semester: 6,
  cohortId: 'bit-2024',
  authenticated: true
};

// ============================================================================
// 1. TIMEOUT CHAIN VERIFICATION ACROSS THE 7 TARGET BUDGETS
// ============================================================================

const CHAIN_TEST_CASES = [
  { inputBudget: 10000, expectedEffectiveMax: 7500, expectDbQuery: true },
  { inputBudget: 1000,  expectedEffectiveMax: 750,  expectDbQuery: true },
  { inputBudget: 500,   expectedEffectiveMax: 400,  expectDbQuery: true },
  { inputBudget: 300,   expectedEffectiveMax: 250,  expectDbQuery: true }, // Crucial: must NOT be 500ms!
  { inputBudget: 100,   expectedEffectiveMax: 80,   expectDbQuery: true },
  { inputBudget: 10,    expectedEffectiveMax: 8,    expectDbQuery: false }, // Sub-25ms fast return
  { inputBudget: 0,     expectedEffectiveMax: 0,    expectDbQuery: false }  // Zero budget fast return
];

for (const tc of CHAIN_TEST_CASES) {
  test(`Chain verification: ${tc.inputBudget}ms budget -> effective <= ${tc.expectedEffectiveMax}ms (dbQuery: ${tc.expectDbQuery})`, async () => {
    let dbQueryStarted = false;
    const trackedDb = {
      isPostgres: true,
      all: async () => {
        dbQueryStarted = true;
        return [];
      },
      get: async () => null,
      query: async () => ({ rows: [] })
    };

    const registry = createAgentToolRegistry(trackedDb, USER, {
      message: 'Newton sir notice',
      timeoutMs: tc.inputBudget,
      startTimeMs: Date.now()
    });

    const start = Date.now();
    const res = await registry.executeTool('universal_search', { query: 'Newton sir notice' }, {
      remainingBudgetMs: tc.inputBudget
    });
    const elapsed = Date.now() - start;

    assert.equal(
      dbQueryStarted,
      tc.expectDbQuery,
      `For ${tc.inputBudget}ms budget, dbQueryStarted (${dbQueryStarted}) must match expected (${tc.expectDbQuery})`
    );

    assert.ok(
      (res.metadata.overallDeadlineMs || 0) <= tc.expectedEffectiveMax,
      `Effective deadline (${res.metadata.overallDeadlineMs}ms) must not exceed expected max (${tc.expectedEffectiveMax}ms)`
    );

    if (tc.inputBudget === 300) {
      assert.ok(
        res.metadata.overallDeadlineMs <= 250,
        `CRITICAL: 300ms budget must not be inflated to 500ms (got ${res.metadata.overallDeadlineMs}ms)`
      );
    }

    if (tc.inputBudget <= 10) {
      assert.equal(res.metadata.deadlineExceeded, true);
      assert.equal(res.metadata.isComplete, false);
      assert.equal(res.results.length, 0);
    }

    // Must never overrun the caller's budget by more than reasonable event loop overhead (60ms)
    assert.ok(
      elapsed <= Math.max(80, tc.inputBudget + 80),
      `Elapsed (${elapsed}ms) must be constrained by input budget (${tc.inputBudget}ms)`
    );
  });
}

// ============================================================================
// 2. AGENT ENGINE BUDGET PROPAGATION INVARIANTS
// ============================================================================

test('2.1 Zero remaining budget: does not execute retrieval and returns structured incomplete result', async () => {
  let dbQueried = false;
  const mockDb = {
    isPostgres: true,
    all: async () => {
      dbQueried = true;
      return [];
    }
  };

  const registry = createAgentToolRegistry(mockDb, USER, {
    message: 'test query',
    timeoutMs: 5000,
    startTimeMs: Date.now()
  });

  const res = await registry.executeTool('universal_search', { query: 'test query' }, {
    remainingBudgetMs: 0
  });

  assert.equal(dbQueried, false, 'Must never query DB when remaining budget is 0');
  assert.equal(res.metadata.deadlineExceeded, true);
  assert.equal(res.metadata.isComplete, false);
  assert.equal(res.results.length, 0);
  assert.equal(res.metadata.overallDeadlineMs, 0);
});

test('2.2 Negative remaining budget: does not execute retrieval', async () => {
  let dbQueried = false;
  const mockDb = {
    isPostgres: true,
    all: async () => {
      dbQueried = true;
      return [];
    }
  };

  const registry = createAgentToolRegistry(mockDb, USER, {
    message: 'test query',
    timeoutMs: 5000,
    startTimeMs: Date.now()
  });

  const res = await registry.executeTool('universal_search', { query: 'test query' }, {
    remainingBudgetMs: -50
  });

  assert.equal(dbQueried, false, 'Must never query DB when remaining budget is negative');
  assert.equal(res.metadata.deadlineExceeded, true);
  assert.equal(res.metadata.isComplete, false);
  assert.equal(res.results.length, 0);
});

test('2.3 300ms remaining budget is NOT inflated to 500ms', async () => {
  let observedCallerTimeout = null;
  const interceptDb = {
    isPostgres: true,
    all: async () => []
  };

  const registry = createAgentToolRegistry(interceptDb, USER, {
    message: 'exam routine',
    timeoutMs: 10000,
    startTimeMs: Date.now()
  });

  const res = await registry.executeTool('universal_search', { query: 'exam routine' }, {
    remainingBudgetMs: 300
  });

  assert.ok(
    res.metadata.overallDeadlineMs <= 250,
    `Effective deadline must be <= 250ms for 300ms budget, was ${res.metadata.overallDeadlineMs}ms`
  );
  assert.notEqual(res.metadata.overallDeadlineMs, 500, 'Must not be inflated to 500ms');
});

test('2.4 Preserves successfully retrieved records when genuine retrieval completes within budget', async () => {
  const successDb = {
    isPostgres: true,
    all: async (sql) => {
      if (/FROM posts/i.test(sql)) {
        return [{
          id: 187,
          title: 'Project Defense Schedule',
          content: 'Defense is scheduled for 2083/08/07.',
          type: 'notice',
          category: 'notice',
          created_at: '2026-11-01T10:00:00Z',
          author_name: 'Newton sir',
          author_role: 'teacher',
          target_all_semesters: 1
        }];
      }
      return [];
    }
  };

  const registry = createAgentToolRegistry(successDb, USER, {
    message: 'Project Defense',
    timeoutMs: 4000,
    startTimeMs: Date.now()
  });

  const res = await registry.executeTool('universal_search', { query: 'Project Defense' }, {
    remainingBudgetMs: 3000
  });

  assert.ok(res.results.length > 0, 'Must preserve successfully retrieved records');
  assert.equal(res.metadata.isComplete, true);
  assert.equal(res.metadata.deadlineExceeded, false);
  assert.equal(res.results[0].title, 'Project Defense Schedule');
  assert.equal(registry.collectedState.notices.length, 1);
});

test('2.5 Incomplete search is NOT mistaken for complete empty search in synthesis', () => {
  // Case A: Complete search with zero records -> reports "couldn't find matching records"
  const completeEmptyState = {
    universalResults: [],
    retrievalMetadata: {
      isComplete: true,
      deadlineExceeded: false,
      sourcesFailed: [],
      totalRecordsFound: 0
    },
    notices: [],
    assignments: [],
    routine: [],
    files: [],
    courses: [],
    toolErrors: []
  };

  const replyA = synthesizeVerifiedAgentResponse({
    understanding: { rawMessage: 'find me astronomy notes', intents: [], entities: {} },
    registry: { collectedState: completeEmptyState },
    verification: { authorized: true },
    academicContext: USER,
    referenceDate: new Date()
  });

  assert.match(replyA, /couldn't find matching records/i, 'Complete search reports clean no-records');
  assert.ok(!replyA.includes('deadline was exceeded'));

  // Case B: Incomplete search due to deadline / source failure -> reports incomplete/deadline warning
  const incompleteState = {
    universalResults: [],
    retrievalMetadata: {
      isComplete: false,
      deadlineExceeded: true,
      sourcesFailed: ['posts', 'notices'],
      totalRecordsFound: 0
    },
    notices: [],
    assignments: [],
    routine: [],
    files: [],
    courses: [],
    toolErrors: []
  };

  const replyB = synthesizeVerifiedAgentResponse({
    understanding: { rawMessage: 'find me astronomy notes', intents: [], entities: {} },
    registry: { collectedState: incompleteState },
    verification: { authorized: true },
    academicContext: USER,
    referenceDate: new Date()
  });

  assert.match(replyB, /deadline was exceeded|temporarily unreachable/i, 'Incomplete search reports partial/deadline warning');
  assert.ok(!replyB.includes("couldn't find matching records for that request"), 'Must NOT claim no matching records exist');
});

// ============================================================================
// 3. FOUR EXPLICIT SEPARATE LEGACY SEARCH TESTS
// ============================================================================

test('3.1 Successful search_posts returns correct array without failure metadata', async () => {
  const successDb = {
    isPostgres: true,
    all: async (sql) => {
      if (/FROM posts/i.test(sql)) {
        return [{
          id: 42,
          title: 'Campus coding competition',
          content: 'Registration open until Friday.',
          type: 'status',
          category: 'feed',
          created_at: '2026-11-05T09:00:00Z',
          author_name: 'CR Ram',
          author_role: 'cr',
          target_all_semesters: 1
        }];
      }
      return [];
    }
  };

  const toolkit = createTools(successDb, { query: 'competition', filters: {} }, { academicContext: USER });
  const result = await toolkit.executeTool('search_posts', { query: 'competition' });

  assert.ok(Array.isArray(result.posts), 'Must return posts array');
  assert.equal(result.count, 1);
  assert.equal(result.failed, undefined, 'Successful search must not flag failed');
  assert.equal(result.error, undefined, 'Successful search must not flag error');
  assert.equal(result.posts[0].id, 42);
});

test('3.2 Failed search_posts propagates failed: true, sanitized error, no secret leak, no zero-result masking', async () => {
  const brokenDb = {
    isPostgres: true,
    all: async () => {
      throw new Error('FATAL: password authentication failed for user "admin:SecretKey99!" on host pg-master.neon.tech:5432 with SELECT * FROM posts');
    }
  };

  const toolkit = createTools(brokenDb, { query: 'anything', filters: {} }, { academicContext: USER });
  const result = await toolkit.executeTool('search_posts', { query: 'anything' });

  // 1. Must flag failure explicitly — NEVER misclassify as clean empty search
  assert.equal(result.failed, true, 'Failed search_posts must flag failed: true');
  assert.equal(result.count, 0);
  assert.ok(Array.isArray(result.posts), 'Must retain array return structure');

  // 2. Sanitization must scrub credentials, passwords, hosts, SQL
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
  assert.ok(!result.error.includes('SecretKey99!'), 'Must not expose credentials');
  assert.ok(!result.error.includes('pg-master.neon.tech'), 'Must not expose database host');
  assert.ok(!result.error.includes('SELECT * FROM'), 'Must not expose SQL query');
  assert.ok(!result.error.includes('admin'), 'Must not expose database user');
});

test('3.3 Successful search_notices returns correct array without failure metadata', async () => {
  const successDb = {
    isPostgres: true,
    all: async (sql) => {
      if (/FROM posts/i.test(sql)) {
        return [{
          id: 99,
          title: 'Holiday Notice: Tihar Vacation',
          content: 'University will remain closed from Kartik 28.',
          type: 'notice',
          category: 'notice',
          created_at: '2026-11-02T12:00:00Z',
          author_name: 'Campus Admin',
          author_role: 'admin',
          target_all_semesters: 1
        }];
      }
      return [];
    }
  };

  const toolkit = createTools(successDb, { query: 'holiday', filters: {} }, { academicContext: USER });
  const result = await toolkit.executeTool('search_notices', { query: 'holiday' });

  assert.ok(Array.isArray(result.notices), 'Must return notices array');
  assert.equal(result.count, 1);
  assert.equal(result.failed, undefined, 'Successful search must not flag failed');
  assert.equal(result.error, undefined, 'Successful search must not flag error');
  assert.equal(result.notices[0].id, 99);
});

test('3.4 Failed search_notices propagates failed: true, sanitized error, no secret leak, no zero-result masking', async () => {
  const brokenDb = {
    isPostgres: true,
    all: async () => {
      throw new Error('Connection pool closed: postgresql://db_user:TopSecretPassword123@neon-pooler.internal:6543/library');
    }
  };

  const toolkit = createTools(brokenDb, { query: 'holiday', filters: {} }, { academicContext: USER });
  const result = await toolkit.executeTool('search_notices', { query: 'holiday' });

  // 1. Must flag failure explicitly — NEVER misclassify as clean empty search
  assert.equal(result.failed, true, 'Failed search_notices must flag failed: true');
  assert.equal(result.count, 0);
  assert.ok(Array.isArray(result.notices), 'Must retain array return structure');

  // 2. Sanitization must scrub credentials, passwords, hosts, URLs
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
  assert.ok(!result.error.includes('TopSecretPassword123'), 'Must not expose credentials');
  assert.ok(!result.error.includes('neon-pooler.internal'), 'Must not expose internal pooler host');
  assert.ok(!result.error.includes('postgresql://'), 'Must not expose connection string protocol');
  assert.ok(!result.error.includes('db_user'), 'Must not expose database user');
});

// ============================================================================
// 4. END-TO-END AGENT ENGINE LOOP BUDGET VERIFICATION
// ============================================================================

test('4.1 runKyanaAgentLoop with 300ms budget passes <= 300ms remaining budget to universal_search (not 500ms)', async () => {
  let observedToolMeta = null;
  const mockDb = {
    isPostgres: true,
    all: async () => [],
    get: async () => null,
    query: async () => ({ rows: [] })
  };

  const start = Date.now();
  const res = await runKyanaAgentLoop({
    db: mockDb,
    message: 'Newton sir notice',
    academicContext: USER,
    timeoutMs: 300,
    onBeforeToolCall: (name, args, meta) => {
      if (name === 'universal_search') {
        observedToolMeta = { ...meta };
      }
    }
  });
  const elapsed = Date.now() - start;

  assert.equal(res.handled, true);
  assert.ok(observedToolMeta !== null, 'universal_search must have been called');
  assert.ok(
    observedToolMeta.remainingBudgetMs <= 300,
    `Remaining budget passed to universal_search (${observedToolMeta.remainingBudgetMs}ms) must be <= 300ms`
  );
  assert.ok(
    observedToolMeta.remainingBudgetMs > 0,
    `Remaining budget (${observedToolMeta.remainingBudgetMs}ms) must be positive at start of turn`
  );
  assert.notEqual(
    observedToolMeta.remainingBudgetMs,
    500,
    'Remaining budget must NOT be inflated to 500ms'
  );
  assert.ok(elapsed < 350, `Entire turn (${elapsed}ms) must complete within 300ms budget (+50ms grace)`);
});
