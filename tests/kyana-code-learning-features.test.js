/**
 * Kyana AI — Code Learning Features & Cross-Platform Multi-Language Verification Suite
 *
 * Verifies code learning features across 8 target languages:
 * HTML, CSS, JavaScript, Python, C, C++, Java, and SQL.
 *
 * Key Areas:
 * 1. Syntax highlighting & tokenization (Web & Mobile)
 * 2. Exact clipboard contents (unaltered literal code)
 * 3. Word wrapping toggle (pre-wrap vs pre)
 * 4. Live HTML/CSS interactive preview
 * 5. CSS sibling pairing across paired blocks
 * 6. Preview sandbox security (iframe sandbox="allow-scripts" without allow-same-origin)
 * 7. Code Lab language mapping (compiler.html redirect vs in-page preview)
 * 8. Source code preservation & indentation fidelity
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chatbotJs = fs.readFileSync(path.join(__dirname, '../public/chatbot.js'), 'utf8');
const chatbotCss = fs.readFileSync(path.join(__dirname, '../public/chatbot.css'), 'utf8');
const postMarkdownTsx = fs.readFileSync(path.join(__dirname, '../mobile/components/PostMarkdown.tsx'), 'utf8');

const TARGET_LANGUAGES = ['html', 'css', 'javascript', 'python', 'c', 'cpp', 'java', 'sql'];

test('1. Syntax Highlighting: Web lexer highlights tokens across all 8 target languages', () => {
  // Check that highlightChatCode supports all 8 languages
  assert.ok(chatbotJs.includes('function highlightChatCode'), 'Must define highlightChatCode');
  
  for (const lang of TARGET_LANGUAGES) {
    const langPattern = new RegExp(`['"]${lang === 'cpp' ? 'cpp' : lang}['"]`, 'i');
    assert.ok(
      langPattern.test(chatbotJs),
      `Web highlighter must support language alias: ${lang}`
    );
  }

  // Verify token classes in chatbot.css matching Antigravity Mac theme
  assert.ok(chatbotCss.includes('.token.keyword'), 'Keyword token style');
  assert.ok(chatbotCss.includes('.token.string'), 'String token style');
  assert.ok(chatbotCss.includes('.token.tag'), 'HTML tag token style');
  assert.ok(chatbotCss.includes('.token.selector'), 'CSS selector token style');
  assert.ok(chatbotCss.includes('.token.keyword.control'), 'Control keyword token style');
  assert.ok(chatbotCss.includes('.token.class-name') || chatbotCss.includes('.token.type'), 'Type token style');
  assert.ok(chatbotCss.includes('.token.attr-name'), 'Attribute name token style');
  assert.ok(chatbotCss.includes('.token.attr-value'), 'Attribute value token style');
});

test('2. Syntax Highlighting: Mobile renderHighlightedCode supports all 8 target languages with Dark+ palette', () => {
  assert.ok(postMarkdownTsx.includes('function renderHighlightedCode'), 'Must define renderHighlightedCode');
  assert.ok(postMarkdownTsx.includes("l === 'html' || l === 'xml'"), 'Dedicated HTML lexer in Mobile');
  assert.ok(postMarkdownTsx.includes("l === 'css'"), 'Dedicated CSS lexer in Mobile');
  assert.ok(postMarkdownTsx.includes('CSS_ELEMENT_SELECTORS'), 'CSS element selector set in Mobile');
  assert.ok(postMarkdownTsx.includes('CONTROL_KEYWORDS'), 'Control keyword set in Mobile');

  // Verify Antigravity Mac / Dark+ palette values in Mobile
  assert.ok(postMarkdownTsx.includes("'#569cd6'"), 'Keyword/tag cyan color');
  assert.ok(postMarkdownTsx.includes("'#ce9178'"), 'String/attrVal terra cotta orange color');
  assert.ok(postMarkdownTsx.includes("'#9cdcfe'"), 'Variable/attrName light cyan color');
  assert.ok(postMarkdownTsx.includes("'#c586c0'"), 'Control keyword magenta/purple color');
  assert.ok(postMarkdownTsx.includes("'#dcdcaa'"), 'Function/selector yellowish color');
});

test('3. Exact Clipboard Contents: Literal source code copied without token markup', () => {
  // Web: copies codeBlock.dataset.rawCode || codeBlock.innerText
  assert.ok(chatbotJs.includes('const codeToCopy = codeBlock.dataset.rawCode || codeBlock.innerText'));
  assert.ok(chatbotJs.includes('navigator.clipboard.writeText(codeToCopy)'));
  assert.ok(chatbotJs.includes('is-copied'), 'Visual copied feedback on Web');

  // Mobile: copies block.code via expo-clipboard
  assert.ok(postMarkdownTsx.includes('handleCopyCode'));
  assert.ok(postMarkdownTsx.includes('Clipboard.setStringAsync(rawCode)'));
  assert.ok(postMarkdownTsx.includes("'✓ Copied'"), 'Visual copied feedback on Mobile');
});

test('4. Word Wrapping: Both Web and Mobile provide wrap toggle with pre-wrap default', () => {
  // Web: wrap toggle
  assert.ok(chatbotJs.includes('kyana-wrap-code-btn'));
  assert.ok(chatbotJs.includes("pre.style.whiteSpace = 'pre-wrap'"));
  assert.ok(chatbotJs.includes("pre.style.whiteSpace = 'pre'"));

  // Mobile: wrap toggle
  assert.ok(postMarkdownTsx.includes('toggleWrap'));
  assert.ok(postMarkdownTsx.includes("isUnwrapped ? 'No Wrap' : 'Wrap'"));
  assert.ok(postMarkdownTsx.includes("flexWrap: 'nowrap'"));
});

test('5. Live HTML/CSS Interactive Preview: Rendered on demand with sibling pairing', () => {
  // Web: Preview button for HTML/CSS/JS
  assert.ok(chatbotJs.includes('isPreviewable'));
  assert.ok(chatbotJs.includes('kyana-preview-code-btn'));
  assert.ok(chatbotJs.includes('kyana-inline-code-preview'));

  // Web sibling CSS pairing: HTML block scans message container for CSS
  assert.ok(chatbotJs.includes("querySelectorAll('.kyana-code-block[data-lang=\"css\"] pre code')"));
  assert.ok(chatbotJs.includes("querySelector('.kyana-code-block[data-lang=\"html\"] pre code')"));

  // Mobile sibling CSS pairing
  assert.ok(postMarkdownTsx.includes("codeBlocks.filter(b => b.lang.toLowerCase() === 'css').map(b => b.code).join('\\n')"));
  assert.ok(postMarkdownTsx.includes("codeBlocks.find(b => b.lang.toLowerCase() === 'html')"));
});

test('6. Preview Sandbox Security: Sandboxed iframe prevents parent origin compromise', () => {
  // Web: iframe must use sandbox="allow-scripts" without allow-same-origin
  assert.ok(chatbotJs.includes('sandbox="allow-scripts"'));
  assert.ok(!chatbotJs.includes('sandbox="allow-scripts allow-same-origin"'), 'Must never grant allow-same-origin to preview');
  assert.ok(!chatbotJs.includes('allow-top-navigation'), 'Must never allow top navigation from preview');

  // Mobile: OptionalWebView with restricted bounds
  assert.ok(postMarkdownTsx.includes('OptionalWebView'));
  assert.ok(postMarkdownTsx.includes("originWhitelist={['*']}"));
});

test('7. Code Lab Language Mapping: Distinguishes browser preview from Code Lab execution', () => {
  // C, C++, Java, Python, SQL redirect to Code Lab
  assert.ok(chatbotJs.includes('compilerSupported'));
  assert.ok(chatbotJs.includes('kyana-run-compiler-btn'));
  assert.ok(chatbotJs.includes('sessionStorage.setItem(\'pendingCompilerCode\''));
  assert.ok(chatbotJs.includes("window.location.href = 'compiler.html'"));

  // Interface never claims C/C++/Java/Python/SQL execute live in the chat bubble
  assert.ok(chatbotJs.includes('title="Open in Semester Library Code Lab"'));
  assert.ok(chatbotJs.includes('title="Interactive live preview"'));
});

test('8. Source Code Preservation: Raw code preserved without stripping or mangling', () => {
  // Web preserves exact raw code in dataset.rawCode
  assert.ok(chatbotJs.includes('codeBlock.dataset.rawCode = rawCode'));
  
  // Mobile preserves exact code in block.code
  assert.ok(postMarkdownTsx.includes('renderHighlightedCode(block.code, isDark, block.lang)'));
});
