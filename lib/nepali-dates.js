'use strict';

/**
 * Nepali Date and Time Utilities for Kyana AI.
 * Grounded in Asia/Kathmandu timezone (UTC+05:45).
 * Interprets natural Nepali temporal words: aaja, voli/bholi, hijo, asti, parsi, etc.,
 * and normalizes Devanagari digits and Bikram Sambat (BS) month names.
 */

const NEPAL_TIMEZONE_OFFSET_MINUTES = 345; // 5 hours 45 minutes = 345 minutes

const DEVANAGARI_DIGITS = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
};

const BS_MONTH_CANONICAL = [
  { canonical: 'baisakh', variants: ['baisakh', 'baishakh', 'vaisakh', 'vaishakh', 'बैशाख', 'वैशाख'] },
  { canonical: 'jestha', variants: ['jestha', 'jeth', 'jyestha', 'जेठ', 'ज्येष्ठ'] },
  { canonical: 'asar', variants: ['asar', 'ashadh', 'ashad', 'aashadh', 'असार', 'आषाढ'] },
  { canonical: 'shrawan', variants: ['shrawan', 'sawan', 'saun', 'shravan', 'साउन', 'श्रावण'] },
  { canonical: 'bhadra', variants: ['bhadra', 'bhadau', 'bhau', 'भदौ', 'भाद्र'] },
  { canonical: 'asoj', variants: ['asoj', 'ashoj', 'ashwin', 'aaswin', 'असोज', 'आश्विन'] },
  { canonical: 'kartik', variants: ['kartik', 'kattik', 'कार्तिक', 'कात्तिक'] },
  { canonical: 'mangsir', variants: ['mangsir', 'mangshir', 'marga', 'मंसिर', 'मार्ग', 'मङ्सिर'] },
  { canonical: 'poush', variants: ['poush', 'push', 'pus', 'paush', 'पुस', 'पौष', 'पूष'] },
  { canonical: 'magh', variants: ['magh', 'माघ'] },
  { canonical: 'falgun', variants: ['falgun', 'phalgun', 'fagun', 'फागुन', 'फाल्गुन'] },
  { canonical: 'chaitra', variants: ['chaitra', 'chait', 'चैत', 'चैत्र'] }
];

const AD_MONTH_CANONICAL = [
  { canonical: 'january', num: '01', variants: ['january', 'jan', 'जनवरी'] },
  { canonical: 'february', num: '02', variants: ['february', 'feb', 'फेब्रुअरी'] },
  { canonical: 'march', num: '03', variants: ['march', 'mar', 'मार्च'] },
  { canonical: 'april', num: '04', variants: ['april', 'apr', 'अप्रिल'] },
  { canonical: 'may', num: '05', variants: ['may', 'मे'] },
  { canonical: 'june', num: '06', variants: ['june', 'jun', 'जुन'] },
  { canonical: 'july', num: '07', variants: ['july', 'jul', 'जुलाई'] },
  { canonical: 'august', num: '08', variants: ['august', 'aug', 'अगस्ट'] },
  { canonical: 'september', num: '09', variants: ['september', 'sept', 'sep', 'सेप्टेम्बर'] },
  { canonical: 'october', num: '10', variants: ['october', 'oct', 'अक्टोबर'] },
  { canonical: 'november', num: '11', variants: ['november', 'nov', 'नोभेम्बर'] },
  { canonical: 'december', num: '12', variants: ['december', 'dec', 'डिसेम्बर'] }
];

/**
 * Replaces Devanagari digits (०-९) with ASCII digits (0-9).
 * @param {string} text
 * @returns {string}
 */
function normalizeDevanagariDigits(text) {
  return String(text || '').replace(/[०-९]/g, ch => DEVANAGARI_DIGITS[ch] ?? ch);
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
  return normalizeDevanagariDigits(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
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
  if (/\b(aaja|today|aile|ahile)\b/.test(norm) || /आज|अहिले/.test(String(text || ''))) {
    return {
      expression: 'aaja',
      label: 'Today',
      date: addDays(0)
    };
  }

  // 2. Voli / Bholi (tomorrow)
  if (/\b(voli|bholi|tomorrow)\b/.test(norm) || /भोलि|भोली/.test(String(text || ''))) {
    return {
      expression: 'bholi',
      label: 'Tomorrow',
      date: addDays(1)
    };
  }

  // 3. Parsi (day after tomorrow)
  if (/\b(parsi|day after tomorrow)\b/.test(norm) || /पर्सि|पर्सी/.test(String(text || ''))) {
    return {
      expression: 'parsi',
      label: 'Day after tomorrow',
      date: addDays(2)
    };
  }

  // 4. Hijo (yesterday)
  if (/\b(hijo|yesterday)\b/.test(norm) || /हिजो/.test(String(text || ''))) {
    return {
      expression: 'hijo',
      label: 'Yesterday',
      date: addDays(-1)
    };
  }

  // 5. Asti (day before yesterday / recently)
  if (/\b(asti|day before yesterday)\b/.test(norm) || /अस्ति/.test(String(text || ''))) {
    return {
      expression: 'asti',
      label: 'Recently / Day before yesterday',
      date: addDays(-2)
    };
  }

  // 6. This week (yo hapta)
  if (/\b(yo\s+hapta|this\s+week)\b/.test(norm) || /यो\s*हप्ता/.test(String(text || ''))) {
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
  if (/\b(arko\s+hapta|next\s+week)\b/.test(norm) || /अर्को\s*हप्ता/.test(String(text || ''))) {
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
  if (/\b(gako\s+hapta|paila\s+ko\s+hapta|last\s+week)\b/.test(norm) || /गएको\s*हप्ता/.test(String(text || ''))) {
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
  normalizeDevanagariDigits,
  normalizeNepaliDatesAndDigits,
  BS_MONTH_CANONICAL,
  AD_MONTH_CANONICAL,
  NEPAL_TIMEZONE_OFFSET_MINUTES
};
