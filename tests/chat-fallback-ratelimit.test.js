'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatProvider } = require('../lib/chat-provider');
const { createDailyRateLimiter, getClientId, getTodayKey } = require('../lib/chat-ratelimit');

function sse(events) {
  const encoder = new TextEncoder();
  const payload = events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\r\n\r\n`).join('');
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    }
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

function router(delta, finishReason = null) {
  return { choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

function gemini(parts, finishReason = 'STOP') {
  return { candidates: [{ content: { role: 'model', parts }, ...(finishReason ? { finishReason } : {}) }] };
}

test('fallback chain: DeepSeek is tried first, then Groq, then Gemini', async () => {
  const env = {
    DEEPSEEK_API_KEY: 'test-deepseek-key',
    GROQ_API_KEY: 'test-groq-key',
    GEMINI_API_KEY: 'test-gemini-key'
  };

  const calledUrls = [];
  const provider = createChatProvider({
    env,
    fetchImpl: async (url, req) => {
      calledUrls.push(url);
      if (url.includes('api.deepseek.com')) {
        // DeepSeek fails with 429 rate limit
        return new Response('Rate limited', { status: 429 });
      }
      if (url.includes('api.groq.com')) {
        // Groq fails with 500 error
        return new Response('Server error', { status: 500 });
      }
      if (url.includes('googleapis.com')) {
        // Gemini succeeds
        return sse([gemini([{ text: 'Hello from Gemini fallback!' }])]);
      }
      throw new Error('Unexpected url: ' + url);
    }
  });

  const result = await provider.generateReply({ message: 'Hi there' });
  assert.equal(result.provider, 'gemini');
  assert.equal(result.reply, 'Hello from Gemini fallback!');
  assert.equal(calledUrls.length, 3);
  assert.match(calledUrls[0], /api\.deepseek\.com/);
  assert.match(calledUrls[1], /api\.groq\.com/);
  assert.match(calledUrls[2], /googleapis\.com/);
});

test('fallback chain: DeepSeek succeeds on first attempt', async () => {
  const env = {
    DEEPSEEK_API_KEY: 'test-deepseek-key',
    GROQ_API_KEY: 'test-groq-key',
    GEMINI_API_KEY: 'test-gemini-key'
  };

  const calledUrls = [];
  const provider = createChatProvider({
    env,
    fetchImpl: async (url, req) => {
      calledUrls.push(url);
      if (url.includes('api.deepseek.com')) {
        return sse([router({ content: 'Hello from DeepSeek!' }, 'stop'), '[DONE]']);
      }
      throw new Error('Should not call others');
    }
  });

  const result = await provider.generateReply({ message: 'Hello' });
  assert.equal(result.provider, 'deepseek');
  assert.equal(result.reply, 'Hello from DeepSeek!');
  assert.equal(calledUrls.length, 1);
  assert.match(calledUrls[0], /api\.deepseek\.com/);
});

test('fallback chain: Groq succeeds when DeepSeek fails', async () => {
  const env = {
    DEEPSEEK_API_KEY: 'test-deepseek-key',
    GROQ_API_KEY: 'test-groq-key',
    GEMINI_API_KEY: 'test-gemini-key'
  };

  const calledUrls = [];
  const provider = createChatProvider({
    env,
    fetchImpl: async (url, req) => {
      calledUrls.push(url);
      if (url.includes('api.deepseek.com')) {
        return new Response('Busy', { status: 503 });
      }
      if (url.includes('api.groq.com')) {
        return sse([router({ content: 'Hello from Groq!' }, 'stop'), '[DONE]']);
      }
      throw new Error('Should not reach Gemini');
    }
  });

  const result = await provider.generateReply({ message: 'Hello' });
  assert.equal(result.provider, 'groq');
  assert.equal(result.reply, 'Hello from Groq!');
  assert.equal(calledUrls.length, 2);
  assert.match(calledUrls[0], /api\.deepseek\.com/);
  assert.match(calledUrls[1], /api\.groq\.com/);
});

test('hourly rate limiter allows 100 messages and rejects 101st with friendly message', () => {
  const store = new Map();
  const limiter = createDailyRateLimiter({ max: 100, store, getHourKey: () => '2026-09-27T10' });

  const studentReq = {
    session: { studentId: '26020266' },
    body: { message: 'hello' }
  };

  let nextCalls = 0;
  const next = () => { nextCalls++; };

  // First 100 requests should succeed
  for (let i = 0; i < 100; i++) {
    let statusCalled = null;
    let jsonSent = null;
    const res = {
      status(s) { statusCalled = s; return this; },
      json(data) { jsonSent = data; }
    };
    limiter(studentReq, res, next);
    assert.equal(statusCalled, null, `Request ${i + 1} should not be blocked`);
  }
  assert.equal(nextCalls, 100);

  // 101st request must be rejected with 429 and friendly message
  let status101 = null;
  let json101 = null;
  const res101 = {
    status(s) { status101 = s; return this; },
    json(data) { json101 = data; }
  };
  limiter(studentReq, res101, next);
  assert.equal(nextCalls, 100, 'next() should not be called for 101st request');
  assert.equal(status101, 429);
  assert.match(json101.message, /limit of 100/);
});

test('hourly rate limiter resets on the next hour', () => {
  const store = new Map();
  let currentHour = '2026-09-27T10';
  const limiter = createDailyRateLimiter({ max: 100, store, getHourKey: () => currentHour });

  const sessionReq = {
    sessionID: 'sess_abc123',
    body: { message: 'hello' }
  };

  const next = () => {};

  // Consume all 100 messages in hour 10
  for (let i = 0; i < 100; i++) {
    limiter(sessionReq, { status() { return this; }, json() {} }, next);
  }

  // 101st request is blocked
  let blockedStatus = null;
  limiter(sessionReq, { status(s) { blockedStatus = s; return this; }, json() {} }, next);
  assert.equal(blockedStatus, 429);

  // Next hour arrives!
  currentHour = '2026-09-27T11';
  let allowed = false;
  limiter(sessionReq, { status() { return this; }, json() {} }, () => { allowed = true; });
  assert.equal(allowed, true, 'Request should be allowed in the next hour');
});

test('rate limiter tracks different students separately', () => {
  const store = new Map();
  const limiter = createDailyRateLimiter({ max: 100, store, getHourKey: () => '2026-09-27T10' });

  const studentA = { session: { studentId: 'student_1' }, body: { message: 'hi' } };
  const studentB = { session: { studentId: 'student_2' }, body: { message: 'hi' } };

  // Max out student A
  for (let i = 0; i < 100; i++) {
    limiter(studentA, { status() { return this; }, json() {} }, () => {});
  }

  // Student A is blocked
  let blockedStatus = null;
  limiter(studentA, { status(s) { blockedStatus = s; return this; }, json() {} }, () => {});
  assert.equal(blockedStatus, 429);

  // Student B is still allowed
  let studentBAllowed = false;
  limiter(studentB, { status() { return this; }, json() {} }, () => { studentBAllowed = true; });
  assert.equal(studentBAllowed, true, 'Student B should not be blocked by Student A');
});
