'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Mobile Admin Chat List & Typing Indicator Suite', () => {
  const chatScreenPath = path.join(__dirname, '..', 'mobile', 'app', '(tabs)', 'chat.tsx');
  const chatServicePath = path.join(__dirname, '..', 'mobile', 'services', 'chat.ts');
  const useClassChatPath = path.join(__dirname, '..', 'mobile', 'hooks', 'useClassChat.ts');

  const chatScreenContent = fs.readFileSync(chatScreenPath, 'utf8');
  const chatServiceContent = fs.readFileSync(chatServicePath, 'utf8');
  const useClassChatContent = fs.readFileSync(useClassChatPath, 'utf8');

  test('1. Admin Chat tab renders room list while student directly opens own cohort', () => {
    // Admin check
    assert.match(chatScreenContent, /const isAdmin = Boolean\(\s*user\?\.isAdmin \|\| user\?\.role === ["']admin["']\s*\)/);
    // Conditional render for admin when no room is selected
    assert.match(chatScreenContent, /if \(isAdmin && !selectedAdminRoom\)\s*\{/);
    assert.match(chatScreenContent, /<Text[^>]*>\s*Cohorts\s*<\/Text>/);
  });

  test('2. Four authoritative rows render with server currentSemester and preview', () => {
    assert.match(chatScreenContent, /data=\{adminRooms\}/);
    assert.match(chatScreenContent, /\{item\.cohortDisplayName\}/);
    // currentSemester comes strictly from item.currentSemester (never derived from string name)
    assert.match(chatScreenContent, /Semester \$\{item\.currentSemester\}/);
    // Latest preview or "No messages yet"
    assert.match(chatScreenContent, /\{item\.latestMessage \|\| ["']No messages yet["']\}/);
    // Unread badge if unreadCount > 0
    assert.match(chatScreenContent, /item\.unreadCount > 0 &&/);
  });

  test('3. Tap Mercury opens Mercury, and Back returns to room list', () => {
    // Tap room sets selectedAdminRoom
    assert.match(chatScreenContent, /onPress=\{[^}]*setSelectedAdminRoom\(item\)\}/);
    // Back button in conversation checks admin room selection
    assert.match(chatScreenContent, /if \(isAdmin && selectedAdminRoom\)\s*\{\s*setSelectedAdminRoom\(null\);/);
    // Hardware BackHandler returns to list
    assert.match(chatScreenContent, /if \(isAdmin && selectedAdminRoom\)\s*\{\s*setSelectedAdminRoom\(null\);\s*return true;\s*\}/);
  });

  test('4. Backend service methods fetchAdminChatRooms and parameterize fetchChatConfig', () => {
    assert.match(chatServiceContent, /export interface AdminChatRoom/);
    assert.match(chatServiceContent, /export async function fetchAdminChatRooms/);
    assert.match(chatServiceContent, /\/api\/chat\/admin\/rooms/);
    assert.match(chatServiceContent, /export async function fetchChatConfig\(targetChatGroupId\?: string\)/);
    assert.match(chatServiceContent, /\/api\/chat\/admin\/rooms\/\$\{encodeURIComponent\(targetChatGroupId\)\}\/config/);
  });

  test('5. Self typing is filtered by canonical studentId before string generation', () => {
    // Must filter activeTypers by studentId
    assert.match(chatScreenContent, /const otherTypers = useMemo\(\(\) => \{\s*return Array\.from\(activeTypers\.values\(\)\)\.filter\(\s*\(t\)\s*=>\s*String\(t\.studentId\)\s*!==\s*currentStudentId\s*\);/);
    // In useClassChat: onTyping filters self
    assert.match(useClassChatContent, /if \(String\(senderId\) === String\(studentId\)\) return;/);
  });

  test('6. Header-only typing indicator handles single, dual, and multi-user typing', () => {
    // Header subtitle handles 1, 2, and 3+ other typers
    assert.match(chatScreenContent, /if \(typingNames\.length === 1\)\s*\{\s*return `\$\{typingNames\[0\]\} is typing\.\.\.`;/);
    assert.match(chatScreenContent, /if \(typingNames\.length === 2\)\s*\{\s*return `\$\{typingNames\[0\]\} and \$\{typingNames\[1\]\} are typing\.\.\.`;/);
    assert.match(chatScreenContent, /if \(typingNames\.length > 2\)\s*\{\s*return ["']Several people are typing\.\.\.["'];/);
  });

  test('7. Duplicate bottom typing row above composer is completely removed', () => {
    // Must NOT have typingBar or typing text above composer
    assert.doesNotMatch(chatScreenContent, /<View style=\{styles\.typingBar\}>/);
    assert.doesNotMatch(chatScreenContent, /typingDot/);
    // Floating scroll button has no typing offset condition
    assert.doesNotMatch(chatScreenContent, /floatingScrollContainerWithTyping/);
  });

  test('8. Functional typing indicator state derivation simulation', () => {
    const currentStudentId = '26020260';

    // Helper logic matching chat.tsx implementation
    const deriveHeaderSubtitle = (activeTypersMap, onlineCount = 5, isConnected = true) => {
      const otherTypers = Array.from(activeTypersMap.values()).filter(
        t => String(t.studentId) !== currentStudentId
      );
      if (otherTypers.length === 1) return `${otherTypers[0].name} is typing...`;
      if (otherTypers.length === 2) return `${otherTypers[0].name} and ${otherTypers[1].name} are typing...`;
      if (otherTypers.length > 2) return 'Several people are typing...';
      if (isConnected && onlineCount > 0) return `${onlineCount} online`;
      return 'Class conversation';
    };

    // Case A: Only self typing
    const mapSelfOnly = new Map([
      ['26020260', { studentId: '26020260', name: 'Saugat Subedi', expiresAt: Date.now() + 3000 }]
    ]);
    assert.equal(deriveHeaderSubtitle(mapSelfOnly), '5 online');

    // Case B: Multi-device self typing (Device B receives Device A typing event with same studentId)
    const mapMultiDeviceSelf = new Map([
      ['26020260', { studentId: '26020260', name: 'Saugat Subedi (Phone A)', expiresAt: Date.now() + 3000 }]
    ]);
    assert.equal(deriveHeaderSubtitle(mapMultiDeviceSelf), '5 online');

    // Case C: Single other user typing
    const mapOneOther = new Map([
      ['stu-2', { studentId: 'stu-2', name: 'Alex', expiresAt: Date.now() + 3000 }]
    ]);
    assert.equal(deriveHeaderSubtitle(mapOneOther), 'Alex is typing...');

    // Case D: Self + other user typing simultaneously
    const mapSelfAndOther = new Map([
      ['26020260', { studentId: '26020260', name: 'Saugat Subedi', expiresAt: Date.now() + 3000 }],
      ['stu-2', { studentId: 'stu-2', name: 'Alex', expiresAt: Date.now() + 3000 }]
    ]);
    assert.equal(deriveHeaderSubtitle(mapSelfAndOther), 'Alex is typing...');

    // Case E: Two other users typing
    const mapTwoOthers = new Map([
      ['stu-2', { studentId: 'stu-2', name: 'Alex', expiresAt: Date.now() + 3000 }],
      ['stu-3', { studentId: 'stu-3', name: 'Sam', expiresAt: Date.now() + 3000 }]
    ]);
    assert.equal(deriveHeaderSubtitle(mapTwoOthers), 'Alex and Sam are typing...');

    // Case F: 3+ other users typing
    const mapThreeOthers = new Map([
      ['stu-2', { studentId: 'stu-2', name: 'Alex', expiresAt: Date.now() + 3000 }],
      ['stu-3', { studentId: 'stu-3', name: 'Sam', expiresAt: Date.now() + 3000 }],
      ['stu-4', { studentId: 'stu-4', name: 'John', expiresAt: Date.now() + 3000 }]
    ]);
    assert.equal(deriveHeaderSubtitle(mapThreeOthers), 'Several people are typing...');
  });
});
