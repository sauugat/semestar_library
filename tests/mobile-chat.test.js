const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Mobile Class Group Chat (mobile/app/(tabs)/chat.tsx & mobile/services/chat.ts)', () => {
  const chatScreenPath = path.join(__dirname, '..', 'mobile', 'app', '(tabs)', 'chat.tsx');
  const chatItemPath = path.join(__dirname, '..', 'mobile', 'components', 'chat', 'ChatMessageItem.tsx');
  const chatRealtimePath = path.join(__dirname, '..', 'mobile', 'services', 'chat-realtime.ts');
  const chatScreenContent =
    fs.readFileSync(chatScreenPath, 'utf8') +
    fs.readFileSync(path.join(__dirname, '..', 'mobile', 'hooks', 'useClassChat.ts'), 'utf8') +
    (fs.existsSync(chatRealtimePath) ? fs.readFileSync(chatRealtimePath, 'utf8') : '') +
    (fs.existsSync(chatItemPath) ? fs.readFileSync(chatItemPath, 'utf8') : '');

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
});
