# Cohort chat Phase 1 — stopped at realtime authorization gate

Date: 2026-10-04. **Phase 1 is not complete.** The realtime prerequisite was tested before changing database/API/client behavior, as requested in item 14. The test found a concrete failure of the proposed membership-projection approach for already-connected clients. Work stopped at that explicit gate.

**Accepted policy: LEGACY = QUARANTINE.** The historical-policy decision is settled. Preserve the shared history separately; never split it into cohort rooms; start four empty rooms. The earlier audit's request to choose a history policy is superseded. No historical data has been moved, deleted or quarantined yet; current application behavior is unchanged.

## COHORT_SCHEMA_IMPLEMENTED

**NO.** No application schema migration was added or run before the realtime stop. The probe's synthetic membership tables are not the requested cohort model.

## CHAT_GROUP_SCHEMA_IMPLEMENTED

**NO.** No application room/slot tables or student/message FKs were added. No writable `students.chat_group_id` was introduced.

## INITIAL_ASSIGNMENT_TOOL

**AUDIT ONLY, from the earlier task.** `scripts/audit-cohort-chat.js` reports initial BIT mapping candidates and unresolved students without assigning anyone. A transactional, one-time enrollment tool remains unimplemented. Even semesters, missing/ambiguous data and CSIT handling must remain unassigned for roster review.

## LEGACY_QUARANTINE_IMPLEMENTED

**POLICY ACCEPTED; RUNTIME NOT IMPLEMENTED.** No content was erased. Future cutover must move legacy messages into a room outside the four reusable slots and deny student API, realtime, push, mentions, attachment and deep-link access. The user does not need to choose this policy again.

## ROOM_AUTHORIZATION

**NOT IMPLEMENTED in application endpoints.** Existing authentication supports Supabase JWTs, opaque mobile bearer tokens and browser sessions. Only verified JWT authentication currently yields a Supabase subject; opaque tokens/cookies need a server-mediated realtime identity. The new shared chat-context helper remains outstanding.

## ROOM_IDOR_TESTS

**NOT IMPLEMENTED/RUN.** The realtime probe tests channel membership, not the Mercury/Venus HTTP matrix. No claim of API room isolation is made.

## HISTORY_ISOLATION

**NOT IMPLEMENTED.** Existing history, pagination, recent reconciliation and loaded-message search remain as documented in the previous audit.

## REACTION_REPLY_ISOLATION

**NOT IMPLEMENTED.** Same-room validation and durable send idempotency remain outstanding. Existing global `clientId` retry identity was not changed.

## MENTION_ISOLATION

**NOT IMPLEMENTED.** Room-restricted autocomplete and atomic mention/upload/outbox rejection remain outstanding.

## PUSH_ISOLATION

**NOT IMPLEMENTED.** The existing outbox, privacy settings and device-token handling were left unchanged. No push was sent. Room-aware recipients, grouping keys, payloads and retry-time authorization remain outstanding.

## EXACT_MESSAGE_API

**NOT IMPLEMENTED.** No new group/message lookup route was added.

## ATTACHMENT_ISOLATION

**NOT IMPLEMENTED.** No upload, blob or existing attachment was changed. Parent-message room authorization and `private, no-store` remain outstanding.

## LOCAL_CACHE_PARTITIONING

**NOT IMPLEMENTED.** No mobile/browser cache migration or state reset was changed. Account-only legacy cache must still be discarded before room-aware hydration is introduced.

## REALTIME_PRIVATE_CHANNEL_STATUS

**LIVE LOCAL PROBE: JOIN ISOLATION PASSES; CONNECTED-CLIENT REVOCATION FAILS.**

Existing source observations:

- `mobile/services/chat-realtime.ts:72`: creates its realtime client from URL/public key, without explicitly attaching the authenticated student's JWT; the channel at line 91 is global and not private.
- `public/chat.html:1008`: creates another client from URL/key and joins the same global channel without explicit authenticated student token handoff. Browser auth state was not inspected; any incidental persisted session is not a verified membership bridge.
- `server.js:3407`: config returns URL/key only. `server.js:54` broadcasts globally.
- `lib/auth-middleware.js`: API authentication verifies Supabase JWTs separately from legacy opaque mobile tokens. These are not automatically interchangeable realtime credentials.

A disposable local Supabase stack was created outside the repository. Versions: CLI **2.119.0**, Realtime **v2.140.3**, Postgres image **17.11.0.002**, supabase-js from the installed repository dependency. No configured project or production credential was used.

The probe creates unique synthetic UUID identities, a private UUID topic, backend-only membership/active-room tables, and SELECT/presence INSERT policies on `realtime.messages`. Clients cannot mutate the projection. It explicitly awaits `realtime.setAuth(jwt)` before joining, so the test does not confuse an anonymous-token startup race with membership denial.

Observed results:

- Two authorized members: **SUBSCRIBED**; baseline presence delivery verified.
- A different-room/nonmember identity: **CHANNEL_ERROR** on join.
- After the projection's room is closed and all memberships deleted: a revoked member's **new** join returns **CHANNEL_ERROR**.
- The revoked member's **existing** channel still accepts `track()` with acknowledgement **ok**.
- A second already-connected member **receives the newly published presence marker after closure/revocation**.
- Probe verdict: **BLOCKED_EXISTING_CONNECTION_RETAINS_PRESENCE_ACCESS**.

This is actual network behavior against local Supabase, not a mocked channel or an inference from SQL alone. The synthetic close operation changes the projection directly; it is not an implemented application graduate/recycle operation. The test demonstrates a missing prerequisite, not the full lifecycle matrix.

Supabase documents that channel permissions are cached, refreshed at join/new JWT, and that revocation does not immediately stop an existing connection. This matches the local observation. [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)

## REALTIME_NEON_SUPABASE_BRIDGE

**TEST PROJECTION ONLY; NOT A PROVEN BRIDGE.** The probe supplies the state that a server-managed Neon→Supabase projection would write. It deliberately does not connect to Neon. Even a fully acknowledged projection deletion fails the connected-client presence requirement; adding a synchronization worker alone would not fix it.

The explicit item-14 stop applies: “If secure private-channel authorization cannot be proven with the current architecture: STOP and report this as the blocker.” No new global broadcast fallback was added. The existing runtime global path remains untouched because no migration/cutover was performed.

The next architecture proof must cover either enforceable server-side disconnection/revocation, or server-mediated presence and event delivery that clients cannot bypass. A client-requested unsubscribe/refresh is insufficient against a modified client. Short JWT expiry bounds exposure but does not prove immediate closure. If using a drain-until-expiry transition, define and test exactly when closure/recycle is acknowledged; do not activate a replacement room during that interval. None of these alternatives is claimed implemented or verified here.

## ADVANCE_SEMESTER

**NOT IMPLEMENTED.** Still requires admin authorization, version check and preservation of cohort/room identity.

## GRADUATE_COHORT

**NOT IMPLEMENTED.** Semester-8 enforcement, write fencing and proven realtime revocation remain necessary.

## RECYCLE_WORKFLOW

**NOT IMPLEMENTED.** No erasure jobs, slot reuse or new cohorts were created. The required closed→recycling→erasure verification→recycled tombstone→new UUID workflow remains outstanding.

## RECYCLE_TEST

**NOT IMPLEMENTED/RUN.** The probe's synthetic projection revocation is explicitly not the messages/attachments/reactions/mentions/receipts/typing/pin/outbox recycle fixture.

## CONCURRENCY_TESTS

**APPLICATION LIFECYCLE MATRIX NOT IMPLEMENTED/RUN.** Only the important live-session race was exercised: existing connected members versus room closure/projection removal. Send/upload/mention versus close, push retry, duplicate/concurrent recycle, blob deletion failure and SQL rollback tests remain outstanding.

## WEB_CHAT_STATUS

**UNCHANGED.** No weaker alternative path was introduced. Web cohort integration awaits a proven realtime design and backend implementation.

## MOBILE_CHAT_STATUS

**UNCHANGED.** Keyboard V2 and existing attachment/reaction/pagination/notification code were not edited. No native config, dependency, OTA or build change was made.

## TEST_RESULTS

- Previous audit/cache/chat-state/Keyboard V2 selection: **31 passed, 0 failed**, rerun during this turn.
- New probe destination/config safety tests: **3 passed, 0 failed**. They reject remote API/DB addresses, database URL override options and missing credentials; they do not claim realtime isolation.
- Live disposable Supabase probe: expected **exit 2**, with the blocking revocation verdict above. Exit 2 means not certified, not success. No application server, production schema initializer, real student, attachment or push delivery was involved.
- Unique probe schemas/policies were removed in `finally`; the disposable stack was stopped with `--no-backup`. Downloaded Docker images remain cached. No production resource was accessed or mutated.

To reproduce, initialize a **new disposable local** project with Supabase CLI 2.119.0 outside this repository, start its local stack, and save `supabase status -o json` to a private local file. Run `node scripts/probe-cohort-realtime.cjs --disposable-local-supabase /absolute/path/to/local-status.json`. It accepts only explicit `127.0.0.1` API/database destinations, creates unique synthetic schema/policy names, and cleans those objects afterward. Do not substitute application `.env` values or a forwarded production connection. Stop that disposable project afterward with `supabase stop --no-backup`; never use an existing project for this experiment.

## TYPESCRIPT

**PASS.** `./node_modules/.bin/tsc --noEmit` from `mobile`.

## LINT_BASELINE

`EXPO_NO_DOTENV=1 npm run lint`: **128 errors / 99 warnings**, unchanged from the supplied baseline. No mobile files changed, so this task introduced **0 additional mobile lint errors/warnings**. No broad lint cleanup or suppression was performed. New Node probe/test files were syntax-checked and tested.

## FILES_CHANGED

New in this phase:

- `scripts/probe-cohort-realtime.cjs` — explicit-loopback-only, disposable Supabase authorization experiment; synthetic identities, private channels, backend-managed projection policies and live revocation checks. Never imports application DB/Supabase config. Does not run on application startup or ordinary `npm test`.
- `tests/cohort-realtime-probe.test.js` — three offline config/destination safety tests; no Supabase/network access.
- `docs/cohort-chat-phase1-status.md` — this report.

Carried forward unchanged from the previous turn: `docs/cohort-chat-migration-audit.md`, `scripts/audit-cohort-chat.js`, `tests/cohort-chat-audit.test.js`. They remain uncommitted/untracked along with this phase's additions.

## PRODUCTION_MIGRATION_PLAN

**NO production action authorized or performed.** The settled plan is quarantine, not historical splitting:

1. Prove the realtime identity/revocation design in a disposable local stack, including hostile existing clients and projection failures.
2. Implement additive cohort/room/slot schema, room context, all API scopes, transactional state/idempotency, push fencing and admin lifecycle primitives in local fixtures.
3. Implement web/mobile room-aware config, exact-message routing, cache invalidation and private realtime consistently. Prove the full IDOR/recycle/failure matrix and retain Keyboard V2 behavior.
4. Verify the actual production roster later; leave unexpected/missing/ambiguous semesters unassigned for review. Seed the four cohorts from explicit intake years and the one-time reviewed roster.
5. In a separately authorized cutover, fence/drain old activity, disable global delivery, quarantine old messages and dependent data outside the reusable slots, invalidate legacy caches/notifications, and activate four empty rooms. No deletion of quarantined content without its later retention/deletion decision.

## REMAINING_BLOCKERS

1. **Proven immediate realtime revocation is missing.** The simple private-channel membership projection fails with already-connected presence publishers/subscribers.
2. The Phase 1 application implementation and required security/lifecycle matrix are consequently incomplete; this report must not be used as migration approval.
3. Production roster verification and incompatible-client cutover handling remain future gates. The historical-policy decision itself is no longer a blocker.

## READY_FOR_PRODUCTION_MIGRATION

**NO.** Stopped at the explicitly requested realtime security gate. No deploy, commit/push, OTA, APK build, production Neon access or old-chat erasure.
