const path = require('path');
const fs = require('fs');

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const WORKING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const CLASS_TYPES = ['Theory', 'Practical', 'Lab', 'Break', 'Empty'];
const FACULTY_TYPES = ['FT', 'CC', 'MA'];
const ROUTINE_STATUSES = ['draft', 'published', 'archived'];

const DEFAULT_TIME_SLOTS = [
  { slot_order: 1, start_time: '11:00', end_time: '11:50', duration_minutes: 50, label: '11:00–11:50', is_break: false },
  { slot_order: 2, start_time: '11:50', end_time: '12:40', duration_minutes: 50, label: '11:50–12:40', is_break: false },
  { slot_order: 3, start_time: '12:40', end_time: '13:30', duration_minutes: 50, label: '12:40–1:30', is_break: false },
  { slot_order: 4, start_time: '13:30', end_time: '14:00', duration_minutes: 30, label: '1:30–2:00', is_break: true },
  { slot_order: 5, start_time: '14:00', end_time: '14:50', duration_minutes: 50, label: '2:00–2:50', is_break: false },
  { slot_order: 6, start_time: '14:50', end_time: '16:00', duration_minutes: 70, label: '2:50–4:00', is_break: false },
];

function semesterNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().replace(/^(?:semester|sem)\s*/i, '').toUpperCase();
  const number = /^[1-8]$/.test(text) ? Number(text) : ROMANS.indexOf(text) + 1;
  return number >= 1 && number <= 8 ? number : null;
}

function yearForSemester(sem) {
  const n = semesterNumber(sem);
  return n ? Math.ceil(n / 2) : null;
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

function classRoutineSchema(isPostgres) {
  const idType = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const tsType = isPostgres ? 'TIMESTAMPTZ' : 'TEXT';
  const boolType = isPostgres ? 'BOOLEAN NOT NULL DEFAULT FALSE' : 'INTEGER NOT NULL DEFAULT 0';
  return `
  CREATE TABLE IF NOT EXISTS class_routines (
    id ${idType},
    university TEXT NOT NULL DEFAULT 'Gandaki University',
    program TEXT NOT NULL DEFAULT 'Bachelor of Information Technology',
    academic_session TEXT NOT NULL,
    year INTEGER NOT NULL CHECK (year BETWEEN 1 AND 4),
    semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
    effective_date TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by TEXT,
    published_at ${tsType},
    archived_at ${tsType},
    created_at ${tsType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at ${tsType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (academic_session, year, semester)
  );
  CREATE INDEX IF NOT EXISTS idx_class_routines_sem_status ON class_routines (semester, status);

  CREATE TABLE IF NOT EXISTS class_routine_slots (
    id ${idType},
    routine_id INTEGER NOT NULL REFERENCES class_routines(id) ON DELETE CASCADE,
    slot_order INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    label TEXT NOT NULL,
    is_break ${boolType},
    UNIQUE (routine_id, slot_order)
  );
  CREATE INDEX IF NOT EXISTS idx_class_routine_slots_routine ON class_routine_slots (routine_id, slot_order);

  CREATE TABLE IF NOT EXISTS class_routine_entries (
    id ${idType},
    routine_id INTEGER NOT NULL REFERENCES class_routines(id) ON DELETE CASCADE,
    slot_id INTEGER NOT NULL REFERENCES class_routine_slots(id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')),
    subject_name TEXT,
    faculty_name TEXT,
    faculty_type TEXT CHECK (faculty_type IN ('FT', 'CC', 'MA') OR faculty_type IS NULL),
    class_type TEXT CHECK (class_type IN ('Theory', 'Practical', 'Lab', 'Break', 'Empty') OR class_type IS NULL),
    is_empty ${boolType},
    notes TEXT,
    created_at ${tsType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at ${tsType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (routine_id, day_of_week, slot_id)
  );
  CREATE INDEX IF NOT EXISTS idx_class_routine_entries_routine_day ON class_routine_entries (routine_id, day_of_week);
  `;
}

async function ensureRoutineSchema(db) {
  await db.exec(routineSchema(db.isPostgres));
  await db.exec(classRoutineSchema(db.isPostgres));
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

function validateClassRoutine(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Please provide valid class routine details.' };
  }
  const semester = semesterNumber(body.semester);
  if (!semester) return { error: 'Semester must be between 1 and 8.' };

  const year = body.year != null ? Number(body.year) : yearForSemester(semester);
  if (!Number.isInteger(year) || year < 1 || year > 4) {
    return { error: 'Year must be between 1 and 4.' };
  }

  const academic_session = typeof body.academic_session === 'string' ? body.academic_session.trim() : '';
  if (!academic_session || academic_session.length > 120) {
    return { error: 'Academic session is required (max 120 characters).' };
  }

  const university = typeof body.university === 'string' && body.university.trim()
    ? body.university.trim().slice(0, 150)
    : 'Gandaki University';
  const program = typeof body.program === 'string' && body.program.trim()
    ? body.program.trim().slice(0, 150)
    : 'Bachelor of Information Technology';
  const effective_date = typeof body.effective_date === 'string' && body.effective_date.trim()
    ? body.effective_date.trim().slice(0, 40)
    : null;
  const status = body.status && ROUTINE_STATUSES.includes(body.status) ? body.status : 'draft';

  return {
    value: {
      university,
      program,
      academic_session,
      year,
      semester,
      effective_date,
      status
    }
  };
}

function validateSlot(slot, idx = 0) {
  if (!slot || typeof slot !== 'object') return { error: 'Invalid time slot object.' };
  const slot_order = Number(slot.slot_order ?? idx + 1);
  if (!Number.isInteger(slot_order) || slot_order < 1 || slot_order > 20) {
    return { error: 'Slot order must be between 1 and 20.' };
  }
  const timeRe = /^\d{1,2}:\d{2}$/;
  const start_time = typeof slot.start_time === 'string' ? slot.start_time.trim() : '';
  const end_time = typeof slot.end_time === 'string' ? slot.end_time.trim() : '';
  if (!timeRe.test(start_time) || !timeRe.test(end_time)) {
    return { error: 'Start and end time must be in HH:MM format.' };
  }
  const duration_minutes = Number(slot.duration_minutes);
  if (!Number.isInteger(duration_minutes) || duration_minutes < 5 || duration_minutes > 300) {
    return { error: 'Duration must be between 5 and 300 minutes.' };
  }
  const label = typeof slot.label === 'string' && slot.label.trim()
    ? slot.label.trim().slice(0, 60)
    : `${start_time}–${end_time}`;
  const is_break = Boolean(slot.is_break);
  return {
    value: { slot_order, start_time, end_time, duration_minutes, label, is_break }
  };
}

function validateRoutineEntry(entry) {
  if (!entry || typeof entry !== 'object') return { error: 'Invalid timetable entry.' };
  const day_of_week = typeof entry.day_of_week === 'string' ? entry.day_of_week.trim() : '';
  if (!WORKING_DAYS.includes(day_of_week)) {
    return { error: `Day must be one of: ${WORKING_DAYS.join(', ')}.` };
  }
  const slot_id = Number(entry.slot_id);
  if (!Number.isInteger(slot_id) || slot_id < 1) {
    return { error: 'Valid slot_id is required.' };
  }

  const is_empty = Boolean(entry.is_empty);
  const class_type = entry.class_type ? String(entry.class_type).trim() : (is_empty ? 'Empty' : 'Theory');
  if (!CLASS_TYPES.includes(class_type)) {
    return { error: `Class type must be one of: ${CLASS_TYPES.join(', ')}.` };
  }

  const subject_name = typeof entry.subject_name === 'string' ? entry.subject_name.trim().slice(0, 200) : null;
  const faculty_name = typeof entry.faculty_name === 'string' ? entry.faculty_name.trim().slice(0, 150) : null;
  const faculty_type = entry.faculty_type ? String(entry.faculty_type).trim().toUpperCase() : null;
  if (faculty_type && !FACULTY_TYPES.includes(faculty_type)) {
    return { error: `Faculty type must be one of: ${FACULTY_TYPES.join(', ')}.` };
  }
  const notes = typeof entry.notes === 'string' ? entry.notes.trim().slice(0, 300) : null;

  if (!is_empty && class_type !== 'Break' && class_type !== 'Empty' && !subject_name) {
    return { error: 'Subject name is required for non-empty class periods.' };
  }

  return {
    value: {
      day_of_week,
      slot_id,
      subject_name: is_empty || class_type === 'Empty' ? null : (class_type === 'Break' ? (subject_name || 'Break') : subject_name),
      faculty_name: is_empty || class_type === 'Break' || class_type === 'Empty' ? null : faculty_name,
      faculty_type: is_empty || class_type === 'Break' || class_type === 'Empty' ? null : faculty_type,
      class_type: is_empty ? 'Empty' : class_type,
      is_empty: is_empty || class_type === 'Empty',
      notes
    }
  };
}

function normalizeBool(val) {
  return val === true || val === 1 || val === '1' || val === 'true';
}

async function getFullClassRoutine(db, routineId) {
  const routine = await db.get('SELECT * FROM class_routines WHERE id = ?', routineId);
  if (!routine) return null;
  const slots = await db.all(
    'SELECT * FROM class_routine_slots WHERE routine_id = ? ORDER BY slot_order ASC',
    routineId
  );
  const entries = await db.all(
    `SELECT e.*, s.slot_order, s.start_time, s.end_time, s.duration_minutes, s.label AS slot_label, s.is_break
     FROM class_routine_entries e
     JOIN class_routine_slots s ON s.id = e.slot_id
     WHERE e.routine_id = ?
     ORDER BY CASE e.day_of_week
       WHEN 'Monday' THEN 1
       WHEN 'Tuesday' THEN 2
       WHEN 'Wednesday' THEN 3
       WHEN 'Thursday' THEN 4
       WHEN 'Friday' THEN 5
       ELSE 6 END, s.slot_order ASC`,
    routineId
  );

  return {
    ...routine,
    slots: slots.map(s => ({ ...s, is_break: normalizeBool(s.is_break) })),
    entries: entries.map(e => ({
      ...e,
      is_empty: normalizeBool(e.is_empty),
      is_break: normalizeBool(e.is_break)
    })),
    working_days: WORKING_DAYS
  };
}

/**
 * Idempotent, atomic seed/import for official class routines.
 * Safe to run repeatedly — skips complete routines, recovers incomplete ones,
 * and rolls back everything on failure without archiving unrelated academic sessions.
 */
async function seedClassRoutines(db, datasetInput) {
  await ensureRoutineSchema(db);
  let dataset = datasetInput;
  if (!dataset) {
    const filePath = path.join(__dirname, '..', 'migrations', 'data', 'routine-2083-aswoj-chaitra.json');
    dataset = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  const runInTx = typeof db.withTransaction === 'function'
    ? (fn) => db.withTransaction(fn)
    : (fn) => fn(db);

  return runInTx(async (tx) => {
    const summary = {
      academic_session: dataset.academic_session,
      created: 0,
      recovered: 0,
      skipped: 0,
      routines: []
    };

    const now = new Date().toISOString();
    const isPg = Boolean(tx.isPostgres ?? db.isPostgres);
    const expectedTimeSlots = dataset.time_slots || DEFAULT_TIME_SLOTS;

    for (const semBlock of dataset.semesters || []) {
      const expectedSlotsCount = expectedTimeSlots.length;
      const expectedEntriesCount = (semBlock.entries || []).length;

      const existing = await tx.get(
        'SELECT id, status FROM class_routines WHERE academic_session = ? AND year = ? AND semester = ?',
        dataset.academic_session,
        semBlock.year,
        semBlock.semester
      );

      let routineId;
      let action = 'created';

      if (existing) {
        const slotCountRow = await tx.get(
          'SELECT COUNT(*) AS c FROM class_routine_slots WHERE routine_id = ?',
          existing.id
        );
        const entryCountRow = await tx.get(
          'SELECT COUNT(*) AS c FROM class_routine_entries WHERE routine_id = ?',
          existing.id
        );
        const actualSlots = Number(slotCountRow?.c || 0);
        const actualEntries = Number(entryCountRow?.c || 0);

        if (actualSlots === expectedSlotsCount && actualEntries === expectedEntriesCount) {
          summary.skipped += 1;
          summary.routines.push({
            id: existing.id,
            year: semBlock.year,
            semester: semBlock.semester,
            action: 'skipped',
            slots: actualSlots,
            entries: actualEntries
          });
          continue;
        }

        // Recover incomplete previous import inside the same transaction
        routineId = existing.id;
        action = 'recovered';
        await tx.run('DELETE FROM class_routine_entries WHERE routine_id = ?', routineId);
        await tx.run('DELETE FROM class_routine_slots WHERE routine_id = ?', routineId);
        await tx.run(
          `UPDATE class_routines
           SET university = ?, program = ?, effective_date = ?, updated_at = ?
           WHERE id = ?`,
          dataset.university,
          dataset.program,
          dataset.effective_date || null,
          now,
          routineId
        );
      } else {
        const targetStatus = dataset.status || 'published';
        const publishedAt = targetStatus === 'published' ? now : null;
        if (isPg) {
          const row = await tx.get(
            `INSERT INTO class_routines (university, program, academic_session, year, semester, effective_date, status, published_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING id`,
            dataset.university,
            dataset.program,
            dataset.academic_session,
            semBlock.year,
            semBlock.semester,
            dataset.effective_date || null,
            targetStatus,
            publishedAt,
            now,
            now
          );
          routineId = row.id;
        } else {
          const res = await tx.run(
            `INSERT INTO class_routines (university, program, academic_session, year, semester, effective_date, status, published_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            dataset.university,
            dataset.program,
            dataset.academic_session,
            semBlock.year,
            semBlock.semester,
            dataset.effective_date || null,
            targetStatus,
            publishedAt,
            now,
            now
          );
          routineId = Number(res.lastInsertRowid);
        }
      }

      const slotIdByOrder = new Map();
      for (const slot of expectedTimeSlots) {
        const isBreakVal = isPg ? Boolean(slot.is_break) : (slot.is_break ? 1 : 0);
        let slotId;
        if (isPg) {
          const sRow = await tx.get(
            `INSERT INTO class_routine_slots (routine_id, slot_order, start_time, end_time, duration_minutes, label, is_break)
             VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
            routineId, slot.slot_order, slot.start_time, slot.end_time, slot.duration_minutes, slot.label, isBreakVal
          );
          slotId = sRow.id;
        } else {
          const sRes = await tx.run(
            `INSERT INTO class_routine_slots (routine_id, slot_order, start_time, end_time, duration_minutes, label, is_break)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            routineId, slot.slot_order, slot.start_time, slot.end_time, slot.duration_minutes, slot.label, isBreakVal
          );
          slotId = Number(sRes.lastInsertRowid);
        }
        slotIdByOrder.set(slot.slot_order, slotId);
      }

      const subjectsMap = semBlock.subjects || {};
      for (const entry of semBlock.entries || []) {
        const slotId = slotIdByOrder.get(entry.slot_order);
        if (!slotId) {
          throw new Error(`Missing slot_order ${entry.slot_order} for Semester ${semBlock.semester}`);
        }
        const isEmpty = Boolean(entry.is_empty || entry.class_type === 'Empty');
        const isBreak = entry.class_type === 'Break';
        const subjectInfo = entry.subject && subjectsMap[entry.subject] ? subjectsMap[entry.subject] : null;
        const facultyName = isEmpty || isBreak ? null : (entry.faculty_name || subjectInfo?.faculty_name || null);
        const facultyType = isEmpty || isBreak ? null : (entry.faculty_type || subjectInfo?.faculty_type || null);
        const isEmptyVal = isPg ? isEmpty : (isEmpty ? 1 : 0);

        await tx.run(
          `INSERT INTO class_routine_entries (routine_id, slot_id, day_of_week, subject_name, faculty_name, faculty_type, class_type, is_empty, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          routineId,
          slotId,
          entry.day,
          isEmpty ? null : entry.subject,
          facultyName,
          facultyType,
          entry.class_type || (isEmpty ? 'Empty' : 'Theory'),
          isEmptyVal,
          entry.notes || null,
          now,
          now
        );
      }

      // Verify all expected slots and entries before committing
      const verifiedSlotsRow = await tx.get(
        'SELECT COUNT(*) AS c FROM class_routine_slots WHERE routine_id = ?',
        routineId
      );
      const verifiedEntriesRow = await tx.get(
        'SELECT COUNT(*) AS c FROM class_routine_entries WHERE routine_id = ?',
        routineId
      );
      const verifiedSlots = Number(verifiedSlotsRow?.c || 0);
      const verifiedEntries = Number(verifiedEntriesRow?.c || 0);

      if (verifiedSlots !== expectedSlotsCount || verifiedEntries !== expectedEntriesCount) {
        throw new Error(
          `Class routine seed verification failed for Year ${semBlock.year} / Semester ${semBlock.semester}: expected ${expectedSlotsCount} slots & ${expectedEntriesCount} entries, got ${verifiedSlots} slots & ${verifiedEntries} entries.`
        );
      }

      if (action === 'recovered') {
        summary.recovered += 1;
      } else {
        summary.created += 1;
      }
      summary.routines.push({
        id: routineId,
        year: semBlock.year,
        semester: semBlock.semester,
        action,
        slots: verifiedSlots,
        entries: verifiedEntries
      });
    }

    return summary;
  });
}

const FIELDS = ['semester', 'subject_name', 'subject_code', 'exam_date', 'calendar', 'exam_time', 'room', 'weekday', 'exam_type'];
const ORDER_BY = 'semester ASC, calendar ASC, exam_date ASC, id ASC';

module.exports = {
  ROMANS,
  WORKING_DAYS,
  CLASS_TYPES,
  FACULTY_TYPES,
  ROUTINE_STATUSES,
  DEFAULT_TIME_SLOTS,
  FIELDS,
  ORDER_BY,
  routineSchema,
  classRoutineSchema,
  ensureRoutineSchema,
  semesterNumber,
  yearForSemester,
  normalizeDate,
  validateRoutine,
  validateClassRoutine,
  validateSlot,
  validateRoutineEntry,
  getFullClassRoutine,
  seedClassRoutines
};
