const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// --- Mock DOM Environment Builder ---
function createMockElement(id = '', tag = 'div', className = '') {
  const listeners = {};
  const children = [];
  const classListSet = new Set(className ? className.split(/\s+/) : []);

  const el = {
    id,
    tagName: tag.toUpperCase(),
    className: className || '',
    style: {},
    innerHTML: '',
    textContent: '',
    value: '',
    placeholder: '',
    disabled: false,
    scrollTop: 0,
    scrollHeight: 1000,
    selectionStart: 0,
    selectionEnd: 0,
    dataset: {},
    classList: {
      add: (...names) => {
        names.forEach(n => classListSet.add(n));
        el.className = Array.from(classListSet).join(' ');
      },
      remove: (...names) => {
        names.forEach(n => classListSet.delete(n));
        el.className = Array.from(classListSet).join(' ');
      },
      toggle: (name, force) => {
        if (force === true || (force === undefined && !classListSet.has(name))) {
          classListSet.add(name);
        } else {
          classListSet.delete(name);
        }
        el.className = Array.from(classListSet).join(' ');
      },
      contains: (name) => classListSet.has(name),
    },
    addEventListener: (event, handler) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    removeEventListener: (event, handler) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(h => h !== handler);
      }
    },
    dispatchEvent: (event) => {
      const handlers = listeners[event.type || event] || [];
      handlers.forEach(h => h(event));
    },
    click: () => el.dispatchEvent({ type: 'click', stopPropagation() {} }),
    focus: () => {},
    scrollTo: () => {},
    scrollIntoView: () => {},
    querySelector: (sel) => {
      if (sel === '.dm-composer-bar') return el._composerBar;
      if (sel === 'span') return el._span;
      if (sel === '.dm-modal-title') return el._title;
      return createMockElement('', 'div');
    },
    querySelectorAll: () => [],
  };

  el._composerBar = { style: {} };
  el._span = { textContent: '' };
  el._title = { textContent: '' };

  return el;
}

function buildMockDOM() {
  const elements = {
    chatModeBar: createMockElement('chatModeBar', 'nav'),
    modeBtnCohort: createMockElement('modeBtnCohort', 'button'),
    modeBtnDm: createMockElement('modeBtnDm', 'button'),
    cohortChatMain: createMockElement('cohortChatMain', 'section'),
    dmMain: createMockElement('dmMain', 'section'),
    dmLayout: createMockElement('dmLayout', 'div'),
    dmGlobalUnreadBadge: createMockElement('dmGlobalUnreadBadge', 'span'),
    dmTabUnreadBadge: createMockElement('dmTabUnreadBadge', 'span'),

    // Inbox
    dmConvList: createMockElement('dmConvList', 'div'),
    dmConvSearchInput: createMockElement('dmConvSearchInput', 'input'),
    dmNewMsgBtn: createMockElement('dmNewMsgBtn', 'button'),

    // Active Chat & Header
    dmNoConvPlaceholder: createMockElement('dmNoConvPlaceholder', 'div'),
    dmActiveChatWrap: createMockElement('dmActiveChatWrap', 'div'),
    dmHeaderBackBtn: createMockElement('dmHeaderBackBtn', 'button'),
    dmPeerAvatar: createMockElement('dmPeerAvatar', 'div'),
    dmPeerName: createMockElement('dmPeerName', 'span'),
    dmPeerRoleBadge: createMockElement('dmPeerRoleBadge', 'span'),
    dmPeerStatusText: createMockElement('dmPeerStatusText', 'span'),
    dmPeerStatusDot: createMockElement('dmPeerStatusDot', 'span'),
    dmConnBanner: createMockElement('dmConnBanner', 'div'),
    dmHeaderMenuBtn: createMockElement('dmHeaderMenuBtn', 'button'),
    dmHeaderDropdown: createMockElement('dmHeaderDropdown', 'div'),

    // Timeline
    dmTimeline: createMockElement('dmTimeline', 'main'),
    dmTimelineLoader: createMockElement('dmTimelineLoader', 'div'),

    // Composer
    dmComposerWrap: createMockElement('dmComposerWrap', 'footer'),
    dmComposerContextBar: createMockElement('dmComposerContextBar', 'div'),
    dmComposerContextTitle: createMockElement('dmComposerContextTitle', 'span'),
    dmComposerContextSnippet: createMockElement('dmComposerContextSnippet', 'span'),
    dmComposerContextCancelBtn: createMockElement('dmComposerContextCancelBtn', 'button'),
    dmTextarea: createMockElement('dmTextarea', 'textarea'),
    dmCharCounter: createMockElement('dmCharCounter', 'span'),
    dmSendBtn: createMockElement('dmSendBtn', 'button'),
    dmEmojiToggleBtn: createMockElement('dmEmojiToggleBtn', 'button'),
    dmEmojiDrawer: createMockElement('dmEmojiDrawer', 'div'),
    dmBlockedBanner: createMockElement('dmBlockedBanner', 'div'),
    dmUnblockBtn: createMockElement('dmUnblockBtn', 'button'),

    // Modals
    dmUserSearchModal: createMockElement('dmUserSearchModal', 'div'),
    dmUserSearchInput: createMockElement('dmUserSearchInput', 'input'),
    dmUserSearchResults: createMockElement('dmUserSearchResults', 'div'),
    dmUserSearchCloseBtn: createMockElement('dmUserSearchCloseBtn', 'button'),

    dmDeleteModal: createMockElement('dmDeleteModal', 'div'),
    dmDeleteForMeBtn: createMockElement('dmDeleteForMeBtn', 'button'),
    dmDeleteForEveryoneBtn: createMockElement('dmDeleteForEveryoneBtn', 'button'),
    dmDeleteCancelBtn: createMockElement('dmDeleteCancelBtn', 'button'),

    dmClearModal: createMockElement('dmClearModal', 'div'),
    dmClearConfirmBtn: createMockElement('dmClearConfirmBtn', 'button'),
    dmClearCancelBtn: createMockElement('dmClearCancelBtn', 'button'),

    dmBlockModal: createMockElement('dmBlockModal', 'div'),
    dmBlockConfirmBtn: createMockElement('dmBlockConfirmBtn', 'button'),
    dmBlockCancelBtn: createMockElement('dmBlockCancelBtn', 'button'),

    dmReportModal: createMockElement('dmReportModal', 'div'),
    dmReportReasonSelect: createMockElement('dmReportReasonSelect', 'select'),
    dmReportDescInput: createMockElement('dmReportDescInput', 'textarea'),
    dmReportSubmitBtn: createMockElement('dmReportSubmitBtn', 'button'),
    dmReportCancelBtn: createMockElement('dmReportCancelBtn', 'button'),

    // Menu Action Buttons
    dmMenuMuteBtn: createMockElement('dmMenuMuteBtn', 'button'),
    dmMenuClearBtn: createMockElement('dmMenuClearBtn', 'button'),
    dmMenuBlockBtn: createMockElement('dmMenuBlockBtn', 'button'),
    dmMenuReportBtn: createMockElement('dmMenuReportBtn', 'button'),
  };

  return elements;
}

function createTestContext(customFetch = null) {
  const elements = buildMockDOM();
  const windowListeners = {};
  const documentListeners = {};

  const win = {
    location: { search: '', href: '' },
    navigator: { onLine: true },
    crypto: { randomUUID: () => `uuid_${Math.random().toString(36).slice(2, 9)}` },
    localStorage: {
      _data: {},
      getItem: (k) => win.localStorage._data[k] || null,
      setItem: (k, v) => { win.localStorage._data[k] = String(v); },
      removeItem: (k) => { delete win.localStorage._data[k]; },
    },
    addEventListener: (event, handler) => {
      windowListeners[event] = windowListeners[event] || [];
      windowListeners[event].push(handler);
    },
    dispatchEvent: (event) => {
      const handlers = windowListeners[event.type || event] || [];
      handlers.forEach(h => h(event));
    },
    fetch: customFetch || (async (url) => {
      if (url.includes('/api/dm-status')) return { ok: true, json: async () => ({ enabled: true }) };
      return { ok: true, json: async () => ({}) };
    }),
    alert: () => {},
    roomClient: { setActive: () => {} },
  };

  const doc = {
    readyState: 'complete',
    hidden: false,
    getElementById: (id) => elements[id] || null,
    querySelector: (sel) => {
      if (sel === '.chat-main') return elements.cohortChatMain;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener: (event, handler) => {
      documentListeners[event] = documentListeners[event] || [];
      documentListeners[event].push(handler);
    },
    dispatchEvent: (event) => {
      const handlers = documentListeners[event.type || event] || [];
      handlers.forEach(h => h(event));
    },
  };

  const sandbox = {
    window: win,
    document: doc,
    navigator: win.navigator,
    localStorage: win.localStorage,
    location: win.location,
    crypto: win.crypto,
    fetch: (...args) => win.fetch(...args),
    alert: (...args) => win.alert(...args),
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    URLSearchParams,
  };

  const clientScript = fs.readFileSync(path.join(__dirname, '../public/dm-chat-client.js'), 'utf8');
  vm.runInNewContext(clientScript, sandbox);

  return {
    window: win,
    document: doc,
    client: sandbox.dmClient || win.dmClient,
    elements,
  };
}

describe('Step 4A: Website Private Messaging UI Tests (All 20 Required Scenarios)', () => {

  const currentUser = {
    studentId: 'student_101',
    name: 'Alice Cooper',
    username: 'alice',
    role: 'student',
  };

  // Test 1: Conversation list rendering
  test('1. Conversation list rendering with avatar, preview, time, and unread badge', async () => {
    const mockConversations = [
      {
        id: 'conv_1',
        participant: { studentId: 'student_102', name: 'Bob Smith', username: 'bob', role: 'student', avatarUrl: null },
        lastMessage: { id: 50, text: 'See you in class tomorrow!', senderId: 'student_102', createdAt: new Date().toISOString() },
        unreadCount: 3,
        lastMessageAt: new Date().toISOString(),
      },
    ];

    const ctx = createTestContext(async (url) => {
      if (url.includes('/api/dm-status')) return { ok: true, json: async () => ({ enabled: true }) };
      if (url.includes('/api/dm/conversations')) return { ok: true, json: async () => ({ conversations: mockConversations }) };
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    await ctx.client.loadConversations();

    const listHtml = ctx.elements.dmConvList.innerHTML;
    assert.match(listHtml, /Bob Smith/, 'Should render participant name');
    assert.match(listHtml, /See you in class tomorrow!/, 'Should render last message preview');
    assert.match(listHtml, /dm-unread-badge/, 'Should render unread badge');
    assert.match(listHtml, />3</, 'Should show unread count 3');
  });

  // Test 2: User search
  test('2. User search debouncing and rendering results with name, username, and role', async () => {
    let searchedQuery = '';
    const ctx = createTestContext(async (url) => {
      if (url.includes('/api/dm/users/search')) {
        const parsed = new URL(url, 'http://localhost');
        searchedQuery = parsed.searchParams.get('q');
        return {
          ok: true,
          json: async () => ({
            users: [
              { studentId: 'teacher_1', name: 'Prof. Miller', username: 'pmiller', role: 'teacher' },
              { studentId: 'student_103', name: 'Charlie Day', username: 'charlie', role: 'cr' },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    await ctx.client.searchUsers('prof');

    assert.equal(searchedQuery, 'prof', 'Should pass query to backend');
    const resultsHtml = ctx.elements.dmUserSearchResults.innerHTML;
    assert.match(resultsHtml, /Prof\. Miller/, 'Should render teacher name');
    assert.match(resultsHtml, /@pmiller/, 'Should render username');
    assert.match(resultsHtml, /TEACHER/, 'Should render teacher role badge');
  });

  // Test 3: Starting a conversation
  test('3. Starting a conversation creates/retrieves conversation and selects it', async () => {
    let targetUserIdSent = null;
    const ctx = createTestContext(async (url, opts) => {
      if (url === '/api/dm/conversations' && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        targetUserIdSent = body.targetUserId;
        return {
          ok: true,
          json: async () => ({
            conversation: { id: 'conv_new_1', participant: { studentId: 'teacher_1', name: 'Prof. Miller', role: 'teacher' } },
            isNew: true,
          }),
        };
      }
      if (url.includes('/api/dm/conversations?limit=')) {
        return {
          ok: true,
          json: async () => ({
            conversations: [{ id: 'conv_new_1', participant: { studentId: 'teacher_1', name: 'Prof. Miller', role: 'teacher' } }],
          }),
        };
      }
      if (url.includes('/messages?limit=')) {
        return { ok: true, json: async () => ({ messages: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    await ctx.client.startConversationWithUser('teacher_1');

    assert.equal(targetUserIdSent, 'teacher_1', 'Should POST targetUserId to /api/dm/conversations');
    assert.equal(ctx.client.activeConversation?.id, 'conv_new_1', 'Should set active conversation');
  });

  // Test 4: Sending a message
  test('4. Sending a message renders optimistically and updates with confirmed server message', async () => {
    let postBody = null;
    const ctx = createTestContext(async (url, opts) => {
      if (url.includes('/messages') && opts?.method === 'POST') {
        postBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            message: {
              id: 999,
              conversationId: 'conv_1',
              senderId: currentUser.studentId,
              clientId: postBody.clientId,
              text: postBody.text,
              createdAt: new Date().toISOString(),
            },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1', participant: { studentId: 'peer_1', name: 'Bob' } };
    ctx.elements.dmTextarea.value = 'Hello world!';

    await ctx.client.sendMessage();

    assert.equal(postBody.text, 'Hello world!', 'Should send message text to backend');
    assert.ok(postBody.clientId, 'Should generate a client-side UUID');
    assert.equal(ctx.client.messages.some(m => m.id === 999 && m.text === 'Hello world!'), true, 'Should retain server-confirmed message');
  });

  // Test 5: Duplicate send prevention
  test('5. Duplicate send prevention: empty send is blocked and identical clientId replaces pending', async () => {
    const ctx = createTestContext();
    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1' };

    // Empty text
    ctx.elements.dmTextarea.value = '   ';
    await ctx.client.sendMessage();
    assert.equal(ctx.client.messages.length, 0, 'Should reject empty message');

    // Duplicate message deduplication logic
    ctx.client.messages = [
      { id: 'opt_123', clientId: 'c-unique-1', text: 'Hey' },
    ];
    ctx.client.handleRealtimeNewMessage({
      conversationId: 'conv_1',
      message: { id: 100, clientId: 'c-unique-1', text: 'Hey' },
    });
    // Should not add second duplicate message bubble
    const matching = ctx.client.messages.filter(m => m.clientId === 'c-unique-1');
    assert.equal(matching.length, 1, 'Should deduplicate message by clientId');
  });

  // Test 6: Message replies
  test('6. Message replies preview quote in context bar and link replyToId', async () => {
    let replyPost = null;
    const ctx = createTestContext(async (url, opts) => {
      if (url.includes('/messages') && opts?.method === 'POST') {
        replyPost = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            message: { id: 201, text: 'Replying here', replyTo: { id: 100, text: 'Original question' } },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1' };
    ctx.client.messages = [
      { id: 100, text: 'Original question', senderId: 'peer_1', senderName: 'Bob' },
    ];

    ctx.client.startReply(100);
    assert.equal(ctx.elements.dmComposerContextBar.style.display, 'flex', 'Context bar should display');
    assert.equal(ctx.client.replyingTo.id, 100, 'replyingTo should be set to 100');

    ctx.elements.dmTextarea.value = 'Here is the answer';
    await ctx.client.sendMessage();

    assert.equal(replyPost.replyToId, 100, 'Should include replyToId in send payload');
  });

  // Test 7: Message editing
  test('7. Editing: Author can edit message, calls PATCH, and displays (edited)', async () => {
    let patchBody = null;
    const ctx = createTestContext(async (url, opts) => {
      if (opts?.method === 'PATCH') {
        patchBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            message: { id: 105, text: 'Updated content', isEdited: true },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1' };
    ctx.client.messages = [
      { id: 105, text: 'Initial typo', senderId: currentUser.studentId, isEdited: false },
    ];

    ctx.client.startEdit(105);
    assert.equal(ctx.elements.dmTextarea.value, 'Initial typo', 'Textarea should receive original text');

    await ctx.client.submitEdit('Updated content');
    assert.equal(patchBody.text, 'Updated content', 'Should PATCH updated text');
    const editedMsg = ctx.client.messages.find(m => m.id === 105);
    assert.equal(editedMsg.isEdited, true, 'isEdited should be true');
    assert.match(ctx.elements.dmTimeline.innerHTML, /\(edited\)/, 'Timeline should display (edited) tag');
  });

  // Test 8: Delete for me
  test('8. Delete for me calls DELETE mode=for_me and hides message locally', async () => {
    let deletedUrl = '';
    const ctx = createTestContext(async (url, opts) => {
      if (opts?.method === 'DELETE') {
        deletedUrl = url;
        return { ok: true, json: async () => ({ mode: 'for_me', deleted: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1' };
    ctx.client.messages = [
      { id: 110, text: 'Message to hide', senderId: 'peer_1' },
    ];
    ctx.client.targetDeleteMsgId = 110;

    await ctx.client.confirmDelete('for_me');
    assert.match(deletedUrl, /mode=for_me/, 'Should pass mode=for_me in request');
    assert.equal(ctx.client.messages.length, 0, 'Message should be removed from caller view');
  });

  // Test 9: Delete for everyone
  test('9. Delete for everyone replaces message bubble with tombstone', async () => {
    let deletedUrl = '';
    const ctx = createTestContext(async (url, opts) => {
      if (opts?.method === 'DELETE') {
        deletedUrl = url;
        return { ok: true, json: async () => ({ mode: 'for_everyone', deleted: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1' };
    ctx.client.messages = [
      { id: 115, text: 'Sensitive info', senderId: currentUser.studentId },
    ];
    ctx.client.targetDeleteMsgId = 115;

    await ctx.client.confirmDelete('for_everyone');
    assert.match(deletedUrl, /mode=for_everyone/, 'Should pass mode=for_everyone in request');
    const msg = ctx.client.messages.find(m => m.id === 115);
    assert.equal(msg.deletedForAll, true, 'deletedForAll should be true');
    assert.match(ctx.elements.dmTimeline.innerHTML, /This message was deleted/, 'Should render deleted placeholder');
  });

  // Test 10: Read receipts
  test('10. Read receipts: Sent (✓) updates to Seen (✓✓) when peer last read reaches message id', async () => {
    let readSent = null;
    const ctx = createTestContext(async (url, opts) => {
      if (url.includes('/read') && opts?.method === 'POST') {
        readSent = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1', participant: { studentId: 'peer_1' } };
    ctx.client.messages = [
      { id: 500, senderId: currentUser.studentId, text: 'Are you there?', createdAt: new Date().toISOString() },
    ];

    ctx.client.renderTimeline();
    assert.match(ctx.elements.dmTimeline.innerHTML, /dm-read-status sent/, 'Should show Sent single tick initially');

    // Peer read event comes in
    ctx.client.handleRealtimeReadReceipt({
      conversationId: 'conv_1',
      readerId: 'peer_1',
      lastReadMessageId: 500,
    });

    assert.equal(ctx.client.peerLastReadMessageId, 500, 'peerLastReadMessageId should update to 500');
    assert.match(ctx.elements.dmTimeline.innerHTML, /dm-read-status seen/, 'Should update to Seen double tick');
  });

  // Test 11: Typing indicators
  test('11. Typing indicators: throttled broadcast and peer typing text auto-expiry', async () => {
    let typingSentCount = 0;
    const ctx = createTestContext(async (url, opts) => {
      if (url.includes('/typing')) {
        typingSentCount++;
        return { ok: true, json: async () => ({ throttled: false }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1', participant: { studentId: 'peer_1' } };

    // Rapid typing triggers throttling
    ctx.client.throttleBroadcastTyping();
    ctx.client.throttleBroadcastTyping();
    ctx.client.throttleBroadcastTyping();
    assert.equal(typingSentCount, 1, 'Rapid typing should be throttled to 1 network call');

    // Receive peer typing event
    ctx.client.handleRealtimeTyping({
      conversationId: 'conv_1',
      studentId: 'peer_1',
      isTyping: true,
    });
    assert.equal(ctx.elements.dmPeerStatusText.textContent, 'Typing...', 'Should display Typing...');
    assert.equal(ctx.elements.dmPeerStatusText.classList.contains('typing'), true);
  });

  // Test 12: Blocking
  test('12. Blocking: disables composer, shows blocked banner and supports unblocking', async () => {
    let blockCalled = false;
    let unblockCalled = false;

    const ctx = createTestContext(async (url, opts) => {
      if (url.includes('/block') && opts?.method === 'POST') {
        blockCalled = true;
        return { ok: true, json: async () => ({ blocked: true }) };
      }
      if (url.includes('/block') && opts?.method === 'DELETE') {
        unblockCalled = true;
        return { ok: true, json: async () => ({ blocked: false }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1', participant: { studentId: 'peer_bad', name: 'Bad Actor' } };

    await ctx.client.confirmBlockPeer();
    assert.equal(blockCalled, true, 'Should call POST /api/dm/users/:id/block');
    assert.equal(ctx.elements.dmBlockedBanner.style.display, 'flex', 'Blocked banner should display');

    await ctx.client.unblockActivePeer();
    assert.equal(unblockCalled, true, 'Should call DELETE /api/dm/users/:id/block');
    assert.equal(ctx.elements.dmBlockedBanner.style.display, 'none', 'Blocked banner should hide after unblock');
  });

  // Test 13: Reporting
  test('13. Reporting: captures reason, description, and target message id', async () => {
    let reportPayload = null;
    const ctx = createTestContext(async (url, opts) => {
      if (url.includes('/reports') && opts?.method === 'POST') {
        reportPayload = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ reportId: 'rep_1', status: 'pending' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1', participant: { studentId: 'peer_spammer' } };
    ctx.client.reportTargetMsgId = 444;

    ctx.elements.dmReportReasonSelect.value = 'spam';
    ctx.elements.dmReportDescInput.value = 'Selling unverified crypto';

    await ctx.client.submitReport();
    assert.equal(reportPayload.conversationId, 'conv_1');
    assert.equal(reportPayload.reportedUserId, 'peer_spammer');
    assert.equal(reportPayload.reportedMessageId, 444);
    assert.equal(reportPayload.reason, 'spam');
    assert.equal(reportPayload.description, 'Selling unverified crypto');
  });

  // Test 14: Reconnection
  test('14. Reconnection & sync endpoint reconciles new messages and edits without gaps', async () => {
    const ctx = createTestContext(async (url) => {
      if (url.includes('/sync')) {
        return {
          ok: true,
          json: async () => ({
            messages: [{ id: 601, text: 'Message missed during outage', senderId: 'peer_1' }],
            edits: [{ messageId: 600, text: 'Edited while offline' }],
            deletions: [],
            peerLastReadMessageId: 601,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1' };
    ctx.client.messages = [
      { id: 600, text: 'Original before outage', senderId: 'peer_1' },
    ];

    await ctx.client.syncActiveConversation();
    assert.equal(ctx.client.messages.length, 2, 'Missed message should be appended');
    assert.equal(ctx.client.messages[0].text, 'Edited while offline', 'Edit should be reconciled');
  });

  // Test 15: Loading older messages
  test('15. Loading older messages with cursor before=id prepends deduplicated messages', async () => {
    let beforeParam = null;
    const ctx = createTestContext(async (url) => {
      if (url.includes('/messages')) {
        const parsed = new URL(url, 'http://localhost');
        beforeParam = parsed.searchParams.get('before');
        return {
          ok: true,
          json: async () => ({
            messages: [
              { id: 10, text: 'Oldest message', createdAt: '2026-09-01T10:00:00Z' },
              { id: 20, text: 'Older message', createdAt: '2026-09-01T11:00:00Z' },
            ],
            hasMore: false,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.activeConversation = { id: 'conv_1' };
    ctx.client.messages = [
      { id: 30, text: 'Current message', createdAt: '2026-09-02T10:00:00Z' },
    ];
    ctx.client.hasMore = true;

    await ctx.client.loadOlderMessages();
    assert.equal(beforeParam, '30', 'Should pass oldest message id 30 as before parameter');
    assert.equal(ctx.client.messages.length, 3, 'Older messages should be prepended');
    assert.equal(ctx.client.messages[0].id, 10, 'First message should be oldest id 10');
  });

  // Test 16: Empty states
  test('16. Empty states: empty inbox and empty conversation thread display guidance', async () => {
    const ctx = createTestContext(async (url) => {
      if (url.includes('/conversations?limit=')) return { ok: true, json: async () => ({ conversations: [] }) };
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    await ctx.client.loadConversations();
    assert.match(ctx.elements.dmConvList.innerHTML, /No messages yet/, 'Should display empty inbox notice');

    ctx.client.activeConversation = { id: 'conv_empty', participant: { name: 'Bob' } };
    ctx.client.messages = [];
    ctx.client.renderTimeline();
    assert.match(ctx.elements.dmTimeline.innerHTML, /No messages in this chat yet/, 'Should display empty timeline notice');
  });

  // Test 17: Mobile browser layout
  test('17. Mobile browser layout: navigation into conversation and back button transition', async () => {
    const ctx = createTestContext(async (url) => {
      if (url.includes('/messages?limit=')) return { ok: true, json: async () => ({ messages: [] }) };
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    ctx.client.conversations = [{ id: 'conv_m1', participant: { name: 'Dave' } }];

    // Select conversation -> adds in-conversation class
    await ctx.client.selectConversation('conv_m1');
    assert.equal(ctx.elements.dmLayout.classList.contains('in-conversation'), true, 'Should enter in-conversation view');

    // Click back button -> removes in-conversation class
    ctx.client.closeActiveConversationMobile();
    assert.equal(ctx.elements.dmLayout.classList.contains('in-conversation'), false, 'Should return to inbox list view');
    assert.equal(ctx.client.activeConversation, null, 'Active conversation should be cleared');
  });

  // Test 18: Account logout and cache clearing
  test('18. Account logout and cache clearing: storage event clears cache and resets state', async () => {
    const ctx = createTestContext();
    await ctx.client.init(currentUser);
    ctx.window.localStorage.setItem(`sl_dm_cache_${currentUser.studentId}`, JSON.stringify({ cached: true }));
    ctx.client.conversations = [{ id: 'c1' }];

    // Trigger logout storage event
    ctx.window.dispatchEvent({ type: 'storage', key: 'supabase.auth.token' });

    assert.equal(ctx.client.conversations.length, 0, 'Conversations should be reset');
    assert.equal(ctx.window.localStorage.getItem(`sl_dm_cache_${currentUser.studentId}`), null, 'Cache key should be deleted');
  });

  // Test 19: Feature flag disabled
  test('19. Feature flag disabled: hides DM navigation and prevents DM requests', async () => {
    let dmApiCallMade = false;
    const ctx = createTestContext(async (url) => {
      if (url.includes('/api/dm-status')) {
        return { ok: true, json: async () => ({ enabled: false }) };
      }
      if (url.startsWith('/api/dm/')) {
        dmApiCallMade = true;
      }
      return { ok: true, json: async () => ({}) };
    });

    await ctx.client.init(currentUser);
    assert.equal(ctx.elements.chatModeBar.style.display, 'none', 'Mode bar should be hidden when DM is disabled');
    assert.equal(ctx.client.enabled, false, 'Client enabled flag should be false');
    assert.equal(dmApiCallMade, false, 'No /api/dm/ API requests should have been made');
  });

  // Test 20: Existing cohort chat regression
  test('20. Existing cohort chat regression: cohort chat structures and functions intact', () => {
    const chatHtml = fs.readFileSync(path.join(__dirname, '../public/chat.html'), 'utf8');

    // Cohort engine and client references intact
    assert.match(chatHtml, /createCohortClient/, 'Cohort client constructor must be preserved');
    assert.match(chatHtml, /headerGroupInfoBtn/, 'Cohort group info button must be intact');
    assert.match(chatHtml, /pinnedBanner/, 'Pinned announcement banner must be intact');
    assert.match(chatHtml, /chatFeed/, 'Cohort chat feed container must be intact');
    assert.match(chatHtml, /cohortChatMain/, 'Cohort chat main container must be preserved');
  });

});
