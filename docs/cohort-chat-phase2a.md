# Rotating cohort chat — Phase 2A local backend

Implemented and tested on 2026-10-04. Ready to begin mobile/web integration against the local contract. **Not ready for production migration.** No production Neon/Supabase changes, deployment, commit, push, OTA, APK, or legacy-history movement/deletion were performed. Existing mobile edits in the workspace were left untouched; Keyboard V2 was not edited.

The implementation is opt-in. `NODE_ENV=test COHORT_CHAT_LOCAL=1` mounts the new router before every legacy `/api/chat` handler, using the existing application's `requireLogin`. The flag is rejected before database import outside test mode. The migration requires both test mode and `{ disposable: true }`, and is never invoked automatically by `db.initSchema`. Missing providers fail closed. The real-login integration test exercises this mount, the real database adapter, and authenticated HTTP requests.

## Files in this phase

- `migrations/002-cohort-chat.js`: transactional additive migration, version marker, PostgreSQL migration advisory lock, constraints, indexes, four slots and one quarantined legacy placeholder.
- `lib/cohort-chat.js`: authoritative room context, all room operations, lifecycle transitions, projection/config and worker abstractions.
- `routes/cohort-chat.js`: authenticated HTTP boundary, memory-only multipart upload and safe attachment response headers.
- `lib/chat-event-dedupe.js`: consumer contract utility for event IDs, with persistent atomic apply-and-remember supplied by the next client phase.
- `lib/db-transaction.js`: recognizes SQLite `RETURNING` rows when the driver omits `lastInsertRowid` and `rowsAffected`.
- `lib/push-notifications.js`: fenced single-row dispatch, reserved cohort job namespace, injectable test transport, PostgreSQL receipt insertion compatibility.
- `server.js`: test-only opt-in mount and early guard.
- `tests/cohort-chat-backend.test.js`: shared SQLite/PostgreSQL behavior and real HTTP IDOR suite.
- `tests/cohort-chat-concurrency.test.js`: mandatory PostgreSQL locking tests when enabled.
- `tests/cohort-chat-auth.test.js`: existing application login/auth integration.
- `tests/helpers/cohort-fixture.js`: disposable SQLite files and fixed loopback PostgreSQL schemas, without importing application configuration.
- `tests/helpers/cohort-local-network.cjs`: external-fetch guard for legacy regression tests.
- `docs/cohort-chat-phase2a.md`: this report and handoff contract.

Previous audit/probe artifacts and unrelated pre-existing mobile/cleanup-script edits are not Phase 2A changes.

## Data and authorization

Students have one nullable `cohort_id`; the active room derives through cohort, room and occupied slot. There is no duplicate writable student room column. The central context requires BIT, an eligible existing student, an active cohort, an active room, and no room revocation. Requested room/code values must match that context. Body identity never chooses the authenticated student.

Cohorts support semesters 1–8 and only MERCURY/VENUS/EARTH/MARS. Explicit admin fixture allocation demonstrates the initial 1/3/5/7 assignment. Advancement changes the cohort semester/version while preserving cohort, room, student assignment and code. No student assignment is recalculated from semester.

The migration leaves historical messages with NULL room IDs and preserves their contents. A quarantined legacy placeholder establishes the future cutover model; this phase does not attach or move historical content. Cohort queries cannot return NULL-room messages.

Additive room tables provide receipts, typing, pins, revocations, heartbeat sessions, realtime memberships, realtime outbox, attachment ownership and durable send-key tombstones. Existing reaction/mention tables inherit room authorization through their parent message. Existing global support tables remain intact for the staged legacy path.

`UNIQUE(chat_group_id, studentId, client_id)` prevents duplicate sends. `chat_send_keys` also remembers identity after individual deletion, so a delayed retry cannot resurrect a deleted message: it gets unavailable. Authorization and target validation precede duplicate lookup. The same client ID from another sender or room has a separate identity.

Message, attachment bytes/ownership, mentions, push intents, send key and realtime intent commit together. An invalid mention, foreign reply or transaction failure commits none of them. Deleted attachments immediately lose their accessible parent; ownership records retain orphan cleanup responsibility until recycle. Pending events about a deleted parent are cancelled.

## Local HTTP contract

All paths below are under `/api/chat`, require existing app authentication and return `Cache-Control: private, no-store`.

- `GET /config`: authoritative chat context.
- `GET /messages`: `{ chatGroupId, messages, recentMessages, readReceipts, typing }`; supports `before`, `since`/`after`, `limit`, `recent`, `q`. `GET /search` uses the same scoped query.
- `GET /groups/:chatGroupId/messages/:messageId`: exact message DTO, only in the authenticated active room.
- `POST /messages`: JSON or multipart with required `clientId`, optional `text`, `replyToId`, `mentions`; multipart file field `attachment`, maximum 25 MiB. Returns `{ data, messageId, duplicate }`. Multipart mentions use a JSON array string.
- `DELETE /messages/:id`: owner or room admin, after parent-room validation.
- `POST /reactions`: `{ messageId, emoji }`, toggle semantics.
- `POST /read`: `{ lastReadMessageId }`, monotonic per-room receipt.
- `GET /members`, `GET /mentions/students?q=...`: arrays containing only current-room members; mention suggestions omit self.
- `GET /pinned`: `{ pinned }`; `POST /pinned/:id` and `DELETE /pinned`: room admin/CR pin management.
- `GET /attachment/:filename`: authorized parent lookup, no raw static upload path; no-store, nosniff and sandbox CSP.
- `POST /typing`: derives identity/room, coalesces within 2 seconds, expires after 4 seconds, writes an expiring realtime intent.
- `POST /heartbeat`: hashes the authenticated session/Bearer credential for session identity; ignores caller identity/device claims. Writes at most once per session per 25 seconds, TTL 75 seconds. Returns `{ onlineIds, total }`, deduplicated by student. Snapshot members include individual expiry times so future clients can expire idle members without Presence writes.
- `GET /realtime-config`: `{ chatGroupId, realtimeEpoch, topic, expiry, token }`; topic is exactly `chat:<immutable-room-UUID>:<epoch>`, credential lifetime 120 seconds. No service-role credentials or client-chosen topic.
- `POST /admin/cohorts`: `{ groupCode, intakeYear, currentSemester, studentIds }`, explicit unassigned BIT roster.
- `POST /admin/groups/:id/advance`: `{ expectedVersion }`; stale/invalid version is 409.
- `POST /admin/groups/:id/graduate`: requires active semester 8.
- `POST /admin/groups/:id/rotate`: optional `{ revokeStudentId }`, increments epoch and invalidates projection.
- `POST /admin/groups/:id/recycle`: `{ requestKey, intakeYear, studentIds }`, begins durable erasure.
- `POST /admin/recycle/:id/finish`: retries external erasure and finalizes replacement allocation.

Foreign/nonexistent message targets return the same 404 message. Unknown chat paths return 404 instead of falling through to legacy handlers. The existing frontend contract is intentionally not assumed compatible; clients migrate in the next phase.

## Publication and provider contracts

Every application mutation writes a durable event intent; it does not publish directly. Each intent has immutable room UUID, epoch and event ID. A caller selecting pending IDs can invoke `publishRealtime(id)`. PostgreSQL workers take the room row lock and then the outbox row lock, reload authoritative state, verify active room/current epoch/expiry/ready projection, call the trusted private transport, and mark sent or retry. Competing workers cannot send the same intent concurrently. This is a worker abstraction, not an installed production scheduler.

The same `SELECT ... FOR UPDATE` room fence is held by application mutations, publisher, push delivery, epoch rotation, graduation and recycle. Recycle takes the reusable slot lock before the room lock; creation takes the slot lock. Publication holds its room lock through provider acceptance, so closure/rotation cannot overtake an accepted publication. PostgreSQL tests observe actual blocked backends via `pg_blocking_pids`, with independent pooled transaction clients. SQLite results establish functional parity only.

Network delivery is at least once. Accepted-but-response-lost retries preserve `eventId`; tests deliver the event twice and apply it once, including after recreating the consumer with persistent storage. The client must atomically persist event ID and state update and reject unrelated room/epoch events during integration. Outbox transactions do not promise exactly-once external delivery or transport ordering.

`deliverPush(id)` holds the room fence, rechecks active recipient membership, immutable room/epoch and existing parent, then uses the existing push processor's device fanout, preference/privacy handling, retries and receipts. The `cohort-chat:` idempotency namespace includes the immutable UUID. Generic legacy workers cannot dispatch these jobs and do not let them occupy the legacy batch limit. No cohort Expo transport is installed by default.

Injected providers in the local fixture:

- `projection.sync(snapshot)`: applies the room UUID, epoch, status and complete student/subject roster; acknowledges the exact snapshot. Missing, failed or mismatched acknowledgements remain closed. A separate committed pending state precedes synchronization so SQL rollback after remote success cannot restore stale readiness.
- `credentials.subject(member)`: stable subject mapping, unique per room; `credentials.issue({ subject, chatGroupId, realtimeEpoch, expiry })`: locally signs a receive-only credential. Fixture credentials are explicitly fake. Production signing/claims and provider config are not installed.
- `realtime.send({ topic, private: true, event, payload })`: trusted receive-only private Broadcast transport, never client Broadcast or Presence. Fixture acceptance/timeouts are simulated; the earlier V2 live local proof remains the transport-policy evidence.
- `push.sendBatch(messages)`: test Expo-compatible transport; absent provider prevents dispatch.
- `attachments.isReferencedElsewhere(tx, filename)`: fail-closed external/shared reference inventory. `attachments.eraseExternal(filename)`: idempotent deletion, succeeds only when external copies are gone. Test fixture uses an explicit shared-reference set; production storage inventory/serialization is not implemented.

Production transport must define bounded request cancellation/acceptance reconciliation: a provider that rejects a timeout but later performs a new acceptance after releasing the room fence is outside this fixture's proven contract. That distributed failure case remains a production blocker, alongside scheduler/monitoring and projection reconciliation.

## Recycle behavior

Graduation closes the room, disables projected memberships locally and cancels pending room push/realtime work. Recycle requires closed semester-8 graduated state and serializes the slot plus immutable old room. Its first transaction records a durable job/file inventory, makes access unavailable and removes room-owned messages, reaction/mention children, send identities, receipts, typing, pins, sessions, memberships, revocations, push jobs/receipts and realtime work.

Finalization checks all attachment references and requires idempotent external erasure. Shared files survive. On failure, the old room stays inaccessible, the code remains occupied and no replacement exists. On success, the room becomes a recycled tombstone; the slot release, new cohort and new UUID room are committed atomically. Completed retries return the same replacement. Old students retain the graduated cohort assignment; incoming students must be an explicit eligible unassigned roster. Old room/topic identities are never reused.

## Validation evidence

The completed focused run passed **69 tests, 0 failures, 0 skipped**. It includes 28 current-phase tests: 6 shared behavior tests per engine, 15 PostgreSQL race cases and 1 real-app authentication test, plus prior probe guards/audit tests and relevant legacy chat/push/routine regression checks.

Covered races: send/reaction/mention/attachment versus close in both lock orders; publisher versus rotate and graduate in both orders; competing publishers; stale push/realtime retry versus recycle; duplicate/concurrent begin/finalize; push acceptance versus graduate/recycle. Covered failures: migration and application rollback, projection missing/failure/epoch or roster mismatch, SQL failure after remote projection acknowledgement, ambiguous Broadcast acceptance, external erasure retry. HTTP IDOR checks assert an unchanged snapshot of all mutation tables after each denied request.

`mobile/node_modules/.bin/tsc --noEmit` passed. No mobile source was changed in this phase. `git diff --check` passed.

One additional legacy suite, `tests/push-events.test.js`, has an existing official-notice assertion failure at line 481 (two rows instead of one). It reproduces using the unchanged HEAD versions of all three modified pre-existing backend files. Its query filters recipient and numeric event ID without event type, allowing different event namespaces to collide. This unrelated failure was left unchanged and is excluded from the 69-pass run; Node reports the assertion plus its parent as two failures (5 passed, 2 failed in the baseline suite).

To reproduce using the disposable official PostgreSQL 17 Docker image:

```sh
docker run --detach --name cohort-phase2a-postgres --publish 127.0.0.1:55442:5432 --env POSTGRES_PASSWORD=cohort-local-fixture --env POSTGRES_DB=cohort_fixture postgres:17
COHORT_TEST_POSTGRES=1 NODE_ENV=test DB_PATH=:memory: node --require ./tests/helpers/cohort-local-network.cjs --test --test-concurrency=1 tests/cohort-chat-auth.test.js tests/cohort-chat-backend.test.js tests/cohort-chat-concurrency.test.js tests/cohort-chat-audit.test.js tests/cohort-realtime-probe.test.js tests/cohort-realtime-v2-proof.test.js tests/push-notifications.test.js tests/push-retry-resilience.test.js tests/push-immediate-dispatch.test.js tests/push-api.test.js tests/group-chat-history.test.js tests/routine.test.js
docker rm --force cohort-phase2a-postgres
```

The PostgreSQL fixture has a fixed loopback address, synthetic credentials and a random disposable schema per test. It never uses `DATABASE_URL` or imports `.env`. Enabling PostgreSQL tests requires a reachable fixture: connection failure fails the test, never silently skips it. Without the flag, only SQLite functional tests run. The task's disposable PostgreSQL container was removed after verification.

## Handoff

READY_FOR_MOBILE_WEB_INTEGRATION = YES (local/test backend contract).

READY_FOR_PRODUCTION_MIGRATION = NO.

Next-phase work: room-aware mobile/web caches, API migration, private receive-only subscription and persistent event dedupe. Production prerequisites still include actual credential/projection/transport/storage adapters, bounded ambiguous-delivery reconciliation, worker scheduling/monitoring, comprehensive attachment-reference synchronization, membership-change hooks on existing account/admin flows, operational migration/rollback rehearsal and an explicitly authorized legacy cutover. The unrelated notice-suite failure also remains open.
