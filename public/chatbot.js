/**
 * Semester Library — Kyana AI Workspace Engine
 * Visual Philosophy: LOGO = Identity · LIGHT & MOTION = Intelligence (Kyana Aura)
 * Clean Architecture: Gemini/ChatGPT/Claude Maturity with Original Identity
 */

(function () {
  'use strict';

  // --- 1. Pure Helper Utilities (Shared with Tests & Node) ---

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function safeLink(value, externalOnly = false) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value, 'https://semester-library.local/');
      if (!['https:', 'http:'].includes(url.protocol)) return null;
      if (externalOnly && !/^https?:\/\//i.test(value)) return null;
      return value;
    } catch (_) {
      return null;
    }
  }

  function protectCodeBlocks(markdown) {
    if (!markdown) return { text: '', tokenMap: new Map() };
    const tokenMap = new Map();
    let counter = 0;

    // Fenced code blocks (``` or ~~~) - both closed fences and unclosed streaming fences
    const fencedRegex = /(^|\n)(`{3,}|~{3,})([\w+-]*)\r?\n([\s\S]*?)(?:\r?\n\2[ \t]*(?=\r?\n|$)|$)/g;
    let text = String(markdown).replace(fencedRegex, (match, prefix) => {
      const id = `___KYANA_PROTECTED_CODE_${counter++}___`;
      tokenMap.set(id, match);
      return (prefix || '') + id;
    });

    // Inline code (`...`)
    const inlineRegex = /(`+)([\s\S]*?[^`])\1(?!`)/g;
    text = text.replace(inlineRegex, (match) => {
      const id = `___KYANA_PROTECTED_CODE_${counter++}___`;
      tokenMap.set(id, match);
      return id;
    });

    return { text, tokenMap };
  }

  function restoreCodeBlocks(text, tokenMap) {
    if (!text || !tokenMap || tokenMap.size === 0) return text;
    let restored = text;
    for (const [token, original] of tokenMap.entries()) {
      restored = restored.split(token).join(original);
    }
    if (/___KYANA_PROTECTED_CODE_\d+___/.test(restored)) {
      for (const [token, original] of tokenMap.entries()) {
        restored = restored.split(token).join(original);
      }
    }
    return restored;
  }

  function normalizeLatexDelimiters(text) {
    if (!text) return '';
    const { text: protectedText, tokenMap } = protectCodeBlocks(text);
    const transformed = protectedText
      .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
      .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
    return restoreCodeBlocks(transformed, tokenMap);
  }

  function stabilizeStreamingMarkdown(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let text = String(rawText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 1. Hide incomplete trailing action/reference XML blocks during streaming
    text = text
      .replace(/<kyana_actions>[\s\S]*$/i, '')
      .replace(/<referenced_records>[\s\S]*$/i, '');

    // 2. Check for unclosed fenced block at the end of the stream
    const fenceMatches = [...text.matchAll(/(^|\n)(`{3,}|~{3,})([\w+-]*)[ \t]*(?:\n|$)/g)];
    if (fenceMatches.length % 2 === 1) {
      const lastFence = fenceMatches[fenceMatches.length - 1];
      const fenceLang = (lastFence[3] || '').trim().toLowerCase();
      const structuredKinds = new Set([
        'study_session', 'learning_session', 'interactive_demo', 'logic_sim',
        'live_demo', 'diagram', 'flowchart', 'trace', 'roadmap', 'timeline',
        'pyq_card', 'checkpoint_question', 'chapter_summary', 'source_reference'
      ]);
      if (structuredKinds.has(fenceLang)) {
        // Hide partially streamed structured JSON fence until it closes completely
        text = text.slice(0, lastFence.index).trimEnd();
      } else {
        const fenceChars = lastFence[2] || '```';
        text = `${text}\n${fenceChars}`;
      }
    }

    // 3. Protect closed code blocks before checking unclosed math/tables/inline tokens
    const { text: withoutCode, tokenMap } = protectCodeBlocks(text);
    let working = withoutCode;

    // 4. Close unclosed display math block ($$ ... )
    const displayMathParts = working.split('$$');
    if (displayMathParts.length % 2 === 0) {
      working = `${working}\n$$`;
    }

    // 5. Stabilize trailing partial Markdown table delimiter row (e.g. "| Subject | Marks |\n| :-")
    const lines = working.split('\n');
    if (lines.length >= 2) {
      const lastLine = lines[lines.length - 1].trim();
      const prevLine = lines[lines.length - 2].trim();
      if (
        prevLine.includes('|') &&
        /^\|?[\s:-]+(?:\|[\s:-]*)*$/.test(lastLine) &&
        lastLine.includes('-')
      ) {
        const headerCols = prevLine.replace(/^\||\|$/g, '').split('|').length;
        if (headerCols >= 1) {
          lines[lines.length - 1] = '| ' + Array(headerCols).fill('---').join(' | ') + ' |';
          working = lines.join('\n');
        }
      }
    }

    // 6. Close unclosed inline code or bold markers on the final active line
    const updatedLines = working.split('\n');
    if (updatedLines.length > 0) {
      let tail = updatedLines[updatedLines.length - 1];
      const backticks = (tail.match(/`/g) || []).length;
      if (backticks % 2 === 1) {
        tail += '`';
      }
      const boldMarkers = (tail.match(/\*\*/g) || []).length;
      if (boldMarkers % 2 === 1) {
        tail += '**';
      }
      updatedLines[updatedLines.length - 1] = tail;
      working = updatedLines.join('\n');
    }

    return restoreCodeBlocks(working, tokenMap);
  }

  function fallbackMarkdown(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    const normalized = normalizeLatexDelimiters(String(rawText).replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

    // 1. Extract fenced code blocks
    const codeBlocks = [];
    let working = normalized.replace(/(^|\n)(`{3,}|~{3,})([\w+-]*)[ \t]*\n([\s\S]*?)(?:\n\2[ \t]*(?=\n|$)|$)/g, (_, prefix, _fence, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({
        lang: (lang || '').trim(),
        code: String(code || '').replace(/\n$/, '')
      });
      return `${prefix}\x01FB_CODE_${idx}\x02`;
    });

    // 2. Extract display math blocks ($$...$$) so underscores/asterisks inside LaTeX are never corrupted
    const mathBlocks = [];
    working = working.replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => {
      const idx = mathBlocks.length;
      mathBlocks.push( `<div class="kyana-math-block">$$${escapeHtml(String(expr).trim())}$$</div>` );
      return `\n\x01FB_MATH_BLOCK_${idx}\x02\n`;
    });

    // 3. Inline parser with inline code & inline math protection
    function parseInline(str) {
      if (!str) return '';
      const inlineTokens = [];
      let s = String(str);

      // Protect inline code `...`
      s = s.replace(/`([^`\n]+)`/g, (_, code) => {
        const id = inlineTokens.length;
        inlineTokens.push(`<code>${escapeHtml(code)}</code>`);
        return `\x01FB_INL_${id}\x02`;
      });

      // Protect inline math $...$
      s = s.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
        const id = inlineTokens.length;
        inlineTokens.push(`<span class="kyana-math-inline">$${escapeHtml(math)}$</span>`);
        return `\x01FB_INL_${id}\x02`;
      });

      s = escapeHtml(s);

      // Links: [title](url) - supports https://, http://, and internal /... or *.html routes
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, rawUrl) => {
        const decodedUrl = rawUrl.replace(/&amp;/g, '&');
        if (/^(?:https?:\/\/|\/|[a-zA-Z0-9_-]+\.html)/i.test(decodedUrl)) {
          return `<a href="${escapeHtml(decodedUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        }
        return label;
      });

      // Bold + Italic, Bold, Italic, Strikethrough
      s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
      s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

      // Restore protected inline tokens
      s = s.replace(/\x01FB_INL_(\d+)\x02/g, (_, idx) => inlineTokens[Number(idx)] || '');
      return s;
    }

    function isTableDelimiter(lineStr) {
      if (!lineStr || !lineStr.includes('|')) return false;
      const cells = lineStr.trim().replace(/^\||\|$/g, '').split('|');
      return cells.length > 0 && cells.every(c => /^\s*:?-{1,}:?\s*$/.test(c));
    }

    function splitTableRow(rowStr) {
      return rowStr.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    }

    const lines = working.split('\n');
    const output = [];
    let paraLines = [];
    let quoteLines = [];
    const listStack = []; // [{ tag: 'ul'|'ol', indent: number }]

    function flushPara() {
      if (paraLines.length > 0) {
        output.push(`<p>${paraLines.map(parseInline).join('<br>')}</p>`);
        paraLines = [];
      }
    }

    function flushQuote() {
      if (quoteLines.length > 0) {
        output.push(`<blockquote>${quoteLines.map(parseInline).join('<br>')}</blockquote>`);
        quoteLines = [];
      }
    }

    function closeListsToIndent(targetIndent) {
      while (listStack.length > 0 && listStack[listStack.length - 1].indent > targetIndent) {
        const popped = listStack.pop();
        output.push(`</${popped.tag}>`);
      }
    }

    function flushAllLists() {
      while (listStack.length > 0) {
        const popped = listStack.pop();
        output.push(`</${popped.tag}>`);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Code block token
      const codeMatch = trimmed.match(/^\x01FB_CODE_(\d+)\x02$/);
      if (codeMatch) {
        flushPara();
        flushQuote();
        flushAllLists();
        const block = codeBlocks[Number(codeMatch[1])];
        if (block) {
          output.push(`<pre><code${block.lang ? ` class="language-${escapeHtml(block.lang)}"` : ''}>${escapeHtml(block.code)}</code></pre>`);
        }
        continue;
      }

      // Math block token
      const mathMatch = trimmed.match(/^\x01FB_MATH_BLOCK_(\d+)\x02$/);
      if (mathMatch) {
        flushPara();
        flushQuote();
        flushAllLists();
        output.push(mathBlocks[Number(mathMatch[1])] || '');
        continue;
      }

      // Horizontal rule
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushPara();
        flushQuote();
        flushAllLists();
        output.push('<hr>');
        continue;
      }

      // Markdown Table
      if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
        flushPara();
        flushQuote();
        flushAllLists();
        const headers = splitTableRow(line);
        const aligns = splitTableRow(lines[i + 1]).map(c => {
          const t = c.trim();
          if (t.startsWith(':') && t.endsWith(':')) return 'center';
          if (t.endsWith(':')) return 'right';
          return 'left';
        });
        let j = i + 2;
        const rows = [];
        while (j < lines.length) {
          const rLine = lines[j].trim();
          if (!rLine || !rLine.includes('|') || isTableDelimiter(rLine)) break;
          rows.push(splitTableRow(rLine));
          j++;
        }
        i = j - 1;
        let tbl = '<div class="kyana-table-wrapper"><table class="kyana-table"><thead><tr>';
        headers.forEach((h, cIdx) => {
          tbl += `<th style="text-align: ${aligns[cIdx] || 'left'};">${parseInline(h)}</th>`;
        });
        tbl += '</tr></thead><tbody>';
        rows.forEach(r => {
          tbl += '<tr>';
          headers.forEach((_, cIdx) => {
            tbl += `<td style="text-align: ${aligns[cIdx] || 'left'};">${parseInline(r[cIdx] || '')}</td>`;
          });
          tbl += '</tr>';
        });
        tbl += '</tbody></table></div>';
        output.push(tbl);
        continue;
      }

      // Headings
      const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        flushPara();
        flushQuote();
        flushAllLists();
        const lvl = hMatch[1].length;
        output.push(`<h${lvl}>${parseInline(hMatch[2])}</h${lvl}>`);
        continue;
      }

      // Blockquote
      const qMatch = trimmed.match(/^>\s?(.*)$/);
      if (qMatch) {
        flushPara();
        flushAllLists();
        quoteLines.push(qMatch[1]);
        continue;
      } else if (quoteLines.length > 0) {
        flushQuote();
      }

      // Nested / Standard Lists
      const listMatch = line.match(/^(\s*)(?:([*\-•])|(\d+)\.)\s+(.+)$/);
      if (listMatch) {
        flushPara();
        flushQuote();
        const indent = (listMatch[1] || '').replace(/\t/g, '  ').length;
        const tag = listMatch[3] ? 'ol' : 'ul';
        const content = listMatch[4];

        if (listStack.length === 0) {
          listStack.push({ tag, indent });
          output.push(`<${tag}>`);
        } else {
          const top = listStack[listStack.length - 1];
          if (indent > top.indent) {
            listStack.push({ tag, indent });
            output.push(`<${tag}>`);
          } else {
            closeListsToIndent(indent);
            const currentTop = listStack[listStack.length - 1];
            if (!currentTop || currentTop.tag !== tag) {
              if (currentTop && currentTop.indent === indent) {
                output.push(`</${listStack.pop().tag}>`);
              }
              listStack.push({ tag, indent });
              output.push(`<${tag}>`);
            }
          }
        }
        output.push(`<li>${parseInline(content)}</li>`);
        continue;
      }

      if (!trimmed) {
        flushPara();
        flushQuote();
        flushAllLists();
        continue;
      }

      flushAllLists();
      paraLines.push(trimmed);
    }

    flushPara();
    flushQuote();
    flushAllLists();

    return output.join('\n');
  }

  // Safety Assertion Guardian: Ensures placeholder tokens NEVER reach user-visible UI
  function assertAndCleanPlaceholders(target) {
    if (!target) return target;
    const tokenPattern = /___(?:CHAT_TOK|KYANA_PROTECTED_CODE)_\d+___/g;

    if (typeof target === 'string') {
      if (tokenPattern.test(target)) {
        console.warn('[Kyana Renderer Safety] Detected unprocessed placeholder token in output string. Cleaning...');
        return target.replace(tokenPattern, '');
      }
      return target;
    }

    if (target && target.innerHTML && tokenPattern.test(target.innerHTML)) {
      console.warn('[Kyana Renderer Safety] Detected unprocessed placeholder token in rendered DOM. Cleaning...');
      target.innerHTML = target.innerHTML.replace(tokenPattern, '');
    }
    return target;
  }

  // High-Fidelity Syntax Highlighting Engine (Single-pass lexer, zero temporary placeholders, zero double-escaping)
  function highlightChatCode(rawCode, lang) {
    if (!rawCode) return '';
    const l = (lang || '').toLowerCase();

    // 1. If Prism is loaded and supports the language, use it safely
    const prismLangMap = {
      'c': 'c', 'cpp': 'cpp', 'c++': 'cpp',
      'java': 'java', 'python': 'python', 'py': 'python',
      'javascript': 'javascript', 'js': 'javascript',
      'html': 'markup', 'markup': 'markup', 'xml': 'markup',
      'css': 'css', 'json': 'json', 'sql': 'sql', 'bash': 'bash', 'sh': 'bash'
    };
    const pLang = prismLangMap[l] || l;
    if (typeof Prism !== 'undefined' && Prism.languages && Prism.languages[pLang]) {
      try {
        const highlighted = Prism.highlight(rawCode, Prism.languages[pLang], pLang);
        if (highlighted && typeof highlighted === 'string') {
          return assertAndCleanPlaceholders(highlighted);
        }
      } catch (_) {}
    }

    // 2. High-fidelity sequential lexer
    const isHtml = l === 'html' || l === 'xml' || l === 'markup';
    const isCss = l === 'css';
    const isPy = l === 'python' || l === 'py';
    const isCpp = l === 'cpp' || l === 'c++';
    const isC = l === 'c' || isCpp;

    const keywords = new Set([
      'public', 'private', 'protected', 'class', 'interface', 'static', 'void', 'int',
      'float', 'double', 'char', 'boolean', 'bool', 'long', 'short', 'unsigned', 'signed',
      'String', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
      'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package',
      'def', 'elif', 'from', 'as', 'with', 'lambda', 'yield', 'struct', 'typedef', 'const',
      'virtual', 'override', 'namespace', 'using', 'auto', 'sizeof', 'final', 'abstract',
      'let', 'var', 'function', 'async', 'await', 'select', 'where', 'insert',
      'delete', 'update', 'into', 'values', 'set', 'null', 'undefined', 'true', 'false',
      'True', 'False', 'None', 'self', 'this', 'super', 'template', 'typename', 'pass', 'raise'
    ]);

    const builtins = new Set([
      'System', 'out', 'println', 'print', 'Scanner', 'cin', 'cout', 'endl', 'cerr',
      'vector', 'string', 'map', 'set', 'list', 'pair', 'printf', 'scanf', 'NULL', 'nullptr',
      'console', 'log', 'warn', 'error', 'document', 'window', 'Math', 'JSON', 'Promise',
      'main', 'len', 'range', 'input'
    ]);

    let html = '';
    let i = 0;
    const len = rawCode.length;

    while (i < len) {
      // Line comments
      if (rawCode.startsWith('//', i)) {
        let end = rawCode.indexOf('\n', i);
        if (end === -1) end = len;
        html += `<span class="token comment">${escapeHtml(rawCode.slice(i, end))}</span>`;
        i = end;
        continue;
      }

      // Block comments
      if (rawCode.startsWith('/*', i)) {
        let end = rawCode.indexOf('*/', i);
        if (end === -1) end = len;
        else end += 2;
        html += `<span class="token comment">${escapeHtml(rawCode.slice(i, end))}</span>`;
        i = end;
        continue;
      }

      // Hash comments (Python/Shell/Ruby - not C/C++ preprocessor or CSS ID selectors)
      if (rawCode[i] === '#' && !isCss && (isPy || (!isC && !rawCode.slice(i).match(/^#(?:include|define|ifdef|ifndef|endif|pragma)\b/)))) {
        let end = rawCode.indexOf('\n', i);
        if (end === -1) end = len;
        html += `<span class="token comment">${escapeHtml(rawCode.slice(i, end))}</span>`;
        i = end;
        continue;
      }

      // PHP Open/Close Tags (<?php, ?>, <?=)
      if (rawCode.startsWith('<?php', i) || rawCode.startsWith('<?=', i) || rawCode.startsWith('?>', i)) {
        const tag = rawCode.startsWith('<?php', i) ? '<?php' : (rawCode.startsWith('<?=', i) ? '<?=' : '?>');
        html += `<span class="token keyword directive">${escapeHtml(tag)}</span>`;
        i += tag.length;
        continue;
      }

      // PHP / Shell Variables ($varName)
      if (rawCode[i] === '$' && /^[a-zA-Z_]\w*/.test(rawCode.slice(i + 1))) {
        const varMatch = rawCode.slice(i).match(/^\$[a-zA-Z_]\w*/);
        if (varMatch) {
          html += `<span class="token variable">${escapeHtml(varMatch[0])}</span>`;
          i += varMatch[0].length;
          continue;
        }
      }

      // C/C++ Preprocessor Directives (#include <stdio.h>, #define, etc.)
      if (rawCode[i] === '#' && (isC || !l)) {
        const rest = rawCode.slice(i);
        const match = rest.match(/^#(?:include|define|ifdef|ifndef|endif|pragma|undef|if|elif|else)\b[^\r\n]*/);
        if (match) {
          const fullDirective = match[0];
          const dirParts = fullDirective.match(/^(#(?:include|define|ifdef|ifndef|endif|pragma|undef|if|elif|else)\b)(\s*)(<[^>]+>|"[^"]+")?(.*)$/);
          if (dirParts) {
            html += `<span class="token keyword directive">${escapeHtml(dirParts[1])}</span>`;
            if (dirParts[2]) html += dirParts[2];
            if (dirParts[3]) html += `<span class="token string">${escapeHtml(dirParts[3])}</span>`;
            if (dirParts[4]) html += escapeHtml(dirParts[4]);
          } else {
            html += `<span class="token keyword directive">${escapeHtml(fullDirective)}</span>`;
          }
          i += match[0].length;
          continue;
        }
      }

      // Strings & Characters
      if (rawCode[i] === '"' || rawCode[i] === "'" || rawCode[i] === '`') {
        const quote = rawCode[i];
        let j = i + 1;
        let escaped = false;
        while (j < len) {
          if (escaped) {
            escaped = false;
          } else if (rawCode[j] === '\\') {
            escaped = true;
          } else if (rawCode[j] === quote) {
            j++;
            break;
          } else if (rawCode[j] === '\n' && quote !== '`') {
            break;
          }
          j++;
        }
        html += `<span class="token string">${escapeHtml(rawCode.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      // HTML/XML Tags
      if (isHtml && rawCode[i] === '<') {
        const tagMatch = rawCode.slice(i).match(/^<\/?([a-zA-Z][\w:-]*)/);
        if (tagMatch) {
          html += `<span class="token punctuation">&lt;${tagMatch[0].startsWith('</') ? '/' : ''}</span><span class="token tag">${escapeHtml(tagMatch[1])}</span>`;
          i += tagMatch[0].length;
          continue;
        }
      }

      // HTML attribute name (e.g. class=, id=)
      if (isHtml) {
        const attrMatch = rawCode.slice(i).match(/^([a-zA-Z_:][\w:.-]*)\s*=/);
        if (attrMatch) {
          html += `<span class="token attr-name">${escapeHtml(attrMatch[1])}</span>`;
          i += attrMatch[1].length;
          continue;
        }
      }

      // CSS Selectors (.class, #id)
      if (isCss && (rawCode[i] === '.' || rawCode[i] === '#')) {
        const selMatch = rawCode.slice(i).match(/^[.#][a-zA-Z0-9_-]+/);
        if (selMatch) {
          html += `<span class="token selector">${escapeHtml(selMatch[0])}</span>`;
          i += selMatch[0].length;
          continue;
        }
      }

      // CSS Properties (e.g. color:, font-size:)
      if (isCss) {
        const propMatch = rawCode.slice(i).match(/^([a-zA-Z-][\w-]*)\s*:/);
        if (propMatch) {
          html += `<span class="token property">${escapeHtml(propMatch[1])}</span>`;
          i += propMatch[1].length;
          continue;
        }
      }

      // Numbers
      const numMatch = rawCode.slice(i).match(/^(?:0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?:[fFuUlL]+)?)\b/);
      if (numMatch && (i === 0 || !/[a-zA-Z0-9_]/.test(rawCode[i - 1]))) {
        html += `<span class="token number">${escapeHtml(numMatch[0])}</span>`;
        i += numMatch[0].length;
        continue;
      }

      // Identifiers / Keywords / Builtins / Function calls
      const identMatch = rawCode.slice(i).match(/^[a-zA-Z_]\w*/);
      if (identMatch) {
        const word = identMatch[0];
        const afterPos = i + word.length;
        const isCall = /^\s*\(/.test(rawCode.slice(afterPos));

        if (keywords.has(word) || (l === 'php' && /^(?:echo|foreach|endforeach|endif|isset|empty|array|require|include|require_once|include_once)$/.test(word))) {
          html += `<span class="token keyword">${escapeHtml(word)}</span>`;
        } else if (builtins.has(word)) {
          html += `<span class="token class-name">${escapeHtml(word)}</span>`;
        } else if (isCall) {
          html += `<span class="token function">${escapeHtml(word)}</span>`;
        } else {
          html += escapeHtml(word);
        }
        i += word.length;
        continue;
      }

      // Multi-character operators
      const multiOpMatch = rawCode.slice(i).match(/^(?:&&|\|\||==|!=|<=|>=|<<|>>|\+=|-=|\*=|\/=|%=|->|\+\+|--|::|=>|\*\*)/);
      if (multiOpMatch) {
        html += `<span class="token operator">${escapeHtml(multiOpMatch[0])}</span>`;
        i += multiOpMatch[0].length;
        continue;
      }

      // Single-character operators
      if (/[+\-*/%!=<>&|^~?]/.test(rawCode[i])) {
        html += `<span class="token operator">${escapeHtml(rawCode[i])}</span>`;
        i++;
        continue;
      }

      // Punctuation
      if (/[{}()\[\];,.]/.test(rawCode[i])) {
        html += `<span class="token punctuation">${escapeHtml(rawCode[i])}</span>`;
        i++;
        continue;
      }

      // Whitespace or any other char
      html += escapeHtml(rawCode[i]);
      i++;
    }

    return html;
  }

  function createEventStreamParser(onEvent) {
    let buffer = '';
    let eventName = 'message';
    let data = [];
    let eventSize = 0;
    function line(value) {
      if (!value) {
        if (data.length) onEvent(eventName, data.join('\n'));
        eventName = 'message';
        data = [];
        eventSize = 0;
        return;
      }
      if (value.startsWith(':')) return;
      const separator = value.indexOf(':');
      const field = separator < 0 ? value : value.slice(0, separator);
      let content = separator < 0 ? '' : value.slice(separator + 1);
      if (content.startsWith(' ')) content = content.slice(1);
      if (field === 'event') eventName = content;
      if (field === 'data') {
        eventSize += content.length;
        if (eventSize > 1024 * 1024) throw new Error('This response is too large. Try a shorter question.');
        data.push(content);
      }
    }
    return {
      feed(chunk, final = false) {
        buffer += chunk;
        let index;
        while ((index = buffer.search(/[\r\n]/)) >= 0) {
          if (!final && buffer[index] === '\r' && index === buffer.length - 1) break;
          const value = buffer.slice(0, index);
          const length = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
          buffer = buffer.slice(index + length);
          line(value);
        }
        if (buffer.length > 1024 * 1024) throw new Error('This response is too large. Try a shorter question.');
      }
    };
  }

  async function readChatResponse(response, onDelta) {
    if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
      const result = await response.json();
      if (!result || typeof result.reply !== 'string') throw new Error('The reply was incomplete. Please try again.');
      return result;
    }
    if (!response.body) throw new Error('Streaming is unavailable. Please try again.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = null;
    let terminal = false;
    const parser = createEventStreamParser((event, raw) => {
      if (terminal || !['delta', 'result', 'error'].includes(event)) return;
      let data;
      try { data = JSON.parse(raw); } catch (_) { throw new Error('The reply was interrupted. Please try again.'); }
      if (event === 'error') throw new Error(typeof data.message === 'string' ? data.message : 'Could not finish the reply. Please try again.');
      if (event === 'delta' && typeof data.text === 'string') onDelta(data.text);
      if (event === 'result') {
        if (!data || typeof data.reply !== 'string') throw new Error('The reply was incomplete. Please try again.');
        result = data;
        terminal = true;
      }
    });
    try {
      while (!terminal) {
        const { value, done } = await reader.read();
        parser.feed(done ? decoder.decode() : decoder.decode(value, { stream: true }), done);
        if (done) break;
      }
      if (!terminal) throw new Error('The reply was interrupted. Please try again.');
      return result;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  // Adaptive Visual Block Renderer (Safe, Strict Monochrome, Zero Arbitrary HTML Execution)
  function renderAdaptiveVisualBlockHtml(langKey, rawCode) {
    const kind = String(langKey || '').trim().toLowerCase();
    const rawStr = String(rawCode == null ? '' : rawCode);
    if (!rawStr.trim() || rawStr.length > 65536) return null;
    const text = rawStr.trim();

    let parsedJson = null;
    if (text.startsWith('{')) {
      try {
        parsedJson = JSON.parse(text);
      } catch (_) {
        parsedJson = null;
      }
    }

    const safeTrunc = (val, maxLen = 240) => {
      const s = String(val == null ? '' : val).trim();
      return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
    };

    if (kind === 'study_session') {
      const data = parsedJson || {};
      const course = escapeHtml(data.course || 'Study Partner Session');
      const unit = escapeHtml(data.unit || 'Chapter Progress');
      const curr = Number(data.currentStep) || 1;
      const total = Number(data.totalSteps) || 1;
      const pct = Math.min(100, Math.max(0, Math.round(((curr - 1) / total) * 100)));
      const items = Array.isArray(data.checklist) ? data.checklist : [];
      const renderItem = (item) => {
        const idx = item.stepIndex || 1;
        const title = escapeHtml(item.title || `Topic ${idx}`);
        const isCurrent = item.status === 'current' || idx === curr;
        const isMastered = item.status === 'mastered' || idx < curr;
        const badge = item.sourceBadge ? `<span style="font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:#1a1a1a;color:#a1a1a1;margin-left:6px;">${escapeHtml(item.sourceBadge)}</span>` : '';
        const pyq = item.hasPyq ? `<span style="font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.25);background:#222;color:#fff;margin-left:4px;">🔥 PYQ</span>` : '';
        const symbol = isMastered ? '✓' : (isCurrent ? '▶' : '○');
        const color = isCurrent ? '#ffffff' : (isMastered ? '#a1a1a1' : '#666666');
        const bg = isCurrent ? 'rgba(255,255,255,0.06)' : 'transparent';
        return `<div style="display:flex;align-items:center;padding:5px 8px;margin:2px 0;border-radius:6px;background:${bg};font-size:12.5px;color:${color};">
          <span style="font-weight:700;width:20px;flex-shrink:0;">${symbol}</span>
          <span style="flex:1;">${idx}. ${title}</span>
          ${badge}
          ${pyq}
        </div>`;
      };

      const currItem = items.find(it => (it.stepIndex || 1) === curr) || items[0];
      const previewHtml = currItem ? renderItem(currItem) : '';
      const allListHtml = items.map(renderItem).join('');
      const detailsHtml = items.length > 1
        ? `<details style="margin-top:6px;">
            <summary style="cursor:pointer;font-size:11.5px;color:#a1a1a1;user-select:none;padding:2px 4px;">View all ${items.length} topics in this unit</summary>
            <div style="margin-top:6px;">${allListHtml}</div>
          </details>`
        : '';

      return `<div class="kyana-adaptive-visual kyana-study-session-card" style="margin:12px 0;padding:14px;border-radius:12px;border:1px solid #282828;background:#141414;color:#ffffff;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#a1a1a1;">${course}</div>
            <div style="font-size:14px;font-weight:700;color:#ffffff;margin-top:2px;">${unit}</div>
          </div>
          <span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:12px;border:1px solid #333;background:#1c1c1c;color:#fff;">Step ${curr} of ${total} · ${pct}%</span>
        </div>
        <div style="width:100%;height:4px;background:#282828;border-radius:2px;overflow:hidden;margin-bottom:10px;">
          <div style="width:${pct}%;height:100%;background:#ffffff;border-radius:2px;"></div>
        </div>
        <div style="border-top:1px solid #222;padding-top:8px;">
          ${previewHtml}
          ${detailsHtml}
        </div>
      </div>`;
    }

    if (kind === 'live_demo') {
      const data = parsedJson || {};
      const title = escapeHtml(data.title || 'Live Concept Demonstration');
      const subtitle = escapeHtml(data.subtitle || 'Switch styles to see how CSS transforms the exact same HTML');
      const caption = escapeHtml(data.caption || 'The HTML content stays the same. Only CSS changes.');
      const htmlSnippet = String(data.html || '<h1>Hello World!</h1><p>Welcome to my first webpage.</p><button>Click me</button>');
      const variants = Array.isArray(data.variants) && data.variants.length
        ? data.variants
        : [{ label: 'Default', css: 'body{font-family:serif;background:#fff;color:#111;padding:16px;}' }];

      const buttonsHtml = variants.map((v, idx) => {
        const active = idx === 0;
        const bg = active ? '#ffffff' : '#1c1c1c';
        const fg = active ? '#080808' : '#a1a1a1';
        return `<button type="button" class="kyana-live-demo-tab${active ? ' active' : ''}" data-variant-index="${idx}" style="cursor:pointer;font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid #333;background:${bg};color:${fg};transition:all 0.15s ease;">${escapeHtml(v.label || `Style ${idx + 1}`)}</button>`;
      }).join('');

      const encodedPayload = escapeHtml(JSON.stringify({ html: htmlSnippet, variants }));

      return `<div class="kyana-adaptive-visual kyana-live-demo-card" data-demo-payload="${encodedPayload}" style="margin:12px 0;padding:14px;border-radius:12px;border:1px solid #282828;background:#141414;color:#ffffff;box-sizing:border-box;">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
          <div>
            <div style="font-size:10.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#a1a1a1;">${title}</div>
            <div style="font-size:12px;color:#888;margin-top:2px;">${subtitle}</div>
          </div>
          <div class="kyana-live-demo-tabs" style="display:flex;gap:6px;flex-wrap:wrap;">${buttonsHtml}</div>
        </div>
        <iframe class="kyana-live-demo-frame" sandbox="" title="Interactive Live Demo" style="width:100%;height:150px;border:1px solid #282828;border-radius:8px;background:#ffffff;display:block;"></iframe>
        <div style="font-size:11.5px;color:#888;margin-top:8px;">${caption}</div>
      </div>`;
    }

    if (kind === 'pyq_card') {
      const data = parsedJson || {};
      const examTitle = escapeHtml(data.examTitle || 'GANDAKI UNIVERSITY · PAST EXAM QUESTION');
      const qNum = escapeHtml(data.questionNumber || 'Q');
      const marks = escapeHtml(data.marks || '5 MARKS');
      const qText = escapeHtml(data.questionText || '');
      const noteRef = data.teacherNoteReference ? `<div style="font-size:11.5px;color:#888;margin-top:6px;">📄 Covered in: <span style="color:#bbb;">${escapeHtml(data.teacherNoteReference)}</span></div>` : '';

      return `<div class="kyana-adaptive-visual kyana-pyq-card" style="margin:12px 0;padding:14px;border-radius:12px;border:1px solid #333;background:#161616;color:#ffffff;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:10.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#888;">🔥 PAST EXAM SPOTLIGHT</span>
          <span style="font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:10px;border:1px solid #444;background:#222;color:#fff;">${marks}</span>
        </div>
        <div style="font-size:11px;color:#aaa;margin-bottom:6px;">${examTitle} · ${qNum}</div>
        <div style="font-size:13.5px;line-height:1.5;color:#f0f0f0;font-weight:500;">${qText}</div>
        ${noteRef}
      </div>`;
    }

    if (kind === 'roadmap' || kind === 'timeline') {
      const rawSteps = Array.isArray(parsedJson?.steps)
        ? parsedJson.steps
        : Array.isArray(parsedJson?.items)
          ? parsedJson.items
          : (!text.startsWith('{')
              ? text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
                  const m = line.match(/^[-*]\s+\[([ xX])\]\s+\*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?(?:\s*[—–-]\s*(.+))?$/);
                  if (m) return { done: m[1].toLowerCase() === 'x', title: m[2].trim(), tag: (m[3] || '').trim(), detail: (m[4] || '').trim() };
                  return { done: false, title: line.replace(/^[-*•\d.]+\s*/, ''), tag: '', detail: '' };
                })
              : []);
      const steps = rawSteps.filter(s => s && typeof s === 'object' && !Array.isArray(s));
      if (!steps.length) return null;
      const title = escapeHtml(safeTrunc(parsedJson?.title || (kind === 'timeline' ? 'Timeline' : 'Study Roadmap'), 140));
      const rows = steps.slice(0, 12).map((s, idx) => {
        const stepTitle = escapeHtml(safeTrunc(s.title || s.label || `Step ${idx + 1}`, 140));
        const stepTag = escapeHtml(safeTrunc(s.tag || s.phase || `Step ${idx + 1}`, 60));
        const stepDetail = escapeHtml(safeTrunc(s.detail || s.desc || s.description || '', 320));
        const checkMark = s.done ? '✓' : String(idx + 1);
        return `<div class="kyana-visual-step" style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid rgba(128,128,128,0.14);max-width:100%;box-sizing:border-box;">
          <span style="min-width:22px;height:22px;border-radius:11px;border:1px solid rgba(128,128,128,0.4);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${escapeHtml(checkMark)}</span>
          <div style="flex:1;min-width:0;word-break:break-word;">
            <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-weight:600;font-size:13px;">
              <span>${stepTitle}</span>
              ${stepTag ? `<span style="font-size:11px;opacity:0.7;">${stepTag}</span>` : ''}
            </div>
            ${stepDetail ? `<div style="font-size:12.5px;opacity:0.82;margin-top:2px;">${stepDetail}</div>` : ''}
          </div>
        </div>`;
      }).join('');
      return `<div class="kyana-adaptive-visual kyana-visual-${escapeHtml(kind)}" style="margin:10px 0;padding:12px 14px;border-radius:12px;border:1px solid rgba(128,128,128,0.22);background:rgba(128,128,128,0.04);max-width:100%;box-sizing:border-box;overflow-x:auto;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;opacity:0.7;margin-bottom:6px;">${title}</div>
        ${rows}
      </div>`;
    }

    if (kind === 'diagram' || kind === 'flowchart' || kind === 'trace') {
      const rawNodes = Array.isArray(parsedJson?.nodes)
        ? parsedJson.nodes
        : Array.isArray(parsedJson?.steps)
          ? parsedJson.steps
          : null;
      const nodes = Array.isArray(rawNodes) ? rawNodes.filter(n => n && typeof n === 'object' && !Array.isArray(n)) : null;
      const title = escapeHtml(safeTrunc(parsedJson?.title || (kind === 'diagram' ? 'Concept Flow Diagram' : 'Step-by-Step Trace'), 140));
      if (nodes && nodes.length > 0) {
        const nodeHtml = nodes.slice(0, 12).map((n, idx) => {
          const label = escapeHtml(safeTrunc(n.label || n.title || n.id || `Stage ${idx + 1}`, 140));
          const detail = escapeHtml(safeTrunc(n.detail || n.content || n.state || '', 320));
          const arrow = idx < Math.min(nodes.length, 12) - 1 ? `<div style="text-align:center;opacity:0.55;font-size:12px;margin:2px 0;">↓</div>` : '';
          return `<div style="padding:8px 10px;border-radius:8px;border:1px solid rgba(128,128,128,0.24);background:rgba(128,128,128,0.05);max-width:100%;box-sizing:border-box;word-break:break-word;">
            <div style="font-weight:600;font-size:12.5px;">${label}</div>
            ${detail ? `<div style="font-size:12px;opacity:0.82;margin-top:2px;">${detail}</div>` : ''}
          </div>${arrow}`;
        }).join('');
        return `<div class="kyana-adaptive-visual kyana-visual-${escapeHtml(kind)}" style="margin:10px 0;padding:12px 14px;border-radius:12px;border:1px solid rgba(128,128,128,0.22);background:rgba(128,128,128,0.04);max-width:100%;box-sizing:border-box;overflow-x:auto;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;opacity:0.7;margin-bottom:8px;">${title}</div>
          ${nodeHtml}
        </div>`;
      }
    }

    if (kind === 'logic_sim' || (kind === 'interactive_demo' && parsedJson && (parsedJson.demoType === 'logic_gate_simulator' || Array.isArray(parsedJson.gates)))) {
      if (!parsedJson || typeof parsedJson !== 'object') return null;
      const defaultGates = [
        {
          gate: 'AND',
          symbol: 'A · B',
          inputs: ['A', 'B'],
          description: 'Outputs 1 (HIGH) only when all inputs are 1.',
          truthTable: [
            { A: 0, B: 0, Y: 0 },
            { A: 0, B: 1, Y: 0 },
            { A: 1, B: 0, Y: 0 },
            { A: 1, B: 1, Y: 1 }
          ]
        },
        {
          gate: 'OR',
          symbol: 'A + B',
          inputs: ['A', 'B'],
          description: 'Outputs 1 (HIGH) when at least one input is 1.',
          truthTable: [
            { A: 0, B: 0, Y: 0 },
            { A: 0, B: 1, Y: 1 },
            { A: 1, B: 0, Y: 1 },
            { A: 1, B: 1, Y: 1 }
          ]
        },
        {
          gate: 'NOT',
          symbol: "A'",
          inputs: ['A'],
          description: 'Inverts input A (0 becomes 1, 1 becomes 0).',
          truthTable: [
            { A: 0, Y: 1 },
            { A: 1, Y: 0 }
          ]
        }
      ];
      const rawGates = Array.isArray(parsedJson.gates) && parsedJson.gates.length > 0 ? parsedJson.gates : defaultGates;
      const gates = rawGates.map((g) => {
        if (typeof g === 'string') {
          const found = defaultGates.find(d => d.gate === g.toUpperCase());
          return found || defaultGates[0];
        }
        return g && g.gate ? g : defaultGates[0];
      });
      const title = escapeHtml(safeTrunc(parsedJson.title || 'Interactive Logic Gate Simulator', 120));
      const subtitle = escapeHtml(safeTrunc(parsedJson.subtitle || 'Toggle inputs A and B between 0 and 1 to test the gate output and highlight the active truth-table row.', 200));
      const firstGate = gates[0];
      const isSingleInput = Array.isArray(firstGate.inputs) && firstGate.inputs.length === 1;
      const initY = (firstGate.truthTable || [])[0]?.Y ?? 0;

      const gateTabsHtml = gates.map((g, idx) => {
        const active = idx === 0;
        return `<button type="button" class="kyana-logic-gate-tab${active ? ' active' : ''}" data-gate-index="${idx}" style="cursor:pointer;font-size:11.5px;font-weight:700;padding:4px 11px;border-radius:999px;border:1px solid #333;background:${active ? '#ffffff' : '#1c1c1c'};color:${active ? '#09090b' : '#a1a1aa'};transition:all 0.14s ease;">${escapeHtml(g.gate)}</button>`;
      }).join('');

      const rowsHtml = (firstGate.truthTable || []).map((r, rIdx) => {
        const isCurrentRow = rIdx === 0;
        const rowBg = isCurrentRow ? 'rgba(255,255,255,0.12)' : 'transparent';
        const bCell = isSingleInput ? '' : `<td style="padding:5px 10px;text-align:center;border-bottom:1px solid #27272a;">${r.B}</td>`;
        return `<tr class="kyana-logic-tr" data-a="${r.A}" data-b="${r.B ?? 0}" style="background:${rowBg};font-weight:${isCurrentRow ? '700' : '400'};">
          <td style="padding:5px 10px;text-align:center;border-bottom:1px solid #27272a;">${r.A}</td>
          ${bCell}
          <td style="padding:5px 10px;text-align:center;border-bottom:1px solid #27272a;font-weight:700;color:${r.Y === 1 ? '#ffffff' : '#a1a1aa'};">${r.Y}</td>
        </tr>`;
      }).join('');

      const encodedSim = escapeHtml(JSON.stringify({ gates }));

      return `<div class="kyana-adaptive-visual kyana-logic-sim-card" data-logic-payload="${encodedSim}" data-active-gate="0" data-input-a="0" data-input-b="0" style="margin:12px 0;padding:14px;border-radius:12px;border:1px solid #282828;background:#141414;color:#ffffff;box-sizing:border-box;">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
          <div>
            <div style="font-size:10.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#a1a1aa;">${title}</div>
            <div class="kyana-logic-desc" style="font-size:12px;color:#888;margin-top:2px;">${escapeHtml(firstGate.description || subtitle)}</div>
          </div>
          <div class="kyana-logic-gate-tabs" style="display:flex;gap:6px;flex-wrap:wrap;">${gateTabsHtml}</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-radius:10px;border:1px solid #262626;background:#1a1a1a;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <button type="button" class="kyana-logic-input-btn" data-input-key="A" style="cursor:pointer;padding:6px 12px;border-radius:8px;border:1px solid #3f3f46;background:#111111;color:#ffffff;font-size:12.5px;font-weight:700;">Input A: <span class="val">0</span></button>
            <button type="button" class="kyana-logic-input-btn" data-input-key="B" style="cursor:pointer;padding:6px 12px;border-radius:8px;border:1px solid #3f3f46;background:#111111;color:#ffffff;font-size:12.5px;font-weight:700;${isSingleInput ? 'display:none;' : ''}">Input B: <span class="val">0</span></button>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="kyana-logic-expr" style="font-family:var(--ky-font-mono,monospace);font-size:12.5px;color:#a1a1aa;">Y = ${escapeHtml(firstGate.symbol || firstGate.gate)}</span>
            <div class="kyana-logic-output-pill" style="padding:6px 14px;border-radius:8px;border:1px solid ${initY === 1 ? '#ffffff' : '#3f3f46'};background:${initY === 1 ? '#ffffff' : '#111111'};color:${initY === 1 ? '#09090b' : '#a1a1aa'};font-size:13px;font-weight:800;">Output Y = <span class="out-val">${initY}</span></div>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="kyana-logic-table" style="width:100%;border-collapse:collapse;font-size:12px;color:#e4e4e7;">
            <thead>
              <tr style="background:#1c1c1c;">
                <th style="padding:6px 10px;text-align:center;border-bottom:1px solid #333;">Input A</th>
                <th class="kyana-logic-th-b" style="padding:6px 10px;text-align:center;border-bottom:1px solid #333;${isSingleInput ? 'display:none;' : ''}">Input B</th>
                <th style="padding:6px 10px;text-align:center;border-bottom:1px solid #333;">Output Y</th>
              </tr>
            </thead>
            <tbody class="kyana-logic-tbody">${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
    }

    if (kind === 'comparison' || kind === 'attendance' || kind === 'results') {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 20);
      if (!lines.length) return null;
      const rows = lines.map(l => `<div style="padding:6px 0;border-bottom:1px solid rgba(128,128,128,0.12);font-size:12.5px;word-break:break-word;">${escapeHtml(safeTrunc(l.replace(/\*\*/g, ''), 280))}</div>`).join('');
      return `<div class="kyana-adaptive-visual kyana-visual-${escapeHtml(kind)}" style="margin:10px 0;padding:12px 14px;border-radius:12px;border:1px solid rgba(128,128,128,0.22);background:rgba(128,128,128,0.04);max-width:100%;box-sizing:border-box;overflow-x:auto;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;opacity:0.7;margin-bottom:6px;">${escapeHtml(kind.toUpperCase())}</div>
        ${rows}
      </div>`;
    }

    if (kind === 'checkpoint_question' || kind === 'chapter_summary' || kind === 'source_reference') {
      if (!parsedJson || typeof parsedJson !== 'object') return null;
      const heading = escapeHtml(safeTrunc(parsedJson.title || parsedJson.unit || kind.replace(/_/g, ' '), 120));
      const bodyText = escapeHtml(safeTrunc(parsedJson.questionText || parsedJson.summary || parsedJson.text || parsedJson.fileTitle || '', 320));
      if (!bodyText) return null;
      return `<div class="kyana-adaptive-visual kyana-visual-${escapeHtml(kind)}" style="margin:10px 0;padding:12px 14px;border-radius:12px;border:1px solid rgba(128,128,128,0.22);background:rgba(128,128,128,0.04);max-width:100%;box-sizing:border-box;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;opacity:0.7;margin-bottom:6px;">${heading}</div>
        <div style="font-size:13px;line-height:1.5;">${bodyText}</div>
      </div>`;
    }

    return null;
  }

  // Pure helpers export for Node unit test runners
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') {
    module.exports = {
      createEventStreamParser,
      readChatResponse,
      escapeHtml,
      safeLink,
      protectCodeBlocks,
      restoreCodeBlocks,
      stabilizeStreamingMarkdown,
      fallbackMarkdown,
      normalizeLatexDelimiters,
      highlightChatCode,
      assertAndCleanPlaceholders,
      renderAdaptiveVisualBlockHtml
    };
    return;
  }

  // Expose shared Adaptive Presentation Renderer on window for Library Split-Screen & other pages
  if (typeof window !== 'undefined') {
    window.KyanaAdaptiveRenderer = {
      stabilizeStreamingMarkdown,
      fallbackMarkdown,
      normalizeLatexDelimiters,
      highlightChatCode,
      renderAdaptiveVisualBlockHtml
    };
  }

  // Prevent multiple initializations in browser
  if (window.__KYANA_WORKSPACE_INITIALIZED__) return;
  window.__KYANA_WORKSPACE_INITIALIZED__ = true;

  const isFullPage = document.body.classList.contains('sla-fullpage-mode') || window.location.pathname.includes('chatbot.html');
  if (!isFullPage) return;

  // --- 2. Dynamic CDN Asset Loading (Marked, DOMPurify, KaTeX, Prism) ---
  function loadScript(src) {
    return new Promise((resolve) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }

  Promise.all([
    loadScript('https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js')
  ]).then(() => {
    return Promise.all([
      loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-c.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-cpp.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-java.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-python.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-javascript.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-markup.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-css.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-json.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-sql.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-bash.min.js')
    ]);
  }).catch(() => {});

  // --- 3. Component Architecture Definitions ---

  function generateSampleHtmlForCss(cssText) {
    const classMatches = [...cssText.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map(m => m[1]);
    const idMatches = [...cssText.matchAll(/#([a-zA-Z0-9_-]+)/g)].map(m => m[1]);
    const tagMatches = [...cssText.matchAll(/\b(h[1-6]|p|button|span|a|ul|li|div)\b/g)].map(m => m[1]);

    const parts = [];
    if (classMatches.length) {
      for (const cls of new Set(classMatches)) {
        parts.push(`<p class="${escapeHtml(cls)}">This paragraph has class="<strong>${escapeHtml(cls)}</strong>"</p>`);
      }
    }
    if (idMatches.length) {
      for (const id of new Set(idMatches)) {
        parts.push(`<h2 id="${escapeHtml(id)}">This heading has id="<strong>${escapeHtml(id)}</strong>"</h2>`);
      }
    }
    if (!parts.length && tagMatches.length) {
      for (const tag of new Set(tagMatches)) {
        parts.push(`<${tag}>Sample &lt;${tag}&gt; element</${tag}>`);
      }
    }
    if (!parts.length) {
      parts.push('<p>CSS applied to live output preview canvas</p>');
    }
    return parts.join('\n');
  }

  function toggleCodePreview(wrap, codeBlock, langKey) {
    const existing = wrap.querySelector('.kyana-code-preview-pane');
    const pBtn = wrap.querySelector('.kyana-preview-code-btn');
    if (existing) {
      existing.remove();
      if (pBtn) pBtn.classList.remove('active');
      return;
    }

    if (pBtn) pBtn.classList.add('active');

    const pane = document.createElement('div');
    pane.className = 'kyana-code-preview-pane';
    pane.innerHTML = `
      <div class="kyana-code-preview-bar">
        <div class="kyana-code-preview-title">
          <span class="kyana-preview-pulse"></span>
          <span>Live Output Preview</span>
        </div>
        <div class="kyana-code-preview-actions">
          <button type="button" class="kyana-preview-bar-btn kyana-preview-refresh-btn" title="Reload preview">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          <button type="button" class="kyana-preview-bar-btn kyana-preview-close-btn" title="Close preview">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="kyana-code-preview-canvas">
        <iframe class="kyana-code-preview-iframe" sandbox="allow-scripts" title="Code Output Preview"></iframe>
      </div>
    `;

    const closeBtn = pane.querySelector('.kyana-preview-close-btn');
    closeBtn.addEventListener('click', () => {
      pane.remove();
      if (pBtn) pBtn.classList.remove('active');
    });

    const refreshBtn = pane.querySelector('.kyana-preview-refresh-btn');
    refreshBtn.addEventListener('click', () => {
      renderIframe();
    });

    function renderIframe() {
      const iframe = pane.querySelector('.kyana-code-preview-iframe');
      if (!iframe) return;

      const messageContainer = wrap.closest('.kyana-message-body') || wrap.parentElement;
      const currentCode = codeBlock.dataset.rawCode || codeBlock.textContent || '';

      let companionCss = '';
      let companionHtml = '';
      let companionJs = '';

      if (messageContainer) {
        messageContainer.querySelectorAll('.kyana-code-block').forEach((otherWrap) => {
          if (otherWrap === wrap) return;
          const oLang = (otherWrap.dataset.lang || '').toLowerCase();
          const otherCodeEl = otherWrap.querySelector('pre code');
          const otherCode = otherCodeEl ? (otherCodeEl.dataset.rawCode || otherCodeEl.textContent || '') : '';

          if (oLang === 'css') {
            companionCss += '\n' + otherCode;
          } else if (oLang === 'html' || oLang === 'xml') {
            companionHtml += '\n' + otherCode;
          } else if (oLang === 'javascript' || oLang === 'js') {
            companionJs += '\n' + otherCode;
          }
        });
      }

      let finalHtml = '';
      if (langKey === 'html' || langKey === 'xml' || langKey === 'svg') {
        finalHtml = currentCode;
      } else if (langKey === 'css') {
        if (companionHtml.trim()) {
          finalHtml = companionHtml;
          companionCss = currentCode + '\n' + companionCss;
        } else {
          finalHtml = generateSampleHtmlForCss(currentCode);
          companionCss = currentCode;
        }
      } else if (langKey === 'javascript' || langKey === 'js') {
        finalHtml = companionHtml.trim() ? companionHtml : '<div id="app"></div>';
        companionJs = currentCode + '\n' + companionJs;
      }

      const docContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1f2937;
      background-color: #ffffff;
    }
    ${companionCss}
  </style>
</head>
<body>
  ${finalHtml}
  ${companionJs ? `<script>${companionJs}<\/script>` : ''}
</body>
</html>`;

      iframe.srcdoc = docContent;
      iframe.onload = () => {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          if (doc && doc.body) {
            const h = Math.max(doc.body.scrollHeight + 32, 70);
            iframe.style.height = `${Math.min(h, 340)}px`;
          }
        } catch (_) {}
      };
    }

    wrap.appendChild(pane);
    renderIframe();
  }

  // KyanaCodeBlock Component
  const KyanaCodeBlock = {
    enhance(container) {
      container.querySelectorAll('pre code').forEach((codeBlock) => {
        const pre = codeBlock.parentElement;
        if (pre.parentElement && pre.parentElement.classList.contains('kyana-code-block')) return;

        const rawCode = codeBlock.textContent || '';
        const langMatch = codeBlock.className.match(/language-([a-zA-Z0-9_#+-]+)/);
        const langName = langMatch ? langMatch[1] : 'Code';
        const langKey = langName.toLowerCase();

        // Render structured adaptive visual blocks safely (never expose malformed structured JSON)
        if (/^(study_session|learning_session|pyq_card|live_demo|logic_sim|interactive_demo|roadmap|timeline|diagram|flowchart|trace|checkpoint_question|chapter_summary|source_reference)$/.test(langKey)) {
          const normalizedLang = langKey === 'learning_session' ? 'study_session' : langKey;
          const visualHtml = renderAdaptiveVisualBlockHtml(normalizedLang, rawCode);
          if (visualHtml) {
            const visualWrap = document.createElement('div');
            visualWrap.innerHTML = visualHtml;
            const visualEl = visualWrap.firstElementChild;
            if (visualEl) {
              if (normalizedLang === 'live_demo') {
                const payloadRaw = visualEl.getAttribute('data-demo-payload');
                const frame = visualEl.querySelector('.kyana-live-demo-frame');
                const tabs = visualEl.querySelectorAll('.kyana-live-demo-tab');
                try {
                  const demoData = JSON.parse(payloadRaw || '{}');
                  const applyVariant = (idx) => {
                    const variant = (demoData.variants || [])[idx] || {};
                    if (frame) {
                      frame.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;}body{margin:0;padding:16px;}${variant.css || ''}</style></head><body>${demoData.html || ''}</body></html>`;
                    }
                    tabs.forEach((btn, bIdx) => {
                      const isActive = bIdx === idx;
                      btn.classList.toggle('active', isActive);
                      btn.style.background = isActive ? '#ffffff' : '#1c1c1c';
                      btn.style.color = isActive ? '#080808' : '#a1a1a1';
                    });
                  };
                  applyVariant(0);
                  tabs.forEach((btn) => {
                    btn.addEventListener('click', () => {
                      applyVariant(Number(btn.getAttribute('data-variant-index')) || 0);
                    });
                  });
                } catch (_) {}
              } else if (normalizedLang === 'logic_sim' || normalizedLang === 'interactive_demo') {
                const payloadRaw = visualEl.getAttribute('data-logic-payload');
                try {
                  const simData = JSON.parse(payloadRaw || '{}');
                  const gates = Array.isArray(simData.gates) ? simData.gates : [];
                  const gateTabs = visualEl.querySelectorAll('.kyana-logic-gate-tab');
                  const inputBtns = visualEl.querySelectorAll('.kyana-logic-input-btn');
                  const descEl = visualEl.querySelector('.kyana-logic-desc');
                  const exprEl = visualEl.querySelector('.kyana-logic-expr');
                  const outPill = visualEl.querySelector('.kyana-logic-output-pill');
                  const outVal = visualEl.querySelector('.kyana-logic-output-pill .out-val');
                  const thB = visualEl.querySelector('.kyana-logic-th-b');
                  const tbody = visualEl.querySelector('.kyana-logic-tbody');

                  const syncLogicSimulator = () => {
                    const gIdx = Number(visualEl.getAttribute('data-active-gate')) || 0;
                    const aVal = Number(visualEl.getAttribute('data-input-a')) || 0;
                    const bVal = Number(visualEl.getAttribute('data-input-b')) || 0;
                    const gateObj = gates[gIdx] || gates[0];
                    if (!gateObj) return;
                    const single = Array.isArray(gateObj.inputs) && gateObj.inputs.length === 1;
                    if (descEl) descEl.textContent = gateObj.description || '';
                    if (exprEl) exprEl.textContent = `Y = ${gateObj.symbol || gateObj.gate}`;
                    if (thB) thB.style.display = single ? 'none' : '';
                    inputBtns.forEach((btn) => {
                      const key = btn.getAttribute('data-input-key');
                      const vSpan = btn.querySelector('.val');
                      if (key === 'A' && vSpan) vSpan.textContent = String(aVal);
                      if (key === 'B') {
                        btn.style.display = single ? 'none' : '';
                        if (vSpan) vSpan.textContent = String(bVal);
                      }
                    });
                    const tableRows = Array.isArray(gateObj.truthTable) ? gateObj.truthTable : [];
                    const matched = tableRows.find(r => Number(r.A) === aVal && (single || Number(r.B) === bVal)) || tableRows[0] || { Y: 0 };
                    const yVal = Number(matched.Y) || 0;
                    if (outVal) outVal.textContent = String(yVal);
                    if (outPill) {
                      outPill.style.background = yVal === 1 ? '#ffffff' : '#111111';
                      outPill.style.color = yVal === 1 ? '#09090b' : '#a1a1aa';
                      outPill.style.borderColor = yVal === 1 ? '#ffffff' : '#3f3f46';
                    }
                    if (tbody) {
                      tbody.innerHTML = tableRows.map((r) => {
                        const isMatch = Number(r.A) === aVal && (single || Number(r.B) === bVal);
                        const rowBg = isMatch ? 'rgba(255,255,255,0.12)' : 'transparent';
                        const bTd = single ? '' : `<td style="padding:5px 10px;text-align:center;border-bottom:1px solid #27272a;">${r.B}</td>`;
                        return `<tr class="kyana-logic-tr" style="background:${rowBg};font-weight:${isMatch ? '700' : '400'};">
                          <td style="padding:5px 10px;text-align:center;border-bottom:1px solid #27272a;">${r.A}</td>
                          ${bTd}
                          <td style="padding:5px 10px;text-align:center;border-bottom:1px solid #27272a;font-weight:700;color:${Number(r.Y) === 1 ? '#ffffff' : '#a1a1aa'};">${r.Y}</td>
                        </tr>`;
                      }).join('');
                    }
                  };

                  gateTabs.forEach((tab) => {
                    tab.addEventListener('click', () => {
                      const nextIdx = Number(tab.getAttribute('data-gate-index')) || 0;
                      visualEl.setAttribute('data-active-gate', String(nextIdx));
                      gateTabs.forEach((t, idx) => {
                        const isAct = idx === nextIdx;
                        t.classList.toggle('active', isAct);
                        t.style.background = isAct ? '#ffffff' : '#1c1c1c';
                        t.style.color = isAct ? '#09090b' : '#a1a1aa';
                      });
                      syncLogicSimulator();
                    });
                  });

                  inputBtns.forEach((btn) => {
                    btn.addEventListener('click', () => {
                      const key = btn.getAttribute('data-input-key');
                      const attr = key === 'B' ? 'data-input-b' : 'data-input-a';
                      const curr = Number(visualEl.getAttribute(attr)) || 0;
                      visualEl.setAttribute(attr, curr === 1 ? '0' : '1');
                      syncLogicSimulator();
                    });
                  });
                } catch (_) {}
              }
              pre.parentNode.replaceChild(visualEl, pre);
              return;
            }
          }
          // Malformed structured block: remove silently so internal JSON schemas never leak to students
          if (pre && pre.parentNode) {
            pre.parentNode.removeChild(pre);
          }
          return;
        }

        const isWebCode = /^(html|xml|svg|css|javascript|js)$/.test(langKey);
        const compilerSupported = /^(java|c|cpp|c\+\+|html|css|javascript|js|python|py|sql)$/.test(langKey);

        codeBlock.dataset.rawCode = rawCode;
        codeBlock.innerHTML = highlightChatCode(rawCode, langKey);
        assertAndCleanPlaceholders(codeBlock);

        const wrap = document.createElement('div');
        wrap.className = 'kyana-code-block';
        wrap.dataset.lang = langKey;

        const header = document.createElement('div');
        header.className = 'kyana-code-header';
        header.innerHTML = `
          <div class="kyana-code-lang-tag">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="kyana-code-icon">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
            <span class="kyana-code-lang">${escapeHtml(langName.toUpperCase())}</span>
          </div>
          <div class="kyana-code-actions">
            <button type="button" class="kyana-code-btn kyana-wrap-code-btn" title="Toggle line wrap">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 10 4 15 9 20"/>
                <path d="M20 4v7a4 4 0 0 1-4 4H4"/>
              </svg>
            </button>
            <button type="button" class="kyana-code-btn kyana-copy-code-btn" title="Copy code">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            ${isWebCode ? `
            <button type="button" class="kyana-code-btn kyana-preview-code-btn" title="Preview live output">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <polygon points="6,4 20,12 6,20"/>
              </svg>
            </button>` : (compilerSupported ? `
            <button type="button" class="kyana-code-btn kyana-run-compiler-btn" title="Open in Semester Library Code Lab">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <polygon points="6,4 20,12 6,20"/>
              </svg>
            </button>` : '')}
          </div>
        `;

        const wrapBtn = header.querySelector('.kyana-wrap-code-btn');
        if (wrapBtn) {
          wrapBtn.addEventListener('click', () => {
            const isWrapped = pre.classList.toggle('is-wrapped');
            wrapBtn.classList.toggle('active', isWrapped);
            wrapBtn.title = isWrapped ? 'Disable line wrap' : 'Toggle line wrap';
          });
        }

        const copyBtn = header.querySelector('.kyana-copy-code-btn');
        if (copyBtn) {
          copyBtn.addEventListener('click', () => {
            const codeToCopy = codeBlock.dataset.rawCode || codeBlock.innerText;
            navigator.clipboard.writeText(codeToCopy).then(() => {
              copyBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              `;
              copyBtn.classList.add('copied');
              setTimeout(() => {
                copyBtn.innerHTML = `
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                `;
                copyBtn.classList.remove('copied');
              }, 2000);
            });
          });
        }

        const previewBtn = header.querySelector('.kyana-preview-code-btn');
        if (previewBtn) {
          previewBtn.addEventListener('click', () => {
            toggleCodePreview(wrap, codeBlock, langKey);
          });
        }

        const runBtn = header.querySelector('.kyana-run-compiler-btn');
        if (runBtn) {
          runBtn.addEventListener('click', () => {
            try {
              sessionStorage.setItem('pendingCompilerCode', JSON.stringify({
                code: codeBlock.dataset.rawCode || codeBlock.innerText,
                lang: langKey
              }));
              window.location.href = 'compiler.html';
            } catch (_) {}
          });
        }

        pre.className = 'kyana-code-pre';
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(header);
        wrap.appendChild(pre);
      });
    }
  };

  // Markdown Formatter with KaTeX & Streaming Stabilization
  function renderFormattedContent(element, rawMarkdown, streaming = false) {
    if (!element) return;
    const prepared = streaming ? stabilizeStreamingMarkdown(rawMarkdown) : rawMarkdown;
    const normalized = normalizeLatexDelimiters(prepared);
    if (window.marked && typeof window.marked.parse === 'function' &&
        window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
      element.innerHTML = window.DOMPurify.sanitize(window.marked.parse(normalized), {
        ADD_ATTR: ['target', 'rel'],
        FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button'],
        FORBID_ATTR: ['style']
      });
    } else {
      element.innerHTML = fallbackMarkdown(normalized);
    }

    assertAndCleanPlaceholders(element);

    element.querySelectorAll('a[target="_blank"]').forEach(link => { link.rel = 'noopener noreferrer'; });

    if (streaming) return;

    KyanaCodeBlock.enhance(element);
    assertAndCleanPlaceholders(element);

    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(element, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false }
          ],
          throwOnError: false
        });
      } catch (_) {}
    }

    assertAndCleanPlaceholders(element);
  }

  // KyanaSourceCard Component (Strict Monochrome, No Gradients)
  const KyanaSourceCard = {
    renderSources(container, data) {
      const resourceCards = Array.isArray(data.resourceCards) ? data.resourceCards : [];
      const files = Array.isArray(data.matchedFiles) ? data.matchedFiles : [];
      const courses = Array.isArray(data.matchedCourses) ? data.matchedCourses : [];
      const routines = Array.isArray(data.matchedRoutine) ? data.matchedRoutine : [];
      const webSources = Array.isArray(data.webSources) ? data.webSources.filter(s => s && safeLink(s.url, true)) : [];

      if (!resourceCards.length && !files.length && !courses.length && !routines.length && !webSources.length) return;

      const wrap = document.createElement('div');
      wrap.className = 'kyana-sources-wrap';
      wrap.innerHTML = `
        <div class="kyana-sources-heading">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
          <span>${resourceCards.length ? 'Interactive Resources' : 'Sources & References'}</span>
        </div>
        <div class="kyana-sources-list"></div>
      `;
      const list = wrap.querySelector('.kyana-sources-list');

      // 0. Primary Native Resource Cards
      if (resourceCards.length) {
        resourceCards.forEach(card => {
          const el = document.createElement('a');
          el.className = 'kyana-source-card';
          el.href = ['note','post','notice','assignment','post_assignment','routine'].includes(card.type) && /^\d+$/.test(String(card.id)) ? `/api/ai/resources/${card.type}/${card.id}/open` : '#';
          if (card.action === 'open_note' || card.type === 'note') {
            el.target = '_blank';
            el.rel = 'noopener noreferrer';
          }
          const iconType = {
            note: 'NOTE',
            routine: 'EXAM',
            notice: 'NOTIF',
            post: 'FEED',
            assignment: 'TASK'
          }[card.type] || 'DOC';
          const actionText = {
            open_note: 'Open Notes',
            view_routine: 'View Routine',
            view_notice: 'View Notice',
            view_post: 'Open Post',
            view_assignment: 'Open Assignment'
          }[card.action] || 'Open';
          const meta = [card.subject, card.semester ? `Sem ${card.semester}` : '', actionText].filter(Boolean).join(' · ');
          el.innerHTML = `
            <div class="kyana-source-left">
              <div class="kyana-source-icon">${escapeHtml(iconType)}</div>
              <div class="kyana-source-info">
                <span class="kyana-source-title">${escapeHtml(card.title || 'Resource')}</span>
                <span class="kyana-source-meta">${escapeHtml(meta)}</span>
              </div>
            </div>
            <span class="kyana-source-arrow" aria-hidden="true">&rarr;</span>
          `;
          list.appendChild(el);
        });
      } else {
        // Fallback: Files
        files.forEach(f => {
          const card = document.createElement('a');
          card.className = 'kyana-source-card';
          const rawCardUrl = `/api/files/${encodeURIComponent(f.id)}/view`;
          card.href = window.SemesterAuth && typeof window.SemesterAuth.attachAuthTokenToUrl === 'function'
            ? window.SemesterAuth.attachAuthTokenToUrl(rawCardUrl)
            : rawCardUrl;
          card.target = '_blank';
          card.rel = 'noopener noreferrer';
          const ext = ((f.originalName || f.title || '').split('.').pop() || 'doc').toUpperCase().slice(0, 4);
          const meta = [f.subject || 'Study Notes', f.chapter ? `Ch. ${f.chapter}` : '', f.semester ? `Sem ${f.semester}` : ''].filter(Boolean).join(' · ');
          card.innerHTML = `
            <div class="kyana-source-left">
              <div class="kyana-source-icon">${escapeHtml(ext)}</div>
              <div class="kyana-source-info">
                <span class="kyana-source-title">${escapeHtml(f.title || f.originalName || 'Study Material')}</span>
                <span class="kyana-source-meta">${escapeHtml(meta)}</span>
              </div>
            </div>
            <span class="kyana-source-arrow" aria-hidden="true">&rarr;</span>
          `;
          list.appendChild(card);
        });

        // Fallback: Syllabus
        courses.forEach(c => {
          const card = document.createElement('a');
          card.className = 'kyana-source-card';
          const courseKey = c.code ? `${c.code}-${c.title}` : c.title;
          card.href = `syllabus.html#${encodeURIComponent(c.year || 'Year 1')}/${encodeURIComponent(c.semester)}/${encodeURIComponent(courseKey)}`;
          const meta = [`Semester ${c.semester}`, `${c.credit} Credits`, c.nature || 'Curriculum'].filter(Boolean).join(' · ');
          card.innerHTML = `
            <div class="kyana-source-left">
              <div class="kyana-source-icon">SYL</div>
              <div class="kyana-source-info">
                <span class="kyana-source-title">${escapeHtml(c.title)}</span>
                <span class="kyana-source-meta">${escapeHtml(meta)}</span>
              </div>
            </div>
            <span class="kyana-source-arrow" aria-hidden="true">&rarr;</span>
          `;
          list.appendChild(card);
        });

        // Fallback: Routine
        routines.forEach(r => {
          const card = document.createElement('a');
          card.className = 'kyana-source-card';
          card.href = `routine.html?semester=${encodeURIComponent(r.semester)}`;
          const meta = [`Semester ${r.semester}`, r.date, r.time, r.room ? `Room ${r.room}` : ''].filter(Boolean).join(' · ');
          card.innerHTML = `
            <div class="kyana-source-left">
              <div class="kyana-source-icon">EXAM</div>
              <div class="kyana-source-info">
                <span class="kyana-source-title">${escapeHtml(r.subject)}</span>
                <span class="kyana-source-meta">${escapeHtml(meta)}</span>
              </div>
            </div>
            <span class="kyana-source-arrow" aria-hidden="true">&rarr;</span>
          `;
          list.appendChild(card);
        });
      }

      // Web Sources
      webSources.forEach(s => {
        const card = document.createElement('a');
        card.className = 'kyana-source-card';
        card.href = s.url;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
        card.innerHTML = `
          <div class="kyana-source-left">
            <div class="kyana-source-icon">WEB</div>
            <div class="kyana-source-info">
              <span class="kyana-source-title">${escapeHtml(s.title || s.domain || 'Web Source')}</span>
              <span class="kyana-source-meta">${escapeHtml(s.domain || 'External citation')}</span>
            </div>
          </div>
          <span class="kyana-source-arrow" aria-hidden="true">&rarr;</span>
        `;
        list.appendChild(card);
      });

      container.appendChild(wrap);
    }
  };

  // KyanaResponseActions Component with Subtle Single-Pass Completion Shimmer
  const KyanaResponseActions = {
    render(container, textToCopy, onRegenerate, isFreshComplete = false) {
      const actions = document.createElement('div');
      actions.className = 'kyana-response-actions' + (isFreshComplete ? ' kyana-completion-pulse' : '');
      actions.innerHTML = `
        <button type="button" class="kyana-action-btn kyana-copy-btn" title="Copy response">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>Copy</span>
        </button>
        <button type="button" class="kyana-action-btn kyana-helpful-btn" title="Good response">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
          </svg>
        </button>
        <button type="button" class="kyana-action-btn kyana-unhelpful-btn" title="Bad response">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>
          </svg>
        </button>
        ${onRegenerate ? `
        <button type="button" class="kyana-action-btn kyana-regen-btn" title="Regenerate response">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
          <span>Regenerate</span>
        </button>` : ''}
      `;

      const copyBtn = actions.querySelector('.kyana-copy-btn');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(textToCopy).then(() => {
          copyBtn.innerHTML = `<span>✓ Copied!</span>`;
          setTimeout(() => {
            copyBtn.innerHTML = `
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>Copy</span>
            `;
          }, 2000);
        });
      });

      const helpfulBtn = actions.querySelector('.kyana-helpful-btn');
      helpfulBtn.addEventListener('click', () => {
        helpfulBtn.classList.toggle('active');
        actions.querySelector('.kyana-unhelpful-btn').classList.remove('active');
      });

      const unhelpfulBtn = actions.querySelector('.kyana-unhelpful-btn');
      unhelpfulBtn.addEventListener('click', () => {
        unhelpfulBtn.classList.toggle('active');
        actions.querySelector('.kyana-helpful-btn').classList.remove('active');
      });

      const regenBtn = actions.querySelector('.kyana-regen-btn');
      if (regenBtn && onRegenerate) {
        regenBtn.addEventListener('click', onRegenerate);
      }

      container.appendChild(actions);
    }
  };

  // KyanaInteractiveActions Component (Reusable Quick Replies, Next-Step Buttons & Interactive MCQs)
  const KyanaInteractiveActions = {
    async execute(actionReq) {
      const headers = { 'Content-Type': 'application/json' };
      try {
        const token = window.SemesterAuth?.getAccessToken?.();
        if (token) headers['Authorization'] = 'Bearer ' + token;
      } catch (_) {}
      const res = await fetch('/api/ai/actions', {
        method: 'POST',
        headers,
        body: JSON.stringify(actionReq)
      });
      if (res.status === 401) return { unauthenticated: true };
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Could not execute action.');
      return data;
    },

    render(container, msg) {
      if (!container || !msg) return;
      const hasMcq = Boolean(msg.interactiveQuestion && Array.isArray(msg.interactiveQuestion.options));
      const hasActions = Boolean(msg.messageActions && Array.isArray(msg.messageActions.actions) && msg.messageActions.actions.length > 0);
      if (!hasMcq && !hasActions) return;
      if (hasMcq) this.renderMcqCard(container, msg);
      if (hasActions) this.renderActionButtons(container, msg);
    },

    renderMcqCard(container, msg) {
      const q = msg.interactiveQuestion;
      const existing = container.querySelector('.kyana-mcq-card');
      if (existing) existing.remove();

      const card = document.createElement('div');
      card.className = 'kyana-mcq-card';

      const header = document.createElement('div');
      header.className = 'kyana-mcq-header';
      header.textContent = 'CHECKPOINT QUIZ';
      card.appendChild(header);

      const qEl = document.createElement('div');
      qEl.className = 'kyana-mcq-question';
      qEl.textContent = q.question || '';
      card.appendChild(qEl);

      const optsWrap = document.createElement('div');
      optsWrap.className = 'kyana-mcq-options';

      (q.options || []).forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kyana-mcq-option';
        btn.disabled = Boolean(q.submitted);

        const optId = String(opt.id || '').toUpperCase();
        const isSelected = q.submitted && String(q.selectedOptionId || '').toUpperCase() === optId;
        const isCorrectOpt = q.submitted && String(q.correctOptionId || '').toUpperCase() === optId;

        if (isSelected) btn.classList.add('selected');
        if (q.submitted && isCorrectOpt) btn.classList.add('is-correct');
        else if (isSelected && q.isCorrect === false) btn.classList.add('is-incorrect');

        let statusLabel = '';
        if (q.submitted) {
          if (isCorrectOpt) statusLabel = '✓ Correct';
          else if (isSelected && q.isCorrect === false) statusLabel = '✕ Selected';
        }

        btn.innerHTML = `
          <span class="kyana-mcq-option-badge">${escapeHtml(optId)}</span>
          <span class="kyana-mcq-option-text">${escapeHtml(opt.text || '')}</span>
          ${statusLabel ? `<span class="kyana-mcq-option-status">${escapeHtml(statusLabel)}</span>` : ''}
        `;

        if (!q.submitted) {
          btn.addEventListener('click', async () => {
            if (isSending || q.submitted) return;
            const allBtns = optsWrap.querySelectorAll('.kyana-mcq-option');
            allBtns.forEach((b) => { b.disabled = true; });
            btn.classList.add('selected');

            try {
              const resData = await this.execute({
                action: 'submit_mcq_answer',
                actionType: 'multiple_choice',
                conversationId: activeSession?.id || null,
                payload: {
                  messageId: msg.id || null,
                  questionId: q.id,
                  optionId: optId,
                  ...(q.sessionId ? { sessionId: q.sessionId } : {})
                }
              });

              if (resData.unauthenticated) {
                handleSend(optId);
                return;
              }

              if (resData.interactiveQuestion) {
                msg.interactiveQuestion = resData.interactiveQuestion;
              }
              this.renderMcqCard(container, msg);

              if (resData.reply && activeSession) {
                const userRow = KyanaUserMessage.create(`Selected option ${optId}: ${opt.text}`);
                messagesListEl.appendChild(userRow);
                activeSession.messages.push({ role: 'user', content: `Selected option ${optId}: ${opt.text}`, timestamp: Date.now() });

                const assistantMsg = {
                  id: resData.id || null,
                  role: 'assistant',
                  content: resData.reply,
                  messageActions: resData.messageActions || null,
                  timestamp: Date.now()
                };
                activeSession.messages.push(assistantMsg);
                SessionStore.update(activeSession);

                const respRow = KyanaResponse.create();
                const respDoc = respRow.querySelector('.kyana-response-doc');
                renderFormattedContent(respDoc, assistantMsg.content);
                this.render(respDoc, assistantMsg);
                KyanaResponseActions.render(respDoc, assistantMsg.content, () => handleRegenerate(), true);
                messagesListEl.appendChild(respRow);
                scrollToBottom(true);
              }
            } catch (err) {
              allBtns.forEach((b) => { b.disabled = false; });
              btn.classList.remove('selected');
              const errNote = document.createElement('div');
              errNote.className = 'kyana-mcq-feedback';
              errNote.textContent = err.message || 'Could not submit answer. Please try again.';
              card.appendChild(errNote);
            }
          });
        }

        optsWrap.appendChild(btn);
      });

      card.appendChild(optsWrap);

      if (q.submitted && q.feedback) {
        const fbEl = document.createElement('div');
        fbEl.className = 'kyana-mcq-feedback';
        fbEl.textContent = q.feedback;
        card.appendChild(fbEl);
      }

      const anchor = container.querySelector('.kyana-msg-actions-row') || container.querySelector('.kyana-response-actions');
      if (anchor) container.insertBefore(card, anchor);
      else container.appendChild(card);
    },

    renderActionButtons(container, msg) {
      const existing = container.querySelector('.kyana-msg-actions-row');
      if (existing) existing.remove();

      const row = document.createElement('div');
      row.className = 'kyana-msg-actions-row';

      (msg.messageActions.actions || []).forEach((act) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kyana-msg-action-btn' + (act.actionType === 'next_step' ? ' is-primary' : '');
        btn.textContent = act.label || 'Continue';
        btn.dataset.action = act.action || '';

        btn.addEventListener('click', async () => {
          if (isSending) return;

          if (act.actionType === 'navigation' && act.payload && act.payload.url) {
            const targetUrl = safeLink(act.payload.url);
            if (targetUrl) { window.location.href = targetUrl; return; }
          }

          const allActionBtns = row.querySelectorAll('.kyana-msg-action-btn');
          allActionBtns.forEach((b) => { b.disabled = true; });
          btn.classList.add('is-loading');

          const displayLabel = act.label || act.action;
          const fallbackPrompt = (act.payload && act.payload.prompt) ? act.payload.prompt : displayLabel;

          try {
            if (!activeSession) {
              activeSession = SessionStore.create(displayLabel);
              renderHistoryList();
            }

            const userRow = KyanaUserMessage.create(displayLabel);
            messagesListEl.appendChild(userRow);
            activeSession.messages.push({ role: 'user', content: displayLabel, timestamp: Date.now() });
            SessionStore.update(activeSession);
            scrollToBottom(true);
            setGeneratingState(true);
            showThinkingIndicator();

            const resData = await this.execute({
              action: act.action,
              actionType: act.actionType,
              conversationId: activeSession?.id || null,
              payload: act.payload || {}
            });

            removeThinkingIndicator();
            setGeneratingState(false);

            if (resData.unauthenticated) {
              allActionBtns.forEach((b) => { b.disabled = false; });
              btn.classList.remove('is-loading');
              if (userRow.parentNode) userRow.remove();
              activeSession.messages.pop();
              handleSend(fallbackPrompt);
              return;
            }

            if (resData.navigateTo) {
              const targetUrl = safeLink(resData.navigateTo);
              if (targetUrl) { window.location.href = targetUrl; return; }
            }

            if (resData.conversationId && activeSession.id !== resData.conversationId) {
              activeSession.id = resData.conversationId;
            }

            const assistantMsg = {
              id: resData.id || null,
              role: 'assistant',
              content: resData.reply || '',
              resourceCards: resData.resourceCards,
              matchedFiles: resData.matchedFiles,
              matchedCourses: resData.matchedCourses,
              matchedRoutine: resData.matchedRoutine,
              webSources: resData.webSources,
              messageActions: resData.messageActions || null,
              interactiveQuestion: resData.interactiveQuestion || null,
              timestamp: Date.now()
            };

            const respRow = KyanaResponse.create();
            const respDoc = respRow.querySelector('.kyana-response-doc');
            renderFormattedContent(respDoc, assistantMsg.content);
            KyanaSourceCard.renderSources(respDoc, assistantMsg);
            this.render(respDoc, assistantMsg);
            KyanaResponseActions.render(respDoc, assistantMsg.content, () => handleRegenerate(), true);
            messagesListEl.appendChild(respRow);

            activeSession.messages.push(assistantMsg);
            SessionStore.update(activeSession);
            renderHistoryList();
            scrollToBottom(true);
          } catch (err) {
            removeThinkingIndicator();
            setGeneratingState(false);
            const errRow = KyanaResponse.create();
            const errDoc = errRow.querySelector('.kyana-response-doc');
            errDoc.appendChild(KyanaErrorState.create(err.message || 'Could not complete action.', null));
            messagesListEl.appendChild(errRow);
            scrollToBottom(true);
          } finally {
            allActionBtns.forEach((b) => { b.disabled = false; });
            btn.classList.remove('is-loading');
          }
        });

        row.appendChild(btn);
      });

      const anchor = container.querySelector('.kyana-response-actions');
      if (anchor) container.insertBefore(row, anchor);
      else container.appendChild(row);
    }
  };

  // KyanaUserMessage Component (Strict Monochrome Dark Gray Bubble)
  const KyanaUserMessage = {
    create(text) {
      const row = document.createElement('div');
      row.className = 'kyana-user-row';
      const bubble = document.createElement('div');
      bubble.className = 'kyana-user-bubble';
      bubble.textContent = text;
      row.appendChild(bubble);
      return row;
    }
  };

  // KyanaResponse Component (Clean Typography — No Redundant Header)
  const KyanaResponse = {
    create() {
      const row = document.createElement('div');
      row.className = 'kyana-response-row';
      row.innerHTML = `<div class="kyana-response-doc"></div>`;
      return row;
    }
  };

  // KyanaLogo Component (Official Monochrome Glass-Ribbon Identity)
  const KyanaLogo = {
    render({ size = 28, animated = false, thinking = false, className = '', alt = 'Kyana AI' } = {}) {
      let src = '/images/kyana-mono-header.png';
      if (size >= 64) {
        src = '/images/kyana-mono-hero.png';
      } else if (thinking || size <= 28) {
        src = '/images/kyana-mono-thinking.png';
      }

      const classes = [
        'kyana-logo-comp',
        thinking ? 'kyana-logo-thinking' : '',
        animated ? 'kyana-logo-animated' : '',
        className
      ].filter(Boolean).join(' ');

      return `
        <span class="${classes}" style="width: ${size}px; height: ${size}px;" role="img" aria-label="${escapeHtml(alt)}">
          <span class="kyana-logo-aura" aria-hidden="true"></span>
          <span class="kyana-logo-glass-frame">
            <img class="kyana-logo-img" src="${src}" alt="${escapeHtml(alt)}" width="${size}" height="${size}" />
            <span class="kyana-logo-highlight-sweep" aria-hidden="true"></span>
          </span>
        </span>
      `.trim();
    },

    create({ size = 28, animated = false, thinking = false, className = '', alt = 'Kyana AI' } = {}) {
      const container = document.createElement('div');
      container.innerHTML = this.render({ size, animated, thinking, className, alt });
      return container.firstElementChild;
    }
  };

  // KyanaThinking Component (Monochrome Living Glass Logo + Minimal Status Text)
  const KyanaThinking = {
    create() {
      const wrap = document.createElement('div');
      wrap.className = 'kyana-thinking-wrap';
      wrap.id = 'kyanaThinkingIndicator';
      wrap.innerHTML = `
        <div class="kyana-thinking-mark-slot">
          ${KyanaLogo.render({ size: 24, thinking: true, alt: 'Kyana thinking' })}
        </div>
        <div class="kyana-thinking-status">
          <span>Kyana is thinking</span>
        </div>
      `;
      return wrap;
    }
  };

  // KyanaErrorState Component
  const KyanaErrorState = {
    create(message, onRetry) {
      const card = document.createElement('div');
      card.className = 'kyana-error-card';
      card.innerHTML = `
        <span>${escapeHtml(message || "Kyana couldn't complete that response.")}</span>
        ${onRetry ? `<button type="button" class="kyana-retry-btn">Try again</button>` : ''}
      `;
      if (onRetry) {
        card.querySelector('.kyana-retry-btn').addEventListener('click', onRetry);
      }
      return card;
    }
  };

  // --- 4. Conversation Sessions Storage & History Management ---
  const STORAGE_KEY = 'kyana_chat_sessions_v1';
  const ACTIVE_SESSION_KEY = 'kyana_active_session_id';

  let volatileSessions = [];
  let volatileActiveId = null;
  const SessionStore = {
    getAll() { return structuredClone(volatileSessions); },
    saveAll(sessions) { volatileSessions = structuredClone(sessions.slice(0, 50)); },
    getActiveId() { return volatileActiveId; },
    setActiveId(id) { volatileActiveId = id || null; },
    get(id) {
      return this.getAll().find(s => s.id === id);
    },
    create(initialPrompt = '') {
      const id = 'chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const title = initialPrompt ? (initialPrompt.length > 36 ? initialPrompt.substring(0, 36) + '…' : initialPrompt) : 'New conversation';
      const session = {
        id,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
      };
      const all = this.getAll();
      all.unshift(session);
      this.saveAll(all);
      this.setActiveId(id);
      return session;
    },
    update(session) {
      const all = this.getAll();
      const idx = all.findIndex(s => s.id === session.id);
      if (idx >= 0) {
        session.updatedAt = Date.now();
        all[idx] = session;
        all.sort((a, b) => b.updatedAt - a.updatedAt);
        this.saveAll(all);
      }
    },
    delete(id) {
      const all = this.getAll().filter(s => s.id !== id);
      this.saveAll(all);
      if (this.getActiveId() === id) {
        this.setActiveId(all[0] ? all[0].id : null);
      }
    },
    rename(id, newTitle) {
      const all = this.getAll();
      const session = all.find(s => s.id === id);
      if (session) {
        session.title = newTitle.trim() || 'Untitled';
        this.saveAll(all);
      }
    }
  };

  // Grouping helper
  function groupSessionsByDate(sessions) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOf7Days = startOfToday - 86400000 * 7;

    const groups = {
      today: [],
      yesterday: [],
      previous7Days: [],
      older: []
    };

    sessions.forEach(s => {
      const t = s.updatedAt || s.createdAt || 0;
      if (t >= startOfToday) groups.today.push(s);
      else if (t >= startOfYesterday) groups.yesterday.push(s);
      else if (t >= startOf7Days) groups.previous7Days.push(s);
      else groups.older.push(s);
    });

    return groups;
  }

  // --- 5. Main UI Controller ---

  let activeSession = null;
  let activeRequest = null;
  let isSending = false;
  let userHasScrolledUp = false;

  // DOM Elements
  const appEl = document.getElementById('kyanaApp');
  const sidebarEl = document.getElementById('kyanaSidebar');
  const sidebarCloseBtn = document.getElementById('kyanaSidebarCloseBtn');
  const sidebarOpenBtn = document.getElementById('kyanaSidebarOpenBtn');
  const drawerBackdrop = document.getElementById('kyanaDrawerBackdrop');
  const newChatBtn = document.getElementById('kyanaNewChatBtn');
  const headerNewChatBtn = document.getElementById('kyanaHeaderNewChatBtn');
  const historySearchInput = document.getElementById('kyanaHistorySearchInput');
  const searchClearBtn = document.getElementById('kyanaSearchClearBtn');
  const historyListEl = document.getElementById('kyanaSidebarHistory');
  const viewportEl = document.getElementById('kyanaViewport');
  const welcomeHeroEl = document.getElementById('kyanaWelcomeHero');
  const messagesListEl = document.getElementById('kyanaMessagesList');
  const scrollBottomBtn = document.getElementById('kyanaScrollBottomBtn');
  const composerContainer = document.getElementById('kyanaComposerContainer');
  const composerForm = document.getElementById('kyanaComposerForm');
  const chatInput = document.getElementById('kyanaInput');
  const submitBtn = document.getElementById('kyanaSubmitBtn');
  const attachBtn = document.getElementById('kyanaAttachBtn');
  const attachPopover = document.getElementById('kyanaAttachPopover');
  const renameModal = document.getElementById('kyanaRenameModal');
  const deleteModal = document.getElementById('kyanaDeleteModal');
  const themeToggleBtn = document.getElementById('kyanaThemeToggleBtn');

  // --- 6. Scroll Management & User Scroll Detection ---

  function isAtBottom(tolerance = 80) {
    if (!viewportEl) return true;
    return (viewportEl.scrollHeight - viewportEl.scrollTop - viewportEl.clientHeight) <= tolerance;
  }

  function scrollToBottom(smooth = false) {
    if (!viewportEl) return;
    viewportEl.scrollTo({
      top: viewportEl.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
    userHasScrolledUp = false;
    updateScrollButton();
  }

  function updateScrollButton() {
    if (!scrollBottomBtn) return;
    if (appEl && appEl.classList.contains('is-empty')) {
      scrollBottomBtn.classList.remove('visible');
      return;
    }
    const shouldShow = userHasScrolledUp && (viewportEl.scrollHeight > viewportEl.clientHeight + 100);
    scrollBottomBtn.classList.toggle('visible', shouldShow);
  }

  if (viewportEl) {
    viewportEl.addEventListener('scroll', () => {
      userHasScrolledUp = !isAtBottom();
      updateScrollButton();
    });
  }

  if (scrollBottomBtn) {
    scrollBottomBtn.addEventListener('click', () => {
      scrollToBottom(true);
    });
  }

  // --- 7. Sidebar & Mobile Drawer Toggles ---

  function setSidebarOpen(open) {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      appEl.classList.toggle('sidebar-open', open);
    } else {
      appEl.classList.toggle('sidebar-collapsed', !open);
    }
  }

  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', () => setSidebarOpen(false));
  if (sidebarOpenBtn) sidebarOpenBtn.addEventListener('click', () => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) setSidebarOpen(true);
    else setSidebarOpen(appEl.classList.contains('sidebar-collapsed'));
  });
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', () => setSidebarOpen(false));

  // --- 8. Theme Toggle Integration ---
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      if (typeof window.toggleTheme === 'function') {
        window.toggleTheme();
      } else {
        const curr = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = curr === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        document.body.classList.toggle('dark-mode', next === 'dark');
        try { localStorage.setItem('theme', next); } catch (_) {}
      }
    });
  }

  // --- 9. Composer Auto-Resizing & Enter Handling ---

  function adjustTextareaHeight() {
    if (!chatInput) return;
    chatInput.style.height = 'auto';
    const newHeight = Math.min(chatInput.scrollHeight, 160);
    chatInput.style.height = `${Math.max(newHeight, 24)}px`;

    const hasText = Boolean(chatInput.value.trim());
    if (submitBtn && !isSending) {
      submitBtn.disabled = !hasText;
      submitBtn.classList.toggle('active', hasText);
    }
  }

  if (chatInput) {
    chatInput.addEventListener('input', adjustTextareaHeight);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!isSending) handleSend();
      }
    });
  }

  // Attach quick prompts popover toggle
  if (attachBtn && attachPopover) {
    attachBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = attachPopover.style.display !== 'none';
      attachPopover.style.display = isVisible ? 'none' : 'block';
    });

    document.addEventListener('click', (e) => {
      if (!attachPopover.contains(e.target) && e.target !== attachBtn) {
        attachPopover.style.display = 'none';
      }
    });

    attachPopover.querySelectorAll('.kyana-popover-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        let prompt = '';
        if (action === 'notes') prompt = 'Find study notes for ';
        else if (action === 'routine') prompt = 'Show exam routine for ';
        else if (action === 'syllabus') prompt = 'What is the syllabus for ';
        else if (action === 'questions') prompt = 'Find past questions for ';
        if (prompt && chatInput) {
          chatInput.value = prompt;
          chatInput.focus();
          chatInput.setSelectionRange(prompt.length, prompt.length);
          adjustTextareaHeight();
        }
        attachPopover.style.display = 'none';
      });
    });
  }

  // --- 10. Sidebar History Renderer (Strict Monochrome) ---

  let historyFilter = '';

  function renderHistoryList() {
    if (!historyListEl) return;
    const all = SessionStore.getAll();
    const filtered = historyFilter
      ? all.filter(s => s.title.toLowerCase().includes(historyFilter.toLowerCase()))
      : all;

    if (!filtered.length) {
      historyListEl.innerHTML = `
        <div class="kyana-history-empty">
          <span>${historyFilter ? 'No matching conversations' : 'No conversations yet'}</span>
        </div>
      `;
      return;
    }

    const groups = groupSessionsByDate(filtered);
    const groupDefs = [
      { key: 'today', label: 'TODAY', items: groups.today },
      { key: 'yesterday', label: 'YESTERDAY', items: groups.yesterday },
      { key: 'previous7Days', label: 'PREVIOUS 7 DAYS', items: groups.previous7Days },
      { key: 'older', label: 'OLDER', items: groups.older }
    ];

    historyListEl.innerHTML = '';
    const activeId = activeSession ? activeSession.id : null;

    groupDefs.forEach(g => {
      if (!g.items.length) return;
      const groupEl = document.createElement('div');
      groupEl.className = 'kyana-history-group';
      groupEl.innerHTML = `<div class="kyana-group-label">${escapeHtml(g.label)}</div>`;

      g.items.forEach(s => {
        const itemEl = document.createElement('div');
        itemEl.className = 'kyana-history-item' + (s.id === activeId ? ' active' : '');
        itemEl.dataset.id = s.id;
        itemEl.innerHTML = `
          <span class="kyana-history-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</span>
          <button type="button" class="kyana-item-menu-btn" title="Options" aria-label="Conversation options">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <circle cx="12" cy="12" r="1.5"></circle>
              <circle cx="6" cy="12" r="1.5"></circle>
              <circle cx="18" cy="12" r="1.5"></circle>
            </svg>
          </button>
        `;

        itemEl.addEventListener('click', (e) => {
          if (e.target.closest('.kyana-item-menu-btn')) return;
          loadSession(s.id);
          if (window.innerWidth <= 768) setSidebarOpen(false);
        });

        const menuBtn = itemEl.querySelector('.kyana-item-menu-btn');
        menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showSessionMenu(s, menuBtn);
        });

        groupEl.appendChild(itemEl);
      });

      historyListEl.appendChild(groupEl);
    });
  }

  // Overflow Session Menu (Rename / Delete)
  let activeMenuEl = null;
  function showSessionMenu(session, triggerBtn) {
    if (activeMenuEl) activeMenuEl.remove();

    const menu = document.createElement('div');
    menu.className = 'kyana-attach-popover';
    menu.style.position = 'fixed';
    const rect = triggerBtn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 200)}px`;
    menu.style.zIndex = '2000';

    menu.innerHTML = `
      <button type="button" class="kyana-popover-item kyana-menu-rename">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
        </svg>
        <span>Rename</span>
      </button>
      <button type="button" class="kyana-popover-item kyana-menu-delete" style="color: #ef4444;">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>Delete</span>
      </button>
    `;

    document.body.appendChild(menu);
    activeMenuEl = menu;

    menu.querySelector('.kyana-menu-rename').addEventListener('click', () => {
      menu.remove();
      promptRename(session);
    });

    menu.querySelector('.kyana-menu-delete').addEventListener('click', () => {
      menu.remove();
      promptDelete(session);
    });

    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== triggerBtn) {
        menu.remove();
        activeMenuEl = null;
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  // Rename Dialog
  function promptRename(session) {
    if (!renameModal) return;
    const input = document.getElementById('kyanaRenameInput');
    const confirmBtn = document.getElementById('kyanaRenameConfirmBtn');
    const cancelBtn = document.getElementById('kyanaRenameCancelBtn');
    if (input) input.value = session.title;
    renameModal.style.display = 'flex';
    if (input) {
      input.focus();
      input.select();
    }

    const close = () => { renameModal.style.display = 'none'; };
    cancelBtn.onclick = close;
    confirmBtn.onclick = () => {
      const val = (input.value || '').trim();
      if (val) {
        SessionStore.rename(session.id, val);
        if (activeSession && activeSession.id === session.id) {
          activeSession.title = val;
        }
        renderHistoryList();
      }
      close();
    };
  }

  // Delete Dialog
  function promptDelete(session) {
    if (!deleteModal) return;
    const confirmBtn = document.getElementById('kyanaDeleteConfirmBtn');
    const cancelBtn = document.getElementById('kyanaDeleteCancelBtn');
    deleteModal.style.display = 'flex';

    const close = () => { deleteModal.style.display = 'none'; };
    cancelBtn.onclick = close;
    confirmBtn.onclick = () => {
      SessionStore.delete(session.id);
      if (activeSession && activeSession.id === session.id) {
        startNewChat();
      } else {
        renderHistoryList();
      }
      close();
    };
  }

  // Search filter listener
  if (historySearchInput) {
    historySearchInput.addEventListener('input', (e) => {
      historyFilter = (e.target.value || '').trim();
      if (searchClearBtn) searchClearBtn.style.display = historyFilter ? 'flex' : 'none';
      renderHistoryList();
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      historySearchInput.value = '';
      historyFilter = '';
      searchClearBtn.style.display = 'none';
      renderHistoryList();
      historySearchInput.focus();
    });
  }

  // --- 11. Conversation Session Loader & Messages Viewport ---

  function setConversationState(hasMessages, animateTransition = false) {
    if (!appEl) return;
    if (hasMessages) {
      if (animateTransition && appEl.classList.contains('is-empty')) {
        // FLIP transition on composer
        const capsule = composerForm;
        const firstRect = capsule ? capsule.getBoundingClientRect() : null;

        appEl.classList.remove('is-empty');
        appEl.classList.add('has-messages');

        if (welcomeHeroEl) {
          welcomeHeroEl.classList.add('fade-out');
        }

        if (capsule && firstRect) {
          const lastRect = capsule.getBoundingClientRect();
          const deltaY = firstRect.top - lastRect.top;
          capsule.style.transition = 'none';
          capsule.style.transform = `translateY(${deltaY}px)`;

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              capsule.style.transition = 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)';
              capsule.style.transform = 'translateY(0)';

              const cleanup = () => {
                capsule.style.transition = '';
                capsule.style.transform = '';
                capsule.removeEventListener('transitionend', cleanup);
                if (welcomeHeroEl) {
                  welcomeHeroEl.style.display = 'none';
                  welcomeHeroEl.classList.remove('fade-out');
                }
              };
              capsule.addEventListener('transitionend', cleanup, { once: true });
            });
          });
        } else if (welcomeHeroEl) {
          setTimeout(() => {
            welcomeHeroEl.style.display = 'none';
            welcomeHeroEl.classList.remove('fade-out');
          }, 220);
        }
      } else {
        appEl.classList.remove('is-empty');
        appEl.classList.add('has-messages');
        if (welcomeHeroEl) {
          welcomeHeroEl.style.display = 'none';
          welcomeHeroEl.classList.remove('fade-out');
        }
      }
    } else {
      appEl.classList.add('is-empty');
      appEl.classList.remove('has-messages');
      if (welcomeHeroEl) {
        welcomeHeroEl.style.display = 'flex';
        welcomeHeroEl.classList.remove('fade-out');
      }
      if (scrollBottomBtn) {
        scrollBottomBtn.classList.remove('visible');
      }
    }
  }

  function renderSessionMessages(session) {
    if (!messagesListEl) return;
    messagesListEl.innerHTML = '';

    if (!session || !session.messages || !session.messages.length) {
      setConversationState(false, false);
      return;
    }

    setConversationState(true, false);

    session.messages.forEach((msg, idx) => {
      if (msg.role === 'user') {
        const row = KyanaUserMessage.create(msg.content);
        messagesListEl.appendChild(row);
      } else if (msg.role === 'assistant') {
        const row = KyanaResponse.create();
        const doc = row.querySelector('.kyana-response-doc');
        renderFormattedContent(doc, msg.content || '');
        KyanaSourceCard.renderSources(doc, msg);
        KyanaInteractiveActions.render(doc, msg);
        KyanaResponseActions.render(doc, msg.content || '', idx === session.messages.length - 1 ? () => handleRegenerate() : null, false);
        messagesListEl.appendChild(row);
      }
    });

    scrollToBottom();
  }

  async function loadSession(id) {
    cancelActiveRequest();
    const session = SessionStore.get(id);
    if (session) {
      const headers = {};
      const token = window.SemesterAuth?.getAccessToken?.();
      if (token) headers.Authorization = 'Bearer ' + token;
      try {
        const res = await fetch('/api/ai/conversations/' + encodeURIComponent(id) + '/messages', { headers, cache: 'no-store' });
        if (!res.ok) throw new Error('Conversation unavailable');
        const data = await res.json();
        session.messages = (data.messages || []).map(m => ({ ...m.metadata, id: m.id, role: m.sender, content: m.text, timestamp: new Date(m.createdAt).getTime() }));
      } catch { session.messages = []; }
      SessionStore.update(session);
      activeSession = session;
      SessionStore.setActiveId(id);
      renderHistoryList();
      renderSessionMessages(session);
      if (chatInput) chatInput.focus();
    }
  }

  function startNewChat() {
    cancelActiveRequest();
    activeSession = null;
    SessionStore.setActiveId(null);
    renderHistoryList();
    if (messagesListEl) messagesListEl.innerHTML = '';
    setConversationState(false, false);
    if (chatInput) {
      chatInput.value = '';
      adjustTextareaHeight();
      chatInput.focus();
    }
    scrollToBottom();
  }

  if (newChatBtn) newChatBtn.addEventListener('click', startNewChat);
  if (headerNewChatBtn) headerNewChatBtn.addEventListener('click', startNewChat);

  // Suggestion card clicks delegate
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.kyana-suggestion-card');
    if (card && card.dataset.prompt) {
      handleSend(card.dataset.prompt);
    }
  });

  // --- 12. Message Submission & Streaming Execution ---

  function cancelActiveRequest() {
    if (!activeRequest) return;
    activeRequest.controller.abort();
    if (activeRequest.frame != null) cancelAnimationFrame(activeRequest.frame);
    clearTimeout(activeRequest.timeout);
    activeRequest = null;
    removeThinkingIndicator();
    setGeneratingState(false);
  }

  function setGeneratingState(generating) {
    isSending = generating;
    if (appEl) appEl.classList.toggle('is-generating', generating);
    if (!submitBtn) return;

    if (generating) {
      submitBtn.disabled = false;
      submitBtn.classList.add('generating');
      submitBtn.classList.remove('active');
      submitBtn.title = 'Stop generating';
      submitBtn.setAttribute('aria-label', 'Stop generating');
      submitBtn.querySelector('.kyana-send-icon').style.display = 'none';
      submitBtn.querySelector('.kyana-stop-icon').style.display = 'block';
    } else {
      submitBtn.classList.remove('generating');
      submitBtn.querySelector('.kyana-send-icon').style.display = 'block';
      submitBtn.querySelector('.kyana-stop-icon').style.display = 'none';
      submitBtn.title = 'Send message (Enter)';
      submitBtn.setAttribute('aria-label', 'Send message');
      adjustTextareaHeight();
    }
  }

  function showThinkingIndicator() {
    removeThinkingIndicator();
    const ind = KyanaThinking.create();
    messagesListEl.appendChild(ind);
    if (!userHasScrolledUp) scrollToBottom();
  }

  function removeThinkingIndicator() {
    const ind = document.getElementById('kyanaThinkingIndicator');
    if (ind) {
      ind.classList.add('fading');
      setTimeout(() => {
        if (ind && ind.parentNode) ind.remove();
      }, 140);
    }
  }

  async function handleSend(textToSend) {
    const query = (textToSend || (chatInput ? chatInput.value : '')).trim();
    if (!query) return;

    if (isSending) {
      cancelActiveRequest();
      return;
    }

    // Ensure session exists
    if (!activeSession) {
      activeSession = SessionStore.create(query);
      renderHistoryList();
    }

    setConversationState(true, true);

    // Clear input
    if (chatInput) {
      chatInput.value = '';
      adjustTextareaHeight();
    }

    // Append User Message to UI & Session
    const userRow = KyanaUserMessage.create(query);
    messagesListEl.appendChild(userRow);
    activeSession.messages.push({ role: 'user', content: query, timestamp: Date.now() });
    SessionStore.update(activeSession);
    renderHistoryList();
    scrollToBottom();

    setGeneratingState(true);
    showThinkingIndicator();

    const request = {
      controller: new AbortController(),
      frame: null,
      row: null,
      doc: null,
      partial: '',
      timedOut: false
    };
    activeRequest = request;

    request.timeout = setTimeout(() => {
      request.timedOut = true;
      request.controller.abort();
    }, 90000);

    const historyPayload = activeSession.messages.slice(-12).map(m => ({
      role: m.role,
      content: m.content.slice(0, 8000)
    }));

    const reqHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    };
    try {
      const token = window.SemesterAuth?.getAccessToken?.();
      if (token) reqHeaders['Authorization'] = `Bearer ${token}`;
    } catch (_) {}

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: reqHeaders,
        signal: request.controller.signal,
        body: JSON.stringify({
          message: query,
          history: historyPayload,
          stream: true,
          conversationId: activeSession?.id
        })
      });

      if (activeRequest !== request) return;

      if (response.status === 401) {
        removeThinkingIndicator();
        const errRow = KyanaResponse.create();
        const errDoc = errRow.querySelector('.kyana-response-doc');
        errDoc.innerHTML = `<p>Your session has expired. Please <a href="login.html">sign in again</a> to chat.</p>`;
        messagesListEl.appendChild(errRow);
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        removeThinkingIndicator();
        const safeMsg = response.status === 429
          ? (errorData?.message || 'Too many requests. Please wait a moment before sending more messages!')
          : (errorData.message || "Kyana couldn't complete that response.");
        const errRow = KyanaResponse.create();
        const errDoc = errRow.querySelector('.kyana-response-doc');
        errDoc.appendChild(KyanaErrorState.create(safeMsg, () => handleSend(query)));
        messagesListEl.appendChild(errRow);
        return;
      }

      // Read streaming SSE response
      const data = await readChatResponse(response, deltaText => {
        if (activeRequest !== request) return;
        request.partial += deltaText;

        if (!request.row) {
          removeThinkingIndicator();
          request.row = KyanaResponse.create();
          request.doc = request.row.querySelector('.kyana-response-doc');
          messagesListEl.appendChild(request.row);
        }

        if (request.frame == null) {
          request.frame = requestAnimationFrame(() => {
            request.frame = null;
            if (activeRequest !== request) return;
            renderFormattedContent(request.doc, request.partial, true);
            if (!userHasScrolledUp) scrollToBottom();
          });
        }
      });

      if (activeRequest !== request) return;

      removeThinkingIndicator();

      // Final complete render with syntax highlighting, sources, and response action tools
      if (!request.row) {
        request.row = KyanaResponse.create();
        request.doc = request.row.querySelector('.kyana-response-doc');
        messagesListEl.appendChild(request.row);
      }

      if (data.conversationId && activeSession.id !== data.conversationId) {
        activeSession.id = data.conversationId;
      }
      const assistantMsg = {
        id: data.id || null,
        role: 'assistant',
        content: data.reply || '',
        resourceCards: data.resourceCards,
        matchedFiles: data.matchedFiles,
        matchedCourses: data.matchedCourses,
        matchedRoutine: data.matchedRoutine,
        webSources: data.webSources,
        messageActions: data.messageActions || null,
        interactiveQuestion: data.interactiveQuestion || null,
        timestamp: Date.now()
      };

      request.doc.innerHTML = '';
      renderFormattedContent(request.doc, assistantMsg.content);
      KyanaSourceCard.renderSources(request.doc, assistantMsg);
      KyanaInteractiveActions.render(request.doc, assistantMsg);
      KyanaResponseActions.render(request.doc, assistantMsg.content, () => handleRegenerate(), true);

      // Save to session history
      activeSession.messages.push(assistantMsg);
      SessionStore.update(activeSession);
      renderHistoryList();
      if (!userHasScrolledUp) scrollToBottom();

    } catch (err) {
      if (activeRequest !== request) return;
      removeThinkingIndicator();

      const isOffline = !navigator.onLine;
      const errorMsg = isOffline
        ? "You're offline. Check your connection and try again."
        : (request.timedOut ? 'That request took too long. Try again.' : "Kyana couldn't complete that response.");

      if (request.partial && request.doc) {
        renderFormattedContent(request.doc, request.partial);
        request.doc.appendChild(KyanaErrorState.create(errorMsg, () => handleSend(query)));
      } else {
        const errRow = KyanaResponse.create();
        const errDoc = errRow.querySelector('.kyana-response-doc');
        errDoc.appendChild(KyanaErrorState.create(errorMsg, () => handleSend(query)));
        messagesListEl.appendChild(errRow);
      }
      scrollToBottom();
    } finally {
      clearTimeout(request.timeout);
      if (activeRequest === request) {
        if (request.frame != null) cancelAnimationFrame(request.frame);
        activeRequest = null;
        setGeneratingState(false);
        if (chatInput) chatInput.focus();
      }
    }
  }

  function handleRegenerate() {
    if (!activeSession || !activeSession.messages.length) return;
    const lastIdx = activeSession.messages.length - 1;
    if (activeSession.messages[lastIdx].role === 'assistant') {
      activeSession.messages.pop();
      const lastUser = activeSession.messages[activeSession.messages.length - 1];
      if (lastUser && lastUser.role === 'user') {
        const query = lastUser.content;
        activeSession.messages.pop();
        SessionStore.update(activeSession);
        renderSessionMessages(activeSession);
        handleSend(query);
      }
    }
  }

  if (composerForm) {
    composerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSend();
    });
  }

  // --- 13. Initialization & External Hooks ---

  // Expose KyanaLogo component on window
  window.KyanaLogo = KyanaLogo;

  // Global helper for external pages (e.g. from Library or Assignment search)
  window.askAiAssistant = function (query) {
    if (query && query.trim()) {
      handleSend(query.trim());
    }
  };

  // Sync conversations from server for authenticated students
  async function syncServerConversations() {
    try {
      const headers = {};
      const token = window.SemesterAuth?.getAccessToken?.();
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch('/api/ai/conversations', { headers });
      if (!res.ok) return;
      const serverConvs = await res.json();
      if (Array.isArray(serverConvs) && serverConvs.length > 0) {
        let changed = false;
        for (const conv of serverConvs) {
          let local = SessionStore.get(conv.id);
          if (!local) {
            local = {
              id: conv.id,
              title: conv.title || 'Chat with Kyana',
              createdAt: new Date(conv.createdAt).getTime() || Date.now(),
              updatedAt: new Date(conv.updatedAt).getTime() || Date.now(),
              messages: []
            };
            const all = SessionStore.getAll();
            all.unshift(local);
            SessionStore.saveAll(all);
            changed = true;
          }
        }
        if (changed) renderHistoryList();
        const activeId = SessionStore.getActiveId() || serverConvs[0].id;
        if (activeId) {
          const msgRes = await fetch('/api/ai/conversations/' + encodeURIComponent(activeId) + '/messages', { headers });
          if (msgRes.ok) {
            const data = await msgRes.json();
            const msgs = data.messages || [];
            const current = SessionStore.get(activeId);
            if (current && msgs.length > 0) {
              current.messages = msgs.map(m => ({
                ...m.metadata,
                id: m.id,
                role: m.sender === 'user' ? 'user' : 'assistant',
                content: m.text,
                timestamp: new Date(m.createdAt).getTime() || Date.now()
              }));
              SessionStore.update(current);
              loadSession(activeId);
            }
          }
        }
      }
    } catch (_) {}
  }
  syncServerConversations();

  // Auto-send or prefill from URL parameters (?q=..., ?prompt=..., or ?study=...&unit=...)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const studySubject = urlParams.get('study');
    const studyUnit = urlParams.get('unit');
    const initialQuery = urlParams.get('q') || urlParams.get('prompt') || (
      studySubject && studySubject.trim()
        ? (studyUnit ? `Teach me Unit ${studyUnit.trim()} of ${studySubject.trim()} step by step` : `Teach me ${studySubject.trim()} step by step`)
        : ''
    );
    if (initialQuery && initialQuery.trim()) {
      setTimeout(() => {
        handleSend(initialQuery.trim());
      }, 300);
    }
  } catch (_) {}

})();
