'use strict';

/**
 * PHASE C2: DM Account Isolation, Web Realtime & Offline Outbox Behavior Tests
 *
 * Every test executes real module/runtime code (VM or transpiled TypeScript + SQLite)
 * rather than regex source-text checks:
 * - C1: Web DM realtime uses config.key (anon key) for createClient and calls realtime.setAuth(config.token)
 * - C2: Web DM realtime schedules token renewal before expiry, reconnects with backoff on CHANNEL_ERROR/TIMED_OUT, and runs catch-up sync on SUBSCRIBED
 * - C3: Web DM realtime accepts flat dm:message:new payload and deduplicates by eventId, messageId, and clientId
 * - D1: Web DM persists unsent messages in localStorage keyed origin::studentId::conversationId, retries with the same clientId, shows Retry/Discard on failure, and isolates accounts
 * - D2 & D3: Executing SemesterAuth.logout() in public/auth.js calls window.dmClient.clearAccountData() (wiping DM outbox) and removes legacy kyana_chat_sessions_v1 before redirecting to /login.html
 * - D4: Executing clearCachedKyanaMessages() in mobile/services/kyana-db.ts against SQLite clears all cached messages when called with no args, and executing AuthProvider logout/setSession in mobile/context/AuthContext.tsx invokes clearCachedKyanaMessages()
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('../mobile/node_modules/typescript');

const dmWebClientPath = path.join(__dirname, '..', 'public', 'dm-chat-client.js');
const authJsPath = path.join(__dirname, '..', 'public', 'auth.js');

function loadTsModule(relPathFromMobile, dependencies = {}) {
  const fullPath = path.join(__dirname, '..', 'mobile', relPathFromMobile);
  const code = ts.transpileModule(fs.readFileSync(fullPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__DEV__', code)(
    (name) => {
      if (!(name in dependencies)) {
        throw new Error(`Unexpected import in ${relPathFromMobile}: ${name}`);
      }
      return dependencies[name];
    },
    mod,
    mod.exports,
    true
  );
  return mod.exports;
}

function createDomSandbox({ origin = 'http://localhost:3310', fetchImpl } = {}) {
  const storageMap = new Map();
  const localStorage = {
    get length() {
      return storageMap.size;
    },
    key(index) {
      return Array.from(storageMap.keys())[index] ?? null;
    },
    getItem(k) {
      return storageMap.has(k) ? storageMap.get(k) : null;
    },
    setItem(k, v) {
      storageMap.set(String(k), String(v));
    },
    removeItem(k) {
      storageMap.delete(String(k));
    },
    clear() {
      storageMap.clear();
    },
    _map: storageMap,
  };

  const sessionMap = new Map();
  const sessionStorage = {
    get length() {
      return sessionMap.size;
    },
    key(index) {
      return Array.from(sessionMap.keys())[index] ?? null;
    },
    getItem(k) {
      return sessionMap.has(k) ? sessionMap.get(k) : null;
    },
    setItem(k, v) {
      sessionMap.set(String(k), String(v));
    },
    removeItem(k) {
      sessionMap.delete(String(k));
    },
    clear() {
      sessionMap.clear();
    },
  };

  const elements = new Map();
  function makeElement(id) {
    const el = {
      id,
      innerHTML: '',
      textContent: '',
      value: '',
      disabled: false,
      scrollTop: 0,
      scrollHeight: 500,
      style: {},
      dataset: {},
      classList: {
        _set: new Set(),
        add(...cls) { cls.forEach(c => this._set.add(c)); },
        remove(...cls) { cls.forEach(c => this._set.delete(c)); },
        toggle(c, force) {
          if (force === undefined) {
            if (this._set.has(c)) this._set.delete(c);
            else this._set.add(c);
          } else if (force) {
            this._set.add(c);
          } else {
            this._set.delete(c);
          }
        },
        contains(c) { return this._set.has(c); },
      },
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      querySelector() { return makeElement(''); },
      querySelectorAll() { return []; },
      appendChild() {},
      remove() {},
      focus() {},
      scrollTo() {},
      scrollIntoView() {},
    };
    return el;
  }

  const knownIds = [
    'chatModeBar',
    'modeBtnCohort',
    'modeBtnDm',
    'cohortChatMain',
    'dmMain',
    'dmLayout',
    'dmGlobalUnreadBadge',
    'dmTabUnreadBadge',
    'dmConvList',
    'dmConvSearchInput',
    'dmNewMsgBtn',
    'dmNoConvPlaceholder',
    'dmActiveChatWrap',
    'dmHeaderBackBtn',
    'dmPeerAvatar',
    'dmPeerName',
    'dmPeerRoleBadge',
    'dmPeerStatusText',
    'dmPeerStatusDot',
    'dmConnBanner',
    'dmHeaderMenuBtn',
    'dmHeaderDropdown',
    'dmTimeline',
    'dmTimelineLoader',
    'dmComposerWrap',
    'dmComposerContextBar',
    'dmComposerContextTitle',
    'dmComposerContextSnippet',
    'dmComposerContextCancelBtn',
    'dmTextarea',
    'dmCharCounter',
    'dmSendBtn',
    'dmEmojiToggleBtn',
    'dmEmojiDrawer',
    'dmBlockedBanner',
    'dmUnblockBtn',
  ];
  for (const id of knownIds) {
    elements.set(id, makeElement(id));
  }

  const timers = [];
  let nextTimerId = 1;
  const setTimeoutStub = (fn, delay) => {
    const id = nextTimerId++;
    timers.push({ id, fn, delay, cleared: false });
    return id;
  };
  const clearTimeoutStub = (id) => {
    const t = timers.find(x => x.id === id);
    if (t) t.cleared = true;
  };

  const supabaseCalls = {
    createClientArgs: [],
    setAuthCalls: [],
    channels: [],
    removedChannels: [],
    signOutCalls: 0,
  };

  const supabaseMock = {
    createClient(url, key, opts) {
      supabaseCalls.createClientArgs.push({ url, key, opts });
      return {
        auth: {
          async getSession() { return { data: { session: null }, error: null }; },
          async signOut() { supabaseCalls.signOutCalls++; return { error: null }; },
          onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
        },
        realtime: {
          setAuth(token) {
            supabaseCalls.setAuthCalls.push(token);
          },
        },
        channel(topic, channelOpts) {
          const handlers = {};
          const ch = {
            topic,
            channelOpts,
            handlers,
            subscribeCallback: null,
            on(type, filter, cb) {
              if (type === 'broadcast' && filter && filter.event) {
                handlers[filter.event] = cb;
              }
              return ch;
            },
            subscribe(cb) {
              ch.subscribeCallback = cb;
              return ch;
            },
          };
          supabaseCalls.channels.push(ch);
          return ch;
        },
        removeChannel(ch) {
          supabaseCalls.removedChannels.push(ch);
        },
      };
    },
  };

  let uuidCounter = 1;
  const locationEvents = [];
  let currentHref = `${origin}/chat.html`;
  const locationObj = {
    origin,
    pathname: '/chat.html',
    search: '',
    get href() { return currentHref; },
    set href(val) {
      currentHref = val;
      locationEvents.push({ type: 'redirect', href: val });
    },
    replace(val) {
      currentHref = val;
      locationEvents.push({ type: 'replace', href: val });
    },
  };

  const windowObj = {
    location: locationObj,
    navigator: { onLine: true },
    crypto: { randomUUID: () => `uuid-test-${uuidCounter++}` },
    localStorage,
    sessionStorage,
    supabase: supabaseMock,
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-public-key',
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({}) })),
    setTimeout: setTimeoutStub,
    clearTimeout: clearTimeoutStub,
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener() {},
    removeEventListener() {},
    confirm: () => true,
    alert: () => {},
  };

  const documentObj = {
    readyState: 'complete',
    hidden: false,
    head: { appendChild() {} },
    documentElement: { classList: makeElement('').classList },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) {
      let _text = '';
      return {
        tagName: tag,
        style: {},
        classList: makeElement('').classList,
        set textContent(v) { _text = String(v ?? ''); },
        get textContent() { return _text; },
        get innerHTML() {
          return _text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        },
        set innerHTML(v) { _text = String(v ?? ''); },
        appendChild() {},
        addEventListener() {},
      };
    },
    addEventListener() {},
  };

  const context = vm.createContext({
    window: windowObj,
    document: documentObj,
    navigator: windowObj.navigator,
    crypto: windowObj.crypto,
    location: windowObj.location,
    localStorage,
    sessionStorage,
    fetch: (...args) => windowObj.fetch(...args),
    setTimeout: setTimeoutStub,
    clearTimeout: clearTimeoutStub,
    setInterval: windowObj.setInterval,
    clearInterval: windowObj.clearInterval,
    URLSearchParams,
    Proxy,
    console,
    Date,
    Math,
    JSON,
    Promise,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    encodeURIComponent,
    decodeURIComponent,
  });

  const code = fs.readFileSync(dmWebClientPath, 'utf8');
  vm.runInContext(code, context);

  windowObj.dmClient.bindDOM();

  return {
    context,
    window: windowObj,
    document: documentObj,
    localStorage,
    sessionStorage,
    locationEvents,
    elements,
    timers,
    supabaseCalls,
    dmClient: windowObj.dmClient,
  };
}

test('C1 & C2: Web DM realtime uses config.key (anon key), calls realtime.setAuth(token), renews before expiry, reconnects with backoff, and syncs on SUBSCRIBED', async () => {
  let syncCalls = 0;
  let configCalls = 0;
  const futureExpiry = new Date(Date.now() + 90_000).toISOString();

  const h = createDomSandbox({
    fetchImpl: async (url) => {
      if (url.includes('/realtime-config')) {
        configCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            url: 'https://example.supabase.co',
            key: 'anon-public-key-123',
            token: `scoped-jwt-token-${configCalls}`,
            topic: 'dm:conv-1:1',
            expiresAt: futureExpiry,
          }),
        };
      }
      if (url.includes('/sync')) {
        syncCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: [],
            edits: [],
            deletions: [],
            readCursor: { peerLastReadMessageId: 10 },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  const state = h.dmClient;
  state.currentUser = { studentId: '99000001' };
  state.activeConversation = { id: 'conv-1', participant: { studentId: '99000002' } };

  await h.dmClient.subscribeRealtime('conv-1');

  // C1: createClient called with anon key (config.key), NOT scoped token
  assert.equal(h.supabaseCalls.createClientArgs.length, 1);
  assert.equal(h.supabaseCalls.createClientArgs[0].url, 'https://example.supabase.co');
  assert.equal(h.supabaseCalls.createClientArgs[0].key, 'anon-public-key-123');

  // C1: realtime.setAuth called with scoped token
  assert.deepEqual(h.supabaseCalls.setAuthCalls, ['scoped-jwt-token-1']);

  // C2: channel subscribed and SUBSCRIBED triggers catch-up sync + renewal timer
  assert.equal(h.supabaseCalls.channels.length, 1);
  const channel = h.supabaseCalls.channels[0];
  assert.equal(channel.topic, 'dm:conv-1:1');

  channel.subscribeCallback('SUBSCRIBED');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(syncCalls, 1, 'Catch-up sync should run on SUBSCRIBED');

  // Verify token renewal timer was scheduled
  const activeTimersAfterSubscribe = h.timers.filter(t => !t.cleared);
  assert.ok(activeTimersAfterSubscribe.length >= 1, 'Token renewal timer should be scheduled');

  // Trigger renewal timer callback and verify realtime.setAuth receives renewed token
  await activeTimersAfterSubscribe[0].fn();
  assert.equal(configCalls, 2);
  assert.equal(h.supabaseCalls.setAuthCalls[1], 'scoped-jwt-token-2');

  // C2: CHANNEL_ERROR on the active renewed channel schedules reconnect with backoff
  const renewedChannel = h.supabaseCalls.channels[1];
  const timersBeforeError = h.timers.length;
  renewedChannel.subscribeCallback('CHANNEL_ERROR');
  assert.ok(h.timers.length > timersBeforeError, 'Reconnect timer should be scheduled on CHANNEL_ERROR');
});

test('C3: Web DM handleIncomingMessage accepts flat dm:message:new payload and deduplicates by eventId, messageId, and clientId', async () => {
  const h = createDomSandbox();
  const state = h.dmClient;
  state.currentUser = { studentId: '99000001' };
  state.activeConversation = { id: 'conv-flat', participant: { studentId: '99000002' } };
  state.conversations = [{ id: 'conv-flat', unreadCount: 0, participant: { studentId: '99000002' } }];

  // Flat broadcast payload (as emitted by lib/dm-service.js outbox)
  const flatPayload = {
    eventId: 'evt-100',
    conversationId: 'conv-flat',
    messageId: 501,
    senderId: '99000002',
    clientId: 'client-uuid-501',
    text: 'Flat realtime message',
    replyToId: null,
    replyTo: null,
    createdAt: '2026-03-30T10:00:00.000Z',
  };

  h.dmClient.handleIncomingMessage(flatPayload);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].id, 501);
  assert.equal(state.messages[0].text, 'Flat realtime message');
  assert.equal(state.messages[0].senderId, '99000002');
  assert.equal(state.messages[0].clientId, 'client-uuid-501');

  // Dedupe by same eventId
  h.dmClient.handleIncomingMessage({ ...flatPayload, messageId: 999, clientId: 'other' });
  assert.equal(state.messages.length, 1, 'Duplicate eventId must be ignored');

  // Dedupe by same messageId with new eventId
  h.dmClient.handleIncomingMessage({ ...flatPayload, eventId: 'evt-101', clientId: 'other-2' });
  assert.equal(state.messages.length, 1, 'Duplicate messageId must be ignored');

  // Dedupe / replace by same clientId (e.g., optimistic message already present)
  state.messages.push({
    id: 'temp_client-opt-1',
    clientId: 'client-opt-1',
    senderId: '99000001',
    text: 'Optimistic msg',
    status: 'sending',
  });
  h.dmClient.handleIncomingMessage({
    eventId: 'evt-102',
    conversationId: 'conv-flat',
    messageId: 502,
    senderId: '99000001',
    clientId: 'client-opt-1',
    text: 'Optimistic msg',
    createdAt: '2026-03-30T10:01:00.000Z',
  });
  assert.equal(state.messages.length, 2, 'Optimistic message with matching clientId should be replaced in-place, not duplicated');
  assert.equal(state.messages[1].id, 502);
  assert.equal(state.messages[1].status, 'sent');
});

test('D1: Web DM persists unsent messages in localStorage keyed origin::studentId::conversationId, keeps failed messages with Retry/Discard, and isolates accounts', async () => {
  let shouldFailSend = true;
  const sentClientIds = [];

  const h = createDomSandbox({
    origin: 'http://localhost:3310',
    fetchImpl: async (url, opts) => {
      if (url.endsWith('/messages') && opts && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        sentClientIds.push(body.clientId);
        if (shouldFailSend) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Network/Server Failure' }),
          };
        }
        return {
          ok: true,
          status: 201,
          json: async () => ({
            message: {
              id: 777,
              conversationId: 'conv-d1',
              senderId: '99000001',
              clientId: body.clientId,
              text: body.text,
              createdAt: '2026-03-30T12:00:00.000Z',
            },
          }),
        };
      }
      if (url.includes('/messages?limit=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [], nextCursor: null, hasMore: false }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  const state = h.dmClient;
  state.currentUser = { studentId: '99000001' };
  state.activeConversation = { id: 'conv-d1', participant: { studentId: '99000002' } };
  state.conversations = [{ id: 'conv-d1', unreadCount: 0, participant: { studentId: '99000002' } }];

  const input = h.document.getElementById('dmTextarea');
  input.value = 'Offline unsent message';

  // 1. Attempt send while failing -> message must NOT be deleted; must be marked failed and persisted in localStorage
  await h.dmClient.sendMessage();

  assert.equal(state.messages.length, 1);
  const failedMsg = state.messages[0];
  assert.equal(failedMsg.status, 'failed');
  assert.equal(failedMsg.text, 'Offline unsent message');
  assert.ok(failedMsg.clientId);

  const expectedKey = 'http://localhost:3310::99000001::conv-d1';
  const rawStored = h.localStorage.getItem(expectedKey);
  assert.ok(rawStored, `Outbox must be persisted under ${expectedKey}`);
  const parsedOutbox = JSON.parse(rawStored);
  assert.equal(parsedOutbox.length, 1);
  assert.equal(parsedOutbox[0].clientId, failedMsg.clientId);
  assert.equal(parsedOutbox[0].status, 'failed');

  // Verify rendered HTML includes Retry and Discard buttons
  const containerHtml = h.document.getElementById('dmTimeline').innerHTML;
  assert.ok(containerHtml.includes('retryFailedMessage'), 'Failed message must render Retry button');
  assert.ok(containerHtml.includes('discardFailedMessage'), 'Failed message must render Discard button');

  // 2. Retry with the SAME clientId when network recovers
  shouldFailSend = false;
  await h.dmClient.retryFailedMessage(failedMsg.clientId);

  assert.equal(sentClientIds.length, 2);
  assert.equal(sentClientIds[0], sentClientIds[1], 'Retry must reuse the exact same clientId');
  assert.equal(state.messages[0].id, 777);
  assert.equal(state.messages[0].status, 'sent');
  assert.equal(h.localStorage.getItem(expectedKey), null, 'Outbox entry must be removed after successful send');

  // 3. Test Discard removes failed message from state and localStorage
  shouldFailSend = true;
  input.value = 'Message to discard';
  await h.dmClient.sendMessage();
  assert.equal(state.messages.length, 2);
  const msgToDiscard = state.messages[1];
  assert.equal(msgToDiscard.status, 'failed');
  assert.ok(h.localStorage.getItem(expectedKey));

  h.dmClient.discardFailedMessage(msgToDiscard.clientId);
  assert.equal(state.messages.length, 1);
  assert.equal(h.localStorage.getItem(expectedKey), null);

  // 4. Test Account Isolation: User A's outbox is not loaded by User B and clearAccountData clears User A's keys
  shouldFailSend = true;
  input.value = 'User A secret draft';
  await h.dmClient.sendMessage();
  assert.ok(h.localStorage.getItem(expectedKey));

  // Switch to User B (99000002) and loadMessages -> User A's outbox is NOT visible to User B
  state.currentUser = { studentId: '99000002' };
  await h.dmClient.loadMessages('conv-d1');
  assert.equal(state.messages.length, 0, 'User B must not see User A outbox messages');

  // Switch back to User A and clearAccountData on logout
  state.currentUser = { studentId: '99000001' };
  h.dmClient.clearAccountData();
  assert.equal(h.localStorage.getItem(expectedKey), null, 'clearAccountData must wipe current user outbox keys');
  assert.equal(state.messages.length, 0);
  assert.equal(state.currentUser, null);
});

test('D2 & D3: Executing SemesterAuth.logout() in public/auth.js calls window.dmClient.clearAccountData() and removes kyana_chat_sessions_v1 before redirecting', async () => {
  const h = createDomSandbox({ origin: 'http://localhost:3310' });

  // Load public/auth.js into the same VM sandbox
  const authCode = fs.readFileSync(authJsPath, 'utf8');
  vm.runInContext(authCode, h.context);

  // Seed active DM user state, DM outbox key, and legacy Kyana session keys
  h.dmClient.currentUser = { studentId: '99000001' };
  h.dmClient.activeConversation = { id: 'conv-logout-1' };
  h.dmClient.conversations = [{ id: 'conv-logout-1' }];
  h.dmClient.messages = [{ id: 1, text: 'Secret DM' }];

  const dmOutboxKey = 'http://localhost:3310::99000001::conv-logout-1';
  h.localStorage.setItem(dmOutboxKey, JSON.stringify([{ clientId: 'c1', text: 'Draft' }]));
  h.localStorage.setItem('kyana_chat_sessions_v1', JSON.stringify([{ id: 's1', title: 'Old Kyana Session' }]));
  h.localStorage.setItem('kyana_active_session_id', 's1');

  const eventsOrder = [];
  const origClear = h.dmClient.clearAccountData.bind(h.dmClient);
  h.dmClient.clearAccountData = () => {
    eventsOrder.push('dmClient.clearAccountData');
    return origClear();
  };

  await h.window.SemesterAuth.logout();
  if (h.locationEvents.length > 0) {
    eventsOrder.push(`redirect:${h.locationEvents[0].href}`);
  }

  assert.deepEqual(
    eventsOrder,
    ['dmClient.clearAccountData', 'redirect:/login.html'],
    'SemesterAuth.logout() must execute dmClient.clearAccountData() BEFORE redirecting to /login.html'
  );
  assert.equal(h.localStorage.getItem(dmOutboxKey), null, 'DM outbox key must be wiped on logout');
  assert.equal(h.localStorage.getItem('kyana_chat_sessions_v1'), null, 'kyana_chat_sessions_v1 must be removed on logout');
  assert.equal(h.localStorage.getItem('kyana_active_session_id'), null, 'kyana_active_session_id must be removed on logout');
  assert.equal(h.dmClient.currentUser, null);
  assert.equal(h.dmClient.messages.length, 0);
});

test('D4: Executing mobile kyana-db.ts against SQLite clears all cached messages with no args, and AuthContext.tsx calls it at runtime on logout and account switch', async () => {
  // 1. Real SQLite execution of mobile/services/kyana-db.ts
  const sql = new DatabaseSync(':memory:');
  const sqliteApi = {
    execAsync: async (query) => sql.exec(query),
    runAsync: async (query, values = []) => sql.prepare(query).run(...values),
    getAllAsync: async (query, values = []) => sql.prepare(query).all(...values),
    withExclusiveTransactionAsync: async (callback) => {
      sql.exec('BEGIN');
      try {
        await callback(sqliteApi);
        sql.exec('COMMIT');
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };

  const kyanaDb = loadTsModule('services/kyana-db.ts', {
    'expo-sqlite': { openDatabaseAsync: async () => sqliteApi },
  });

  await kyanaDb.saveCachedKyanaMessages('99000001', 'conv_a', [
    { id: 'm1', conversationId: 'conv_a', sender: 'user', text: 'User A question', createdAt: '2026-10-25T10:00:00Z' },
  ]);
  await kyanaDb.saveCachedKyanaMessages('99000002', 'conv_b', [
    { id: 'm2', conversationId: 'conv_b', sender: 'assistant', text: 'User B answer', createdAt: '2026-10-25T10:01:00Z' },
  ]);

  assert.equal((await kyanaDb.getCachedKyanaMessages('99000001', 'conv_a')).length, 1);
  assert.equal((await kyanaDb.getCachedKyanaMessages('99000002', 'conv_b')).length, 1);

  // Clear all cached Kyana messages with no arguments (as called by AuthContext)
  await kyanaDb.clearCachedKyanaMessages();

  assert.deepEqual(await kyanaDb.getCachedKyanaMessages('99000001', 'conv_a'), []);
  assert.deepEqual(await kyanaDb.getCachedKyanaMessages('99000002', 'conv_b'), []);
  const remainingRows = sql.prepare('SELECT COUNT(*) AS c FROM kyana_messages_cache_v1').get();
  assert.equal(Number(remainingRows.c), 0, 'SQLite kyana_messages_cache_v1 table must be completely empty after clearCachedKyanaMessages()');
  sql.close();

  // 2. Real runtime execution of mobile/context/AuthContext.tsx logout() and setSession()
  let kyanaClearCalls = 0;
  let capturedContextValue = null;
  let suspensionCb = null;

  const mockReact = {
    createContext: () => ({
      Provider: ({ value }) => {
        capturedContextValue = value;
        return null;
      },
    }),
    useContext: () => capturedContextValue,
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: (fn) => { fn(); },
  };

  const authMod = loadTsModule('context/AuthContext.tsx', {
    react: mockReact,
    'react/jsx-runtime': {
      jsx: (type, props) => (typeof type === 'function' ? type(props) : { type, props }),
      jsxs: (type, props) => (typeof type === 'function' ? type(props) : { type, props }),
    },
    'expo-secure-store': {
      getItemAsync: async () => null,
      setItemAsync: async () => {},
      deleteItemAsync: async () => {},
    },
    'expo-router': {
      router: { replace: () => {} },
    },
    '@/services/chat-db': { clearChatDb: async () => {} },
    '@/services/chat-realtime': { disconnectChatRealtime: async () => {} },
    '@/services/dm-db': { clearAllDmCache: async () => {} },
    '@/services/dm-realtime': { disconnectAllDmRealtime: () => {} },
    '@/services/kyana-db': {
      clearCachedKyanaMessages: async () => { kyanaClearCalls++; },
    },
    '@/services/chat-session': {
      invalidateChatSession: () => {},
      beginChatSession: () => {},
    },
    '@/services/query-client': { clearAppQueryCache: async () => {} },
    '@/services/api': {
      getAutoDetectedServerUrl: () => 'http://localhost:3310',
      getBaseUrl: async () => 'http://localhost:3310',
      isTrustedServerUrl: () => true,
      DEFAULT_SERVER_URL: 'http://localhost:3310',
      addSuspensionListener: (cb) => {
        suspensionCb = cb;
        return () => {};
      },
    },
    '@/services/notifications': {
      registerPushToken: async () => {},
      unregisterPushToken: async () => {},
      consumePendingNotification: () => null,
      navigateFromNotification: () => {},
      resetNotificationNavigationState: () => {},
    },
  });

  // Mount AuthProvider to populate capturedContextValue
  authMod.AuthProvider({ children: null });
  assert.ok(capturedContextValue, 'AuthProvider must expose context methods');

  await capturedContextValue.logout();
  assert.equal(kyanaClearCalls, 1, 'AuthContext.logout() must call clearCachedKyanaMessages() at runtime');

  await capturedContextValue.setSession('tok-new', { studentId: '99000002', name: 'Numeric Student', role: 'student' });
  assert.equal(kyanaClearCalls, 2, 'AuthContext.setSession() must call clearCachedKyanaMessages() on account switch');

  await capturedContextValue.updateServerUrl('http://localhost:3310');
  assert.equal(kyanaClearCalls, 3, 'AuthContext.updateServerUrl() must call clearCachedKyanaMessages()');

  if (suspensionCb) {
    await suspensionCb('Suspended');
    assert.equal(kyanaClearCalls, 4, 'Suspension listener must call clearCachedKyanaMessages()');
  }
});
