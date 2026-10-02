const test = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeHtml,
  protectCodeBlocks,
  restoreCodeBlocks,
  fallbackMarkdown,
  normalizeLatexDelimiters,
  highlightChatCode,
  assertAndCleanPlaceholders
} = require('../public/chatbot.js');

function decodeHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

test('Kyana AI Code Rendering Pipeline Regression Suite', async (t) => {

  await t.test('1. C code: printf/scanf with address-of & operator renders cleanly with zero tokens or double-escaping', () => {
    const rawC = `#include <stdio.h>
int main() {
    int x;
    scanf("%d", &x);
    printf("%d\\n", x);
}`;

    const highlighted = highlightChatCode(rawC, 'c');

    // Must not contain any internal placeholder tokens
    assert.doesNotMatch(highlighted, /___CHAT_TOK_\d+___/);
    assert.doesNotMatch(highlighted, /___KYANA_PROTECTED_CODE_\d+___/);

    // Must contain appropriate syntax tokens
    assert.match(highlighted, /class="token keyword directive">#include<\/span>/);
    assert.match(highlighted, /class="token string">&lt;stdio\.h&gt;<\/span>/);
    assert.match(highlighted, /class="token (?:class-name|function)">scanf<\/span>/);
    assert.match(highlighted, /class="token operator">&amp;<\/span>x/);
    assert.match(highlighted, /class="token (?:class-name|function)">printf<\/span>/);

    // Literal fidelity: Decoded text must match raw code byte-for-byte
    const decoded = decodeHtml(highlighted);
    assert.equal(decoded, rawC);
  });

  await t.test('2. C code (Exact User Bug): printf, scanf with multiple & pointers, and sum variable remain pristine', () => {
    const rawUserCode = `printf("Enter two numbers: ");
scanf("%d %d", &num1, &num2);
sum = num1 + num2;
printf("Sum = %d\\n", sum);`;

    const highlighted = highlightChatCode(rawUserCode, 'c');

    // Must not produce ___CHAT_TOK_*___
    assert.doesNotMatch(highlighted, /___CHAT_TOK_\d+___/);
    assert.doesNotMatch(highlighted, /___KYANA_PROTECTED_CODE_\d+___/);

    // Identifiers like sum, num1, num2 must NOT have letter 'm' mangled as an operator
    assert.doesNotMatch(highlighted, /su<span class="token operator">m<\/span>/);
    assert.doesNotMatch(highlighted, /nu<span class="token operator">m<\/span>1/);
    assert.doesNotMatch(highlighted, /<span class="token operator">&<\/span><span class="token operator">a<\/span><span class="token operator">m<\/span><span class="token operator">p<\/span>/);

    // Decoded text must equal original code exactly
    assert.equal(decodeHtml(highlighted), rawUserCode);
  });

  await t.test('3. C++ code: stream operators << and >> display literally without HTML entity leakage', () => {
    const rawCpp = `cout << "Hello";
cin >> x;`;

    const highlighted = highlightChatCode(rawCpp, 'cpp');

    assert.doesNotMatch(highlighted, /___CHAT_TOK_\d+___/);
    assert.match(highlighted, /class="token operator">&lt;&lt;<\/span>/);
    assert.match(highlighted, /class="token operator">&gt;&gt;<\/span>/);

    assert.equal(decodeHtml(highlighted), rawCpp);
  });

  await t.test('4. HTML code: tags and ampersands are escaped safely in code blocks and do not execute', () => {
    const rawHtml = `<div class="test">Hello & goodbye</div>`;

    const highlighted = highlightChatCode(rawHtml, 'html');

    assert.doesNotMatch(highlighted, /___CHAT_TOK_\d+___/);
    // Must contain entity escaped tags so browser does not parse as DOM elements
    assert.match(highlighted, /&lt;<\/span><span class="token tag">div/);
    assert.match(highlighted, /&lt;\/<\/span><span class="token tag">div/);
    assert.match(highlighted, /&amp;/);
    assert.ok(!highlighted.includes('<div'));

    assert.equal(decodeHtml(highlighted), rawHtml);
  });

  await t.test('5. JavaScript code: logical operators <, &&, > render without double-escaping', () => {
    const rawJs = `if (a < b && b > c) {
  console.log("ok");
}`;

    const highlighted = highlightChatCode(rawJs, 'javascript');

    assert.doesNotMatch(highlighted, /___CHAT_TOK_\d+___/);
    assert.match(highlighted, /class="token operator">&lt;<\/span>/);
    assert.match(highlighted, /class="token operator">&amp;&amp;<\/span>/);
    assert.match(highlighted, /class="token operator">&gt;<\/span>/);

    assert.equal(decodeHtml(highlighted), rawJs);
  });

  await t.test('6. Python code: strings with embedded <, > and & are preserved literally', () => {
    const rawPy = `print("<hello> & goodbye")`;

    const highlighted = highlightChatCode(rawPy, 'python');

    assert.doesNotMatch(highlighted, /___CHAT_TOK_\d+___/);
    assert.match(highlighted, /class="token string">&quot;&lt;hello&gt; &amp; goodbye&quot;<\/span>/);

    assert.equal(decodeHtml(highlighted), rawPy);
  });

  await t.test('7. Inline code: `scanf("%d", &x)` remains exact and unaffected by prose transformations', () => {
    const markdown = 'Use `scanf("%d", &x)` to read input.';
    const normalized = normalizeLatexDelimiters(markdown);
    assert.equal(normalized, markdown);

    const rendered = fallbackMarkdown(normalized);
    assert.match(rendered, /<code>scanf\(&quot;%d&quot;, &amp;x\)<\/code>/);
    assert.doesNotMatch(rendered, /___CHAT_TOK_\d+___/);
    assert.doesNotMatch(rendered, /___KYANA_PROTECTED_CODE_\d+___/);

    const decoded = decodeHtml(rendered);
    assert.match(decoded, /scanf\("%d", &x\)/);
  });

  await t.test('8. Code block protection rule: LaTeX/math delimiter transformations never touch code blocks', () => {
    const code = '```c\n#include <stdio.h>\nint main() {\n  char str[] = "\\[x\\] and \\(y\\)";\n  return 0;\n}\n```';
    const proseWithMath = 'Calculate \\[E = mc^2\\] and \\(a^2 + b^2 = c^2\\).\n\n' + code;

    const normalized = normalizeLatexDelimiters(proseWithMath);

    // Prose math must be converted to KaTeX delimiters
    assert.match(normalized, /\$\$E = mc\^2\$\$/);
    assert.match(normalized, /\$a\^2 \+ b\^2 = c\^2\$/);

    // Code block inside must remain 100% untouched
    assert.ok(normalized.includes(code));
    assert.doesNotMatch(normalized, /___KYANA_PROTECTED_CODE_\d+___/);
  });

  await t.test('9. Safety assertion: detects and purges any synthetic placeholder tokens', () => {
    const corruptedString = 'Here is the result: ___CHAT_TOK_8___("Hello"); and ___KYANA_PROTECTED_CODE_1___';
    const cleaned = assertAndCleanPlaceholders(corruptedString);

    assert.doesNotMatch(cleaned, /___CHAT_TOK_\d+___/);
    assert.doesNotMatch(cleaned, /___KYANA_PROTECTED_CODE_\d+___/);
    assert.equal(cleaned, 'Here is the result: ("Hello"); and ');
  });

  await t.test('10. Safety assertion: detects and purges placeholder tokens from DOM elements', () => {
    const mockElement = {
      innerHTML: '<pre><code>___CHAT_TOK_9___("%d", &amp;x);</code></pre>'
    };

    assertAndCleanPlaceholders(mockElement);
    assert.doesNotMatch(mockElement.innerHTML, /___CHAT_TOK_\d+___/);
    assert.equal(mockElement.innerHTML, '<pre><code>("%d", &amp;x);</code></pre>');
  });

});
