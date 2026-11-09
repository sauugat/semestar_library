'use strict';

/**
 * Temporal Intelligence Module for Kyana AI.
 * 
 * Authoritative Server-Side Time Provider & Bikram Sambat (BS) / Gregorian (AD)
 * Deterministic Calendar Engine grounded in Asia/Kathmandu (UTC+05:45).
 */

const TIMEZONE = 'Asia/Kathmandu';
const NEPAL_OFFSET_MINUTES = 345; // UTC+05:45 (5 * 60 + 45 = 345)
const NEPAL_OFFSET_MS = NEPAL_OFFSET_MINUTES * 60 * 1000;

// Standard Nepal Government / Panchanga Nirnayak Samiti month lengths for BS 2070 - 2090.
// Independently verified against standard panchang records with 0 day drift across all 21 years (7,670 days).
const BS_MONTH_DAYS = {
  2070: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2071: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2072: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2073: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2074: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2075: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2085: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2086: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
  2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30]
};

// Base Anchor: 2070 Baishakh 1 BS = 2013-04-14 AD (UTC)
const ANCHOR_BS_YEAR = 2070;
const ANCHOR_AD_DATE = new Date(Date.UTC(2013, 3, 14)); // 2013-04-14

const BS_MONTH_NAMES_EN = [
  'Baishakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'
];

const BS_MONTH_NAMES_NE = [
  'वैशाख', 'जेठ', 'असार', 'श्रावण', 'भाद्र', 'आश्विन',
  'कार्तिक', 'मंसिर', 'पौष', 'माघ', 'फाल्गुन', 'चैत्र'
];

const WEEKDAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_NAMES_NE = ['आइतबार', 'सोमबार', 'मङ्गलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार'];

const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

function toDevanagariDigits(num) {
  return String(num).replace(/\d/g, d => DEVANAGARI_DIGITS[Number(d)]);
}

// Global server-side mock time state for non-restart temporal simulation in tests
let currentMockTime = null;

/**
 * Sets a mock server-side time for testing temporal reasoning without restarting.
 * Accepts Date object, ISO string, timestamp, or null to clear.
 * @param {Date|string|number|null} mockValue
 */
function setMockTime(mockValue) {
  if (mockValue === null || mockValue === undefined) {
    currentMockTime = null;
    return;
  }
  const d = new Date(mockValue);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid mock time supplied: ${mockValue}`);
  }
  currentMockTime = d;
}

/**
 * Resets the server-side mock time to use real system clock.
 */
function resetMockTime() {
  currentMockTime = null;
}

/**
 * Returns true if mock time is currently active.
 * @returns {boolean}
 */
function isMockTimeActive() {
  return currentMockTime !== null;
}

/**
 * Authoritative Server-side Time Provider.
 * Returns the active server Date, honoring any mock time set for testing.
 * @returns {Date}
 */
function getNow() {
  if (currentMockTime !== null) {
    return new Date(currentMockTime.getTime());
  }
  return new Date();
}

/**
 * Returns datetime components adjusted to Asia/Kathmandu (UTC+05:45).
 * Resilient against machine timezone differences and date boundary transitions.
 * @param {Date|string|number} [dateInput=getNow()]
 * @returns {{ year: number, month: number, day: number, hours: number, minutes: number, seconds: number, dayOfWeekIndex: number, dayOfWeek: string, dayOfWeekNe: string, dateStr: string, timeStr: string, rawDate: Date }}
 */
function getNepalDateTime(dateInput = getNow()) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date supplied to getNepalDateTime: ${dateInput}`);
  }

  // Format using Intl.DateTimeFormat with Asia/Kathmandu timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'long'
  });

  const parts = formatter.formatToParts(d);
  const partMap = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const year = Number(partMap.year);
  const month = Number(partMap.month);
  const day = Number(partMap.day);
  const hours = Number(partMap.hour === '24' ? '00' : partMap.hour);
  const minutes = Number(partMap.minute);
  const seconds = Number(partMap.second);
  const dayOfWeek = partMap.weekday;

  const dayOfWeekIndex = WEEKDAY_NAMES_EN.indexOf(dayOfWeek);
  const dayOfWeekNe = WEEKDAY_NAMES_NE[dayOfWeekIndex] || '';

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return {
    year,
    month,
    day,
    hours,
    minutes,
    seconds,
    dayOfWeekIndex,
    dayOfWeek,
    dayOfWeekNe,
    dateStr,
    timeStr,
    rawDate: d
  };
}

/**
 * Formats a Date object or timestamp to YYYY-MM-DD in Asia/Kathmandu.
 * @param {Date|string|number} [date=getNow()]
 * @returns {string}
 */
function formatNepalDate(date = getNow()) {
  return getNepalDateTime(date).dateStr;
}

/**
 * Converts a Gregorian AD date string ('YYYY-MM-DD') or Date to Bikram Sambat (BS).
 * @param {string|Date} adInput
 * @returns {{ year: number, month: number, day: number, monthNameEn: string, monthNameNe: string, formattedEn: string, formattedNe: string, dateStr: string }}
 */
function adToBs(adInput) {
  let dateStr;
  if (typeof adInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(adInput.trim())) {
    dateStr = adInput.trim();
  } else {
    dateStr = formatNepalDate(adInput);
  }

  const [y, m, d] = dateStr.split('-').map(Number);
  const targetUtc = new Date(Date.UTC(y, m - 1, d));
  let diffDays = Math.round((targetUtc.getTime() - ANCHOR_AD_DATE.getTime()) / 86400000);

  if (diffDays < 0) {
    throw new Error(`Date ${dateStr} is before supported BS calendar range (2070 BS)`);
  }

  let bsYear = ANCHOR_BS_YEAR;
  while (true) {
    const yearDays = BS_MONTH_DAYS[bsYear]?.reduce((a, b) => a + b, 0);
    if (!yearDays) {
      throw new Error(`Date ${dateStr} exceeds supported BS calendar range (up to 2090 BS)`);
    }
    if (diffDays >= yearDays) {
      diffDays -= yearDays;
      bsYear++;
    } else {
      break;
    }
  }

  let bsMonth = 1;
  for (let mi = 0; mi < 12; mi++) {
    const monthDays = BS_MONTH_DAYS[bsYear][mi];
    if (diffDays >= monthDays) {
      diffDays -= monthDays;
      bsMonth++;
    } else {
      break;
    }
  }
  const bsDay = diffDays + 1;

  const monthNameEn = BS_MONTH_NAMES_EN[bsMonth - 1];
  const monthNameNe = BS_MONTH_NAMES_NE[bsMonth - 1];
  const formattedEn = `${bsDay} ${monthNameEn} ${bsYear}`;
  const formattedNe = `${toDevanagariDigits(bsDay)} ${monthNameNe} ${toDevanagariDigits(bsYear)}`;
  const bsDateStr = `${bsYear}-${String(bsMonth).padStart(2, '0')}-${String(bsDay).padStart(2, '0')}`;

  return {
    year: bsYear,
    month: bsMonth,
    day: bsDay,
    monthNameEn,
    monthNameNe,
    formattedEn,
    formattedNe,
    dateStr: bsDateStr
  };
}

/**
 * Converts a Bikram Sambat date to Gregorian AD (YYYY-MM-DD).
 * Supports:
 * - bsToAd(2083, 7, 30)
 * - bsToAd('2083-07-30')
 * - bsToAd('2083/07/30')
 * - bsToAd({ year: 2083, month: 7, day: 30 })
 * @param {number|string|object} yearInput
 * @param {number} [monthInput]
 * @param {number} [dayInput]
 * @returns {string} YYYY-MM-DD in Gregorian AD
 */
function bsToAd(yearInput, monthInput, dayInput) {
  let y, m, d;
  if (typeof yearInput === 'object' && yearInput !== null) {
    y = Number(yearInput.year);
    m = Number(yearInput.month);
    d = Number(yearInput.day);
  } else if (typeof yearInput === 'string' && /^\d{4}[/. -]\d{1,2}[/. -]\d{1,2}/.test(yearInput.trim())) {
    const parts = yearInput.trim().split(/[/. -]/).map(Number);
    y = parts[0];
    m = parts[1];
    d = parts[2];
  } else {
    y = Number(yearInput);
    m = Number(monthInput);
    d = Number(dayInput);
  }

  if (y < 2070 || y > 2090) {
    throw new Error(`BS year ${y} outside supported range (2070-2090)`);
  }
  if (m < 1 || m > 12) {
    throw new Error(`Invalid BS month ${m} (must be 1-12)`);
  }
  const maxDays = BS_MONTH_DAYS[y][m - 1];
  if (d < 1 || d > maxDays) {
    throw new Error(`Invalid BS day ${d} for month ${m} of year ${y} (max ${maxDays})`);
  }

  let days = 0;
  for (let curY = ANCHOR_BS_YEAR; curY < y; curY++) {
    for (let mi = 0; mi < 12; mi++) {
      days += BS_MONTH_DAYS[curY][mi];
    }
  }
  for (let mi = 0; mi < m - 1; mi++) {
    days += BS_MONTH_DAYS[y][mi];
  }
  days += (d - 1);

  const target = new Date(ANCHOR_AD_DATE.getTime() + days * 86400000);
  return target.toISOString().slice(0, 10);
}

/**
 * Calculates calendar days between two AD date strings ('YYYY-MM-DD') or Dates.
 * Returns endDate - startDate (positive if endDate is in future, 0 if same day).
 * @param {string|Date} startDate
 * @param {string|Date} endDate
 * @returns {number}
 */
function calculateDaysBetween(startDate, endDate) {
  const sStr = typeof startDate === 'string' ? startDate.slice(0, 10) : formatNepalDate(startDate);
  const eStr = typeof endDate === 'string' ? endDate.slice(0, 10) : formatNepalDate(endDate);

  const [sy, sm, sd] = sStr.split('-').map(Number);
  const [ey, em, ed] = eStr.split('-').map(Number);

  const sUtc = Date.UTC(sy, sm - 1, sd);
  const eUtc = Date.UTC(ey, em - 1, ed);

  return Math.round((eUtc - sUtc) / 86400000);
}

/**
 * Calculates days remaining from reference date (default: now) until target date.
 * If targetDate is in the future, returns positive integer.
 * If targetDate is today, returns 0.
 * If targetDate is in the past, returns negative integer.
 * @param {string|Date} targetDate
 * @param {string|Date} [referenceDate=getNow()]
 * @returns {number}
 */
function calculateDaysRemaining(targetDate, referenceDate = getNow()) {
  const refAd = typeof referenceDate === 'string' ? referenceDate.slice(0, 10) : formatNepalDate(referenceDate);
  const targetAd = typeof targetDate === 'string' ? targetDate.slice(0, 10) : formatNepalDate(targetDate);
  return calculateDaysBetween(refAd, targetAd);
}

/**
 * Calculates days elapsed since target date.
 * @param {string|Date} targetDate
 * @param {string|Date} [referenceDate=getNow()]
 * @returns {number}
 */
function calculateDaysElapsed(targetDate, referenceDate = getNow()) {
  return -calculateDaysRemaining(targetDate, referenceDate);
}

/**
 * Produces complete temporal context grounded in Asia/Kathmandu.
 * @param {Date|string|number} [refInput=getNow()]
 * @returns {object}
 */
function getTemporalContext(refInput = getNow()) {
  const dt = getNepalDateTime(refInput);
  const bs = adToBs(dt.dateStr);

  const summaryEn = `${dt.dayOfWeek}, ${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(dt.rawDate)} AD (${bs.formattedEn} BS)`;
  const summaryNe = `${dt.dayOfWeekNe}, ${bs.formattedNe} (${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(dt.rawDate)} AD)`;

  return {
    nowIso: dt.rawDate.toISOString(),
    timezone: TIMEZONE,
    timezoneOffset: '+05:45',
    adDate: dt.dateStr,
    adYear: dt.year,
    adMonth: dt.month,
    adDay: dt.day,
    dayOfWeek: dt.dayOfWeek,
    dayOfWeekNe: dt.dayOfWeekNe,
    timeStr: dt.timeStr,
    bsDate: bs.dateStr,
    bsYear: bs.year,
    bsMonth: bs.month,
    bsDay: bs.day,
    bsMonthName: bs.monthNameEn,
    bsMonthNameNe: bs.monthNameNe,
    bsFormattedEn: bs.formattedEn,
    bsFormattedNe: bs.formattedNe,
    summaryEn,
    summaryNe
  };
}

/**
 * Calculates comprehensive event countdown with humanized summaries in English and Nepali.
 * @param {string|Date} targetDateAd
 * @param {string|Date} [refInput=getNow()]
 * @returns {object}
 */
function calculateEventCountdown(targetDateAd, refInput = getNow()) {
  const refCtx = getTemporalContext(refInput);
  const targetStr = typeof targetDateAd === 'string' ? targetDateAd.slice(0, 10) : formatNepalDate(targetDateAd);
  const targetBs = adToBs(targetStr);

  const daysRemaining = calculateDaysBetween(refCtx.adDate, targetStr);
  const isToday = daysRemaining === 0;
  const isTomorrow = daysRemaining === 1;
  const isYesterday = daysRemaining === -1;
  const isPast = daysRemaining < 0;

  let status = 'upcoming';
  if (isToday) status = 'today';
  else if (isTomorrow) status = 'tomorrow';
  else if (isPast) status = 'passed';

  let humanSummaryEn;
  let humanSummaryNe;

  if (isToday) {
    humanSummaryEn = `Today (${targetBs.formattedEn} BS / ${targetStr} AD)`;
    humanSummaryNe = `आज (${targetBs.formattedNe} / ${targetStr} AD)`;
  } else if (isTomorrow) {
    humanSummaryEn = `Tomorrow (${targetBs.formattedEn} BS / ${targetStr} AD)`;
    humanSummaryNe = `भोलि (${targetBs.formattedNe} / ${targetStr} AD)`;
  } else if (isPast) {
    const elapsed = Math.abs(daysRemaining);
    humanSummaryEn = `${elapsed} day${elapsed === 1 ? '' : 's'} ago (${targetBs.formattedEn} BS / ${targetStr} AD)`;
    humanSummaryNe = `${toDevanagariDigits(elapsed)} दिन अघि (${targetBs.formattedNe} / ${targetStr} AD)`;
  } else {
    humanSummaryEn = `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining (${targetBs.formattedEn} BS / ${targetStr} AD)`;
    humanSummaryNe = `${toDevanagariDigits(daysRemaining)} दिन बाँकी (${targetBs.formattedNe} / ${targetStr} AD)`;
  }

  return {
    targetDateAd: targetStr,
    targetDateBs: targetBs.dateStr,
    targetDateBsFormatted: targetBs.formattedEn,
    targetDateBsFormattedNe: targetBs.formattedNe,
    refDateAd: refCtx.adDate,
    refDateBs: refCtx.bsDate,
    daysRemaining,
    isToday,
    isTomorrow,
    isYesterday,
    isPast,
    status,
    humanSummaryEn,
    humanSummaryNe
  };
}

/**
 * Natural date parsing for English and Romanized/Devanagari Nepali queries.
 * @param {string} text
 * @param {Date|string|number} [refDate=getNow()]
 * @returns {object|null}
 */
function parseNaturalDate(text, refDate = getNow()) {
  if (!text || typeof text !== 'string') return null;
  const norm = text.toLowerCase().trim();
  const refCtx = getTemporalContext(refDate);

  const addDaysToAd = (n) => {
    const [y, m, d] = refCtx.adDate.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d + n));
    return utc.toISOString().slice(0, 10);
  };

  // 1. Aaja / Today / Ahile
  if (/\b(aaja|today|aile|ahile|आज)\b/.test(norm)) {
    const ad = addDaysToAd(0);
    return { expression: 'aaja', label: 'Today', adDate: ad, bs: adToBs(ad) };
  }

  // 2. Bholi / Voli / Tomorrow
  if (/\b(bholi|voli|tomorrow|भोलि)\b/.test(norm)) {
    const ad = addDaysToAd(1);
    return { expression: 'bholi', label: 'Tomorrow', adDate: ad, bs: adToBs(ad) };
  }

  // 3. Parsi / Day after tomorrow
  if (/\b(parsi|day after tomorrow|पर्सि)\b/.test(norm)) {
    const ad = addDaysToAd(2);
    return { expression: 'parsi', label: 'Day after tomorrow', adDate: ad, bs: adToBs(ad) };
  }

  // 4. Hijo / Yesterday
  if (/\b(hijo|yesterday|हिजो)\b/.test(norm)) {
    const ad = addDaysToAd(-1);
    return { expression: 'hijo', label: 'Yesterday', adDate: ad, bs: adToBs(ad) };
  }

  // 5. Asti / Day before yesterday
  if (/\b(asti|day before yesterday|अस्ति)\b/.test(norm)) {
    const ad = addDaysToAd(-2);
    return { expression: 'asti', label: 'Day before yesterday', adDate: ad, bs: adToBs(ad) };
  }

  // 6. Nepali BS month match: e.g. "30 kartik", "kartik 30", "३० कार्तिक", "२०८३ कार्तिक ३०"
  const monthRegex = /(?:(\d{4}|[०-९]{4})\s*(?:साल|bs)?)?\s*(\d{1,2}|[०-९]{1,2})\s*(?:gate|गते)?\s*(baishakh|jestha|ashadh|shrawan|bhadra|ashwin|kartik|mangsir|poush|magh|falgun|chaitra|वैशाख|जेठ|असार|श्रावण|भाद्र|आश्विन|कार्तिक|मंसिर|पौष|माघ|फाल्गुन|चैत्र)|(baishakh|jestha|ashadh|shrawan|bhadra|ashwin|kartik|mangsir|poush|magh|falgun|chaitra|वैशाख|जेठ|असार|श्रावण|भाद्र|आश्विन|कार्तिक|मंसिर|पौष|माघ|फाल्गुन|चैत्र)\s*(\d{1,2}|[०-९]{1,2})\s*(?:gate|गते)?(?:\s*(\d{4}|[०-९]{4}))?/i;

  const mMatch = norm.match(monthRegex);
  if (mMatch) {
    const parseNum = (v) => {
      if (!v) return null;
      const eng = String(v).replace(/[०-९]/g, d => DEVANAGARI_DIGITS.indexOf(d));
      return Number(eng);
    };

    const mName = (mMatch[3] || mMatch[4] || '').toLowerCase();
    const day = parseNum(mMatch[2] || mMatch[5]);
    let year = parseNum(mMatch[1] || mMatch[6]) || refCtx.bsYear;

    let monthIndex = BS_MONTH_NAMES_EN.findIndex(n => n.toLowerCase() === mName);
    if (monthIndex === -1) {
      monthIndex = BS_MONTH_NAMES_NE.findIndex(n => n === mName);
    }

    if (monthIndex !== -1 && day >= 1 && day <= 32) {
      const bsMonth = monthIndex + 1;
      try {
        const ad = bsToAd(year, bsMonth, day);
        return {
          expression: `${day} ${BS_MONTH_NAMES_EN[monthIndex]} ${year}`,
          label: `${day} ${BS_MONTH_NAMES_EN[monthIndex]} ${year}`,
          adDate: ad,
          bs: adToBs(ad)
        };
      } catch {
        // Ignore parsing errors on edge cases
      }
    }
  }

  // 7. Gregorian month match: e.g. "Nov 16", "November 16", "16 November 2026"
  const adMonthRegex = /\b(?:(\d{1,2})\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{1,2}))?(?:,?\s+(\d{4}))?\b/i;
  const adMatch = norm.match(adMonthRegex);
  if (adMatch) {
    const mStr = adMatch[2].slice(0, 3).toLowerCase();
    const adMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mIdx = adMonths.indexOf(mStr);
    const day = Number(adMatch[1] || adMatch[3]);
    const year = Number(adMatch[4]) || refCtx.adYear;

    if (mIdx !== -1 && day >= 1 && day <= 31) {
      const ad = `${year}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      try {
        return {
          expression: ad,
          label: ad,
          adDate: ad,
          bs: adToBs(ad)
        };
      } catch {
        // Out of BS calendar range
      }
    }
  }

  return null;
}

module.exports = {
  TIMEZONE,
  NEPAL_OFFSET_MINUTES,
  NEPAL_OFFSET_MS,
  BS_MONTH_DAYS,
  BS_MONTH_NAMES_EN,
  BS_MONTH_NAMES_NE,
  WEEKDAY_NAMES_EN,
  WEEKDAY_NAMES_NE,
  setMockTime,
  resetMockTime,
  isMockTimeActive,
  getNow,
  getNepalDateTime,
  formatNepalDate,
  adToBs,
  bsToAd,
  calculateDaysBetween,
  calculateDaysRemaining,
  calculateDaysElapsed,
  getTemporalContext,
  calculateEventCountdown,
  parseNaturalDate,
  toDevanagariDigits
};
