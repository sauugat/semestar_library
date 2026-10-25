'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function createStorageMock() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(k) {
      return store.has(String(k)) ? store.get(String(k)) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(String(k));
    },
    clear() {
      store.clear();
    },
    _dump() {
      return Object.fromEntries(store.entries());
    }
  };
}

function createBrowserSandbox() {
  const localStorage = createStorageMock();
  const sessionStorage = createStorageMock();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Map,
    Set,
    URL,
    URLSearchParams,
    localStorage,
    sessionStorage,
    currentUserData: null,
    SemesterAuth: {
      _user: null,
      getUserSync() {
        return this._user;
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const swrCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'swr.js'), 'utf8');
  vm.runInNewContext(swrCode, sandbox, { filename: 'public/js/swr.js' });
  return { sandbox, SWR: sandbox.SWR, localStorage, sessionStorage };
}

test('SWR User Isolation: Two different users on one browser never see each other\'s cached data', async () => {
  const { sandbox, SWR, localStorage } = createBrowserSandbox();

  // 1. Log in as User A (studentId: 26020230)
  sandbox.SemesterAuth._user = { studentId: '26020230', name: 'Aashrita' };
  sessionStorageMockSet(sandbox, sandbox.SemesterAuth._user);

  const userAData = [{ id: 101, title: 'User A Private Feed Post', studentId: '26020230' }];
  const userAResult = await SWR.get('/api/posts?limit=20', {
    fetcher: async () => userAData
  });

  assert.deepEqual(userAResult.data, userAData);
  assert.deepEqual(SWR.peek('/api/posts?limit=20')?.data, userAData);

  // Verify User A cache key includes User A's studentId
  const keyA = SWR.buildCacheKey('/api/posts?limit=20');
  assert.match(keyA, /:26020230:\/api\/posts\?limit=20$/);

  // 2. Switch active user on the same browser to User B (studentId: 26020231) WITHOUT clearing localStorage
  //    (simulates shared browser or account switch even before logout cleanup)
  sandbox.SemesterAuth._user = { studentId: '26020231', name: 'Anisha' };
  sessionStorageMockSet(sandbox, sandbox.SemesterAuth._user);

  const keyB = SWR.buildCacheKey('/api/posts?limit=20');
  assert.match(keyB, /:26020231:\/api\/posts\?limit=20$/);
  assert.notEqual(keyA, keyB, 'Cache keys for User A and User B must be strictly distinct');

  // User B peeking the exact same endpoint MUST NOT see User A's cached data
  const peekBBeforeFetch = SWR.peek('/api/posts?limit=20');
  assert.equal(peekBBeforeFetch, null, 'User B must not see User A cached entry via SWR.peek');

  // When User B calls SWR.get(), onData must NOT emit User A's cached data
  const seenByUserB = [];
  const userBData = [{ id: 202, title: 'User B Private Feed Post', studentId: '26020231' }];
  await SWR.get('/api/posts?limit=20', {
    fetcher: async () => userBData,
    onData: (data, meta) => {
      seenByUserB.push({ data, meta });
    }
  });

  assert.equal(seenByUserB.length, 1, 'User B should only receive fresh network data, never User A cache');
  assert.equal(seenByUserB[0].meta.source, 'network');
  assert.deepEqual(seenByUserB[0].data, userBData);

  // 3. On logout, SWR.clearAll() wipes all cached entries from memory and localStorage
  SWR.clearAll();
  assert.equal(SWR.peek('/api/posts?limit=20'), null);
  const remainingSwrKeys = Object.keys(localStorage._dump()).filter((k) => k.startsWith('sl_swr_'));
  assert.equal(remainingSwrKeys.length, 0, 'SWR.clearAll() must purge all SWR keys on logout');
});

function sessionStorageMockSet(sandbox, user) {
  sandbox.sessionStorage.setItem('sl_user_cache', JSON.stringify(user));
}
