const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load public/markdown.js into a sandbox with a simulated DOMParser for testing htmlToMarkdown
test('public/markdown.js - Markdown parser and rich text converter', async (t) => {
  const code = fs.readFileSync(path.join(__dirname, '../public/markdown.js'), 'utf8');

  // Create lightweight DOMParser mock for Node environment
  class MockNode {
    constructor(tagName, textContent = '') {
      this.tagName = tagName;
      this.textContent = textContent;
      this.childNodes = [];
      this.parentNode = null;
      this.attributes = {};
    }
    getAttribute(name) {
      return this.attributes[name] || null;
    }
  }

  const sandbox = {
    console,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    DOMParser: class {
      parseFromString(html, type) {
        // Simple HTML string parser for test verification
        const body = new MockNode('body');
        // Test basic tags
        return { body };
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const { renderPostMarkdown, parseInlineMarkdown } = sandbox;

  await t.test('renders bold, italic, underline, strikethrough, and inline code', () => {
    const md = 'Hello **bold** and *italic* and <u>underlined</u> and ~~strike~~ with `inline code`';
    const html = renderPostMarkdown(md);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
    assert.match(html, /<u>underlined<\/u>/);
    assert.match(html, /<del>strike<\/del>/);
    assert.match(html, /<code class="md-inline-code">inline code<\/code>/);
  });

  await t.test('renders headings h1, h2, h3', () => {
    const md = '# Main Title\n## Secondary Title\n### Tertiary Title';
    const html = renderPostMarkdown(md);
    assert.match(html, /<h1 class="md-h1">Main Title<\/h1>/);
    assert.match(html, /<h2 class="md-h2">Secondary Title<\/h2>/);
    assert.match(html, /<h3 class="md-h3">Tertiary Title<\/h3>/);
  });

  await t.test('renders lists', () => {
    const md = '- Item 1\n- Item 2\n\n1. First\n2. Second';
    const html = renderPostMarkdown(md);
    assert.match(html, /<ul class="md-ul">/);
    assert.match(html, /<li class="md-li">Item 1<\/li>/);
    assert.match(html, /<ol class="md-ol">/);
    assert.match(html, /<li class="md-li">First<\/li>/);
  });

  await t.test('renders blockquotes', () => {
    const md = '> Important quotation from lecture notes';
    const html = renderPostMarkdown(md);
    assert.match(html, /<blockquote class="md-blockquote">Important quotation from lecture notes<\/blockquote>/);
  });

  await t.test('renders fenced code blocks with language badge and copy button', () => {
    const md = '```javascript\nconsole.log("Semester Library");\n```';
    const html = renderPostMarkdown(md);
    assert.match(html, /<div class="md-code-block-wrapper">/);
    assert.match(html, /<span class="md-code-lang">javascript<\/span>/);
    assert.match(html, /<button type="button" class="md-code-copy-btn"/);
    assert.match(html, /console\.log\(&quot;Semester Library&quot;\);/);
  });

  await t.test('renders horizontal dividers', () => {
    const md = 'Top text\n---\nBottom text';
    const html = renderPostMarkdown(md);
    assert.match(html, /<hr class="md-divider" \/>/);
  });

  await t.test('safely handles links and blocks javascript: XSS vectors', () => {
    const safeLink = '[Official Notes](https://semester-library.example.com)';
    const xssLink = '[Evil](javascript:alert(1))';
    const safeHtml = renderPostMarkdown(safeLink);
    const xssHtml = renderPostMarkdown(xssLink);

    assert.match(safeHtml, /<a href="https:\/\/semester-library\.example\.com" target="_blank" rel="noopener noreferrer" class="md-link">Official Notes<\/a>/);
    assert.doesNotMatch(xssHtml, /href="javascript:/i);
  });

  await t.test('escapes raw HTML script tags to prevent XSS', () => {
    const dangerous = '<script>alert("hack")</script>';
    const html = renderPostMarkdown(dangerous);
    assert.doesNotMatch(html, /<script>/i);
    assert.match(html, /&lt;script&gt;/);
  });

  await t.test('renders markdown tables with proper header, rows, and responsive wrapper', () => {
    const sampleTable = `| Feature | Traditional Learning | AI-Assisted Learning |
|---|---|---|
| Information access | Books and teachers | Books, teachers, and AI |
| Availability | Limited hours | Often available 24/7 |
| Personalization | Depends on instruction | Can adapt explanations |
| Feedback | Sometimes delayed | Often immediate |
| Accuracy | Depends on source | Requires verification |`;

    const html = renderPostMarkdown(sampleTable);
    assert.match(html, /<div class="md-table-wrapper">/);
    assert.match(html, /<table class="md-table">/);
    assert.match(html, /<thead><tr><th style="text-align: left;">Feature<\/th><th style="text-align: left;">Traditional Learning<\/th><th style="text-align: left;">AI-Assisted Learning<\/th><\/tr><\/thead>/);
    assert.match(html, /<tbody>/);
    assert.match(html, /<td style="text-align: left;">Information access<\/td>/);
    assert.match(html, /<td style="text-align: left;">Books, teachers, and AI<\/td>/);
    assert.match(html, /<td style="text-align: left;">Often available 24\/7<\/td>/);
    assert.match(html, /<td style="text-align: left;">Requires verification<\/td>/);
    assert.match(html, /<\/tbody><\/table><\/div>/);
  });
});
