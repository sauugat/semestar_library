/**
 * Bikram Sambat (BS) <-> Gregorian (AD) Calendar Conversion Utilities for Mobile.
 * Synchronized with server-side `lib/temporal-intelligence.js` (2070–2090 BS, 0-day drift).
 */

const BS_MONTH_DAYS: Record<number, number[]> = {
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
  2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
};

// Base Anchor: 2070 Baishakh 1 BS = 2013-04-14 AD (UTC)
const ANCHOR_BS_YEAR = 2070;
const ANCHOR_AD_MS = Date.UTC(2013, 3, 14);
const MS_PER_DAY = 86400000;

export const BS_MONTH_NAMES_EN = [
  'Baishakh',
  'Jestha',
  'Ashadh',
  'Shrawan',
  'Bhadra',
  'Ashwin',
  'Kartik',
  'Mangsir',
  'Poush',
  'Magh',
  'Falgun',
  'Chaitra',
] as const;

export interface BsDateParts {
  year: number;
  month: number;
  day: number;
  monthNameEn: string;
  dateStr: string;
  formattedEn: string;
}

/**
 * Converts a Gregorian AD date string ('YYYY-MM-DD') to Bikram Sambat (BS).
 * Returns null if invalid or outside the supported 2070–2090 BS table.
 */
export function adToBs(adDateStr: string | null | undefined): BsDateParts | null {
  if (!adDateStr || typeof adDateStr !== 'string') return null;
  const trimmed = adDateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const [y, m, d] = trimmed.split('-').map(Number);
  const targetUtcMs = Date.UTC(y, m - 1, d);
  const check = new Date(targetUtcMs);
  if (
    Number.isNaN(targetUtcMs) ||
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() + 1 !== m ||
    check.getUTCDate() !== d
  ) {
    return null;
  }

  let diffDays = Math.round((targetUtcMs - ANCHOR_AD_MS) / MS_PER_DAY);
  if (diffDays < 0) return null;

  let bsYear = ANCHOR_BS_YEAR;
  while (true) {
    const months = BS_MONTH_DAYS[bsYear];
    if (!months) return null;
    const yearDays = months.reduce((acc, days) => acc + days, 0);
    if (diffDays >= yearDays) {
      diffDays -= yearDays;
      bsYear += 1;
    } else {
      break;
    }
  }

  let bsMonth = 1;
  const months = BS_MONTH_DAYS[bsYear];
  for (let mi = 0; mi < 12; mi += 1) {
    const monthDays = months[mi];
    if (diffDays >= monthDays) {
      diffDays -= monthDays;
      bsMonth += 1;
    } else {
      break;
    }
  }
  const bsDay = diffDays + 1;
  const monthNameEn = BS_MONTH_NAMES_EN[bsMonth - 1];
  const dateStr = `${bsYear}-${String(bsMonth).padStart(2, '0')}-${String(bsDay).padStart(2, '0')}`;
  const formattedEn = `${bsDay} ${monthNameEn} ${bsYear}`;

  return {
    year: bsYear,
    month: bsMonth,
    day: bsDay,
    monthNameEn,
    dateStr,
    formattedEn,
  };
}

/**
 * Converts a Bikram Sambat date string ('YYYY-MM-DD' or 'YYYY/MM/DD') to Gregorian AD ('YYYY-MM-DD').
 * Returns null if the BS date is invalid or outside 2070–2090 BS.
 */
export function bsToAd(bsDateStr: string | null | undefined): string | null {
  if (!bsDateStr || typeof bsDateStr !== 'string') return null;
  const trimmed = bsDateStr.trim();
  const match = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;

  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);

  const yearMonths = BS_MONTH_DAYS[y];
  if (!yearMonths) return null;
  if (m < 1 || m > 12) return null;
  const maxDays = yearMonths[m - 1];
  if (d < 1 || d > maxDays) return null;

  let days = 0;
  for (let curY = ANCHOR_BS_YEAR; curY < y; curY += 1) {
    const curMonths = BS_MONTH_DAYS[curY];
    for (let mi = 0; mi < 12; mi += 1) {
      days += curMonths[mi];
    }
  }
  for (let mi = 0; mi < m - 1; mi += 1) {
    days += yearMonths[mi];
  }
  days += d - 1;

  const target = new Date(ANCHOR_AD_MS + days * MS_PER_DAY);
  return target.toISOString().slice(0, 10);
}

/**
 * Formats an AD 'YYYY-MM-DD' date string into numeric BS with suffix (e.g. '2083-08-05 BS').
 */
export function formatBsDate(adDateStr: string | null | undefined): string {
  if (!adDateStr) return '';
  const bs = adToBs(adDateStr);
  return bs ? `${bs.dateStr} BS` : adDateStr;
}

/**
 * Formats an AD 'YYYY-MM-DD' date string into readable BS (e.g. '5 Mangsir 2083 BS').
 */
export function formatBsReadable(adDateStr: string | null | undefined): string {
  if (!adDateStr) return '';
  const bs = adToBs(adDateStr);
  return bs ? `${bs.formattedEn} BS` : adDateStr;
}
