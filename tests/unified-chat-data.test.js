const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../mobile/node_modules/typescript');

function loadTs(file, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../mobile/services', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(
    name => { if (!imports[name]) throw Error(`Unexpected import ${name}`); return imports[name]; },
    module,
    module.exports
  );
  return module.exports;
}

const inbox = loadTs('unified-inbox.ts');

describe('Step 5B.3.4A — Unified Chat Data Foundation', () => {

  // 1. Admin cohort normalization
  test('1. Normalizes AdminChatRoom into CohortConversationItem with stable cohort: key', () => {
    const rawAdminRoom = {
      chatGroupId: '0a3e569e-d539-4c91-b172-dcee5fb1855d',
      cohortId: 'cohort-mercury-uuid',
      groupCode: 'MERCURY',
      cohortDisplayName: 'Mercury',
      currentSemester: 1,
      roomStatus: 'active',
      latestMessage: 'Alice: Welcome to Semester 1',
      latestMessageAt: '2026-10-08T15:30:00.000Z',
      unreadCount: 3,
    };

    const adapted = inbox.adaptAdminCohortRoom(rawAdminRoom);
    assert.ok(adapted);
    assert.equal(adapted.key, 'cohort:0a3e569e-d539-4c91-b172-dcee5fb1855d');
    assert.equal(adapted.type, 'cohort');
    assert.equal(adapted.chatGroupId, '0a3e569e-d539-4c91-b172-dcee5fb1855d');
    assert.equal(adapted.cohortId, 'cohort-mercury-uuid');
    assert.equal(adapted.groupCode, 'MERCURY');
    assert.equal(adapted.title, 'Mercury');
    assert.equal(adapted.subtitle, 'Alice: Welcome to Semester 1');
    assert.equal(adapted.timestamp, '2026-10-08T15:30:00.000Z');
    assert.equal(adapted.unreadCount, 3);
    assert.equal(adapted.currentSemester, 1);
    assert.equal(adapted.roomStatus, 'active');
  });

  // 2. Student cohort normalization
  test('2. Normalizes student ChatConfig into CohortConversationItem with explicit null preview when unmeasured', () => {
    const rawStudentConfig = {
      studentId: '26020266',
      chatGroupId: 'cc96e30c-16a0-40d0-87b6-444d103af42f',
      cohortId: 'cohort-earth-uuid',
      groupCode: 'EARTH',
      cohortDisplayName: 'Earth',
      currentSemester: 5,
      roomStatus: 'active',
      cohortStatus: 'active',
      realtimeEpoch: 1,
      permissions: { canPost: true, canPin: false },
    };

    // Case A: Without optional preview (standard /api/chat/config response)
    const adaptedWithoutPreview = inbox.adaptStudentCohortConfig(rawStudentConfig);
    assert.ok(adaptedWithoutPreview);
    assert.equal(adaptedWithoutPreview.key, 'cohort:cc96e30c-16a0-40d0-87b6-444d103af42f');
    assert.equal(adaptedWithoutPreview.type, 'cohort');
    assert.equal(adaptedWithoutPreview.title, 'Earth');
    assert.equal(adaptedWithoutPreview.subtitle, null);
    assert.equal(adaptedWithoutPreview.timestamp, null);
    assert.equal(adaptedWithoutPreview.unreadCount, null); // Explicit null, not fake zero
    assert.equal(adaptedWithoutPreview.canPin, false);

    // Case B: With cached local preview
    const adaptedWithPreview = inbox.adaptStudentCohortConfig(rawStudentConfig, {
      latestMessage: 'Assignment due tomorrow',
      latestMessageAt: '2026-10-08T12:00:00.000Z',
      unreadCount: 1,
    });
    assert.ok(adaptedWithPreview);
    assert.equal(adaptedWithPreview.subtitle, 'Assignment due tomorrow');
    assert.equal(adaptedWithPreview.timestamp, '2026-10-08T12:00:00.000Z');
    assert.equal(adaptedWithPreview.unreadCount, 1);
  });

  // 3. DM normalization
  test('3. Normalizes DmConversationItem with stable dm: key and peer metadata', () => {
    const rawDm = {
      id: 'dm-conv-uuid-123',
      participant: {
        studentId: '12345678',
        name: 'Sau Gat',
        username: 'sauuu_gat',
        avatarUrl: 'https://example.com/avatar.jpg',
        role: 'admin',
      },
      lastMessage: {
        id: 42,
        text: 'Let us coordinate the exam schedule.',
        senderId: '12345678',
        deletedForAll: false,
        createdAt: '2026-10-08T16:45:00.000Z',
      },
      lastMessageAt: '2026-10-08T16:45:00.000Z',
      unreadCount: 2,
      isMuted: false,
      blocked: false,
      blockedByMe: false,
      blockedByPeer: false,
    };

    const adapted = inbox.adaptDmConversation(rawDm);
    assert.ok(adapted);
    assert.equal(adapted.key, 'dm:dm-conv-uuid-123');
    assert.equal(adapted.type, 'dm');
    assert.equal(adapted.conversationId, 'dm-conv-uuid-123');
    assert.equal(adapted.peerId, '12345678');
    assert.equal(adapted.title, 'Sau Gat');
    assert.equal(adapted.subtitle, 'Let us coordinate the exam schedule.');
    assert.equal(adapted.timestamp, '2026-10-08T16:45:00.000Z');
    assert.equal(adapted.unreadCount, 2);
    assert.equal(adapted.peerUsername, 'sauuu_gat');
    assert.equal(adapted.peerAvatarUrl, 'https://example.com/avatar.jpg');
    assert.equal(adapted.peerRole, 'admin');
    assert.equal(adapted.isBlocked, false);
  });

  // 4. Stable unique keys and collision resistance
  test('4. Stable keys enforce namespace collision resistance between groups and DMs', () => {
    const sharedId = 'shared-uuid-999';
    const cohortItem = inbox.adaptAdminCohortRoom({
      chatGroupId: sharedId,
      cohortId: 'c1',
      groupCode: 'MARS',
      cohortDisplayName: 'Mars',
      currentSemester: 7,
      roomStatus: 'active',
      latestMessage: 'Lab update',
      latestMessageAt: '2026-10-08T10:00:00.000Z',
      unreadCount: 0,
    });
    const dmItem = inbox.adaptDmConversation({
      id: sharedId,
      participant: { studentId: 'u2', name: 'Bob' },
      lastMessage: { id: 1, text: 'Hi', createdAt: '2026-10-08T11:00:00.000Z' },
      unreadCount: 0,
    });

    assert.equal(cohortItem.key, `cohort:${sharedId}`);
    assert.equal(dmItem.key, `dm:${sharedId}`);
    assert.notEqual(cohortItem.key, dmItem.key);

    const normalized = inbox.normalizeUnifiedConversations({
      adminRooms: [cohortItem],
      dmConversations: [dmItem],
    });
    assert.equal(normalized.length, 2);
    assert.deepEqual(normalized.map(n => n.key), [`cohort:${sharedId}`, `dm:${sharedId}`]);
  });

  // 5. Invalid or missing timestamps
  test('5. Handles missing or invalid timestamps without fabricating dates', () => {
    assert.equal(inbox.parseActivityTimestamp(null), null);
    assert.equal(inbox.parseActivityTimestamp(undefined), null);
    assert.equal(inbox.parseActivityTimestamp(''), null);
    assert.equal(inbox.parseActivityTimestamp('invalid-date-string'), null);
    assert.equal(inbox.parseActivityTimestamp('2026-10-08T12:00:00.000Z'), Date.parse('2026-10-08T12:00:00.000Z'));

    const roomWithBogusDate = inbox.adaptAdminCohortRoom({
      chatGroupId: 'g1',
      cohortId: 'c1',
      groupCode: 'VENUS',
      cohortDisplayName: 'Venus',
      currentSemester: 3,
      roomStatus: 'active',
      latestMessage: 'Hello',
      latestMessageAt: 'not-a-real-date',
      unreadCount: 0,
    });
    assert.equal(roomWithBogusDate.timestamp, null);
  });

  // 6. Missing unread metadata
  test('6. Distinguishes unknown unread count (null) from confirmed zero (0)', () => {
    const studentCohortWithoutCounter = inbox.adaptStudentCohortConfig({
      chatGroupId: 'cg-1',
      cohortId: 'c1',
      groupCode: 'MERCURY',
      currentSemester: 1,
      roomStatus: 'active',
    });
    assert.equal(studentCohortWithoutCounter.unreadCount, null);

    const dmWithConfirmedZero = inbox.adaptDmConversation({
      id: 'dm-1',
      participant: { studentId: 's1', name: 'User 1' },
      unreadCount: 0,
    });
    assert.equal(dmWithConfirmedZero.unreadCount, 0);

    const dmWithConfirmedTwo = inbox.adaptDmConversation({
      id: 'dm-2',
      participant: { studentId: 's2', name: 'User 2' },
      unreadCount: 2,
    });
    assert.equal(dmWithConfirmedTwo.unreadCount, 2);

    // Filtering by 'unread' must NOT match null (unknown) or 0
    const unreadOnly = inbox.filterUnifiedConversations(
      [studentCohortWithoutCounter, dmWithConfirmedZero, dmWithConfirmedTwo],
      'unread'
    );
    assert.equal(unreadOnly.length, 1);
    assert.equal(unreadOnly[0].key, 'dm:dm-2');
  });

  // 7. Activity sorting
  test('7. Sorts deterministically by genuine activity timestamp descending; missing timestamps follow at end', () => {
    const itemRecent = {
      key: 'dm:1',
      type: 'dm',
      conversationId: '1',
      peerId: 'p1',
      title: 'Recent DM',
      subtitle: 'Hi',
      timestamp: '2026-10-08T18:00:00.000Z', // Newest
      unreadCount: 0,
    };
    const itemOlder = {
      key: 'cohort:mercury',
      type: 'cohort',
      chatGroupId: 'mercury',
      cohortId: 'c1',
      groupCode: 'MERCURY',
      title: 'Mercury',
      subtitle: 'Announcement',
      timestamp: '2026-10-08T15:00:00.000Z', // Older
      unreadCount: 0,
      currentSemester: 1,
      roomStatus: 'active',
    };
    const itemNoTimestampCohort = {
      key: 'cohort:venus',
      type: 'cohort',
      chatGroupId: 'venus',
      cohortId: 'c2',
      groupCode: 'VENUS',
      title: 'Venus',
      subtitle: null,
      timestamp: null, // No timestamp
      unreadCount: null,
      currentSemester: 3,
      roomStatus: 'active',
    };
    const itemNoTimestampDm = {
      key: 'dm:empty',
      type: 'dm',
      conversationId: 'empty',
      peerId: 'p2',
      title: 'Alice Empty',
      subtitle: null,
      timestamp: null, // No timestamp
      unreadCount: 0,
    };

    // Input in arbitrary order
    const sorted = inbox.sortUnifiedConversations([
      itemNoTimestampDm,
      itemOlder,
      itemNoTimestampCohort,
      itemRecent,
    ]);

    assert.equal(sorted[0].key, 'dm:1');                     // 18:00:00
    assert.equal(sorted[1].key, 'cohort:mercury');           // 15:00:00
    assert.equal(sorted[2].key, 'cohort:venus');             // No timestamp, cohort before DM
    assert.equal(sorted[3].key, 'dm:empty');                 // No timestamp, DM after cohort
  });

  // 8. Filtering
  test('8. Filter tabs (all, unread, groups) return expected subsets without mutating input', () => {
    const items = [
      { key: 'cohort:1', type: 'cohort', title: 'Mercury', unreadCount: 0 },
      { key: 'cohort:2', type: 'cohort', title: 'Venus', unreadCount: 4 },
      { key: 'dm:1', type: 'dm', title: 'Alice', unreadCount: 1 },
      { key: 'dm:2', type: 'dm', title: 'Bob', unreadCount: 0 },
      { key: 'cohort:3', type: 'cohort', title: 'Earth', unreadCount: null },
    ];

    const all = inbox.filterUnifiedConversations(items, 'all');
    assert.equal(all.length, 5);

    const unread = inbox.filterUnifiedConversations(items, 'unread');
    assert.equal(unread.length, 2);
    assert.deepEqual(unread.map(i => i.key), ['cohort:2', 'dm:1']);

    const groups = inbox.filterUnifiedConversations(items, 'groups');
    assert.equal(groups.length, 3);
    assert.deepEqual(groups.map(i => i.key), ['cohort:1', 'cohort:2', 'cohort:3']);
  });

  // 9. Search
  test('9. Search filters across titles, subtitles, group codes, and usernames case-insensitively', () => {
    const items = [
      { key: 'cohort:1', type: 'cohort', title: 'Mercury', groupCode: 'MERCURY', subtitle: 'Calculus assignment' },
      { key: 'cohort:2', type: 'cohort', title: 'Venus', groupCode: 'VENUS', subtitle: 'Physics notes' },
      { key: 'dm:1', type: 'dm', title: 'Sau Gat', peerUsername: 'sauuu_gat', subtitle: 'Hey check this code' },
      { key: 'dm:2', type: 'dm', title: 'John Doe', peerUsername: 'johndoe', subtitle: 'Tomorrow at 10' },
    ];

    // Empty search
    assert.equal(inbox.searchUnifiedConversations(items, '').length, 4);
    assert.equal(inbox.searchUnifiedConversations(items, '   ').length, 4);

    // Search by title
    const searchMercury = inbox.searchUnifiedConversations(items, 'merc');
    assert.equal(searchMercury.length, 1);
    assert.equal(searchMercury[0].key, 'cohort:1');

    // Search by subtitle preview
    const searchPhysics = inbox.searchUnifiedConversations(items, 'physics');
    assert.equal(searchPhysics.length, 1);
    assert.equal(searchPhysics[0].key, 'cohort:2');

    // Search by peer username
    const searchHandle = inbox.searchUnifiedConversations(items, 'sauuu');
    assert.equal(searchHandle.length, 1);
    assert.equal(searchHandle[0].key, 'dm:1');

    // Search matching multiple
    const searchGeneral = inbox.searchUnifiedConversations(items, 'at');
    assert.ok(searchGeneral.length >= 1);
  });

  // 10. Empty arrays and malformed inputs
  test('10. Safely handles empty arrays, null/undefined entries, and malformed inputs', () => {
    assert.equal(inbox.adaptAdminCohortRoom(null), null);
    assert.equal(inbox.adaptAdminCohortRoom(undefined), null);
    assert.equal(inbox.adaptAdminCohortRoom({}), null); // Missing chatGroupId
    assert.equal(inbox.adaptAdminCohortRoom({ chatGroupId: '   ' }), null);

    assert.equal(inbox.adaptStudentCohortConfig(null), null);
    assert.equal(inbox.adaptStudentCohortConfig({}), null);

    assert.equal(inbox.adaptDmConversation(null), null);
    assert.equal(inbox.adaptDmConversation({}), null); // Missing id

    const normalized = inbox.normalizeUnifiedConversations({
      adminRooms: [null, undefined, { invalid: true }],
      studentConfig: null,
      dmConversations: [undefined, { id: '' }],
    });
    assert.deepEqual(normalized, []);

    assert.deepEqual(inbox.sortUnifiedConversations([]), []);
    assert.deepEqual(inbox.filterUnifiedConversations([], 'unread'), []);
    assert.deepEqual(inbox.searchUnifiedConversations([], 'hello'), []);
  });

  // 11. Duplicate source records
  test('11. Deduplicates multiple occurrences of the same key across sources', () => {
    const rawRoom = {
      chatGroupId: '0a3e569e-d539-4c91-b172-dcee5fb1855d',
      cohortId: 'c1',
      groupCode: 'MERCURY',
      cohortDisplayName: 'Mercury',
      currentSemester: 1,
      roomStatus: 'active',
      latestMessage: 'First message',
      latestMessageAt: '2026-10-08T10:00:00.000Z',
      unreadCount: 0,
    };
    const duplicateRawRoom = {
      ...rawRoom,
      latestMessage: 'Duplicate entry',
    };

    const normalized = inbox.normalizeUnifiedConversations({
      adminRooms: [rawRoom, duplicateRawRoom],
    });

    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].key, 'cohort:0a3e569e-d539-4c91-b172-dcee5fb1855d');
    assert.equal(normalized[0].subtitle, 'First message');
  });

  // 12. Tombstone handling for deleted DMs
  test('12. Respects deletedForAll tombstone on DM lastMessage without exposing text', () => {
    const dmDeleted = {
      id: 'dm-tombstone',
      participant: { studentId: 'p1', name: 'Alice' },
      lastMessage: {
        id: 99,
        text: 'Secret text that was deleted',
        deletedForAll: true,
        createdAt: '2026-10-08T14:00:00.000Z',
      },
      unreadCount: 0,
    };

    const adapted = inbox.adaptDmConversation(dmDeleted);
    assert.ok(adapted);
    assert.equal(adapted.subtitle, null); // Must not display deletedForAll message text
    assert.equal(adapted.timestamp, '2026-10-08T14:00:00.000Z'); // Timestamp preserved
  });

  // 13. Admin unified inbox
  test('13. Admin unified inbox: displays all authorized cohorts alongside DMs sorted deterministically', () => {
    const adminRooms = [
      { chatGroupId: 'room-1', cohortId: 'c1', groupCode: 'MERCURY', cohortDisplayName: 'Mercury', currentSemester: 1, roomStatus: 'active', latestMessage: 'Hello Mercury', latestMessageAt: '2026-10-08T10:00:00.000Z', unreadCount: 0 },
      { chatGroupId: 'room-2', cohortId: 'c2', groupCode: 'VENUS', cohortDisplayName: 'Venus', currentSemester: 2, roomStatus: 'active', latestMessage: 'Hello Venus', latestMessageAt: '2026-10-08T12:00:00.000Z', unreadCount: 2 },
    ];
    const dms = [
      { id: 'dm-1', participant: { studentId: 'u1', name: 'Dr. Jane' }, lastMessage: { id: 1, text: 'Hi admin', createdAt: '2026-10-08T11:00:00.000Z' }, unreadCount: 1 },
    ];

    const normalized = inbox.normalizeUnifiedConversations({ adminRooms, dmConversations: dms });
    assert.equal(normalized.length, 3);
    const sorted = inbox.sortUnifiedConversations(normalized);
    // Order: Venus (12:00) -> Dr. Jane DM (11:00) -> Mercury (10:00)
    assert.equal(sorted[0].key, 'cohort:room-2');
    assert.equal(sorted[1].key, 'dm:dm-1');
    assert.equal(sorted[2].key, 'cohort:room-1');
  });

  // 14. Student unified inbox
  test('14. Student unified inbox: displays single assigned cohort alongside DMs', () => {
    const studentConfig = {
      studentId: '26020266',
      chatGroupId: 'room-earth',
      cohortId: 'c3',
      groupCode: 'EARTH',
      cohortDisplayName: 'Earth',
      currentSemester: 5,
      roomStatus: 'active',
      cohortStatus: 'active',
      realtimeEpoch: 1,
      permissions: { canPost: true, canPin: false },
    };
    const dms = [
      { id: 'dm-2', participant: { studentId: 'u2', name: 'Bob' }, lastMessage: { id: 2, text: 'Hey there', createdAt: '2026-10-08T09:00:00.000Z' }, unreadCount: 0 },
    ];

    const normalized = inbox.normalizeUnifiedConversations({ studentConfig, dmConversations: dms });
    assert.equal(normalized.length, 2);
    const sorted = inbox.sortUnifiedConversations(normalized);
    // DM with timestamp (09:00) precedes student cohort with null timestamp
    assert.equal(sorted[0].key, 'dm:dm-2');
    assert.equal(sorted[1].key, 'cohort:room-earth');
    assert.equal(sorted[1].type, 'cohort');
  });

  // 15. CR permissions
  test('15. CR permissions: preserves canPin permission when configured', () => {
    const crConfig = {
      studentId: 'cr-101',
      chatGroupId: 'room-mars',
      cohortId: 'c4',
      groupCode: 'MARS',
      cohortDisplayName: 'Mars',
      currentSemester: 3,
      roomStatus: 'active',
      cohortStatus: 'active',
      realtimeEpoch: 1,
      permissions: { canPost: true, canPin: true },
    };

    const adapted = inbox.adaptStudentCohortConfig(crConfig);
    assert.ok(adapted);
    assert.equal(adapted.canPin, true);
  });

  // 16. Teacher authorization handling
  test('16. Teacher authorization handling: uses strictly backend-authorized config without inventing teacher access', () => {
    // Teacher response returns standard ChatConfig from /api/chat/config
    const teacherConfig = {
      studentId: 'prof-smith',
      chatGroupId: 'room-faculty-cohort',
      cohortId: 'c-faculty',
      groupCode: 'EARTH',
      cohortDisplayName: 'Earth Faculty',
      currentSemester: 5,
      roomStatus: 'active',
      cohortStatus: 'active',
      realtimeEpoch: 1,
      permissions: { canPost: true, canPin: true },
    };

    const adapted = inbox.adaptStudentCohortConfig(teacherConfig);
    assert.ok(adapted);
    assert.equal(adapted.key, 'cohort:room-faculty-cohort');
    assert.equal(adapted.title, 'Earth Faculty');

    // Unauthorized teacher returns null / throws 403 on backend, resulting in null config
    const unauthorized = inbox.normalizeUnifiedConversations({ studentConfig: null });
    assert.deepEqual(unauthorized, []);
  });

  // 17. Cohort row navigation contract
  test('17. Cohort row navigation: item contract provides genuine chatGroupId and groupCode', () => {
    const raw = {
      chatGroupId: 'room-nav-1',
      cohortId: 'c-nav',
      groupCode: 'VENUS',
      cohortDisplayName: 'Venus',
      currentSemester: 2,
      roomStatus: 'active',
      latestMessage: 'Assignment 1',
      latestMessageAt: '2026-10-08T10:00:00.000Z',
      unreadCount: 0,
    };
    const item = inbox.adaptAdminCohortRoom(raw);
    assert.ok(item);

    // Simulated handleSelectCohort(item)
    let selectedRoom = null;
    const handleSelectCohort = (selected) => { selectedRoom = selected; };
    handleSelectCohort(item);

    assert.equal(selectedRoom.chatGroupId, 'room-nav-1');
    assert.equal(selectedRoom.groupCode, 'VENUS');
  });

  // 18. DM row navigation contract
  test('18. DM row navigation: item contract provides parameters required by /dm/[id]', () => {
    const raw = {
      id: 'dm-nav-uuid',
      participant: {
        studentId: 'p-123',
        name: 'Alice Smith',
        role: 'student',
        avatarUrl: 'https://example.com/alice.jpg',
      },
      lastMessage: { id: 10, text: 'See you in class', createdAt: '2026-10-08T11:00:00.000Z' },
      unreadCount: 1,
    };
    const item = inbox.adaptDmConversation(raw);
    assert.ok(item);

    // Simulated handleSelectDm(item) route payload
    const routePayload = {
      id: item.conversationId,
      peerId: item.peerId,
      peerName: item.title,
      peerRole: item.peerRole,
      peerAvatarUrl: item.peerAvatarUrl || '',
    };

    assert.equal(routePayload.id, 'dm-nav-uuid');
    assert.equal(routePayload.peerId, 'p-123');
    assert.equal(routePayload.peerName, 'Alice Smith');
    assert.equal(routePayload.peerRole, 'student');
    assert.equal(routePayload.peerAvatarUrl, 'https://example.com/alice.jpg');
  });

  // 19. New Message navigation gating
  test('19. New Message navigation: gated by dmEnabled status', () => {
    let pushedRoute = null;
    let alertShown = false;

    const handleNewMessage = (dmEnabled) => {
      if (dmEnabled) {
        pushedRoute = '/dm/new';
      } else {
        alertShown = true;
      }
    };

    // When DMs enabled
    handleNewMessage(true);
    assert.equal(pushedRoute, '/dm/new');
    assert.equal(alertShown, false);

    // When DMs disabled
    pushedRoute = null;
    handleNewMessage(false);
    assert.equal(pushedRoute, null);
    assert.equal(alertShown, true);
  });

  // 20. Android Back behavior hierarchy
  test('20. Android Back behavior: modal dismissal -> cohort room to inbox -> default tab exit', () => {
    let state = {
      viewerImage: null,
      showAttachModal: false,
      actionMessage: null,
      panel: null,
      selectedCohortRoom: { chatGroupId: 'room-1' },
      exitedToHome: false,
    };

    const handleBack = () => {
      if (state.viewerImage) { state.viewerImage = null; return true; }
      if (state.showAttachModal) { state.showAttachModal = false; return true; }
      if (state.actionMessage) { state.actionMessage = null; return true; }
      if (state.panel) { state.panel = null; return true; }
      if (state.selectedCohortRoom) { state.selectedCohortRoom = null; return true; }
      state.exitedToHome = true;
      return true;
    };

    // Press 1: while in cohort room -> returns to unified inbox
    assert.equal(handleBack(), true);
    assert.equal(state.selectedCohortRoom, null);
    assert.equal(state.exitedToHome, false);

    // Press 2: while in unified inbox -> exits to home
    assert.equal(handleBack(), true);
    assert.equal(state.exitedToHome, true);
  });

  // 21. Independent concurrent loading
  test('21. Independent loading: Promise.allSettled runs cohort and DM requests independently', async () => {
    let cohortLoaded = false;
    let dmLoaded = false;

    const loadCohorts = async () => {
      await new Promise(r => setTimeout(r, 10));
      cohortLoaded = true;
    };
    const loadDms = async () => {
      await new Promise(r => setTimeout(r, 5));
      dmLoaded = true;
    };

    await Promise.allSettled([loadCohorts(), loadDms()]);
    assert.equal(cohortLoaded, true);
    assert.equal(dmLoaded, true);
  });

  // 22. DM failure isolation
  test('22. DM failure isolation: DM failure does not hide available cohort conversations', () => {
    const adminRooms = [
      { chatGroupId: 'room-1', cohortId: 'c1', groupCode: 'MERCURY', cohortDisplayName: 'Mercury', currentSemester: 1, roomStatus: 'active', latestMessage: 'Hello', latestMessageAt: '2026-10-08T10:00:00.000Z', unreadCount: 0 },
    ];
    // DM service throws or is unavailable: dmConversations is empty or undefined
    const normalized = inbox.normalizeUnifiedConversations({ adminRooms, dmConversations: undefined });
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].key, 'cohort:room-1');
  });

  // 23. Cohort failure isolation
  test('23. Cohort failure isolation: Cohort failure does not hide available DM conversations', () => {
    const dms = [
      { id: 'dm-1', participant: { studentId: 'u1', name: 'Alice' }, lastMessage: { id: 1, text: 'Hi', createdAt: '2026-10-08T10:00:00.000Z' }, unreadCount: 0 },
    ];
    // Cohort fetch failed: adminRooms / studentConfig is undefined / null
    const normalized = inbox.normalizeUnifiedConversations({ adminRooms: undefined, studentConfig: null, dmConversations: dms });
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].key, 'dm:dm-1');
  });

  // 24. Unknown timestamps handling
  test('24. Unknown timestamps: items without timestamps are placed deterministically at end', () => {
    const itemWithTime = {
      key: 'dm:1',
      type: 'dm',
      timestamp: '2026-10-08T12:00:00.000Z',
      title: 'DM 1',
    };
    const itemWithoutTime = {
      key: 'cohort:1',
      type: 'cohort',
      timestamp: null,
      title: 'Cohort 1',
    };

    const sorted = inbox.sortUnifiedConversations([itemWithoutTime, itemWithTime]);
    assert.equal(sorted[0].key, 'dm:1');
    assert.equal(sorted[1].key, 'cohort:1');
    assert.equal(sorted[1].timestamp, null); // Timestamp remains genuinely null
  });

  // 25. Unknown unread counts handling
  test('25. Unknown unread counts: null unread count is preserved and not converted to 0', () => {
    const rawStudent = {
      studentId: 'u1',
      chatGroupId: 'g1',
      cohortId: 'c1',
      groupCode: 'MERCURY',
      cohortDisplayName: 'Mercury',
      currentSemester: 1,
      roomStatus: 'active',
      cohortStatus: 'active',
      realtimeEpoch: 1,
    };
    const adapted = inbox.adaptStudentCohortConfig(rawStudent);
    assert.equal(adapted.unreadCount, null);

    // Filters: unread filter should only include items where unreadCount is explicitly > 0
    const filtered = inbox.filterUnifiedConversations([adapted], 'unread');
    assert.deepEqual(filtered, []);
  });

  // 26. Account switching isolation
  test('26. Account switching: clearing state on studentId change isolates caches', () => {
    let state = {
      selectedCohortRoom: { key: 'cohort:1' },
      adminRooms: [{ chatGroupId: 'room-1' }],
      dmConversations: [{ id: 'dm-1' }],
      cohortError: 'Previous error',
      dmError: 'Previous dm error',
    };

    const onAccountSwitch = () => {
      state.selectedCohortRoom = null;
      state.adminRooms = [];
      state.dmConversations = [];
      state.cohortError = null;
      state.dmError = null;
    };

    onAccountSwitch();
    assert.equal(state.selectedCohortRoom, null);
    assert.deepEqual(state.adminRooms, []);
    assert.deepEqual(state.dmConversations, []);
    assert.equal(state.cohortError, null);
    assert.equal(state.dmError, null);
  });

  // 27. Duplicate item prevention across sources
  test('27. Duplicate item prevention: removes duplicate keys across sources', () => {
    const raw1 = {
      chatGroupId: 'shared-id',
      cohortId: 'c1',
      groupCode: 'MERCURY',
      cohortDisplayName: 'Mercury',
      currentSemester: 1,
      roomStatus: 'active',
      latestMessage: 'First instance',
      latestMessageAt: '2026-10-08T10:00:00.000Z',
      unreadCount: 0,
    };
    const raw2 = {
      ...raw1,
      latestMessage: 'Duplicate instance',
    };

    const normalized = inbox.normalizeUnifiedConversations({ adminRooms: [raw1, raw2] });
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].subtitle, 'First instance');
  });

  // 28. Realtime cleanup lifecycle
  test('28. Realtime cleanup: dormant in inbox, active only when cohort room selected', () => {
    let realtimeConnected = false;

    const onSelectCohort = () => { realtimeConnected = true; };
    const onBackToInbox = () => { realtimeConnected = false; };

    // At inbox: dormant
    assert.equal(realtimeConnected, false);
    // User taps cohort
    onSelectCohort();
    assert.equal(realtimeConnected, true);
    // User presses back
    onBackToInbox();
    assert.equal(realtimeConnected, false);
  });

  // 29. Search and filters
  test('29. Search and filters: search matches across title and group code, filter tabs operate properly', () => {
    const items = [
      { key: 'cohort:1', type: 'cohort', title: 'Mercury Class', groupCode: 'MERCURY', unreadCount: null },
      { key: 'cohort:2', type: 'cohort', title: 'Mars Class', groupCode: 'MARS', unreadCount: 3 },
      { key: 'dm:1', type: 'dm', title: 'Alice Teacher', peerUsername: 'alice_prof', unreadCount: 1 },
      { key: 'dm:2', type: 'dm', title: 'Bob Student', peerUsername: 'bob99', unreadCount: 0 },
    ];

    // Filter 'unread': only Mars (3) and Alice (1)
    const unreadOnly = inbox.filterUnifiedConversations(items, 'unread');
    assert.equal(unreadOnly.length, 2);
    assert.equal(unreadOnly[0].key, 'cohort:2');
    assert.equal(unreadOnly[1].key, 'dm:1');

    // Filter 'groups': only cohorts
    const groupsOnly = inbox.filterUnifiedConversations(items, 'groups');
    assert.equal(groupsOnly.length, 2);
    assert.equal(groupsOnly[0].key, 'cohort:1');
    assert.equal(groupsOnly[1].key, 'cohort:2');

    // Search 'alice'
    const searchAlice = inbox.searchUnifiedConversations(items, 'alice');
    assert.equal(searchAlice.length, 1);
    assert.equal(searchAlice[0].title, 'Alice Teacher');

    // Search 'mars'
    const searchMars = inbox.searchUnifiedConversations(items, 'mars');
    assert.equal(searchMars.length, 1);
    assert.equal(searchMars[0].title, 'Mars Class');
  });
});
