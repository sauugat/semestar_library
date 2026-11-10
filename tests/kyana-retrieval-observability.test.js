'use strict';

/**
 * KYANA STEP 4.2 — RETRIEVAL FAILURE OBSERVABILITY & PRODUCTION READINESS TEST SUITE
 * =================================================================================
 * Verifies that:
 *  1. searchPosts() database failure propagates failure when throwOnError: true,
 *     and returns an empty fallback with .failed = true for legacy callers without throwing.
 *  2. searchAssignments() database failure behaves similarly.
 *  3. searchAuthorizedNotes() database failure behaves similarly.
 *  4. One failed source with other successful sources preserves successful records
 *     and correctly populates metadata.sourcesFailed and metadata.isComplete = false.
 *  5. All three failing simultaneously are captured in sourcesFailed without crashing.
 *  6. Genuine zero-result search reports isComplete: true and sourcesFailed: [].
 *  7. Timeout and rejection handling cleanly populates sourcesFailed and isComplete = false.
 *  8. Existing callers without throwOnError still receive an Array (length === 0) without exceptions.
 *  9. A failed source is NEVER reported as a clean empty search.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  searchPosts,
  searchNotices,
  searchAssignments,
  searchAuthorizedNotes,
  sanitizeSourceErrorMessage,
  asStructuredSearchResult
} = require('../lib/ai-search-tools');
const {
  universalSearch,
  determineActiveSources,
  ALL_RETRIEVAL_SOURCES
} = require('../lib/kyana-universal-retrieval');
const { formatToolResult } = require('../lib/chat-tools');

const USER = {
  studentId: 'c808f9d6-1a5e-4ba9-bbf8-bb97a7a40cb2',
  semester: 3,
  department: 'BIT',
  role: 'student',
  authenticated: true
};

const brokenDb = {
  isPostgres: true,
  all: async () => { throw new Error('Postgres connection pool exhausted'); },
  get: async () => { throw new Error('Postgres connection pool exhausted'); },
  query: async () => { throw new Error('Postgres connection pool exhausted'); }
};

const workingEmptyDb = {
  isPostgres: true,
  all: async () => [],
  get: async () => null,
  query: async () => ({ rows: [] })
};

test('1. searchPosts() database failure: legacy callers get safe empty array, universal callers get error/failure metadata', async () => {
  // Legacy caller (no throwOnError)
  const legacyRes = await searchPosts(brokenDb, USER, { query: 'holiday' });
  assert.ok(Array.isArray(legacyRes), 'Must return an array for legacy callers');
  assert.equal(legacyRes.length, 0, 'Legacy array must be empty');
  assert.equal(legacyRes.failed, true, 'Result object must be flagged with failed = true');
  assert.ok(legacyRes.error && !legacyRes.error.includes('pool exhausted'), 'Error must be sanitized');

  // Caller with throwOnError: true
  await assert.rejects(
    async () => searchPosts(brokenDb, USER, { query: 'holiday', throwOnError: true }),
    (err) => {
      assert.equal(err.source, 'posts');
      assert.ok(!err.message.includes('pool exhausted'), 'Sanitized error must not expose raw DB messages');
      return true;
    }
  );
});

test('2. searchAssignments() database failure: legacy callers get safe array, universal callers get error', async () => {
  // Legacy caller
  const legacyRes = await searchAssignments(brokenDb, USER, { query: 'dsa' });
  assert.ok(Array.isArray(legacyRes), 'Must return an array for legacy callers');
  assert.equal(legacyRes.length, 0, 'Legacy array must be empty');
  assert.equal(legacyRes.failed, true, 'Result object must be flagged with failed = true');

  // Caller with throwOnError: true
  await assert.rejects(
    async () => searchAssignments(brokenDb, USER, { query: 'dsa', throwOnError: true }),
    (err) => {
      assert.equal(err.source, 'assignments');
      assert.ok(!err.message.includes('pool exhausted'), 'Sanitized error must not expose raw DB messages');
      return true;
    }
  );
});

test('3. searchAuthorizedNotes() database failure: legacy callers get safe array, universal callers get error', async () => {
  // Legacy caller
  const legacyRes = await searchAuthorizedNotes(brokenDb, USER, { query: 'dbms' });
  assert.ok(Array.isArray(legacyRes), 'Must return an array for legacy callers');
  assert.equal(legacyRes.length, 0, 'Legacy array must be empty');
  assert.equal(legacyRes.failed, true, 'Result object must be flagged with failed = true');

  // Caller with throwOnError: true
  await assert.rejects(
    async () => searchAuthorizedNotes(brokenDb, USER, { query: 'dbms', throwOnError: true }),
    (err) => {
      assert.equal(err.source, 'notes');
      assert.ok(!err.message.includes('pool exhausted'), 'Sanitized error must not expose raw DB messages');
      return true;
    }
  );
});

test('4. One failed source with other successful sources: preserves records and populates sourcesFailed', async () => {
  // DB where assignments fails, but posts and syllabus succeed
  const partialDb = {
    isPostgres: true,
    all: async (sql, ...args) => {
      if (typeof sql === 'string' && sql.includes('FROM assignments')) {
        throw new Error('Relation assignments is undergoing exclusive maintenance');
      }
      if (typeof sql === 'string' && sql.includes('FROM posts')) {
        return [{
          id: 201,
          title: 'Resumption of Regular Classes',
          content: 'Classes resume next week.',
          author_name: 'newton',
          category: 'notice',
          created_at: '2026-11-05T00:00:00.000Z'
        }];
      }
      return [];
    },
    get: async () => null,
    query: async () => ({ rows: [] })
  };

  const res = await universalSearch(partialDb, USER, { query: 'classes' });
  assert.equal(res.metadata.isComplete, false, 'isComplete must be false when assignments fails');
  assert.ok(res.metadata.sourcesFailed.includes('assignments'), 'sourcesFailed must list assignments');
  assert.ok(!res.metadata.sourcesFailed.includes('posts'), 'sourcesFailed must not list posts');
  assert.ok(res.results.length > 0, 'Must preserve successful notice/post records');

  const formatted = formatToolResult('universal_search', res);
  assert.match(formatted, /Resumption of Regular Classes/, 'Formatted reply must present retrieved records');
  assert.match(formatted, /assignments/, 'Formatted reply must disclose that assignments could not be reached');
});

test('5. All three failing simultaneously: captured in sourcesFailed without crashing', async () => {
  const threeFailingDb = {
    isPostgres: true,
    all: async (sql) => {
      if (typeof sql === 'string' && (sql.includes('FROM posts') || sql.includes('FROM assignments') || sql.includes('FROM files'))) {
        throw new Error('Cluster I/O timeout');
      }
      return [];
    },
    get: async () => null,
    query: async () => ({ rows: [] })
  };

  const res = await universalSearch(threeFailingDb, USER, { query: 'algorithm' });
  assert.equal(res.metadata.isComplete, false, 'isComplete must be false');
  assert.ok(res.metadata.sourcesFailed.includes('posts'), 'posts must be in sourcesFailed');
  assert.ok(res.metadata.sourcesFailed.includes('assignments'), 'assignments must be in sourcesFailed');
  assert.ok(res.metadata.sourcesFailed.includes('files'), 'files must be in sourcesFailed');

  // Formatted output must clearly communicate partial failure
  const formatted = formatToolResult('universal_search', res);
  assert.match(formatted, /temporary issue|partial/i, 'Must communicate partial failure');
});

test('6. Genuine zero-result search reports isComplete: true and clean empty output', async () => {
  const res = await universalSearch(workingEmptyDb, USER, { query: 'nonexistentqueryxyz987' });
  assert.equal(res.metadata.isComplete, true, 'isComplete must be true for clean search');
  assert.deepEqual(res.metadata.sourcesFailed, [], 'sourcesFailed must be empty');
  assert.equal(res.results.length, 0, 'No records found');

  const formatted = formatToolResult('universal_search', res);
  assert.match(formatted, /No matching academic records found/i, 'Must report clean no-results message');
  assert.ok(!formatted.includes('temporary issue'), 'Must NOT report temporary issue for genuine empty search');
});

test('7. Timeout and rejection handling cleanly populates sourcesFailed and isComplete = false', async () => {
  const hangingDb = {
    isPostgres: true,
    all: async (sql) => {
      if (typeof sql === 'string' && sql.includes('FROM files')) {
        return new Promise((_, reject) => setTimeout(() => reject(new Error('Files timeout after 4000ms')), 50));
      }
      return [];
    },
    get: async () => null,
    query: async () => ({ rows: [] })
  };

  const res = await universalSearch(hangingDb, USER, { query: 'course notes' });
  assert.equal(res.metadata.isComplete, false);
  assert.ok(res.metadata.sourcesFailed.includes('files'));
});

test('8. Existing callers still receive expected result format without throwOnError', async () => {
  const failingDb = {
    isPostgres: true,
    all: async () => { throw new Error('Unchecked crash'); },
    get: async () => null,
    query: async () => ({ rows: [] })
  };

  // Direct callers must not throw
  const p = await searchPosts(failingDb, USER, { query: 'test' });
  const a = await searchAssignments(failingDb, USER, { query: 'test' });
  const n = await searchAuthorizedNotes(failingDb, USER, { query: 'test' });

  assert.ok(Array.isArray(p) && p.length === 0, 'Posts returns empty array');
  assert.ok(Array.isArray(a) && a.length === 0, 'Assignments returns empty array');
  assert.ok(Array.isArray(n) && n.length === 0, 'Notes returns empty array');
});

test('9. A failed source can never be reported as a clean empty search', async () => {
  // If even ONE source fails when searching for an unknown term, it must NOT return clean "No matching academic records found"
  const oneBrokenDb = {
    isPostgres: true,
    all: async (sql) => {
      if (typeof sql === 'string' && sql.includes('FROM routine')) {
        throw new Error('Routine table disk read error');
      }
      return [];
    },
    get: async () => null,
    query: async () => ({ rows: [] })
  };

  const res = await universalSearch(oneBrokenDb, USER, { query: 'nonexistentqueryxyz987' });
  assert.equal(res.metadata.isComplete, false, 'isComplete must be false');
  assert.ok(res.metadata.sourcesFailed.includes('routine'), 'routine must be in sourcesFailed');

  const formatted = formatToolResult('universal_search', res);
  assert.notEqual(
    formatted,
    'No matching academic records found across campus notices, posts, assignments, notes, or routine.',
    'Failed search must NEVER return the clean no-records-found string'
  );
  assert.match(formatted, /routine/);
  assert.match(formatted, /temporary issue|partial/i);
});

test('10. Overall retrieval deadline bounds execution and preserves collected records', async () => {
  const deadlineDb = {
    isPostgres: true,
    all: async (sql) => {
      if (typeof sql === 'string' && sql.includes('FROM posts')) {
        // Fast source completes in 10ms
        await new Promise(r => setTimeout(r, 10));
        return [{
          id: 501,
          title: 'Urgent Examination Guidelines',
          content: 'Exam starts next week.',
          author_name: 'newton',
          category: 'notice',
          created_at: '2026-11-05T00:00:00.000Z'
        }];
      }
      if (typeof sql === 'string' && (sql.includes('FROM files') || sql.includes('FROM routine') || sql.includes('FROM assignments'))) {
        // Slow source hangs for 600ms
        await new Promise(r => setTimeout(r, 600));
        return [];
      }
      return [];
    },
    get: async () => null,
    query: async () => ({ rows: [] })
  };

  const startTime = Date.now();
  const res = await universalSearch(deadlineDb, USER, {
    query: 'examination guidelines',
    overallTimeoutMs: 120
  });
  const duration = Date.now() - startTime;

  assert.ok(duration < 400, `Execution duration (${duration}ms) must be bounded near overallTimeoutMs (120ms)`);
  assert.equal(res.metadata.isComplete, false, 'Search must be marked incomplete when overall deadline is exceeded');
  assert.equal(res.metadata.deadlineExceeded, true, 'metadata.deadlineExceeded must be true');
  assert.ok(res.metadata.sourcesSucceeded.includes('notices') || res.metadata.sourcesSucceeded.includes('posts'), 'Fast source must be preserved');
  assert.ok(res.results.length > 0, 'Results from successful fast source must be present');
  assert.equal(res.results[0].title, 'Urgent Examination Guidelines');
});

test('11. Late-settling query promises do not leak unhandled promise rejections after timeout', async () => {
  let unhandledCaught = null;
  const onUnhandled = (err) => {
    unhandledCaught = err;
  };
  process.on('unhandledRejection', onUnhandled);

  try {
    const hangingDb = {
      isPostgres: true,
      all: async (sql) => {
        if (typeof sql === 'string' && sql.includes('FROM files')) {
          // Promise that rejects well after the source search timeout has elapsed
          return new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('Delayed late database disconnect'));
            }, 120);
          });
        }
        return [];
      },
      get: async () => null,
      query: async () => ({ rows: [] })
    };

    const res = await universalSearch(hangingDb, USER, {
      query: 'course files',
      sourceTimeoutMs: 40,
      overallTimeoutMs: 80
    });

    assert.equal(res.metadata.isComplete, false);
    assert.ok(res.metadata.sourcesFailed.includes('files'));

    // Wait 150ms to ensure the delayed rejection in files executes
    await new Promise(r => setTimeout(r, 150));

    assert.equal(unhandledCaught, null, 'No unhandledRejection must be emitted when query promise settles late');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('12. determineActiveSources() routes specific intents cleanly and falls back broadly', async () => {
  // Routine inquiry
  const routineSources = determineActiveSources({
    normalizedQuery: 'exam routine for semester 3',
    rawQuery: 'exam routine for semester 3',
    isRoutineInquiry: true
  });
  assert.deepEqual(routineSources, ['notices', 'posts', 'routine']);

  // Assignment inquiry
  const assignmentSources = determineActiveSources({
    normalizedQuery: 'dsa assignment deadline',
    rawQuery: 'dsa assignment deadline',
    isSubmissionInquiry: true
  });
  assert.deepEqual(assignmentSources, ['notices', 'posts', 'assignments']);

  // Notes & study materials inquiry
  const notesSources = determineActiveSources({
    normalizedQuery: 'chapter 5 php notes pdf download',
    rawQuery: 'chapter 5 php notes pdf download'
  });
  assert.deepEqual(notesSources, ['notes', 'files', 'syllabus']);

  // Syllabus inquiry
  const syllabusSources = determineActiveSources({
    normalizedQuery: 'unit 2 syllabus curriculum',
    rawQuery: 'unit 2 syllabus curriculum'
  });
  assert.deepEqual(syllabusSources, ['notes', 'files', 'syllabus']);

  // Broad / Ambiguous inquiry: falls back safely to all 7 sources
  const broadSources = determineActiveSources({
    normalizedQuery: 'web technology',
    rawQuery: 'web technology'
  });
  assert.deepEqual(broadSources, ALL_RETRIEVAL_SOURCES);

  // Explicit all-semesters inquiry: falls back safely to all 7 sources
  const allSemSources = determineActiveSources({
    normalizedQuery: 'all available notes across semesters',
    rawQuery: 'all available notes across semesters',
    isAllSemesters: true
  });
  assert.deepEqual(allSemSources, ALL_RETRIEVAL_SOURCES);

  // Explicit caller override
  const overrideSources = determineActiveSources({}, { sources: ['routine', 'syllabus'] });
  assert.deepEqual(overrideSources, ['routine', 'syllabus']);
});

test('13. asStructuredSearchResult() converts arrays, errors, and fallbacks safely with serialization preservation', () => {
  // Case A: Successful array
  const rawArray = [{ id: 1, title: 'Item 1' }, { id: 2, title: 'Item 2' }];
  const structSuccess = asStructuredSearchResult(rawArray);
  assert.equal(structSuccess.ok, true);
  assert.equal(structSuccess.failed, false);
  assert.equal(structSuccess.data.length, 2);

  // Case B: Legacy array with .failed = true
  const legacyFallback = [];
  legacyFallback.failed = true;
  legacyFallback.error = 'Database service unreachable for posts';
  legacyFallback.source = 'posts';

  const structLegacy = asStructuredSearchResult(legacyFallback);
  assert.equal(structLegacy.ok, false);
  assert.equal(structLegacy.failed, true);
  assert.equal(structLegacy.source, 'posts');
  assert.equal(structLegacy.error, 'Database service unreachable for posts');

  // Serialization test: JSON.stringify drops array custom properties, but preserves structLegacy!
  const serialized = JSON.parse(JSON.stringify(structLegacy));
  assert.equal(serialized.failed, true);
  assert.equal(serialized.source, 'posts');
  assert.equal(serialized.error, 'Database service unreachable for posts');

  // Case C: Error object
  const err = new Error('Connection timeout');
  err.source = 'assignments';
  const structErr = asStructuredSearchResult(err);
  assert.equal(structErr.ok, false);
  assert.equal(structErr.failed, true);
  assert.equal(structErr.source, 'assignments');
  assert.match(structErr.error, /assignments.*timed out/i);
});

