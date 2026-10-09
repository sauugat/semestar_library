'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Step 5B.4A — Premium Monochrome Messaging UI Verification', () => {
  const repoRoot = path.join(__dirname, '..');
  const themePath = path.join(repoRoot, 'mobile', 'constants', 'theme.ts');
  const inboxPath = path.join(repoRoot, 'mobile', 'components', 'chat', 'UnifiedChatInbox.tsx');
  const dmScreenPath = path.join(repoRoot, 'mobile', 'app', 'dm', '[id].tsx');
  const chatScreenPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'chat.tsx');

  test('1. Strict Monochrome Color Tokens: theme.ts exports Monochrome palette with required specs', () => {
    assert.ok(fs.existsSync(themePath), 'theme.ts must exist');
    const content = fs.readFileSync(themePath, 'utf8');

    assert.ok(content.includes('export const Monochrome'), 'Must export Monochrome token group');

    // Required palette tokens
    assert.ok(content.includes("background: '#090909'"), 'Monochrome.background must be #090909');
    assert.ok(content.includes("surface: '#141414'"), 'Monochrome.surface must be #141414');
    assert.ok(content.includes("surfaceElevated: '#1C1C1C'"), 'Monochrome.surfaceElevated must be #1C1C1C');
    assert.ok(content.includes("border: '#282828'"), 'Monochrome.border must be #282828');
    assert.ok(content.includes("borderSubtle: '#1F1F1F'"), 'Monochrome.borderSubtle must be #1F1F1F');
    assert.ok(content.includes("textPrimary: '#F5F5F5'"), 'Monochrome.textPrimary must be #F5F5F5');
    assert.ok(content.includes("textSecondary: '#A1A1A1'"), 'Monochrome.textSecondary must be #A1A1A1');
    assert.ok(content.includes("textTertiary: '#737373'"), 'Monochrome.textTertiary must be #737373');

    // Message bubble tokens
    assert.ok(content.includes("bubbleOutgoing: '#EAEAEA'"), 'Monochrome.bubbleOutgoing must be #EAEAEA');
    assert.ok(content.includes("bubbleOutgoingText: '#111111'"), 'Monochrome.bubbleOutgoingText must be #111111');
    assert.ok(content.includes("bubbleOutgoingMeta: '#555555'"), 'Monochrome.bubbleOutgoingMeta must be #555555');
    assert.ok(content.includes("bubbleIncoming: '#242424'"), 'Monochrome.bubbleIncoming must be #242424');
    assert.ok(content.includes("bubbleIncomingText: '#F5F5F5'"), 'Monochrome.bubbleIncomingText must be #F5F5F5');
    assert.ok(content.includes("bubbleIncomingMeta: '#737373'"), 'Monochrome.bubbleIncomingMeta must be #737373');
  });

  test('2. Unified Chat Inbox: Header, search, and filters follow clean monochrome principles', () => {
    assert.ok(fs.existsSync(inboxPath), 'UnifiedChatInbox.tsx must exist');
    const content = fs.readFileSync(inboxPath, 'utf8');

    // Header title must be "Chats"
    assert.ok(content.includes('Chats'), 'Header title must be Chats');
    // New Message icon at upper right
    assert.ok(content.includes('create-outline'), 'Must have create-outline icon for new message');

    // No rainbow cohort colors in UnifiedChatInbox
    assert.ok(!content.includes('#3b82f6'), 'Must not have Mercury blue #3b82f6');
    assert.ok(!content.includes('#10b981'), 'Must not have Earth green #10b981');
    assert.ok(!content.includes('#f97316'), 'Must not have Mars orange #f97316');
    assert.ok(!content.includes('#8b5cf6'), 'Must not have Venus purple #8b5cf6');

    // No colorful CLASS badges
    assert.ok(!content.includes("'CLASS'"), 'Must not have colored CLASS pill badges');

    // Filter controls: All, Unread, Groups
    assert.ok(content.includes("'all'"), 'Must support all filter');
    assert.ok(content.includes("'unread'"), 'Must support unread filter');
    assert.ok(content.includes("'groups'"), 'Must support groups filter');
  });

  test('3. Cohort Icons: Use charcoal surface, subtle border, and neutral line icons', () => {
    const content = fs.readFileSync(inboxPath, 'utf8');

    assert.ok(content.includes('COHORT_ICONS'), 'Must use COHORT_ICONS map');
    assert.ok(content.includes('cohortAvatar:'), 'Must define cohortAvatar style');
    // No emojis replacing groups
    assert.ok(!content.includes('🪐') && !content.includes('🚀'), 'Must not replace groups with emojis');
  });

  test('4. DM Message Contrast — Critical Fix Verified', () => {
    assert.ok(fs.existsSync(dmScreenPath), 'app/dm/[id].tsx must exist');
    const content = fs.readFileSync(dmScreenPath, 'utf8');

    // Outgoing bubble and text contrast
    assert.ok(
      content.includes('Monochrome.outgoingBubble') || content.includes('#eaeaea') || content.includes('#EAEAEA'),
      'Outgoing bubble must use light gray (#EAEAEA)'
    );
    assert.ok(
      content.includes('Monochrome.outgoingText') || content.includes('#111111'),
      'Outgoing text must use dark charcoal/black (#111111) for crisp contrast'
    );

    // Make sure white-on-white defect is fixed
    assert.ok(
      !content.includes("color: isSelf ? '#ffffff' : colors.text"),
      'Must NOT render pure white text on outgoing bubble'
    );

    // Incoming bubble and text contrast
    assert.ok(
      content.includes('Monochrome.incomingBubble') || content.includes('#242424'),
      'Incoming bubble must use dark gray (#242424)'
    );
    assert.ok(
      content.includes('Monochrome.incomingText') || content.includes('#f5f5f5') || content.includes('#F5F5F5'),
      'Incoming text must use light text (#F5F5F5)'
    );

    // Read receipt seen ticks: must not use blue accent #60a5fa
    assert.ok(!content.includes('color="#60a5fa"'), 'Seen read receipts must not use blue #60a5fa');
  });

  test('5. Cohort Chat Screen: Header adheres to strict monochrome design', () => {
    assert.ok(fs.existsSync(chatScreenPath), 'app/(tabs)/chat.tsx must exist');
    const content = fs.readFileSync(chatScreenPath, 'utf8');

    // Custom header background and borders
    assert.ok(
      content.includes('backgroundColor: "#101010"') || content.includes('backgroundColor: "#141414"'),
      'Header must use monochrome header surface (#101010 or #141414)'
    );
    assert.ok(content.includes('borderBottomColor: "#282828"'), 'Header border must use #282828');
  });

  test('6. Floating Blue Gear Investigation: App does not define a floating debug gear', () => {
    const inboxContent = fs.readFileSync(inboxPath, 'utf8');
    const dmContent = fs.readFileSync(dmScreenPath, 'utf8');
    const chatContent = fs.readFileSync(chatScreenPath, 'utf8');

    // App code has no floating gear FAB
    assert.ok(!inboxContent.includes('floating-gear') && !inboxContent.includes('settings-sharp'), 'Inbox has no floating gear');
    assert.ok(!dmContent.includes('floating-gear'), 'DM screen has no floating gear');
    assert.ok(!chatContent.includes('floating-gear'), 'Chat screen has no floating gear');
  });
});
