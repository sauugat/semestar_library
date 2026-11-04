'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { handleChat, invalidateCache, clearPaginationState } = require('../ai-assistant');
const { routeQuery, isShowMoreQuery } = require('../lib/chat-tools');
const { createReferenceTrailerStreamFilter, extractReferencedRecords } = require('../lib/chat-grounding');
const { searchNotes } = require('../lib/note-search');
const { searchPosts, searchNotices, searchAssignments } = require('../lib/ai-search-tools');
const { embedText, clearEmbeddingCache, getEmbeddingCacheStats } = require('../lib/knowledge-embeddings');

/**
 * Helper to load `createKyanaSseParser` directly from `mobile/services/kyana.ts`
 * by stripping TypeScript type annotations so we test the actual mobile parser code.
 */
function loadMobileSseParser() {
  const tsPath = path.join(__dirname, '../mobile/services/kyana.ts');
  const rawTs = fs.readFileSync(tsPath, 'utf8');

  const startIdx = rawTs.indexOf('export function createKyanaSseParser');
  const endIdx = rawTs.indexOf('export async function fetchKyanaPreview');
  assert.ok(startIdx >= 0 && endIdx > startIdx, 'createKyanaSseParser must exist in mobile/services/kyana.ts');

  const fnCode = rawTs.slice(startIdx, endIdx)
    .replace(/^export\s+function\s+createKyanaSseParser\s*\(\s*callbacks:\s*SseStreamCallbacks\s*=\s*\{\}\s*\)/m, 'function createKyanaSseParser(callbacks = {})')
    .replace(/:\s*SendKyanaMessageResult\s*\|\s*null/g, '')
    .replace(/:\s*string\s*\|\s*null/g, '')
    .replace(/:\s*string\[\]/g, '')
    .replace(/:\s*any\b/g, '')
    .replace(/:\s*number\b/g, '')
    .replace(/:\s*boolean\b/g, '')
    .replace(/:\s*string\b/g, '')
    .replace(/\s+as\s+SendKyanaMessageResult\b/g, '');

  const fn = new Function('console', `${fnCode}\nreturn createKyanaSseParser;`)(console);
  return fn;
}

// ============================================================================
// 1. Mobile SSE Parsing Tests
// ============================================================================
test('Phase 2C.1 — Mobile SSE parser handles fragmented packets, multiple events per packet, resourceCards, and final flush', async (t) => {
  const createKyanaSseParser = loadMobileSseParser();

  await t.test('handles events split across multiple network packets and multiple events in one packet', () => {
    const deltas = [];
    const replaces = [];
    const results = [];
    const errors = [];
    let doneCount = 0;

    const parser = createKyanaSseParser({
      onDelta: (chunk) => deltas.push(chunk),
      onReplace: (text) => replaces.push(text),
      onResult: (payload) => results.push(payload),
      onDone: () => { doneCount += 1; },
      onError: (msg) => errors.push(msg)
    });

    const largeCards = Array.from({ length: 6 }, (_, i) => ({
      type: 'note',
      id: 100 + i,
      title: `Operating Systems Lecture Note Part ${i + 1} — Deadlock Avoidance & Banker's Algorithm`,
      subject: 'Operating Systems',
      chapter: `Chapter ${i + 1}`,
      semester: 4,
      action: 'open_note',
      deepLink: `/material/${100 + i}`,
      viewUrl: `/api/files/${100 + i}/view`,
      downloadUrl: `/api/files/${100 + i}/download`,
      mobileRoute: `/material/${100 + i}`,
      mobileParams: { id: 100 + i }
    }));

    const fullReply = 'Deadlock occurs when a set of blocked processes each hold a resource and wait to acquire a resource held by another process in the same set.';
    const sseStream = [
      `event: status\ndata: ${JSON.stringify({ state: 'searching', buffered: false })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ text: 'Deadlock occurs when ' })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ text: 'a set of blocked processes ' })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ text: 'each hold a resource and wait to acquire a resource held by another process in the same set.' })}\n\n`,
      `event: result\ndata: ${JSON.stringify({
        reply: fullReply,
        intent: 'notes',
        chatMode: 'normal',
        resourceCards: largeCards,
        matchedFiles: [{ id: 100, title: 'OS Note' }]
      })}\n\n`,
      `event: done\ndata: [DONE]`
    ].join('');

    // Deliberately slice into irregular packet sizes (including 5-byte, 11-byte, and multi-event packets)
    let cumulativeResponseText = '';
    const sliceSizes = [5, 11, 3, 29, 140, 8, 17, 250, 9, 41, 500, 12, 64, 19, 1000];
    let offset = 0;
    let step = 0;

    while (offset < sseStream.length) {
      const size = sliceSizes[step % sliceSizes.length];
      step += 1;
      const nextChunk = sseStream.slice(offset, offset + size);
      offset += size;
      cumulativeResponseText += nextChunk;
      parser.feed(cumulativeResponseText, false);
    }

    // Notice the final `done` event had no trailing `\n\n` — verify flush on connection close handles it!
    assert.equal(doneCount, 0, 'Incomplete final event without \\n\\n should wait until connection close flush');
    parser.feed(cumulativeResponseText, true);

    assert.equal(errors.length, 0);
    assert.equal(deltas.join(''), fullReply);
    assert.equal(results.length, 1);
    assert.equal(results[0].reply, fullReply);
    assert.equal(results[0].resourceCards.length, 6);
    assert.deepEqual(results[0].resourceCards[0], largeCards[0]);
    assert.equal(doneCount, 1);
  });

  await t.test('handles replacedStream in result event and error event cleanly', () => {
    let streamedText = '';
    let finalPayload = null;
    let errorMsg = null;

    const parser = createKyanaSseParser({
      onDelta: (c) => { streamedText += c; },
      onReplace: (newText) => { streamedText = newText; },
      onResult: (payload) => { finalPayload = payload; },
      onDone: () => {},
      onError: (msg) => { errorMsg = msg; }
    });

    const packet1 = `event: delta\r\ndata: {"text":"Unverified hallucinated date 2099-01-01"}\r\n\r\nevent: res`;
    const packet2 = `ult\r\ndata: {"reply":"I couldn't verify that from the available Semester Library records.","replacedStream":true,"resourceCards":[]}\r\n\r\nevent: error\r\ndata: {"error":"Rate limit warning"}\r\n\r\n`;

    parser.feed(packet1, false);
    assert.equal(streamedText, 'Unverified hallucinated date 2099-01-01');

    parser.feed(packet1 + packet2, true);
    assert.equal(streamedText, "I couldn't verify that from the available Semester Library records.");
    assert.equal(finalPayload.replacedStream, true);
    assert.equal(errorMsg, 'Rate limit warning');
  });
});

// ============================================================================
// 2. Genuine Live Token Streaming & Trailer Stripping Tests
// ============================================================================
test('Phase 2C.2 — Genuine live token streaming strips trailers progressively and preserves grounding verification', async (t) => {
  await t.test('createReferenceTrailerStreamFilter streams tokens progressively and hides <referenced_records> and [REFERENCED_RECORDS: ...] trailers', () => {
    const emitted = [];
    const filter = createReferenceTrailerStreamFilter({
      onSafeDelta: (chunk) => emitted.push(chunk)
    });

    const chunks = [
      'According to the ',
      'official notice, ',
      'the DBMS practical ',
      'exam is on Sunday. ',
      '<referenced_',
      'records>\n',
      'notice:42\n',
      '</referenced_records>'
    ];

    for (const c of chunks) {
      filter.push(c);
    }
    // Before flush, earlier tokens must have already been emitted progressively!
    assert.ok(emitted.length >= 2, 'Safe tokens must be emitted progressively before stream ends');
    filter.flush();

    const fullEmitted = emitted.join('');
    assert.equal(fullEmitted.trim(), 'According to the official notice, the DBMS practical exam is on Sunday.');
    assert.ok(!fullEmitted.includes('referenced_records'));
    assert.ok(!fullEmitted.includes('notice:42'));

    // Also test bracketed [REFERENCED_RECORDS: ...] format
    const emittedBracket = [];
    const filter2 = createReferenceTrailerStreamFilter({
      onSafeDelta: (chunk) => emittedBracket.push(chunk)
    });
    for (const part of ['Here is the note summary.', ' [REFERENCED_', 'RECORDS: note:7, note:8]']) {
      filter2.push(part);
    }
    filter2.flush();
    assert.equal(emittedBracket.join('').trim(), 'Here is the note summary.');
    const parsed = extractReferencedRecords('Here is the note summary. [REFERENCED_RECORDS: note:7, note:8]');
    assert.equal(parsed.cleanText, 'Here is the note summary.');
    assert.deepEqual(parsed.referencedIds, ['note:7', 'note:8']);
  });

  await t.test('handleChat streams grounded V3 response progressively, builds resource cards, and avoids duplication', async () => {
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
    const fakeDb = {
      query: async () => ({ rows: [{ id: 10, title: 'DBMS Normalization Note', subject: 'Database Management System', semester: '3', visibility: 'public', audience_scope: 'all_students' }] })
    };

    const deltaEvents = [];
    let generationFinished = false;

    const res = await handleChat(
      fakeDb,
      'Explain 3NF in DBMS from uploaded notes',
      { studentId: 1, semester: 3, role: 'student', authenticated: true },
      [],
      'session-stream-1',
      {
        academicContext: { studentId: 1, semester: 3, role: 'student', authenticated: true },
        searchKnowledge: async () => [
          {
            id: 'note:10',
            canonicalId: 10,
            resourceType: 'note',
            title: 'DBMS Normalization Note',
            subject: 'Database Management System',
            chapter: 'Chapter 3',
            semester: 3,
            authorityTier: 2,
            content: 'Third Normal Form (3NF) requires that a relation is in 2NF and has no transitive functional dependencies.'
          }
        ],
        generateReply: async ({ onDelta }) => {
          const streamParts = [
            'This is extracted from **DBMS Normalization Note** (Subject: Database Management System, Chapter: Chapter 3): ',
            'Third Normal Form (3NF) requires that a relation is in 2NF ',
            'and has no transitive functional dependencies.\n',
            '<referenced_records>\nnote:10\n</referenced_records>'
          ];
          for (const part of streamParts) {
            onDelta(part);
          }
          generationFinished = true;
          return { reply: streamParts.join('') };
        },
        onDelta: (chunk) => {
          deltaEvents.push({ chunk, duringGeneration: !generationFinished });
        }
      }
    );

    assert.ok(deltaEvents.length >= 2, 'Should emit multiple progressive delta chunks');
    assert.ok(deltaEvents.every(e => e.duringGeneration), 'Deltas should be emitted progressively during generation and NOT duplicated after verification');
    const combinedStream = deltaEvents.map(e => e.chunk).join('');
    assert.ok(!combinedStream.includes('<referenced_records>'), 'Streamed deltas must never expose <referenced_records>');
    assert.equal(res.reply, combinedStream.trim());
    assert.ok(!res.replacedStream, 'Verified grounded reply should not mark replacedStream');
    assert.equal(res.resourceCards.length, 1);
    assert.equal(res.resourceCards[0].id, 10);
  });

  await t.test('handleChat sets replacedStream=true without duplicating delta when grounding verification replaces an ungrounded response', async () => {
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
    const fakeDb = {
      query: async () => ({ rows: [{ id: 25, title: 'Holiday Notice', content: 'Campus closed on Friday.', semester: '3', visibility: 'public' }] })
    };

    const deltaChunks = [];
    const res = await handleChat(
      fakeDb,
      'When is the final exam date according to the notice?',
      { studentId: 1, semester: 3, role: 'student', authenticated: true },
      [],
      'session-stream-replace',
      {
        academicContext: { studentId: 1, semester: 3, role: 'student', authenticated: true },
        searchKnowledge: async () => [
          {
            id: 'notice:25',
            canonicalId: 25,
            resourceType: 'notice',
            title: 'Holiday Notice',
            authorityTier: 1,
            content: 'Campus closed on Friday for maintenance.'
          }
        ],
        generateReply: async ({ onDelta }) => {
          // Deliberately emit an ungrounded exam date not in the record
          const badText = 'The final exam is scheduled on 2029-11-24 at 9:00 AM.\n<referenced_records>\nnotice:25\n</referenced_records>';
          onDelta('The final exam is scheduled on 2029-11-24 ');
          onDelta('at 9:00 AM.\n<referenced_records>\nnotice:25\n</referenced_records>');
          return { reply: badText };
        },
        onDelta: (chunk) => deltaChunks.push(chunk)
      }
    );

    assert.equal(res.replacedStream, true, 'Must flag replacedStream when verification replaces the streamed text');
    assert.match(res.reply, /couldn't find that in the university records|couldn't verify|bhetiyena/i);
    assert.equal(res.resourceCards.length, 0, 'Must clear resource cards on grounding fallback');
  });
});

// ============================================================================
// 3. Proper Show More Pagination Tests
// ============================================================================
test('Phase 2C.3 — Show More pagination excludes already-shown records across notes, notices, posts, and assignments and resets on new search', async (t) => {
  clearPaginationState();

  await t.test('isShowMoreQuery recognizes English, Romanized Nepali, and Devanagari pagination requests', () => {
    assert.equal(isShowMoreQuery('Arko xa?'), true);
    assert.equal(isShowMoreQuery('Aaru notes dekhau.'), true);
    assert.equal(isShowMoreQuery('Show more.'), true);
    assert.equal(isShowMoreQuery('What else?'), true);
    assert.equal(isShowMoreQuery('अरु नोट्स देखाऊ'), true);
    assert.equal(isShowMoreQuery('Explain deadlock in OS'), false);
  });

  await t.test('searchNotes, searchPosts, searchNotices, searchAssignments, and searchKnowledge exclude previously returned IDs', async () => {
    const noteRows = [
      { id: 1, title: 'DBMS Note 1', subject: 'Database Management System', semester: 3, filename: 'n1.txt', description: 'Normalization 1NF' },
      { id: 2, title: 'DBMS Note 2', subject: 'Database Management System', semester: 3, filename: 'n2.txt', description: 'Normalization 2NF' },
      { id: 3, title: 'DBMS Note 3', subject: 'Database Management System', semester: 3, filename: 'n3.txt', description: 'Normalization 3NF' },
      { id: 4, title: 'DBMS Note 4', subject: 'Database Management System', semester: 3, filename: 'n4.txt', description: 'Normalization BCNF' }
    ];
    const mockNoteDb = {
      exec: async () => {},
      all: async () => noteRows
    };
    const ctx = { studentId: 10, semester: 3, role: 'student', authenticated: true };

    const page1Notes = await searchNotes(mockNoteDb, { subject: 'Database Management System', academicContext: ctx, limit: 2 });
    assert.equal(page1Notes.length, 2);
    const page1Ids = page1Notes.map(n => n.id);

    const page2Notes = await searchNotes(mockNoteDb, {
      subject: 'Database Management System',
      academicContext: ctx,
      excludeIds: page1Ids,
      limit: 2
    });
    assert.equal(page2Notes.length, 2);
    for (const n of page2Notes) {
      assert.ok(!page1Ids.includes(n.id), `Note ${n.id} should not repeat on page 2`);
    }

    // Notices & Posts exclusion check
    const postRows = [
      { id: 11, title: 'Exam Notice 1', content: 'Midterm schedule part 1', category: 'announcement', type: 'notice', author_role: 'admin', author_name: 'Admin', created_at: '2025-02-01' },
      { id: 12, title: 'Exam Notice 2', content: 'Midterm schedule part 2', category: 'announcement', type: 'notice', author_role: 'admin', author_name: 'Admin', created_at: '2025-02-02' }
    ];
    const mockPostDb = {
      all: async (_sql, ...params) => {
        return postRows.filter(r => !params.includes(r.id));
      }
    };
    const noticesPage2 = await searchNotices(mockPostDb, ctx, { query: 'Midterm', excludeIds: ['notice:11'] });
    assert.equal(noticesPage2.length, 1);
    assert.equal(noticesPage2[0].id, 12);

    const postsPage2 = await searchPosts(mockPostDb, ctx, { query: 'Midterm', excludeIds: ['post:11'] });
    assert.equal(postsPage2.length, 1);
    assert.equal(postsPage2[0].id, 12);

    // Assignments exclusion check
    const assignRows = [
      { id: 21, title: 'SQL Lab 1', description: 'Joins', course_code: 'CMP 221', subject: 'Database Management System', semester: 3, is_published: 1, teacher_name: 'Teacher A' },
      { id: 22, title: 'SQL Lab 2', description: 'Triggers', course_code: 'CMP 221', subject: 'Database Management System', semester: 3, is_published: 1, teacher_name: 'Teacher A' }
    ];
    const mockAssignDb = {
      all: async (sql, ...params) => {
        if (/assignment_questions|submissions/i.test(sql)) return [];
        return assignRows.filter(r => !params.includes(r.id));
      }
    };
    const assignPage2 = await searchAssignments(mockAssignDb, ctx, { query: 'SQL', excludeIds: ['assignment:21'] });
    assert.equal(assignPage2.length, 1);
    assert.equal(assignPage2[0].id, 22);
  });

  await t.test('handleChat paginates across turns with "Arko xa?" / "Show more" and resets when a new search begins', async () => {
    clearPaginationState();
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';

    const allNoteRecords = [
      { id: 'note:101', canonicalId: 101, resourceType: 'note', title: 'OS Note 1', subject: 'Operating Systems', semester: 4, authorityTier: 2, content: 'Process states and PCB.' },
      { id: 'note:102', canonicalId: 102, resourceType: 'note', title: 'OS Note 2', subject: 'Operating Systems', semester: 4, authorityTier: 2, content: 'CPU Scheduling algorithms.' },
      { id: 'note:103', canonicalId: 103, resourceType: 'note', title: 'OS Note 3', subject: 'Operating Systems', semester: 4, authorityTier: 2, content: 'Deadlock detection and recovery.' },
      { id: 'note:104', canonicalId: 104, resourceType: 'note', title: 'OS Note 4', subject: 'Operating Systems', semester: 4, authorityTier: 2, content: 'Virtual memory and paging.' }
    ];

    const fakeDb = {
      query: async (_, params) => {
        const id = Number(params?.[0]);
        const match = allNoteRecords.find(r => r.canonicalId === id);
        return { rows: match ? [{ id: match.canonicalId, title: match.title, subject: match.subject, semester: '4', visibility: 'public', audience_scope: 'all_students' }] : [] };
      }
    };

    const studentCtx = { studentId: 7, semester: 4, role: 'student', authenticated: true };
    const sessionId = 'session-pagination-test';

    // Turn 1: Initial search returns first 2 notes
    const turn1 = await handleChat(
      fakeDb,
      'Show me Operating Systems notes',
      studentCtx,
      [],
      sessionId,
      {
        academicContext: studentCtx,
        searchKnowledge: async (_db, _ctx, _q, opts) => {
          const ex = new Set((opts.excludeIds || []).map(String));
          return allNoteRecords.filter(r => !ex.has(r.id) && !ex.has(String(r.canonicalId))).slice(0, 2);
        },
        generateReply: async () => ({
          reply: 'Here are OS Note 1 and OS Note 2 regarding Process states and CPU Scheduling.\n<referenced_records>\nnote:101\nnote:102\n</referenced_records>'
        })
      }
    );

    assert.deepEqual(turn1.resourceCards.map(c => c.id), [101, 102]);

    // Turn 2: "Arko xa?" returns the next 2 unseen notes (103, 104)
    const historyAfterTurn1 = [
      { role: 'user', content: 'Show me Operating Systems notes' },
      { role: 'assistant', content: turn1.reply, resourceCards: turn1.resourceCards }
    ];

    let capturedExcludeIds = [];
    const turn2 = await handleChat(
      fakeDb,
      'Arko xa?',
      studentCtx,
      historyAfterTurn1,
      sessionId,
      {
        academicContext: studentCtx,
        searchKnowledge: async (_db, _ctx, _q, opts) => {
          capturedExcludeIds = opts.excludeIds || [];
          const ex = new Set(capturedExcludeIds.map(String));
          return allNoteRecords.filter(r => !ex.has(r.id) && !ex.has(String(r.canonicalId))).slice(0, 2);
        },
        generateReply: async () => ({
          reply: 'Here are OS Note 3 and OS Note 4 covering Deadlock and Virtual memory.\n<referenced_records>\nnote:103\nnote:104\n</referenced_records>'
        })
      }
    );

    assert.ok(capturedExcludeIds.includes('note:101') || capturedExcludeIds.includes('101'));
    assert.ok(capturedExcludeIds.includes('note:102') || capturedExcludeIds.includes('102'));
    assert.deepEqual(turn2.resourceCards.map(c => c.id), [103, 104]);

    // Turn 3: Genuine new search in the student's authorized semester resets pagination
    let turn3ExcludeIds = null;
    await handleChat(
      fakeDb,
      'Show me Computer Networks notes',
      studentCtx,
      [...historyAfterTurn1, { role: 'user', content: 'Arko xa?' }, { role: 'assistant', content: turn2.reply, resourceCards: turn2.resourceCards }],
      sessionId,
      {
        academicContext: studentCtx,
        searchKnowledge: async (_db, _ctx, _q, opts) => {
          turn3ExcludeIds = opts.excludeIds || [];
          return [];
        },
        generateReply: async () => ({ reply: 'No Computer Networks notes.' })
      }
    );
    assert.deepEqual(turn3ExcludeIds, [], 'New search must reset pagination excludeIds');
    delete process.env.KYANA_KNOWLEDGE_V3;
    delete process.env.KYANA_KNOWLEDGE_V3_USERS;
  });
});

// ============================================================================
// 4. Cross-Intent Conversational Context Tests
// ============================================================================
test('Phase 2C.4 — Cross-intent conversational context carries forward concept and subject across turns and respects explicit topic changes', async (t) => {
  await t.test('Supports 4-turn cross-intent progression: Explain deadlock in OS -> Yesko notes xa? -> Assignment pani xa? -> Chapter 3 ma kata explain gareko xa?', () => {
    const history = [];

    // Turn 1: "Explain deadlock in Operating Systems."
    const turn1Msg = 'Explain deadlock in Operating Systems.';
    const route1 = routeQuery(turn1Msg, history);
    assert.equal(route1.filters.subject, 'Operating Systems');
    assert.match(route1.query, /\bdeadlock\b/i);
    history.push({ role: 'user', content: turn1Msg });
    history.push({ role: 'assistant', content: 'Deadlock is a situation where processes block each other.' });

    // Turn 2: "Yesko notes xa?"
    const turn2Msg = 'Yesko notes xa?';
    const route2 = routeQuery(turn2Msg, history);
    assert.equal(route2.kind, 'notes');
    assert.equal(route2.filters.subject, 'Operating Systems');
    assert.equal(route2.query, 'deadlock', 'Must carry forward "deadlock" instead of searching for literal "yesko"');
    assert.ok(!/\byesko\b/i.test(route2.query));
    history.push({ role: 'user', content: turn2Msg });
    history.push({ role: 'assistant', content: 'Here are the deadlock notes for Operating Systems.' });

    // Turn 3: "Assignment pani xa?"
    const turn3Msg = 'Assignment pani xa?';
    const route3 = routeQuery(turn3Msg, history);
    assert.equal(route3.kind, 'assignments');
    assert.equal(route3.filters.subject, 'Operating Systems');
    assert.equal(route3.query, 'deadlock', 'Must carry forward "deadlock" instead of searching for literal "pani"');
    assert.ok(!/\bpani\b/i.test(route3.query));
    history.push({ role: 'user', content: turn3Msg });
    history.push({ role: 'assistant', content: 'Found 1 assignment on Deadlock in Operating Systems.' });

    // Turn 4: "Chapter 3 ma kata explain gareko xa?"
    const turn4Msg = 'Chapter 3 ma kata explain gareko xa?';
    const route4 = routeQuery(turn4Msg, history);
    assert.equal(route4.kind, 'notes');
    assert.equal(route4.filters.subject, 'Operating Systems');
    assert.equal(route4.filters.chapter, 'Chapter 3');
    assert.equal(route4.query, 'deadlock');

    // Turn 5: Explicit topic change ("DBMS ma normalization ko notes deu") must NOT keep Operating Systems or deadlock
    const turn5Msg = 'DBMS ma normalization ko notes deu';
    const route5 = routeQuery(turn5Msg, history);
    assert.equal(route5.kind, 'notes');
    assert.equal(route5.filters.subject, 'Database Management System');
    assert.equal(route5.query, 'normalization');
  });
});

// ============================================================================
// 5. Query Embedding Cache & Reduced LLM Calls Tests
// ============================================================================
test('Phase 2C.5 — Query embedding TTL/LRU cache and zero redundant LLM scope classification calls', async (t) => {
  await t.test('embedText caches normalized queries with TTL and LRU eviction while isolating by model/taskType', async () => {
    clearEmbeddingCache();

    let fetchCallCount = 0;
    const customFetch = async () => {
      fetchCallCount += 1;
      const values = Array.from({ length: 768 }, (_, i) => (i === 0 ? fetchCallCount : 0.01));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          embedding: { values }
        })
      };
    };

    try {
      const vec1 = await embedText('  Explain Deadlock in Operating Systems?!  ', {
        apiKey: 'test-key',
        taskType: 'RETRIEVAL_QUERY',
        customFetch
      });
      assert.equal(fetchCallCount, 1);
      assert.equal(getEmbeddingCacheStats().size, 1);

      // Identical normalized query (case/whitespace variation) should hit cache without calling customFetch
      const vec2 = await embedText('explain deadlock in operating systems?!', {
        apiKey: 'test-key',
        taskType: 'RETRIEVAL_QUERY',
        customFetch
      });
      assert.equal(fetchCallCount, 1, 'Normalized repeat query must hit the embedding cache');
      assert.deepEqual(vec2, vec1);

      // Different taskType must not collide with RETRIEVAL_QUERY
      const vecDoc = await embedText('explain deadlock in operating systems?!', {
        apiKey: 'test-key',
        taskType: 'RETRIEVAL_DOCUMENT',
        customFetch
      });
      assert.equal(fetchCallCount, 2, 'Different taskType must use a distinct cache key');
      assert.notDeepEqual(vecDoc, vec1);

      // Expired TTL forces re-fetch
      await embedText('short ttl query', { apiKey: 'test-key', taskType: 'RETRIEVAL_QUERY', customFetch, cacheTtlMs: 5, now: 1000 });
      assert.equal(fetchCallCount, 3);
      await embedText('short ttl query', { apiKey: 'test-key', taskType: 'RETRIEVAL_QUERY', customFetch, cacheTtlMs: 5, now: 1010 });
      assert.equal(fetchCallCount, 4, 'Expired TTL entry must be refreshed');

      // LRU Eviction when maxCacheSize is reached
      clearEmbeddingCache();
      await embedText('lru-q1', { apiKey: 'test-key', taskType: 'RETRIEVAL_QUERY', customFetch, maxCacheSize: 2 });
      await embedText('lru-q2', { apiKey: 'test-key', taskType: 'RETRIEVAL_QUERY', customFetch, maxCacheSize: 2 });
      // Touch lru-q1 so lru-q2 becomes oldest
      await embedText('lru-q1', { apiKey: 'test-key', taskType: 'RETRIEVAL_QUERY', customFetch, maxCacheSize: 2 });
      // Insert lru-q3 -> should evict lru-q2
      await embedText('lru-q3', { apiKey: 'test-key', taskType: 'RETRIEVAL_QUERY', customFetch, maxCacheSize: 2 });
      const callsBefore = fetchCallCount;
      await embedText('lru-q1', { apiKey: 'test-key', taskType: 'RETRIEVAL_QUERY', customFetch, maxCacheSize: 2 });
      assert.equal(fetchCallCount, callsBefore, 'Recently accessed lru-q1 must remain cached');
      await embedText('lru-q2', { apiKey: 'test-key', taskType: 'RETRIEVAL_QUERY', customFetch, maxCacheSize: 2 });
      assert.equal(fetchCallCount, callsBefore + 1, 'Evicted lru-q2 must trigger a new fetch');
    } finally {
      clearEmbeddingCache();
    }
  });

  await t.test('Grounded and deterministic BIT syllabus queries make zero redundant LLM classifier calls before answering', async () => {
    invalidateCache({});
    let classifierCalls = 0;
    let generationCalls = 0;

    const fakeDb = {
      query: async () => ({ rows: [] }),
      all: async () => []
    };

    await handleChat(
      fakeDb,
      'Explain deadlock and semaphore in Operating Systems',
      { studentId: 1, semester: 4, role: 'student', authenticated: true },
      [],
      'session-perf-1',
      {
        academicContext: { studentId: 1, semester: 4, role: 'student', authenticated: true },
        classifyScope: async () => {
          classifierCalls += 1;
          return 'IN_SCOPE';
        },
        searchKnowledge: async () => [],
        generateReply: async ({ onDelta }) => {
          generationCalls += 1;
          const text = 'Deadlock is when processes wait indefinitely for resources held by each other, while a semaphore is a synchronization primitive.';
          onDelta(text);
          return { reply: text };
        }
      }
    );

    assert.equal(classifierCalls, 0, 'Must not make a sequential LLM scope-classification call for deterministic BIT syllabus/grounded queries');
    assert.equal(generationCalls, 1, 'Must make only 1 LLM generation call');
  });
});
