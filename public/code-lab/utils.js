/**
 * Code Lab Shared Frontend Utilities
 * Canonical HTML escaping and string sanitization.
 */

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'Asia/Kathmandu',
      dateStyle: 'medium',
      timeStyle: 'short'
    }) + ' NPT';
  } catch (e) {
    return String(iso);
  }
}

function fmtDuration(ms) {
  if (ms < 0 || !isFinite(ms)) return '—';
  const totalSec = Math.round(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${min}m`;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function deadlineBadge(deadline, submittedAt) {
  if (!deadline || !submittedAt) return '';
  const diffMs = new Date(deadline).getTime() - new Date(submittedAt).getTime();
  if (diffMs >= 0) {
    return `<span class="cl-deadline-badge on-time">✅ Submitted ${fmtDuration(diffMs)} before deadline</span>`;
  } else {
    return `<span class="cl-deadline-badge late">⚠️ Submitted ${fmtDuration(Math.abs(diffMs))} late</span>`;
  }
}

if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
  window.fmtTime = fmtTime;
  window.fmtDuration = fmtDuration;
  window.deadlineBadge = deadlineBadge;
}
