export interface BsMonthOption {
  value: string;
  name: string;
  nepali: string;
}

export interface RoutineSubjectOption {
  title: string;
  code: string;
  nature?: string;
}

export interface RoutineOptionsCatalog {
  subjectsBySemester: Record<number, RoutineSubjectOption[]>;
  electives: RoutineSubjectOption[];
  teachers: string[];
  rooms: string[];
  examTypes: string[];
  classTypes: string[];
  facultyTypes: Array<{ value: string; label: string }>;
  workingDays: string[];
  weekdays: string[];
  bsMonths: BsMonthOption[];
  bsYears: number[];
  examTimePresets: string[];
  sessionPresets: string[];
}

export const BS_MONTHS: BsMonthOption[] = [
  { value: '01', name: 'Baisakh', nepali: 'बैशाख' },
  { value: '02', name: 'Jestha', nepali: 'जेठ' },
  { value: '03', name: 'Ashadh', nepali: 'असार' },
  { value: '04', name: 'Shrawan', nepali: 'साउन' },
  { value: '05', name: 'Bhadra', nepali: 'भदौ' },
  { value: '06', name: 'Ashwin', nepali: 'असोज' },
  { value: '07', name: 'Kartik', nepali: 'कार्तिक' },
  { value: '08', name: 'Mangsir', nepali: 'मंसिर' },
  { value: '09', name: 'Poush', nepali: 'पुष' },
  { value: '10', name: 'Magh', nepali: 'माघ' },
  { value: '11', name: 'Falgun', nepali: 'फागुन' },
  { value: '12', name: 'Chaitra', nepali: 'चैत्र' },
];

// Official BS month day counts (Baisakh..Chaitra) anchored at 2080/01/01 BS = 2023-04-14 AD (Friday)
export const BS_YEAR_DAYS: Record<number, number[]> = {
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2084: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2085: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
};

const BS_ANCHOR_YEAR = 2080;
const BS_ANCHOR_UTC_MS = Date.UTC(2023, 3, 14); // 2023-04-14 = Friday
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function getBsDaysInMonth(year: number, monthNum: number): number {
  const arr = BS_YEAR_DAYS[year];
  if (arr && monthNum >= 1 && monthNum <= 12) return arr[monthNum - 1];
  return 32;
}

export function getBsWeekday(year: number, monthNum: number, day: number): string {
  if (!BS_YEAR_DAYS[year] || monthNum < 1 || monthNum > 12 || day < 1) return '';
  const maxDay = getBsDaysInMonth(year, monthNum);
  if (day > maxDay) return '';
  let totalDays = 0;
  for (let y = BS_ANCHOR_YEAR; y < year; y++) {
    const daysArr = BS_YEAR_DAYS[y];
    if (!daysArr) return '';
    for (const d of daysArr) totalDays += d;
  }
  const curArr = BS_YEAR_DAYS[year];
  for (let m = 0; m < monthNum - 1; m++) {
    totalDays += curArr[m];
  }
  totalDays += day - 1;
  const adDate = new Date(BS_ANCHOR_UTC_MS + totalDays * 86400000);
  return WEEKDAY_NAMES[adDate.getUTCDay()] || '';
}

export const BS_YEARS = [2081, 2082, 2083, 2084, 2085];

export const NPT_TIME_POINTS = [
  '6:00 AM', '6:30 AM', '7:00 AM', '7:30 AM', '8:00 AM', '8:30 AM',
  '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
  '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM',
];

export const DEFAULT_ROUTINE_OPTIONS: RoutineOptionsCatalog = {
  subjectsBySemester: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [] },
  electives: [],
  teachers: [],
  rooms: [
    'Room 101', 'Room 102', 'Room 201', 'Room 202', 'Room 204', 'Room 301',
    'Computer Lab 1', 'Computer Lab 2', 'Hardware Lab', 'Seminar Hall', 'Exam Hall A', 'Exam Hall B',
  ],
  examTypes: [
    'Final Examination', 'Pre-board Examination', 'Midterm Examination',
    'Practical Examination', 'Makeup Examination',
  ],
  classTypes: ['Theory', 'Practical', 'Lab', 'Break', 'Empty'],
  facultyTypes: [
    { value: 'FT', label: 'Full Time (FT)' },
    { value: 'CC', label: 'Course Contract (CC)' },
    { value: 'MA', label: "Master's Assistantship (MA)" },
  ],
  workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  weekdays: WEEKDAY_NAMES,
  bsMonths: BS_MONTHS,
  bsYears: BS_YEARS,
  examTimePresets: [
    '7:00 AM – 10:00 AM',
    '8:00 AM – 11:00 AM',
    '11:00 AM – 2:00 PM',
    '11:30 AM – 2:30 PM',
    '12:00 PM – 3:00 PM',
    '1:00 PM – 4:00 PM',
    '2:00 PM – 5:00 PM',
  ],
  sessionPresets: [
    '2082 BS (Ashwin–Chaitra)',
    '2083 BS (Baisakh–Bhadra)',
    '2083 BS (Ashwin–Chaitra)',
    '2084 BS (Baisakh–Bhadra)',
    '2084 BS (Ashwin–Chaitra)',
  ],
};

export function format12HourNpt(hhmm?: string | null): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return hhmm || '';
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

export function formatSlotNptLabel(slot?: { start_time?: string; end_time?: string; label?: string } | null): string {
  if (!slot) return '';
  if (slot.start_time && slot.end_time) {
    return `${format12HourNpt(slot.start_time)} – ${format12HourNpt(slot.end_time)}`;
  }
  return slot.label || '';
}

export function formatBsDateFriendly(dateStr?: string | null, calendar?: string | null): string {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(dateStr || '').trim());
  if (!m) return [dateStr, calendar].filter(Boolean).join(' ');
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = Number(m[3]);
  if (calendar === 'BS') {
    const found = BS_MONTHS.find((item) => item.value === mo);
    return found ? `${found.name} ${d}, ${y} BS` : `${y}/${mo}/${String(d).padStart(2, '0')} BS`;
  }
  return `${y}/${mo}/${String(d).padStart(2, '0')}${calendar ? ` ${calendar}` : ''}`;
}
