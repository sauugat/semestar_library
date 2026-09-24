const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

function semesterNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().replace(/^(?:semester|sem)\s*/i, '').toUpperCase();
  const number = /^[1-8]$/.test(text) ? Number(text) : ROMANS.indexOf(text) + 1;
  return number >= 1 && number <= 8 ? number : null;
}

function routineSchema(isPostgres) {
  return `CREATE TABLE IF NOT EXISTS routine (
    id ${isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
    semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
    subject_name TEXT NOT NULL,
    subject_code TEXT,
    exam_date TEXT NOT NULL,
    calendar TEXT CHECK (calendar IN ('BS', 'AD')),
    exam_time TEXT,
    room TEXT,
    weekday TEXT,
    exam_type TEXT,
    created_at ${isPostgres ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at ${isPostgres ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS routine_semester_date_idx ON routine (semester, exam_date);`;
}

async function ensureRoutineSchema(db) {
  await db.exec(routineSchema(db.isPostgres));
}

function normalizeDate(value, calendar) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > (calendar === 'AD' ? 31 : 32)) return null;
  if (calendar === 'AD') {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day > days[month - 1]) return null;
  }
  // BS is stored exactly as a BS date; no Gregorian conversion or inferred weekday.
  return `${y}/${m.padStart(2, '0')}/${d.padStart(2, '0')}`;
}

function validateRoutine(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Please provide the exam details.' };
  const value = {};
  value.semester = semesterNumber(body.semester);
  if (!value.semester) return { error: 'Semester must be between 1 and 8.' };
  for (const [field, limit] of Object.entries({subject_name: 250, subject_code: 50, exam_time: 100, room: 100, weekday: 30, exam_type: 100})) {
    const raw = body[field];
    if (raw != null && typeof raw !== 'string') return { error: `${field.replaceAll('_', ' ')} must be text.` };
    value[field] = raw?.trim() || null;
    if (value[field]?.length > limit) return { error: `${field.replaceAll('_', ' ')} must be ${limit} characters or fewer.` };
  }
  if (!value.subject_name) return { error: 'Subject name is required.' };
  value.calendar = body.calendar || null;
  if (value.calendar !== null && !['BS', 'AD'].includes(value.calendar)) return { error: 'Choose BS or AD for the calendar.' };
  value.exam_date = normalizeDate(body.exam_date, value.calendar);
  if (!value.exam_date) return { error: 'Enter a valid exam date as YYYY/MM/DD in the selected calendar.' };
  return { value };
}

const FIELDS = ['semester', 'subject_name', 'subject_code', 'exam_date', 'calendar', 'exam_time', 'room', 'weekday', 'exam_type'];
const ORDER_BY = 'semester ASC, calendar ASC, exam_date ASC, id ASC';

module.exports = { ROMANS, FIELDS, ORDER_BY, routineSchema, ensureRoutineSchema, semesterNumber, normalizeDate, validateRoutine };
