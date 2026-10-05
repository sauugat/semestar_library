/**
 * Production-Grade Global Notifications Bell & Realtime Sync for Semester Library
 * File: public/notifications.js
 */
(function() {
  let unseenCount = 0;
  let popoverOpen = false;
  let cachedNotifications = [];
  let sseSource = null;

  async function fetchUnseenCount() {
    try {
      const res = await fetch('/api/notifications/unread-count');
      if (res.ok) {
        const data = await res.json();
        unseenCount = data.count || 0;
        updateBadge();
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

  async function fetchRecentNotifications() {
    const list = document.getElementById('slNotifQuickList');
    if (!list) return;

    try {
      const res = await fetch('/api/notifications?limit=5');
      if (res.ok) {
        const data = await res.json();
        cachedNotifications = data.items || [];
        renderQuickList();
      }
    } catch (e) {
      list.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted, #737373); font-size: 0.8rem;">Could not load recent notifications.</div>';
    }
  }

  function renderQuickList() {
    const list = document.getElementById('slNotifQuickList');
    if (!list) return;

    if (cachedNotifications.length === 0) {
      list.innerHTML = '<div style="padding: 24px 16px; text-align: center; color: var(--text-secondary, #b5b5b5); font-size: 0.82rem; font-weight: 500;">You’re all caught up.</div>';
      return;
    }

    let html = '';
    cachedNotifications.forEach((n) => {
      const isUnread = !n.isRead;
      const initial = n.actor?.name ? n.actor.name.charAt(0).toUpperCase() : 'S';
      const avatarHtml = n.actor?.avatarUrl
        ? `<img src="${n.actor.avatarUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />`
        : `<span>${initial}</span>`;

      html += `
        <div class="sl-notif-row" data-id="${n.id}" data-link="${n.webPath || 'notifications.html'}" style="display: flex; gap: 10px; padding: 10px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); cursor: pointer; transition: background 0.15s ease; ${isUnread ? 'background: rgba(255, 255, 255, 0.04);' : ''}">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: #262626; display: flex; align-items: center; justify-content: center; font-size: 0.78rem; font-weight: 700; color: #fff; flex-shrink: 0; overflow: hidden;">
            ${avatarHtml}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 0.82rem; font-weight: 600; color: var(--text-primary, #f5f5f5); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(n.title)}</div>
            <div style="font-size: 0.76rem; color: var(--text-secondary, #b5b5b5); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(n.body)}</div>
          </div>
          ${isUnread ? '<div style="width: 6px; height: 6px; border-radius: 50%; background: #3b82f6; margin-top: 6px; flex-shrink: 0;"></div>' : ''}
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
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255, 255, 255, 0.08)'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
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
            if (popoverOpen) fetchRecentNotifications();
          } else if (event.type === 'badge_update') {
            unseenCount = event.unseenCount || 0;
            updateBadge();
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
    const headerActions = document.querySelector('.dash-header-actions');
    if (!headerActions || document.getElementById('slNotifBellBtn')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'sl-notif-bell-wrapper';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';

    wrapper.innerHTML = `
      <button type="button" id="slNotifBellBtn" title="Notifications" aria-label="Notifications" style="
        width: 34px; height: 34px;
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 999px;
        background: transparent;
        border: 1px solid var(--border, rgba(255, 255, 255, 0.14));
        color: var(--text-primary, #f5f5f5);
        cursor: pointer;
        padding: 0;
        position: relative;
        transition: all 0.2s ease;
      ">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <span id="slNotificationBadge" style="
          display: none;
          position: absolute;
          top: -4px;
          right: -4px;
          background: #3b82f6;
          color: #ffffff;
          font-size: 0.65rem;
          font-weight: 700;
          min-width: 17px;
          height: 17px;
          border-radius: 999px;
          align-items: center;
          justify-content: center;
          padding: 0 4px;
          border: 2px solid var(--bg-base, #0a0a0a);
          box-sizing: border-box;
          line-height: 1;
        ">0</span>
      </button>

      <div id="slNotificationPopover" style="
        display: none;
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 320px;
        background: #171717;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        box-shadow: 0 14px 30px rgba(0, 0, 0, 0.6);
        z-index: 1000;
        overflow: hidden;
      ">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
          <span style="font-size: 0.86rem; font-weight: 700; color: var(--text-primary, #f5f5f5);">Notifications</span>
          <a href="notifications.html" style="font-size: 0.74rem; font-weight: 600; color: #3b82f6; text-decoration: none;">View All</a>
        </div>
        <div id="slNotifQuickList" style="max-height: 280px; overflow-y: auto;">
          <div style="padding: 24px; text-align: center; color: var(--text-muted, #737373); font-size: 0.78rem;">Loading…</div>
        </div>
        <a href="notifications.html" style="display: block; text-align: center; padding: 10px; background: rgba(255, 255, 255, 0.03); border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 0.78rem; font-weight: 600; color: var(--text-secondary, #b5b5b5); text-decoration: none; transition: background 0.15s ease;">
          Open Notification Center →
        </a>
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
    bellBtn.addEventListener('mouseenter', () => { bellBtn.style.background = 'var(--bg-surface-raised, #242424)'; });
    bellBtn.addEventListener('mouseleave', () => { bellBtn.style.background = 'transparent'; });

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
