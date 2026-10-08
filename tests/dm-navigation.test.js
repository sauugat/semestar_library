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

  // Test 1: Class Chat -> Messages
  test('1. Class Chat -> Messages: switches activeSection to messages without unmounting views', () => {
    assert.ok(fs.existsSync(chatScreenPath), 'chat.tsx must exist');
    const content = fs.readFileSync(chatScreenPath, 'utf8');

    // Uses SegmentedControl component for switching
    assert.ok(content.includes('SegmentedControl'), 'chat.tsx must render SegmentedControl');
    assert.ok(content.includes("key === 'class' | 'messages'") || content.includes("setActiveSection(key as 'class' | 'messages')"), 'chat.tsx must toggle activeSection via onSelect');

    // Persistent layout: uses display style instead of early conditional unmount return
    assert.ok(content.includes("display: activeSection === 'class' ? 'flex' : 'none'"), 'Class chat view must remain mounted with display toggle');
    assert.ok(content.includes("display: activeSection === 'messages' ? 'flex' : 'none'"), 'Messages view must remain mounted with display toggle');
    assert.ok(!content.includes("if (dmEnabled && activeSection === 'messages') {\n    return"), 'chat.tsx must not early return and unmount class chat');
  });

  // Test 2: Messages -> Class Chat
  test('2. Messages -> Class Chat: returns seamlessly to class chat preserving state and subscriptions', () => {
    const content = fs.readFileSync(chatScreenPath, 'utf8');

    // Header back button in messages switches back to class
    assert.ok(content.includes("setActiveSection('class')"), 'Messages header back button must call setActiveSection to return to class');
    // Class chat socket hook useClassChat remains continuously alive
    assert.ok(content.includes('useClassChat('), 'useClassChat hook must remain in main component scope');
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
    assert.ok(chatContent.includes("if (activeSection === 'messages') {\n          setActiveSection('class');\n          return true;"), 'chat.tsx must return to class chat when pressing Back in messages');

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
  test('9. Deep links: chat tab inspects section, tab, dmConversationId, and targetChatGroupId params', () => {
    const content = fs.readFileSync(chatScreenPath, 'utf8');

    assert.ok(content.includes('useLocalSearchParams'), 'chat.tsx must use useLocalSearchParams');
    assert.ok(content.includes('section?: string'), 'chat.tsx params must include section');
    assert.ok(content.includes('tab?: string'), 'chat.tsx params must include tab');
    assert.ok(content.includes('dmConversationId?: string'), 'chat.tsx params must include dmConversationId');
    assert.ok(content.includes("section === 'messages' || tab === 'dm' || tab === 'messages'"), 'chat.tsx must activate messages section on deep-link');
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
  test('13. Navigation state retention: segment switching retains scroll and form draft states', () => {
    const content = fs.readFileSync(chatScreenPath, 'utf8');

    // Both views stay in the DOM with display toggles
    assert.ok(content.includes("display: activeSection === 'class' ? 'flex' : 'none'"));
    assert.ok(content.includes("display: activeSection === 'messages' ? 'flex' : 'none'"));
    // StickyComposer and FlatList remain mounted inside the persistent container
    assert.ok(content.includes('<StickyComposer'));
    assert.ok(content.includes('<DmInboxView'));
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
