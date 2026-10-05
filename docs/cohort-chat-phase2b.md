# Rotating cohort chat — Phase 2B local client integration

Implemented locally, 2026-10-05. Production migration remains forbidden. This work does not install production providers, migrate production data, deploy, publish an OTA, build an APK, or commit/push changes. The workspace also contains concurrent notification-center changes; those are outside this phase.

## Client authority and privacy

Mobile and browser obtain room identity exclusively from authenticated `GET /api/chat/config`. Both validate the returned student, active room/cohort, code and epoch. Headers display the assigned cohort name without internal IDs. HTTP DTOs and realtime envelopes must match the active immutable room. Requested deep-link IDs never choose the room.

Mobile session identity includes server, account and credential. Identity changes, logout and authorization denial invalidate the generation, context, channel and visible state. Room changes invalidate the generation; epoch changes replace the subscription while retaining the same room's authorized history. Async HTTP, realtime, picker, download, search and heartbeat results are guarded before application. Download completion cannot open a file after the session changes. Optimistic reconciliation matches both sender and client ID.

Cold mobile startup and every browser document start require successful membership validation before reading persistent history. A cold offline launch shows no cached messages. After successful validation in the current authenticated lifecycle, temporary network failures may retain that room's visible history. A 401/403 or room-unavailable response clears it. No cache can independently grant membership. Mobile chat re-entry attempts fresh validation before hydration.

## Persistence and delivery

Mobile SQLite v3 partitions messages, event receipts and event metadata by JSON-encoded server/account/immutable room. Legacy account-only tables are discarded, never assigned a cohort. Pending sends preserve their room, client ID, mentions and attachment reference; pending records reopen as failed/retryable. Retry is refused in another room. Transient composer, mention candidates, search, reply, unread, typing and notification-target UI reset with the session generation.

Realtime application is serialized in an exclusive SQLite transaction: check receipt, apply state, persist receipt, then notify UI after commit. Receipts retain at most 2,000 IDs per scope and expire after seven days. Confirmed message cache is capped at 500; pending sends are retained separately from that count. Replay after receipt expiry remains safe through message/sender identity and canonical reconciliation.

The browser uses the existing cache abstraction with a v3 key containing server/account/room. Each localStorage value contains messages, metadata and event IDs together; one `setItem` commits the new value. It retains 500 messages and 2,000 receipts/seven days. Concurrent tabs cannot perform a serialized read-modify-write transaction with localStorage. A tab can overwrite another tab's receipt; message reducers are idempotent and canonical HTTP reconciliation repairs state. If storage is blocked or full, the current session retains memory state/receipts and stops reloading stale disk state. That fallback cannot promise receipt persistence across document restart. Membership is still required before any cache is loaded.

The explicit transport event names match Phase 2A: `new_message`, `delete_message`, `reaction_update`, `typing`, `read_receipt`, `pin_message`, `online_snapshot`. Unknown names, wrong room/epoch and invalid envelopes are ignored. All application mutations use authenticated HTTP. Neither chat client publishes Broadcast or Presence.

## Reconnect, pagination and interaction

Clients request `/api/chat/realtime-config`, attach its short-lived token with `realtime.setAuth`, then subscribe privately to the exact issued room/epoch topic. The local provider may expose public connection `url` and `key`; no production singleton or service-role fallback exists. URLs are restricted to loopback/private LAN for this phase.

Active chat refreshes config every 30 seconds, on foreground, on channel errors (with a five-second guard), and before credential expiry. A surviving member discovers an epoch change without restarting. Background clients disconnect and stop heartbeats. No retiring-topic application event or weaker policy is needed. Refresh/reconnect reconciles canonical message deltas plus a recent window, retaining older pagination where continuous and removing stale recent state. Offline gaps can be filled by older pagination.

Heartbeat writes are separated by at least 25 seconds, normally 30 seconds while active. Backend TTL is 75 seconds. Members include individual expiry; clients deduplicate IDs and expire badges locally without Presence or an extra network request. Typing is sent through HTTP and expires locally.

Gallery/file pickers, attachment cards, pending/failed send presentation, reactions and double-tap heart, mentions/profile links, search, unread behavior and older history remain in the existing UI. Web retries preserve the same client ID after a response is lost. Changing the draft creates a new logical send. Browser File objects remain session-local; a page reload requires selecting a file again. Native pending attachment references persist in the room cache. Keyboard V2 layout primitives were not redesigned.

Notification taps retain immutable room plus message ID through authentication. Fresh config precedes exact lookup; wrong/recycled/closed rooms show “This conversation is no longer available.” Valid results enter the current cache, scroll and highlight. Native chat header/hardware Back returns Home; stack destinations first establish Home and then push. Resetting navigation cancels a previously scheduled post/notice route.

## Files in this phase

- `mobile/services/chat-session.ts`, `chat-events.ts`, `chat.ts`, `chat-db.ts`, `chat-realtime.ts`, `chat-state.ts`: authority, generation guards, HTTP contract, storage, typed receive-only transport and reconciliation.
- `mobile/hooks/useClassChat.ts`, `mobile/app/(tabs)/chat.tsx`, `mobile/components/chat/MentionSuggestions.tsx`: lifecycle, UI integration, scoped async actions and suggestions.
- `mobile/services/api.ts`, `mobile/context/AuthContext.tsx`, `mobile/app/(tabs)/index.tsx`, `mobile/services/notifications.ts`: invalidation, removal of unvalidated prewarming, notification room identity/routing. Other concurrent edits in shared files are outside this phase.
- `public/chat.html`, `public/chat-cache.js`, `public/cohort-chat-client.js`: browser integration and cache/runtime.
- `lib/cohort-chat.js`: heartbeat expiry fields, hydrated mention handles and optional local provider public connection settings.
- `tests/helpers/cohort-client-fixture.js`, `tests/cohort-chat-clients.test.js`, `tests/cohort-chat-browser.test.js`, `tests/cohort-chat-notifications.test.js`: source-loaded mobile tests, real SQLite transactions, hook lifecycle tests and browser integration.
- `tests/chat-cache-regression.test.js`, `tests/mobile-chat-state.test.js`: existing tests migrated to the room contract.
- `tests/push-events.test.js`: separate notice-query cleanup. Filter publisher by `notice` and recipient by `notice`/`post`, so unrelated namespaces cannot collide and a duplicate normal post still fails. Expected count remains one.
- `docs/cohort-chat-phase2b.md`: this handoff.

## Reproduce local checks

From the repository root:

```sh
NODE_ENV=test COHORT_CHAT_LOCAL=1 DB_PATH=:memory: node \
  --require ./tests/helpers/cohort-local-network.cjs --test --test-concurrency=1 \
  tests/cohort-chat-clients.test.js tests/cohort-chat-browser.test.js \
  tests/cohort-chat-backend.test.js tests/cohort-chat-audit.test.js \
  tests/cohort-chat-auth.test.js tests/chat-cache-regression.test.js \
  tests/mobile-chat-state.test.js tests/mobile-keyboard-architecture.test.js \
  tests/cohort-chat-notifications.test.js

NODE_ENV=test COHORT_CHAT_LOCAL=0 DB_PATH=:memory: node \
  --require ./tests/helpers/cohort-local-network.cjs --test --test-concurrency=1 \
  tests/push-events.test.js tests/mobile-notifications.test.js

cd mobile
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint . --format json --output-file /tmp/cohort-phase2b-lint-final.json
```

The legacy push suite must use `COHORT_CHAT_LOCAL=0`: its global-chat fixtures intentionally exercise the legacy router, not an unmigrated cohort backend. The cohort auth test supplies the opt-in backend separately. Tests use disposable SQLite data and synthetic credentials; the preload rejects non-loopback fetches. Browser tests use installed Chrome, block external HTTPS and service workers, and inject an instrumented receive-only Supabase client. They exercise real HTML, Express routes and database behavior, including accepted-upload/response-loss retry, pagination, reaction, mentions, search, reload dedupe, epoch rotation, exact-message viewport/highlight and revocation.

The source-loaded mobile harness uses real SQLite transactions through a Node adapter and deterministic React/AppState/transport stand-ins. It is not a native device or live Supabase wire test. The previously established V2 local Realtime proof supplies transport-policy evidence; this phase does not claim to have repeated it or the PostgreSQL concurrency suite.

## QA boundary

Validation results: 49 selected cohort/client/keyboard checks verified passing. The final cache adjustment was followed by a 15/15 rerun of all affected browser/cache/client tests; the other 34 checks passed in the preceding run. Separate legacy notification regression: 21/21 passing (22/22 when including the new actual-source notification test, already counted in the 49). TypeScript `tsc --noEmit` passes. JavaScript syntax checks and `git diff --check` pass.

Saved pre-phase lint baseline: 130 errors, 112 warnings. Current whole-workspace lint: 130 errors, 120 warnings. Chat phase delta: minus one error, no added warnings; the chat screen has zero errors and the same six existing warnings. Concurrent notification-center screens account for one added error and eight warnings. Full-project lint is therefore not green, and unrelated edits were preserved.

Ready to begin local end-to-end QA with disposable Phase 2A fixtures/providers. Native device interaction, hardware Back, keyboard/picker behavior, killed-app notification delivery and live local Supabase provider wiring remain QA work before wider student testing. Provider defaults continue to fail closed. No production rollout is authorized.

Version-matched APIs were checked against [Expo 57 SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), [FileSystem legacy](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem-legacy/), [Sharing](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/), [Expo Router navigation](https://docs.expo.dev/router/basics/navigation/) and [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).
