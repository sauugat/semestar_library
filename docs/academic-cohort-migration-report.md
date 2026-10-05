# Academic Cohort Architecture & Migration Strategy Report

Date: 2026-10-05  
Status: Phase 1 Complete (Foundation, Schema, Authoritative Context, Security, Tests)  
Production Mutation Performed: **NO**

---

## 1. Executive Summary

Semester Library is transitioning from a client-manipulable, primarily semester-string-filtered system into a **server-authoritative, cohort-based academic system**.

### Key Architectural Shifts
1. **Permanent Cohort Identity**: Every cohort receives a permanent, immutable UUID primary key (`cohorts.id`).
2. **Recyclable Display Slots**: The display names and codes (`mercury`, `venus`, `earth`, `mars`) are recyclable slot codes. When a cohort graduates (e.g., Mars at Semester 8), that cohort identity remains immutable in the database (`status = 'graduated'`), and a brand-new incoming cohort at Semester 1 may reuse the display slot code `mars` with a **brand new UUID**. Old cohort records and new cohort records are completely isolated.
3. **Enforced Active Slot Exclusivity**: At any given time, only **one active cohort** may occupy a given slot code (`CREATE UNIQUE INDEX idx_cohorts_active_slot ON cohorts (slot_code) WHERE status = 'active'`).
4. **Server-Authoritative Context**: Clients (mobile and web) are forbidden from selecting or overriding academic context. The server derives cohort membership strictly from the authenticated identity (`req.user` -> `students` -> `cohort_id` -> `cohorts` -> `current_semester`).
5. **Historical Content Integrity**: Content records (`posts`, `files`, `assignments`) store a snapshot of the creation semester (`semester_no`) and cohort identity (`cohort_id`, `audience_scope`). When a cohort advances from Semester 1 to Semester 2, its Semester 1 notes, posts, and assignments **never** change their `semester_no`. Historical content semester is never derived from `cohort.current_semester`.

---

## 2. Existing Architecture & Data Flow Audit

### 2.1 Authentication & User Resolution
- **Mechanisms**:
  1. Supabase Bearer JWTs via `lib/auth-middleware.js` and `lib/supabase.js`.
  2. Legacy Mobile Bearer Tokens stored in `mobile_tokens` table.
  3. Browser sessions (`__gu_session`) backed by PostgreSQL/SQLite via `CustomDbStore` in `server.js`.
- **Identity Bridge**:
  All three mechanisms resolve to a single row in the `students` table keyed by `studentId` (or `supabase_uid`).
  `req.user` and `req.student` are populated on Express request pipelines.

### 2.2 Roles
- `student`: Standard learner enrolled in one active academic cohort.
- `cr`: Class Representative (student role with permission to publish official notices for their cohort/university).
- `teacher`: Faculty member with academic oversight across all cohorts and semesters.
- `admin`: System administrator with full management and cohort lifecycle authority.

### 2.3 Locations Where Code Previously Trusted `semester`
Our code audit identified the following locations where client-supplied or student-table `semester` was directly trusted:
1. `server.js` (`POST /api/profile`): Students were previously able to update their own `semester` column via `req.body.semester`. *(Fixed in Phase 1: Students can no longer mutate `semester` or `cohort_id`).*
2. `server.js` (`POST /api/files/upload` & `/api/files/mobile-upload`): Trusted `req.body.semester` directly from the client request.
3. `server.js` (`GET /api/files`): Filtered files by `req.query.semester`.
4. `server.js` (`POST /api/register`): Validated client-supplied string in `['Semester 1', ..., 'Semester 8']` and stored directly into `students.semester`.
5. `routes/posts.js` (`POST /api/posts`): Used `req.postUser.semester` for notification dispatch, but `posts` table had no semester or cohort column.
6. `routes/code-lab/assignments.js` (`GET /assignments` & `POST /assignments`): Directly accepted `req.query.semester` and `req.body.semester`.
7. `routes/routine.js` (`GET /api/routine`): Filtered routine exams by `req.query.semester`.
8. `lib/push-notifications.js` (`enqueueMaterialPush` & `enqueuePostOrNoticePush`): Filtered push recipients using string comparison `normalizeSemester(s.semester) === targetSem`.
9. `public/library.html` & `public/dashboard.html`: Client UI tabs sent query parameters `?semester=...`.
10. `mobile/services/library.ts`: Mobile client constructed URLs using client-selected semester parameters.

---

## 3. Real Database Record Audit

### 3.1 Neon PostgreSQL (Production Ground Truth)
- `students`: **15 records**
  - Confirmed regular BIT students: 3 (`26020266` Saugat Subedi [admin], `26020260` Sandesh Dhakal, `26020268` Subarna Poudel)
  - Synthetic test fixtures: 10 (`TEST-STUDENT-A...`, `NC-STUDENT-...`, `API-STUDENT-...`)
  - Ambiguous / unverified IDs: 2 (`3322` Swostika Subedi, `366372` Trojan Virus)
  - Semesters present: `Semester 1` (11), `Semester 2` (1), `Semester 3` (3)
- `files`: **78 records**
  - General / Global curriculum files (`semester IS NULL`): 3 (`BIT_CURRICULUM (1).pdf`, wallpapers)
  - Semester I materials: 2
  - Semester II materials: 73
- `posts`: **12 records**
  - 12 status posts (none had `semester` or `cohort_id` columns)
- `assignments`: **1 record**
  - Title: 'Assignment 1', Subject: 'Computer Programming,I (C)', Semester: 'I'
- `notifications`: 64 records, `notification_recipients`: 65 records

### 3.2 SQLite (Development & Testing Ground Truth)
- `students`: 388 records (45 default BIT batch `260202xx`, 138 test fixtures, 205 other local dev accounts)
- `files`: 161 records (10 general/global, 151 semester files)
- `posts`: 14 records (4 notices, 10 status)
- `assignments`: 3 records
- `chat_messages`: 100 records

---

## 4. Record Classification & Backfill Strategy

To prevent corrupting historical records, we strictly classify all records into four categories:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   ACADEMIC RECORD CLASSIFICATION                       │
├────────────────────────┬───────────────────────────────────────────────┤
│ 1. Safely Mappable     │ Confirmed BIT roster students with verified    │
│                        │ intake year & active cohort slot.             │
├────────────────────────┼───────────────────────────────────────────────┤
│ 2. Global / System     │ Curriculum PDFs, general notices, university-  │
│                        │ wide circulars. audience_scope = all_students │
├────────────────────────┼───────────────────────────────────────────────┤
│ 3. Ambiguous           │ Historical semester files uploaded by admins;  │
│                        │ students outside verified rosters.            │
│                        │ FALLBACK: audience_scope = all_students,      │
│                        │ cohort_id = NULL. Do NOT invent cohort links! │
├────────────────────────┼───────────────────────────────────────────────┤
│ 4. Test / Legacy       │ Synthetic fixtures (TEST-*, NC-*, API-*).     │
│                        │ Kept unassigned (cohort_id = NULL).           │
└────────────────────────┴───────────────────────────────────────────────┘
```

### 4.1 Category 1: Safely Mappable Records
- **Criteria**:
  - Regular Gandaki University BIT students with confirmed enrollment identifiers (e.g. `260202xx` series) matching known active cohorts.
  - Active Cohorts mapping for current academic session:
    - Mercury: Semester 1 (Intake 2024 / current batch)
    - Venus: Semester 3
    - Earth: Semester 5
    - Mars: Semester 7
- **Action**:
  - Assign `students.cohort_id = <cohort_uuid>`.

### 4.2 Category 2: Global / System Content
- **Criteria**:
  - Institutional documents where `semester IS NULL` or `subject IS NULL` (e.g. `BIT_CURRICULUM (1).pdf`).
  - Official university maintenance announcements and circulars published by admin.
- **Action**:
  - Set `cohort_id = NULL`.
  - Set `audience_scope = 'all_students'`.
  - Set `semester_no = NULL` (or reference semester if applicable).

### 4.3 Category 3: Ambiguous / Unmappable Records
- **Criteria**:
  - 73 Semester II lecture notes uploaded by admin `26020266` in August 2026. The historical cohort identity cannot be verified with certainty (e.g., was this a prior batch or a shared departmental repository?).
  - Students with non-standard IDs or semesters that do not match the current odd-semester rotation (e.g. `3322`, `366372`).
- **Safe Fallback Strategy (DO NOT INVENT COHORT OWNERSHIP)**:
  - Content: Keep `cohort_id = NULL`, set `semester_no = normalizeSemester(semester)` (e.g. 2 for Semester II), and set `audience_scope = 'all_students'`. This allows students viewing the course library to access curriculum notes for that subject without falsely attributing private cohort ownership.
  - Students: Keep `students.cohort_id = NULL` (`academicStatus = 'unassigned'`). These students can access public/global content, but are gated from private cohort communications until verified via official roster review.

### 4.4 Category 4: Test & Legacy Records
- **Criteria**:
  - Synthetic accounts matching prefix `TEST-`, `NC-`, `API-`, `MOCK-`.
- **Action**:
  - Retain `cohort_id = NULL`. Do not enroll test accounts into academic cohorts.

### 4.5 Existing Assignments Audit & Backfill Strategy
- **Audited Records**:
  - **Neon PostgreSQL (Production)**: 1 assignment row (`id = 20`, title: "Assignment 1", subject: "Computer Programming,I (C)", semester: "I", createdBy: "26020266" [admin]).
  - **SQLite (Development)**: 3 assignment rows (`id = 1, 2, 3`, title: "Lab Assignment 1", subject: "Programming", semester: "Semester 1", createdBy: "prof_test_stud_b_...").
- **Classification & Decision**:
  - Assignment 20 was created by admin `26020266` as the universal baseline programming lab assignment for Semester 1 C Programming.
  - Attributing it exclusively to one private cohort (e.g. Mercury) would lock out future Semester 1 students or parallel cohorts from completing this institutional lab work.
  - Conversely, setting it without a semester snapshot would allow upper-semester students to have their feeds cluttered with introductory assignments.
  - **Exact Backfill Decision**:
    - `cohort_id = NULL` (No unproven private cohort lock)
    - `semester_no = 1` (Snapshot preserved from `semester = 'I'`)
    - `audience_scope = 'all_students'` (Institutionally available to students currently enrolled in Semester 1)
  - This safe fallback prevents leaking cohort data while ensuring that any student currently in Semester 1 can access their syllabus assignments.

---

## 5. Schema Specification

### 5.1 `cohorts` Table
```sql
CREATE TABLE cohorts (
  id TEXT PRIMARY KEY,
  slot_code TEXT NOT NULL CHECK (slot_code IN ('mercury', 'venus', 'earth', 'mars')),
  display_name TEXT NOT NULL,
  intake_year INTEGER,
  intake_identifier TEXT,
  current_semester INTEGER NOT NULL CHECK (current_semester BETWEEN 1 AND 8),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'graduated', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  graduated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_cohorts_active_slot 
ON cohorts (slot_code) 
WHERE status = 'active';
```

### 5.2 `cohort_semester_history` Table
```sql
CREATE TABLE cohort_semester_history (
  id TEXT PRIMARY KEY,
  cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMPTZ,
  promoted_by TEXT REFERENCES students(studentId),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cohort_history_cohort 
ON cohort_semester_history (cohort_id, semester_no);
```

### 5.3 Entity Extensions (`students`, `posts`, `files`, `assignments`)
```sql
-- Students
ALTER TABLE students ADD COLUMN cohort_id TEXT REFERENCES cohorts(id);
CREATE INDEX idx_students_cohort ON students (cohort_id);

-- Posts
ALTER TABLE posts ADD COLUMN cohort_id TEXT REFERENCES cohorts(id);
ALTER TABLE posts ADD COLUMN semester_no INTEGER;
ALTER TABLE posts ADD COLUMN audience_scope TEXT NOT NULL DEFAULT 'cohort';
CREATE INDEX idx_posts_cohort_sem ON posts (cohort_id, semester_no);
CREATE INDEX idx_posts_audience ON posts (audience_scope);

-- Files / Study Materials
ALTER TABLE files ADD COLUMN cohort_id TEXT REFERENCES cohorts(id);
ALTER TABLE files ADD COLUMN semester_no INTEGER;
ALTER TABLE files ADD COLUMN audience_scope TEXT NOT NULL DEFAULT 'cohort';
CREATE INDEX idx_files_cohort_sem ON files (cohort_id, semester_no);
CREATE INDEX idx_files_audience ON files (audience_scope);

-- Assignments
ALTER TABLE assignments ADD COLUMN cohort_id TEXT REFERENCES cohorts(id);
ALTER TABLE assignments ADD COLUMN semester_no INTEGER;
ALTER TABLE assignments ADD COLUMN audience_scope TEXT NOT NULL DEFAULT 'cohort';
CREATE INDEX idx_assignments_cohort_sem ON assignments (cohort_id, semester_no);
CREATE INDEX idx_assignments_audience ON assignments (audience_scope);
```

---

## 6. Server-Authoritative Academic Context API

### Endpoint: `GET /api/academic-context`
Requires authenticated user (`requireLogin`).

#### Response: Student (`role = 'student'` or `'cr'`)
```json
{
  "authenticated": true,
  "role": "student",
  "studentId": "26020230",
  "name": "Aashrita Lamichhane",
  "canViewAllCohorts": false,
  "cohort": {
    "id": "7f13b632-4d7a-42c2-8fe2-8178d8a7c1b4",
    "code": "mercury",
    "slotCode": "mercury",
    "displayName": "Mercury",
    "currentSemester": 1,
    "intakeYear": 2024,
    "intakeIdentifier": "BIT-2024",
    "status": "active",
    "createdAt": "2026-10-05T09:00:00.000Z",
    "graduatedAt": null
  },
  "academicStatus": "active"
}
```

#### Response: Teacher (`role = 'teacher'`)
```json
{
  "authenticated": true,
  "role": "teacher",
  "studentId": "TEACHER_SHARMA",
  "name": "Teacher Sharma",
  "canViewAllCohorts": true,
  "cohorts": [
    {
      "id": "7f13b632-4d7a-42c2-8fe2-8178d8a7c1b4",
      "code": "mercury",
      "slotCode": "mercury",
      "displayName": "Mercury",
      "currentSemester": 1,
      "status": "active"
    },
    {
      "id": "2d8f9a14-3c6b-4e11-9a72-6a4b5c7d8e9f",
      "code": "venus",
      "slotCode": "venus",
      "displayName": "Venus",
      "currentSemester": 3,
      "status": "active"
    }
  ]
}
```

#### Response: Admin (`role = 'admin'`)
```json
{
  "authenticated": true,
  "role": "admin",
  "studentId": "26020266",
  "name": "Saugat Subedi",
  "canViewAllCohorts": true,
  "canManageCohorts": true,
  "cohorts": [...]
}
```

---

## 7. Cohort Recycling & Isolation Proof

### Lifecycle Simulation
1. **Mars Cohort (UUID-A)**:
   - Initialized at Semester 7, promoted to Semester 8.
   - Posts notes, assignments, and messages.
2. **Graduation**:
   - `graduateCohort(db, { cohortId: 'UUID-A' })`.
   - `status` set to `'graduated'`. Active slot `mars` is now vacant.
3. **Recycling Slot**:
   - `recycleSlot(db, { slotCode: 'mars', intakeYear: 2026 })`.
   - Brand new cohort **UUID-B** created at Semester 1.
4. **Data Isolation**:
   - UUID-B students querying cohort content query `WHERE cohort_id = 'UUID-B'`.
   - Results from UUID-A are strictly zero.
   - Chat history, private notifications, assignments, and notes from UUID-A are completely inaccessible to UUID-B.
   - Tested and verified in `tests/academic-cohorts.test.js`.
