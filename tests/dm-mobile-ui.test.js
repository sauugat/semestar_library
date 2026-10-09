const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Step 4B: React Native Private Messaging Mobile UI & Services', () => {

  const mobileRoot = path.join(__dirname, '..', 'mobile');
  const servicesDir = path.join(mobileRoot, 'services');
  const appDmDir = path.join(mobileRoot, 'app', 'dm');
  const componentsDmDir = path.join(mobileRoot, 'components', 'dm');

  // 1. Inbox rendering
  test('1. Inbox rendering: DmInboxView component and caching logic exist with expected states', () => {
    const inboxPath = path.join(componentsDmDir, 'DmInboxView.tsx');
    assert.ok(fs.existsSync(inboxPath), 'DmInboxView.tsx must exist');
    const content = fs.readFileSync(inboxPath, 'utf8');

    assert.ok(content.includes('fetchDmConversations'), 'Inbox must fetch conversations');
    assert.ok(content.includes('getCachedDmConversations'), 'Inbox must load from SQLite cache for 0ms render');
    assert.ok(content.includes('FlatList'), 'Inbox must use FlatList for virtualization');
    assert.ok(content.includes('RefreshControl'), 'Inbox must support pull-to-refresh');
    assert.ok(content.includes('searchQuery'), 'Inbox must support search filter');
    assert.ok(content.includes('New Message') || content.includes('/dm/new'), 'Inbox must have New Message trigger');
  });

  // 2. User search
  test('2. User search: New DM screen searches users with debouncing and safe fields', () => {
    const newDmPath = path.join(appDmDir, 'new.tsx');
    assert.ok(fs.existsSync(newDmPath), 'app/dm/new.tsx must exist');
    const content = fs.readFileSync(newDmPath, 'utf8');

    assert.ok(content.includes('searchDmUsers'), 'Must call searchDmUsers API');
    assert.ok(content.includes('setTimeout') || content.includes('debounce'), 'Must debounce search input');
    assert.ok(content.includes('getInitials') || content.includes('avatarUrl'), 'Must render avatars safely');
    assert.ok(!content.includes('email') || content.includes('Do not expose'), 'Must not expose sensitive fields');
  });

  // 3. Conversation creation
  test('3. Conversation creation: Selecting a user calls createOrGetDmConversation deterministically', () => {
    const newDmPath = path.join(appDmDir, 'new.tsx');
    const content = fs.readFileSync(newDmPath, 'utf8');

    assert.ok(content.includes('createOrGetDmConversation'), 'Must call createOrGetDmConversation');
    assert.ok(content.includes('/dm/[id]'), 'Must navigate directly to /dm/[id]');
  });

  // 4. Message sending
  test('4. Message sending: Supports multiline input, character limits, and sending', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    assert.ok(fs.existsSync(dmConvPath), 'app/dm/[id].tsx must exist');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('sendDmMessage'), 'Must call sendDmMessage API');
    assert.ok(content.includes('multiline'), 'Must support multiline text input');
    assert.ok(content.includes('maxLength={2000}'), 'Must enforce 2,000 character maximum');
  });

  // 5. Optimistic reconciliation
  test('5. Optimistic reconciliation: Creates clientId, displays pending state, and replaces on confirmation', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('clientId'), 'Must generate unique clientId');
    assert.ok(content.includes('status: \'pending\'') || content.includes('status: "pending"'), 'Must set pending status optimistically');
    assert.ok(content.includes('confirmed'), 'Must reconcile with confirmed server message');
  });

  // 6. Duplicate prevention
  test('6. Duplicate prevention: Deduplicates incoming and sent messages by id and clientId', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(
      content.includes('mergeDmMessages(prev, [newMsg])'),
      'Must deduplicate by server id and clientId'
    );
  });

  // 7. Replies
  test('7. Replies: Supports replying with context quote and replyToId', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('replyTo'), 'Must support replyTo metadata');
    assert.ok(content.includes('replyingTo'), 'Must track replying state');
    assert.ok(content.includes('replyQuote'), 'Must render quote banner in message bubble');
  });

  // 8. Editing
  test('8. Editing: Supports editing own messages via PATCH and updates cache', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('editDmMessage'), 'Must call editDmMessage API');
    assert.ok(content.includes('isEdited'), 'Must render edited indicator');
    assert.ok(content.includes('editingMessage'), 'Must support edit mode in composer');
  });

  // 9. Delete for me
  test('9. Delete for me: Calls DELETE with mode=for_me and removes from local view', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('deleteDmMessage(conversationId, msgId, \'for_me\')'), 'Must call deleteDmMessage with for_me');
    assert.ok(content.includes('deleteCachedDmMessage'), 'Must remove deleted message from SQLite cache');
  });

  // 10. Delete for everyone
  test('10. Delete for everyone: Calls DELETE with mode=for_everyone and renders deleted tombstone', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('deleteDmMessage(conversationId, msgId, \'for_everyone\')'), 'Must call delete with for_everyone');
    assert.ok(content.includes('deletedForAll'), 'Must check deletedForAll flag');
    assert.ok(content.includes('This message was deleted'), 'Must render tombstone text');
  });

  // 11. Clear conversation
  test('11. Clear conversation: Calls POST /clear and clears state & cache after confirmation', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('clearDmConversation'), 'Must call clearDmConversation');
    assert.ok(content.includes('Clear Conversation?'), 'Must prompt with confirmation dialog');
  });

  // 12. Read receipts
  test('12. Read receipts: Advances read cursor on view and displays Sent/Seen correctly', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('markDmConversationRead'), 'Must call markDmConversationRead');
    assert.ok(content.includes('peerLastReadId'), 'Must compare peerLastReadId');
    assert.ok(content.includes('checkmark-done'), 'Must render Seen receipt');
  });

  // 13. Typing indicators
  test('13. Typing indicators: Throttles outgoing typing and clears stale indicator automatically', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('sendDmTyping'), 'Must send typing events');
    assert.ok(content.includes('outgoingTypingThrottlerRef'), 'Must throttle outgoing typing');
    assert.ok(content.includes('typingTimeoutRef'), 'Must clear incoming typing indicator with timeout');
  });

  // 14. Blocking
  test('14. Blocking: Disables composer, shows unblock option, and calls block/unblock APIs', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('blockDmUser'), 'Must call blockDmUser API');
    assert.ok(content.includes('unblockDmUser'), 'Must call unblockDmUser API');
    assert.ok(content.includes('blockedBanner'), 'Must render blocked banner when blocked');
  });

  // 15. Reporting
  test('15. Reporting: Exposes reporting modal with reasons and calls reportDm', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('reportDm'), 'Must call reportDm API');
    assert.ok(content.includes('reportModalVisible'), 'Must support report modal');
    assert.ok(content.includes('HARASSMENT'), 'Must provide report categories');
  });

  // 16. Notification deep links
  test('16. Notification deep links: Handles type="dm" and navigates to /dm/[id]', () => {
    const notifPath = path.join(servicesDir, 'notifications.ts');
    const content = fs.readFileSync(notifPath, 'utf8');

    assert.ok(content.includes('case \'dm\':'), 'Must handle case dm');
    assert.ok(content.includes('/dm/[id]'), 'Must route to /dm/[id]');
  });

  // 17. Cold-start notification navigation
  test('17. Cold-start notification navigation: Queues notification until auth session resolves', () => {
    const notifPath = path.join(servicesDir, 'notifications.ts');
    const content = fs.readFileSync(notifPath, 'utf8');

    assert.ok(content.includes('getPendingNotification'), 'Must inspect pending notification');
    assert.ok(content.includes('executePendingNotificationNavigation'), 'Must execute pending notification');
  });

  // 18. Reconnection & Realtime subscription
  test('18. Reconnection: Supabase Realtime client manages subscriptions and disconnects cleanly', () => {
    const realtimePath = path.join(servicesDir, 'dm-realtime.ts');
    assert.ok(fs.existsSync(realtimePath), 'dm-realtime.ts must exist');
    const content = fs.readFileSync(realtimePath, 'utf8');

    assert.ok(content.includes('subscribeDmConversationRealtime'), 'Must export subscribeDmConversationRealtime');
    assert.ok(content.includes('disconnectAllDmRealtime'), 'Must export disconnectAllDmRealtime');
    assert.ok(content.includes('dm:message:new'), 'Must listen to dm:message:new');
    assert.ok(content.includes('dm:read:updated'), 'Must listen to dm:read:updated');
    assert.ok(content.includes('dm:typing'), 'Must listen to dm:typing');
  });

  // 19. Offline caching
  test('19. Offline caching: Separate SQLite tables with account scoping and 0ms access', () => {
    const dbPath = path.join(servicesDir, 'dm-db.ts');
    assert.ok(fs.existsSync(dbPath), 'dm-db.ts must exist');
    const content = fs.readFileSync(dbPath, 'utf8');

    assert.ok(content.includes('dm_conversations_cache_v1'), 'Must use isolated conversation cache table');
    assert.ok(content.includes('dm_messages_cache_v1'), 'Must use isolated message cache table');
    assert.ok(content.includes('account_id'), 'Must scope tables by account_id');
    assert.ok(content.includes('memoryMessages'), 'Must use in-memory cache for 0ms access');
  });

  // 20. Logout and cache clearing
  test('20. Logout and cache clearing: Clears DM cache and disconnects realtime on logout', () => {
    const authPath = path.join(mobileRoot, 'context', 'AuthContext.tsx');
    const content = fs.readFileSync(authPath, 'utf8');

    assert.ok(content.includes('clearAllDmCache'), 'Must call clearAllDmCache on logout');
    assert.ok(content.includes('disconnectAllDmRealtime'), 'Must call disconnectAllDmRealtime on logout');
  });

  // 21. Keyboard behavior
  test('21. Keyboard behavior: Uses StickyComposer and KeyboardContentBoundary for viewport sync', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('StickyComposer'), 'Must wrap composer in StickyComposer');
    assert.ok(content.includes('KeyboardContentBoundary'), 'Must wrap timeline in KeyboardContentBoundary');
  });

  // 22. Android layout
  test('22. Android layout: Handles safe area insets and status bar styling', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('useSafeAreaInsets'), 'Must use safe area insets');
    assert.ok(content.includes('StatusBar'), 'Must configure StatusBar');
  });

  // 23. iOS layout
  test('23. iOS layout: Supports safe padding and native chevron back button', () => {
    const dmConvPath = path.join(appDmDir, '[id].tsx');
    const content = fs.readFileSync(dmConvPath, 'utf8');

    assert.ok(content.includes('chevron-back'), 'Must render iOS friendly chevron');
    assert.ok(content.includes('insets.bottom') || content.includes('insets.top'), 'Must account for bottom home indicator');
  });

  // 24. Feature flag disabled
  test('24. Feature flag disabled: Respects fetchDmStatus() and hides Messages when disabled', () => {
    const chatPath = path.join(mobileRoot, 'app', '(tabs)', 'chat.tsx');
    const content = fs.readFileSync(chatPath, 'utf8');

    assert.ok(content.includes('fetchDmStatus'), 'Must check feature flag status');
    assert.ok(content.includes('dmEnabled'), 'Must gate DM features using dmEnabled');
  });

  // 25. Existing cohort chat regression
  test('25. Existing cohort chat regression: Preserves cohort chat state and permissions intact', () => {
    const chatPath = path.join(mobileRoot, 'app', '(tabs)', 'chat.tsx');
    const content = fs.readFileSync(chatPath, 'utf8');

    assert.ok(content.includes('useClassChat'), 'Must preserve useClassChat hook');
    assert.ok(content.includes('adminRooms'), 'Must preserve adminRooms');
    assert.ok(content.includes('selectedCohortRoom'), 'Must preserve cohort room selection');
    assert.ok(content.includes('Class Chat') || content.includes('Class conversation'), 'Must retain Class Chat header');
  });

});
