/**
 * Semester Library - Markdown Parser & Rich-Text Sanitizer
 * Supports rendering Markdown posts and converting clipboard rich text (ChatGPT / Notion / Word) to clean Markdown.
 */

(function (global) {
  'use strict';

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeUrl(url) {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
      return trimmed;
    }
    return '';
  }

  /**
   * Parse inline Markdown syntax within a line or paragraph
   */
  function parseInlineMarkdown(text) {
    if (!text) return '';

    // First replace inline code so its contents aren't altered by bold/italic rules
    const codePlaceholders = [];
    text = text.replace(/`([^`]+)`/g, (_, code) => {
      const idx = codePlaceholders.length;
      codePlaceholders.push(`<code class="md-inline-code">${escapeHtml(code)}</code>`);
      return `\x01CODE_${idx}\x02`;
    });

    // Safe Underline tag: <u>text</u>
    text = text.replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/gi, '<u>$1</u>');

    // Bold + Italic: ***text***
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');

    // Bold: **text** or __text__
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Strikethrough: ~~text~~
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Links: [text](https://...)
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi, (_, title, url) => {
      const safe = sanitizeUrl(url);
      if (!safe) return escapeHtml(title);
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" class="md-link">${escapeHtml(title)}</a>`;
    });

    // Auto-link standalone URLs (not preceded by href=" or >)
    text = text.replace(/(^|[^"'>])(https?:\/\/[^\s<)]+)/gi, (_, prefix, url) => {
      const safe = sanitizeUrl(url);
      if (!safe) return prefix + url;
      return `${prefix}<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" class="md-link">${escapeHtml(url)}</a>`;
    });

    // Restore inline code blocks
    text = text.replace(/\x01CODE_(\d+)\x02/g, (_, idx) => codePlaceholders[Number(idx)] || '');

    return text;
  }

  /**
   * Main Markdown to HTML renderer for post content
   */
  function renderPostMarkdown(rawText) {
    if (!rawText || !rawText.trim()) return '';

    // Normalize line endings
    const normalized = String(rawText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Extract fenced code blocks first to protect their raw code
    const codeBlocks = [];
    const textWithoutCode = normalized.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const index = codeBlocks.length;
      const cleanLang = (lang || '').trim().toLowerCase();
      codeBlocks.push({
        lang: cleanLang || 'code',
        code: code.replace(/\n+$/, '') // trim trailing newline
      });
      return `\n\x01BLOCK_CODE_${index}\x02\n`;
    });

    // Split into lines
    const lines = textWithoutCode.split('\n');
    const output = [];

    let inList = null; // 'ul' or 'ol'
    let inQuote = false;
    let quoteLines = [];

    function flushQuote() {
      if (inQuote) {
        const quoteHtml = quoteLines.map(l => parseInlineMarkdown(escapeHtml(l))).join('<br/>');
        output.push(`<blockquote class="md-blockquote">${quoteHtml}</blockquote>`);
        quoteLines = [];
        inQuote = false;
      }
    }

    function flushList() {
      if (inList) {
        output.push(`</${inList}>`);
        inList = null;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for code block placeholder
      const codeMatch = trimmed.match(/^\x01BLOCK_CODE_(\d+)\x02$/);
      if (codeMatch) {
        flushQuote();
        flushList();
        const block = codeBlocks[Number(codeMatch[1])];
        if (block) {
          const escapedCode = escapeHtml(block.code);
          const langDisplay = escapeHtml(block.lang || 'code');
          output.push(
            `<div class="md-code-block-wrapper">` +
              `<div class="md-code-header">` +
                `<span class="md-code-lang">${langDisplay}</span>` +
                `<button type="button" class="md-code-copy-btn" onclick="copyCodeSnippet(this)" aria-label="Copy code">Copy</button>` +
              `</div>` +
              `<pre class="md-code-block"><code>${escapedCode}</code></pre>` +
            `</div>`
          );
        }
        continue;
      }

      // Horizontal rule: --- or ***
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushQuote();
        flushList();
        output.push('<hr class="md-divider" />');
        continue;
      }

      // Headings
      const hMatch = line.match(/^(#{1,3})\s+(.*)$/);
      if (hMatch) {
        flushQuote();
        flushList();
        const level = hMatch[1].length;
        const headingText = parseInlineMarkdown(escapeHtml(hMatch[2]));
        output.push(`<h${level} class="md-h${level}">${headingText}</h${level}>`);
        continue;
      }

      // Blockquote: > text
      const qMatch = line.match(/^>\s?(.*)$/);
      if (qMatch) {
        flushList();
        inQuote = true;
        quoteLines.push(qMatch[1]);
        continue;
      } else {
        flushQuote();
      }

      // Unordered list item: - item or * item
      const ulMatch = line.match(/^[\*\-]\s+(.*)$/);
      if (ulMatch) {
        flushQuote();
        if (inList !== 'ul') {
          flushList();
          output.push('<ul class="md-ul">');
          inList = 'ul';
        }
        output.push(`<li class="md-li">${parseInlineMarkdown(escapeHtml(ulMatch[1]))}</li>`);
        continue;
      }

      // Ordered list item: 1. item
      const olMatch = line.match(/^\d+\.\s+(.*)$/);
      if (olMatch) {
        flushQuote();
        if (inList !== 'ol') {
          flushList();
          output.push('<ol class="md-ol">');
          inList = 'ol';
        }
        output.push(`<li class="md-li">${parseInlineMarkdown(escapeHtml(olMatch[1]))}</li>`);
        continue;
      }

      // Non-list line, so flush any open list
      flushList();

      // Empty line
      if (!trimmed) {
        continue;
      }

      // Regular paragraph line
      const parsedText = parseInlineMarkdown(escapeHtml(line));
      output.push(`<p class="md-p">${parsedText}</p>`);
    }

    flushQuote();
    flushList();

    return output.join('\n');
  }

  /**
   * Smart HTML to Markdown converter
   * Intelligently parses copied rich text (ChatGPT, Notion, Google Docs, Slack, Word) into standard Markdown.
   */
  function htmlToMarkdown(htmlString) {
    if (!htmlString || !htmlString.trim()) return '';

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlString, 'text/html');
      const body = doc.body;

      function traverse(node) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || '';
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();
        const childText = Array.from(node.childNodes).map(traverse).join('');

        switch (tag) {
          case 'strong':
          case 'b':
            return childText.trim() ? `**${childText.trim()}**` : '';

          case 'em':
          case 'i':
            return childText.trim() ? `*${childText.trim()}*` : '';

          case 'u':
            return childText.trim() ? `<u>${childText.trim()}</u>` : '';

          case 'del':
          case 's':
          case 'strike':
            return childText.trim() ? `~~${childText.trim()}~~` : '';

          case 'h1':
            return `\n\n# ${childText.trim()}\n\n`;

          case 'h2':
            return `\n\n## ${childText.trim()}\n\n`;

          case 'h3':
          case 'h4':
          case 'h5':
          case 'h6':
            return `\n\n### ${childText.trim()}\n\n`;

          case 'blockquote':
            return `\n\n> ${childText.trim().replace(/\n+/g, '\n> ')}\n\n`;

          case 'code':
            if (node.parentNode && node.parentNode.tagName.toLowerCase() === 'pre') {
              return childText;
            }
            return `\`${childText.trim()}\``;

          case 'pre': {
            const langMatch = node.querySelector('code')?.className?.match(/language-([a-z0-9_-]+)/i);
            const lang = langMatch ? langMatch[1] : '';
            const codeText = node.textContent || childText;
            return `\n\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n\n`;
          }

          case 'ul':
            return `\n\n${childText.trim()}\n\n`;

          case 'ol':
            return `\n\n${childText.trim()}\n\n`;

          case 'li': {
            const isOrdered = node.parentNode && node.parentNode.tagName.toLowerCase() === 'ol';
            const index = isOrdered ? (Array.from(node.parentNode.children).indexOf(node) + 1) + '.' : '-';
            return `${index} ${childText.trim()}\n`;
          }

          case 'a': {
            const href = node.getAttribute('href');
            if (href && !href.startsWith('javascript:')) {
              return `[${childText.trim() || href}](${href})`;
            }
            return childText;
          }

          case 'hr':
            return '\n\n---\n\n';

          case 'br':
            return '\n';

          case 'p':
          case 'div':
            return childText.trim() ? `\n\n${childText.trim()}\n\n` : '\n';

          default:
            return childText;
        }
      }

      const result = traverse(body);
      return result
        .replace(/\u200B/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } catch (e) {
      console.warn('htmlToMarkdown failed, falling back:', e);
      return '';
    }
  }

  /**
   * Code snippet copy button helper
   */
  function copyCodeSnippet(button) {
    if (!button) return;
    const block = button.closest('.md-code-block-wrapper');
    if (!block) return;
    const codeEl = block.querySelector('code');
    if (!codeEl) return;

    const text = codeEl.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      const origText = button.textContent;
      button.textContent = 'Copied!';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = origText;
        button.classList.remove('copied');
      }, 2000);
    }).catch(err => {
      console.warn('Failed to copy code snippet:', err);
    });
  }

  // Export functions to global scope
  global.renderPostMarkdown = renderPostMarkdown;
  global.htmlToMarkdown = htmlToMarkdown;
  global.copyCodeSnippet = copyCodeSnippet;
  global.parseInlineMarkdown = parseInlineMarkdown;

})(typeof window !== 'undefined' ? window : globalThis);
