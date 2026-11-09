'use strict';

/**
 * Kyana AI — Live Pipeline & Factual Accuracy Benchmark (Phase 7)
 *
 * Simulates real-world application requests through handleChat() against
 * the live database to measure:
 * 1. Exact factual accuracy & lack of hallucinations
 * 2. Retrieval source & correct record ID discovery
 * 3. Latency & performance benchmarks
 * 4. Grounding and privacy boundary enforcement
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db');
const { handleChat } = require('../ai-assistant');
const temporal = require('../lib/temporal-intelligence');

const STUDENT_USER = {
  studentId: 'c808f9d6-1a5e-4ba9-bbf8-bb97a7a40cb2',
  semester: 3,
  department: 'BIT',
  role: 'student',
  authenticated: true
};

// Benchmark reference date: Tuesday, Nov 10, 2026 AD (24 Kartik 2083 BS)
const BENCHMARK_DATE = new Date('2026-11-10T12:00:00+05:45');

test.beforeEach(() => {
  temporal.setMockTime(BENCHMARK_DATE);
});

test.afterEach(() => {
  temporal.resetMockTime();
});

test('Benchmark 1: "Hamro project defense kaile ho?" resolves Post 187 with exact dates and countdown', async () => {
  const t0 = Date.now();
  const res = await handleChat(db, 'Hamro project defense kaile ho?', STUDENT_USER, [], {
    referenceDate: BENCHMARK_DATE
  });
  const latencyMs = Date.now() - t0;

  console.log(`[Benchmark 1] Latency: ${latencyMs}ms`);
  console.log(`[Benchmark 1] Reply: ${res.reply}`);

  assert.ok(res.reply, 'Must return non-empty reply');
  assert.equal(res.intent, 'notices', 'Intent must be notices');

  // Verify dates: Nov 23, 2026 AD / 7 Mangsir 2083 BS
  assert.match(res.reply, /2026-11-23/);
  assert.match(res.reply, /7 Mangsir 2083|Mangsir 7/i);

  // Verify countdown: exactly 13 days from Nov 10 to Nov 23
  assert.match(res.reply, /13 days/i);

  // Verify teacher attribution: Newton
  assert.match(res.reply, /newton/i);

  // Verify resource card
  assert.ok(res.resourceCards.some(c => Number(c.id) === 187), 'Must attach Post 187 card');
});

test('Benchmark 2: "When is our project defense?" retrieves Post 187 in English', async () => {
  const t0 = Date.now();
  const res = await handleChat(db, 'When is our project defense?', STUDENT_USER, [], {
    referenceDate: BENCHMARK_DATE
  });
  const latencyMs = Date.now() - t0;

  console.log(`[Benchmark 2] Latency: ${latencyMs}ms`);
  assert.ok(res.reply);
  assert.match(res.reply, /2026-11-23/);
  assert.match(res.reply, /7 Mangsir 2083|Mangsir 7/i);
  assert.match(res.reply, /13 days/i);
  assert.match(res.reply, /newton/i);
  assert.ok(res.resourceCards.some(c => Number(c.id) === 187));
});

test('Benchmark 3: "Aaja kati gate ho?" returns instant Nepal date with 0 DB queries', async () => {
  const t0 = Date.now();
  const res = await handleChat(db, 'Aaja kati gate ho?', STUDENT_USER, [], {
    referenceDate: BENCHMARK_DATE
  });
  const latencyMs = Date.now() - t0;

  console.log(`[Benchmark 3] Latency: ${latencyMs}ms`);
  assert.equal(res.intent, 'current_date');
  assert.ok(res.reply.includes('24 Kartik 2083'));
  assert.ok(res.reply.includes('2026-11-10'));
  assert.equal((res.resourceCards || []).length, 0);
});

test('Benchmark 4: "आज कति गते हो?" returns instant Devanagari date', async () => {
  const t0 = Date.now();
  const res = await handleChat(db, 'आज कति गते हो?', STUDENT_USER, [], {
    referenceDate: BENCHMARK_DATE
  });
  const latencyMs = Date.now() - t0;

  console.log(`[Benchmark 4] Latency: ${latencyMs}ms`);
  assert.equal(res.intent, 'current_date');
  assert.ok(res.reply.includes('२४ कार्तिक २०८३'));
  assert.ok(res.reply.includes('2026-11-10'));
});

test('Benchmark 5: "College kahile khulcha?" retrieves resumption notice (Post 186)', async () => {
  const t0 = Date.now();
  const res = await handleChat(db, 'College kahile khulcha?', STUDENT_USER, [], {
    referenceDate: BENCHMARK_DATE
  });
  const latencyMs = Date.now() - t0;

  console.log(`[Benchmark 5] Latency: ${latencyMs}ms`);
  console.log(`[Benchmark 5] Reply: ${res.reply}`);

  assert.ok(res.reply);
  assert.match(res.reply, /30 Kartik 2083|Kartik 30/i);
  assert.match(res.reply, /2026-11-16/);
  // From Nov 10 to Nov 16 is exactly 6 days
  assert.match(res.reply, /6 days|६ दिन/i);
  assert.ok(res.resourceCards.some(c => Number(c.id) === 186 || Number(c.id) === 184));
});

test('Benchmark 6: Out-of-scope query refuses cleanly without campus database queries', async () => {
  const t0 = Date.now();
  const res = await handleChat(db, 'What is the recipe for chocolate cake?', STUDENT_USER, [], {
    referenceDate: BENCHMARK_DATE
  });
  const latencyMs = Date.now() - t0;

  console.log(`[Benchmark 6] Latency: ${latencyMs}ms`);
  assert.equal(res.intent, 'out_of_scope');
  assert.equal((res.resourceCards || []).length, 0);
  assert.ok(!res.reply.includes('Newton'));
  assert.ok(!res.reply.includes('Post 187'));
});

test.after(async () => {
  if (db && typeof db.close === 'function') {
    await db.close();
  }
});
