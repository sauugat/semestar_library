# Rotating cohort chat — audit and migration decision

Audit date: 2026-10-04. Scope: repository source and **read-only local `database.db`**, not production Neon or the deployed Supabase configuration.

**Stopped at the historical ownership gate specified in the request.** No room migration, history split, deletion, runtime change, deploy, commit, push, OTA, or APK build was performed. The implementation in this change is a read-only audit utility and its tests. The architecture below is proposed, not implemented or certified by the passing tests.

## CURRENT_SINGLE_CHAT_ARCHITECTURE

- `db.js:380`: `chat_messages` identifies sender, text, attachments, reply target and time, but has no room/cohort. Reactions and mentions reference message IDs. Read receipts and typing are keyed only by student. `chat_pinned` uses a global singleton (`id = 1`). Local legacy message rows also contain inline pinned/reactions fields; deletion must cover both representations.
- `server.js:3412`: history, older/newer pagination and the recent-message reconciliation window are global. Reply joins and receipt/typing queries are also global. Reaction/reply target validation establishes existence, not membership.
- `server.js:3503`: member/mention eligibility includes BIT and CSIT, excluding blocked/banned/suspended roles. This predicate is not universal room authorization. `requireLogin` alone protects many read routes.
- `server.js:54`, `mobile/services/chat-realtime.ts:91`, `public/chat.html:1009`: shared Supabase **broadcast**, with presence, on `public:chat_messages`. This is not evidence of a Supabase database replication subscription or a deployed private-channel policy.
- `lib/push-notifications.js:1095`: normal pushes target all eligible students except the sender. Mentioned messages currently send targeted pushes only to mentioned students. Durable outbox rows carry message identifiers and global `groupId: bit`/`groupKey: chat_group_bit`; receipt tickets and device/preferences tables support delivery.
- `server.js:4047`: attachment access requires login and an existing message with the filename, but no room. Bytes persist in shared `file_blobs`, with a local/ephemeral upload copy. Responses use `private, max-age=86400`.
- `mobile/app/(tabs)/chat.tsx:410`: notification jumps use cached messages or a history page ending at `targetMessageId + 1`; there is no dedicated exact-message GET route. Mobile search filters loaded messages (`chat.tsx:241`), so it is not full-history server search.
- `mobile/services/chat-db.ts:27`: cache scope is server + account, without room. `public/chat-cache.js` uses an account key in origin-local storage. Image viewers additionally cache attachment bytes; pending file copies use `chat-outbox/`.
- `server.js:3781`: send retry deduplication uses a process-global `clientId` key. The replacement must include authenticated student + immutable room ID and validate access **before** returning cached responses.

Local evidence: 161 students, 27 messages, 7 mention rows, 86 shared blobs, 12,208 outbox rows across event types. No cohort/membership tables or historical cohort columns were found. These numbers are **not production counts**. The snapshot lacks some fields added by current application initialization, so production schema drift must be audited independently.

## PROPOSED_COHORT_MODEL

Add `cohorts(id, intake_year, group_code, current_semester, status, created_at, graduated_at)`. Restrict codes to MERCURY/VENUS/EARTH/MARS; semester to 1–8; status to active/graduated. Intake year comes from the verified intake roster, never an inference from account creation or student-number prefixes. Retain graduated cohort identity for academic records.

Add nullable `students.cohort_id` referencing cohorts during staging. Derive the student's active room through that FK. Do not duplicate a writable `students.chat_group_id`: it can disagree with cohort membership. Expose a derived `chatGroupId` in the authenticated chat configuration instead. Later enrollment/transfer operations require explicit, audited authorization; changing `students.semester` cannot rewrite membership.

## PROPOSED_CHAT_GROUP_MODEL

Add `chat_groups(id, cohort_id, status, created_at, closed_at, recycled_at)`, with immutable generated UUID ID and unique cohort FK. Derive group code from the cohort to avoid two mutable copies. Include both code and ID in API responses; only the ID is a security boundary.

Keep four permanent `chat_group_slots(group_code PRIMARY KEY, current_chat_group_id UNIQUE)` rows. They serialize allocation/recycling per code, including retries/concurrent admins. A graduated group's slot remains occupied until explicit recycle succeeds. A recycled room becomes a content-free tombstone; its ID is never reused. A legacy quarantine room, if selected, is separate from these four slots and has no code.

## CURRENT_TO_NEW_SCHEMA_MIGRATION

Proposed staged change, **not executable/applied in this patch**:

1. Obtain a verified roster, production schema inventory and the history-policy decision below. Test on a sanitized local clone and isolated PostgreSQL with no production credentials. Retain a controlled pre-cutover recovery snapshot; define retention so later recycle deletion is not undone by backups.
2. Add cohort, room and slot tables, and nullable `students.cohort_id`/`chat_messages.chat_group_id`. Preserve existing message IDs and all legacy data. Null room IDs must be inaccessible through future cohort APIs; never treat null as a default room.
3. Change read receipts and typing to composite keys `(chat_group_id, studentId)`; change the pin singleton to one row per room. Add `(chat_group_id, id)` history index and unique `(chat_group_id, id)` for composite reply constraints. Scope message reply FK to `(chat_group_id, replyToId)`. Reactions/mentions may retain their existing message FK and derive room through the message; authorization must join that parent.
4. Add explicit nullable room/message references to chat notification/outbox rows (non-chat rows remain unchanged), durable attachment erasure jobs and minimal admin audit records. Add durable send idempotency uniqueness `(chat_group_id, sender_student_id, client_id)`.
5. After policy selection, place legacy history in the separate restricted legacy room or perform the explicitly approved erasure. Do not copy/split it into cohort rooms. Seed four **empty** rooms and assign students only from the reviewed roster. Do not seed intake years from this snapshot.
6. Implement every room authorization, push, realtime, web/mobile cache and deep-link change listed below. During cutover pause legacy writes/dispatch, drain in-flight work, disable the old global broadcast and deny incompatible clients chat access before enabling cohort reads/writes. No mixed period where a legacy global query can read new rooms.
7. Validate constraints, counts, negative access tests and lifecycle failure/concurrency tests before approving any production operation. Only then enforce final non-null constraints on messages, once every retained message has an explicit room. Keep unassigned students denied chat, not silently enrolled.

Use `db.withTransaction` (`db.js:241`) and its passed `tx` for every statement. The older `db.transaction` wrapper does not bind callback queries to its PostgreSQL client and is not suitable. Review the adapter's automatic `RETURNING id` for new tables with composite/text keys; specify a valid `RETURNING` explicitly. SQLite table rebuilds need separate verification from PostgreSQL DDL.

## HISTORICAL_MESSAGE_MIGRATION_RISK

**Historical cohort ownership is not recoverable with certainty from the inspected data.** Sender identity, current semester, timestamp, replies and mentions establish who participated in the shared chat; they do not establish a private cohort audience at send time. Even a reliable sender intake does not turn a shared conversation into that sender's cohort conversation. No production data was inspected, so independent provenance may exist elsewhere, but none was established here.

Safe options for the user's decision:

1. **Recommended: quarantine legacy history and start four empty rooms.** Preserve history in a separately restricted archive with no student cohort API, realtime, notification or attachment access. Set an explicit retention/deletion date and administrator access policy. Preserves evidence without guessing or irreversibly deleting it now.
2. **Erase legacy chat and start empty**, only after explicit deletion approval and a settled backup-retention policy. Removes all related chat content and unshared blobs; cannot later restore that content into recycled/new rooms.
3. **Defer cutover while seeking authoritative historical evidence.** If there truly was one shared audience, do not split even after identifying sender intakes. A student-readable legacy archive would require a separate verified historical access roster and is a larger privacy surface than option 1.

No option has been selected or executed. The user's instruction to stop rather than guess is why runtime implementation and executable migration are deferred.

## STUDENT_GROUP_ASSIGNMENT_MODEL

Initial **review candidates only**: BIT Semester 1 → Mercury, 3 → Venus, 5 → Earth, 7 → Mars. Persist the resulting roster once; never evaluate that mapping on login, profile edits or semester advancement.

The local snapshot contains 50 BIT Semester 1 students, 2 BIT Semester 2, 7 BIT Semester 4 and 1 BIT Semester 6. It also contains 100 CSIT students and one mixed-label CSIT/BIT account. Thus 111 of 161 local accounts fall outside the supplied initial mapping. There are no local BIT Semester 3/5/7 rows. This may be a stale snapshot; it is not authority to change the requested production assignment. Require explicit roster treatment for even semesters, repeaters/transfers, CSIT, staff/admin accounts, and missing/ambiguous data. Do not round semester 2 to 1 or auto-enroll CSIT into BIT cohorts.

## GROUP_ROTATION_MODEL

Codes belong to intakes for their whole degree. Advancing Mercury from semester 1 to 2 or 3 preserves cohort and room IDs. Reuse only a slot whose previous cohort completed semester 8 and whose room completed the recycle workflow. MARS → EARTH → VENUS → MERCURY is the expected sequence, not a calendar timer or permission to force-graduate a delayed batch. A new intake gets a new cohort and room ID even when the code is reused.

## GROUP_RECYCLE_AND_ERASURE_MODEL

Proposed `Graduate and Recycle Group` confirmation names the code, old cohort/room, content counts, new intake, and permanent deletion. It requires an admin identity re-read from the database, expected room version and idempotency key. `cr`/teacher permissions for pinning do not imply lifecycle permissions.

1. Graduate only a semester-8 active cohort. Lock its slot/cohort/room, close writes and revoke effective chat access. Every write must acquire a compatible room lock and recheck active membership, preventing sends that race closure.
2. Fence and drain in-flight broadcast/push delivery for that room. Cancel queued/retrying deliveries, prevent receipt handlers from rescheduling canceled work, revoke realtime membership, and stop publishing to the old topic. A room close must participate in the same dispatch coordination; a status check followed by an unguarded network send is insufficient.
3. In a transaction, capture attachment candidates, remove mentions, reactions, receipts, typing, pin records, messages, chat-specific notifications/outbox and associated receipt tickets/retry metadata. Remove payloads containing old text/attachment links, including inline legacy fields and cached send responses. Preserve unrelated events, device tokens and privacy preferences.
4. Delete unshared database blobs in the transaction. For every blob verify references in other rooms, library `files.storedName/previewName`, posts/post_media, avatars/cover images and any other storage consumer found by the reference inventory. Never delete solely by filename prefix. Protect reference checks from concurrent new references. Shared content remains for its other owner, while the old room URL remains denied.
5. Record durable, retryable filesystem/object-storage deletion work. External erasure cannot share a SQL transaction: fail closed with the room inaccessible and slot unavailable while it is pending. Workers recheck references before deleting and purge known server caches/replicas. Retain tombstone and non-content audit outcome.
6. After verified erasure, transactionally create the new cohort and UUID room, switch the locked slot and enroll only its approved new roster. Never change old students to the new cohort, renumber old message IDs, or reopen a tombstone. Retrying the same operation returns the same new room, not an additional cohort.

Backup retention, restore-time tombstone replay and cached/exported copies need an explicit erasure boundary. The application can deny future access immediately; it cannot retract bytes already downloaded by a recipient or a push already accepted by an external provider. Do not promise physical remote-device deletion.

## REALTIME_GROUP_ISOLATION

Use private `chat:<chat_group_id>` channels, with authenticated join/read policies for room membership and server-only message/reaction/pin broadcasts. Do not trust presence metadata as student identity. Include room ID in every event and check it before any client render/cache update. Do not retain the global topic as fallback.

Supabase requires private-channel configuration plus Realtime authorization policies; its permissions are cached for a connection and refreshed at join/token refresh, so channel renaming or updating a membership row alone does not guarantee immediate revocation. See [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization) and [settings](https://supabase.com/docs/guides/realtime/settings).

Architecture issue to resolve in an isolated environment: authoritative memberships live in Neon, while Realtime policy evaluation runs in Supabase. Implement a server-managed membership projection with fail-closed provisioning/revocation and authenticated token identity, or a proven room-scoped credential bridge. Never assume Supabase RLS can directly query Neon. Existing bearer/session auth must map to verified realtime identity. Keep old rooms permanently silent after closure and verify forced disconnect/expiry behavior, including old clients continuing to publish presence. This bridge and revocation behavior are unimplemented release blockers.

## PUSH_GROUP_ISOLATION

Resolve the sender's active room inside the message transaction; enqueue only other eligible members of that room. For mention messages, retain the existing targeted-only semantics unless separately changed. Payload: `{ type: 'chat', chatGroupId, messageId, ... }`; grouping/collapse/idempotency keys include room ID, never just MERCURY or `bit`.

Before dispatch/retry, reauthorize recipient and message against the active room, cancel stale jobs, and coordinate dispatch with recycling as above. Preserve the existing durable outbox, multi-device fan-out, per-device receipt processing, muted chat and lock-screen preview rules, retry/backoff and DeviceNotRegistered cleanup. Old payloads without a verified room are not eligible for new cohort delivery.

## MENTION_GROUP_ISOLATION

Autocomplete joins the sender's authenticated room, including initial `@` suggestions if supported. Parse/deduplicate mentions, then require every target to be an eligible member of that same active room. Reject a real Venus ID submitted by Mercury. Validate before storing attachments and again under the transaction's room/membership lock; invalid input cannot create messages, mention rows or delivery jobs.

## DEEP_LINK_ACCESS_CONTROL

Derive the room from authenticated student → cohort → active room for every operation. A client room/code is only a requested target to validate, never authority. Reject supplied cross-room IDs/codes; standardize wrong-room/missing targets to the same safe unavailable result without revealing existence.

Add an exact-message API authorizing both `chatGroupId` and `messageId`; scope history, before/since/recent windows, search, reply joins, reactions, pin/unpin, deletes, typing and read cursors. A forged cursor must never leak another room's receipt or content. Room permissions apply to admins using student chat endpoints as well; lifecycle privileges are separate.

Notification parsing and foreground/background/cold-start routing must retain both IDs and verify membership **before** looking up local cache or merging a page. Missing room in old notifications fails closed. Display: “This conversation is no longer available.” Preserve profile navigation for accessible messages without using profile access as permission to chat content.

## ATTACHMENT_PRIVACY

Authorize room membership and parent message before reading any blob/local file, even for guessed historical URLs. Audit all alternate download/preview/static paths. The inspected application does not globally expose its chat upload directory as static content; the separate public posts route checks post references. Neither observation substitutes for production storage/CDN verification.

Use an authorized room/message attachment route, `Cache-Control: private, no-store`, and room/account-partitioned app-managed files. Purge legacy HTTP/image/preview caches during migration; headers cannot invalidate bytes already cached for 24 hours by older clients. Do not issue long-lived public or signed URLs bypassing revocation. Prepare uploads only after authorization and clean up orphaned blobs on failed validation/transaction. Recycling deletes unshared durable blobs plus physical copies using the reference/erasure workflow above.

## LOCAL_CACHE_ISOLATION

Scope SQLite, memory, browser cache, attachment/preview paths and pending outbox by server + authenticated account + immutable room ID. Fetch/validate membership before first cache hydration. On invalidation or change: clear visible messages, pins, search, unread state, receipts, typing/presence, reply selection, notification targets and pending sends; cancel in-flight requests and advance a room generation token before installing the new scope.

Late network/broadcast/send completions may not write to the new scope. Legacy account-only cache rows must be removed, never relabeled to a cohort. Failed attachment retries retain their original room and cannot resend into a new room. Clear app-owned old attachment caches and prevent old routes from displaying them. Strict revocation means offline cold starts cannot show chat from an unverified cached membership; remote revocation while a device remains offline cannot be instantly communicated. State this tradeoff explicitly before release.

## ADMIN_LIFECYCLE_OPERATIONS

Advance Semester: authenticated admin, expected semester/version, transaction, one-step 1–8 validation; update academic semester display if needed but preserve cohort/room. Graduate Batch: semester 8 only, close room and revoke effective access. Recycle: separate explicit permanent-erasure confirmation, locked slot, new roster/intake, durable job status and idempotent recovery. All admin mutations need existing session-CSRF protection or authenticated bearer protection as appropriate, fresh server-side admin checks, and non-content audit records. Students cannot enroll, transfer, advance, graduate or recycle themselves by editing profile fields. No admin endpoints/UI were added in this audit phase.

## FILES_CHANGED

- `scripts/audit-cohort-chat.js`: explicit local-file-only read-only SQLite audit; consistent read transaction; schema/count aggregates, tentative initial mapping and blockers. Never imports application config or contacts Neon/Supabase. Exit 2 means review required, exit 1 means audit failure. No write/migrate mode.
- `tests/cohort-chat-audit.test.js`: six temporary-fixture tests for immutable source bytes, privacy of output, incomplete assignment coverage, no invented historical proof, SQL identifier handling, remote/missing-path refusal and CLI behavior.
- `docs/cohort-chat-migration-audit.md`: this report and proposed migration/release criteria.

Reproduce locally: `node scripts/audit-cohort-chat.js database.db`. Exit 2 is expected. Run against a local sanitized snapshot, not a production connection string. Column/count output contains no message bodies, names, student IDs, file bytes, push tokens or secrets.

## TEST_RESULTS

Executed on Node 24.18.0:

- `node --test tests/cohort-chat-audit.test.js tests/chat-cache-regression.test.js tests/mobile-chat-state.test.js tests/mobile-keyboard-architecture.test.js`: **31 passed, 0 failed** (6 new audit checks + 25 existing checks).
- `mobile/node_modules/.bin/tsc --noEmit` from `mobile`: **passed**.
- `EXPO_NO_DOTENV=1 npm run lint` from `mobile`: **failed, 128 errors / 99 warnings**, all in unchanged mobile files; includes `react-hooks/set-state-in-effect`, `react-hooks/refs`, and use-before-declaration diagnostics. No mobile source was edited to suppress them.
- Read-only local snapshot audit: expected **exit 2**, historical ownership **NOT_PROVEN**, production readiness **false**. No application server or schema initializer was run.

**Not implemented/run:** new cohort IDOR integration tests, isolated PostgreSQL migration tests, recycle lifecycle test, actual Supabase authorization tests, device push delivery and foreground/background/killed-app tests. Passing baseline/audit tests does not demonstrate four-room isolation.

Required acceptance matrix after the historical decision:

- Mercury history allowed; Venus history rejected; Earth exact-message target rejected; Mars attachment rejected (including alternate URLs).
- Mercury mention accepted; Venus mention rejected with no message/blob/outbox side effects.
- Forged room, group code, foreign message ID, foreign reaction/reply/pin/delete/read cursor rejected; all pagination/reconciliation/search results and nested reply payloads remain in the authenticated room.
- Four concurrent private realtime clients receive only their room's events; forged publish/join/presence and stale memberships fail closed.
- Push normal/mention recipients and every retry stay in-room; sender excluded; privacy, multiple devices and DeviceNotRegistered behavior remain intact.
- Account/room switching, late async responses, old notifications, cached images and attachment retry cannot render or send old-room content. Keyboard V2, double-tap heart, reactions, uploads, pagination, unread and profile navigation retain baseline behavior on devices.

Required automated recycle fixture: create old semester-8 Mars cohort/students/room; insert messages, attachments (one exclusively owned and one shared), reactions, mentions, receipts, typing, pins and pending/retrying delivery jobs/tickets; graduate; recycle; create new Mars intake. Assert distinct UUID, zero inherited messages/reactions/mentions/receipts/pins, old URLs and deep links rejected, old members denied both rooms, unshared bytes deleted, shared bytes retained only for their other owner, no old push/realtime delivery. Inject rollback, physical-deletion failure/retry, duplicate admin requests, concurrent send/upload/mention/dispatch and two simultaneous recycle attempts. Old access must remain denied and new slot must not activate before erasure completes.

## DATABASE_MIGRATION_REQUIRED

**YES** — proposed above; no executable migration applied or supplied pending history policy and roster verification.

## BACKEND_DEPLOY_REQUIRED

**YES** — eventually, after implementation and isolated integration tests. Nothing deployed.

## MOBILE_FIX

**OTA_COMPATIBLE** for the proposed JavaScript/TypeScript, API-contract and local-cache changes using existing dependencies. No native dependency/config change is currently identified. This is an architecture assessment, not a shipped or device-validated update; runtime/update compatibility must be checked when implementation is ready. No OTA or build performed.

## READY_FOR_PRODUCTION_MIGRATION

**NO.** Select legacy quarantine/erasure/defer policy, verify the actual intake roster (including CSIT/even-semester handling), then implement and prove all access, delivery, deletion and cache boundaries in isolation. Stop here as requested.
