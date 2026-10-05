const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/cohort-client-fixture');

test('actual mobile notification parser and navigation retain room identity through cold start and cancel stale routes', () => {
  const routes = [], timers = [];
  const notifications = load('services/notifications.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'expo-notifications': { setNotificationHandler() {} },
    'expo-device': {}, 'expo-secure-store': {}, 'expo-constants': {},
    'expo-router': { router: {
      replace: value => routes.push(['replace', value]),
      push: value => routes.push(['push', value]),
    } },
    '@/services/api': {},
  }, { __DEV__: false, setTimeout: fn => timers.push(fn) });
  const raw = { type: 'chat', chatGroupId: 'immutable-mercury-room', messageId: 42, realtimeEpoch: 2 };
  const parsed = notifications.parseNotificationData(raw);
  assert.equal(parsed.chatGroupId, raw.chatGroupId);
  assert.equal(parsed.groupKey, 'chat:immutable-mercury-room');
  assert.equal(parsed.messageId, 42);
  assert.equal(notifications.parseNotificationData({ type: 'chat', messageId: -1 }).messageId, undefined);
  notifications.navigateFromNotification(raw, false, 'tap-cold');
  assert.deepEqual(routes.pop(), ['replace', '/login']);
  assert.equal(notifications.getPendingNotification().chatGroupId, raw.chatGroupId);
  notifications.executePendingNotificationNavigation(true);
  assert.deepEqual(routes.pop(), ['replace', {
    pathname: '/(tabs)/chat',
    params: { targetMessageId: '42', targetChatGroupId: raw.chatGroupId },
  }]);
  assert.equal(notifications.getPendingNotification(), null);
  notifications.navigateFromNotification(raw, true, 'tap-open');
  const count = routes.length;
  notifications.navigateFromNotification(raw, true, 'tap-open');
  assert.equal(routes.length, count);
  notifications.navigateFromNotification({ type: 'notice', noticeId: 12 }, true);
  assert.deepEqual(routes.pop(), ['replace', '/(tabs)']);
  timers.pop()();
  assert.deepEqual(routes.pop(), ['push', '/notice/12']);
  notifications.navigateFromNotification({ type: 'post', postId: 13 }, true);
  notifications.resetNotificationNavigationState();
  routes.length = 0;
  timers.pop()();
  assert.deepEqual(routes, []);
  notifications.navigateFromNotification({ type: 'post', postId: 13 }, true);
  notifications.navigateFromNotification(raw, true);
  const latest = routes.length;
  timers.pop()();
  assert.equal(routes.length, latest, 'Older post cannot override a newer chat tap');
  notifications.navigateFromNotification({ type: 'notice', noticeId: 12 }, true);
  notifications.navigateToNotificationTarget({deepLink:'/chat?chatGroupId=immutable-mercury-room&messageId=42',type:'chat_message'});
  assert.deepEqual(routes.at(-1), ['replace', {pathname:'/(tabs)/chat',params:{targetChatGroupId:'immutable-mercury-room',targetMessageId:'42'}}]);
  const inboxLatest=routes.length;
  timers.pop()();
  assert.equal(routes.length,inboxLatest,'Inbox chat tap cancels older pending notice route');
  notifications.navigateFromNotification(raw,true);
  notifications.navigateFromNotification({type:'notice',noticeId:14},true);
  timers.pop()();assert.deepEqual(routes.at(-1),['push','/notice/14']);
});
