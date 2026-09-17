'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatProvider, _testing } = require('../lib/chat-provider');

const encoder = new TextEncoder();
const environment = { GEMINI_API_KEY: 'test-gemini-key', OPENROUTER_API_KEY: 'test-router-key' };
const searchTool = { type: 'function', function: {
  name: 'search_notes', description: 'Search uploaded notes.',
  parameters: { type: 'object', properties: { query: { type: 'string' }, semester: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['query'], additionalProperties: false }
} };
const webTool = { type: 'function', function: {
  name: 'web_search', description: 'Find current data.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
} };

function byteStream(bytes, chunkSize = 7) {
  let index = 0;
  return new ReadableStream({ pull(controller) {
    if (index >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(index, index += chunkSize));
  } });
}

function sse(events, chunkSize = 7) {
  return new Response(byteStream(encoder.encode(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\r\n\r\n`).join('')), chunkSize), {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

function gemini(parts, finishReason = 'STOP') {
  return { candidates: [{ content: { role: 'model', parts }, ...(finishReason ? { finishReason } : {}) }] };
}

function router(delta, finishReason = null) {
  return { choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

test('SSE handles byte-fragmented UTF-8, CRLF, comments, multiline data and final line', async () => {
  const bytes = encoder.encode(': keepalive\r\nevent: message\r\ndata: hello 🌍\r\ndata: next line\r\n\r\ndata: final');
  const events = [];
  for await (const data of _testing.readSSE(byteStream(bytes, 1))) events.push(data);
  assert.deepEqual(events, ['hello 🌍\nnext line', 'final']);
});

test('direct Gemini answers stream before response completion and never call fallback', async () => {
  let finish;
  let fetches = 0;
  const first = encoder.encode(`data: ${JSON.stringify(gemini([{ text: 'A variable ' }], null))}\n\n`);
  const rest = encoder.encode(`data: ${JSON.stringify(gemini([{ text: 'stores a value.' }]))}\n\n`);
  const deltas = [];
  const provider = createChatProvider({ env: environment, fetchImpl: async () => {
    fetches++;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(first);
      finish = () => { controller.enqueue(rest); controller.close(); };
    } }));
  } });
  const pending = provider.generateReply({ message: 'What is a variable?', onDelta(text) {
    deltas.push(text);
    if (text === 'A variable ') finish();
  } });
  const result = await pending;
  assert.equal(result.reply, 'A variable stores a value.');
  assert.deepEqual(deltas, ['A variable ', 'stores a value.']);
  assert.equal(fetches, 1);
});

test('Gemini executes declared functions and preserves signatures without streaming speculative prose', async () => {
  const requests = [];
  const calls = [];
  const deltas = [];
  const provider = createChatProvider({ env: environment, fetchImpl: async (url, request) => {
    requests.push({ url, body: JSON.parse(request.body), signal: request.signal });
    if (requests.length === 1) return sse([gemini([
      { text: 'Let me guess which files exist.' },
      { functionCall: { name: 'search_notes', args: { query: 'normalization', semester: 3 } }, thoughtSignature: 'opaque-signature' }
    ])]);
    return sse([gemini([{ text: 'Found [DBMS notes](/files/4).' }])]);
  } });
  const result = await provider.generateReply({
    message: 'Find normalization notes in semester 3', tools: [searchTool], onDelta: text => deltas.push(text),
    executeTool: async (name, args, options) => { calls.push({ name, args, signal: options.signal }); return { results: [{ id: 4, title: 'DBMS notes' }] }; }
  });
  assert.equal(result.reply, 'Found [DBMS notes](/files/4).');
  assert.equal(deltas.join(''), result.reply);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, { query: 'normalization', semester: 3 });
  assert.equal(requests[0].body.tools[0].functionDeclarations[0].name, 'search_notes');
  assert.equal(requests[1].body.toolConfig.functionCallingConfig.mode, 'NONE');
  assert.equal(requests[1].body.contents[1].parts[1].thoughtSignature, 'opaque-signature');
  assert.equal(requests[1].body.contents[2].parts[0].functionResponse.response.result.results[0].id, 4);
  assert.ok(requests.every(request => request.signal.aborted));
});

test('OpenRouter accumulates fragmented function names and JSON arguments by index', async () => {
  const requests = [];
  const executed = [];
  const provider = createChatProvider({ env: { ...environment, CHAT_PROVIDER: 'openrouter' }, fetchImpl: async (url, request) => {
    requests.push({ url, body: JSON.parse(request.body) });
    if (requests.length === 1) return sse([
      router({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search_', arguments: '{"query":' } }] }),
      router({ tool_calls: [{ index: 0, function: { name: 'notes', arguments: '"OOP","semester"' } }] }),
      router({ tool_calls: [{ index: 0, function: { arguments: ':2}' } }] }, 'tool_calls'),
      '[DONE]'
    ], 1);
    return sse([router({ content: 'Here are your OOP notes.' }, 'stop'), '[DONE]']);
  } });
  await provider.generateReply({ message: 'semester 2 OOP notes', tools: [searchTool], executeTool: async (name, args) => {
    executed.push({ name, args }); return { results: [{ id: 2 }] };
  } });
  assert.deepEqual(executed, [{ name: 'search_notes', args: { query: 'OOP', semester: 2 } }]);
  assert.equal(requests[1].body.messages.at(-1).tool_call_id, 'call_1');
  assert.equal(requests[1].body.tool_choice, 'none');
});

test('fallback provider is used only after a primary HTTP failure', async () => {
  const urls = [];
  const provider = createChatProvider({ env: environment, fetchImpl: async url => {
    urls.push(url);
    if (urls.length === 1) return new Response('unavailable', { status: 503 });
    return sse([router({ content: 'A class is a blueprint.' }, 'stop'), '[DONE]']);
  } });
  const result = await provider.generateReply({ message: 'What is a class?' });
  assert.equal(result.provider, 'openrouter');
  assert.equal(urls.length, 2);
  assert.match(urls[0], /googleapis/);
  assert.match(urls[1], /openrouter/);
});

test('a provider timeout cancels the attempt and falls back without duplicate text', async () => {
  let originalSignal;
  let calls = 0;
  const deltas = [];
  const provider = createChatProvider({ env: environment, timeoutMs: 20, fetchImpl: async (url, request) => {
    if (++calls === 1) { originalSignal = request.signal; return new Promise(() => {}); }
    return sse([router({ content: 'The fallback answer.' }, 'stop')]);
  } });
  const result = await provider.generateReply({ message: 'Explain DBMS', onDelta: text => deltas.push(text) });
  assert.equal(result.reply, 'The fallback answer.');
  assert.equal(calls, 2);
  assert.ok(originalSignal.aborted);
  assert.deepEqual(deltas, ['The fallback answer.']);
});

test('a broken stream after visible text never starts the fallback', async () => {
  let calls = 0;
  const deltas = [];
  const provider = createChatProvider({ env: environment, fetchImpl: async () => {
    calls++;
    return sse([gemini([{ text: 'Partial answer' }], null), { error: { message: 'Internal error' } }]);
  } });
  await assert.rejects(provider.generateReply({ message: 'Explain DBMS', onDelta: text => deltas.push(text) }), error => error.streamed && error.code === 'PROVIDER_STREAM_ERROR');
  assert.equal(calls, 1);
  assert.deepEqual(deltas, ['Partial answer']);
});

test('a timeout during body streaming cancels the body and does not retry partial output', async () => {
  let cancelled = false;
  let calls = 0;
  const provider = createChatProvider({ env: environment, timeoutMs: 20, fetchImpl: async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(gemini([{ text: 'Partial' }], null))}\n\n`));
    }, cancel() { cancelled = true; } }));
  } });
  await assert.rejects(provider.generateReply({ message: 'Explain DBMS' }), error => error.code === 'PROVIDER_TIMEOUT' && error.streamed);
  assert.equal(calls, 1);
  assert.ok(cancelled);
});

test('client cancellation aborts the active request and never starts a fallback', async () => {
  const controller = new AbortController();
  let calls = 0;
  let requestSignal;
  const provider = createChatProvider({ env: environment, fetchImpl: async (url, request) => {
    calls++;
    requestSignal = request.signal;
    controller.abort();
    return new Promise(() => {});
  } });
  await assert.rejects(provider.generateReply({ message: 'Explain DBMS', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
  assert.ok(requestSignal.aborted);
});

test('unknown tool names are never executed', async () => {
  let executed = false;
  const provider = createChatProvider({ env: environment, fetchImpl: async () => sse([gemini([{ functionCall: { name: 'delete_files', args: {} } }])]) });
  await assert.rejects(provider.generateReply({ message: 'notes', tools: [searchTool], executeTool: async () => { executed = true; } }), { code: 'UNKNOWN_TOOL' });
  assert.equal(executed, false);
});

test('invalid semester filters are rejected before execution', async () => {
  let executed = false;
  const provider = createChatProvider({ env: environment, fetchImpl: async () => sse([gemini([{ functionCall: { name: 'search_notes', args: { query: 'DBMS', semester: 99 } } }])]) });
  await assert.rejects(provider.generateReply({ message: 'DBMS notes', tools: [searchTool], executeTool: async () => { executed = true; } }), { code: 'INVALID_TOOL_CALL' });
  assert.equal(executed, false);
});

test('required search forces the native tool and refuses an ungrounded response', async () => {
  let body;
  let emitted = '';
  const provider = createChatProvider({ env: environment, fetchImpl: async (url, request) => {
    body = JSON.parse(request.body);
    return sse([gemini([{ functionCall: { name: 'web_search', args: { query: 'today news' } } }])]);
  } });
  await assert.rejects(provider.generateReply({ message: 'today news', requireWebSearch: true, tools: [webTool], executeTool: async () => ({ results: [] }), onDelta: text => { emitted += text; } }), { code: 'SEARCH_UNAVAILABLE' });
  assert.deepEqual(body.toolConfig.functionCallingConfig, { mode: 'ANY', allowedFunctionNames: ['web_search'] });
  assert.equal(emitted, '');
});

test('grounded web search returns only actual HTTP source URLs and supported snippets', async () => {
  let requestBody;
  const provider = createChatProvider({ env: environment, fetchImpl: async (url, request) => {
    requestBody = JSON.parse(request.body);
    return Response.json({ candidates: [{ content: { parts: [{ text: 'A supported summary.' }] }, groundingMetadata: {
      webSearchQueries: ['latest computing news'],
      groundingChunks: [{ web: { uri: 'https://example.org/news', title: 'Computing news' } }, { web: { uri: 'javascript:alert(1)', title: 'Not a source' } }],
      groundingSupports: [{ groundingChunkIndices: [0], segment: { text: 'Supported fact.' } }]
    } }] });
  } });
  const result = await provider.webSearch('latest computing news');
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0], { title: 'Computing news', url: 'https://example.org/news', snippet: 'Supported fact.' });
  assert.deepEqual(requestBody.tools, [{ googleSearch: {} }]);
  assert.equal(result.summary, 'A supported summary.');
});

test('web search rejects metadata without both source URLs and actual search queries', async () => {
  for (const groundingMetadata of [{}, { webSearchQueries: ['query'] }, { groundingChunks: [{ web: { uri: 'https://example.org/' } }] }]) {
    const provider = createChatProvider({ env: environment, fetchImpl: async () => Response.json({ candidates: [{ content: { parts: [{ text: 'A made up answer.' }] }, groundingMetadata }] }) });
    await assert.rejects(provider.webSearch('latest news'), { code: 'SEARCH_UNAVAILABLE' });
  }
});

test('complex model is selected before the request and does not create a second generation', async () => {
  let modelUrl;
  let count = 0;
  const provider = createChatProvider({ env: { ...environment, CHAT_MODEL: 'fast-configured', CHAT_COMPLEX_MODEL: 'complex-configured' }, fetchImpl: async url => {
    count++;
    modelUrl = url;
    return sse([gemini([{ text: 'Working code.' }])]);
  } });
  await provider.generateReply({ message: 'Build a compiler', complex: true });
  assert.match(modelUrl, /complex-configured/);
  assert.equal(count, 1);
});

test('tool results are reused if the provider fails before final text and falls back', async () => {
  let requests = 0;
  let executions = 0;
  const provider = createChatProvider({ env: environment, fetchImpl: async () => {
    requests++;
    if (requests === 1) return sse([gemini([{ functionCall: { name: 'search_notes', args: { query: 'DBMS' } } }])]);
    if (requests === 2) return new Response('failure', { status: 500 });
    if (requests === 3) return sse([router({ tool_calls: [{ index: 0, id: 'lookup', function: { name: 'search_notes', arguments: '{"query":"DBMS"}' } }] }, 'tool_calls')]);
    return sse([router({ content: 'DBMS notes found.' }, 'stop')]);
  } });
  const result = await provider.generateReply({ message: 'DBMS notes', tools: [searchTool], executeTool: async () => { executions++; return { results: [{ id: 3 }] }; } });
  assert.equal(result.reply, 'DBMS notes found.');
  assert.equal(executions, 1);
  assert.equal(requests, 4);
});

test('live search falls back after a Gemini error and requires actual OpenRouter citations', async()=>{
  const calls=[];
  const provider=createChatProvider({env:environment,fetchImpl:async(url,request)=>{
    calls.push(url);
    if(url.includes('googleapis')) return new Response('',{status:429});
    const body=JSON.parse(request.body);
    assert.equal(body.tools[0].type,'openrouter:web_search');
    assert.equal(body.tools[0].parameters.max_uses,1);
    return Response.json({choices:[{message:{content:'Current sourced answer.',annotations:[{type:'url_citation',url_citation:{url:'https://example.org/current',title:'Current',content:'Source excerpt'}}]}}],usage:{server_tool_use:{web_search_requests:1}}});
  }});
  const result=await provider.webSearch('latest news');
  assert.equal(calls.length,2);assert.equal(result.provider,'openrouter_web_search');assert.equal(result.results[0].url,'https://example.org/current');
  const ungrounded=createChatProvider({env:{OPENROUTER_API_KEY:'test'},fetchImpl:async()=>Response.json({choices:[{message:{content:'Unsourced claim.'}}]})});
  await assert.rejects(ungrounded.webSearch('latest news'),{code:'SEARCH_UNAVAILABLE'});
});
