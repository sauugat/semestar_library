(function() {
  let unreadCount = 0;
  let notifications = [];
  let dropdownOpen = false;

  async function fetchUnreadCount() {
    try {
      const res = await fetch('/api/notifications/unread-count');
      if (res.ok) {
        const data = await res.json();
        unreadCount = data.count || 0;
        updateBadge();
      }
    } catch (e) {
      console.error('Failed to fetch unread count:', e);
    }
  }

  function updateBadge() {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  async function fetchNotifications() {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        notifications = await res.json();
        renderDropdown();
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e);
    }
  }

  async function markAsReadAndRedirect(id, fileId) {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
      // Reduce badge count instantly
      if (unreadCount > 0) {
        unreadCount--;
        updateBadge();
      }
    } catch (e) {}

    if (fileId) {
      window.location.href = `files.html?highlight=${fileId}`; // or to a specific view page if available
    }
  }

  function renderDropdown() {
    const list = document.getElementById('notificationList');
    if (!list) return;

    list.innerHTML = '';
    
    if (notifications.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications yet.</div>';
      return;
    }

    notifications.forEach(n => {
      const item = document.createElement('div');
      item.className = 'notif-item' + (n.isRead ? ' read' : ' unread');
      
      let icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>';
      if (n.type === 'like') {
        icon = '<svg viewBox="0 0 24 24" fill="var(--ap-accent-red)" stroke="var(--ap-accent-red)" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
      } else if (n.type === 'comment') {
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
      } else if (n.type === 'notice') {
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--ap-accent-blue)" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
      }

      // SQLite CURRENT_TIMESTAMP is UTC (YYYY-MM-DD HH:MM:SS). Force it to be parsed as UTC.
      const dateString = n.createdAt.replace(' ', 'T') + 'Z';
      const dateObj = new Date(dateString);

      item.innerHTML = `
        <div class="notif-icon">${icon}</div>
        <div class="notif-content">
          <div class="notif-text">${n.message}</div>
          <div class="notif-time">${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
        </div>
        ${!n.isRead ? '<div class="notif-dot"></div>' : ''}
      `;

      item.addEventListener('click', () => {
        markAsReadAndRedirect(n.id, n.relatedFileId);
      });

      list.appendChild(item);
    });
  }

  function toggleDropdown(e) {
    e.stopPropagation();
    dropdownOpen = !dropdownOpen;
    const dp = document.getElementById('notificationDropdown');
    if (dp) {
      dp.style.display = dropdownOpen ? 'block' : 'none';
      if (dropdownOpen) {
        fetchNotifications();
      }
    }
  }

  // Inject UI
  document.addEventListener('DOMContentLoaded', () => {
    const headerActions = document.querySelector('.dash-header-actions');
    if (!headerActions) return;

    const notifWrapper = document.createElement('div');
    notifWrapper.className = 'dash-notif-wrapper';
    
    notifWrapper.innerHTML = `
      <button class="dash-profile-chip" id="notifBellBtn" title="Notifications" style="width: 34px; height: 34px; justify-content: center; padding: 0; position: relative;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <span class="notification-badge" id="notificationBadge" style="display: none;">0</span>
      </button>
      <div class="notification-dropdown" id="notificationDropdown" style="display: none;">
        <div class="notif-header">Notifications</div>
        <div class="notif-list" id="notificationList">
          <div class="notif-empty">Loading...</div>
        </div>
      </div>
    `;

    // Insert just before the profile chip
    const profileChip = document.querySelector('.dash-header-actions > a[href="profile.html"]');
    if (profileChip) {
      headerActions.insertBefore(notifWrapper, profileChip);
    } else {
      headerActions.prepend(notifWrapper);
    }

    document.getElementById('notifBellBtn').addEventListener('click', toggleDropdown);

    document.addEventListener('click', (e) => {
      if (dropdownOpen && !notifWrapper.contains(e.target)) {
        dropdownOpen = false;
        document.getElementById('notificationDropdown').style.display = 'none';
      }
    });

    // Start polling
    fetchUnreadCount();
    setInterval(fetchUnreadCount, 10000);
  });

})();
