'use strict';

/**
 * Nepali Date and Time Utilities for Kyana AI.
 * Grounded in Asia/Kathmandu timezone (UTC+05:45).
 * Interprets natural Nepali temporal words: aaja, voli/bholi, hijo, asti, parsi, etc.
 */

const NEPAL_TIMEZONE_OFFSET_MINUTES = 345; // 5 hours 45 minutes = 345 minutes

/**
 * Returns a Date object adjusted to Asia/Kathmandu time.
 * @param {Date|string|number} [input=new Date()]
 * @returns {Date}
 */
function getNepalTime(input = new Date()) {
  const d = new Date(input);
  // Calculate UTC time in ms
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  // Apply Nepal offset (+5:45)
  return new Date(utc + (NEPAL_TIMEZONE_OFFSET_MINUTES * 60000));
}

/**
 * Formats a Date object to YYYY-MM-DD in Asia/Kathmandu.
 * @param {Date} date
 * @returns {string}
 */
function formatNepalDate(date) {
  const nd = getNepalTime(date);
  const year = nd.getFullYear();
  const month = String(nd.getMonth() + 1).padStart(2, '0');
  const day = String(nd.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalizes Nepali text to make date extraction resilient.
 */
function normalizeDateText(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parses natural Nepali temporal expressions in user queries.
 * 
 * Supports:
 * - aaja (today)
 * - voli / bholi (tomorrow)
 * - hijo (yesterday)
 * - asti (day before yesterday / recently)
 * - parsi (day after tomorrow)
 * - yo hapta / yo week (this week)
 * - arko hapta / next week (next week)
 * - gako hapta / last week (last week)
 * 
 * @param {string} text
 * @param {Date} [referenceDate=new Date()]
 * @returns {{ expression: string, label: string, date?: string, startDate?: string, endDate?: string } | null}
 */
function parseNepaliDateExpression(text, referenceDate = new Date()) {
  const norm = normalizeDateText(text);
  if (!norm) return null;

  const base = getNepalTime(referenceDate);

  // Helper to add days
  const addDays = (n) => {
    const d = new Date(base);
    d.setDate(d.getDate() + n);
    return formatNepalDate(d);
  };

  // 1. Aaja (today)
  if (/\b(aaja|today|aile|ahile)\b/.test(norm)) {
    return {
      expression: 'aaja',
      label: 'Today',
      date: addDays(0)
    };
  }

  // 2. Voli / Bholi (tomorrow)
  if (/\b(voli|bholi|tomorrow)\b/.test(norm)) {
    return {
      expression: 'bholi',
      label: 'Tomorrow',
      date: addDays(1)
    };
  }

  // 3. Parsi (day after tomorrow)
  if (/\b(parsi|day after tomorrow)\b/.test(norm)) {
    return {
      expression: 'parsi',
      label: 'Day after tomorrow',
      date: addDays(2)
    };
  }

  // 4. Hijo (yesterday)
  if (/\b(hijo|yesterday)\b/.test(norm)) {
    return {
      expression: 'hijo',
      label: 'Yesterday',
      date: addDays(-1)
    };
  }

  // 5. Asti (day before yesterday / recently)
  if (/\b(asti|day before yesterday)\b/.test(norm)) {
    return {
      expression: 'asti',
      label: 'Recently / Day before yesterday',
      date: addDays(-2)
    };
  }

  // 6. This week (yo hapta)
  if (/\b(yo\s+hapta|this\s+week)\b/.test(norm)) {
    const dayOfWeek = base.getDay(); // 0 is Sunday
    const startOffset = -dayOfWeek;
    const endOffset = 6 - dayOfWeek;
    return {
      expression: 'yo hapta',
      label: 'This week',
      startDate: addDays(startOffset),
      endDate: addDays(endOffset)
    };
  }

  // 7. Next week (arko hapta)
  if (/\b(arko\s+hapta|next\s+week)\b/.test(norm)) {
    const dayOfWeek = base.getDay();
    const startOffset = 7 - dayOfWeek;
    const endOffset = 13 - dayOfWeek;
    return {
      expression: 'arko hapta',
      label: 'Next week',
      startDate: addDays(startOffset),
      endDate: addDays(endOffset)
    };
  }

  // 8. Last week (gako hapta / paila ko hapta)
  if (/\b(gako\s+hapta|paila\s+ko\s+hapta|last\s+week)\b/.test(norm)) {
    const dayOfWeek = base.getDay();
    const startOffset = -7 - dayOfWeek;
    const endOffset = -1 - dayOfWeek;
    return {
      expression: 'last week',
      label: 'Last week',
      startDate: addDays(startOffset),
      endDate: addDays(endOffset)
    };
  }

  return null;
}

module.exports = {
  getNepalTime,
  formatNepalDate,
  parseNepaliDateExpression,
  NEPAL_TIMEZONE_OFFSET_MINUTES
};
