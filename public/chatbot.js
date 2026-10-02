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

  function fallbackMarkdown(text) {
    const output = [];
    let fence = null;
    let code = [];
    const finishCode = () => {
      output.push(`<pre><code${fence.language ? ` class="language-${escapeHtml(fence.language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      code = [];
      fence = null;
    };
    for (const line of String(text).split('\n')) {
      if (fence) {
        if (new RegExp(`^\\s*${fence.character}{${fence.length},}\\s*$`).test(line)) finishCode();
        else code.push(line);
        continue;
      }
      const match = line.match(/^\s*(`{3,}|~{3,})([\w+-]*)[^\n]*$/);
      if (match) fence = { character: match[1][0], length: match[1].length, language: match[2] };
      else {
        let escapedLine = escapeHtml(line);
        escapedLine = escapedLine.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        output.push(escapedLine + '<br>');
      }
    }
    if (fence) finishCode();
    return output.join('');
  }

  function normalizeLatexDelimiters(text) {
    if (!text) return '';
    const { text: protectedText, tokenMap } = protectCodeBlocks(text);
    const transformed = protectedText
      .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
      .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
    return restoreCodeBlocks(transformed, tokenMap);
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

      // Hash comments (Python/Shell/Ruby - not C/C++ preprocessor)
      if (rawCode[i] === '#' && (isPy || (!isC && !rawCode.slice(i).match(/^#(?:include|define|ifdef|ifndef|endif|pragma)\b/)))) {
        let end = rawCode.indexOf('\n', i);
        if (end === -1) end = len;
        html += `<span class="token comment">${escapeHtml(rawCode.slice(i, end))}</span>`;
        i = end;
        continue;
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

        if (keywords.has(word)) {
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

  // Pure helpers export for Node unit test runners
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') {
    module.exports = {
      createEventStreamParser,
      readChatResponse,
      escapeHtml,
      safeLink,
      protectCodeBlocks,
      restoreCodeBlocks,
      fallbackMarkdown,
      normalizeLatexDelimiters,
      highlightChatCode,
      assertAndCleanPlaceholders
    };
    return;
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

  // KyanaCodeBlock Component
  const KyanaCodeBlock = {
    enhance(container) {
      container.querySelectorAll('pre code').forEach((codeBlock) => {
        const pre = codeBlock.parentElement;
        if (pre.parentElement.classList.contains('kyana-code-block')) return;

        const rawCode = codeBlock.textContent || '';
        const langMatch = codeBlock.className.match(/language-(\w+)/);
        const langName = langMatch ? langMatch[1] : 'Code';
        const langKey = langName.toLowerCase();
        const compilerSupported = /^(java|c|cpp|c\+\+|html|css|javascript|js|python|py|sql)$/.test(langKey);

        codeBlock.dataset.rawCode = rawCode;
        codeBlock.innerHTML = highlightChatCode(rawCode, langKey);
        assertAndCleanPlaceholders(codeBlock);

        const wrap = document.createElement('div');
        wrap.className = 'kyana-code-block';

        const header = document.createElement('div');
        header.className = 'kyana-code-header';
        header.innerHTML = `
          <span class="kyana-code-lang">${escapeHtml(langName)}</span>
          <div class="kyana-code-actions">
            <button type="button" class="kyana-code-btn kyana-copy-code-btn">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>Copy</span>
            </button>
            ${compilerSupported ? `
            <button type="button" class="kyana-code-btn kyana-run-compiler-btn" title="Open in Semester Library Code Lab">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                <polygon points="6,3 20,12 6,21"/>
              </svg>
              <span>Run in Compiler</span>
            </button>` : ''}
          </div>
        `;

        const copyBtn = header.querySelector('.kyana-copy-code-btn');
        copyBtn.addEventListener('click', () => {
          const codeToCopy = codeBlock.dataset.rawCode || codeBlock.innerText;
          navigator.clipboard.writeText(codeToCopy).then(() => {
            copyBtn.innerHTML = `<span>✓ Copied!</span>`;
            setTimeout(() => {
              copyBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span>Copy</span>
              `;
            }, 2000);
          });
        });

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

  // Markdown Formatter with KaTeX
  function renderFormattedContent(element, rawMarkdown, streaming = false) {
    if (!element) return;
    const normalized = normalizeLatexDelimiters(rawMarkdown);
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
      const files = Array.isArray(data.matchedFiles) ? data.matchedFiles : [];
      const courses = Array.isArray(data.matchedCourses) ? data.matchedCourses : [];
      const routines = Array.isArray(data.matchedRoutine) ? data.matchedRoutine : [];
      const webSources = Array.isArray(data.webSources) ? data.webSources.filter(s => s && safeLink(s.url, true)) : [];

      if (!files.length && !courses.length && !routines.length && !webSources.length) return;

      const wrap = document.createElement('div');
      wrap.className = 'kyana-sources-wrap';
      wrap.innerHTML = `
        <div class="kyana-sources-heading">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
          <span>Sources & References</span>
        </div>
        <div class="kyana-sources-list"></div>
      `;
      const list = wrap.querySelector('.kyana-sources-list');

      // 1. Files
      files.forEach(f => {
        const card = document.createElement('a');
        card.className = 'kyana-source-card';
        card.href = `/api/files/${encodeURIComponent(f.id)}/view`;
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

      // 2. Syllabus
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

      // 3. Routine
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

      // 4. Web Sources
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

  const SessionStore = {
    getAll() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (_) {
        return [];
      }
    },
    saveAll(sessions) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 50)));
      } catch (_) {}
    },
    getActiveId() {
      try {
        return localStorage.getItem(ACTIVE_SESSION_KEY);
      } catch (_) {
        return null;
      }
    },
    setActiveId(id) {
      try {
        if (id) localStorage.setItem(ACTIVE_SESSION_KEY, id);
        else localStorage.removeItem(ACTIVE_SESSION_KEY);
      } catch (_) {}
    },
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
        KyanaResponseActions.render(doc, msg.content || '', idx === session.messages.length - 1 ? () => handleRegenerate() : null, false);
        messagesListEl.appendChild(row);
      }
    });

    scrollToBottom();
  }

  function loadSession(id) {
    cancelActiveRequest();
    const session = SessionStore.get(id);
    if (session) {
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

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        signal: request.controller.signal,
        body: JSON.stringify({
          message: query,
          history: historyPayload,
          stream: true
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

      request.doc.innerHTML = '';
      renderFormattedContent(request.doc, data.reply || '');
      KyanaSourceCard.renderSources(request.doc, data);
      KyanaResponseActions.render(request.doc, data.reply || '', () => handleRegenerate(), true);

      // Save to session history
      activeSession.messages.push({
        role: 'assistant',
        content: data.reply || '',
        matchedFiles: data.matchedFiles,
        matchedCourses: data.matchedCourses,
        matchedRoutine: data.matchedRoutine,
        webSources: data.webSources,
        timestamp: Date.now()
      });
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

  // Hydrate initial session or start fresh
  const storedActiveId = SessionStore.getActiveId();
  if (storedActiveId && SessionStore.get(storedActiveId)) {
    loadSession(storedActiveId);
  } else {
    renderHistoryList();
    setConversationState(false, false);
  }

  // Auto-send or prefill from URL parameters (?q=... or ?prompt=...)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const initialQuery = urlParams.get('q') || urlParams.get('prompt');
    if (initialQuery && initialQuery.trim()) {
      setTimeout(() => {
        handleSend(initialQuery.trim());
      }, 300);
    }
  } catch (_) {}

})();
