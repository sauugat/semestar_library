const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const explainRouter = require('../routes/code-lab/explain');

test('Code Lab AI explain error endpoint', async (t) => {
  const app = express();
  app.use(express.json());

  // Mock session middleware
  app.use((req, res, next) => {
    if (req.headers['x-test-auth'] === 'yes') {
      req.session = { studentId: 'student_123' };
    } else {
      req.session = {};
    }
    next();
  });

  app.use('/api/code-lab', explainRouter);

  let server;
  let baseUrl;

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });

  t.after(() => {
    server.close();
  });

  await t.test('rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/api/code-lab/explain-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'int a = 5;', stderr: 'error' })
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.message, 'Authentication required.');
  });

  await t.test('rejects missing stderr with 400', async () => {
    const res = await fetch(`${baseUrl}/api/code-lab/explain-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-auth': 'yes' },
      body: JSON.stringify({ code: 'int a = 5;', stderr: '' })
    });
    assert.equal(res.status, 400);
  });

  await t.test('rejects missing code with 400', async () => {
    const res = await fetch(`${baseUrl}/api/code-lab/explain-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-auth': 'yes' },
      body: JSON.stringify({ code: '', stderr: 'error' })
    });
    assert.equal(res.status, 400);
  });

  await t.test('returns valid explanation with Gemini or rule-based fallback', async () => {
    const res = await fetch(`${baseUrl}/api/code-lab/explain-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-auth': 'yes' },
      body: JSON.stringify({
        code: 'public class Main { public static void main(String[] args) { int x = 5 } }',
        stderr: "Main.java:1: error: ';' expected\n int x = 5\n          ^",
        language: 'java'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.explanation, 'Explanation should not be empty');
    assert.ok(data.explanation.includes("**What's wrong:**"), 'Explanation should have What wrong section');
    assert.ok(data.explanation.includes("**Why:**"), 'Explanation should have Why section');
    assert.ok(data.explanation.includes("**What to look for:**"), 'Explanation should have What to look for section');
  });

  await t.test('gracefully falls back to rule-based explanation when API keys are absent', async () => {
    const origGemini = process.env.GEMINI_API_KEY;
    const origGroq = process.env.GROQ_API_KEY;
    const origRouter = process.env.OPENROUTER_API_KEY;

    try {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      const res = await fetch(`${baseUrl}/api/code-lab/explain-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-auth': 'yes' },
        body: JSON.stringify({
          code: 'print(x)',
          stderr: "NameError: name 'x' is not defined",
          language: 'python'
        })
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.explanation.includes("**What's wrong:**"), 'Fallback should have What wrong section');
      assert.ok(data.explanation.toLowerCase().includes('variable') || data.explanation.toLowerCase().includes('name'), 'Should mention variable/name');
    } finally {
      if (origGemini) process.env.GEMINI_API_KEY = origGemini;
      if (origGroq) process.env.GROQ_API_KEY = origGroq;
      if (origRouter) process.env.OPENROUTER_API_KEY = origRouter;
    }
  });
});
