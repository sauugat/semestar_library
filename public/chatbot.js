/**
 * Semester Library — AI Academic Assistant (ChatGPT & Google Gemini Inspired)
 * Client-side widget & full-page engine with Markdown, KaTeX, Code Copy & Visual Cards
 */

(function () {
  'use strict';

  // Prevent multiple initializations
  if (window.__SLA_CHATBOT_INITIALIZED__) return;
  window.__SLA_CHATBOT_INITIALIZED__ = true;

  // --- 1. Load External Dependencies (KaTeX, Marked, DOMPurify) ---
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
    console.warn('[AI Assistant] CDN notice:', err.message);
  });

  const isFullPage = document.body.classList.contains('sla-fullpage-mode') || window.location.pathname.includes('chatbot.html');

  // --- 2. DOM Elements Binding & Widget Injection ---
  let messagesContainer, chatInput, sendBtn, chatForm, closeBtn, clearBtn, newChatBtn, suggestionsTray, welcomeHero, fab, panel;

  if (isFullPage) {
    messagesContainer = document.getElementById('slaMessages');
    chatInput = document.getElementById('slaInput');
    sendBtn = document.getElementById('slaSendBtn');
    chatForm = document.getElementById('slaForm');
    clearBtn = document.getElementById('slaClearBtn');
    newChatBtn = document.getElementById('slaNewChatBtn');
    suggestionsTray = document.getElementById('slaSuggestions');
    welcomeHero = document.getElementById('slaWelcomeHero');
  } else {
    // Inject floating bubble widget for all other pages
    fab = document.createElement('button');
    fab.className = 'sla-chat-fab';
    fab.setAttribute('aria-label', 'Open Kyana AI Study Assistant');
    fab.title = 'Kyana AI';
    fab.innerHTML = `
      <svg class="sla-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    `;

    panel = document.createElement('div');
    panel.className = 'sla-chat-panel';
    panel.innerHTML = `
      <div class="sla-panel-header">
        <div class="sla-header-info">
          <div class="sla-avatar-badge">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L14.8 8.2L21 11L14.8 13.8L12 20L9.2 13.8L3 11L9.2 8.2L12 2Z"/></svg>
          </div>
          <div class="sla-title-wrap">
            <h3>Kyana AI</h3>
            <p>Your BIT study companion</p>
          </div>
        </div>
        <div class="sla-header-actions">
          <a href="chatbot.html" class="sla-tool-btn" title="Fullscreen Page">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
          </a>
          <button type="button" class="sla-tool-btn" id="slaClearBtn" title="Clear">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
          <button type="button" class="sla-tool-btn" id="slaCloseBtn" title="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <div class="sla-ambient-glow-canvas" aria-hidden="true">
        <div class="sla-smoke-base"></div>
        <div class="sla-smoke-plume sla-smoke-plume-1"></div>
        <div class="sla-smoke-plume sla-smoke-plume-2"></div>
        <div class="sla-smoke-plume sla-smoke-plume-3"></div>
      </div>

      <div class="sla-chat-messages" id="slaMessages"></div>

      <div class="sla-panel-footer" style="padding: 8px 14px 12px;">
        <form class="sla-input-capsule" id="slaForm" style="padding: 6px 10px;">
          <textarea 
            id="slaInput" 
            class="sla-input-textarea" 
            placeholder="Ask Kyana AI a question…" 
            rows="1" 
            autocomplete="off" 
            maxlength="500"
          ></textarea>
          <button type="submit" class="sla-send-btn" id="slaSendBtn" title="Send" style="width:28px; height:28px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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

  // --- 3. Auto-resizing Multiline Textarea ---
  function adjustTextareaHeight() {
    if (!chatInput) return;
    chatInput.style.height = 'auto';
    const newHeight = Math.min(chatInput.scrollHeight, 160);
    chatInput.style.height = `${Math.max(newHeight, 24)}px`;
  }

  if (chatInput) {
    chatInput.addEventListener('input', adjustTextareaHeight);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }

  // --- 4. LaTeX & Markdown Parser ---
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

    // Enhance Code Blocks with Syntax Headers and Copy Buttons
    element.querySelectorAll('pre code').forEach((codeBlock) => {
      const pre = codeBlock.parentElement;
      if (pre.parentElement.classList.contains('sla-code-block-wrap')) return;

      const wrap = document.createElement('div');
      wrap.className = 'sla-code-block-wrap';

      const header = document.createElement('div');
      header.className = 'sla-code-header';
      
      const langMatch = codeBlock.className.match(/language-(\w+)/);
      const langName = langMatch ? langMatch[1] : 'Code';
      header.innerHTML = `
        <span>${langName}</span>
        <button type="button" class="sla-copy-code-btn">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>
      `;

      const copyBtn = header.querySelector('.sla-copy-code-btn');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(codeBlock.innerText).then(() => {
          copyBtn.innerHTML = `<span>✓ Copied!</span>`;
          setTimeout(() => {
            copyBtn.innerHTML = `
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>Copy</span>
            `;
          }, 2000);
        });
      });

      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(header);
      wrap.appendChild(pre);
    });

    // Render KaTeX Math Expressions
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

  // --- 5. Message Append Functions ---
  function appendUserMessage(text) {
    if (welcomeHero) welcomeHero.style.display = 'none';

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
    if (welcomeHero) welcomeHero.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'sla-msg-row sla-ai';
    
    const avatar = document.createElement('div');
    avatar.className = 'sla-msg-avatar';
    avatar.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M12 2L14.8 8.2L21 11L14.8 13.8L12 20L9.2 13.8L3 11L9.2 8.2L12 2Z"/>
      </svg>
    `;
    row.appendChild(avatar);

    const bubble = document.createElement('div');
    bubble.className = 'sla-msg-bubble';

    // Prose Text Response
    const textContent = document.createElement('div');
    textContent.className = 'sla-msg-text';
    renderFormattedContent(textContent, data.reply || '');
    bubble.appendChild(textContent);

    // --- STRUCTURED CARDS SECTION ---

    // 1. Matched File Cards (Exact Library Style with View & Get Buttons)
    if (data.matchedFiles && data.matchedFiles.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'sla-structured-section sla-files-section';
      sec.innerHTML = `
        <div class="sla-section-header">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
          <span>Library Files (${data.matchedFiles.length})</span>
        </div>
      `;
      
      const list = document.createElement('div');
      list.className = 'sla-files-clean-list';

      function getFileBadge(filename) {
        if (!filename) return 'DOC';
        const ext = (filename.split('.').pop() || '').toLowerCase();
        if (['pdf'].includes(ext)) return 'PDF';
        if (['ppt', 'pptx'].includes(ext)) return 'PPT';
        if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) return 'DOC';
        if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) return 'IMG';
        if (['zip', 'rar', '7z'].includes(ext)) return 'ZIP';
        return 'DOC';
      }

      function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      data.matchedFiles.forEach(f => {
        const item = document.createElement('div');
        item.className = 'clean-file-item sla-clean-file-item';
        const badge = getFileBadge(f.originalName || f.title);
        const fileName = f.title || f.originalName || 'Study Note';
        const metaText = `${f.subject || 'Library'}${f.chapter ? ' · ' + f.chapter : ''}${f.semester ? ' · ' + f.semester : ''}`;
        
        item.innerHTML = `
          <div class="clean-file-left">
            <div class="clean-file-icon ${badge.toLowerCase()}">${badge}</div>
            <div style="min-width:0;">
              <p class="clean-file-title" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</p>
              <p class="clean-file-meta">${escapeHtml(metaText)}</p>
            </div>
          </div>
          <div class="clean-file-actions">
            <a href="/api/files/${f.id}/view" target="_blank" class="btn-file-action btn-file-view">View</a>
            <a href="/api/files/${f.id}/download" download="${escapeHtml(f.originalName || 'file')}" target="_blank" class="btn-file-action btn-file-get">Get</a>
          </div>
        `;
        list.appendChild(item);
      });
      sec.appendChild(list);
      bubble.appendChild(sec);
    }

    // 2. Matched Syllabus Course Cards (Curriculum Layout)
    if (data.matchedCourses && data.matchedCourses.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'sla-structured-section sla-syllabus-section';
      sec.innerHTML = `
        <div class="sla-section-header">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          <span>Curriculum & Syllabus (${data.matchedCourses.length})</span>
        </div>
      `;
      
      const list = document.createElement('div');
      list.className = 'sla-syllabus-cards-list';

      data.matchedCourses.forEach(c => {
        const card = document.createElement('div');
        card.className = 'sla-syllabus-card';
        const year = c.year || 'Year 1';
        const courseKey = c.code ? `${c.code}-${c.title}` : c.title;
        const syllabusLink = `syllabus.html#${encodeURIComponent(year)}/${encodeURIComponent(c.semester)}/${encodeURIComponent(courseKey)}`;
        
        card.innerHTML = `
          <div class="sla-syllabus-card-header">
            <span class="sla-syllabus-code">${c.code || 'COURSE'}</span>
            <span class="sla-syllabus-sem">Semester ${c.semester}</span>
            <span class="sla-syllabus-credits">${c.credit} Credits</span>
          </div>
          <div class="sla-syllabus-card-body">
            <h4 class="sla-syllabus-title">${c.title}</h4>
            <p class="sla-syllabus-nature">${c.nature || 'Core Curriculum'}</p>
          </div>
          <div class="sla-syllabus-card-footer">
            <a href="${syllabusLink}" class="sla-syllabus-link">
              <span>View Full Syllabus Outline</span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
          </div>
        `;
        list.appendChild(card);
      });
      sec.appendChild(list);
      bubble.appendChild(sec);
    }

    // 3. Matched Pre-Board Exam Routine Cards (Timetable Date Block Layout)
    if (data.matchedRoutine && data.matchedRoutine.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'sla-structured-section sla-routine-section';
      sec.innerHTML = `
        <div class="sla-section-header">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          <span>Examination Timetable (${data.matchedRoutine.length})</span>
        </div>
      `;
      
      const list = document.createElement('div');
      list.className = 'sla-routine-exams-list';

      data.matchedRoutine.forEach(r => {
        const item = document.createElement('div');
        item.className = 'sla-routine-exam-row';
        const dateStr = r.date || '';
        let day = '??';
        let monthYear = '?? / ????';
        if (dateStr) {
          const parts = dateStr.split('/');
          const dashParts = dateStr.split('-');
          if (parts.length === 3) {
            day = parts[2];
            monthYear = `${parts[1]} / ${parts[0]}`;
          } else if (dashParts.length === 3) {
            day = dashParts[2];
            monthYear = `${dashParts[1]} / ${dashParts[0]}`;
          } else {
            day = dateStr;
            monthYear = '2083';
          }
        }

        const codeOrTime = r.time || '11:30 AM';
        const routineUrl = `routine.html?semester=${encodeURIComponent(r.semester)}`;

        item.innerHTML = `
          <div class="sla-routine-date-box">
            <span class="sla-routine-day">${day}</span>
            <span class="sla-routine-month">${monthYear}</span>
          </div>
          <div class="sla-routine-info">
            <div class="sla-routine-tags">
              <span class="sla-routine-sem-tag">Semester ${r.semester}</span>
              ${codeOrTime.startsWith('CIT') || codeOrTime.startsWith('BSM') || codeOrTime.startsWith('ELX') || codeOrTime.startsWith('BCT') ? `<span class="sla-routine-code-tag">${codeOrTime}</span>` : ''}
            </div>
            <h4 class="sla-routine-title">${r.subject}</h4>
            <p class="sla-routine-time-sub">${r.type || 'Examination'}${r.day ? ' · ' + r.day : ''}</p>
          </div>
          <a href="${routineUrl}" class="sla-routine-open-btn" title="Open Routine Page">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </a>
        `;
        list.appendChild(item);
      });
      sec.appendChild(list);
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

    // Message Actions Bar (Copy Text Tool)
    const actionsBar = document.createElement('div');
    actionsBar.className = 'sla-msg-actions-bar';
    actionsBar.innerHTML = `
      <button type="button" class="sla-msg-tool-action sla-copy-msg-btn">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span>Copy</span>
      </button>
      <div class="sla-citation-badge">
        <span>Grounded</span>
      </div>
    `;

    const copyBtn = actionsBar.querySelector('.sla-copy-msg-btn');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(data.reply || '').then(() => {
        copyBtn.innerHTML = `<span>✓ Copied!</span>`;
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Copy response</span>
          `;
        }, 2000);
      });
    });

    bubble.appendChild(actionsBar);
    row.appendChild(bubble);
    messagesContainer.appendChild(row);
    scrollToBottom();
  }

  function showTypingIndicator() {
    const row = document.createElement('div');
    row.className = 'sla-msg-row sla-ai sla-typing-row';
    row.id = 'slaTypingIndicator';
    row.innerHTML = `
      <div class="sla-msg-avatar sla-avatar-thinking">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M12 2L14.8 8.2L21 11L14.8 13.8L12 20L9.2 13.8L3 11L9.2 8.2L12 2Z"/>
        </svg>
      </div>
      <div class="sla-msg-bubble">
        <div class="sla-minimal-thinking">
          <span class="sla-thinking-label">Thinking</span>
          <span class="sla-thinking-dots">
            <span class="sla-dot"></span>
            <span class="sla-dot"></span>
            <span class="sla-dot"></span>
          </span>
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

  // --- 6. Message Submission Handler ---
  async function handleSend(textToSend) {
    const query = (textToSend || (chatInput ? chatInput.value : '')).trim();
    if (!query || isSending) return;

    if (chatInput) {
      chatInput.value = '';
      adjustTextareaHeight();
    }

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

      // Record to multi-turn history
      conversationHistory.push({ role: 'user', content: query });
      if (data.reply) {
        conversationHistory.push({ role: 'assistant', content: data.reply });
      }
    } catch (err) {
      removeTypingIndicator();
      appendAIMessage({
        reply: '⚠️ Network connection issue. Please make sure the server is running and try again.',
        actions: [{ label: 'Refresh Page', url: window.location.href }]
      });
    } finally {
      isSending = false;
      if (sendBtn) sendBtn.disabled = false;
      if (chatInput) chatInput.focus();
    }
  }

  // --- 7. Event Listeners & Reset Actions ---
  function resetConversation() {
    conversationHistory.length = 0;
    messagesContainer.innerHTML = '';
    if (welcomeHero) {
      messagesContainer.appendChild(welcomeHero);
      welcomeHero.style.display = 'flex';
    } else {
      messagesContainer.innerHTML = `
        <div class="sla-msg-row sla-ai">
          <div class="sla-msg-avatar">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M12 2L14.8 8.2L21 11L14.8 13.8L12 20L9.2 13.8L3 11L9.2 8.2L12 2Z"/>
            </svg>
          </div>
          <div class="sla-msg-bubble">
            <p>Conversation refreshed. How can I help you find notes, syllabus, or exam routines?</p>
          </div>
        </div>
      `;
    }
    if (chatInput) {
      chatInput.value = '';
      adjustTextareaHeight();
      chatInput.focus();
    }
  }

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

  if (clearBtn) clearBtn.addEventListener('click', resetConversation);
  if (newChatBtn) newChatBtn.addEventListener('click', resetConversation);

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSend();
    });
  }

  // Global delegate for suggestion chips, starter prompt cards, and topic buttons
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.sla-suggestion-chip') || 
                    e.target.closest('.sla-topic-btn') || 
                    e.target.closest('.sla-starter-card');
    if (trigger && trigger.dataset.q) {
      handleSend(trigger.dataset.q);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen && !isFullPage) {
      togglePanel(false);
    }
  });

  // Global helper for external pages
  window.askAiAssistant = function(query) {
    if (isFullPage) {
      handleSend(query);
    } else {
      togglePanel(true);
      handleSend(query);
    }
  };

  // Auto-send or prefill query from URL params (?q=... or ?prompt=...)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const initialQ = urlParams.get('q') || urlParams.get('prompt');
    if (initialQ && initialQ.trim()) {
      setTimeout(() => {
        handleSend(initialQ.trim());
      }, 350);
    }
  } catch (err) {}

})();
