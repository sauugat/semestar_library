const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Class Group Chat (public/chat.html) Redesign & Bug Fixes', () => {
  const chatHtmlPath = path.join(__dirname, '..', 'public', 'chat.html');
  const chatHtml = fs.readFileSync(chatHtmlPath, 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'group-chat.css'), 'utf8');

  test('Bug 1: Message bubbles are self-contained with no detached elements', () => {
    // Check that .im-msg-actions is not using right: -110px
    assert.strictEqual(chatHtml.includes('right: -110px'), false, 'Should not have right: -110px detached actions');
    
    // Check that .im-bubble has proper backgrounds and border radius (no transparent incoming bubble)
    assert.match(chatHtml, /\.im-bubble\s*\{[^}]*border-radius:\s*14px/);
    assert.match(chatHtml, /\.im-bubble-text/);
    assert.match(chatHtml, /\.im-bubble-meta/);
    
    // Check that optimistic rendering and renderMessages both build self-contained bubbles with meta inside
    assert.strictEqual(chatHtml.includes('im-bubble-meta'), true);
  });

  test('Bug 2: Typing indicator is not persistently displayed and auto-clears', () => {
    // Check that .im-typing-indicator does NOT have display: flex !important
    assert.strictEqual(chatHtml.includes('.im-typing-indicator { display: flex !important; }'), false);
    assert.strictEqual(chatHtml.includes('.im-typing-indicator {\n      display: flex !important;'), false);
    
    // Check that .im-typing-indicator has display: none by default and .visible class
    assert.match(chatHtml, /\.im-typing-indicator\s*\{[^}]*display:\s*none/);
    assert.match(chatHtml, /\.im-typing-indicator\.visible\s*\{[^}]*display:\s*flex\s*!important/);
    
    // Check that typing timeout clears indicator
    assert.match(chatHtml, /activeTypers\.delete\(data\.studentId\)/);
    assert.match(chatHtml, /updateTypingUI/);
  });

  test('Bug 3: Pinned banner uses data.pinned.messageId and supports unpinning', () => {
    // Check that loadPinnedMessage extracts data.pinned and data.pinned.messageId
    assert.match(chatHtml, /const\s+p\s*=\s*data\s*&&\s*data\.pinned;/);
    assert.match(chatHtml, /p\s*&&\s*p\.messageId/);
    
    // Check that unpinChatMessage function exists and calls DELETE /api/chat/pinned
    assert.match(chatHtml, /async\s+function\s+unpinChatMessage/);
    assert.match(chatHtml, /fetch\('\/api\/chat\/pinned',\s*\{\s*method:\s*'DELETE'\s*\}\)/);

    // Check jumpToPinnedMessage uses messageId
    assert.match(chatHtml, /scrollToQuotedMessage\(pinnedMessage\.messageId\)/);
  });

  test('Bug 4: Search bar has keyboard navigation and safe DOM highlighting', () => {
    // Check for keyboard navigation function handleSearchKeydown
    assert.match(chatHtml, /function\s+handleSearchKeydown/);
    assert.match(chatHtml, /navSearch/);
    assert.match(chatHtml, /clearSearchHighlights/);
    
    // Check that search does not wipe spans with innerHTML = ''
    assert.strictEqual(chatHtml.includes('span.innerHTML = \'\';'), false);
    
    // Check for TreeWalker or textNode handling
    assert.match(chatHtml, /TreeWalker|createTreeWalker/);
  });

  test('Design Pass: UI chrome contains no emoji characters', () => {
    // Regex for emojis (excluding standard reaction emoji sets in JS)
    // Strip the QUICK_EMOJIS array and reaction picker spans from checking
    const strippedHtml = chatHtml
      .replace(/const QUICK_EMOJIS = \[[^\]]+\];/, '')
      .replace(/<span onclick="sendReaction\([^)]+\)">[^<]+<\/span>/g, '');

    const emojiPattern = /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u;
    const matches = strippedHtml.match(emojiPattern);
    assert.strictEqual(matches, null, `Found unexpected emoji in UI chrome: ${matches ? matches[0] : ''}`);
  });
});
