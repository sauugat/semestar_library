-- Approved Routine schema. Data is imported by scripts/migrate-routine.js.
CREATE TABLE IF NOT EXISTS routine (
    id SERIAL PRIMARY KEY,
    semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
    subject_name TEXT NOT NULL,
    subject_code TEXT,
    exam_date TEXT NOT NULL,
    calendar TEXT CHECK (calendar IN ('BS', 'AD')),
    exam_time TEXT,
    room TEXT,
    weekday TEXT,
    exam_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS routine_semester_date_idx ON routine (semester, exam_date);
