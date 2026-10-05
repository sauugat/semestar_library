# Prepared Production Migration Plan (Phase 3 Acceptance Gate)

> **SAFETY NOTICE: DOCUMENTATION ONLY — NO PRODUCTION MUTATIONS PERFORMED**  
> Status: Prepared & Validated under Local PostgreSQL & Live Supabase Provider.  
> Execution Status: **STRICTLY PENDING PRODUCTION SIGN-OFF**.

This document details the production migration strategy for transitioning Semester Library from semester-based filtering to server-authoritative academic cohort lifecycle architecture.

---

## 1. Production Backup & Recovery Strategy
- **Pre-Migration Snapshot**: Full logical backup via `pg_dump -Fc` of the production PostgreSQL database prior to any schema modification.
- **WAL Archiving**: Confirm continuous Point-In-Time Recovery (PITR) is active on production Neon with retention covering the migration window.
- **Restoration Dry-Run**: Execute automated restore verification on a disposable database target to confirm dump integrity and measure recovery time objective (RTO < 15 minutes).
- **Point-in-Time Recovery Target**: Record exact LSN and UTC timestamp before running Step 2.

---

## 2. Exact Schema Migration
- **Transaction Safety**: All DDL executed within a single transaction with explicit lock timeouts (`lock_timeout = '5s'`).
- **Idempotent Tables**:
  - `cohorts`: Primary key `id` (UUID), `slot_code` (`MERCURY`, `VENUS`, `EARTH`, `MARS`), `intake_year`, `current_semester`, `status` (`active`, `graduated`, `archived`), `version`, `created_at`, `graduated_at`.
  - `cohort_semester_history`: Foreign key `cohort_id` REFERENCES `cohorts(id)`, `semester_no`, `started_at`, `ended_at`, `promoted_by`.
  - `cohort_audit_logs`: Audit trail with immutable `actor_id`, `action`, `cohort_id`, `details` JSON.
  - `chat_groups`: Add `cohort_id REFERENCES cohorts(id)` and `status` (`active`, `closed`, `recycling`, `recycled`).
  - `chat_group_slots`: Slot management tracking active group mapping.
- **Entity Columns**:
  - Add nullable `cohort_id` column to `students`, `posts`, `files`, `assignments`, `notifications`.
- **Partial Unique Index**:
  ```sql
  CREATE UNIQUE INDEX idx_cohorts_active_slot 
  ON cohorts (slot_code) 
  WHERE status = 'active';
  ```
- **Zero Destructive Changes**: No columns renamed or dropped; full backward compatibility preserved.

---

## 3. Cohort Creation
- Authoritative creation of initial active cohorts corresponding to the current academic calendar:
  - `MERCURY` (Intake 2026, Semester 1, status='active')
  - `VENUS` (Intake 2025, Semester 3, status='active')
  - `EARTH` (Intake 2024, Semester 5, status='active')
  - `MARS` (Intake 2023, Semester 7, status='active')
- Initialize `cohort_semester_history` row for each created cohort with `started_at = CURRENT_TIMESTAMP`.

---

## 4. Verified Student Mapping
- **Registrar Ingestion**: Load verified student admission rosters matching department `BIT` and official enrollment years.
- **Deterministic Batch Mapping**:
  - Admission Year 2026 -> MERCURY UUID
  - Admission Year 2025 -> VENUS UUID
  - Admission Year 2024 -> EARTH UUID
  - Admission Year 2023 -> MARS UUID
- **Pre-Migration Manifest**: Generate a verification dry-run report showing exactly which student IDs will be updated before executing SQL.

---

## 5. Ambiguous Student Handling Policy
- **No Silent Auto-Mapping**: Any student whose enrollment year or semester cannot be deterministically matched to an active cohort MUST REMAIN `cohort_id = NULL`.
- **Faculty / Administrative Roles**: Teachers and admins remain unassigned (`cohort_id = NULL`) with global inspection permissions.
- **Graceful Client UI**: Unassigned students receive a safe empty state:
  > *"Your class has not been assigned yet. Course materials for your cohort will appear once assigned by faculty."*
- **Administrative Correction**: Admins can reassign students via `/api/admin/cohorts/assign-student` with full audit logging.

---

## 6. Content Backfill
- **Historical Content Integrity**:
  - Existing files, posts, and assignments are backfilled with `cohort_id` based on creator's verified cohort and creation timestamp.
  - Materials not tied to a specific cohort are designated as global (`cohort_id = NULL`).
- **No Ownership Rewrite**: Legacy timestamps, author IDs, and semester tags are preserved without mutation.

---

## 7. Chat Room Linking & Creation
- Connect existing chat groups to their corresponding active cohort UUIDs.
- Maintain the strict invariant: Exactly one active `chat_groups` record per active `cohorts` record.
- Historical rooms for previous batches are marked `status = 'closed'` or `archived`.

---

## 8. Chat Membership Transition
- Authorize room access strictly via `students.cohort_id = chat_groups.cohort_id`.
- Rotate `realtimeEpoch` on all active rooms to invalidate any stale Supabase Realtime channel subscriptions or cached tokens.
- Revocations table (`chat_room_revocations`) checked on every token issuance and context resolution.

---

## 9. Index Creation & Performance Tuning
- Create foreign key indexes:
  ```sql
  CREATE INDEX idx_students_cohort_id ON students(cohort_id);
  CREATE INDEX idx_posts_cohort_id ON posts(cohort_id);
  CREATE INDEX idx_files_cohort_id ON files(cohort_id);
  CREATE INDEX idx_assignments_cohort_id ON assignments(cohort_id);
  CREATE INDEX idx_notifications_cohort_id ON notifications(cohort_id);
  CREATE INDEX idx_chat_messages_group_id ON chat_messages(chat_group_id);
  ```
- Run `ANALYZE` on modified tables.

---

## 10. Backend Deployment Ordering
1. Deploy schema migrations (Step 2) to production database.
2. Deploy backend service in **Dual-Read / Authoritative Mode**:
   - Queries look up student's authoritative `cohort_id`.
   - Fallback logic serves unassigned students cleanly.
3. Run data backfill script (Steps 3-7).
4. Enable strict cohort authorization enforcement across all API endpoints.

---

## 11. Web Deployment Ordering
1. Deploy updated web bundle with subject-first navigation, removed student semester switcher, and authoritative cohort context header.
2. Purge Cloudflare / CDN edge caches for HTML and JS bundles.
3. Verify live health check and web client authentication flows.

---

## 12. Mobile Rollout Ordering
1. Publish Expo OTA update with updated `useAcademicContext` hook, cache scoping, and graduated read-only banners.
2. Verify backward compatibility: Existing installed apps gracefully resolve authoritative context or display safe fallback.
3. Prepare production standalone builds (APK/AAB) for release tracks.

---

## 13. Notification Recipient Transition
1. Outbox queue drain: Wait for pending legacy notification outbox items to clear or mark complete.
2. Transition push dispatch logic: Route all cohort-scoped push notifications strictly through `cohort_id = ?`.
3. Legacy global notifications retain `cohort_id = NULL` and target all active students.
4. Verify historical inbox notifications remain intact for all student accounts.

---

## 14. Post-Deployment Smoke Tests
1. **Academic Context**: Verify GET `/api/academic-context` returns correct cohort UUID and semester for each test student.
2. **Feed Isolation**: Confirm student in Mercury cannot view Venus feed posts.
3. **Library Isolation**: Confirm subject-first files load exclusively for student's active cohort.
4. **Chat Continuity**: Confirm real-time messaging, reaction, and typing work in active room.
5. **Admin Security**: Verify non-admin students/CRs receive 403 on `/api/admin/cohorts/*`.
6. **Push Dispatch**: Send test notification to Mercury and verify only Mercury members receive it.

---

## 15. Rollback Triggers
Immediate rollback will be initiated if any of the following occur within 60 minutes of rollout:
- HTTP 5xx error rate exceeds 0.5% over a 5-minute rolling window.
- Failed academic context resolutions exceed 1% of total authenticated requests.
- Push notification delivery error rate exceeds 2%.
- Database connection pool saturation or deadlock detection on cohort tables.
- Cross-cohort data leakage reported or detected in telemetry.

---

## 16. Rollback Procedure
1. **Backend Revert**: Revert backend container image to previous release tag.
2. **Fallback Mode**: Set `COHORT_STRICT_ENFORCEMENT = false` environment variable to restore legacy semester-matching fallback.
3. **Database State**: If data corruption occurred, restore database from the pre-migration snapshot taken in Step 1 using PITR to the pre-migration timestamp.
4. **Client Invalidation**: Trigger global cache generation bump to clear client SQLite/memory caches.
5. **Post-Mortem**: Document root cause in incident log before attempting re-run.
