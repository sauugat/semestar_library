'use strict';

/**
 * Nepali Date and Time Utilities for Kyana AI.
 * Grounded in Asia/Kathmandu timezone (UTC+05:45).
 * Supports:
 * - Natural Nepali temporal expressions (aaja, bholi/voli, parsi, hijo, asti, yo hapta, arko hapta)
 * - Explicit single dates & date ranges in BS and AD
 * - Accurate Bikram Sambat (BS) <-> Gregorian (AD) conversion (2078–2087 BS)
 * - Normalization of slash-formatted (YYYY/MM/DD) and hyphen-formatted (YYYY-MM-DD) dates
 * - Calendar-aware date matching (`matchesDateFilter`) that never compares BS directly against AD
 * - Deterministic temporal & deadline calculations (`getCurrentNepalDateTime`, `calculateDateDifference`,
 *   `calculateAssignmentDeadline`, `resolveNextExamination`, `compareAndResolveTemporalRecords`)
 */

const NEPAL_TIMEZONE_OFFSET_MINUTES = 345; // 5 hours 45 minutes = 345 minutes

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

// Official Bikram Sambat month lengths (Baisakh..Chaitra) for years 2078–2087 BS.
// Anchor: 2078-01-01 BS = 2021-04-14 AD (2080-01-01 BS = 2023-04-14 AD).
const BS_CALENDAR_MONTH_DAYS = {
  2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2085: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2086: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30]
};
const BS_ANCHOR_YEAR = 2078;
const BS_ANCHOR_AD_UTC = Date.UTC(2021, 3, 14); // 2021-04-14 UTC
const MS_PER_DAY = 86400000;

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
 * Converts a BS date (YYYY-MM-DD or { year, month, day }) to an AD date string (YYYY-MM-DD).
 * Returns null if the BS date is invalid or outside the supported BS table.
 */
function bsToAd(bsInput) {
  let year;
  let month;
  let day;
  if (typeof bsInput === 'string') {
    const norm = normalizeCalendarDateString(bsInput);
    if (!norm) return null;
    const parts = norm.split('-').map(Number);
    [year, month, day] = parts;
  } else if (bsInput && typeof bsInput === 'object') {
    year = Number(bsInput.year);
    month = Number(bsInput.month);
    day = Number(bsInput.day);
  } else {
    return null;
  }

  const monthDays = BS_CALENDAR_MONTH_DAYS[year];
  if (!monthDays || month < 1 || month > 12) return null;
  const maxDay = monthDays[month - 1];
  if (!Number.isInteger(day) || day < 1 || day > maxDay) return null;

  let totalDays = 0;
  for (let y = BS_ANCHOR_YEAR; y < year; y++) {
    const yDays = BS_CALENDAR_MONTH_DAYS[y];
    if (!yDays) return null;
    totalDays += yDays.reduce((a, b) => a + b, 0);
  }
  for (let m = 0; m < month - 1; m++) {
    totalDays += monthDays[m];
  }
  totalDays += (day - 1);

  const adDate = new Date(BS_ANCHOR_AD_UTC + totalDays * MS_PER_DAY);
  const adY = adDate.getUTCFullYear();
  const adM = String(adDate.getUTCMonth() + 1).padStart(2, '0');
  const adD = String(adDate.getUTCDate()).padStart(2, '0');
  return `${adY}-${adM}-${adD}`;
}

/**
 * Converts an AD date string (YYYY-MM-DD) to a BS date string (YYYY-MM-DD).
 * Returns null if the AD date is invalid or outside the supported BS table.
 */
function adToBs(adInput) {
  const norm = normalizeCalendarDateString(adInput);
  if (!norm) return null;
  const [adY, adM, adD] = norm.split('-').map(Number);
  const utcCheck = new Date(Date.UTC(adY, adM - 1, adD));
  if (
    utcCheck.getUTCFullYear() !== adY ||
    utcCheck.getUTCMonth() !== adM - 1 ||
    utcCheck.getUTCDate() !== adD
  ) {
    return null;
  }

  let diffDays = Math.round((utcCheck.getTime() - BS_ANCHOR_AD_UTC) / MS_PER_DAY);
  if (diffDays < 0) return null;

  for (const yearStr of Object.keys(BS_CALENDAR_MONTH_DAYS)) {
    const bsYear = Number(yearStr);
    const months = BS_CALENDAR_MONTH_DAYS[bsYear];
    for (let mIdx = 0; mIdx < 12; mIdx++) {
      const mDays = months[mIdx];
      if (diffDays < mDays) {
        const bsDay = diffDays + 1;
        return `${bsYear}-${String(mIdx + 1).padStart(2, '0')}-${String(bsDay).padStart(2, '0')}`;
      }
      diffDays -= mDays;
    }
  }
  return null;
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
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
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

function normalizeDateText(text) {
  return normalizeDevanagariDigits(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Builds a complete single-date descriptor with both AD and BS dates.
 */
function buildSingleDateInfo(expression, label, adDate, bsDate = null, sourceCalendar = 'AD') {
  const resolvedAd = adDate || (bsDate ? bsToAd(bsDate) : null);
  const resolvedBs = bsDate || (resolvedAd ? adToBs(resolvedAd) : null);
  return {
    expression,
    label,
    calendar: sourceCalendar,
    date: resolvedAd,
    bsDate: resolvedBs
  };
}

/**
 * Builds a complete date-range descriptor with both AD and BS start/end dates.
 */
function buildRangeDateInfo(expression, label, adStart, adEnd, bsStart = null, bsEnd = null, sourceCalendar = 'AD') {
  const resolvedAdStart = adStart || (bsStart ? bsToAd(bsStart) : null);
  const resolvedAdEnd = adEnd || (bsEnd ? bsToAd(bsEnd) : null);
  const resolvedBsStart = bsStart || (resolvedAdStart ? adToBs(resolvedAdStart) : null);
  const resolvedBsEnd = bsEnd || (resolvedAdEnd ? adToBs(resolvedAdEnd) : null);
  return {
    expression,
    label,
    calendar: sourceCalendar,
    startDate: resolvedAdStart,
    endDate: resolvedAdEnd,
    bsStartDate: resolvedBsStart,
    bsEndDate: resolvedBsEnd
  };
}

/**
 * Resolves an atomic date token (numeric YYYY-MM-DD / YYYY/MM/DD or named BS/AD month+day)
 * into `{ adDate, bsDate, calendar, raw, invalid }`.
 */
function resolveSingleDateMention(fragment, referenceDate = new Date()) {
  const clean = normalizeDevanagariDigits(String(fragment || '')).trim();
  if (!clean) return null;

  // 1. Numeric YYYY-MM-DD or YYYY/MM/DD
  const numMatch = clean.match(/\b(20\d{2})[/. -](\d{1,2})[/. -](\d{1,2})\b/);
  if (numMatch) {
    const y = Number(numMatch[1]);
    const m = Number(numMatch[2]);
    const d = Number(numMatch[3]);
    const isBs = y >= 2070 || /\bbs\b|बि\.?\s*सं/i.test(clean);
    const formatted = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (isBs) {
      const ad = bsToAd({ year: y, month: m, day: d });
      if (!ad) {
        return { raw: numMatch[0], calendar: 'BS', invalid: true, reason: `Could not resolve Bikram Sambat date ${formatted}. Please clarify the exact BS or AD date.` };
      }
      return { raw: numMatch[0], calendar: 'BS', bsDate: formatted, adDate: ad };
    } else {
      const bs = adToBs(formatted);
      const utcCheck = new Date(Date.UTC(y, m - 1, d));
      if (utcCheck.getUTCFullYear() !== y || utcCheck.getUTCMonth() !== m - 1 || utcCheck.getUTCDate() !== d) {
        return { raw: numMatch[0], calendar: 'AD', invalid: true, reason: `Invalid calendar date ${formatted}. Please check the month and day.` };
      }
      return { raw: numMatch[0], calendar: 'AD', adDate: formatted, bsDate: bs };
    }
  }

  const lower = normalizeNepaliDatesAndDigits(clean);
  const refAd = formatNepalDate(referenceDate);
  const refBs = adToBs(refAd) || '2083-07-01';
  const defaultBsYear = Number(refBs.slice(0, 4));
  const defaultAdYear = Number(refAd.slice(0, 4));

  // 2. Named BS month + day (with optional 20xx year)
  for (const mObj of BS_MONTH_CANONICAL) {
    const mRe = new RegExp(`(?:\\b(20\\d{2})\\s+)?\\b${mObj.canonical}\\s+(\\d{1,2})(?:\\s*,?\\s*(20\\d{2}))?\\b`, 'i');
    const match = lower.match(mRe);
    if (match) {
      const bsYear = Number(match[1] || match[3] || defaultBsYear);
      const bsDay = Number(match[2]);
      const bsStr = `${bsYear}-${String(mObj.num).padStart(2, '0')}-${String(bsDay).padStart(2, '0')}`;
      const ad = bsToAd({ year: bsYear, month: mObj.num, day: bsDay });
      if (!ad) {
        return { raw: match[0], calendar: 'BS', invalid: true, reason: `Could not resolve BS date "${mObj.canonical} ${bsDay}, ${bsYear}". Please verify the date.` };
      }
      return { raw: match[0], calendar: 'BS', bsDate: bsStr, adDate: ad };
    }
  }

  // 3. Named AD month + day (with optional 20xx year)
  for (const mObj of AD_MONTH_CANONICAL) {
    const mRe = new RegExp(`(?:\\b(20\\d{2})\\s+)?\\b${mObj.canonical}\\s+(\\d{1,2})(?:\\s*,?\\s*(20\\d{2}))?\\b`, 'i');
    const match = lower.match(mRe);
    if (match) {
      const adYear = Number(match[1] || match[3] || defaultAdYear);
      const adDay = Number(match[2]);
      const adStr = `${adYear}-${mObj.num}-${String(adDay).padStart(2, '0')}`;
      const utcCheck = new Date(Date.UTC(adYear, mObj.monthIdx - 1, adDay));
      if (utcCheck.getUTCFullYear() !== adYear || utcCheck.getUTCMonth() !== mObj.monthIdx - 1 || utcCheck.getUTCDate() !== adDay) {
        return { raw: match[0], calendar: 'AD', invalid: true, reason: `Invalid date "${mObj.canonical} ${adDay}, ${adYear}".` };
      }
      return { raw: match[0], calendar: 'AD', adDate: adStr, bsDate: adToBs(adStr) };
    }
  }

  return null;
}

/**
 * Parses natural Nepali and English temporal expressions, explicit BS/AD dates,
 * and explicit date ranges in user queries.
 *
 * @param {string} text
 * @param {Date} [referenceDate=new Date()]
 * @returns {object | null}
 */
function parseNepaliDateExpression(text, referenceDate = new Date()) {
  const rawText = String(text || '').trim();
  if (!rawText) return null;
  const norm = normalizeDateText(rawText);
  const base = getNepalTime(referenceDate);

  const addDays = (n) => {
    const d = new Date(base);
    d.setDate(d.getDate() + n);
    return formatNepalDate(d);
  };

  // 1. Explicit date range: "from X to Y", "between X and Y", "X dekhi Y samma", "X बाट Y सम्म", "X देखि Y सम्म"
  const normDatesText = normalizeNepaliDatesAndDigits(rawText);
  const rangePatterns = [
    /\b(?:from|between)\s+([a-z0-9/. -]+?)\s+(?:to|and|until|till|-)\s+([a-z0-9/. -]+)\b/i,
    /\b([a-z0-9/. -]+?)\s+(?:dekhi|bata|देखि|बाट)\s+([a-z0-9/. -]+?)(?:\s+(?:samma|सम्म))?\b/i,
    /\b(20\d{2}-\d{2}-\d{2})\s*(?:to|dekhi|-|–|—)\s*(20\d{2}-\d{2}-\d{2})\b/i
  ];
  for (const rp of rangePatterns) {
    const rm = normDatesText.match(rp);
    if (rm) {
      const startRes = resolveSingleDateMention(rm[1], referenceDate);
      const endRes = resolveSingleDateMention(rm[2], referenceDate);
      if (startRes && endRes) {
        if (startRes.invalid || endRes.invalid) {
          return {
            expression: rm[0],
            label: 'Unresolvable date range',
            ambiguous: true,
            unresolvable: true,
            clarification: startRes.reason || endRes.reason || 'Could not resolve that date range. Please specify valid BS or AD dates (e.g., 2083-07-15 to 2083-07-20).'
          };
        }
        return buildRangeDateInfo(
          rm[0],
          `${startRes.bsDate || startRes.adDate} to ${endRes.bsDate || endRes.adDate}`,
          startRes.adDate,
          endRes.adDate,
          startRes.bsDate,
          endRes.bsDate,
          startRes.calendar
        );
      }
    }
  }

  // 2. Relative expressions: Aaja (today)
  if (/\b(aaja|today|aile|ahile)\b/.test(norm) || /आज|अहिले/.test(rawText)) {
    return buildSingleDateInfo('aaja', 'Today', addDays(0));
  }

  // 3. Voli / Bholi (tomorrow)
  if (/\b(voli|bholi|tomorrow)\b/.test(norm) || /भोलि|भोली/.test(rawText)) {
    return buildSingleDateInfo('bholi', 'Tomorrow', addDays(1));
  }

  // 4. Parsi (day after tomorrow)
  if (/\b(parsi|day after tomorrow)\b/.test(norm) || /पर्सि|पर्सी/.test(rawText)) {
    return buildSingleDateInfo('parsi', 'Day after tomorrow', addDays(2));
  }

  // 5. Hijo (yesterday)
  if (/\b(hijo|yesterday)\b/.test(norm) || /हिजो/.test(rawText)) {
    return buildSingleDateInfo('hijo', 'Yesterday', addDays(-1));
  }

  // 6. Asti (day before yesterday / recently)
  if (/\b(asti|day before yesterday)\b/.test(norm) || /अस्ति/.test(rawText)) {
    return buildSingleDateInfo('asti', 'Recently / Day before yesterday', addDays(-2));
  }

  // 7. This week (yo hapta)
  if (/\b(yo\s+hapta|this\s+week)\b/.test(norm) || /यो\s*हप्ता/.test(rawText)) {
    const dayOfWeek = base.getDay(); // 0 is Sunday
    return buildRangeDateInfo('yo hapta', 'This week', addDays(-dayOfWeek), addDays(6 - dayOfWeek));
  }

  // 8. Next week (arko hapta)
  if (/\b(arko\s+hapta|next\s+week)\b/.test(norm) || /अर्को\s*हप्ता/.test(rawText)) {
    const dayOfWeek = base.getDay();
    return buildRangeDateInfo('arko hapta', 'Next week', addDays(7 - dayOfWeek), addDays(13 - dayOfWeek));
  }

  // 9. Last week (gako hapta / paila ko hapta)
  if (/\b(gako\s+hapta|paila\s+ko\s+hapta|last\s+week)\b/.test(norm) || /गएको\s*हप्ता/.test(rawText)) {
    const dayOfWeek = base.getDay();
    return buildRangeDateInfo('last week', 'Last week', addDays(-7 - dayOfWeek), addDays(-1 - dayOfWeek));
  }

  // 10. Explicit single BS or AD date in text (e.g., "2083/07/20", "2026-11-05", "Kartik 20", "Nov 5")
  const explicitSingle = resolveSingleDateMention(rawText, referenceDate);
  if (explicitSingle) {
    if (explicitSingle.invalid) {
      return {
        expression: explicitSingle.raw,
        label: 'Unresolvable date',
        ambiguous: true,
        unresolvable: true,
        clarification: explicitSingle.reason
      };
    }
    return buildSingleDateInfo(
      explicitSingle.raw,
      explicitSingle.bsDate && explicitSingle.calendar === 'BS' ? `${explicitSingle.bsDate} BS` : explicitSingle.adDate,
      explicitSingle.adDate,
      explicitSingle.bsDate,
      explicitSingle.calendar
    );
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

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Returns authoritative server-side current date and time in Asia/Kathmandu (UTC+05:45),
 * including both Gregorian (AD) and Bikram Sambat (BS) representations.
 *
 * @param {Date|string|number} [referenceDate=new Date()]
 * @returns {object}
 */
function getCurrentNepalDateTime(referenceDate = new Date()) {
  const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const safeRef = Number.isNaN(ref.getTime()) ? new Date() : ref;
  const nepalDateObj = getNepalTime(safeRef);
  const adDate = formatNepalDate(safeRef);
  const bsDate = adToBs(adDate);
  const hours = String(nepalDateObj.getHours()).padStart(2, '0');
  const minutes = String(nepalDateObj.getMinutes()).padStart(2, '0');
  const seconds = String(nepalDateObj.getSeconds()).padStart(2, '0');
  const weekday = WEEKDAY_NAMES[nepalDateObj.getDay()] || '';

  return {
    iso: safeRef.toISOString(),
    adDate,
    bsDate,
    time: `${hours}:${minutes}:${seconds}`,
    weekday,
    timezone: 'Asia/Kathmandu',
    utcOffset: '+05:45',
    timestampMs: safeRef.getTime()
  };
}

/**
 * Resolves any date string or Date object (AD or BS, numeric or named month)
 * into a canonical `{ valid, adDate, bsDate, calendar, raw, reason }` descriptor.
 *
 * @param {string|Date} dateInput
 * @param {string|null} [calendarHint=null] - 'AD' or 'BS'
 * @param {Date|string|number} [referenceDate=new Date()]
 * @returns {object}
 */
function resolveCalendarDate(dateInput, calendarHint = null, referenceDate = new Date()) {
  if (dateInput === null || dateInput === undefined || String(dateInput).trim() === '') {
    return { valid: false, adDate: null, bsDate: null, calendar: null, raw: null, reason: 'Missing date value' };
  }

  if (dateInput instanceof Date) {
    if (Number.isNaN(dateInput.getTime())) {
      return { valid: false, adDate: null, bsDate: null, calendar: 'AD', raw: String(dateInput), reason: 'Invalid Date object' };
    }
    const adDate = formatNepalDate(dateInput);
    return {
      valid: true,
      adDate,
      bsDate: adToBs(adDate),
      calendar: 'AD',
      raw: dateInput.toISOString()
    };
  }

  const rawStr = String(dateInput).trim();
  const normCal = normalizeCalendarDateString(rawStr);
  const calUpper = String(calendarHint || '').trim().toUpperCase();

  if (normCal) {
    const year = Number(normCal.slice(0, 4));
    const isBs = calUpper === 'BS' || (calUpper !== 'AD' && year >= 2070);
    if (isBs) {
      const adDate = bsToAd(normCal);
      if (!adDate) {
        return {
          valid: false,
          adDate: null,
          bsDate: normCal,
          calendar: 'BS',
          raw: rawStr,
          reason: `Invalid or unsupported Bikram Sambat date: ${normCal}`
        };
      }
      return {
        valid: true,
        adDate,
        bsDate: normCal,
        calendar: 'BS',
        raw: rawStr
      };
    } else {
      const [y, m, d] = normCal.split('-').map(Number);
      const utcCheck = new Date(Date.UTC(y, m - 1, d));
      if (utcCheck.getUTCFullYear() !== y || utcCheck.getUTCMonth() !== m - 1 || utcCheck.getUTCDate() !== d) {
        return {
          valid: false,
          adDate: null,
          bsDate: null,
          calendar: 'AD',
          raw: rawStr,
          reason: `Invalid Gregorian calendar date: ${normCal}`
        };
      }
      return {
        valid: true,
        adDate: normCal,
        bsDate: adToBs(normCal),
        calendar: 'AD',
        raw: rawStr
      };
    }
  }

  const mention = resolveSingleDateMention(rawStr, referenceDate);
  if (mention) {
    if (mention.invalid) {
      return {
        valid: false,
        adDate: null,
        bsDate: mention.bsDate || null,
        calendar: mention.calendar || calUpper || null,
        raw: rawStr,
        reason: mention.reason || `Invalid date: ${rawStr}`
      };
    }
    return {
      valid: true,
      adDate: mention.adDate,
      bsDate: mention.bsDate || adToBs(mention.adDate),
      calendar: mention.calendar || 'AD',
      raw: rawStr
    };
  }

  const parsedExpr = parseNepaliDateExpression(rawStr, referenceDate);
  if (parsedExpr && !parsedExpr.unresolvable && (parsedExpr.date || parsedExpr.bsDate)) {
    const adDate = parsedExpr.date || bsToAd(parsedExpr.bsDate);
    return {
      valid: Boolean(adDate),
      adDate,
      bsDate: parsedExpr.bsDate || adToBs(adDate),
      calendar: parsedExpr.calendar || 'AD',
      raw: rawStr
    };
  }

  return {
    valid: false,
    adDate: null,
    bsDate: null,
    calendar: calUpper || null,
    raw: rawStr,
    reason: parsedExpr?.clarification || `Could not parse date: ${rawStr}`
  };
}

function adDateToUtcMidnightMs(adDateStr) {
  if (!adDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(adDateStr)) return null;
  const [y, m, d] = adDateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Deterministically calculates days remaining or days elapsed between a target date
 * (AD or BS) and a reference date (defaults to current server time in Asia/Kathmandu).
 *
 * @param {string|Date} targetDate
 * @param {Date|string|number} [referenceDate=new Date()]
 * @param {object} [options={}]
 * @returns {object}
 */
function calculateDateDifference(targetDate, referenceDate = new Date(), options = {}) {
  const refNow = getCurrentNepalDateTime(referenceDate);
  const resolvedRef = resolveCalendarDate(referenceDate, options.referenceCalendar || null, referenceDate);
  const referenceAdDate = resolvedRef.valid ? resolvedRef.adDate : refNow.adDate;
  const referenceBsDate = resolvedRef.valid ? resolvedRef.bsDate : refNow.bsDate;

  const resolvedTarget = resolveCalendarDate(targetDate, options.calendar || options.targetCalendar || null, referenceDate);
  if (!resolvedTarget.valid || !resolvedTarget.adDate) {
    return {
      valid: false,
      reason: resolvedTarget.reason || 'Invalid target date',
      targetAdDate: null,
      targetBsDate: resolvedTarget.bsDate || null,
      referenceAdDate,
      referenceBsDate,
      daysRemaining: null,
      daysElapsed: null,
      diffDays: null
    };
  }

  const refMs = adDateToUtcMidnightMs(referenceAdDate);
  const targetMs = adDateToUtcMidnightMs(resolvedTarget.adDate);
  const diffDays = Math.round((targetMs - refMs) / MS_PER_DAY);
  const daysRemaining = diffDays >= 0 ? diffDays : 0;
  const daysElapsed = diffDays < 0 ? Math.abs(diffDays) : 0;
  const isToday = diffDays === 0;
  const isTomorrow = diffDays === 1;
  const isYesterday = diffDays === -1;
  const isFuture = diffDays > 0;
  const isPast = diffDays < 0;

  let statusLabel;
  if (isToday) {
    statusLabel = 'Today (0 days remaining)';
  } else if (isTomorrow) {
    statusLabel = 'Tomorrow (1 day remaining)';
  } else if (isFuture) {
    statusLabel = `${diffDays} days remaining`;
  } else if (isYesterday) {
    statusLabel = 'Yesterday (1 day ago)';
  } else {
    statusLabel = `${daysElapsed} days ago`;
  }

  return {
    valid: true,
    targetAdDate: resolvedTarget.adDate,
    targetBsDate: resolvedTarget.bsDate,
    targetCalendar: resolvedTarget.calendar,
    referenceAdDate,
    referenceBsDate,
    diffDays,
    daysRemaining: isFuture || isToday ? diffDays : 0,
    daysElapsed,
    signedDaysRemaining: diffDays,
    isToday,
    isTomorrow,
    isYesterday,
    isFuture,
    isPast,
    statusLabel
  };
}

/**
 * Deterministically evaluates an assignment's deadline and personal submission status.
 * Never fabricates a deadline when `deadline` is missing/null.
 *
 * @param {object|string|null} assignmentOrDeadline
 * @param {Date|string|number} [referenceDate=new Date()]
 * @param {object|null} [submissionInfo=null]
 * @returns {object}
 */
function calculateAssignmentDeadline(assignmentOrDeadline, referenceDate = new Date(), submissionInfo = null) {
  const isObj = assignmentOrDeadline && typeof assignmentOrDeadline === 'object' && !(assignmentOrDeadline instanceof Date);
  const rawDeadline = isObj
    ? (assignmentOrDeadline.deadline ?? assignmentOrDeadline.dueDate ?? assignmentOrDeadline.due_date ?? null)
    : assignmentOrDeadline;

  const questionCount = Number(
    submissionInfo?.questionCount ??
    (isObj ? (assignmentOrDeadline.questionCount ?? assignmentOrDeadline.question_count ?? 1) : 1)
  ) || 1;
  const mySubmissionCount = Number(
    submissionInfo?.mySubmissionCount ??
    submissionInfo?.submittedCount ??
    (isObj ? (assignmentOrDeadline.mySubmissionCount ?? assignmentOrDeadline.my_submission_count ?? 0) : 0)
  ) || 0;
  const submitted = submissionInfo?.submitted !== undefined
    ? Boolean(submissionInfo.submitted)
    : mySubmissionCount > 0;
  const fullySubmitted = submitted && mySubmissionCount >= questionCount;
  const partiallySubmitted = submitted && mySubmissionCount < questionCount;

  const refNow = getCurrentNepalDateTime(referenceDate);

  if (rawDeadline === null || rawDeadline === undefined || String(rawDeadline).trim() === '') {
    return {
      hasDeadline: false,
      deadlineRaw: null,
      adDate: null,
      bsDate: null,
      referenceAdDate: refNow.adDate,
      referenceBsDate: refNow.bsDate,
      daysRemaining: null,
      daysElapsed: null,
      signedDaysRemaining: null,
      isOverdue: false,
      isDueToday: false,
      isUpcoming: false,
      status: 'no_deadline',
      statusLabel: 'No deadline specified',
      submitted,
      fullySubmitted,
      partiallySubmitted,
      mySubmissionCount,
      questionCount,
      unsubmittedCount: Math.max(0, questionCount - mySubmissionCount)
    };
  }

  const diff = calculateDateDifference(rawDeadline, referenceDate, {
    calendar: isObj ? assignmentOrDeadline.calendar : null
  });

  if (!diff.valid) {
    return {
      hasDeadline: true,
      validDeadline: false,
      deadlineRaw: String(rawDeadline),
      adDate: null,
      bsDate: null,
      referenceAdDate: refNow.adDate,
      referenceBsDate: refNow.bsDate,
      daysRemaining: null,
      daysElapsed: null,
      signedDaysRemaining: null,
      isOverdue: false,
      isDueToday: false,
      isUpcoming: false,
      status: 'unresolvable_deadline',
      statusLabel: `Deadline format could not be parsed (${rawDeadline})`,
      submitted,
      fullySubmitted,
      partiallySubmitted,
      mySubmissionCount,
      questionCount,
      unsubmittedCount: Math.max(0, questionCount - mySubmissionCount)
    };
  }

  const isOverdue = diff.isPast;
  const isDueToday = diff.isToday;
  const isUpcoming = diff.isFuture;

  let status;
  let statusLabel;
  if (isDueToday) {
    status = 'due_today';
    statusLabel = 'Due today (0 days remaining)';
  } else if (isUpcoming) {
    status = 'upcoming';
    statusLabel = diff.diffDays === 1 ? '1 day remaining (due tomorrow)' : `${diff.diffDays} days remaining`;
  } else {
    status = 'overdue';
    statusLabel = diff.daysElapsed === 1 ? 'Overdue by 1 day' : `Overdue by ${diff.daysElapsed} days`;
  }

  return {
    hasDeadline: true,
    validDeadline: true,
    deadlineRaw: String(rawDeadline),
    adDate: diff.targetAdDate,
    bsDate: diff.targetBsDate,
    referenceAdDate: diff.referenceAdDate,
    referenceBsDate: diff.referenceBsDate,
    daysRemaining: isUpcoming || isDueToday ? diff.diffDays : 0,
    daysElapsed: diff.daysElapsed,
    signedDaysRemaining: diff.diffDays,
    isOverdue,
    isDueToday,
    isUpcoming,
    status,
    statusLabel,
    submitted,
    fullySubmitted,
    partiallySubmitted,
    mySubmissionCount,
    questionCount,
    unsubmittedCount: Math.max(0, questionCount - mySubmissionCount)
  };
}

/**
 * Deterministically identifies the next upcoming examination(s) from routine rows
 * by converting both BS and AD exam dates to comparable Gregorian dates in Asia/Kathmandu.
 *
 * @param {Array<object>} routineRows
 * @param {Date|string|number} [referenceDate=new Date()]
 * @returns {object}
 */
function resolveNextExamination(routineRows, referenceDate = new Date()) {
  const refNow = getCurrentNepalDateTime(referenceDate);
  const rows = Array.isArray(routineRows) ? routineRows : [];

  const enriched = [];
  const unresolvableExams = [];

  for (const row of rows) {
    const rawDate = row.exam_date || row.examDate || row.date || '';
    const cal = row.calendar || (Number(String(rawDate).slice(0, 4)) >= 2070 ? 'BS' : 'AD');
    const diff = calculateDateDifference(rawDate, referenceDate, { calendar: cal });
    const subjectName = row.subject_name || row.subject || row.title || 'Unknown Subject';
    const subjectCode = row.subject_code || row.code || null;

    if (!diff.valid) {
      unresolvableExams.push({
        ...row,
        subject: subjectName,
        code: subjectCode,
        examDateRaw: rawDate,
        calendar: cal,
        reason: diff.reason
      });
      continue;
    }

    enriched.push({
      ...row,
      subject: subjectName,
      code: subjectCode,
      examDateRaw: rawDate,
      calendar: cal,
      adDate: diff.targetAdDate,
      bsDate: diff.targetBsDate,
      daysRemaining: diff.daysRemaining,
      daysElapsed: diff.daysElapsed,
      signedDaysRemaining: diff.signedDaysRemaining,
      isToday: diff.isToday,
      isFuture: diff.isFuture,
      isPast: diff.isPast,
      statusLabel: diff.statusLabel
    });
  }

  enriched.sort((a, b) => {
    if (a.adDate !== b.adDate) return a.adDate.localeCompare(b.adDate);
    return String(a.exam_time || a.time || '').localeCompare(String(b.exam_time || b.time || ''));
  });

  const upcomingExams = enriched.filter(r => r.isToday || r.isFuture);
  const pastExams = enriched.filter(r => r.isPast);
  const nextExam = upcomingExams.length > 0 ? upcomingExams[0] : null;
  const nextExamDayMatches = nextExam
    ? upcomingExams.filter(r => r.adDate === nextExam.adDate)
    : [];

  return {
    referenceAdDate: refNow.adDate,
    referenceBsDate: refNow.bsDate,
    nextExam,
    nextExamDayMatches,
    upcomingExams,
    pastExams,
    unresolvableExams,
    totalExams: rows.length
  };
}

/**
 * Extracts explicit calendar dates mentioned in notice/post title + content
 * and resolves them to `{ raw, adDate, bsDate, calendar }`.
 */
function extractMentionedDatesFromText(text, referenceDate = new Date()) {
  const s = String(text || '');
  if (!s.trim()) return [];
  const norm = normalizeNepaliDatesAndDigits(s);
  const results = [];
  const seen = new Set();

  // 1. Numeric YYYY-MM-DD
  const numMatches = norm.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [];
  for (const m of numMatches) {
    const resolved = resolveCalendarDate(m, null, referenceDate);
    if (resolved.valid && !seen.has(resolved.adDate)) {
      seen.add(resolved.adDate);
      results.push(resolved);
    }
  }

  // 2. Named BS/AD month + day (+ optional year)
  const allMonths = [...BS_MONTH_CANONICAL.map(m => m.canonical), ...AD_MONTH_CANONICAL.map(m => m.canonical)].join('|');
  const namedRe = new RegExp(`(?:\\b(20\\d{2})\\s+)?\\b(${allMonths})\\s+(\\d{1,2})(?:\\s*,?\\s*(20\\d{2}))?\\b`, 'gi');
  let match;
  while ((match = namedRe.exec(norm)) !== null) {
    const resolved = resolveSingleDateMention(match[0], referenceDate);
    if (resolved && !resolved.invalid && resolved.adDate && !seen.has(resolved.adDate)) {
      seen.add(resolved.adDate);
      results.push({
        valid: true,
        adDate: resolved.adDate,
        bsDate: resolved.bsDate,
        calendar: resolved.calendar,
        raw: match[0]
      });
    }
  }

  return results;
}

/**
 * Resolves conflicting or outdated notices/announcements using:
 * 1. Confirmation status & supersession (`superseded: true` / cancelled / retracted)
 * 2. Authority tier (`Tier 1 Admin` > `Tier 2 Teacher` > `Tier 3 CR` > `Tier 4 Student`)
 * 3. Publication timestamp (`created_at` / `createdAt` — newer confirmed official notice supersedes older announcement)
 * 4. Effective event date vs current date in Asia/Kathmandu (detects outdated announcements whose effective dates have already passed).
 *
 * @param {Array<object>} records
 * @param {Date|string|number} [referenceDate=new Date()]
 * @returns {object}
 */
function compareAndResolveTemporalRecords(records, referenceDate = new Date()) {
  const refNow = getCurrentNepalDateTime(referenceDate);
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) {
    return {
      referenceAdDate: refNow.adDate,
      referenceBsDate: refNow.bsDate,
      authoritativeRecord: null,
      activeRecords: [],
      outdatedRecords: [],
      supersededRecords: [],
      hasConflict: false,
      hasOutdatedOnly: false,
      conflictSummary: null
    };
  }

  const roleToTier = (role, explicitTier) => {
    if (Number.isInteger(Number(explicitTier)) && Number(explicitTier) >= 1 && Number(explicitTier) <= 4) {
      return Number(explicitTier);
    }
    const r = String(role || '').toLowerCase();
    if (r === 'admin') return 1;
    if (r === 'teacher' || r === 'faculty') return 2;
    if (r === 'cr' || r === 'class_rep') return 3;
    return 4;
  };

  const analyzed = list.map((rec, idx) => {
    const text = `${rec.title || ''} ${rec.content || ''} ${rec.excerpt || ''}`.trim();
    const mentionedDates = extractMentionedDatesFromText(text, referenceDate);
    const tier = roleToTier(rec.authorRole || rec.author_role || rec.role, rec.authorityTier || rec.source_authority_tier);
    const pubRaw = rec.createdAt || rec.created_at || rec.publishedAt || rec.updated_at || null;
    const pubDateResolved = pubRaw ? resolveCalendarDate(pubRaw, 'AD', referenceDate) : null;
    const pubTimestamp = pubRaw ? new Date(pubRaw).getTime() : 0;
    const pubAdDate = pubDateResolved?.valid ? pubDateResolved.adDate : null;

    // Filter out publication date headers (e.g. "Date: 3 November 2026", "मिति: ...") from being treated as future event dates
    const eventDates = mentionedDates.filter(m => {
      if (!pubAdDate || m.adDate !== pubAdDate) return true;
      const escapedRaw = m.raw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const isHeaderDate = new RegExp(`(?:date|dated|मिति|published)\\s*:\\s*[^\n\r]*?${escapedRaw}`, 'i').test(text);
      const isExplicitEventDate = new RegExp(`(?:starting|from|resumes?|reopens?|begins?|held|scheduled|dekhi|bata)\\s+(?:from\\s+)?${escapedRaw}`, 'i').test(text);
      return !isHeaderDate && isExplicitEventDate;
    });

    const sortedMentioned = [...eventDates].sort((a, b) => a.adDate.localeCompare(b.adDate));
    const latestEffectiveDate = sortedMentioned.length > 0 ? sortedMentioned[sortedMentioned.length - 1] : null;
    const isEffectiveDatePast = Boolean(
      latestEffectiveDate &&
      latestEffectiveDate.adDate &&
      latestEffectiveDate.adDate < refNow.adDate
    );

    const isSuperseded = Boolean(rec.superseded);
    const isConfirmedOfficial = tier <= 2;

    return {
      ...rec,
      _idx: idx,
      authorityTier: tier,
      isConfirmedOfficial,
      publishedAt: pubRaw,
      publishedAdDate: pubDateResolved?.valid ? pubDateResolved.adDate : null,
      publishedTimestamp: Number.isNaN(pubTimestamp) ? 0 : pubTimestamp,
      mentionedDates: sortedMentioned,
      effectiveAdDate: latestEffectiveDate?.adDate || null,
      effectiveBsDate: latestEffectiveDate?.bsDate || null,
      isEffectiveDatePast,
      isSuperseded
    };
  });

  const sorted = [...analyzed].sort((a, b) => {
    if (a.isSuperseded !== b.isSuperseded) return a.isSuperseded ? 1 : -1;
    if (a.isEffectiveDatePast !== b.isEffectiveDatePast) return a.isEffectiveDatePast ? 1 : -1;

    // Both Admin (Tier 1) and Teacher/Faculty (Tier 2) are official university notices.
    // Prioritize confirmed upcoming effective dates, and strictly prioritize later publication dates!
    const aOfficial = a.authorityTier <= 2;
    const bOfficial = b.authorityTier <= 2;
    if (aOfficial && bOfficial) {
      const aHasUpcomingDate = Boolean(a.effectiveAdDate && !a.isEffectiveDatePast);
      const bHasUpcomingDate = Boolean(b.effectiveAdDate && !b.isEffectiveDatePast);
      if (aHasUpcomingDate !== bHasUpcomingDate) {
        return aHasUpcomingDate ? -1 : 1;
      }
      if (a.publishedTimestamp !== b.publishedTimestamp) {
        return b.publishedTimestamp - a.publishedTimestamp;
      }
    } else if (a.authorityTier !== b.authorityTier) {
      return a.authorityTier - b.authorityTier;
    }

    if (a.publishedTimestamp !== b.publishedTimestamp) return b.publishedTimestamp - a.publishedTimestamp;
    return a._idx - b._idx;
  });

  const nonSuperseded = sorted.filter(r => !r.isSuperseded);
  const activeRecords = nonSuperseded.filter(r => !r.isEffectiveDatePast);
  const outdatedRecords = analyzed.filter(r => r.isEffectiveDatePast && !r.isSuperseded);
  const supersededRecords = analyzed.filter(r => r.isSuperseded);

  if (activeRecords.length >= 2) {
    const primary = activeRecords[0];
    for (let i = 1; i < activeRecords.length; i++) {
      const candidate = activeRecords[i];
      const hasDifferentEffectiveDate =
        primary.effectiveAdDate &&
        candidate.effectiveAdDate &&
        primary.effectiveAdDate !== candidate.effectiveAdDate;
      const isRevisedPrimary = /\b(revised|updated|rescheduled|postponed|new\s+date|supersede|correction|अर्को\s*सूचना|संसोधित|सारिएको)\b/i.test(
        `${primary.title || ''} ${primary.content || ''}`
      );
      const bothOfficial = primary.authorityTier <= 2 && candidate.authorityTier <= 2;
      const isConcreteOverVague = primary.effectiveAdDate && !candidate.effectiveAdDate;
      if (
        (hasDifferentEffectiveDate || isRevisedPrimary || isConcreteOverVague) &&
        (bothOfficial || primary.authorityTier <= candidate.authorityTier) &&
        primary.publishedTimestamp > candidate.publishedTimestamp
      ) {
        candidate.isSupersededByNewer = true;
        candidate.supersededByTitle = primary.title || `Notice #${primary.id}`;
        if (!supersededRecords.includes(candidate)) {
          supersededRecords.push(candidate);
        }
      }
    }
  }

  const authoritativeRecord = activeRecords[0] || sorted[0] || null;
  const distinctActiveEffectiveDates = [...new Set(activeRecords.map(r => r.effectiveAdDate).filter(Boolean))];
  const hasConflict = distinctActiveEffectiveDates.length > 1 || supersededRecords.length > 0;
  const hasOutdatedOnly = activeRecords.length === 0 && outdatedRecords.length > 0;

  let conflictSummary = null;
  if (hasOutdatedOnly) {
    const latestOutdated = outdatedRecords[0];
    conflictSummary = `Only outdated announcement(s) were found (effective date ${latestOutdated.effectiveAdDate}${latestOutdated.effectiveBsDate ? ` / ${latestOutdated.effectiveBsDate} BS` : ''} has already passed relative to current date ${refNow.adDate}).`;
  } else if (hasConflict && authoritativeRecord) {
    conflictSummary = `Multiple announcements found; resolved in favor of "${authoritativeRecord.title || 'latest official notice'}" (Authority Tier ${authoritativeRecord.authorityTier}, published ${authoritativeRecord.publishedAdDate || authoritativeRecord.publishedAt || 'most recently'}).`;
  }

  return {
    referenceAdDate: refNow.adDate,
    referenceBsDate: refNow.bsDate,
    authoritativeRecord,
    activeRecords,
    outdatedRecords,
    supersededRecords,
    hasConflict,
    hasOutdatedOnly,
    conflictSummary
  };
}

module.exports = {
  getNepalTime,
  formatNepalDate,
  getCurrentNepalDateTime,
  resolveCalendarDate,
  calculateDateDifference,
  calculateAssignmentDeadline,
  resolveNextExamination,
  extractMentionedDatesFromText,
  compareAndResolveTemporalRecords,
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
  NEPAL_TIMEZONE_OFFSET_MINUTES
};
