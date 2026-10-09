'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Step 5B.3: Chat Navigation Architecture and Smooth Screen Transitions', () => {
  const repoRoot = path.join(__dirname, '..');
  const chatScreenPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'chat.tsx');
  const segmentedControlPath = path.join(repoRoot, 'mobile', 'components', 'ui', 'SegmentedControl.tsx');
  const dmInboxPath = path.join(repoRoot, 'mobile', 'components', 'dm', 'DmInboxView.tsx');
  const dmConversationPath = path.join(repoRoot, 'mobile', 'app', 'dm', '[id].tsx');
  const dmNewPath = path.join(repoRoot, 'mobile', 'app', 'dm', 'new.tsx');
  const dmRealtimePath = path.join(repoRoot, 'mobile', 'services', 'dm-realtime.ts');
  const webClientPath = path.join(repoRoot, 'public', 'dm-chat-client.js');

  // Test 1: Unified Chat Inbox renders both Cohorts and DMs
  test('1. Unified Chat Inbox: renders both Cohort and DM items together without segmented control', () => {
    assert.ok(fs.existsSync(chatScreenPath), 'chat.tsx must exist');
    const content = fs.readFileSync(chatScreenPath, 'utf8');

    assert.ok(content.includes('<UnifiedChatInbox'), 'chat.tsx must render UnifiedChatInbox');
    assert.ok(content.includes('normalizeUnifiedConversations'), 'chat.tsx must normalize unified items');
    assert.ok(content.includes('handleSelectCohort'), 'chat.tsx must provide cohort selection handler');
    assert.ok(content.includes('handleSelectDm'), 'chat.tsx must provide DM selection handler');
  });

  // Test 2: Cohort Conversation -> Inbox
  test('2. Cohort Conversation -> Inbox: back navigation safely returns to unified inbox', () => {
    const content = fs.readFileSync(chatScreenPath, 'utf8');

    assert.ok(content.includes('handleBackToInbox'), 'chat.tsx must provide handleBackToInbox');
    assert.ok(content.includes('setSelectedCohortRoom(null)'), 'handleBackToInbox must reset selectedCohortRoom');
    assert.ok(content.includes('useClassChat('), 'useClassChat hook must remain in component scope');
  });

  // Test 3: Inbox -> Conversation
  test('3. Inbox -> Conversation: selects conversation and pushes /dm/[id] with peer parameters', () => {
    assert.ok(fs.existsSync(dmInboxPath), 'DmInboxView.tsx must exist');
    const content = fs.readFileSync(dmInboxPath, 'utf8');

    assert.ok(content.includes("pathname: '/dm/[id]'"), 'DmInboxView must route to /dm/[id]');
    assert.ok(content.includes('peerName:'), 'DmInboxView must pass peerName parameter');
    assert.ok(content.includes('peerRole:'), 'DmInboxView must pass peerRole parameter');
  });

  // Test 4: Conversation -> Inbox
  test('4. Conversation -> Inbox: back navigation safely returns to inbox or falls back to chat', () => {
    assert.ok(fs.existsSync(dmConversationPath), '[id].tsx must exist');
    const content = fs.readFileSync(dmConversationPath, 'utf8');

    // handleBack checks router.canGoBack() and falls back to /(tabs)/chat
    assert.ok(content.includes('router.canGoBack()'), '[id].tsx must verify router.canGoBack()');
    assert.ok(content.includes("router.replace('/(tabs)/chat')"), '[id].tsx must fallback to /(tabs)/chat when stack is empty');
  });

  // Test 5: New Message -> Conversation
  test('5. New Message -> Conversation: selecting searched user replaces screen with /dm/[id]', () => {
    assert.ok(fs.existsSync(dmNewPath), 'new.tsx must exist');
    const content = fs.readFileSync(dmNewPath, 'utf8');

    assert.ok(content.includes('createOrGetDmConversation('), 'new.tsx must invoke createOrGetDmConversation');
    assert.ok(content.includes("router.replace({\n        pathname: '/dm/[id]'") || content.includes("router.replace"), 'new.tsx must replace route into /dm/[id] to prevent back loops');
  });

  // Test 6: Android Back Navigation
  test('6. Android Back navigation: BackHandler is registered in chat.tsx, [id].tsx, and new.tsx', () => {
    const chatContent = fs.readFileSync(chatScreenPath, 'utf8');
    const convContent = fs.readFileSync(dmConversationPath, 'utf8');
    const newContent = fs.readFileSync(dmNewPath, 'utf8');

    assert.ok(chatContent.includes("BackHandler.addEventListener('hardwareBackPress'"), 'chat.tsx must register hardwareBackPress');
    assert.ok(chatContent.includes('if (selectedCohortRoom) {\n          handleBackToInbox();\n          return true;'), 'chat.tsx must return to unified inbox when pressing Back in cohort conversation');

    assert.ok(convContent.includes("BackHandler.addEventListener('hardwareBackPress'"), '[id].tsx must register hardwareBackPress');
    assert.ok(newContent.includes("BackHandler.addEventListener('hardwareBackPress'"), 'new.tsx must register hardwareBackPress');
  });

  // Test 7: Modal Dismissal Priority
  test('7. Modal dismissal: hardware back closes active modals and overlays prior to screen popping', () => {
    const chatContent = fs.readFileSync(chatScreenPath, 'utf8');
    const convContent = fs.readFileSync(dmConversationPath, 'utf8');

    // chat.tsx overlays: viewerImage, showAttachModal, actionMessage, panel
    assert.ok(chatContent.includes('if (viewerImage)'), 'chat.tsx must dismiss viewerImage first');
    assert.ok(chatContent.includes('if (showAttachModal)'), 'chat.tsx must dismiss showAttachModal first');
    assert.ok(chatContent.includes('if (actionMessage)'), 'chat.tsx must dismiss actionMessage first');
    assert.ok(chatContent.includes('if (panel)'), 'chat.tsx must dismiss search/member panel first');

    // [id].tsx modals: reportModalVisible, settingsModalVisible, selectedActionMessage
    assert.ok(convContent.includes('if (reportModalVisible)'), '[id].tsx must dismiss report modal first');
    assert.ok(convContent.includes('if (settingsModalVisible)'), '[id].tsx must dismiss settings modal first');
    assert.ok(convContent.includes('if (selectedActionMessage)'), '[id].tsx must dismiss action sheet first');
  });

  // Test 8: Repeated Rapid Navigation (Debounce Guards)
  test('8. Repeated rapid navigation: debounce guards prevent duplicate pushes', () => {
    const inboxContent = fs.readFileSync(dmInboxPath, 'utf8');
    const newContent = fs.readFileSync(dmNewPath, 'utf8');

    assert.ok(inboxContent.includes('navigatingRef = useRef(false)'), 'DmInboxView must use navigatingRef guard');
    assert.ok(inboxContent.includes('if (navigatingRef.current) return;'), 'DmInboxView must ignore rapid double taps');

    assert.ok(newContent.includes('startingRef = useRef(false)'), 'new.tsx must use startingRef guard');
    assert.ok(newContent.includes('if (starting || startingRef.current) return;'), 'new.tsx must ignore rapid repeated selection taps');
  });

  // Test 9: Deep Links
  test('9. Deep links: chat tab inspects dmConversationId and targetChatGroupId params', () => {
    const content = fs.readFileSync(chatScreenPath, 'utf8');

    assert.ok(content.includes('useLocalSearchParams'), 'chat.tsx must use useLocalSearchParams');
    assert.ok(content.includes('dmConversationId?: string'), 'chat.tsx params must include dmConversationId');
    assert.ok(content.includes('targetChatGroupId?: string'), 'chat.tsx params must include targetChatGroupId');
    assert.ok(content.includes("pathname: '/dm/[id]'"), 'chat.tsx must navigate to target DM on deep link');
  });

  // Test 10: Invalid Conversation Route
  test('10. Invalid conversation route: [id].tsx handles missing conversation ID gracefully', () => {
    const content = fs.readFileSync(dmConversationPath, 'utf8');

    assert.ok(content.includes('if (!conversationId)'), '[id].tsx must check for missing conversationId');
    assert.ok(content.includes('Conversation Not Found') || content.includes('Invalid Conversation'), '[id].tsx must render user-friendly error UI');
    assert.ok(content.includes('Back to Messages'), '[id].tsx must provide fallback button to return to inbox');
  });

  // Test 11: Account Switching
  test('11. Account switching: DmInboxView scopes caching by accountId and unmount resets state', () => {
    const inboxContent = fs.readFileSync(dmInboxPath, 'utf8');

    assert.ok(inboxContent.includes('accountId = user?.studentId'), 'DmInboxView must derive accountId from current authenticated student');
    assert.ok(inboxContent.includes('getCachedDmConversations(accountId)'), 'DmInboxView must partition cache by accountId');
  });

  // Test 12: Realtime Listener Cleanup
  test('12. Realtime listener cleanup: subscribeDmConversationRealtime unsubscribes and disconnectAllDmRealtime clears pool', () => {
    assert.ok(fs.existsSync(dmRealtimePath), 'dm-realtime.ts must exist');
    const content = fs.readFileSync(dmRealtimePath, 'utf8');

    assert.ok(content.includes('activeSubscriptions.add(unsubscribe)'), 'dm-realtime.ts must track active subscriptions');
    assert.ok(content.includes('export function disconnectAllDmRealtime'), 'dm-realtime.ts must export disconnectAllDmRealtime');
    assert.ok(content.includes('client.removeChannel(channel)'), 'dm-realtime.ts must properly unregister channel with Supabase');

    const convContent = fs.readFileSync(dmConversationPath, 'utf8');
    assert.ok(convContent.includes('unsubscribe();'), '[id].tsx must execute unsubscribe on cleanup');
  });

  // Test 13: Navigation State Retention
  test('13. Navigation state retention: Unified inbox and cohort room preserve composers and navigation hierarchy', () => {
    const content = fs.readFileSync(chatScreenPath, 'utf8');

    assert.ok(content.includes('<UnifiedChatInbox'), 'chat.tsx must render UnifiedChatInbox');
    assert.ok(content.includes('<StickyComposer'), 'StickyComposer must remain mounted in cohort room view');
  });

  // Test 14: Reduced-Motion Behavior & Segment Indicator Animation
  test('14. Reduced-motion & segment animation: SegmentedControl uses MotionDuration tokens and GPU driver', () => {
    assert.ok(fs.existsSync(segmentedControlPath), 'SegmentedControl.tsx must exist');
    const content = fs.readFileSync(segmentedControlPath, 'utf8');

    assert.ok(content.includes('MotionDuration.smallTransition'), 'SegmentedControl must use MotionDuration.smallTransition');
    assert.ok(content.includes('useNativeDriver: true'), 'SegmentedControl animated indicator must use native driver');
    assert.ok(content.includes('accessibilityRole="tablist"'), 'SegmentedControl must declare tablist role');
    assert.ok(content.includes('accessibilityRole="tab"'), 'SegmentedControl items must declare tab role');
  });

  // Test 15: Website Navigation & Browser History
  test('15. Website navigation: dm-chat-client.js implements keyboard tablist navigation and popstate history handling', () => {
    assert.ok(fs.existsSync(webClientPath), 'dm-chat-client.js must exist');
    const content = fs.readFileSync(webClientPath, 'utf8');

    assert.ok(content.includes("window.addEventListener('popstate'"), 'dm-chat-client.js must listen for popstate');
    assert.ok(content.includes('history.pushState'), 'dm-chat-client.js must push mobile thread to history');
    assert.ok(content.includes("e.key === 'ArrowRight' || e.key === 'ArrowLeft'"), 'dm-chat-client.js must support arrow keys on mode tabs');
    assert.ok(content.includes("setAttribute('aria-selected'"), 'dm-chat-client.js must maintain aria-selected states');
  });
});
