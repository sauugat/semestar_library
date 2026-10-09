'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Step 5B.4B — Premium Conversation Experience Verification', () => {
  const repoRoot = path.join(__dirname, '..');
  const chatItemPath = path.join(repoRoot, 'mobile', 'components', 'chat', 'ChatMessageItem.tsx');
  const dmScreenPath = path.join(repoRoot, 'mobile', 'app', 'dm', '[id].tsx');
  const chatScreenPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'chat.tsx');
  const composerPath = path.join(repoRoot, 'mobile', 'components', 'chat', 'ChatComposer.tsx');
  const sendBtnPath = path.join(repoRoot, 'mobile', 'components', 'chat', 'ChatSendButton.tsx');
  const stickyComposerPath = path.join(repoRoot, 'mobile', 'components', 'ui', 'StickyComposer.tsx');

  test('1. Shared Bubble Contrast across DM and Group Chat', () => {
    const chatItem = fs.readFileSync(chatItemPath, 'utf8');
    const dmScreen = fs.readFileSync(dmScreenPath, 'utf8');

    // Group Chat outgoing bubble & text
    assert.ok(chatItem.includes("backgroundColor: '#626262'"), 'Group chat bubbleMe must be #626262');
    assert.ok(chatItem.includes("color: '#FFFFFF'"), 'Group chat bubbleTextMe must be #FFFFFF');
    assert.ok(chatItem.includes("color: '#D4D4D4'"), 'Group chat timestampTextMe must be #D4D4D4');

    // Group Chat incoming bubble & text
    assert.ok(chatItem.includes("backgroundColor: '#171717'"), 'Group chat bubbleOther must be #171717');
    assert.ok(chatItem.includes("color: '#FFFFFF'"), 'Group chat bubbleTextOther must be #FFFFFF');
    assert.ok(chatItem.includes("color: '#737373'"), 'Group chat timestampTextOther must be #737373');

    // DM outgoing bubble & text
    assert.ok(dmScreen.includes("Monochrome.outgoingBubble") || dmScreen.includes("#626262"), 'DM outgoing bubble must be #626262');
    assert.ok(dmScreen.includes("Monochrome.outgoingText") || dmScreen.includes("#FFFFFF"), 'DM outgoing text must be #FFFFFF');
    assert.ok(dmScreen.includes("Monochrome.outgoingMeta") || dmScreen.includes("#D4D4D4"), 'DM outgoing meta must be #D4D4D4');

    // DM incoming bubble & text
    assert.ok(dmScreen.includes("Monochrome.incomingBubble") || dmScreen.includes("#171717"), 'DM incoming bubble must be #171717');
    assert.ok(dmScreen.includes("Monochrome.incomingText") || dmScreen.includes("#FFFFFF"), 'DM incoming text must be #FFFFFF');
  });

  test('2. Intelligent Message Grouping & Adaptive Corner Radii', () => {
    const chatItem = fs.readFileSync(chatItemPath, 'utf8');
    const dmScreen = fs.readFileSync(dmScreenPath, 'utf8');

    // Group chat grouping
    assert.ok(chatItem.includes('isFirstInGroup'), 'Group chat must compute isFirstInGroup');
    assert.ok(chatItem.includes('isLastInGroup'), 'Group chat must compute isLastInGroup');
    assert.ok(chatItem.includes('borderTopRightRadius: isFirstInGroup ? 18 : 4'), 'Group chat must adapt top-right radius');
    assert.ok(chatItem.includes('borderTopLeftRadius: isFirstInGroup ? 18 : 4'), 'Group chat must adapt top-left radius');
    assert.ok(chatItem.includes('marginTop: isConsecutive ? 2 : 10'), 'Group chat must use compact 2dp margin between consecutive messages');

    // DM grouping
    assert.ok(dmScreen.includes('isFirstInGroup'), 'DM must compute isFirstInGroup');
    assert.ok(dmScreen.includes('isLastInGroup'), 'DM must compute isLastInGroup');
    assert.ok(dmScreen.includes('borderTopRightRadius: isFirstInGroup ? 18 : 4'), 'DM must adapt top-right radius');
    assert.ok(dmScreen.includes('borderTopLeftRadius: isFirstInGroup ? 18 : 4'), 'DM must adapt top-left radius');
    assert.ok(dmScreen.includes('marginTop: isFirstInGroup ? 10 : 2'), 'DM must use compact 2dp margin between grouped messages');

    // Sender name only for first in group
    assert.ok(chatItem.includes('!isMe && isFirstInGroup && ('), 'Sender name only shown for first message in group');
  });

  test('3. Timestamp and Read Receipt Semantics', () => {
    const chatItem = fs.readFileSync(chatItemPath, 'utf8');
    const dmScreen = fs.readFileSync(dmScreenPath, 'utf8');

    // Seen checkmarks must be monochrome (no #60a5fa blue)
    assert.ok(!chatItem.includes('#60a5fa'), 'Group chat must not have blue #60a5fa checkmark');
    assert.ok(!dmScreen.includes('#60a5fa'), 'DM must not have blue #60a5fa checkmark');

    // Date separator pill styling
    assert.ok(chatItem.includes('dateSeparatorPill:'), 'Group chat must have dateSeparatorPill style');
    assert.ok(dmScreen.includes('dateSeparatorPill:'), 'DM must have dateSeparatorPill style');
  });

  test('4. Reply Previews and Interactive Message Jump', () => {
    const chatItem = fs.readFileSync(chatItemPath, 'utf8');
    const dmScreen = fs.readFileSync(dmScreenPath, 'utf8');
    const chatScreen = fs.readFileSync(chatScreenPath, 'utf8');

    // Group chat jump to reply
    assert.ok(chatItem.includes('onJumpToReply'), 'Group chat must support onJumpToReply');
    assert.ok(chatScreen.includes('jumpToMessage'), 'Chat screen must implement jumpToMessage');

    // DM jump to reply
    assert.ok(dmScreen.includes('handleJumpToReply'), 'DM screen must implement handleJumpToReply');
    assert.ok(dmScreen.includes('highlightedMessageId'), 'DM screen must track highlightedMessageId');
  });

  test('5. Consistent Composer Experience & State Transitions', () => {
    const composer = fs.readFileSync(composerPath, 'utf8');
    const sendBtn = fs.readFileSync(sendBtnPath, 'utf8');
    const dmScreen = fs.readFileSync(dmScreenPath, 'utf8');

    // Group composer styling
    assert.ok(composer.includes('pillTextInput:'), 'Group composer must have pillTextInput style');
    assert.ok(composer.includes('actionIconCircle:'), 'Group composer must have + button');
    assert.ok(composer.includes('backgroundColor: "#242424"') || composer.includes('backgroundColor: "#1C1C1C"'), 'Group composer input must be dark pill surface');

    // Send button state change: white when active, dark when disabled
    assert.ok(sendBtn.includes('backgroundColor: disabled ? "#242424" : "#F5F5F5"'), 'Send button must switch between #242424 and #F5F5F5');
    assert.ok(sendBtn.includes('color={disabled ? "#737373" : "#111111"}'), 'Send button icon must switch between #737373 and #111111');

    // DM send button state change
    assert.ok(dmScreen.includes('inputText.trim() ? Monochrome.outgoingBubble : Monochrome.surfaceRaised'), 'DM send button must activate on input');
  });

  test('6. Keyboard-Safe Layout Architecture', () => {
    const stickyComposer = fs.readFileSync(stickyComposerPath, 'utf8');
    const dmScreen = fs.readFileSync(dmScreenPath, 'utf8');
    const chatScreen = fs.readFileSync(chatScreenPath, 'utf8');

    // Uses KeyboardStickyView from react-native-keyboard-controller
    assert.ok(stickyComposer.includes('KeyboardStickyView'), 'StickyComposer must use KeyboardStickyView');
    assert.ok(stickyComposer.includes('useReanimatedKeyboardAnimation'), 'StickyComposer must use useReanimatedKeyboardAnimation');

    // Both screens wrap content in KeyboardContentBoundary / StickyComposer
    assert.ok(dmScreen.includes('StickyComposer'), 'DM screen must use StickyComposer');
    assert.ok(dmScreen.includes('KeyboardContentBoundary'), 'DM screen must use KeyboardContentBoundary');
    assert.ok(chatScreen.includes('StickyComposer') || chatScreen.includes('KeyboardStickyView'), 'Chat screen must manage keyboard viewport');
  });

  test('7. Navigation Preservation and Restrained Touch Feedback', () => {
    const dmScreen = fs.readFileSync(dmScreenPath, 'utf8');
    const chatScreen = fs.readFileSync(chatScreenPath, 'utf8');

    // Back navigation to unified inbox preserved
    assert.ok(dmScreen.includes('handleBack'), 'DM must preserve handleBack');
    assert.ok(chatScreen.includes('handleBackToInbox'), 'Group chat must preserve handleBackToInbox');

    // Header styling
    assert.ok(dmScreen.includes('Monochrome.header'), 'DM header must use Monochrome.header');
    assert.ok(chatScreen.includes('backgroundColor: "#101010"'), 'Group chat header must use #101010');
  });
});
