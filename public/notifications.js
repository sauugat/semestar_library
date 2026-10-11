/**
 * Production-Grade Global Notifications Bell & Realtime Sync for Semester Library
 * File: public/notifications.js
 */
(function() {
  let unseenCount = 0;
  let popoverOpen = false;
  let cachedNotifications = [];
  let sseSource = null;

  function ensureStylesInjected() {
    if (document.getElementById('slNotifStyles')) return;
    const style = document.createElement('style');
    style.id = 'slNotifStyles';
    style.textContent = `
      .sl-notif-bell-wrapper {
        position: relative;
        display: inline-flex;
        align-items: center;
      }

      #slNotifBellBtn {
        width: 36px;
        height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: transparent;
        border: 1px solid rgba(0, 0, 0, 0.1);
        color: #18181b;
        cursor: pointer;
        padding: 0;
        position: relative;
        transition: all 0.15s ease;
      }

      [data-theme="dark"] #slNotifBellBtn,
      body.dark-mode #slNotifBellBtn {
        border-color: rgba(255, 255, 255, 0.12);
        color: #f4f4f6;
      }

      #slNotifBellBtn:hover {
        background: rgba(0, 0, 0, 0.05);
      }

      [data-theme="dark"] #slNotifBellBtn:hover,
      body.dark-mode #slNotifBellBtn:hover {
        background: rgba(255, 255, 255, 0.08);
      }

      #slNotificationBadge {
        position: absolute;
        top: -3px;
        right: -3px;
        background: #3b82f6;
        color: #ffffff;
        font-size: 0.65rem;
        font-weight: 700;
        min-width: 17px;
        height: 17px;
        border-radius: 999px;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        border: 2px solid #ffffff;
        box-sizing: border-box;
        line-height: 1;
      }

      [data-theme="dark"] #slNotificationBadge,
      body.dark-mode #slNotificationBadge {
        border-color: #09090b;
      }

      #slNotificationPopover {
        display: none;
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 380px;
        max-width: calc(100vw - 24px);
        background: #ffffff;
        border: 1px solid rgba(0, 0, 0, 0.09);
        border-radius: 14px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.04);
        z-index: 1000;
        overflow: hidden;
        color: #111113;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        box-sizing: border-box;
      }

      [data-theme="dark"] #slNotificationPopover,
      body.dark-mode #slNotificationPopover {
        background: #141416;
        border: 1px solid rgba(255, 255, 255, 0.09);
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.65), 0 6px 16px rgba(0, 0, 0, 0.4);
        color: #f4f4f6;
      }

      .sl-notif-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        background: #fafafa;
      }

      [data-theme="dark"] .sl-notif-header,
      body.dark-mode .sl-notif-header {
        background: #18181b;
        border-bottom-color: rgba(255, 255, 255, 0.06);
      }

      .sl-notif-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .sl-notif-header-title {
        font-size: 13.5px;
        font-weight: 700;
        letter-spacing: -0.2px;
        color: inherit;
      }

      .sl-notif-unread-pill {
        font-size: 11px;
        font-weight: 600;
        background: rgba(59, 130, 246, 0.1);
        color: #2563eb;
        padding: 2px 7px;
        border-radius: 999px;
        line-height: 1.3;
        display: none;
      }

      [data-theme="dark"] .sl-notif-unread-pill,
      body.dark-mode .sl-notif-unread-pill {
        background: rgba(59, 130, 246, 0.18);
        color: #60a5fa;
      }

      .sl-notif-header-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .sl-notif-mark-all-btn {
        background: transparent;
        border: none;
        color: #71717a;
        font-size: 11.5px;
        font-weight: 500;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
        transition: all 0.12s ease;
        font-family: inherit;
        display: none;
      }

      .sl-notif-mark-all-btn:hover {
        color: #111113;
        background: rgba(0, 0, 0, 0.05);
      }

      [data-theme="dark"] .sl-notif-mark-all-btn,
      body.dark-mode .sl-notif-mark-all-btn {
        color: #a1a1aa;
      }

      [data-theme="dark"] .sl-notif-mark-all-btn:hover,
      body.dark-mode .sl-notif-mark-all-btn:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.08);
      }

      .sl-notif-view-all-link {
        font-size: 12px;
        font-weight: 600;
        color: #2563eb;
        text-decoration: none;
        transition: opacity 0.12s ease;
      }

      [data-theme="dark"] .sl-notif-view-all-link,
      body.dark-mode .sl-notif-view-all-link {
        color: #60a5fa;
      }

      .sl-notif-view-all-link:hover {
        text-decoration: underline;
      }

      #slNotifQuickList {
        max-height: 380px;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
      }

      #slNotifQuickList::-webkit-scrollbar {
        width: 5px;
      }
      #slNotifQuickList::-webkit-scrollbar-track {
        background: transparent;
      }
      #slNotifQuickList::-webkit-scrollbar-thumb {
        background: rgba(128, 128, 128, 0.25);
        border-radius: 4px;
      }

      .sl-notif-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.05);
        cursor: pointer;
        transition: background 0.15s ease;
        position: relative;
        text-decoration: none;
        color: inherit;
        box-sizing: border-box;
      }

      [data-theme="dark"] .sl-notif-row,
      body.dark-mode .sl-notif-row {
        border-bottom-color: rgba(255, 255, 255, 0.05);
      }

      .sl-notif-row:last-child {
        border-bottom: none;
      }

      .sl-notif-row:hover {
        background: rgba(0, 0, 0, 0.035);
      }

      [data-theme="dark"] .sl-notif-row:hover,
      body.dark-mode .sl-notif-row:hover {
        background: rgba(255, 255, 255, 0.05);
      }

      .sl-notif-row.unread {
        background: rgba(59, 130, 246, 0.035);
      }

      [data-theme="dark"] .sl-notif-row.unread,
      body.dark-mode .sl-notif-row.unread {
        background: rgba(59, 130, 246, 0.06);
      }

      .sl-notif-avatar-col {
        position: relative;
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        margin-top: 1px;
      }

      .sl-notif-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: #e4e4e7;
        color: #18181b;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 700;
        overflow: hidden;
        border: 1px solid rgba(0, 0, 0, 0.08);
      }

      [data-theme="dark"] .sl-notif-avatar,
      body.dark-mode .sl-notif-avatar {
        background: #27272a;
        color: #f4f4f5;
        border-color: rgba(255, 255, 255, 0.1);
      }

      .sl-notif-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .sl-notif-type-icon {
        position: absolute;
        bottom: -2px;
        right: -2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #ffffff;
        border: 1.5px solid #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
      }

      [data-theme="dark"] .sl-notif-type-icon,
      body.dark-mode .sl-notif-type-icon {
        border-color: #141416;
      }

      .sl-notif-type-icon.reaction { background: #ef4444; }
      .sl-notif-type-icon.comment { background: #3b82f6; }
      .sl-notif-type-icon.notice { background: #f59e0b; }
      .sl-notif-type-icon.file { background: #10b981; }
      .sl-notif-type-icon.default { background: #6b7280; }

      .sl-notif-content-col {
        flex: 1;
        min-width: 0;
      }

      .sl-notif-title-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }

      .sl-notif-title {
        font-size: 12.5px;
        font-weight: 600;
        line-height: 1.4;
        color: #111113;
        word-break: break-word;
      }

      [data-theme="dark"] .sl-notif-title,
      body.dark-mode .sl-notif-title {
        color: #f4f4f6;
      }

      .sl-notif-time {
        font-size: 11px;
        color: #71717a;
        white-space: nowrap;
        flex-shrink: 0;
      }

      [data-theme="dark"] .sl-notif-time,
      body.dark-mode .sl-notif-time {
        color: #8e8e93;
      }

      .sl-notif-snippet {
        font-size: 11.5px;
        color: #52525b;
        margin-top: 3px;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        word-break: break-word;
      }

      [data-theme="dark"] .sl-notif-snippet,
      body.dark-mode .sl-notif-snippet {
        color: #a1a1aa;
      }

      .sl-notif-unread-dot {
        width: 6.5px;
        height: 6.5px;
        border-radius: 50%;
        background: #3b82f6;
        margin-top: 6px;
        flex-shrink: 0;
      }

      .sl-notif-empty {
        padding: 36px 20px;
        text-align: center;
      }

      .sl-notif-empty-icon {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.04);
        color: #71717a;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 10px auto;
      }

      [data-theme="dark"] .sl-notif-empty-icon,
      body.dark-mode .sl-notif-empty-icon {
        background: rgba(255, 255, 255, 0.06);
        color: #a1a1aa;
      }

      .sl-notif-empty-title {
        font-size: 13px;
        font-weight: 600;
        color: inherit;
        margin-bottom: 2px;
      }

      .sl-notif-empty-desc {
        font-size: 11.5px;
        color: #71717a;
      }

      [data-theme="dark"] .sl-notif-empty-desc,
      body.dark-mode .sl-notif-empty-desc {
        color: #8e8e93;
      }

      .sl-notif-footer {
        border-top: 1px solid rgba(0, 0, 0, 0.06);
        background: #fafafa;
      }

      [data-theme="dark"] .sl-notif-footer,
      body.dark-mode .sl-notif-footer {
        border-top-color: rgba(255, 255, 255, 0.06);
        background: #18181b;
      }

      .sl-notif-footer-link {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 11px 16px;
        font-size: 12px;
        font-weight: 600;
        color: #71717a;
        text-decoration: none;
        transition: all 0.15s ease;
      }

      .sl-notif-footer-link:hover {
        color: #111113;
        background: rgba(0, 0, 0, 0.03);
      }

      [data-theme="dark"] .sl-notif-footer-link,
      body.dark-mode .sl-notif-footer-link {
        color: #a1a1aa;
      }

      [data-theme="dark"] .sl-notif-footer-link:hover,
      body.dark-mode .sl-notif-footer-link:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.04);
      }
    `;
    document.head.appendChild(style);
  }

  async function fetchUnseenCount() {
    try {
      const res = await fetch('/api/notifications/unread-count');
      if (res.ok) {
        const data = await res.json();
        unseenCount = data.count || 0;
        updateBadge();
        updateHeaderUnreadCount();
      }
    } catch (e) {
      // Graceful offline
    }
  }

  function updateBadge() {
    const badge = document.getElementById('slNotificationBadge');
    if (!badge) return;
    if (unseenCount > 0) {
      badge.textContent = unseenCount > 99 ? '99+' : String(unseenCount);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  function updateHeaderUnreadCount() {
    const pill = document.getElementById('slNotifHeaderUnreadPill');
    const markBtn = document.getElementById('slNotifMarkAllBtn');
    if (pill) {
      if (unseenCount > 0) {
        pill.textContent = `${unseenCount} unread`;
        pill.style.display = 'inline-block';
      } else {
        pill.style.display = 'none';
      }
    }
    if (markBtn) {
      markBtn.style.display = unseenCount > 0 ? 'inline-block' : 'none';
    }
  }

  async function fetchRecentNotifications() {
    const list = document.getElementById('slNotifQuickList');
    if (!list) return;

    try {
      const res = await fetch('/api/notifications?limit=8');
      if (res.ok) {
        const data = await res.json();
        cachedNotifications = data.items || [];
        renderQuickList();
      }
    } catch (e) {
      list.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted, #737373); font-size: 0.8rem;">Could not load recent notifications.</div>';
    }
  }

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffSecs = Math.floor((now - date) / 1000);
    if (isNaN(diffSecs) || diffSecs < 45) return 'Just now';
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function getTypeBadgeIcon(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('reaction') || t.includes('like')) {
      return `<span class="sl-notif-type-icon reaction" title="Reaction">
        <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
      </span>`;
    }
    if (t.includes('comment') || t.includes('reply')) {
      return `<span class="sl-notif-type-icon comment" title="Comment">
        <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </span>`;
    }
    if (t.includes('notice') || t.includes('announcement')) {
      return `<span class="sl-notif-type-icon notice" title="Notice">
        <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
      </span>`;
    }
    if (t.includes('file') || t.includes('material') || t.includes('assignment')) {
      return `<span class="sl-notif-type-icon file" title="File">
        <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
      </span>`;
    }
    return `<span class="sl-notif-type-icon default" title="Notification">
      <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><circle cx="12" cy="12" r="5"></circle></svg>
    </span>`;
  }

  function renderQuickList() {
    const list = document.getElementById('slNotifQuickList');
    if (!list) return;

    if (cachedNotifications.length === 0) {
      list.innerHTML = `
        <div class="sl-notif-empty">
          <div class="sl-notif-empty-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
          </div>
          <div class="sl-notif-empty-title">All caught up</div>
          <div class="sl-notif-empty-desc">No new notifications right now</div>
        </div>
      `;
      return;
    }

    let html = '';
    cachedNotifications.forEach((n) => {
      const isUnread = !n.isRead;
      const initial = n.actor?.name ? n.actor.name.charAt(0).toUpperCase() : 'S';
      const avatarHtml = n.actor?.avatarUrl
        ? `<img src="${escapeHtml(n.actor.avatarUrl)}" alt="${escapeHtml(n.actor.name || '')}" />`
        : `<span>${initial}</span>`;

      const badgeIconHtml = getTypeBadgeIcon(n.type);
      const timeFormatted = formatRelativeTime(n.createdAt);

      html += `
        <div class="sl-notif-row ${isUnread ? 'unread' : ''}" data-id="${n.id}" data-link="${n.webPath || 'notifications.html'}">
          <div class="sl-notif-avatar-col">
            <div class="sl-notif-avatar">${avatarHtml}</div>
            ${badgeIconHtml}
          </div>
          <div class="sl-notif-content-col">
            <div class="sl-notif-title-row">
              <div class="sl-notif-title">${escapeHtml(n.title || 'Notification')}</div>
              <span class="sl-notif-time">${timeFormatted}</span>
            </div>
            ${n.body ? `<div class="sl-notif-snippet">${escapeHtml(n.body)}</div>` : ''}
          </div>
          ${isUnread ? '<div class="sl-notif-unread-dot" title="Unread"></div>' : ''}
        </div>
      `;
    });

    list.innerHTML = html;

    list.querySelectorAll('.sl-notif-row').forEach((row) => {
      row.addEventListener('click', async () => {
        const id = row.getAttribute('data-id');
        const link = row.getAttribute('data-link');
        try {
          await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
        } catch {}
        if (link) window.location.href = link;
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function togglePopover(e) {
    e.stopPropagation();
    // If user is already on notifications.html, no need to open popover
    if (window.location.pathname.endsWith('notifications.html')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    popoverOpen = !popoverOpen;
    const pop = document.getElementById('slNotificationPopover');
    if (!pop) return;

    pop.style.display = popoverOpen ? 'block' : 'none';
    if (popoverOpen) {
      fetchRecentNotifications();
      if (unseenCount > 0) {
        fetch('/api/notifications/seen', { method: 'POST' }).then(() => {
          unseenCount = 0;
          updateBadge();
          updateHeaderUnreadCount();
        }).catch(() => {});
      }
    }
  }

  function initRealtime() {
    try {
      if (sseSource) sseSource.close();
      sseSource = new EventSource('/api/notifications/realtime');

      sseSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === 'notification') {
            unseenCount = (unseenCount || 0) + 1;
            updateBadge();
            updateHeaderUnreadCount();
            if (popoverOpen) fetchRecentNotifications();
          } else if (event.type === 'badge_update') {
            unseenCount = event.unseenCount || 0;
            updateBadge();
            updateHeaderUnreadCount();
          }
        } catch {}
      };

      sseSource.onerror = () => {
        // EventSource will auto-reconnect
      };
    } catch {}
  }

  // Inject UI
  function injectBellUI() {
    ensureStylesInjected();

    const headerActions = document.querySelector('.dash-header-actions');
    if (!headerActions || document.getElementById('slNotifBellBtn')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'sl-notif-bell-wrapper';

    wrapper.innerHTML = `
      <button type="button" id="slNotifBellBtn" title="Notifications" aria-label="Notifications">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <span id="slNotificationBadge">0</span>
      </button>

      <div id="slNotificationPopover">
        <div class="sl-notif-header">
          <div class="sl-notif-header-left">
            <span class="sl-notif-header-title">Notifications</span>
            <span class="sl-notif-unread-pill" id="slNotifHeaderUnreadPill">0 unread</span>
          </div>
          <div class="sl-notif-header-actions">
            <button type="button" class="sl-notif-mark-all-btn" id="slNotifMarkAllBtn" title="Mark all notifications as read">Mark all read</button>
            <a href="notifications.html" class="sl-notif-view-all-link">View all</a>
          </div>
        </div>
        <div id="slNotifQuickList">
          <div style="padding: 28px; text-align: center; color: #71717a; font-size: 0.8rem;">Loading…</div>
        </div>
        <div class="sl-notif-footer">
          <a href="notifications.html" class="sl-notif-footer-link">
            <span>Open Notification Center</span>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </a>
        </div>
      </div>
    `;

    // Insert just before the profile chip if present, or prepend
    const profileChip = headerActions.querySelector('a[href="profile.html"]');
    if (profileChip) {
      headerActions.insertBefore(wrapper, profileChip);
    } else {
      headerActions.appendChild(wrapper);
    }

    const bellBtn = document.getElementById('slNotifBellBtn');
    bellBtn.addEventListener('click', togglePopover);

    const markAllBtn = document.getElementById('slNotifMarkAllBtn');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await fetch('/api/notifications/read-all', { method: 'POST' });
          unseenCount = 0;
          updateBadge();
          cachedNotifications.forEach(n => { n.isRead = true; });
          renderQuickList();
          updateHeaderUnreadCount();
        } catch {}
      });
    }

    document.addEventListener('click', (e) => {
      if (popoverOpen && !wrapper.contains(e.target)) {
        popoverOpen = false;
        const pop = document.getElementById('slNotificationPopover');
        if (pop) pop.style.display = 'none';
      }
    });

    fetchUnseenCount();
    initRealtime();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        fetchUnseenCount();
        if (popoverOpen) fetchRecentNotifications();
      }
    });

    window.addEventListener('focus', () => {
      fetchUnseenCount();
      if (popoverOpen) fetchRecentNotifications();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBellUI);
  } else {
    injectBellUI();
  }

  // Fallback poll every 30s if SSE reconnecting
  setInterval(fetchUnseenCount, 30000);
})();
