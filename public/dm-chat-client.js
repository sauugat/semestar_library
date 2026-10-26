/**
 * Semester Library — Universal Private Messaging (DM) Web Client
 * Production Realtime, Optimistic UI, Typing Indicator & State Synchronization Engine
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

  function parseIsoDate(iso) {
    if (!iso) return new Date(NaN);
    if (iso instanceof Date) return iso;
    const str = String(iso).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
      return new Date(str.replace(' ', 'T') + 'Z');
    }
    return new Date(str);
  }

  function formatTime(iso) {
    if (!iso) return '';
    const date = parseIsoDate(iso);
    if (isNaN(date.getTime())) return '';
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    const date = parseIsoDate(iso);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = Math.max(0, now - date);
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
    const date = parseIsoDate(iso);
    if (isNaN(date.getTime())) return '';
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
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatMessageBodyHtml(rawText) {
    if (!rawText) return '';
    return String(rawText)
      .split(/(https?:\/\/[^\s<>"']+)/g)
      .map(part => {
        if (/^https?:\/\//i.test(part)) {
          const safeUrl = escapeHtml(part);
          return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="dm-link">${safeUrl}</a>`;
        }
        return escapeHtml(part);
      })
      .join('');
  }

  // --- DmClient Class ---
  class DmClient {
    constructor() {
      this.enabled = false;
      this.currentUser = null;
      this.currentMode = 'cohort';
      this.conversations = [];
      this.activeConversation = null;
      this.messages = [];
      this.hasMore = false;
      this.isLoadingMessages = false;
      this.isLoadingOlder = false;
      this.loadMessagesSeq = 0;
      this.replyingTo = null;
      this.editingMessage = null;
      this.searchDebounceTimer = null;
      this.searchRequestId = 0;
      this.searchAbortController = null;

      // Typing state
      this.typingThrottleTimer = null;
      this.localTypingStopTimer = null;
      this.peerTypingTimeout = null;
      this.lastTypingSentAt = 0;
      this.isCurrentlyTyping = false;
      this.isPeerTyping = false;

      // Realtime state
      this.realtimeChannel = null;
      this.supabaseClient = null;
      this.realtimeAttempt = 0;
      this.realtimeRenewalTimer = null;
      this.realtimeReconnectTimer = null;
      this.realtimeRetryCount = 0;
      this.realtimeConnected = false;
      this.processedEventIds = new Set();
      this.backgroundSyncTimer = null;
      this.lastSyncTimestamp = null;

      // Read receipt & scroll state
      this.peerLastReadMessageId = 0;
      this.lastAcknowledgedReadByConv = new Map();
      this.readRequestInFlight = false;
      this.unreadWhileScrolledUp = 0;
      this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

      // Optimistic outbox tracking
      this.pendingSends = new Map(); // clientId -> optimisticMsg
      this.inFlightClientIds = new Set();
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
        if (document.hidden) {
          this.stopTypingBroadcast();
        } else {
          if (this.activeConversation) {
            void this.syncActiveConversation();
            if (!this.realtimeConnected) {
              void this.subscribeRealtime(this.activeConversation.id);
            }
            if (this.isNearBottom()) {
              void this.markActiveConversationRead();
            }
          }
          if (this.currentMode === 'dm') {
            void this.refreshConversationsSilent();
          }
        }
      });
      window.addEventListener('storage', (e) => {
        if (e.key && /auth|session|logout|user/i.test(e.key)) {
          this.clearAccountData();
        }
      });

      // Check URL parameters for direct conversation or user profile message navigation
      const params = new URLSearchParams(window.location.search || '');
      const tab = params.get('tab');
      const convId = params.get('conversationId') || params.get('dm');
      const targetUser = params.get('user') || params.get('directStudentId') || params.get('targetUserId');
      if (tab === 'dm' || convId || targetUser) {
        this.switchMode('dm');
        if (targetUser) {
          await this.startConversationWithUser(targetUser);
        } else if (convId) {
          await this.loadConversations();
          await this.selectConversationById(convId);
        }
      } else if (root.supabase && typeof root.supabase.createClient === 'function') {
        // Pre-fetch unread badge count in background for the tab bar
        void this.refreshConversationsSilent();
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
        infoToggleBtn: document.getElementById('dmInfoToggleBtn'),
        contextPanel: document.getElementById('dmContextPanel'),
        contextPanelCloseBtn: document.getElementById('dmContextPanelCloseBtn'),
        contextPeerAvatar: document.getElementById('dmContextPeerAvatar'),
        contextPeerName: document.getElementById('dmContextPeerName'),
        contextPeerUsername: document.getElementById('dmContextPeerUsername'),
        contextPeerRole: document.getElementById('dmContextPeerRole'),
        contextProfileLink: document.getElementById('dmContextProfileLink'),

        // Timeline
        timeline: document.getElementById('dmTimeline'),
        timelineLoader: document.getElementById('dmTimelineLoader'),
        typingIndicator: document.getElementById('dmTypingIndicator'),
        typingIndicatorText: document.getElementById('dmTypingIndicatorText'),
        scrollBottomBtn: document.getElementById('dmScrollBottomBtn'),
        scrollUnreadBadge: document.getElementById('dmScrollUnreadBadge'),

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
        errorToast: document.getElementById('dmErrorToast'),

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

      // Mode Switcher Buttons with Keyboard ARIA Navigation
      if (el.modeBtnCohort) {
        el.modeBtnCohort.addEventListener('click', () => this.switchMode('cohort'));
      }
      if (el.modeBtnDm) {
        el.modeBtnDm.addEventListener('click', () => this.switchMode('dm'));
      }
      const modeTabs = [el.modeBtnCohort, el.modeBtnDm].filter(Boolean);
      modeTabs.forEach((btn, idx) => {
        btn.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const nextIdx = (idx + (e.key === 'ArrowRight' ? 1 : -1) + modeTabs.length) % modeTabs.length;
            modeTabs[nextIdx].focus();
            modeTabs[nextIdx].click();
          }
        });
      });

      // Inbox Search
      if (el.convSearchInput) {
        el.convSearchInput.addEventListener('input', (e) => this.filterConversations(e.target.value));
      }

      // New Message Button
      if (el.newMsgBtn) {
        el.newMsgBtn.addEventListener('click', () => this.openUserSearchModal());
      }

      // Mobile Back Button & Popstate History Support
      if (el.headerBackBtn) {
        el.headerBackBtn.addEventListener('click', () => {
          if (window.history && window.history.state && window.history.state.dmConversation) {
            window.history.back();
          } else {
            this.closeActiveConversationMobile();
          }
        });
      }

      window.addEventListener('popstate', () => {
        if (this.elements.dmLayout && this.elements.dmLayout.classList.contains('in-conversation')) {
          this.closeActiveConversationMobile({ fromPopState: true });
        }
      });

      // Header Dropdown Toggle
      if (el.headerMenuBtn) {
        el.headerMenuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (el.headerDropdown) el.headerDropdown.classList.toggle('show');
        });
      }
      if (el.infoToggleBtn) {
        el.infoToggleBtn.addEventListener('click', () => this.toggleContextPanel());
      }
      if (el.contextPanelCloseBtn) {
        el.contextPanelCloseBtn.addEventListener('click', () => this.toggleContextPanel(false));
      }
      document.addEventListener('click', () => {
        if (el.headerDropdown) el.headerDropdown.classList.remove('show');
        if (el.emojiDrawer) el.emojiDrawer.classList.remove('show');
      });

      // Timeline Scroll for Cursor Pagination & Scroll-to-Bottom Button
      if (el.timeline) {
        el.timeline.addEventListener('scroll', () => {
          if (el.timeline.scrollTop <= 40 && this.hasMore && !this.isLoadingOlder && !this.isLoadingMessages) {
            void this.loadOlderMessages();
          }
          if (this.isNearBottom()) {
            if (this.unreadWhileScrolledUp > 0) {
              this.unreadWhileScrolledUp = 0;
              this.updateScrollBottomBtn();
            } else {
              this.updateScrollBottomBtn();
            }
            void this.markActiveConversationRead();
          } else {
            this.updateScrollBottomBtn();
          }
        });
      }

      if (el.scrollBottomBtn) {
        el.scrollBottomBtn.addEventListener('click', () => {
          this.unreadWhileScrolledUp = 0;
          this.scrollToBottom(true);
          this.updateScrollBottomBtn();
          void this.markActiveConversationRead();
        });
      }

      // Composer Input, Auto-resize, and Blur
      if (el.textarea) {
        el.textarea.addEventListener('input', () => this.handleTextareaInput());
        el.textarea.addEventListener('keydown', (e) => this.handleComposerKeydown(e));
        el.textarea.addEventListener('blur', () => {
          if (!el.textarea.value.trim()) {
            this.stopTypingBroadcast();
          }
        });
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
          if (el.emojiDrawer) el.emojiDrawer.classList.toggle('show');
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
          this.searchDebounceTimer = setTimeout(() => this.searchUsers(q), 250);
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
      window.switchChatMode = (mode) => this.switchMode(mode);
    }

    switchMode(mode) {
      if (!this.enabled && mode === 'dm') return;
      this.currentMode = mode;

      const el = this.elements;
      if (mode === 'dm') {
        if (el.modeBtnCohort) {
          el.modeBtnCohort.classList.remove('active');
          el.modeBtnCohort.setAttribute('aria-selected', 'false');
        }
        if (el.modeBtnDm) {
          el.modeBtnDm.classList.add('active');
          el.modeBtnDm.setAttribute('aria-selected', 'true');
        }
        if (el.cohortChatMain) el.cohortChatMain.style.display = 'none';
        if (el.dmMain) el.dmMain.style.display = 'flex';

        if (window.roomClient && typeof window.roomClient.setActive === 'function') {
          window.roomClient.setActive(false);
        }
        this.startBackgroundSync();
        void this.open();
      } else {
        this.stopTypingBroadcast();
        this.stopBackgroundSync();
        if (el.modeBtnCohort) {
          el.modeBtnCohort.classList.add('active');
          el.modeBtnCohort.setAttribute('aria-selected', 'true');
        }
        if (el.modeBtnDm) {
          el.modeBtnDm.classList.remove('active');
          el.modeBtnDm.setAttribute('aria-selected', 'false');
        }
        if (el.cohortChatMain) el.cohortChatMain.style.display = 'flex';
        if (el.dmMain) el.dmMain.style.display = 'none';

        if (window.roomClient && typeof window.roomClient.setActive === 'function') {
          window.roomClient.setActive(true);
        }
      }
    }

    startBackgroundSync() {
      this.stopBackgroundSync();
      if (!root.supabase || typeof root.supabase.createClient !== 'function') return;
      this.backgroundSyncTimer = setInterval(() => {
        if (document.hidden || this.currentMode !== 'dm' || !this.isOnline) return;
        void this.refreshConversationsSilent();
        if (this.activeConversation && !this.realtimeConnected) {
          void this.syncActiveConversation();
        }
      }, 6000);
      if (this.backgroundSyncTimer && typeof this.backgroundSyncTimer.unref === 'function') {
        this.backgroundSyncTimer.unref();
      }
    }

    stopBackgroundSync() {
      if (this.backgroundSyncTimer) {
        clearInterval(this.backgroundSyncTimer);
        this.backgroundSyncTimer = null;
      }
    }

    showNotice(msg, isError = true) {
      const el = this.elements.errorToast;
      if (el) {
        el.textContent = msg;
        el.className = 'dm-toast ' + (isError ? 'error' : 'info') + ' show';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
          el.classList.remove('show');
        }, 3500);
      } else if (typeof alert === 'function') {
        alert(msg);
      }
    }

    async open() {
      await this.loadConversations();
      if (this.activeConversation) {
        void this.syncActiveConversation();
      }
    }

    // --- Conversations List Management ---
    async loadConversations() {
      const el = this.elements;
      if (!el.convList) return;

      if (this.conversations.length === 0) {
        this.renderConversationSkeletons();
      }
      try {
        const res = await fetch('/api/dm/conversations?limit=40', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load conversations');
        const data = await res.json();
        this.reconcileConversationsList(data.conversations || []);
        this.renderConversationList(this.getFilteredConversations());
        this.updateTotalUnreadBadge();
      } catch (err) {
        console.error('[DM] Load conversations error:', err);
        if (this.conversations.length === 0) {
          this.renderConversationError();
        }
      }
    }

    async refreshConversationsSilent() {
      if (!this.enabled || !this.currentUser) return;
      try {
        const res = await fetch('/api/dm/conversations?limit=40', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data.conversations)) return;
        this.reconcileConversationsList(data.conversations);
        this.renderConversationList(this.getFilteredConversations());
        this.updateTotalUnreadBadge();
      } catch {}
    }

    reconcileConversationsList(serverList) {
      const prevMap = new Map(this.conversations.map(c => [c.id, c]));
      const merged = serverList.map(c => {
        const prev = prevMap.get(c.id);
        if (prev && prev.lastMessage && c.lastMessage) {
          const prevTime = parseIsoDate(prev.lastMessageAt || prev.lastMessage.createdAt).getTime() || 0;
          const nextTime = parseIsoDate(c.lastMessageAt || c.lastMessage.createdAt).getTime() || 0;
          // Prevent older snapshot from overwriting a newer optimistic or realtime preview
          if (prevTime > nextTime && Number(prev.lastMessage.id || 0) > Number(c.lastMessage.id || 0)) {
            return {
              ...c,
              lastMessage: prev.lastMessage,
              lastMessageAt: prev.lastMessageAt,
            };
          }
        }
        if (this.activeConversation && this.activeConversation.id === c.id && !document.hidden && this.isNearBottom()) {
          return { ...c, unreadCount: 0 };
        }
        return c;
      });

      merged.sort((a, b) => {
        const tB = parseIsoDate(b.lastMessageAt || b.lastMessage?.createdAt || 0).getTime() || 0;
        const tA = parseIsoDate(a.lastMessageAt || a.lastMessage?.createdAt || 0).getTime() || 0;
        return tB - tA;
      });

      this.conversations = merged;
      if (this.activeConversation) {
        const updatedActive = this.conversations.find(c => c.id === this.activeConversation.id);
        if (updatedActive) {
          this.activeConversation = { ...this.activeConversation, ...updatedActive };
        }
      }
    }

    getFilteredConversations() {
      const q = String(this.elements.convSearchInput?.value || '').trim().toLowerCase();
      if (!q) return this.conversations;
      return this.conversations.filter(c => {
        const peer = c.participant || {};
        const name = (peer.name || '').toLowerCase();
        const username = (peer.username || '').toLowerCase();
        const preview = (c.lastMessage?.text || '').toLowerCase();
        return name.includes(q) || username.includes(q) || preview.includes(q);
      });
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
        const searchVal = String(el.convSearchInput?.value || '').trim();
        if (searchVal && this.conversations.length > 0) {
          el.convList.innerHTML = `
            <div class="dm-empty-inbox">
              <div class="dm-empty-title">No matching conversations</div>
              <div class="dm-empty-desc">No conversations match "${escapeHtml(searchVal)}".</div>
              <button type="button" class="dm-btn-secondary" onclick="window.dmClient.openUserSearchModal()">
                Search Directory
              </button>
            </div>
          `;
          return;
        }
        el.convList.innerHTML = `
          <div class="dm-empty-inbox">
            <div class="dm-empty-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
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
          <div class="dm-conv-item ${isSelected ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}" role="button" tabindex="0" data-conv-id="${escapeHtml(c.id)}" onclick="window.dmClient.selectConversation('${escapeHtml(c.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.dmClient.selectConversation('${escapeHtml(c.id)}');}">
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
      let conv = this.conversations.find(c => c.id === convId);
      if (!conv) {
        await this.loadConversations();
        conv = this.conversations.find(c => c.id === convId);
        if (!conv) return;
      }

      const prevConvId = this.activeConversation?.id;
      if (prevConvId && prevConvId !== convId) {
        this.stopTypingBroadcast(prevConvId);
      }
      this.clearPeerTyping();
      this.cancelComposerContext();

      this.activeConversation = conv;
      this.peerLastReadMessageId = Number(conv.peerLastReadMessageId || conv.participant?.lastReadMessageId || 0);
      this.messages = [];
      this.hasMore = false;
      this.isLoadingOlder = false;
      this.unreadWhileScrolledUp = 0;
      this.lastSyncTimestamp = new Date().toISOString();
      this.updateScrollBottomBtn();

      // Clear local unread count immediately on selection
      conv.unreadCount = 0;
      this.updateTotalUnreadBadge();

      // Mobile view update & browser history
      if (this.elements.dmLayout) {
        this.elements.dmLayout.classList.add('in-conversation');
      }
      if (typeof window !== 'undefined' && window.innerWidth <= 768 && window.history && window.history.pushState) {
        try {
          window.history.pushState({ dmConversation: conv.id }, '', `?tab=dm&dm=${encodeURIComponent(conv.id)}`);
        } catch {}
      }

      // Re-render conversation list items to update active highlight
      this.renderConversationList(this.getFilteredConversations());

      // Render conversation header & context panel
      this.renderActiveHeader(conv);
      this.renderContextPanel(conv);

      // Check blocked status
      this.updateBlockedUI(conv);

      // Subscribe to Realtime channel concurrently with loading message history
      void this.subscribeRealtime(conv.id);

      // Load initial message history
      await this.loadMessages(conv.id);

      // Mark conversation read
      await this.markActiveConversationRead();
    }

    selectConversationById(convId) {
      return this.selectConversation(convId);
    }

    closeActiveConversationMobile(options = {}) {
      this.stopTypingBroadcast();
      this.clearPeerTyping();
      if (this.elements.dmLayout) {
        this.elements.dmLayout.classList.remove('in-conversation');
      }
      this.unsubscribeRealtime();
      this.activeConversation = null;
      this.messages = [];
      if (this.elements.noConvPlaceholder) this.elements.noConvPlaceholder.style.display = 'flex';
      if (this.elements.activeChatWrap) this.elements.activeChatWrap.style.display = 'none';
      this.renderConversationList(this.getFilteredConversations());

      if (!options.fromPopState && typeof window !== 'undefined' && window.history && window.history.replaceState) {
        try {
          window.history.replaceState({ tab: 'dm' }, '', '?tab=dm');
        } catch {}
      }
    }

    toggleContextPanel(force) {
      const panel = this.elements.contextPanel;
      if (!panel) return;
      const shouldShow = typeof force === 'boolean' ? force : !panel.classList.contains('open');
      panel.classList.toggle('open', shouldShow);
      if (this.elements.infoToggleBtn) {
        this.elements.infoToggleBtn.classList.toggle('active', shouldShow);
      }
    }

    renderContextPanel(conv) {
      const el = this.elements;
      if (!el.contextPanel || !conv) return;
      const peer = conv.participant || {};
      if (el.contextPeerName) el.contextPeerName.textContent = peer.name || 'User';
      if (el.contextPeerUsername) {
        el.contextPeerUsername.textContent = peer.username ? `@${peer.username}` : (peer.department || 'Semester Library');
      }
      if (el.contextPeerRole) {
        el.contextPeerRole.textContent = (peer.role || 'student').toUpperCase();
      }
      if (el.contextPeerAvatar) {
        el.contextPeerAvatar.innerHTML = peer.avatarUrl
          ? `<img src="${escapeHtml(peer.avatarUrl)}" class="dm-avatar-large" alt="${escapeHtml(peer.name)}" />`
          : `<div class="dm-avatar-large">${escapeHtml(getInitials(peer.name))}</div>`;
      }
      if (el.contextProfileLink && peer.studentId) {
        el.contextProfileLink.href = `profile.html?id=${encodeURIComponent(peer.studentId)}`;
      }
    }

    renderActiveHeader(conv) {
      const el = this.elements;
      const peer = conv.participant || {};

      if (el.noConvPlaceholder) el.noConvPlaceholder.style.display = 'none';
      if (el.activeChatWrap) el.activeChatWrap.style.display = 'flex';

      if (el.peerName) {
        el.peerName.textContent = peer.name || 'Conversation';
        if (peer.studentId) {
          el.peerName.style.cursor = 'pointer';
          el.peerName.title = 'View Profile';
          el.peerName.onclick = () => { window.location.href = `profile.html?id=${encodeURIComponent(peer.studentId)}`; };
        }
      }

      if (el.peerAvatar) {
        if (peer.avatarUrl) {
          el.peerAvatar.innerHTML = `<img src="${escapeHtml(peer.avatarUrl)}" class="dm-avatar-small" alt="${escapeHtml(peer.name)}" />`;
        } else {
          el.peerAvatar.innerHTML = `<div class="dm-avatar-small">${escapeHtml(getInitials(peer.name))}</div>`;
        }
        if (peer.studentId) {
          el.peerAvatar.style.cursor = 'pointer';
          el.peerAvatar.title = 'View Profile';
          el.peerAvatar.onclick = () => { window.location.href = `profile.html?id=${encodeURIComponent(peer.studentId)}`; };
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

      const isBlocked = Boolean(conv.blocked || conv.isBlocked);
      if (el.peerStatusText) {
        if (isBlocked) {
          el.peerStatusText.textContent = 'Blocked';
        } else {
          el.peerStatusText.textContent = peer.username ? `@${peer.username}` : 'Direct Message';
        }
        el.peerStatusText.classList.remove('typing');
      }

      // Update Block button label in menu
      const blockBtn = document.getElementById('dmMenuBlockBtn');
      if (blockBtn) {
        const blockedByMe = Boolean(conv.blockedByMe || conv.isBlockedByCaller);
        blockBtn.textContent = blockedByMe ? 'Unblock User' : 'Block User';
      }
    }

    updateBlockedUI(conv) {
      const el = this.elements;
      const isBlocked = Boolean(conv.blocked || conv.isBlocked);
      const blockedByMe = Boolean(conv.blockedByMe || conv.isBlockedByCaller);
      if (el.blockedBanner && el.composerWrap) {
        const composerBar = el.composerWrap.querySelector('.dm-composer-bar');
        if (isBlocked) {
          el.blockedBanner.style.display = 'flex';
          if (composerBar) composerBar.style.display = 'none';
          if (el.contextBar) el.contextBar.style.display = 'none';
          const bannerText = el.blockedBanner.querySelector('span');
          if (bannerText) {
            bannerText.textContent = blockedByMe
              ? 'You have blocked this user. Unblock to send messages.'
              : 'You cannot reply to this conversation.';
          }
          if (el.unblockBtn) {
            el.unblockBtn.style.display = blockedByMe ? 'inline-flex' : 'none';
          }
        } else {
          el.blockedBanner.style.display = 'none';
          if (composerBar) composerBar.style.display = 'flex';
        }
      }
    }

    // --- Message History & Deterministic Ordering ---
    sortMessagesDeterministically(list) {
      return list.slice().sort((a, b) => {
        const aNum = Number(a.id);
        const bNum = Number(b.id);
        const aIsNum = Number.isFinite(aNum) && aNum > 0;
        const bIsNum = Number.isFinite(bNum) && bNum > 0;
        if (aIsNum && bIsNum) return aNum - bNum;
        if (aIsNum && !bIsNum) return -1;
        if (!aIsNum && bIsNum) return 1;
        const tA = parseIsoDate(a.createdAt).getTime() || 0;
        const tB = parseIsoDate(b.createdAt).getTime() || 0;
        return tA - tB;
      });
    }

    mergePendingForConversation(convId, serverMessages) {
      const merged = Array.isArray(serverMessages) ? serverMessages.slice() : [];
      const seenClientIds = new Set(merged.map(m => m.clientId).filter(Boolean));
      for (const [clientId, pendingMsg] of this.pendingSends.entries()) {
        if (pendingMsg.conversationId === convId) {
          if (seenClientIds.has(clientId)) {
            this.pendingSends.delete(clientId);
          } else {
            merged.push(pendingMsg);
          }
        }
      }
      return this.sortMessagesDeterministically(merged);
    }

    async loadMessages(convId) {
      const seq = ++this.loadMessagesSeq;
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
        if (seq !== this.loadMessagesSeq || (this.activeConversation && this.activeConversation.id !== convId)) {
          return;
        }
        if (!res.ok) throw new Error('Failed to load message history');
        const data = await res.json();
        if (seq !== this.loadMessagesSeq || (this.activeConversation && this.activeConversation.id !== convId)) {
          return;
        }

        if (Number(data.peerLastReadMessageId) > this.peerLastReadMessageId) {
          this.peerLastReadMessageId = Number(data.peerLastReadMessageId);
        }
        if (Number(data.lastReadMessageId) > 0) {
          const prevAck = this.lastAcknowledgedReadByConv.get(convId) || 0;
          this.lastAcknowledgedReadByConv.set(convId, Math.max(prevAck, Number(data.lastReadMessageId)));
        }

        this.messages = this.mergePendingForConversation(convId, data.messages || []);
        this.hasMore = Boolean(data.hasMore);
        this.lastSyncTimestamp = new Date().toISOString();
        this.renderTimeline();
        this.scrollToBottom(false);
      } catch (err) {
        if (seq !== this.loadMessagesSeq) return;
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
        if (seq === this.loadMessagesSeq) {
          this.isLoadingMessages = false;
        }
      }
    }

    async loadOlderMessages() {
      if (this.isLoadingOlder || !this.hasMore || !this.activeConversation || this.messages.length === 0) return;
      const firstConfirmed = this.messages.find(m => Number.isFinite(Number(m.id)) && Number(m.id) > 0);
      if (!firstConfirmed) return;

      this.isLoadingOlder = true;
      const convId = this.activeConversation.id;
      const seq = this.loadMessagesSeq;

      const el = this.elements;
      if (el.timelineLoader) el.timelineLoader.style.display = 'flex';

      const oldestId = firstConfirmed.id;
      const scrollHeightBefore = el.timeline ? el.timeline.scrollHeight : 0;
      const scrollTopBefore = el.timeline ? el.timeline.scrollTop : 0;

      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(convId)}/messages?limit=40&before=${oldestId}`, { cache: 'no-store' });
        if (seq !== this.loadMessagesSeq || !this.activeConversation || this.activeConversation.id !== convId) return;
        if (!res.ok) throw new Error('Failed to load older messages');
        const data = await res.json();
        if (seq !== this.loadMessagesSeq || !this.activeConversation || this.activeConversation.id !== convId) return;

        const older = data.messages || [];
        this.hasMore = Boolean(data.hasMore);

        if (older.length > 0) {
          const existingIds = new Set(this.messages.map(m => m.id));
          const uniqueOlder = older.filter(m => !existingIds.has(m.id));
          this.messages = this.sortMessagesDeterministically(uniqueOlder.concat(this.messages));
          this.renderTimeline();

          if (el.timeline) {
            const scrollDiff = el.timeline.scrollHeight - scrollHeightBefore;
            el.timeline.scrollTop = scrollTopBefore + scrollDiff;
          }
        }
      } catch (err) {
        console.error('[DM] Load older messages error:', err);
      } finally {
        if (seq === this.loadMessagesSeq) {
          this.isLoadingOlder = false;
          if (el.timelineLoader) el.timelineLoader.style.display = 'none';
        }
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
      const isPending = Boolean(msg.isOptimistic && msg.status === 'pending');
      const isFailed = Boolean(msg.status === 'failed');

      const prevTime = prevMsg ? parseIsoDate(prevMsg.createdAt).getTime() : 0;
      const currTime = parseIsoDate(msg.createdAt).getTime() || 0;
      const nextTime = nextMsg ? parseIsoDate(nextMsg.createdAt).getTime() : 0;

      const isSamePrev = Boolean(
        prevMsg &&
        prevMsg.senderId === msg.senderId &&
        formatDateSeparator(prevMsg.createdAt) === formatDateSeparator(msg.createdAt) &&
        Math.abs(currTime - prevTime) < 5 * 60 * 1000
      );
      const isSameNext = Boolean(
        nextMsg &&
        nextMsg.senderId === msg.senderId &&
        formatDateSeparator(nextMsg.createdAt) === formatDateSeparator(msg.createdAt) &&
        Math.abs(nextTime - currTime) < 5 * 60 * 1000
      );

      if (isSamePrev) rowClass += ' same-prev';
      if (isSameNext) rowClass += ' same-next';
      if (isPending) rowClass += ' is-pending';
      if (isFailed) rowClass += ' is-failed';

      // Read / Delivery status (Pending, Failed, Sent, Seen)
      let readReceiptHtml = '';
      if (isSelf && !isDeleted) {
        if (isFailed) {
          readReceiptHtml = `<span class="dm-read-status failed" title="Failed to send">!</span>`;
        } else if (isPending) {
          readReceiptHtml = `<span class="dm-read-status pending" title="Sending...">···</span>`;
        } else {
          const isSeen = Number(this.peerLastReadMessageId) >= Number(msg.id);
          readReceiptHtml = isSeen
            ? `<span class="dm-read-status seen" title="Seen">✓✓</span>`
            : `<span class="dm-read-status sent" title="Sent">✓</span>`;
        }
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

      // Actions Menu (Hover/Tap) - only for confirmed non-deleted messages
      let actionsHtml = '';
      if (!isDeleted && !isPending && !isFailed) {
        actionsHtml = `
          <div class="dm-msg-actions">
            <button type="button" class="dm-action-btn" title="Reply" aria-label="Reply" onclick="window.dmClient.startReply(${msg.id})">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            </button>
            ${isSelf ? `
              <button type="button" class="dm-action-btn" title="Edit" aria-label="Edit" onclick="window.dmClient.startEdit(${msg.id})">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              </button>
            ` : ''}
            <button type="button" class="dm-action-btn" title="Delete" aria-label="Delete" onclick="window.dmClient.openDeleteModal(${msg.id}, ${isSelf})">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            ${!isSelf ? `
              <button type="button" class="dm-action-btn" title="Report" aria-label="Report" onclick="window.dmClient.openReportModal(${msg.id})">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              </button>
            ` : ''}
          </div>
        `;
      }

      const failedRetryHtml = isFailed && msg.clientId ? `
        <div class="dm-msg-failed-bar">
          <span class="dm-failed-label">Failed to send</span>
          <button type="button" class="dm-retry-btn" onclick="window.dmClient.retryMessage('${escapeHtml(msg.clientId)}')">Retry</button>
          <button type="button" class="dm-dismiss-btn" onclick="window.dmClient.dismissFailedMessage('${escapeHtml(msg.clientId)}')">Remove</button>
        </div>
      ` : '';

      const bubbleContent = isDeleted
        ? `<span class="dm-bubble-text">This message was deleted</span>`
        : `${replyQuoteHtml}<span class="dm-bubble-text">${formatMessageBodyHtml(msg.text)}</span>`;

      return `
        <div class="dm-msg-row ${rowClass}" id="dmMsgRow_${escapeHtml(msg.id)}" data-msg-id="${escapeHtml(msg.id)}">
          <div class="dm-msg-bubble-wrap">
            ${actionsHtml}
            <div class="dm-bubble ${isDeleted ? 'deleted' : ''} ${isPending ? 'pending' : ''} ${isFailed ? 'failed' : ''}">
              ${bubbleContent}
              <div class="dm-bubble-meta">
                ${isEdited && !isDeleted ? `<span class="dm-edited-tag">(edited)</span>` : ''}
                <span>${escapeHtml(isPending ? 'Sending...' : formatTime(msg.createdAt))}</span>
                ${readReceiptHtml}
              </div>
            </div>
            ${failedRetryHtml}
          </div>
        </div>
      `;
    }

    isNearBottom() {
      const el = this.elements.timeline;
      if (!el) return true;
      return (el.scrollHeight - el.scrollTop - el.clientHeight) < 140;
    }

    updateScrollBottomBtn() {
      const btn = this.elements.scrollBottomBtn;
      const badge = this.elements.scrollUnreadBadge;
      if (!btn) return;

      const near = this.isNearBottom();
      if (!near || this.unreadWhileScrolledUp > 0) {
        btn.style.display = 'inline-flex';
        if (badge) {
          if (this.unreadWhileScrolledUp > 0) {
            badge.textContent = this.unreadWhileScrolledUp > 99 ? '99+' : `${this.unreadWhileScrolledUp} new`;
            badge.style.display = 'inline-flex';
          } else {
            badge.style.display = 'none';
          }
        }
      } else {
        btn.style.display = 'none';
        if (badge) badge.style.display = 'none';
      }
    }

    scrollToBottom(smooth = true) {
      const el = this.elements.timeline;
      if (!el) return;
      if (smooth && typeof el.scrollTo === 'function') {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      this.unreadWhileScrolledUp = 0;
      this.updateScrollBottomBtn();
    }

    scrollToMessage(msgId) {
      const row = document.getElementById(`dmMsgRow_${msgId}`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('highlight');
        setTimeout(() => row.classList.remove('highlight'), 1800);
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

      // Broadcast Typing Indicator (throttled + inactivity auto-stop)
      if (text.trim() && this.activeConversation && !this.activeConversation.blocked && !this.activeConversation.isBlocked) {
        this.throttleBroadcastTyping();
        clearTimeout(this.localTypingStopTimer);
        this.localTypingStopTimer = setTimeout(() => {
          this.stopTypingBroadcast();
        }, 3000);
      } else if (!text.trim() && this.isCurrentlyTyping) {
        this.stopTypingBroadcast();
      }
    }

    handleComposerKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.sendMessage();
      } else if (e.key === 'Escape' && (this.replyingTo || this.editingMessage)) {
        e.preventDefault();
        this.cancelComposerContext();
      }
    }

    throttleBroadcastTyping() {
      const now = Date.now();
      if (now - this.lastTypingSentAt < 2000) return;
      this.lastTypingSentAt = now;
      this.isCurrentlyTyping = true;

      if (!this.activeConversation) return;
      fetch(`/api/dm/conversations/${encodeURIComponent(this.activeConversation.id)}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping: true }),
      }).catch(() => {});
    }

    stopTypingBroadcast(convId = null) {
      clearTimeout(this.localTypingStopTimer);
      this.localTypingStopTimer = null;
      this.lastTypingSentAt = 0;
      if (!this.isCurrentlyTyping && !convId) return;
      this.isCurrentlyTyping = false;

      const targetConvId = convId || this.activeConversation?.id;
      if (!targetConvId) return;
      fetch(`/api/dm/conversations/${encodeURIComponent(targetConvId)}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping: false }),
      }).catch(() => {});
    }

    reconcileSingleMessage(serverMsg) {
      if (!serverMsg) return false;
      const clientId = serverMsg.clientId || null;
      if (clientId) {
        this.pendingSends.delete(clientId);
        this.inFlightClientIds.delete(clientId);
      }

      const normalized = {
        ...serverMsg,
        id: Number(serverMsg.id || serverMsg.messageId),
        status: 'sent',
        isOptimistic: false,
      };

      const idx = this.messages.findIndex(
        m => m.id === normalized.id || (clientId && m.clientId === clientId)
      );

      if (idx !== -1) {
        this.messages[idx] = {
          ...this.messages[idx],
          ...normalized,
          replyTo: normalized.replyTo || this.messages[idx].replyTo || null,
        };
      } else {
        this.messages.push(normalized);
      }

      this.messages = this.sortMessagesDeterministically(this.messages);
      return idx === -1;
    }

    async sendMessage(retryClientId = null) {
      const el = this.elements;
      if (!this.activeConversation) return;

      let optimisticMsg = null;
      let rawText = '';
      let clientId = '';
      let replyToId = null;
      const convId = this.activeConversation.id;

      if (retryClientId && typeof retryClientId === 'string') {
        optimisticMsg = this.messages.find(m => m.clientId === retryClientId) || this.pendingSends.get(retryClientId);
        if (!optimisticMsg) return;
        if (this.inFlightClientIds.has(retryClientId)) return;
        rawText = optimisticMsg.text;
        clientId = retryClientId;
        replyToId = optimisticMsg.replyToId || (optimisticMsg.replyTo ? optimisticMsg.replyTo.id : null);
        optimisticMsg.status = 'pending';
        optimisticMsg.isOptimistic = true;
        optimisticMsg.errorText = null;
        this.renderTimeline();
      } else {
        if (!el.textarea) return;
        rawText = el.textarea.value.trim();
        if (!rawText || rawText.length > 2000) return;

        // If in editing mode, dispatch edit instead
        if (this.editingMessage) {
          return this.submitEdit(rawText);
        }

        // Stop typing indicator immediately upon send
        this.stopTypingBroadcast(convId);

        clientId = (root.crypto && root.crypto.randomUUID)
          ? root.crypto.randomUUID()
          : `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        if (this.inFlightClientIds.has(clientId)) return;
        replyToId = this.replyingTo ? this.replyingTo.id : null;

        optimisticMsg = {
          id: `opt_${clientId}`,
          conversationId: convId,
          senderId: this.currentUser.studentId,
          senderName: this.currentUser.name,
          clientId,
          text: rawText,
          replyToId,
          replyTo: this.replyingTo ? {
            id: this.replyingTo.id,
            text: this.replyingTo.text,
            senderName: this.replyingTo.senderName || 'Peer',
          } : null,
          isEdited: false,
          deletedForAll: false,
          createdAt: new Date().toISOString(),
          isOptimistic: true,
          status: 'pending',
        };

        this.messages.push(optimisticMsg);
        this.pendingSends.set(clientId, optimisticMsg);

        // Clear composer & reply context immediately after accepting for optimistic send
        el.textarea.value = '';
        el.textarea.style.height = 'auto';
        if (el.charCounter) el.charCounter.style.display = 'none';
        if (el.sendBtn) el.sendBtn.disabled = true;
        this.cancelComposerContext();

        this.renderTimeline();
        this.scrollToBottom(true);
        this.updateConversationPreview(convId, optimisticMsg);
      }

      this.inFlightClientIds.add(clientId);

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

        this.inFlightClientIds.delete(clientId);
        this.pendingSends.delete(clientId);

        if (this.activeConversation && this.activeConversation.id === convId) {
          this.reconcileSingleMessage(serverMsg);
          this.renderTimeline();
        }

        this.updateConversationPreview(convId, serverMsg);
      } catch (err) {
        console.error('[DM] Send message failure:', err);
        this.inFlightClientIds.delete(clientId);
        optimisticMsg.status = 'failed';
        optimisticMsg.errorText = err.message || 'Could not send message';
        this.pendingSends.set(clientId, optimisticMsg);

        if (this.activeConversation && this.activeConversation.id === convId) {
          this.renderTimeline();
        }
        this.showNotice(err.message || 'Message failed to send. Tap Retry on the message.', true);
      }
    }

    retryMessage(clientId) {
      if (!clientId) return;
      return this.sendMessage(clientId);
    }

    dismissFailedMessage(clientId) {
      if (!clientId) return;
      this.pendingSends.delete(clientId);
      this.inFlightClientIds.delete(clientId);
      this.messages = this.messages.filter(m => m.clientId !== clientId && m.id !== `opt_${clientId}`);
      this.renderTimeline();
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
      const originalEdited = msg.isEdited;
      const convId = this.activeConversation.id;

      // Optimistically update
      msg.text = newText;
      msg.isEdited = true;
      this.editingMessage = null;
      if (this.elements.contextBar) this.elements.contextBar.style.display = 'none';
      if (this.elements.textarea) {
        this.elements.textarea.value = '';
        this.handleTextareaInput();
      }
      this.renderTimeline();

      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(convId)}/messages/${msg.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: newText }),
        });

        if (!res.ok) throw new Error('Edit failed');
        const data = await res.json();
        const updated = data.message || {
          ...msg,
          text: data.text || newText,
          isEdited: true,
          editedAt: data.editedAt || new Date().toISOString(),
        };
        const idx = this.messages.findIndex(m => m.id === msg.id);
        if (idx !== -1) {
          this.messages[idx] = { ...this.messages[idx], ...updated };
        }
        this.renderTimeline();
        if (this.activeConversation?.lastMessage?.id === msg.id) {
          this.updateConversationPreview(convId, this.messages[idx] || updated);
        }
      } catch (err) {
        console.error('[DM] Edit message error:', err);
        msg.text = originalText;
        msg.isEdited = originalEdited;
        this.renderTimeline();
        this.showNotice('Could not edit message.', true);
      }
    }

    cancelComposerContext() {
      const wasEditing = Boolean(this.editingMessage);
      this.replyingTo = null;
      this.editingMessage = null;
      if (this.elements.contextBar) this.elements.contextBar.style.display = 'none';
      if (this.elements.textarea && wasEditing) {
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
          if (this.activeConversation?.lastMessage?.id === msgId) {
            this.activeConversation.lastMessage.deletedForAll = true;
            this.activeConversation.lastMessage.text = null;
            this.renderConversationList(this.getFilteredConversations());
          }
        } else {
          this.messages = this.messages.filter(x => x.id !== msgId);
        }
        this.renderTimeline();
      } catch (err) {
        console.error('[DM] Delete message error:', err);
        this.showNotice('Could not delete message.', true);
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
        this.showNotice('Could not clear conversation.', true);
      }
    }

    // --- Blocking & Unblocking ---
    openBlockModal() {
      if (!this.activeConversation) return;
      const blockedByMe = Boolean(this.activeConversation.blockedByMe || this.activeConversation.isBlockedByCaller);
      if (blockedByMe) {
        void this.unblockActivePeer();
        return;
      }
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
        this.activeConversation.isBlocked = true;
        this.activeConversation.blockedByMe = true;
        this.activeConversation.isBlockedByCaller = true;
        this.stopTypingBroadcast();
        this.clearPeerTyping();
        this.renderActiveHeader(this.activeConversation);
        this.updateBlockedUI(this.activeConversation);
        this.unsubscribeRealtime();
      } catch (err) {
        console.error('[DM] Block user error:', err);
        this.showNotice('Could not block user.', true);
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
        this.activeConversation.isBlocked = false;
        this.activeConversation.blockedByMe = false;
        this.activeConversation.isBlockedByCaller = false;
        this.renderActiveHeader(this.activeConversation);
        this.updateBlockedUI(this.activeConversation);
        void this.subscribeRealtime(this.activeConversation.id);
      } catch (err) {
        console.error('[DM] Unblock user error:', err);
        this.showNotice('Could not unblock user.', true);
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
        this.showNotice('Report submitted to moderators.', false);
      } catch (err) {
        console.error('[DM] Report error:', err);
        this.showNotice('Could not submit report. Please try again.', true);
      }
    }

    // --- Read Receipts (Coalesced & Cursor-Gated) ---
    async markActiveConversationRead() {
      if (!this.activeConversation || this.messages.length === 0) return;
      if (document.hidden) return;

      // Find latest confirmed server message ID
      let latestConfirmedId = 0;
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const m = this.messages[i];
        const numId = Number(m.id);
        if (Number.isFinite(numId) && numId > 0 && !String(m.id).startsWith('opt_')) {
          latestConfirmedId = numId;
          break;
        }
      }
      if (!latestConfirmedId) return;

      const convId = this.activeConversation.id;
      const prevAck = this.lastAcknowledgedReadByConv.get(convId) || 0;

      // Clear local unread badge on active conversation immediately
      if (this.activeConversation.unreadCount > 0) {
        this.activeConversation.unreadCount = 0;
        this.renderConversationList(this.getFilteredConversations());
        this.updateTotalUnreadBadge();
      }

      if (latestConfirmedId <= prevAck) return;
      this.lastAcknowledgedReadByConv.set(convId, latestConfirmedId);

      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(convId)}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lastReadMessageId: latestConfirmedId }),
        });
        if (!res.ok) {
          this.lastAcknowledgedReadByConv.set(convId, prevAck);
        }
      } catch {
        this.lastAcknowledgedReadByConv.set(convId, prevAck);
      }
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
          <div class="dm-empty-desc" style="text-align: center; padding: 24px;">
            Type a name or username to find students, CRs, teachers, or admins.
          </div>
        `;
      }
    }

    closeUserSearchModal() {
      const el = this.elements;
      if (el.userSearchModal) el.userSearchModal.style.display = 'none';
      if (this.searchAbortController) {
        this.searchAbortController.abort();
        this.searchAbortController = null;
      }
    }

    async searchUsers(query) {
      const el = this.elements;
      if (!el.userSearchResults) return;

      if (this.searchAbortController) {
        this.searchAbortController.abort();
        this.searchAbortController = null;
      }

      const reqId = ++this.searchRequestId;

      if (!query) {
        el.userSearchResults.innerHTML = `
          <div class="dm-empty-desc" style="text-align: center; padding: 24px;">
            Type a name or username to find students, CRs, teachers, or admins.
          </div>
        `;
        return;
      }

      el.userSearchResults.innerHTML = `
        <div class="dm-timeline-loader"><span>Searching...</span></div>
      `;

      this.searchAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const fetchOpts = {
        cache: 'no-store',
        signal: this.searchAbortController ? this.searchAbortController.signal : undefined,
      };

      try {
        const res = await fetch(`/api/dm/users/search?q=${encodeURIComponent(query)}&limit=20`, fetchOpts);
        if (reqId !== this.searchRequestId) return;
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        if (reqId !== this.searchRequestId) return;
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
            <div class="dm-user-search-item" role="button" tabindex="0" onclick="window.dmClient.startConversationWithUser('${escapeHtml(u.studentId)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.dmClient.startConversationWithUser('${escapeHtml(u.studentId)}');}">
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
        if (err.name === 'AbortError') return;
        if (reqId !== this.searchRequestId) return;
        console.error('[DM] User search error:', err);
        el.userSearchResults.innerHTML = `
          <div class="dm-empty-desc" style="text-align: center; padding: 20px;">
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
        const convId = data.conversation?.id || data.conversationId || data.id;
        if (!convId) throw new Error('Could not resolve conversation');

        await this.loadConversations();
        await this.selectConversation(convId);
      } catch (err) {
        console.error('[DM] Start conversation error:', err);
        this.showNotice(err.message || 'Could not start conversation.', true);
      }
    }

    // --- Emoji Drawer ---
    populateEmojiDrawer() {
      const el = this.elements.emojiDrawer;
      if (!el) return;

      const emojis = [
        '👍','❤️','😂','🔥','🎉','👏','🙏','🙌',
        '✨','💯','🤔','😎','📚','✅','💡','🚀',
        '👀','🤝','💪','🎯','⚡','🎓','😮','😢',
        '😀','😊','🥳','🤩','🫡','🫶','✌️','🤞'
      ];

      el.innerHTML = `
        <div class="dm-emoji-grid">
          ${emojis.map(e => `<span class="dm-emoji-item" role="button" tabindex="0" onclick="window.dmClient.insertEmoji('${e}')">${e}</span>`).join('')}
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

    // --- Supabase Realtime Integration (With Token Renewal & Reconnect Backoff) ---
    async subscribeRealtime(conversationId) {
      this.unsubscribeRealtime();

      if (!root.supabase || typeof root.supabase.createClient !== 'function') {
        console.warn('[DM] Supabase client library not found on page.');
        return;
      }

      const attempt = ++this.realtimeAttempt;
      const isCurrent = () => (
        attempt === this.realtimeAttempt &&
        Boolean(this.activeConversation) &&
        this.activeConversation.id === conversationId
      );

      const scheduleReconnect = () => {
        if (!isCurrent()) return;
        clearTimeout(this.realtimeReconnectTimer);
        const delayMs = Math.min(30000, 1000 * Math.pow(2, Math.min(this.realtimeRetryCount++, 5)));
        this.realtimeReconnectTimer = setTimeout(() => {
          if (isCurrent()) void this.subscribeRealtime(conversationId);
        }, delayMs);
      };

      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(conversationId)}/realtime-config`, { cache: 'no-store' });
        if (!isCurrent()) return;
        if (!res.ok) {
          const err = new Error('Realtime config fetch failed');
          err.status = res.status;
          throw err;
        }
        const config = await res.json();
        if (!isCurrent()) return;

        const supabaseTargetUrl = config.supabaseUrl || config.url;
        const supabaseAnonKey = config.key || config.anonKey || config.token;
        if (!supabaseTargetUrl || !supabaseAnonKey) {
          throw new Error('Incomplete realtime configuration');
        }

        const localClient = root.supabase.createClient(supabaseTargetUrl, supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          realtime: { params: { apikey: supabaseAnonKey } }
        });
        this.supabaseClient = localClient;

        if (config.token && localClient.realtime && typeof localClient.realtime.setAuth === 'function') {
          await localClient.realtime.setAuth(config.token);
        }
        if (!isCurrent()) {
          try { await localClient.removeAllChannels(); } catch {}
          return;
        }

        const channel = localClient.channel(config.topic, {
          config: {
            broadcast: { self: false, ack: false },
            private: true,
          }
        });

        // 1. New Message
        channel.on('broadcast', { event: 'dm:message:new' }, (payload) => {
          if (!isCurrent()) return;
          this.handleRealtimeNewMessage(payload.payload || payload);
        });

        // 2. Edited Message
        channel.on('broadcast', { event: 'dm:message:edited' }, (payload) => {
          if (!isCurrent()) return;
          this.handleRealtimeEditedMessage(payload.payload || payload);
        });

        // 3. Deleted Message
        channel.on('broadcast', { event: 'dm:message:deleted' }, (payload) => {
          if (!isCurrent()) return;
          this.handleRealtimeDeletedMessage(payload.payload || payload);
        });

        // 4. Read Receipt Update
        channel.on('broadcast', { event: 'dm:read:updated' }, (payload) => {
          if (!isCurrent()) return;
          this.handleRealtimeReadReceipt(payload.payload || payload);
        });

        // 5. Ephemeral Typing Indicator
        channel.on('broadcast', { event: 'dm:typing' }, (payload) => {
          if (!isCurrent()) return;
          this.handleRealtimeTyping(payload.payload || payload);
        });

        channel.subscribe((status) => {
          if (!isCurrent()) return;
          const isSubscribed = status === 'SUBSCRIBED';
          this.realtimeConnected = isSubscribed;
          this.updateConnectionStatus(isSubscribed);

          if (isSubscribed) {
            this.realtimeRetryCount = 0;
            clearTimeout(this.realtimeReconnectTimer);

            // Schedule proactive credential renewal 30s before token expiry (120s TTL)
            const expIso = config.expiresAt || config.expiry;
            const expMs = expIso ? Date.parse(expIso) : 0;
            if (expMs > Date.now()) {
              clearTimeout(this.realtimeRenewalTimer);
              const renewInMs = Math.max(2000, expMs - Date.now() - 30000);
              this.realtimeRenewalTimer = setTimeout(() => {
                if (isCurrent()) void this.subscribeRealtime(conversationId);
              }, renewInMs);
            }

            // Reconcile any events missed during handshake
            if (!this.isLoadingMessages) {
              void this.syncActiveConversation();
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            scheduleReconnect();
          }
        });

        this.realtimeChannel = channel;
      } catch (err) {
        if (!isCurrent()) return;
        console.warn('[DM Realtime] Subscription error:', err.message);
        this.realtimeConnected = false;
        this.updateConnectionStatus(false);
        if (![401, 403, 404].includes(err.status)) {
          scheduleReconnect();
        }
      }
    }

    unsubscribeRealtime() {
      this.realtimeAttempt++;
      this.realtimeConnected = false;
      clearTimeout(this.realtimeRenewalTimer);
      clearTimeout(this.realtimeReconnectTimer);
      this.realtimeRenewalTimer = null;
      this.realtimeReconnectTimer = null;

      const oldChannel = this.realtimeChannel;
      const oldClient = this.supabaseClient;
      this.realtimeChannel = null;
      this.supabaseClient = null;

      if (oldChannel && oldClient) {
        try {
          void oldClient.removeChannel(oldChannel);
        } catch {}
      }
    }

    rememberEventId(eventId) {
      if (!eventId || typeof eventId !== 'string') return true;
      if (this.processedEventIds.has(eventId)) return false;
      this.processedEventIds.add(eventId);
      if (this.processedEventIds.size > 2000) {
        const first = this.processedEventIds.values().next().value;
        this.processedEventIds.delete(first);
      }
      return true;
    }

    handleRealtimeNewMessage(event) {
      if (!event) return;
      if (event.eventId && !this.rememberEventId(event.eventId)) return;

      const msg = event.message || (event.messageId ? {
        id: Number(event.messageId),
        conversationId: event.conversationId,
        senderId: event.senderId,
        senderName: event.senderName || null,
        clientId: event.clientId || null,
        text: event.text,
        replyToId: event.replyToId || null,
        replyTo: event.replyTo || null,
        createdAt: event.createdAt || new Date().toISOString(),
      } : null);
      if (!msg) return;
      const convId = event.conversationId || msg.conversationId;

      // Update conversation list preview
      this.updateConversationPreview(convId, msg);

      // If active conversation matches
      if (this.activeConversation && this.activeConversation.id === convId) {
        // Clear peer typing indicator immediately when a message arrives from peer
        if (msg.senderId !== this.currentUser.studentId) {
          this.clearPeerTyping();
        }

        const wasNearBottom = this.isNearBottom();
        const isBrandNew = this.reconcileSingleMessage(msg);
        const scrollTopBefore = this.elements.timeline ? this.elements.timeline.scrollTop : 0;

        this.renderTimeline();

        if (wasNearBottom || msg.senderId === this.currentUser.studentId) {
          this.scrollToBottom(true);
          if (msg.senderId !== this.currentUser.studentId && !document.hidden) {
            void this.markActiveConversationRead();
          }
        } else if (isBrandNew && msg.senderId !== this.currentUser.studentId) {
          if (this.elements.timeline) {
            this.elements.timeline.scrollTop = scrollTopBefore;
          }
          this.unreadWhileScrolledUp++;
          this.updateScrollBottomBtn();
        }
      } else {
        // Increment unread count in inbox list
        const c = this.conversations.find(x => x.id === convId);
        if (c) {
          c.unreadCount = (Number(c.unreadCount) || 0) + 1;
          this.renderConversationList(this.getFilteredConversations());
          this.updateTotalUnreadBadge();
        } else {
          void this.refreshConversationsSilent();
        }
      }
    }

    handleRealtimeEditedMessage(event) {
      if (!event || !event.messageId) return;
      if (event.eventId && !this.rememberEventId(event.eventId)) return;
      const msgId = Number(event.messageId);

      if (this.activeConversation && this.activeConversation.id === event.conversationId) {
        const m = this.messages.find(x => x.id === msgId);
        if (m) {
          m.text = event.text;
          m.isEdited = true;
          m.editedAt = event.editedAt || m.editedAt;
          const scrollTopBefore = this.elements.timeline ? this.elements.timeline.scrollTop : 0;
          const near = this.isNearBottom();
          this.renderTimeline();
          if (!near && this.elements.timeline) {
            this.elements.timeline.scrollTop = scrollTopBefore;
          }
        }
      }
      const conv = this.conversations.find(c => c.id === event.conversationId);
      if (conv && conv.lastMessage && Number(conv.lastMessage.id) === msgId) {
        conv.lastMessage.text = event.text;
        this.renderConversationList(this.getFilteredConversations());
      }
    }

    handleRealtimeDeletedMessage(event) {
      if (!event || !event.messageId) return;
      if (event.eventId && !this.rememberEventId(event.eventId)) return;
      const msgId = Number(event.messageId);

      if (this.activeConversation && this.activeConversation.id === event.conversationId) {
        const m = this.messages.find(x => x.id === msgId);
        if (m) {
          m.deletedForAll = true;
          m.text = null;
          const scrollTopBefore = this.elements.timeline ? this.elements.timeline.scrollTop : 0;
          const near = this.isNearBottom();
          this.renderTimeline();
          if (!near && this.elements.timeline) {
            this.elements.timeline.scrollTop = scrollTopBefore;
          }
        }
      }
      const conv = this.conversations.find(c => c.id === event.conversationId);
      if (conv && conv.lastMessage && Number(conv.lastMessage.id) === msgId) {
        conv.lastMessage.deletedForAll = true;
        conv.lastMessage.text = null;
        this.renderConversationList(this.getFilteredConversations());
      }
    }

    handleRealtimeReadReceipt(event) {
      if (!event || !this.activeConversation || this.activeConversation.id !== event.conversationId) return;
      const readerId = event.readerId || event.studentId;
      if (readerId === this.currentUser.studentId) return;

      const incomingReadId = Number(event.lastReadMessageId || 0);
      if (incomingReadId <= this.peerLastReadMessageId) return;

      this.peerLastReadMessageId = incomingReadId;
      const scrollTopBefore = this.elements.timeline ? this.elements.timeline.scrollTop : 0;
      const near = this.isNearBottom();
      this.renderTimeline();
      if (!near && this.elements.timeline) {
        this.elements.timeline.scrollTop = scrollTopBefore;
      }
    }

    clearPeerTyping() {
      clearTimeout(this.peerTypingTimeout);
      this.peerTypingTimeout = null;
      this.isPeerTyping = false;

      const el = this.elements;
      if (el.peerStatusText) {
        const conv = this.activeConversation;
        const isBlocked = Boolean(conv?.blocked || conv?.isBlocked);
        const peer = conv?.participant || {};
        el.peerStatusText.textContent = isBlocked ? 'Blocked' : (peer.username ? `@${peer.username}` : '');
        el.peerStatusText.classList.remove('typing');
      }
      if (el.typingIndicator) {
        el.typingIndicator.style.display = 'none';
        el.typingIndicator.classList.remove('visible');
      }
    }

    handleRealtimeTyping(event) {
      if (!event || !this.activeConversation || this.activeConversation.id !== event.conversationId) return;
      if (event.studentId === this.currentUser.studentId) return;

      if (event.isTyping && event.expiresAt && Date.parse(event.expiresAt) <= Date.now()) {
        this.clearPeerTyping();
        return;
      }

      const el = this.elements;
      if (event.isTyping) {
        this.isPeerTyping = true;
        if (el.peerStatusText) {
          el.peerStatusText.textContent = 'Typing...';
          el.peerStatusText.classList.add('typing');
        }
        if (el.typingIndicator) {
          const peerName = this.activeConversation.participant?.name || 'Peer';
          if (el.typingIndicatorText) {
            el.typingIndicatorText.textContent = `${peerName} is typing...`;
          }
          el.typingIndicator.style.display = 'flex';
          el.typingIndicator.classList.add('visible');
        }
        clearTimeout(this.peerTypingTimeout);
        const ttlMs = event.expiresAt
          ? Math.min(4500, Math.max(500, Date.parse(event.expiresAt) - Date.now()))
          : 4000;
        this.peerTypingTimeout = setTimeout(() => {
          this.clearPeerTyping();
        }, ttlMs);
      } else {
        this.clearPeerTyping();
      }
    }

    updateConversationPreview(convId, msg) {
      const conv = this.conversations.find(c => c.id === convId);
      if (conv && msg) {
        const prevTime = parseIsoDate(conv.lastMessageAt || conv.lastMessage?.createdAt || 0).getTime() || 0;
        const msgTime = parseIsoDate(msg.createdAt || new Date().toISOString()).getTime() || Date.now();
        // Prevent older realtime event from overwriting newer conversation preview
        if (msgTime >= prevTime || !conv.lastMessage || Number(msg.id) >= Number(conv.lastMessage.id || 0)) {
          conv.lastMessage = msg;
          conv.lastMessageAt = msg.createdAt || new Date().toISOString();
        }
        this.conversations.sort((a, b) => {
          const tB = parseIsoDate(b.lastMessageAt || b.lastMessage?.createdAt || 0).getTime() || 0;
          const tA = parseIsoDate(a.lastMessageAt || a.lastMessage?.createdAt || 0).getTime() || 0;
          return tB - tA;
        });
        this.renderConversationList(this.getFilteredConversations());
      }
    }

    updateConnectionStatus(connected) {
      const el = this.elements;
      if (el.connBanner) {
        if (connected && this.isOnline) {
          el.connBanner.style.display = 'none';
        } else {
          el.connBanner.style.display = 'flex';
          el.connBanner.textContent = !this.isOnline
            ? 'You are offline. Reconnecting when network returns...'
            : 'Connecting to real-time updates...';
        }
      }
      if (el.peerStatusDot) {
        el.peerStatusDot.className = 'dm-status-dot' + (connected && this.isOnline ? ' online' : '');
      }
    }

    // --- Offline Reconnection & Delta Sync ---
    handleNetworkChange(online) {
      this.isOnline = online;
      this.updateConnectionStatus(online && this.realtimeConnected);
      if (online) {
        if (this.activeConversation) {
          void this.syncActiveConversation();
          if (!this.realtimeConnected) {
            void this.subscribeRealtime(this.activeConversation.id);
          }
        }
        if (this.currentMode === 'dm') {
          void this.refreshConversationsSilent();
        }
      }
    }

    async syncActiveConversation() {
      if (!this.activeConversation) return;
      const convId = this.activeConversation.id;

      // Find max known confirmed message ID
      let maxId = 0;
      for (const m of this.messages) {
        const idNum = Number(m.id);
        if (Number.isFinite(idNum) && idNum > maxId) maxId = idNum;
      }

      const qs = new URLSearchParams({ sinceMessageId: String(maxId) });
      if (this.lastSyncTimestamp) {
        qs.set('sinceTimestamp', this.lastSyncTimestamp);
      }

      try {
        const res = await fetch(`/api/dm/conversations/${encodeURIComponent(convId)}/sync?${qs.toString()}`, { cache: 'no-store' });
        if (!res.ok || !this.activeConversation || this.activeConversation.id !== convId) return;
        const delta = await res.json();
        if (!this.activeConversation || this.activeConversation.id !== convId) return;

        if (delta.serverTime) {
          this.lastSyncTimestamp = delta.serverTime;
        }

        let updated = false;
        let hasNewPeerMessage = false;
        const wasNearBottom = this.isNearBottom();

        // Reconcile new messages
        if (delta.messages && delta.messages.length > 0) {
          for (const m of delta.messages) {
            const existed = this.messages.some(
              existing => existing.id === m.id || (m.clientId && existing.clientId === m.clientId)
            );
            this.reconcileSingleMessage(m);
            if (!existed) {
              updated = true;
              if (m.senderId !== this.currentUser.studentId) {
                hasNewPeerMessage = true;
                this.clearPeerTyping();
              }
            }
          }
          const latestMsg = delta.messages[delta.messages.length - 1];
          if (latestMsg) {
            this.updateConversationPreview(convId, latestMsg);
          }
        }

        // Reconcile edits
        if (delta.edits && delta.edits.length > 0) {
          for (const edit of delta.edits) {
            const m = this.messages.find(x => x.id === edit.messageId);
            if (m && m.text !== edit.text) {
              m.text = edit.text;
              m.isEdited = true;
              m.editedAt = edit.editedAt || m.editedAt;
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
        const syncedPeerRead = Number(delta.peerLastReadMessageId || delta.readCursor?.peerLastReadMessageId || 0);
        if (syncedPeerRead > this.peerLastReadMessageId) {
          this.peerLastReadMessageId = syncedPeerRead;
          updated = true;
        }

        if (updated) {
          const scrollTopBefore = this.elements.timeline ? this.elements.timeline.scrollTop : 0;
          this.renderTimeline();
          if (wasNearBottom) {
            this.scrollToBottom(true);
            if (hasNewPeerMessage && !document.hidden) {
              void this.markActiveConversationRead();
            }
          } else if (this.elements.timeline) {
            this.elements.timeline.scrollTop = scrollTopBefore;
            if (hasNewPeerMessage) {
              this.unreadWhileScrolledUp++;
              this.updateScrollBottomBtn();
            }
          }
        }
      } catch (err) {
        console.warn('[DM] Sync delta error:', err.message);
      }
    }

    clearAccountData() {
      if (this.cacheKey) {
        try { localStorage.removeItem(this.cacheKey); } catch {}
      }
      this.stopTypingBroadcast();
      this.clearPeerTyping();
      this.stopBackgroundSync();
      this.unsubscribeRealtime();
      this.conversations = [];
      this.messages = [];
      this.activeConversation = null;
      this.pendingSends.clear();
      this.inFlightClientIds.clear();
      this.lastAcknowledgedReadByConv.clear();
      this.processedEventIds.clear();
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
