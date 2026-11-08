'use strict';

/**
 * Nepali Date and Time Utilities for Kyana AI.
 * Grounded in Asia/Kathmandu timezone (UTC+05:45).
 * 
 * Provides complete support for:
 * - Natural Nepali temporal expressions (aaja, bholi/voli, parsi, hijo, asti, yo hapta, arko hapta)
 * - Explicit single dates & date ranges in BS and AD
 * - Authoritative zero-drift Bikram Sambat (BS) <-> Gregorian (AD) conversion (2070–2090 BS)
 * - Normalization of slash-formatted (YYYY/MM/DD) and hyphen-formatted (YYYY-MM-DD) dates
 * - Devanagari numerals normalization (०-९ to 0-9)
 * - Calendar-aware date matching (`matchesDateFilter`) that never compares BS directly against AD
 * - Server-side dynamic time mocking without restarting
 */

const temporal = require('./temporal-intelligence');

const NEPAL_TIMEZONE_OFFSET_MINUTES = temporal.NEPAL_OFFSET_MINUTES;

const DEVANAGARI_DIGITS = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
};

const BS_MONTH_CANONICAL = [
  { canonical: 'baisakh', num: 1, variants: ['baisakh', 'baishakh', 'vaisakh', 'vaishakh', 'बैशाख', 'वैशाख'] },
  { canonical: 'jestha', num: 2, variants: ['jestha', 'jeth', 'jyestha', 'जेठ', 'ज्येष्ठ'] },
  { canonical: 'asar', num: 3, variants: ['asar', 'ashadh', 'ashad', 'aashadh', 'असार', 'आषाढ'] },
  { canonical: 'shrawan', num: 4, variants: ['shrawan', 'sawan', 'saun', 'shravan', 'साउन', 'श्रावण'] },
  { canonical: 'bhadra', num: 5, variants: ['bhadra', 'bhadau', 'bhau', 'भदौ', 'भाद्र'] },
  { canonical: 'asoj', num: 6, variants: ['asoj', 'ashoj', 'ashwin', 'aaswin', 'असोज', 'आश्विन'] },
  { canonical: 'kartik', num: 7, variants: ['kartik', 'kattik', 'कार्तिक', 'कात्तिक'] },
  { canonical: 'mangsir', num: 8, variants: ['mangsir', 'mangshir', 'marga', 'मंसिर', 'मार्ग', 'मङ्सिर'] },
  { canonical: 'poush', num: 9, variants: ['poush', 'push', 'pus', 'paush', 'पुस', 'पौष', 'पूष'] },
  { canonical: 'magh', num: 10, variants: ['magh', 'माघ'] },
  { canonical: 'falgun', num: 11, variants: ['falgun', 'phalgun', 'fagun', 'फागुन', 'फाल्गुन'] },
  { canonical: 'chaitra', num: 12, variants: ['chaitra', 'chait', 'चैत', 'चैत्र'] }
];

const AD_MONTH_CANONICAL = [
  { canonical: 'january', num: '01', monthIdx: 1, variants: ['january', 'jan', 'जनवरी'] },
  { canonical: 'february', num: '02', monthIdx: 2, variants: ['february', 'feb', 'फेब्रुअरी'] },
  { canonical: 'march', num: '03', monthIdx: 3, variants: ['march', 'mar', 'मार्च'] },
  { canonical: 'april', num: '04', monthIdx: 4, variants: ['april', 'apr', 'अप्रिल'] },
  { canonical: 'may', num: '05', monthIdx: 5, variants: ['may', 'मे'] },
  { canonical: 'june', num: '06', monthIdx: 6, variants: ['june', 'jun', 'जुन'] },
  { canonical: 'july', num: '07', monthIdx: 7, variants: ['july', 'jul', 'जुलाई'] },
  { canonical: 'august', num: '08', monthIdx: 8, variants: ['august', 'aug', 'अगस्ट'] },
  { canonical: 'september', num: '09', monthIdx: 9, variants: ['september', 'sept', 'sep', 'सेप्टेम्बर'] },
  { canonical: 'october', num: '10', monthIdx: 10, variants: ['october', 'oct', 'अक्टोबर'] },
  { canonical: 'november', num: '11', monthIdx: 11, variants: ['november', 'nov', 'नोभेम्बर'] },
  { canonical: 'december', num: '12', monthIdx: 12, variants: ['december', 'dec', 'डिसेम्बर'] }
];

const BS_CALENDAR_MONTH_DAYS = temporal.BS_MONTH_DAYS;

/**
 * Replaces Devanagari digits (०-९) with ASCII digits (0-9).
 * @param {string} text
 * @returns {string}
 */
function normalizeDevanagariDigits(text) {
  return String(text || '').replace(/[०-९]/g, ch => DEVANAGARI_DIGITS[ch] ?? ch);
}

/**
 * Normalizes a calendar date string (YYYY/MM/DD, YYYY.MM.DD, YYYY-M-D, or ISO timestamp)
 * into zero-padded YYYY-MM-DD format. Returns null if not a valid date pattern.
 */
function normalizeCalendarDateString(raw) {
  if (!raw) return null;
  const s = normalizeDevanagariDigits(String(raw).trim());
  const m = s.match(/^(\d{4})[/. -](\d{1,2})[/. -](\d{1,2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 32) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Converts a BS date to an AD date string (YYYY-MM-DD).
 * Accepts YYYY-MM-DD, YYYY/MM/DD, { year, month, day }, or separate (y, m, d).
 */
function bsToAd(bsInput, month, day) {
  try {
    if (month !== undefined && day !== undefined) {
      return temporal.bsToAd(bsInput, month, day);
    }
    if (typeof bsInput === 'string') {
      const norm = normalizeCalendarDateString(bsInput);
      if (!norm) return null;
      return temporal.bsToAd(norm);
    }
    if (bsInput && typeof bsInput === 'object') {
      return temporal.bsToAd(bsInput.year, bsInput.month, bsInput.day);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Converts an AD date string (YYYY-MM-DD) to a BS date string (YYYY-MM-DD).
 * Returns null if the AD date is invalid or outside the supported BS table.
 */
function adToBs(adInput) {
  try {
    const norm = normalizeCalendarDateString(adInput) || (adInput instanceof Date ? temporal.formatNepalDate(adInput) : null);
    if (!norm) return null;
    const res = temporal.adToBs(norm);
    return res ? res.dateStr : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes Devanagari digits, Nepali BS month names, English month names,
 * and date separators so dates can be reliably compared across languages and formats.
 * @param {string} text
 * @returns {string}
 */
function normalizeNepaliDatesAndDigits(text) {
  let out = normalizeDevanagariDigits(text).toLowerCase();
  for (const { canonical, variants } of BS_MONTH_CANONICAL) {
    for (const v of variants) {
      if (out.includes(v)) {
        const isAscii = /^[a-z]+$/.test(v);
        const pattern = isAscii ? new RegExp(`\\b${v}\\b`, 'gi') : new RegExp(v, 'g');
        out = out.replace(pattern, canonical);
      }
    }
  }
  for (const { canonical, variants } of AD_MONTH_CANONICAL) {
    for (const v of variants) {
      if (out.includes(v)) {
        const isAscii = /^[a-z]+$/.test(v);
        const pattern = isAscii ? new RegExp(`\\b${v}\\b`, 'gi') : new RegExp(v, 'g');
        out = out.replace(pattern, canonical);
      }
    }
  }
  // Normalize YYYY/MM/DD or YYYY.MM.DD to YYYY-MM-DD with zero-padded month/day
  out = out.replace(/\b(20\d{2})[/. -](0?[1-9]|1[0-2])[/. -](0?[1-9]|[12]\d|3[0-2])\b/g, (_, y, m, d) => {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  });
  // Normalize "<day> <month>" (e.g. "15 kartik" or "15th kartik" or "kartik 15 गते") to "<month> <day>"
  const allMonths = [...BS_MONTH_CANONICAL.map(m => m.canonical), ...AD_MONTH_CANONICAL.map(m => m.canonical)].join('|');
  out = out.replace(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:gate|गते)?\s+((?:baisakh|jestha|asar|shrawan|bhadra|asoj|kartik|mangsir|poush|magh|falgun|chaitra|january|february|march|april|may|june|july|august|september|october|november|december))\b/gi, (_, d, m) => `${m.toLowerCase()} ${Number(d)}`);
  out = out.replace(new RegExp(`\\b(${allMonths})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(?:gate|गते))?\\b`, 'gi'), (_, m, d) => `${m.toLowerCase()} ${Number(d)}`);
  return out;
}

/**
 * Returns a Date object adjusted to Asia/Kathmandu time.
 * @param {Date|string|number} [input=temporal.getNow()]
 * @returns {Date}
 */
function getNepalTime(input = temporal.getNow()) {
  const d = new Date(input);
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  return new Date(utc + (NEPAL_TIMEZONE_OFFSET_MINUTES * 60000));
}

/**
 * Formats a Date object to YYYY-MM-DD in Asia/Kathmandu.
 * @param {Date|string|number} [date=temporal.getNow()]
 * @returns {string}
 */
function formatNepalDate(date = temporal.getNow()) {
  return temporal.formatNepalDate(date);
}

/**
 * Normalizes Nepali text to make date extraction resilient.
 */
function normalizeDateText(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parses natural Nepali temporal expressions in user queries.
 * @param {string} text
 * @param {Date|string|number} [referenceDate=temporal.getNow()]
 * @returns {object|null}
 */
function parseNepaliDateExpression(text, referenceDate = temporal.getNow()) {
  const norm = normalizeDateText(text);
  if (!norm) return null;

  const baseAd = temporal.formatNepalDate(referenceDate);
  const [y, m, d] = baseAd.split('-').map(Number);
  const baseUtc = new Date(Date.UTC(y, m - 1, d));

  const addDays = (n) => {
    const target = new Date(baseUtc.getTime() + n * 86400000);
    return target.toISOString().slice(0, 10);
  };

  // 1. Aaja (today)
  if (/\b(aaja|today|aile|ahile)\b/.test(norm)) {
    const date = addDays(0);
    return {
      expression: 'aaja',
      label: 'Today',
      date,
      bsDate: adToBs(date)
    };
  }

  // 2. Voli / Bholi (tomorrow)
  if (/\b(voli|bholi|tomorrow)\b/.test(norm)) {
    const date = addDays(1);
    return {
      expression: 'bholi',
      label: 'Tomorrow',
      date,
      bsDate: adToBs(date)
    };
  }

  // 3. Parsi (day after tomorrow)
  if (/\b(parsi|day after tomorrow)\b/.test(norm)) {
    const date = addDays(2);
    return {
      expression: 'parsi',
      label: 'Day after tomorrow',
      date,
      bsDate: adToBs(date)
    };
  }

  // 4. Hijo (yesterday)
  if (/\b(hijo|yesterday)\b/.test(norm)) {
    const date = addDays(-1);
    return {
      expression: 'hijo',
      label: 'Yesterday',
      date,
      bsDate: adToBs(date)
    };
  }

  // 5. Asti (day before yesterday / recently)
  if (/\b(asti|day before yesterday)\b/.test(norm)) {
    const date = addDays(-2);
    return {
      expression: 'asti',
      label: 'Recently / Day before yesterday',
      date,
      bsDate: adToBs(date)
    };
  }

  // Weekday helper
  const dt = temporal.getNepalDateTime(referenceDate);
  const dayOfWeek = dt.dayOfWeekIndex; // 0 is Sunday

  // 6. This week (yo hapta)
  if (/\b(yo\s+hapta|this\s+week)\b/.test(norm)) {
    const startOffset = -dayOfWeek;
    const endOffset = 6 - dayOfWeek;
    const startDate = addDays(startOffset);
    const endDate = addDays(endOffset);
    return {
      expression: 'yo hapta',
      label: 'This week',
      startDate,
      endDate,
      bsStartDate: adToBs(startDate),
      bsEndDate: adToBs(endDate)
    };
  }

  // 7. Next week (arko hapta)
  if (/\b(arko\s+hapta|next\s+week)\b/.test(norm)) {
    const startOffset = 7 - dayOfWeek;
    const endOffset = 13 - dayOfWeek;
    const startDate = addDays(startOffset);
    const endDate = addDays(endOffset);
    return {
      expression: 'arko hapta',
      label: 'Next week',
      startDate,
      endDate,
      bsStartDate: adToBs(startDate),
      bsEndDate: adToBs(endDate)
    };
  }

  // 8. Last week (gako hapta / paila ko hapta)
  if (/\b(gako\s+hapta|paila\s+ko\s+hapta|last\s+week)\b/.test(norm)) {
    const startOffset = -7 - dayOfWeek;
    const endOffset = -1 - dayOfWeek;
    const startDate = addDays(startOffset);
    const endDate = addDays(endOffset);
    return {
      expression: 'last week',
      label: 'Last week',
      startDate,
      endDate,
      bsStartDate: adToBs(startDate),
      bsEndDate: adToBs(endDate)
    };
  }

  // Check explicit natural date using temporal parser
  const parsed = temporal.parseNaturalDate(text, referenceDate);
  if (parsed) {
    return {
      expression: parsed.expression,
      label: parsed.label,
      date: parsed.adDate,
      bsDate: parsed.bs.dateStr
    };
  }

  return null;
}

/**
 * Checks whether a database record's date matches `dateInfo` (single date or range),
 * respecting the record's calendar ('BS' vs 'AD') and normalizing slash/hyphen formats.
 * Never compares BS dates directly against AD dates.
 *
 * @param {string} recordDateValue - Date string from DB (e.g. '2083/07/20', '2026-11-05', or ISO timestamp)
 * @param {object} dateInfo - Output from parseNepaliDateExpression()
 * @param {string} [recordCalendar='AD'] - 'BS' or 'AD'
 * @returns {boolean}
 */
function matchesDateFilter(recordDateValue, dateInfo, recordCalendar = 'AD') {
  if (!dateInfo || dateInfo.unresolvable) return true;
  const normRecordDate = normalizeCalendarDateString(recordDateValue);
  if (!normRecordDate) return false;

  const recYear = Number(normRecordDate.slice(0, 4));
  const calUpper = String(recordCalendar || '').trim().toUpperCase();
  const isRecordBs = calUpper === 'BS' || (calUpper !== 'AD' && recYear >= 2070);

  if (isRecordBs) {
    const targetSingle = dateInfo.bsDate || (dateInfo.date ? adToBs(dateInfo.date) : null);
    const targetStart = dateInfo.bsStartDate || (dateInfo.startDate ? adToBs(dateInfo.startDate) : null);
    const targetEnd = dateInfo.bsEndDate || (dateInfo.endDate ? adToBs(dateInfo.endDate) : null);

    if (targetSingle) return normRecordDate === targetSingle;
    if (targetStart && targetEnd) return normRecordDate >= targetStart && normRecordDate <= targetEnd;
    return false;
  } else {
    const targetSingle = dateInfo.date || (dateInfo.bsDate ? bsToAd(dateInfo.bsDate) : null);
    const targetStart = dateInfo.startDate || (dateInfo.bsStartDate ? bsToAd(dateInfo.bsStartDate) : null);
    const targetEnd = dateInfo.endDate || (dateInfo.bsEndDate ? bsToAd(dateInfo.bsEndDate) : null);

    if (targetSingle) return normRecordDate === targetSingle;
    if (targetStart && targetEnd) return normRecordDate >= targetStart && normRecordDate <= targetEnd;
    return false;
  }
}

module.exports = {
  getNepalTime,
  formatNepalDate,
  parseNepaliDateExpression,
  normalizeDevanagariDigits,
  normalizeNepaliDatesAndDigits,
  normalizeCalendarDateString,
  bsToAd,
  adToBs,
  matchesDateFilter,
  BS_MONTH_CANONICAL,
  AD_MONTH_CANONICAL,
  BS_CALENDAR_MONTH_DAYS,
  NEPAL_TIMEZONE_OFFSET_MINUTES,
  // Temporal intelligence engine exports
  temporal,
  setMockTime: temporal.setMockTime,
  resetMockTime: temporal.resetMockTime,
  isMockTimeActive: temporal.isMockTimeActive,
  getNow: temporal.getNow,
  getNepalDateTime: temporal.getNepalDateTime,
  calculateDaysBetween: temporal.calculateDaysBetween,
  calculateDaysRemaining: temporal.calculateDaysRemaining,
  calculateDaysElapsed: temporal.calculateDaysElapsed,
  getTemporalContext: temporal.getTemporalContext,
  calculateEventCountdown: temporal.calculateEventCountdown,
  parseNaturalDate: temporal.parseNaturalDate,
  toDevanagariDigits: temporal.toDevanagariDigits
};
