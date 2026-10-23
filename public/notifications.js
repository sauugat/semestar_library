/**
 * Global Notifications Helper for Semester Library
 * File: public/notifications.js
 * Note: Header notification bell icon has been intentionally removed from dashboard/library headers.
 */
(function() {
  function removeBellUI() {
    const existing = document.querySelectorAll('.sl-notif-bell-wrapper, #slNotifBellBtn, #slNotificationPopover');
    existing.forEach(el => el.remove());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeBellUI);
  } else {
    removeBellUI();
  }
})();
