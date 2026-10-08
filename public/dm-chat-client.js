/**
 * Semester Library — Universal Private Messaging (DM) Web Client
 * Step 4A Frontend Implementation
 * Minimalist, Modern, Resilient, XSS-Safe, Supabase Realtime-Powered
 */
(function (root) {
  'use strict';

  // --- Utility Functions ---
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMin < 1) return 'now';
    if (diffMin < 60) return `${diffMin}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatDateSeparator(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';
    return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // --- DmClient Class ---
  class DmClient {
    constructor() {
      this.enabled = false;
      this.currentUser = null;
      this.conversations = [];
      this.activeConversation = null;
      this.messages = [];
      this.hasMore = false;
      this.isLoadingMessages = false;
      this.isLoadingOlder = false;
      this.replyingTo = null;
      this.editingMessage = null;
      this.searchDebounceTimer = null;
      this.typingThrottleTimer = null;
      this.peerTypingTimeout = null;
      this.lastTypingSentAt = 0;
      this.realtimeChannel = null;
      this.supabaseClient = null;
      this.peerLastReadMessageId = 0;
      this.isOnline = navigator.onLine !== false;

      this.pendingSends = new Map(); // clientId -> { optimisticMsg, timestamp }
      this.elements = {};
    }

    async init(currentUser) {
      this.currentUser = currentUser;
      if (!this.currentUser) return;

      // Check feature status
      try {
        const res = await fetch('/api/dm-status', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          this.enabled = Boolean(data.enabled);
        } else {
          this.enabled = false;
        }
      } catch {
        this.enabled = false;
      }

      this.cacheKey = `sl_dm_cache_${this.currentUser.studentId}`;
      this.bindDOM();
      this.setupModeSwitcher();

      if (!this.enabled) {
        if (this.elements.modeBar) this.elements.modeBar.style.display = 'none';
        return;
      }

      // Feature is enabled: show mode switcher bar
      if (this.elements.modeBar) this.elements.modeBar.style.display = 'flex';

      // Setup window listeners
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.activeConversation) {
          this.syncActiveConversation();
        }
      });
      window.addEventListener('storage', (e) => {
        if (e.key && /auth|session|logout|user/i.test(e.key)) {
          this.clearAccountData();
        }
      });

      // Check URL parameters for direct conversation navigation
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      const convId = params.get('conversationId') || params.get('dm');
      if (tab === 'dm' || convId) {
        this.switchMode('dm');
        if (convId) {
          await this.loadConversations();
          this.selectConversationById(convId);
        }
      }
    }

    bindDOM() {
      this.elements = {
        modeBar: document.getElementById('chatModeBar'),
        modeBtnCohort: document.getElementById('modeBtnCohort'),
        modeBtnDm: document.getElementById('modeBtnDm'),
        cohortChatMain: document.getElementById('cohortChatMain') || document.querySelector('.chat-main'),
        dmMain: document.getElementById('dmMain'),
        dmLayout: document.getElementById('dmLayout'),
        globalUnreadBadge: document.getElementById('dmGlobalUnreadBadge'),
        tabUnreadBadge: document.getElementById('dmTabUnreadBadge'),

        // Inbox
        convList: document.getElementById('dmConvList'),
        convSearchInput: document.getElementById('dmConvSearchInput'),
        newMsgBtn: document.getElementById('dmNewMsgBtn'),

        // Right panel / Active chat
        noConvPlaceholder: document.getElementById('dmNoConvPlaceholder'),
        activeChatWrap: document.getElementById('dmActiveChatWrap'),
        headerBackBtn: document.getElementById('dmHeaderBackBtn'),
        peerAvatar: document.getElementById('dmPeerAvatar'),
        peerName: document.getElementById('dmPeerName'),
        peerRoleBadge: document.getElementById('dmPeerRoleBadge'),
        peerStatusText: document.getElementById('dmPeerStatusText'),
        peerStatusDot: document.getElementById('dmPeerStatusDot'),
        connBanner: document.getElementById('dmConnBanner'),
        headerMenuBtn: document.getElementById('dmHeaderMenuBtn'),
        headerDropdown: document.getElementById('dmHeaderDropdown'),

        // Timeline
        timeline: document.getElementById('dmTimeline'),
        timelineLoader: document.getElementById('dmTimelineLoader'),

        // Composer
        composerWrap: document.getElementById('dmComposerWrap'),
        contextBar: document.getElementById('dmComposerContextBar'),
        contextTitle: document.getElementById('dmComposerContextTitle'),
        contextSnippet: document.getElementById('dmComposerContextSnippet'),
        contextCancelBtn: document.getElementById('dmComposerContextCancelBtn'),
        textarea: document.getElementById('dmTextarea'),
        charCounter: document.getElementById('dmCharCounter'),
        sendBtn: document.getElementById('dmSendBtn'),
        emojiToggleBtn: document.getElementById('dmEmojiToggleBtn'),
        emojiDrawer: document.getElementById('dmEmojiDrawer'),
        blockedBanner: document.getElementById('dmBlockedBanner'),
        unblockBtn: document.getElementById('dmUnblockBtn'),

        // Modals
        userSearchModal: document.getElementById('dmUserSearchModal'),
        userSearchInput: document.getElementById('dmUserSearchInput'),
        userSearchResults: document.getElementById('dmUserSearchResults'),
        userSearchCloseBtn: document.getElementById('dmUserSearchCloseBtn'),

        deleteModal: document.getElementById('dmDeleteModal'),
        deleteForMeBtn: document.getElementById('dmDeleteForMeBtn'),
        deleteForEveryoneBtn: document.getElementById('dmDeleteForEveryoneBtn'),
        deleteCancelBtn: document.getElementById('dmDeleteCancelBtn'),

        clearModal: document.getElementById('dmClearModal'),
        clearConfirmBtn: document.getElementById('dmClearConfirmBtn'),
        clearCancelBtn: document.getElementById('dmClearCancelBtn'),

        blockModal: document.getElementById('dmBlockModal'),
        blockConfirmBtn: document.getElementById('dmBlockConfirmBtn'),
        blockCancelBtn: document.getElementById('dmBlockCancelBtn'),

        reportModal: document.getElementById('dmReportModal'),
        reportReasonSelect: document.getElementById('dmReportReasonSelect'),
        reportDescInput: document.getElementById('dmReportDescInput'),
        reportSubmitBtn: document.getElementById('dmReportSubmitBtn'),
        reportCancelBtn: document.getElementById('dmReportCancelBtn'),
      };

      this.bindEvents();
    }

    bindEvents() {
      const el = this.elements;

      // Mode Switcher Buttons
      if (el.modeBtnCohort) {
        el.modeBtnCohort.addEventListener('click', () => this.switchMode('cohort'));
      }
      if (el.modeBtnDm) {
        el.modeBtnDm.addEventListener('click', () => this.switchMode('dm'));
      }

      // Inbox Search
      if (el.convSearchInput) {
        el.convSearchInput.addEventListener('input', (e) => this.filterConversations(e.target.value));
      }

      // New Message Button
      if (el.newMsgBtn) {
        el.newMsgBtn.addEventListener('click', () => this.openUserSearchModal());
      }

      // Mobile Back Button
      if (el.headerBackBtn) {
        el.headerBackBtn.addEventListener('click', () => this.closeActiveConversationMobile());
      }

      // Header Dropdown Toggle
      if (el.headerMenuBtn) {
        el.headerMenuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          el.headerDropdown.classList.toggle('show');
        });
      }
      document.addEventListener('click', () => {
        if (el.headerDropdown) el.headerDropdown.classList.remove('show');
        if (el.emojiDrawer) el.emojiDrawer.classList.remove('show');
      });

      // Timeline Scroll for Cursor Pagination
      if (el.timeline) {
        el.timeline.addEventListener('scroll', () => {
          if (el.timeline.scrollTop === 0 && this.hasMore && !this.isLoadingOlder) {
            this.loadOlderMessages();
          }
        });
      }

      // Composer Input and Auto-resize
      if (el.textarea) {
        el.textarea.addEventListener('input', () => this.handleTextareaInput());
        el.textarea.addEventListener('keydown', (e) => this.handleComposerKeydown(e));
      }

      // Send Button
      if (el.sendBtn) {
        el.sendBtn.addEventListener('click', () => this.sendMessage());
      }

      // Cancel Reply / Edit
      if (el.contextCancelBtn) {
        el.contextCancelBtn.addEventListener('click', () => this.cancelComposerContext());
      }

      // Emoji Toggle
      if (el.emojiToggleBtn) {
        el.emojiToggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          el.emojiDrawer.classList.toggle('show');
        });
      }

      // Populate Emojis
      this.populateEmojiDrawer();

      // User Search Modal
      if (el.userSearchCloseBtn) {
        el.userSearchCloseBtn.addEventListener('click', () => this.closeUserSearchModal());
      }
      if (el.userSearchInput) {
        el.userSearchInput.addEventListener('input', (e) => {
          clearTimeout(this.searchDebounceTimer);
          const q = e.target.value.trim();
          this.searchDebounceTimer = setTimeout(() => this.searchUsers(q), 300);
        });
      }

      // Dropdown Actions
      const clearBtn = document.getElementById('dmMenuClearBtn');
      if (clearBtn) clearBtn.addEventListener('click', () => this.openClearModal());

      const blockBtn = document.getElementById('dmMenuBlockBtn');
      if (blockBtn) blockBtn.addEventListener('click', () => this.openBlockModal());

      const reportBtn = document.getElementById('dmMenuReportBtn');
      if (reportBtn) reportBtn.addEventListener('click', () => this.openReportModal());

      if (el.unblockBtn) {
        el.unblockBtn.addEventListener('click', () => this.unblockActivePeer());
      }

      // Modal Cancel Buttons
      if (el.deleteCancelBtn) el.deleteCancelBtn.addEventListener('click', () => this.closeDeleteModal());
      if (el.clearCancelBtn) el.clearCancelBtn.addEventListener('click', () => this.closeClearModal());
      if (el.blockCancelBtn) el.blockCancelBtn.addEventListener('click', () => this.closeBlockModal());
      if (el.reportCancelBtn) el.reportCancelBtn.addEventListener('click', () => this.closeReportModal());
    }

    setupModeSwitcher() {
      // Exposed globally for onclick handler if needed
      window.switchChatMode = (mode) => this.switchMode(mode);
    }

    switchMode(mode) {
      if (!this.enabled && mode === 'dm') return;

      const el = this.elements;
      if (mode === 'dm') {
        if (el.modeBtnCohort) el.modeBtnCohort.classList.remove('active');
        if (el.modeBtnDm) el.modeBtnDm.classList.add('active');
        if (el.cohortChatMain) el.cohortChatMain.style.display = 'none';
        if (el.dmMain) el.dmMain.style.display = 'flex';

        if (window.roomClient && typeof window.roomClient.setActive === 'function') {
          window.roomClient.setActive(false);
        }
        this.open();
      } else {
        if (el.modeBtnCohort) el.modeBtnCohort.classList.add('active');
        if (el.modeBtnDm) el.modeBtnDm.classList.remove('active');
        if (el.cohortChatMain) el.cohortChatMain.style.display = 'flex';
        if (el.dmMain) el.dmMain.style.display = 'none';

        if (window.roomClient && typeof window.roomClient.setActive === 'function') {
          window.roomClient.setActive(true);
        }
      }
    }

    async open() {
      await this.loadConversations();
    }

    // --- Conversations List Management ---
    async loadConversations() {
      const el = this.elements;
      if (!el.convList) return;

      this.renderConversationSkeletons();
      try {
        const res = await fetch('/api/dm/conversations?limit=40', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load conversations');
        const data = await res.json();
        this.conversations = data.conversations || [];
        this.renderConversationList(this.conversations);
        this.updateTotalUnreadBadge();
      } catch (err) {
        console.error('[DM] Load conversations error:', err);
        this.renderConversationError();
      }
    }

    renderConversationSkeletons() {
      if (!this.elements.convList) return;
      this.elements.convList.innerHTML = Array(4).fill(0).map(() => `
        <div class="dm-skeleton-card">
          <div class="dm-skeleton-avatar"></div>
          <div class="dm-skeleton-lines">
            <div class="dm-skeleton-line short"></div>
            <div class="dm-skeleton-line long"></div>
          </div>
        </div>
      `).join('');
    }

    renderConversationError() {
      if (!this.elements.convList) return;
      this.elements.convList.innerHTML = `
        <div class="dm-empty-inbox">
          <div class="dm-empty-title">Could not load conversations</div>
          <div class="dm-empty-desc">Check your network connection and try again.</div>
          <button type="button" class="dm-btn-secondary" onclick="window.dmClient.loadConversations()">
            Retry
          </button>
        </div>
      `;
    }

    renderConversationList(list) {
      const el = this.elements;
      if (!el.convList) return;

      if (!list || list.length === 0) {
        el.convList.innerHTML = `
          <div class="dm-empty-inbox">
            <div class="dm-empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </div>
            <div class="dm-empty-title">No messages yet</div>
            <div class="dm-empty-desc">Connect with classmates, CRs, teachers, and admins privately.</div>
            <button type="button" class="dm-btn-primary" onclick="window.dmClient.openUserSearchModal()">
              New Message
            </button>
          </div>
        `;
        return;
      }

      el.convList.innerHTML = list.map(c => {
        const peer = c.participant || {};
        const isSelected = this.activeConversation && this.activeConversation.id === c.id;
        const unread = Number(c.unreadCount || 0);
        const lastMsg = c.lastMessage;
        let previewText = 'No messages yet';
        let isDeleted = false;
        if (lastMsg) {
          if (lastMsg.deletedForAll) {
            previewText = 'Message deleted';
            isDeleted = true;
          } else if (lastMsg.text) {
            const prefix = lastMsg.senderId === this.currentUser.studentId ? 'You: ' : '';
            previewText = prefix + lastMsg.text;
          }
        }

        const roleClass = (peer.role || '').toLowerCase();
        const roleLabel = peer.role ? peer.role.toUpperCase() : 'STUDENT';
        const avatarHtml = peer.avatarUrl
          ? `<img src="${escapeHtml(peer.avatarUrl)}" class="dm-avatar" alt="${escapeHtml(peer.name)}" />`
          : `<div class="dm-avatar">${escapeHtml(getInitials(peer.name))}</div>`;

        return `
          <div class="dm-conv-item ${isSelected ? 'active' : ''}" data-conv-id="${escapeHtml(c.id)}" onclick="window.dmClient.selectConversation('${escapeHtml(c.id)}')">
            <div class="dm-avatar-wrap">
              ${avatarHtml}
            </div>
            <div class="dm-conv-details">
              <div class="dm-conv-header">
                <div class="dm-conv-name-row">
                  <span class="dm-conv-name">${escapeHtml(peer.name || 'Unknown')}</span>
                  ${peer.role && peer.role !== 'student' ? `<span class="dm-role-badge ${escapeHtml(roleClass)}">${escapeHtml(roleLabel)}</span>` : ''}
                </div>
                <span class="dm-conv-time">${escapeHtml(formatRelativeTime(c.lastMessageAt || c.lastMessage?.createdAt))}</span>
              </div>
              <div class="dm-conv-preview-row">
                <span class="dm-conv-preview ${unread > 0 ? 'unread' : ''} ${isDeleted ? 'deleted' : ''}">${escapeHtml(previewText)}</span>
                ${unread > 0 ? `<span class="dm-unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    filterConversations(query) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) {
        this.renderConversationList(this.conversations);
        return;
      }
      const filtered = this.conversations.filter(c => {
        const peer = c.participant || {};
        const name = (peer.name || '').toLowerCase();
        const username = (peer.username || '').toLowerCase();
        const preview = (c.lastMessage?.text || '').toLowerCase();
        return name.includes(q) || username.includes(q) || preview.includes(q);
      });
      this.renderConversationList(filtered);
    }

    updateTotalUnreadBadge() {
      const total = this.conversations.reduce((sum, c) => sum + (Number(c.unreadCount) || 0), 0);
      const el = this.elements;
      if (el.globalUnreadBadge) {
        el.globalUnreadBadge.textContent = total > 99 ? '99+' : total;
        el.globalUnreadBadge.style.display = total > 0 ? 'inline-flex' : 'none';
      }
      if (el.tabUnreadBadge) {
        el.tabUnreadBadge.textContent = total > 99 ? '99+' : total;
        el.tabUnreadBadge.style.display = total > 0 ? 'inline-flex' : 'none';
      }
    }

    // --- Select & Open Conversation ---
    async selectConversation(convId) {
      const conv = this.conversations.find(c => c.id === convId);
      if (!conv) {
        await this.loadConversations();
        const fresh = this.conversations.find(c => c.id === convId);
        if (!fresh) return;
        return this.selectConversation(convId);
      }

      this.activeConversation = conv;
      this.peerLastReadMessageId = Number(conv.participant?.lastReadMessageId || 0);

      // Mobile view update
      if (this.elements.dmLayout) {
        this.elements.dmLayout.classList.add('in-conversation');
      }

      // Re-render conversation list items to update active highlight
      this.renderConversationList(this.conversations);

      // Render conversation header
      this.renderActiveHeader(conv);

      // Check blocked status
      this.updateBlockedUI(conv);

      // Load initial message history
      await this.loadMessages(conv.id);

      // Subscribe to Realtime channel
      this.subscribeRealtime(conv.id);

      // Mark conversation read
      this.markActiveConversationRead();
    }

    selectConversationById(convId) {
      return this.selectConversation(convId);
    }

    closeActiveConversationMobile() {
      if (this.elements.dmLayout) {
        this.elements.dmLayout.classList.remove('in-conversation');
      }
      this.unsubscribeRealtime();
      this.activeConversation = null;
      if (this.elements.noConvPlaceholder) this.elements.noConvPlaceholder.style.display = 'flex';
      if (this.elements.activeChatWrap) this.elements.activeChatWrap.style.display = 'none';
    }

    renderActiveHeader(conv) {
      const el = this.elements;
      const peer = conv.participant || {};

      if (el.noConvPlaceholder) el.noConvPlaceholder.style.display = 'none';
      if (el.activeChatWrap) el.activeChatWrap.style.display = 'flex';

      if (el.peerName) el.peerName.textContent = peer.name || 'Conversation';

      if (el.peerAvatar) {
        if (peer.avatarUrl) {
          el.peerAvatar.innerHTML = `<img src="${escapeHtml(peer.avatarUrl)}" class="dm-avatar-small" alt="${escapeHtml(peer.name)}" />`;
        } else {
          el.peerAvatar.innerHTML = `<div class="dm-avatar-small">${escapeHtml(getInitials(peer.name))}</div>`;
        }
      }

      if (el.peerRoleBadge) {
        if (peer.role && peer.role !== 'student') {
          el.peerRoleBadge.textContent = peer.role.toUpperCase();
          el.peerRoleBadge.className = `dm-role-badge ${peer.role.toLowerCase()}`;
          el.peerRoleBadge.style.display = 'inline-block';
        } else {
          el.peerRoleBadge.style.display = 'none';
        }
      }

      if (el.peerStatusText) {
        el.peerStatusText.textContent = conv.blocked ? 'Blocked' : '';
        el.peerStatusText.classList.remove('typing');
      }

      // Update Block button label in menu
      const blockBtn = document.getElementById('dmMenuBlockBtn');
      if (blockBtn) {
        blockBtn.textContent = conv.blockedByMe ? 'Unblock User' : 'Block User';
      }
    }

    updateBlockedUI(conv) {
      const el = this.elements;
      const isBlocked = Boolean(conv.blocked);
      if (el.blockedBanner && el.composerWrap) {
        if (isBlocked) {
          el.blockedBanner.style.display = 'flex';
          el.composerWrap.querySelector('.dm-composer-bar').style.display = 'none';
          if (el.contextBar) el.contextBar.style.display = 'none';
          const bannerText = el.blockedBanner.querySelector('span');
          if (bannerText) {
            bannerText.textContent = conv.blockedByMe
              ? 'You have blocked this user. Unblock to send messages.'
              : 'You cannot reply to this conversation.';
          }
          if (el.unblockBtn) {
            el.unblockBtn.style.display = conv.blockedByMe ? 'inline-flex' : 'none';
          }
        } else {
          el.blockedBanner.style.display = 'none';
          el.composerWrap.querySelector('.dm-composer-bar').style.display = 'flex';
        }
      }
    }

    // --- Message History ---
    async loadMessages(convId) {
      if (this.isLoadingMessages) return;
      this.isLoadingMessages = true;

      const el = this.elements;
      if (el.timeline) {
        el.timeline.innerHTML = `
          <div class="dm-timeline-loader">
            <span>Loading messages...</span>
          </div>
        `;
      }

      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(convId)}/messages?limit=40`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load message history');
        const data = await res.json();
        this.messages = data.messages || [];
        this.hasMore = Boolean(data.hasMore);
        this.renderTimeline();
        this.scrollToBottom(false);
      } catch (err) {
        console.error('[DM] Messages fetch error:', err);
        if (el.timeline) {
          el.timeline.innerHTML = `
            <div class="dm-empty-inbox">
              <div class="dm-empty-title">Error loading messages</div>
              <button type="button" class="dm-btn-secondary" onclick="window.dmClient.loadMessages('${escapeHtml(convId)}')">Retry</button>
            </div>
          `;
        }
      } finally {
        this.isLoadingMessages = false;
      }
    }

    async loadOlderMessages() {
      if (this.isLoadingOlder || !this.hasMore || !this.activeConversation || this.messages.length === 0) return;
      this.isLoadingOlder = true;

      const el = this.elements;
      if (el.timelineLoader) el.timelineLoader.style.display = 'flex';

      const oldestId = this.messages[0].id;
      const scrollHeightBefore = el.timeline.scrollHeight;

      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(this.activeConversation.id)}/messages?limit=40&before=${oldestId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load older messages');
        const data = await res.json();
        const older = data.messages || [];
        this.hasMore = Boolean(data.hasMore);

        if (older.length > 0) {
          // Prepend deduplicated older messages
          const existingIds = new Set(this.messages.map(m => m.id));
          const uniqueOlder = older.filter(m => !existingIds.has(m.id));
          this.messages = uniqueOlder.concat(this.messages);
          this.renderTimeline();

          // Restore scroll position
          const scrollDiff = el.timeline.scrollHeight - scrollHeightBefore;
          el.timeline.scrollTop = scrollDiff;
        }
      } catch (err) {
        console.error('[DM] Load older messages error:', err);
      } finally {
        this.isLoadingOlder = false;
        if (el.timelineLoader) el.timelineLoader.style.display = 'none';
      }
    }

    renderTimeline() {
      const el = this.elements;
      if (!el.timeline) return;

      if (this.messages.length === 0) {
        el.timeline.innerHTML = `
          <div class="dm-empty-inbox" style="margin-top: 60px;">
            <div class="dm-empty-title">No messages in this chat yet</div>
            <div class="dm-empty-desc">Send a greeting to start the conversation!</div>
          </div>
        `;
        return;
      }

      let html = '';
      let lastDateStr = '';

      for (let i = 0; i < this.messages.length; i++) {
        const msg = this.messages[i];
        const prevMsg = i > 0 ? this.messages[i - 1] : null;
        const nextMsg = i < this.messages.length - 1 ? this.messages[i + 1] : null;
        const dateStr = formatDateSeparator(msg.createdAt);

        if (dateStr && dateStr !== lastDateStr) {
          html += `
            <div class="dm-date-separator">
              <span class="dm-date-badge">${escapeHtml(dateStr)}</span>
            </div>
          `;
          lastDateStr = dateStr;
        }

        html += this.buildMessageRowHtml(msg, prevMsg, nextMsg);
      }

      el.timeline.innerHTML = html;
    }

    buildMessageRowHtml(msg, prevMsg = null, nextMsg = null) {
      const isSelf = msg.senderId === this.currentUser.studentId;
      let rowClass = isSelf ? 'self' : 'peer';
      const isDeleted = Boolean(msg.deletedForAll);
      const isEdited = Boolean(msg.isEdited);

      const isSamePrev = Boolean(
        prevMsg &&
        prevMsg.senderId === msg.senderId &&
        formatDateSeparator(prevMsg.createdAt) === formatDateSeparator(msg.createdAt)
      );
      const isSameNext = Boolean(
        nextMsg &&
        nextMsg.senderId === msg.senderId &&
        formatDateSeparator(nextMsg.createdAt) === formatDateSeparator(msg.createdAt)
      );

      if (isSamePrev) rowClass += ' same-prev';
      if (isSameNext) rowClass += ' same-next';

      // Read status (Seen vs Sent)
      let readReceiptHtml = '';
      if (isSelf && !isDeleted) {
        const isSeen = Number(this.peerLastReadMessageId) >= Number(msg.id);
        readReceiptHtml = isSeen
          ? `<span class="dm-read-status seen" title="Seen">✓✓</span>`
          : `<span class="dm-read-status sent" title="Sent">✓</span>`;
      }

      // Reply Quote Block
      let replyQuoteHtml = '';
      if (msg.replyTo && !isDeleted) {
        const r = msg.replyTo;
        const replyText = r.deletedForAll ? 'Message deleted' : (r.text || '');
        replyQuoteHtml = `
          <div class="dm-reply-quote" onclick="window.dmClient.scrollToMessage(${r.id})">
            <div class="dm-reply-quote-sender">${escapeHtml(r.senderName || 'Original message')}</div>
            <div class="dm-reply-quote-text">${escapeHtml(replyText)}</div>
          </div>
        `;
      }

      // Actions Menu (Hover/Tap)
      let actionsHtml = '';
      if (!isDeleted) {
        actionsHtml = `
          <div class="dm-msg-actions">
            <button type="button" class="dm-action-btn" title="Reply" onclick="window.dmClient.startReply(${msg.id})">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            </button>
            ${isSelf ? `
              <button type="button" class="dm-action-btn" title="Edit" onclick="window.dmClient.startEdit(${msg.id})">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              </button>
            ` : ''}
            <button type="button" class="dm-action-btn" title="Delete" onclick="window.dmClient.openDeleteModal(${msg.id}, ${isSelf})">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            ${!isSelf ? `
              <button type="button" class="dm-action-btn" title="Report" onclick="window.dmClient.openReportModal(${msg.id})">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              </button>
            ` : ''}
          </div>
        `;
      }

      const bubbleContent = isDeleted
        ? `<span class="dm-bubble-text">This message was deleted</span>`
        : `${replyQuoteHtml}<span class="dm-bubble-text">${escapeHtml(msg.text)}</span>`;

      return `
        <div class="dm-msg-row ${rowClass}" id="dmMsgRow_${msg.id}" data-msg-id="${msg.id}">
          <div class="dm-msg-bubble-wrap">
            ${actionsHtml}
            <div class="dm-bubble ${isDeleted ? 'deleted' : ''}">
              ${bubbleContent}
              <div class="dm-bubble-meta">
                ${isEdited && !isDeleted ? `<span class="dm-edited-tag">(edited)</span>` : ''}
                <span>${escapeHtml(formatTime(msg.createdAt))}</span>
                ${readReceiptHtml}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    scrollToBottom(smooth = true) {
      const el = this.elements.timeline;
      if (!el) return;
      if (smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    }

    scrollToMessage(msgId) {
      const row = document.getElementById(`dmMsgRow_${msgId}`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('highlight');
        setTimeout(() => row.classList.remove('highlight'), 2000);
      }
    }

    // --- Composer & Message Operations ---
    handleTextareaInput() {
      const el = this.elements;
      if (!el.textarea) return;

      // Auto-expand height
      el.textarea.style.height = 'auto';
      el.textarea.style.height = `${Math.min(el.textarea.scrollHeight, 140)}px`;

      const text = el.textarea.value;
      const len = text.length;

      // Character counter
      if (el.charCounter) {
        if (len > 1500) {
          el.charCounter.style.display = 'block';
          el.charCounter.textContent = `${len}/2000`;
          el.charCounter.className = 'dm-char-counter' + (len > 2000 ? ' exceeded' : len > 1900 ? ' warning' : '');
        } else {
          el.charCounter.style.display = 'none';
        }
      }

      // Send Button state
      if (el.sendBtn) {
        el.sendBtn.disabled = !text.trim() || len > 2000;
      }

      // Broadcast Typing Indicator (throttled)
      if (text.trim() && this.activeConversation) {
        this.throttleBroadcastTyping();
      }
    }

    handleComposerKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.sendMessage();
      }
    }

    throttleBroadcastTyping() {
      const now = Date.now();
      if (now - this.lastTypingSentAt < 2500) return;
      this.lastTypingSentAt = now;

      if (!this.activeConversation) return;
      fetch(`/api/dm/conversations/${encodeURIComponent(this.activeConversation.id)}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping: true }),
      }).catch(() => {});
    }

    async sendMessage() {
      const el = this.elements;
      if (!el.textarea || !this.activeConversation) return;

      const rawText = el.textarea.value.trim();
      if (!rawText || rawText.length > 2000) return;

      // If in editing mode, dispatch edit instead
      if (this.editingMessage) {
        return this.submitEdit(rawText);
      }

      const clientId = (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const replyToId = this.replyingTo ? this.replyingTo.id : null;
      const convId = this.activeConversation.id;

      // Optimistic message object
      const optimisticMsg = {
        id: `opt_${clientId}`,
        conversationId: convId,
        senderId: this.currentUser.studentId,
        senderName: this.currentUser.name,
        clientId,
        text: rawText,
        replyTo: this.replyingTo ? {
          id: this.replyingTo.id,
          text: this.replyingTo.text,
          senderName: this.replyingTo.senderName || 'Peer',
        } : null,
        isEdited: false,
        deletedForAll: false,
        createdAt: new Date().toISOString(),
        isOptimistic: true,
      };

      // Render optimistic message immediately
      this.messages.push(optimisticMsg);
      this.renderTimeline();
      this.scrollToBottom(true);

      // Clear composer & reply context
      el.textarea.value = '';
      el.textarea.style.height = 'auto';
      if (el.sendBtn) el.sendBtn.disabled = true;
      this.cancelComposerContext();

      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(convId)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            text: rawText,
            replyToId,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to send message');
        }

        const data = await res.json();
        const serverMsg = data.message;

        // Replace optimistic message with confirmed server message
        const idx = this.messages.findIndex(m => m.clientId === clientId || m.id === optimisticMsg.id);
        if (idx !== -1) {
          this.messages[idx] = serverMsg;
        } else {
          this.messages.push(serverMsg);
        }

        // Re-render to finalize confirmed server ID and state
        this.renderTimeline();

        // Update conversation list preview
        this.updateConversationPreview(convId, serverMsg);
      } catch (err) {
        console.error('[DM] Send message failure:', err);
        // Rollback optimistic message on failure
        this.messages = this.messages.filter(m => m.clientId !== clientId && m.id !== optimisticMsg.id);
        this.renderTimeline();
        alert(err.message || 'Could not send message. Please try again.');
      }
    }

    startReply(msgId) {
      const msg = this.messages.find(m => m.id === msgId);
      if (!msg) return;

      this.cancelComposerContext();
      this.replyingTo = msg;

      const el = this.elements;
      if (el.contextBar) {
        el.contextBar.style.display = 'flex';
        el.contextTitle.textContent = `Replying to ${msg.senderId === this.currentUser.studentId ? 'yourself' : (msg.senderName || 'peer')}`;
        el.contextSnippet.textContent = msg.text || '';
      }
      if (el.textarea) el.textarea.focus();
    }

    startEdit(msgId) {
      const msg = this.messages.find(m => m.id === msgId && m.senderId === this.currentUser.studentId);
      if (!msg || msg.deletedForAll) return;

      this.cancelComposerContext();
      this.editingMessage = msg;

      const el = this.elements;
      if (el.contextBar) {
        el.contextBar.style.display = 'flex';
        el.contextTitle.textContent = 'Editing message';
        el.contextSnippet.textContent = msg.text || '';
      }
      if (el.textarea) {
        el.textarea.value = msg.text || '';
        this.handleTextareaInput();
        el.textarea.focus();
      }
    }

    async submitEdit(newText) {
      const msg = this.editingMessage;
      if (!msg || !this.activeConversation) return;

      const originalText = msg.text;
      const convId = this.activeConversation.id;

      // Optimistically update
      msg.text = newText;
      msg.isEdited = true;
      this.renderTimeline();
      this.cancelComposerContext();

      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(convId)}/messages/${msg.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: newText }),
        });

        if (!res.ok) throw new Error('Edit failed');
        const data = await res.json();
        const updated = data.message;
        const idx = this.messages.findIndex(m => m.id === msg.id);
        if (idx !== -1) this.messages[idx] = updated;
        this.renderTimeline();
      } catch (err) {
        console.error('[DM] Edit message error:', err);
        msg.text = originalText; // rollback
        this.renderTimeline();
        alert('Could not edit message.');
      }
    }

    cancelComposerContext() {
      this.replyingTo = null;
      this.editingMessage = null;
      if (this.elements.contextBar) this.elements.contextBar.style.display = 'none';
      if (this.elements.textarea && this.editingMessage) {
        this.elements.textarea.value = '';
        this.handleTextareaInput();
      }
    }

    // --- Message Deletion Modal ---
    openDeleteModal(msgId, isAuthor) {
      this.targetDeleteMsgId = msgId;
      const el = this.elements;
      if (!el.deleteModal) return;

      if (el.deleteForEveryoneBtn) {
        el.deleteForEveryoneBtn.style.display = isAuthor ? 'inline-flex' : 'none';
        el.deleteForEveryoneBtn.onclick = () => this.confirmDelete('for_everyone');
      }
      if (el.deleteForMeBtn) {
        el.deleteForMeBtn.onclick = () => this.confirmDelete('for_me');
      }

      el.deleteModal.style.display = 'flex';
    }

    closeDeleteModal() {
      if (this.elements.deleteModal) this.elements.deleteModal.style.display = 'none';
      this.targetDeleteMsgId = null;
    }

    async confirmDelete(mode) {
      const msgId = this.targetDeleteMsgId;
      if (!msgId || !this.activeConversation) return;
      this.closeDeleteModal();

      const convId = this.activeConversation.id;
      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(convId)}/messages/${msgId}?mode=${mode}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('Delete failed');

        if (mode === 'for_everyone') {
          const m = this.messages.find(x => x.id === msgId);
          if (m) {
            m.deletedForAll = true;
            m.text = null;
          }
        } else {
          this.messages = this.messages.filter(x => x.id !== msgId);
        }
        this.renderTimeline();
      } catch (err) {
        console.error('[DM] Delete message error:', err);
        alert('Could not delete message.');
      }
    }

    // --- Clear Conversation Modal ---
    openClearModal() {
      if (this.elements.clearModal) {
        this.elements.clearModal.style.display = 'flex';
        this.elements.clearConfirmBtn.onclick = () => this.confirmClearConversation();
      }
    }

    closeClearModal() {
      if (this.elements.clearModal) this.elements.clearModal.style.display = 'none';
    }

    async confirmClearConversation() {
      if (!this.activeConversation) return;
      this.closeClearModal();

      const convId = this.activeConversation.id;
      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(convId)}/clear`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error('Clear conversation failed');

        this.messages = [];
        this.renderTimeline();
        await this.loadConversations();
      } catch (err) {
        console.error('[DM] Clear conversation error:', err);
        alert('Could not clear conversation.');
      }
    }

    // --- Blocking & Unblocking ---
    openBlockModal() {
      if (!this.activeConversation) return;
      const peer = this.activeConversation.participant || {};
      const el = this.elements;
      if (el.blockModal) {
        const title = el.blockModal.querySelector('.dm-modal-title');
        if (title) title.textContent = `Block ${peer.name || 'User'}?`;
        el.blockModal.style.display = 'flex';
        el.blockConfirmBtn.onclick = () => this.confirmBlockPeer();
      }
    }

    closeBlockModal() {
      if (this.elements.blockModal) this.elements.blockModal.style.display = 'none';
    }

    async confirmBlockPeer() {
      if (!this.activeConversation) return;
      const peerId = this.activeConversation.participant?.studentId;
      if (!peerId) return;
      this.closeBlockModal();

      try {
        const res = await fetch(`/api/dm/users/${encodeURIComponent(peerId)}/block`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error('Block failed');

        this.activeConversation.blocked = true;
        this.activeConversation.blockedByMe = true;
        this.updateBlockedUI(this.activeConversation);
        this.unsubscribeRealtime();
      } catch (err) {
        console.error('[DM] Block user error:', err);
        alert('Could not block user.');
      }
    }

    async unblockActivePeer() {
      if (!this.activeConversation) return;
      const peerId = this.activeConversation.participant?.studentId;
      if (!peerId) return;

      try {
        const res = await fetch(`/api/dm/users/${encodeURIComponent(peerId)}/block`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('Unblock failed');

        this.activeConversation.blocked = false;
        this.activeConversation.blockedByMe = false;
        this.updateBlockedUI(this.activeConversation);
        this.subscribeRealtime(this.activeConversation.id);
      } catch (err) {
        console.error('[DM] Unblock user error:', err);
        alert('Could not unblock user.');
      }
    }

    // --- Reporting ---
    openReportModal(targetMsgId = null) {
      if (!this.activeConversation) return;
      this.reportTargetMsgId = targetMsgId;
      const el = this.elements;
      if (el.reportModal) {
        el.reportModal.style.display = 'flex';
        el.reportSubmitBtn.onclick = () => this.submitReport();
      }
    }

    closeReportModal() {
      if (this.elements.reportModal) this.elements.reportModal.style.display = 'none';
      this.reportTargetMsgId = null;
    }

    async submitReport() {
      if (!this.activeConversation) return;
      const el = this.elements;
      const reason = el.reportReasonSelect.value;
      const description = el.reportDescInput.value.trim();
      const peerId = this.activeConversation.participant?.studentId;
      const reportedMessageId = this.reportTargetMsgId;

      this.closeReportModal();

      try {
        const res = await fetch('/api/dm/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: this.activeConversation.id,
            reportedUserId: peerId,
            reportedMessageId: reportedMessageId !== null && reportedMessageId !== undefined ? reportedMessageId : undefined,
            reason,
            description,
          }),
        });

        if (!res.ok) throw new Error('Report submission failed');
        alert('Thank you. Your report has been submitted to moderators.');
      } catch (err) {
        console.error('[DM] Report error:', err);
        alert('Could not submit report. Please try again.');
      }
    }

    // --- Read Receipts ---
    async markActiveConversationRead() {
      if (!this.activeConversation || this.messages.length === 0) return;
      const lastMsg = this.messages[this.messages.length - 1];
      if (!lastMsg || !lastMsg.id || String(lastMsg.id).startsWith('opt_')) return;

      const convId = this.activeConversation.id;
      try {
        await fetch(`/api/dm/conversations/${encodeURIComponent(convId)}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lastReadMessageId: lastMsg.id }),
        });

        // Clear local unread badge on active conversation
        this.activeConversation.unreadCount = 0;
        this.renderConversationList(this.conversations);
        this.updateTotalUnreadBadge();
      } catch {}
    }

    // --- User Search Directory Modal ---
    openUserSearchModal() {
      const el = this.elements;
      if (!el.userSearchModal) return;
      el.userSearchModal.style.display = 'flex';
      if (el.userSearchInput) {
        el.userSearchInput.value = '';
        el.userSearchInput.focus();
      }
      if (el.userSearchResults) {
        el.userSearchResults.innerHTML = `
          <div class="dm-empty-desc" style="text-align: center; padding: 20px;">
            Type a name or username to find students, teachers, and admins.
          </div>
        `;
      }
    }

    closeUserSearchModal() {
      if (this.elements.userSearchModal) this.elements.userSearchModal.style.display = 'none';
    }

    async searchUsers(query) {
      const el = this.elements;
      if (!el.userSearchResults) return;

      if (!query) {
        el.userSearchResults.innerHTML = `
          <div class="dm-empty-desc" style="text-align: center; padding: 20px;">
            Type a name or username to find students, teachers, and admins.
          </div>
        `;
        return;
      }

      el.userSearchResults.innerHTML = `
        <div class="dm-timeline-loader"><span>Searching...</span></div>
      `;

      try {
        const res = await fetch(`/api/dm/users/search?q=${encodeURIComponent(query)}&limit=20`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        const users = data.users || [];

        if (users.length === 0) {
          el.userSearchResults.innerHTML = `
            <div class="dm-empty-desc" style="text-align: center; padding: 20px;">
              No users found matching "${escapeHtml(query)}"
            </div>
          `;
          return;
        }

        el.userSearchResults.innerHTML = users.map(u => {
          const roleClass = (u.role || '').toLowerCase();
          const roleLabel = u.role ? u.role.toUpperCase() : 'STUDENT';
          const avatarHtml = u.avatarUrl
            ? `<img src="${escapeHtml(u.avatarUrl)}" class="dm-avatar-small" alt="${escapeHtml(u.name)}" />`
            : `<div class="dm-avatar-small">${escapeHtml(getInitials(u.name))}</div>`;

          return `
            <div class="dm-user-search-item" onclick="window.dmClient.startConversationWithUser('${escapeHtml(u.studentId)}')">
              ${avatarHtml}
              <div class="dm-user-search-info">
                <span class="dm-user-search-name">${escapeHtml(u.name)}</span>
                <div class="dm-user-search-meta">
                  ${u.username ? `<span>@${escapeHtml(u.username)}</span> • ` : ''}
                  <span class="dm-role-badge ${escapeHtml(roleClass)}">${escapeHtml(roleLabel)}</span>
                </div>
              </div>
            </div>
          `;
        }).join('');
      } catch (err) {
        console.error('[DM] User search error:', err);
        el.userSearchResults.innerHTML = `
          <div class="dm-empty-desc" style="text-align: center; padding: 20px; color: #ff8888;">
            Search request failed.
          </div>
        `;
      }
    }

    async startConversationWithUser(targetUserId) {
      this.closeUserSearchModal();
      try {
        const res = await fetch('/api/dm/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUserId }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Could not start conversation');
        }

        const data = await res.json();
        const conv = data.conversation;

        await this.loadConversations();
        await this.selectConversation(conv.id);
      } catch (err) {
        console.error('[DM] Start conversation error:', err);
        alert(err.message || 'Could not start conversation.');
      }
    }

    // --- Emoji Drawer ---
    populateEmojiDrawer() {
      const el = this.elements.emojiDrawer;
      if (!el) return;

      const emojis = [
        '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇',
        '🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
        '😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩',
        '🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣',
        '😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬',
        '👍','👎','👏','🙌','👐','🤲','🤝','🙏','✌️','🤞',
        '🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚',
        '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
        '🔥','✨','🎉','🚀','💯','⭐','🌟','⚡','💡','📚'
      ];

      el.innerHTML = `
        <div class="dm-emoji-grid">
          ${emojis.map(e => `<span class="dm-emoji-item" onclick="window.dmClient.insertEmoji('${e}')">${e}</span>`).join('')}
        </div>
      `;
    }

    insertEmoji(emoji) {
      const textarea = this.elements.textarea;
      if (!textarea) return;

      const start = textarea.selectionStart || textarea.value.length;
      const end = textarea.selectionEnd || textarea.value.length;
      const text = textarea.value;

      textarea.value = text.slice(0, start) + emoji + text.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
      this.handleTextareaInput();
      textarea.focus();
    }

    // --- Supabase Realtime Integration ---
    async subscribeRealtime(conversationId) {
      this.unsubscribeRealtime();

      if (!root.supabase || typeof root.supabase.createClient !== 'function') {
        console.warn('[DM] Supabase client library not found on page.');
        return;
      }

      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(conversationId)}/realtime-config`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Realtime config fetch failed');
        const config = await res.json();

        // Create or reuse scoped client
        const supabaseTargetUrl = config.supabaseUrl || config.url;
        const supabaseAuthToken = config.token || config.key;
        this.supabaseClient = root.supabase.createClient(supabaseTargetUrl, supabaseAuthToken, {
          auth: { credentials: { persistSession: false, autoRefreshToken: false } },
          realtime: { params: { apikey: supabaseAuthToken } }
        });

        const channel = this.supabaseClient.channel(config.topic, {
          config: {
            broadcast: { self: false, ack: false },
            private: true,
          }
        });

        // 1. New Message
        channel.on('broadcast', { event: 'dm:message:new' }, (payload) => {
          this.handleRealtimeNewMessage(payload.payload || payload);
        });

        // 2. Edited Message
        channel.on('broadcast', { event: 'dm:message:edited' }, (payload) => {
          this.handleRealtimeEditedMessage(payload.payload || payload);
        });

        // 3. Deleted Message
        channel.on('broadcast', { event: 'dm:message:deleted' }, (payload) => {
          this.handleRealtimeDeletedMessage(payload.payload || payload);
        });

        // 4. Read Receipt Update
        channel.on('broadcast', { event: 'dm:read:updated' }, (payload) => {
          this.handleRealtimeReadReceipt(payload.payload || payload);
        });

        // 5. Ephemeral Typing Indicator
        channel.on('broadcast', { event: 'dm:typing' }, (payload) => {
          this.handleRealtimeTyping(payload.payload || payload);
        });

        channel.subscribe((status) => {
          this.updateConnectionStatus(status === 'SUBSCRIBED');
        });

        this.realtimeChannel = channel;
      } catch (err) {
        console.warn('[DM Realtime] Subscription error:', err.message);
        this.updateConnectionStatus(false);
      }
    }

    unsubscribeRealtime() {
      if (this.realtimeChannel && this.supabaseClient) {
        try {
          this.supabaseClient.removeChannel(this.realtimeChannel);
        } catch {}
      }
      this.realtimeChannel = null;
    }

    handleRealtimeNewMessage(event) {
      if (!event || !event.message) return;
      const msg = event.message;
      const convId = event.conversationId;

      // Update conversation list preview
      this.updateConversationPreview(convId, msg);

      // If active conversation matches
      if (this.activeConversation && this.activeConversation.id === convId) {
        // Deduplicate against optimistic or already rendered message
        const exists = this.messages.some(m => m.id === msg.id || (msg.clientId && m.clientId === msg.clientId));
        if (!exists) {
          this.messages.push(msg);
          this.renderTimeline();
          this.scrollToBottom(true);
        }

        // Send read receipt if peer message and window active
        if (msg.senderId !== this.currentUser.studentId && !document.hidden) {
          this.markActiveConversationRead();
        }
      } else {
        // Increment unread count in inbox list
        const c = this.conversations.find(x => x.id === convId);
        if (c) {
          c.unreadCount = (Number(c.unreadCount) || 0) + 1;
          this.renderConversationList(this.conversations);
          this.updateTotalUnreadBadge();
        }
      }
    }

    handleRealtimeEditedMessage(event) {
      if (!event || !event.messageId) return;
      const msgId = Number(event.messageId);

      if (this.activeConversation && this.activeConversation.id === event.conversationId) {
        const m = this.messages.find(x => x.id === msgId);
        if (m) {
          m.text = event.text;
          m.isEdited = true;
          this.renderTimeline();
        }
      }
    }

    handleRealtimeDeletedMessage(event) {
      if (!event || !event.messageId) return;
      const msgId = Number(event.messageId);

      if (this.activeConversation && this.activeConversation.id === event.conversationId) {
        const m = this.messages.find(x => x.id === msgId);
        if (m) {
          m.deletedForAll = true;
          m.text = null;
          this.renderTimeline();
        }
      }
    }

    handleRealtimeReadReceipt(event) {
      if (!event || !this.activeConversation || this.activeConversation.id !== event.conversationId) return;
      if (event.readerId === this.currentUser.studentId) return;

      this.peerLastReadMessageId = Number(event.lastReadMessageId || 0);
      this.renderTimeline();
    }

    handleRealtimeTyping(event) {
      if (!event || !this.activeConversation || this.activeConversation.id !== event.conversationId) return;
      if (event.studentId === this.currentUser.studentId) return;

      const el = this.elements;
      if (event.isTyping) {
        if (el.peerStatusText) {
          el.peerStatusText.textContent = 'Typing...';
          el.peerStatusText.classList.add('typing');
        }
        clearTimeout(this.peerTypingTimeout);
        this.peerTypingTimeout = setTimeout(() => {
          if (el.peerStatusText) {
            el.peerStatusText.textContent = this.activeConversation?.blocked ? 'Blocked' : '';
            el.peerStatusText.classList.remove('typing');
          }
        }, 4000);
      } else {
        if (el.peerStatusText) {
          el.peerStatusText.textContent = this.activeConversation?.blocked ? 'Blocked' : '';
          el.peerStatusText.classList.remove('typing');
        }
      }
    }

    updateConversationPreview(convId, msg) {
      const conv = this.conversations.find(c => c.id === convId);
      if (conv) {
        conv.lastMessage = msg;
        conv.lastMessageAt = msg.createdAt;
        // Sort conversations list to place active chat at the top
        this.conversations.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
        this.renderConversationList(this.conversations);
      }
    }

    updateConnectionStatus(connected) {
      const el = this.elements;
      if (el.connBanner) {
        if (connected) {
          el.connBanner.style.display = 'none';
        } else {
          el.connBanner.style.display = 'flex';
          el.connBanner.textContent = 'Connecting to real-time updates...';
        }
      }
      if (el.peerStatusDot) {
        el.peerStatusDot.className = 'dm-status-dot' + (connected ? ' online' : '');
      }
    }

    // --- Offline Reconnection & Delta Sync ---
    handleNetworkChange(online) {
      this.isOnline = online;
      this.updateConnectionStatus(online);
      if (online && this.activeConversation) {
        this.syncActiveConversation();
      }
    }

    async syncActiveConversation() {
      if (!this.activeConversation) return;
      const convId = this.activeConversation.id;

      // Find max known message ID
      let maxId = 0;
      for (const m of this.messages) {
        const idNum = Number(m.id);
        if (!isNaN(idNum) && idNum > maxId) maxId = idNum;
      }

      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(convId)}/sync?sinceMessageId=${maxId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const delta = await res.json();

        let updated = false;

        // Reconcile new messages
        if (delta.messages && delta.messages.length > 0) {
          const existingIds = new Set(this.messages.map(m => m.id));
          for (const m of delta.messages) {
            if (!existingIds.has(m.id)) {
              this.messages.push(m);
              updated = true;
            }
          }
        }

        // Reconcile edits
        if (delta.edits && delta.edits.length > 0) {
          for (const edit of delta.edits) {
            const m = this.messages.find(x => x.id === edit.messageId);
            if (m && m.text !== edit.text) {
              m.text = edit.text;
              m.isEdited = true;
              updated = true;
            }
          }
        }

        // Reconcile deletions
        if (delta.deletions && delta.deletions.length > 0) {
          for (const del of delta.deletions) {
            const m = this.messages.find(x => x.id === del.messageId);
            if (m && !m.deletedForAll) {
              m.deletedForAll = true;
              m.text = null;
              updated = true;
            }
          }
        }

        // Reconcile read receipts
        if (delta.peerLastReadMessageId && delta.peerLastReadMessageId > this.peerLastReadMessageId) {
          this.peerLastReadMessageId = delta.peerLastReadMessageId;
          updated = true;
        }

        if (updated) {
          this.renderTimeline();
          this.scrollToBottom(true);
        }
      } catch (err) {
        console.warn('[DM] Sync delta error:', err.message);
      }
    }

    clearAccountData() {
      if (this.cacheKey) {
        try { localStorage.removeItem(this.cacheKey); } catch {}
      }
      this.unsubscribeRealtime();
      this.conversations = [];
      this.messages = [];
      this.activeConversation = null;
    }
  }

  // Instantiate singleton
  const client = new DmClient();
  root.dmClient = client;

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (root.currentStudent) {
        client.init(root.currentStudent);
      }
    });
  } else {
    if (root.currentStudent) {
      client.init(root.currentStudent);
    }
  }

})(typeof window !== 'undefined' ? window : globalThis);
