'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventStreamParser, readChatResponse, escapeHtml, safeLink, fallbackMarkdown, normalizeLatexDelimiters } = require('../public/chatbot.js');

function streamingResponse(content, chunkSize = 1) {
  const bytes = new TextEncoder().encode(content);
  let cursor = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (cursor === bytes.length) return controller.close();
      controller.enqueue(bytes.slice(cursor, cursor + chunkSize));
      cursor = Math.min(bytes.length, cursor + chunkSize);
    }
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

function event(type, data, newline = '\n') {
  return `event: ${type}${newline}data: ${JSON.stringify(data)}${newline}${newline}`;
}

test('SSE handles CRLF split at every boundary, comments, and multiline data', () => {
  const actual = [];
  const parser = createEventStreamParser((name, data) => actual.push({ name, data }));
  const wire = ': keepalive\r\nevent: delta\r\ndata: {\r\ndata: "text": "hello"}\r\n\r\n';
  for (const char of wire) parser.feed(char);
  parser.feed('', true);
  assert.deepEqual(actual, [{ name: 'delta', data: '{\n"text": "hello"}' }]);
});

test('SSE supports LF and CR line delimiters and ignores incomplete final events', () => {
  const actual = [];
  const parser = createEventStreamParser((name, data) => actual.push([name, data]));
  parser.feed('event: delta\ndata: one\n\nevent: delta\rdata: two\r\revent: result\ndata: incomplete');
  parser.feed('', true);
  assert.deepEqual(actual, [['delta', 'one'], ['delta', 'two']]);
});

test('response delivers Unicode tokens progressively and completes with metadata once', async () => {
  const deltas = [];
  const result = { reply: 'Hi 👋 नेपाली', matchedFiles: [{ id: 42 }] };
  const response = streamingResponse(
    ': heartbeat\r\n\r\n' + event('delta', { text: 'Hi 👋 ' }, '\r\n') +
    event('delta', { text: 'नेपाली' }) + event('result', result) +
    event('delta', { text: 'must not be delivered after result' })
  );
  assert.deepEqual(await readChatResponse(response, delta => deltas.push(delta)), result);
  assert.deepEqual(deltas, ['Hi 👋 ', 'नेपाली']);
});

test('a result closes the reader even when the server leaves its connection open', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(event('result', { reply: 'Done' }))); },
    cancel() { cancelled = true; }
  }), { headers: { 'Content-Type': 'text/event-stream' } });
  assert.equal((await readChatResponse(response, () => {})).reply, 'Done');
  assert.equal(cancelled, true);
});

test('server error after partial tokens is surfaced rather than accepted as a complete answer', async () => {
  const deltas = [];
  await assert.rejects(readChatResponse(streamingResponse(
    event('delta', { text: 'Partial ' }) + event('error', { message: 'Provider timed out.' })
  ), text => deltas.push(text)), /Provider timed out/);
  assert.deepEqual(deltas, ['Partial ']);
});

test('premature EOF and malformed results do not silently succeed', async () => {
  await assert.rejects(readChatResponse(streamingResponse(event('delta', { text: 'Partial' })), () => {}), /interrupted/);
  await assert.rejects(readChatResponse(streamingResponse('event: result\ndata: {"reply":"Incomplete"}'), () => {}), /interrupted/);
  await assert.rejects(readChatResponse(streamingResponse('event: delta\ndata: nope\n\n'), () => {}), /interrupted/);
  await assert.rejects(readChatResponse(streamingResponse(event('result', { missingReply: true })), () => {}), /incomplete/);
});

test('non-streaming JSON remains compatible', async () => {
  const result = { reply: 'Semester 3', matchedRoutine: [] };
  assert.deepEqual(await readChatResponse(Response.json(result), () => assert.fail('No delta expected')), result);
  await assert.rejects(readChatResponse(Response.json({ error: true }), () => {}), /incomplete/);
});

test('unsafe URLs are rejected before rendering source and action links', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'java\nscript:alert(1)', 'file:///etc/passwd']) {
    assert.equal(safeLink(value), null);
  }
  assert.equal(safeLink('https://example.com/article', true), 'https://example.com/article');
  assert.equal(safeLink('/api/files/4/view'), '/api/files/4/view');
  assert.equal(safeLink('library.html', true), null);
});

test('CDN fallback escapes HTML while keeping fenced code usable, including unfinished fences', () => {
  const rendered = fallbackMarkdown('Use this:\n```html\n<img src=x onerror="alert(1)">\n```\n<script>alert(1)</script>');
  assert.match(rendered, /<pre><code class="language-html">&lt;img/);
  assert.ok(!rendered.includes('<img'));
  assert.ok(!rendered.includes('<script>'));
  assert.match(fallbackMarkdown('```java\nSystem.out.println("Hi");'), /<pre><code class="language-java">System.out.println\(&quot;Hi&quot;\);<\/code><\/pre>/);
  assert.equal(escapeHtml('\'"><&'), '&#39;&quot;&gt;&lt;&amp;');
});

test('math delimiter formatting preserves escapes inside generated code', () => {
  assert.equal(normalizeLatexDelimiters('Solve \\[x + 1\\] and \\(y\\).'), 'Solve $$x + 1$$ and $y$.');
  const code = '```javascript\nconst expression = /\\(x\\)/;\n```\n`\\[x\\]`';
  assert.equal(normalizeLatexDelimiters(code), code);
  const partialCode = '```javascript\nconst expression = /\\(x\\)/;';
  assert.equal(normalizeLatexDelimiters(partialCode), partialCode);
});

test('service worker leaves APIs and streaming POST requests on the network', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const handlers = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/sw.js'), 'utf8'), {
    self: { addEventListener: (name, handler) => { handlers[name] = handler; } }, URL
  });
  for (const request of [
    { method: 'POST', url: 'https://library.test/api/ai/chat' },
    { method: 'GET', url: 'https://library.test/api/files' }
  ]) handlers.fetch({ request, respondWith() { assert.fail('Dynamic requests must not use the cache'); } });
});

test('service worker prefers current chatbot pages and scripts over stale cached versions', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const handlers = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/sw.js'), 'utf8'), {
    self: { addEventListener: (name, handler) => { handlers[name] = handler; } }, URL, Response,
    fetch: async () => new Response('current'),
    caches: { match: async () => new Response('stale') }
  });
  for (const path of ['/chatbot.html', '/chatbot.js']) {
    let response;
    handlers.fetch({ request: { method: 'GET', url: 'https://library.test' + path }, respondWith(value) { response = value; } });
    assert.equal(await (await response).text(), 'current');
  }
});
