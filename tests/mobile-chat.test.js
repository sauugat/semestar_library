const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Mobile Class Group Chat (mobile/app/(tabs)/chat.tsx & mobile/services/chat.ts)', () => {
  const chatScreenPath = path.join(__dirname, '..', 'mobile', 'app', '(tabs)', 'chat.tsx');
  const chatItemPath = path.join(__dirname, '..', 'mobile', 'components', 'chat', 'ChatMessageItem.tsx');
  const chatActionsPath = path.join(__dirname, '..', 'mobile', 'components', 'chat', 'ChatMessageActionsSheet.tsx');
  const chatRealtimePath = path.join(__dirname, '..', 'mobile', 'services', 'chat-realtime.ts');
  const chatScreenContent =
    fs.readFileSync(chatScreenPath, 'utf8') +
    fs.readFileSync(path.join(__dirname, '..', 'mobile', 'hooks', 'useClassChat.ts'), 'utf8') +
    (fs.existsSync(chatRealtimePath) ? fs.readFileSync(chatRealtimePath, 'utf8') : '') +
    (fs.existsSync(chatItemPath) ? fs.readFileSync(chatItemPath, 'utf8') : '') +
    (fs.existsSync(chatActionsPath) ? fs.readFileSync(chatActionsPath, 'utf8') : '');

  const chatServicePath = path.join(__dirname, '..', 'mobile', 'services', 'chat.ts');
  const chatServiceContent = fs.readFileSync(chatServicePath, 'utf8');

  test('1. Chat Service provides backend integration and typed endpoints', () => {
    assert.match(chatServiceContent, /export async function fetchChatConfig/);
    assert.match(chatServiceContent, /export async function fetchChatMessages/);
    assert.match(chatServiceContent, /export async function sendChatMessage/);
    assert.match(chatServiceContent, /export async function sendChatTyping/);
    assert.match(chatServiceContent, /export async function getAttachmentUrl/);
    assert.match(chatServiceContent, /\/api\/chat\/messages/);
    assert.match(chatServiceContent, /\/api\/chat\/config/);
  });

  test('2. Supabase Realtime is integrated for real-time delivery', () => {
    assert.match(chatScreenContent, /import \{[^}]*createClient[^}]*\} from ['"]@supabase\/supabase-js['"]/ );
    assert.match(chatScreenContent, /channel\(\s*['"]public:chat_messages['"]/ );
    assert.match(chatScreenContent, /event:\s*['"]new_message['"]/ );
    assert.match(chatScreenContent, /event:\s*['"]typing['"]/ );
    assert.match(chatScreenContent, /event:\s*['"]delete_message['"]/ );
  });

  test('3. Chat bubbles are self-contained with monochrome theme tokens', () => {
    // Aligns own messages to right, others to left
    assert.match(chatScreenContent, /bubbleOuterRight|bubbleRowRight/);
    assert.match(chatScreenContent, /bubbleOuterLeft|bubbleRowLeft/);

    // Dark monochrome styling
    assert.ok(
      /colors\.surfaceRaised|#2c2c2e/.test(chatScreenContent),
      'Must use surfaceRaised or flat fill #2c2c2e'
    );
    assert.ok(
      /colors\.surfaceSubtle|#1c1c1e/.test(chatScreenContent),
      'Must use surfaceSubtle or flat fill #1c1c1e'
    );

    // Timestamps and date separators
    assert.match(chatScreenContent, /formatMessageTime/);
    assert.match(chatScreenContent, /formatDateSeparator/);
  });

  test('4. Typing indicator only shows active typers and clears properly', () => {
    assert.match(chatScreenContent, /activeTypers/);
    assert.match(chatScreenContent, /typingNames/);
    // Prunes typers with timeout
    assert.match(chatScreenContent, /expiresAt/);
    // Clears typer when their message arrives
    assert.match(chatScreenContent, /next\.delete\(String\(newMsg\.studentId\)\)/);
  });

  test('5. Attachments support image viewer and file download/sharing', () => {
    assert.match(chatScreenContent, /ImagePicker\.launchImageLibraryAsync/);
    assert.match(chatScreenContent, /DocumentPicker\.getDocumentAsync/);
    assert.match(chatScreenContent, /FileSystem\.downloadAsync/);
    assert.match(chatScreenContent, /Sharing\.shareAsync/);
    assert.match(chatScreenContent, /viewerImage/);
  });

  test('6. Scroll behavior does not yank position when user is scrolled up', () => {
    assert.match(chatScreenContent, /isNearBottomRef/);
    assert.match(chatScreenContent, /floatingScrollBtn/);
    assert.match(chatScreenContent, /showScrollToBottom/);
  });

  test('7. KeyboardStickyView and safe area insets are respected', () => {
    assert.match(chatScreenContent, /KeyboardStickyView/);
    assert.match(chatScreenContent, /useSafeAreaInsets/);
  });

  test('8. Attachment action sheet correctly wires Photo Library, File, and Camera handlers without Dialog collision', () => {
    // Composer camera button maps directly to handleTakePhoto
    assert.match(chatScreenContent, /onPickCamera=\{handleTakePhoto\}/);

    // Attachment sheet options map to their respective async handlers
    assert.match(chatScreenContent, /onPress=\{\(\)\s*=>\s*void\s*handleTakePhoto\(\)\}/);
    assert.match(chatScreenContent, /onPress=\{\(\)\s*=>\s*void\s*handlePickImage\(\)\}/);
    assert.match(chatScreenContent, /onPress=\{\(\)\s*=>\s*void\s*handlePickDocument\(\)\}/);

    // Rendered as in-tree overlay to prevent Android native Dialog dismissal from killing activity pickers
    assert.match(chatScreenContent, /attachOverlayWrapper/);
    assert.doesNotMatch(chatScreenContent, /<Modal[^>]*visible=\{showAttachModal\}/);

    // Error handling alerts on failure instead of silent drop
    assert.match(chatScreenContent, /Unable to open photo library/);
    assert.match(chatScreenContent, /Unable to open file picker/);
  });

  test('9. Quick-reaction emoji row has uncropped glyphs, ample lineHeight and 44x44 touch targets', () => {
    // Contains all 6 emojis
    assert.match(chatScreenContent, /REACTION_EMOJIS\s*=\s*\[\s*['"]👍['"],\s*['"]❤️['"],\s*['"]😂['"],\s*['"]🎉['"],\s*['"]🙏['"],\s*['"]👀['"]\s*\]/);

    // 44x44 round button touch target
    assert.match(chatScreenContent, /width:\s*44/);
    assert.match(chatScreenContent, /height:\s*44/);
    assert.match(chatScreenContent, /borderRadius:\s*22/);

    // Emoji size and lineHeight: line height exceeds font size (no vertical cropping)
    assert.match(chatScreenContent, /fontSize:\s*26/);
    assert.match(chatScreenContent, /lineHeight:\s*34/);

    // No includeFontPadding: false inside reactionEmoji that clips descenders/accents
    assert.doesNotMatch(chatScreenContent, /reactionEmoji:\s*\{[^}]*includeFontPadding:\s*false/);

    // Evenly distributed with space-between
    assert.match(chatScreenContent, /justifyContent:\s*['"]space-between['"]/);
  });

  test('10. File cards display clear file icon, 2-line ellipsized filename, human-readable size, and download action', () => {
    // Card structure styles
    assert.match(chatScreenContent, /fileCard:/);
    assert.match(chatScreenContent, /fileIconBox:/);
    assert.match(chatScreenContent, /fileNameText:/);
    assert.match(chatScreenContent, /fileMetaSubtitle:/);
    assert.match(chatScreenContent, /fileActionIcon:/);

    // Filename: 2 lines max with middle ellipsis
    assert.match(chatScreenContent, /numberOfLines=\{2\}/);
    assert.match(chatScreenContent, /ellipsizeMode=['"]middle['"]/);

    // Subtitle formatted via formatFileSubtitle
    assert.match(chatScreenContent, /formatFileSubtitle\(/);

    // Download/action icon on right
    assert.match(chatScreenContent, /arrow-down-circle-outline/);

    // Both user sides follow monochrome design language
    assert.match(chatScreenContent, /fileCardMe:/);
    assert.match(chatScreenContent, /fileCardOther:/);
  });

  test('11. Double-tap toggles ❤️ reaction with Reanimated pop animation and coordinates with single tap', () => {
    // Reanimated hook integration
    assert.match(chatScreenContent, /useSharedValue/);
    assert.match(chatScreenContent, /useAnimatedStyle/);
    assert.match(chatScreenContent, /withSpring/);
    assert.match(chatScreenContent, /withSequence/);

    // Heart pop container centered on bubble
    assert.match(chatScreenContent, /heartPopContainer:/);
    assert.match(chatScreenContent, /heartPopEmoji:/);

    // Double tap triggers heart reaction on bubble, image, and file
    assert.match(chatScreenContent, /triggerHeartReaction/);
    assert.match(chatScreenContent, /handleBubblePress/);
    assert.match(chatScreenContent, /handleImagePress/);
    assert.match(chatScreenContent, /handleFilePress/);

    // Single-tap timer debounce allows double tap without opening image preview or triggering download
    assert.match(chatScreenContent, /singleTapTimerRef/);
    assert.match(chatScreenContent, /lastTapRef/);

    // Long press cancels single tap and opens actions sheet
    assert.match(chatScreenContent, /clearTimeout\(singleTapTimerRef\.current\)/);
  });
});

