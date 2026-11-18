-- PostgreSQL schema for semester-aware Class Routines
CREATE TABLE IF NOT EXISTS class_routines (
  id SERIAL PRIMARY KEY,
  university TEXT NOT NULL DEFAULT 'Gandaki University',
  program TEXT NOT NULL DEFAULT 'Bachelor of Information Technology',
  academic_session TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year BETWEEN 1 AND 4),
  semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
  effective_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by TEXT,
  published_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (academic_session, year, semester)
);
CREATE INDEX IF NOT EXISTS idx_class_routines_sem_status ON class_routines (semester, status);

CREATE TABLE IF NOT EXISTS class_routine_slots (
  id SERIAL PRIMARY KEY,
  routine_id INTEGER NOT NULL REFERENCES class_routines(id) ON DELETE CASCADE,
  slot_order INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  label TEXT NOT NULL,
  is_break BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (routine_id, slot_order)
);
CREATE INDEX IF NOT EXISTS idx_class_routine_slots_routine ON class_routine_slots (routine_id, slot_order);

CREATE TABLE IF NOT EXISTS class_routine_entries (
  id SERIAL PRIMARY KEY,
  routine_id INTEGER NOT NULL REFERENCES class_routines(id) ON DELETE CASCADE,
  slot_id INTEGER NOT NULL REFERENCES class_routine_slots(id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')),
  subject_name TEXT,
  faculty_name TEXT,
  faculty_type TEXT CHECK (faculty_type IN ('FT', 'CC', 'MA') OR faculty_type IS NULL),
  class_type TEXT CHECK (class_type IN ('Theory', 'Practical', 'Lab', 'Break', 'Empty') OR class_type IS NULL),
  is_empty BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (routine_id, day_of_week, slot_id)
);
CREATE INDEX IF NOT EXISTS idx_class_routine_entries_routine_day ON class_routine_entries (routine_id, day_of_week);
