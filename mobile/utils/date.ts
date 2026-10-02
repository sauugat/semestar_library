/**
 * Bulletproof date utilities for Semester Library.
 * Guarantees that "Invalid Date" will NEVER be rendered to users.
 */

/**
 * Safely parse any date representation into a valid Date object, or null if invalid.
 */
export function safeParseDate(val: unknown): Date | null {
  if (val === null || val === undefined || val === '') return null;

  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }

  if (typeof val === 'number') {
    // Check if timestamp is in seconds instead of milliseconds (e.g. 10 digits vs 13 digits)
    const ms = val < 10000000000 ? val * 1000 : val;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined' || trimmed === 'Invalid Date') {
      return null;
    }

    // Check if numeric string
    if (/^\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      const ms = num < 10000000000 ? num * 1000 : num;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }

    // Replace common postgres format without T
    const normalized = trimmed.includes(' ') && !trimmed.includes('T')
      ? trimmed.replace(' ', 'T')
      : trimmed;

    const d = new Date(normalized);
    if (!isNaN(d.getTime())) {
      return d;
    }

    // Last ditch: parse fallback
    const fallback = new Date(trimmed);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  return null;
}

/**
 * Relative time ago formatting (e.g. 'Just now', '12m ago', '3h ago', '4d ago', '12 Oct 2026')
 */
export function formatTimeAgo(val: unknown, fallback = 'Recently'): string {
  const d = safeParseDate(val);
  if (!d) return fallback;

  try {
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((now - d.getTime()) / 1000));

    if (diffSec < 45) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}d ago`;

    // Over 7 days: format as 'DD MMM' or 'DD MMM YYYY'
    return formatDate(d, { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  } catch {
    return fallback;
  }
}

/**
 * Format date nicely for notices, posts, and official materials (e.g. "Oct 1, 2026")
 */
export function formatDate(
  val: unknown,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
  fallback = 'Recent'
): string {
  const d = safeParseDate(val);
  if (!d) return fallback;

  try {
    const formatted = d.toLocaleDateString('en-US', options);
    if (!formatted || formatted === 'Invalid Date') {
      return fallback;
    }
    return formatted;
  } catch {
    // If toLocaleDateString fails on older engines:
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
}

/**
 * Chat message timestamp (e.g. "10:45 AM")
 */
export function formatMessageTime(val: unknown, fallback = ''): string {
  const d = safeParseDate(val);
  if (!d) return fallback;

  try {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    const m = minutes < 10 ? `0${minutes}` : minutes;
    return `${h}:${m} ${ampm}`;
  }
}

/**
 * Chat section date separator (e.g. "Today", "Yesterday", "Monday, Oct 1")
 */
export function formatChatDateSeparator(val: unknown, fallback = 'Past messages'): string {
  const d = safeParseDate(val);
  if (!d) return fallback;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7 && diffDays > 0) {
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  }

  return formatDate(d, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}
