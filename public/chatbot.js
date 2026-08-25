/**
 * Semester Library — Scoped AI Website Assistant
 * Client-side widget & full-page engine with Markdown, KaTeX & Structured Visual Cards
 */

(function () {
  'use strict';

  // Prevent multiple initializations
  if (window.__SLA_CHATBOT_INITIALIZED__) return;
  window.__SLA_CHATBOT_INITIALIZED__ = true;

  // --- 1. Load External CDN Dependencies Safely ---
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  function loadCSS(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  }

  loadCSS('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css');
  
  Promise.all([
    loadScript('https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js')
  ]).then(() => {
    return loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js');
  }).catch(err => {
    console.warn('[AI Assistant] CDN dependency notice:', err.message);
  });

  const isFullPage = document.body.classList.contains('sla-fullpage-mode') || window.location.pathname.includes('chatbot.html');

  // --- 2. Build DOM Elements for Floating Mode if not already fullpage ---
  let messagesContainer, chatInput, sendBtn, chatForm, closeBtn, clearBtn, suggestionsTray, fab, panel;

  if (isFullPage) {
    // Dedicated page binds directly to existing DOM elements
    messagesContainer = document.getElementById('slaMessages');
    chatInput = document.getElementById('slaInput');
    sendBtn = document.getElementById('slaSendBtn');
    chatForm = document.getElementById('slaForm');
    clearBtn = document.getElementById('slaClearBtn');
    suggestionsTray = document.getElementById('slaSuggestions');
  } else {
    // Inject floating bubble widget
    fab = document.createElement('button');
    fab.className = 'sla-chat-fab';
    fab.setAttribute('aria-label', 'Open Semester Library AI Assistant');
    fab.title = 'AI Assistant';
    fab.innerHTML = `
      <svg class="sla-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      <span class="sla-fab-badge-dot" title="Online"></span>
    `;

    panel = document.createElement('div');
    panel.className = 'sla-chat-panel';
    panel.innerHTML = `
      <div class="sla-panel-header">
        <div class="sla-header-info">
          <div class="sla-avatar-logo">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div class="sla-title-wrap">
            <h3>Semester Library AI</h3>
            <p><span class="sla-status-indicator"></span> Website Notes & Syllabus Assistant</p>
          </div>
        </div>
        <div class="sla-header-actions">
          <a href="chatbot.html" class="sla-tool-btn" title="Open Fullscreen Page">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
          </a>
          <button type="button" class="sla-tool-btn" id="slaClearBtn" title="Clear Chat History">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
          <button type="button" class="sla-tool-btn" id="slaCloseBtn" title="Close Assistant">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <div class="sla-chat-messages" id="slaMessages">
        <div class="sla-msg-row sla-ai">
          <div class="sla-msg-avatar">AI</div>
          <div class="sla-msg-bubble">
            <h3>Hello! I'm your Semester Library Assistant.</h3>
            <p>I can help you search uploaded notes, explore syllabus topics, and check pre-board exam schedules.</p>
            <div class="sla-actions-row">
              <a href="library.html" class="sla-action-pill">📚 Browse Notes</a>
              <a href="syllabus.html" class="sla-action-pill">📖 View Syllabus</a>
              <a href="routine.html" class="sla-action-pill">📅 Exam Routine</a>
            </div>
          </div>
        </div>
      </div>

      <div class="sla-suggestions-tray" id="slaSuggestions">
        <button type="button" class="sla-suggestion-chip" data-q="what notes do we have for networking stuff">🌐 Networking Notes</button>
        <button type="button" class="sla-suggestion-chip" data-q="Give me notes on Math">📐 Math Notes</button>
        <button type="button" class="sla-suggestion-chip" data-q="What's in semester 3?">📖 Semester 3 Syllabus</button>
        <button type="button" class="sla-suggestion-chip" data-q="When's the exam?">📅 Exam Schedule</button>
      </div>

      <div class="sla-panel-footer">
        <form class="sla-input-wrapper" id="slaForm">
          <input type="text" id="slaInput" class="sla-chat-input" placeholder="Ask about notes, syllabus, or routine…" autocomplete="off" maxlength="400">
          <button type="submit" class="sla-send-btn" id="slaSendBtn" title="Send Question">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    messagesContainer = panel.querySelector('#slaMessages');
    chatInput = panel.querySelector('#slaInput');
    sendBtn = panel.querySelector('#slaSendBtn');
    chatForm = panel.querySelector('#slaForm');
    closeBtn = panel.querySelector('#slaCloseBtn');
    clearBtn = panel.querySelector('#slaClearBtn');
    suggestionsTray = panel.querySelector('#slaSuggestions');
  }

  let isOpen = false;
  let isSending = false;
  const conversationHistory = [];

  // --- 3. Normalizer & KaTeX Renderer ---
  function normalizeLatexDelimiters(text) {
    if (!text) return '';
    return text
      .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$1$$$')
      .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$');
  }

  function renderFormattedContent(element, rawMarkdown) {
    const normalized = normalizeLatexDelimiters(rawMarkdown);
    
    let parsedHtml = normalized;
    if (window.marked && typeof window.marked.parse === 'function') {
      parsedHtml = window.marked.parse(normalized);
    } else {
      parsedHtml = normalized.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
    }

    if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
      element.innerHTML = window.DOMPurify.sanitize(parsedHtml, {
        ADD_ATTR: ['target', 'rel']
      });
    } else {
      element.innerHTML = parsedHtml;
    }

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
      } catch (kErr) {
        console.warn('[AI KaTeX error]:', kErr);
      }
    }
  }

  function scrollToBottom() {
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  // --- 4. Append Message with Structured UI Cards ---
  function appendUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'sla-msg-row sla-user';
    const bubble = document.createElement('div');
    bubble.className = 'sla-msg-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesContainer.appendChild(row);
    scrollToBottom();
  }

  function appendAIMessage(data) {
    const row = document.createElement('div');
    row.className = 'sla-msg-row sla-ai';
    
    const avatar = document.createElement('div');
    avatar.className = 'sla-msg-avatar';
    avatar.textContent = 'AI';
    row.appendChild(avatar);

    const bubble = document.createElement('div');
    bubble.className = 'sla-msg-bubble';

    // Prose Text Response
    const textContent = document.createElement('div');
    textContent.className = 'sla-msg-text';
    renderFormattedContent(textContent, data.reply || '');
    bubble.appendChild(textContent);

    // --- STRUCTURED CARDS SECTION ---

    // 1. Matched File Cards
    if (data.matchedFiles && data.matchedFiles.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'sla-structured-section';
      sec.innerHTML = `<div class="sla-section-title">📂 Uploaded Notes Found (${data.matchedFiles.length})</div>`;
      
      const grid = document.createElement('div');
      grid.className = 'sla-cards-grid';

      data.matchedFiles.forEach(f => {
        const card = document.createElement('a');
        card.className = 'sla-file-card';
        card.href = `/api/files/download/${f.id}`;
        card.setAttribute('download', f.originalName);
        card.innerHTML = `
          <div class="sla-file-card-info">
            <div class="sla-file-card-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            </div>
            <div>
              <div class="sla-file-card-name" title="${f.originalName}">${f.title || f.originalName}</div>
              <div class="sla-file-card-meta">
                <span class="sla-file-tag">${f.subject || 'Notes'}</span>
                <span>${f.chapter ? f.chapter : ''}</span>
              </div>
            </div>
          </div>
          <button type="button" class="sla-file-download-btn">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Download
          </button>
        `;
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      bubble.appendChild(sec);
    }

    // 2. Matched Syllabus Course Cards
    if (data.matchedCourses && data.matchedCourses.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'sla-structured-section';
      sec.innerHTML = `<div class="sla-section-title">📚 Course Curriculum Matches (${data.matchedCourses.length})</div>`;
      
      const grid = document.createElement('div');
      grid.className = 'sla-cards-grid';

      data.matchedCourses.forEach(c => {
        const card = document.createElement('a');
        card.className = 'sla-course-card';
        card.href = `syllabus.html`;
        card.innerHTML = `
          <div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="sla-course-code-pill">${c.code}</span>
              <span style="font-size:11px; color:#64748b; font-weight:600;">Semester ${c.semester}</span>
            </div>
            <div class="sla-course-title">${c.title}</div>
            <div class="sla-course-sub">${c.credit} Credits · ${c.nature}</div>
          </div>
          <span style="font-size:16px; color:#94a3b8; font-weight:700;">&rsaquo;</span>
        `;
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      bubble.appendChild(sec);
    }

    // 3. Matched Pre-Board Exam Routine Cards
    if (data.matchedRoutine && data.matchedRoutine.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'sla-structured-section';
      sec.innerHTML = `<div class="sla-section-title">📅 Exam Schedule (${data.matchedRoutine.length})</div>`;
      
      const grid = document.createElement('div');
      grid.className = 'sla-cards-grid';

      data.matchedRoutine.forEach(r => {
        const card = document.createElement('a');
        card.className = 'sla-routine-card';
        card.href = `routine.html`;
        card.innerHTML = `
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="sla-routine-date-badge">
              <span class="sla-rday">${r.date.split('/')[2] || '25'}</span>
              <span class="sla-rdate">${r.date.split('/')[1] || '04'}/2083</span>
            </div>
            <div>
              <div class="sla-routine-subj">${r.subject}</div>
              <div class="sla-routine-meta">
                <span>Semester ${r.semester}</span>
                <span>•</span>
                <span>${r.day} @ ${r.time}</span>
              </div>
            </div>
          </div>
          <span style="font-size:12px; font-weight:700; color:#d4af37;">View &rarr;</span>
        `;
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      bubble.appendChild(sec);
    }

    // Action Navigation Buttons
    if (data.actions && data.actions.length > 0) {
      const actionsRow = document.createElement('div');
      actionsRow.className = 'sla-actions-row';
      data.actions.forEach(act => {
        const btn = document.createElement('a');
        btn.className = 'sla-action-pill';
        btn.href = act.url;
        btn.innerHTML = `<span>${act.label}</span> &rarr;`;
        actionsRow.appendChild(btn);
      });
      bubble.appendChild(actionsRow);
    }

    row.appendChild(bubble);
    messagesContainer.appendChild(row);
    scrollToBottom();
  }

  function showTypingIndicator() {
    const row = document.createElement('div');
    row.className = 'sla-msg-row sla-ai sla-typing-row';
    row.id = 'slaTypingIndicator';
    row.innerHTML = `
      <div class="sla-msg-avatar">AI</div>
      <div class="sla-msg-bubble">
        <div class="sla-typing-indicator">
          <div class="sla-typing-dot"></div>
          <div class="sla-typing-dot"></div>
          <div class="sla-typing-dot"></div>
        </div>
      </div>
    `;
    messagesContainer.appendChild(row);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    const indicator = document.getElementById('slaTypingIndicator');
    if (indicator) indicator.remove();
  }

  // --- 5. Message Submission ---
  async function handleSend(textToSend) {
    const query = (textToSend || chatInput.value || '').trim();
    if (!query || isSending) return;

    chatInput.value = '';
    appendUserMessage(query);

    isSending = true;
    if (sendBtn) sendBtn.disabled = true;
    showTypingIndicator();

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          history: conversationHistory.slice(-8)
        })
      });

      removeTypingIndicator();

      if (response.status === 401) {
        appendAIMessage({
          reply: 'Your session has expired. Please [sign in again](login.html) to chat with the assistant.',
          actions: [{ label: 'Sign In', url: 'login.html' }]
        });
        return;
      }

      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        appendAIMessage({
          reply: `⏳ **Hourly Limit Reached**\n\n${data.message || 'You have reached the maximum 20 requests per hour. Please wait a bit before asking again.'}`,
          actions: [{ label: 'Browse Library', url: 'library.html' }]
        });
        return;
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        appendAIMessage({
          reply: `⚠️ ${errData.message || 'Unable to process question. Please try asking in a different way.'}`,
          actions: [{ label: 'View Syllabus', url: 'syllabus.html' }]
        });
        return;
      }

      const data = await response.json();
      appendAIMessage(data);

      // Record to multi-turn conversation history
      conversationHistory.push({ role: 'user', content: query });
      if (data.reply) {
        conversationHistory.push({ role: 'assistant', content: data.reply });
      }
    } catch (err) {
      removeTypingIndicator();
      appendAIMessage({
        reply: '⚠️ Network connection issue. Please make sure the server is reachable and try again.',
        actions: [{ label: 'Refresh Page', url: window.location.href }]
      });
    } finally {
      isSending = false;
      if (sendBtn) sendBtn.disabled = false;
      if (chatInput) chatInput.focus();
    }
  }

  // --- 6. Event Listeners ---
  function togglePanel(show) {
    if (isFullPage) return;
    isOpen = (typeof show === 'boolean') ? show : !isOpen;
    if (isOpen) {
      panel.classList.add('sla-visible');
      fab.classList.add('sla-open');
      setTimeout(() => chatInput && chatInput.focus(), 150);
    } else {
      panel.classList.remove('sla-visible');
      fab.classList.remove('sla-open');
    }
  }

  if (fab) fab.addEventListener('click', () => togglePanel());
  if (closeBtn) closeBtn.addEventListener('click', () => togglePanel(false));

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      conversationHistory.length = 0;
      messagesContainer.innerHTML = `
        <div class="sla-msg-row sla-ai">
          <div class="sla-msg-avatar">AI</div>
          <div class="sla-msg-bubble">
            <p>Chat history cleared. How can I help you find notes, syllabus, or exam routines?</p>
          </div>
        </div>
      `;
    });
  }

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSend();
    });
  }

  if (suggestionsTray) {
    suggestionsTray.addEventListener('click', (e) => {
      const chip = e.target.closest('.sla-suggestion-chip') || e.target.closest('.sla-topic-btn');
      if (chip && chip.dataset.q) {
        handleSend(chip.dataset.q);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen && !isFullPage) {
      togglePanel(false);
    }
  });

  // Global helper for topic buttons
  window.askAiAssistant = function(query) {
    if (isFullPage) {
      handleSend(query);
    } else {
      togglePanel(true);
      handleSend(query);
    }
  };

})();
