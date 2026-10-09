const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ts = require('../mobile/node_modules/typescript');
function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../mobile', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in dependencies)) throw Error(name);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const state = load('services/chat-state.ts');
const session = load('services/chat-session.ts');
function configureCache(server,account) { const start=session.beginChatSession(server,account); session.acceptChatContext(start,{studentId:account,chatGroupId:'mercury',cohortId:'cohort',groupCode:'MERCURY',currentSemester:1,cohortStatus:'active',roomStatus:'active',realtimeEpoch:1}); }
const msg = id => ({ id, chatGroupId: 'mercury', text: String(id), studentId: 'a', createdAt: '2026-09-28T12:00:00Z' });
function database() {
  const sql = new DatabaseSync(':memory:');
  const api = {
    execAsync: async query => sql.exec(query),
    runAsync: async (query, values = []) => sql.prepare(query).run(...values),
    getAllAsync: async (query, values = []) => sql.prepare(query).all(...values),
    getFirstAsync: async (query, values = []) => sql.prepare(query).get(...values),
    withExclusiveTransactionAsync: async callback => {
      sql.exec('BEGIN');
      try { await callback(api); sql.exec('COMMIT'); } catch (e) { sql.exec('ROLLBACK'); throw e; }
    }
  };
  const deps = { 'expo-sqlite': { openDatabaseAsync: async () => api }, './chat-state': state, './chat-session': session };
  return { deps, sql };
}
test('SQLite persists pending attachments, resolves broadcasts once, isolates accounts and caps history', async () => {
  const { deps, sql } = database();
  const cache = load('services/chat-db.ts', deps);
  configureCache('https://school', 'a');
  await cache.upsertChatMessages(Array.from({ length: 550 }, (_, i) => msg(i + 1)));
  const pending = { ...msg(-123), status: 'pending', localUri: 'file:///outbox/photo.jpg', pendingFile: { uri: 'file:///outbox/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' } };
  await cache.savePendingMessage(pending);
  assert.equal((await cache.getCachedChatMessages())[0].id, -123);
  assert.equal((await cache.getCachedChatMessages(1000)).length, 501);
  const relaunched = load('services/chat-db.ts', deps);
  configureCache('https://school', 'a');
  const restored = (await relaunched.getCachedChatMessages())[0];
  assert.equal(restored.status, 'failed');
  assert.deepEqual(restored.pendingFile, pending.pendingFile);
  await Promise.all([cache.upsertChatMessages([msg(551)]), cache.resolvePendingMessage(-123, msg(551))]);
  assert.equal((await cache.getCachedChatMessages()).filter(m => m.id === 551).length, 1);
  assert.equal((await cache.getCachedChatMessages()).some(m => m.id < 0), false);
  await cache.updateCachedReaction(551, 'b', '👍', 'add');
  await cache.updateCachedReaction(551, 'b', '👍', 'add');
  assert.equal((await cache.getCachedChatMessages())[0].reactions.length, 1);
  await cache.deleteCachedMessage(551);
  assert.equal((await cache.getCachedChatMessages())[0].id, 550);
  configureCache('https://school', 'b');
  assert.deepEqual(await cache.getCachedChatMessages(), []);
  configureCache('https://other', 'a');
  assert.deepEqual(await cache.getCachedChatMessages(), []);
  configureCache('https://school', 'a');
  await cache.reconcileCachedChat([msg(600), msg(599)], 550);
  assert.deepEqual((await cache.getCachedChatMessages()).map(m => m.id), [600, 599]);
  await cache.clearChatDb();
  sql.close();
});
test('browser cache persists updates, reactions, deletions and handles storage failures', () => {
  const { createChatCache } = require('../public/chat-cache');
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const cache = createChatCache(storage, 'a', 'http://localhost', 'mercury');
  cache.merge([msg(2), msg(1)]);
  cache.react(2, 'a', '👍', 'add');
  cache.react(2, 'a', '❤️', 'update');
  cache.react(2, 'a', '❤️', 'update');
  assert.deepEqual(createChatCache(storage, 'a', 'http://localhost', 'mercury').get()[1].reactions, [{ studentId: 'a', emoji: '❤️' }]);
  cache.remove(1);
  assert.equal(createChatCache(storage, 'a', 'http://localhost', 'mercury').get().length, 1);
  assert.equal(createChatCache(storage, 'b', 'http://localhost', 'mercury').get().length, 0);
  const blocked = createChatCache({ getItem() { throw Error(); }, setItem() { throw Error(); } }, 'a', 'http://localhost', 'mercury');
  blocked.merge([msg(1)]);
  assert.equal(blocked.get().length, 1);
});
test('file normalization never pretends HEIC bytes are JPEG or unknown bytes are PDF', () => {
  const { normalizeUploadFile } = load('utils/file-upload.ts');
  const heic = normalizeUploadFile({ uri: 'file:///image.heic', mimeType: 'image/heic' });
  assert.equal(heic.name, 'image.heic');
  assert.equal(heic.type, 'image/heic');
  assert.equal(normalizeUploadFile({ uri: 'file:///unknown' }).type, 'application/octet-stream');
});

test('realtime requires a validated room; an account ID alone cannot subscribe', async () => {
  const { mobile, realtime: transport, load } = require('./helpers/cohort-client-fixture');
  const f=mobile(), rt=transport();
  const service=load('services/chat-realtime.ts',{
    './chat-session':f.session,'./chat-db':f.cache,'./chat-events':f.events,
    './chat':{fetchRealtimeConfig:async()=>{throw Error('must not request config before room validation');}},
    '@supabase/supabase-js':rt,
  });
  await service.initChatRealtime('a','http://localhost');
  assert.equal(rt.channels.length,0);
  await service.disconnectChatRealtime();f.sql.close();
});

test('native photo/file controls expose long-press actions and visible actions; unsent messages cannot react/reply/pin', () => {
  const React = require('../mobile/node_modules/react');
  const native = {
    View: 'View', TouchableOpacity: 'TouchableOpacity', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', Modal: 'Modal',
    Text: 'Text',
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove: () => {} }) },
    StyleSheet: { create: value => value, absoluteFill: {} },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    Animated: { View: 'AnimatedView', Value: class { interpolate() { return 0; } } },
    PanResponder: { create: handlers => ({ panHandlers: handlers }) },
  };
  const dependencies = {
    react: {
      ...React,
      useRef: value => ({ current: value }),
      useMemo: callback => callback(),
      useEffect: () => {},
      useState: value => [typeof value === 'function' ? value() : value, () => {}],
      useCallback: fn => fn,
    },
    'react/jsx-runtime': require('../mobile/node_modules/react/jsx-runtime'),
    'react-native': native,
    'react-native-reanimated': {
      default: { View: 'ReanimatedView' },
      useSharedValue: val => ({ value: val }),
      useAnimatedStyle: cb => cb(),
      withSequence: (...args) => args[0],
      withTiming: to => to,
      withSpring: to => to,
    },
    'expo-image': { Image: 'Image' },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    'expo-linking': {},
    'expo-haptics': { impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium' } },
    '@/components/ui/Typography': { Text: 'Text' },
    '@/services/chat-state': state,
    '@/utils/date': {
      formatMessageTime: () => '12:00 PM',
      formatChatDateSeparator: () => 'Today',
      formatTimeAgo: () => 'Just now',
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@/constants/theme': {
      Monochrome: {
        bubbleOutgoing: '#EAEAEA',
        bubbleOutgoingText: '#111111',
        bubbleOutgoingMeta: '#555555',
        bubbleIncoming: '#242424',
        bubbleIncomingText: '#F5F5F5',
        bubbleIncomingMeta: '#737373',
      },
    },
  };
  function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return [tree, ...nodes(tree.props?.children)];
  }
  const { ChatMessageItem } = load('components/chat/ChatMessageItem.tsx', dependencies);
  for (const mime of ['image/jpeg', 'application/pdf']) {
    const item = { ...msg(12), name: 'Classmate', attachmentName: mime.startsWith('image') ? 'photo.jpg' : 'notes.pdf', attachmentMimeType: mime };
    let actions = 0, opened = 0;
    const tree = ChatMessageItem.type({ item, index: 0, prevMsg: null, nextMsg: null, readReceipts: [], serverUrl: 'https://school', isInitialLoadItem: true, singleTapDelayMs: 0, onLongPress: selected => { assert.equal(selected.id, item.id); actions++; }, onOpenImage: () => opened++, onDownloadFile: () => opened++ });
    const controls = nodes(tree);
    const media = controls.find(n => n.props?.accessibilityLabel?.startsWith(mime.startsWith('image') ? 'Open photo.' : 'Open attachment.'));
    assert.ok(media);
    media.props.onLongPress();
    media.props.onPress();
    // Requirement 1: Every per-message "•••" button is removed
    assert.equal(controls.find(n => n.props?.accessibilityLabel === 'Message actions'), undefined);
    assert.equal(actions, 1);
    assert.equal(opened, 1);
  }
  const { ChatMessageActionsSheet } = load('components/chat/ChatMessageActionsSheet.tsx', dependencies);
  const sheet = nodes(ChatMessageActionsSheet({ visible: true, message: msg(-1), busy: false, canPin: true, isOwnerOrAdmin: true }));
  assert.equal(sheet.some(n => n.props?.accessibilityLabel?.startsWith('React with')), false);
  const labels = sheet.filter(n => n.type === 'Text').map(n => n.props.children);
  assert.ok(!labels.includes('Reply'));
  assert.ok(!labels.includes('Pin announcement'));
  assert.ok(labels.includes('Remove unsent message'));
});
