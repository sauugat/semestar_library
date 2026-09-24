# Routine management

Routine is the first of three stages. Subjects and Syllabus are not migrated by this change.

## Use the admin panel

Sign in as an admin and open `/routine.html`. Below the published schedule, **Manage routine** lists every exam. Use **Add exam**, **Edit**, or **Delete**. Students see the published schedule without these controls. Every management endpoint also checks the logged-in student's role in the database.

- Semester supports 1–8. Old links such as `?semester=II` still work.
- Choose BS or AD explicitly; the date is stored as `YYYY/MM/DD`. No calendar conversion takes place.
- For AD, validation checks actual month lengths and leap years. BS validation checks the basic format, months 1–12, and days 1–32; it does not claim to verify BS month-specific lengths. Check BS dates against the university notice.
- Weekday is optional, manual text; it is not calculated.
- Exam type is optional free text, with suggestions such as Final Examination, Pre-board Examination, Theory, Practical and Makeup.
- A missing time is shown as **Time to be announced**; no time is invented.
- Subject name and code are temporary routine fields. In the separately approved Subjects stage, a `subject_id` foreign key will become the authoritative link and the UI will select a subject record.

## Migrate an existing installation

Use the same environment/database configuration as the application. The runner reads `.env` using the existing `db.js` configuration and closes its connections when finished. It skips unrelated schema initialization and student seeds.

```sh
npm run migrate:routine -- --dry-run
npm run migrate:routine
npm start
```

Run the import during the application update, before enabling the new admin UI. Stop making routine changes in an older deployed version during this transition: the old version writes `exam_schedule`, while the new version writes `routine`. Redeploy/restart all app instances after importing. Applying the migration does not itself deploy application code.

`--dry-run` only reads data and reports its source, count, and any review warnings. The real migration:

1. Copies all existing `exam_schedule` records, including custom admin additions, preserving their IDs.
2. When that table is absent or empty, imports `migrations/data/routine-legacy.json`. This is the exact 18-record seed array extracted from `db.js`; the current `routine.html` contains a loading placeholder, not static exam records.
3. Separates recognized subject codes stored in the old `time` column from genuine times. Known original schedule records are marked BS. Other records retain an unconfirmed calendar, avoiding guesses or conversions.
4. Normalizes recognised date formats and semester labels. Unrecognised date text is preserved and flagged; invalid required IDs/semesters/names/dates stop the import rather than dropping records.
5. Writes a `schema_migrations` completion record in the same transaction. Reruns skip an applied migration, including after an admin intentionally deletes every exam. An untracked, nonempty `routine` table stops migration rather than overwriting it.

The legacy table remains intact as a backup. Removing it is not part of this change. The old automatic reseeding has been removed. On PostgreSQL, the import uses an advisory lock and one transaction/connection; SQLite/Turso uses a write transaction. If a statement fails, the import rolls back.

Schemas: `migrations/001-routine.postgres.sql` and `migrations/001-routine.sqlite.sql`. Runtime schema setup uses the same definitions from `lib/routine.js`. Both schemas include an index on semester and date. Rows from different calendars are grouped separately rather than presented as a converted chronological order.

## API

- `GET /api/routine` — public list; optional `?semester=1` (Roman aliases also accepted).
- `GET /api/routine/admin` — admin-only list, same optional filter.
- `POST /api/routine` — admin-only create.
- `PUT /api/routine/:id` — admin-only replace editable details.
- `DELETE /api/routine/:id` — admin-only delete.

Create/update fields: `semester`, `subject_name`, `subject_code`, `exam_date`, `calendar`, `exam_time`, `room`, `weekday`, `exam_type`. Calendar may be null in migrated records. UI edits require confirming it. Responses include the stored row and its ID/timestamps. Invalid input receives 400; non-admin access 403; no login 401; a missing record 404. The former create payload (`subject`, `examDate`, `time`, `type`) is replaced together with the frontend.

The AI routine lookup reads the new table, retains semester/subject filtering, includes calendar/time/room, and invalidates its response cache after an admin changes a routine.

## Verification

```sh
npm run test:routine
node --test tests/chat-routing.test.js
ROUTINE_TEST_POSTGRES=1 npm run test:routine
```

The default routine tests use temporary SQLite files. The PostgreSQL option uses the configured Neon/PostgreSQL connection, creates randomly named isolated test schemas, and removes those schemas afterward. It does not modify real students or schedules. Tests cover migration reruns and rollback, preserved legacy records, date validation, authentication/authorization, CRUD, missing/invalid IDs, database failures, and the AI routine lookup.
