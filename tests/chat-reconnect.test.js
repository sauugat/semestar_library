'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../mobile/node_modules/typescript');
class ApiError extends Error { constructor(status) { super('API error'); this.status = status; } }
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
function load(file, imports) {
  const timers = new Map(); let id = 0;
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../mobile/services', file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require','module','exports','setTimeout','clearTimeout',code)(name => imports[name], module, module.exports,
    (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, key => timers.delete(key));
  return { api: module.exports, timers, async advance(ms) {
    const entry = [...timers].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `expected timer at ${ms}ms`); timers.delete(entry[0]); entry[1].fn(); await flush();
  } };
}
function provider() {
  const channels = [];
  return { channels, createClient: () => ({ realtime: { setAuth: async () => {} },
    channel: () => {
      const channel = { handlers: {}, on(_type, filter, cb) { this.handlers[filter.event] = cb; return this; },
        subscribe(cb) { this.status = cb; cb('SUBSCRIBED'); return this; } };
      channels.push(channel); return channel;
    }, removeAllChannels: async () => {}, removeChannel: async () => {},
  }) };
}

test('DM reconnect ignores status and messages from replaced channels', async () => {
  const rt = provider(), states = [], messages = [];
  const f = load('dm-realtime.ts', { '@supabase/supabase-js': rt, './api': { ApiError },
    './dm': { fetchDmRealtimeConfig: async () => ({ supabaseUrl: 'https://fixture.invalid', key: 'fixture',
      token: 'fixture', topic: 'dm:room:1', expiresAt: new Date(Date.now()+120000).toISOString() }) },
  });
  const stop = f.api.subscribeDmConversationRealtime('room', { onConnectionChange: value => states.push(value), onNewMessage: value => messages.push(value) });
  await flush(); const old = rt.channels[0]; old.status('CHANNEL_ERROR');
  await f.advance(1000); assert.equal(rt.channels.length, 2);
  const count = states.length; old.status('CLOSED');
  old.handlers['dm:message:new']({ payload: { messageId: 1, conversationId: 'room' } });
  assert.equal(states.length, count); assert.equal(messages.length, 0);
  stop(); assert.equal(f.timers.size, 0);
});

test('cohort reconnect backs off after network failures and stops after logout', async () => {
  const rt = provider(); let fail = true, current = true;
  const session = { context: { chatGroupId: 'room', realtimeEpoch: 1 } };
  const f = load('chat-realtime.ts', { '@supabase/supabase-js': rt, './api': { ApiError },
    './chat-session': { getChatSession: () => session, isCurrentChatSession: () => current,
      subscribeChatSession: () => {}, assertLocalChatServer: () => {} },
    './chat-db': { applyCachedChatEvent: async () => true }, './chat-events': { CHAT_EVENTS: [], decodeChatEvent: () => null },
    './chat': { fetchRealtimeConfig: async () => {
      if (fail) throw Error('offline');
      return { ...session.context, topic: 'chat:room:1', expiry: new Date(Date.now()+120000).toISOString(), url:'https://fixture.invalid',key:'fixture',token:'fixture' };
    } },
  });
  await f.api.initChatRealtime(); await f.advance(1000);
  assert.ok([...f.timers.values()].some(timer => timer.ms === 2000));
  fail = false; await f.advance(2000); assert.equal(rt.channels.length, 1);
  rt.channels[0].status('CHANNEL_ERROR');
  current = false; await f.api.disconnectChatRealtime(); assert.equal(f.timers.size, 0);
});

test('cohort authorization failure does not start an automatic retry loop', async () => {
  const session = { context: { chatGroupId: 'room', realtimeEpoch: 1 } };
  const f = load('chat-realtime.ts', { './api': { ApiError }, '@supabase/supabase-js': provider(),
    './chat-session': { getChatSession: () => session, isCurrentChatSession: () => true, subscribeChatSession: () => {} },
    './chat-db': {}, './chat-events': {}, './chat': { fetchRealtimeConfig: async () => { throw new ApiError(403); } },
  });
  await f.api.initChatRealtime(); assert.equal(f.timers.size, 0);
});
