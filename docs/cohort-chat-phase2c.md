# Phase 2C — local end-to-end QA and hardening

Local automated QA completed on 2026-10-05. **Physical Android and real push-delivery QA remain blocked by the absence of a connected device.** This is not completion of the manual-device gate or approval for a student beta.

## Preserved Phase 2C status for Phase 3

```text
PHASE2C_AUTOMATED_QA = PASS
PHASE2C_LIVE_PROVIDER_QA = PASS
PHASE2C_ANDROID_DEVICE_QA = BLOCKED
PHASE2C_REAL_PUSH_LIFECYCLE_QA = BLOCKED
READY_FOR_PRODUCTION_MIGRATION = NO
READY_FOR_LIMITED_STUDENT_BETA = NO
```

These statuses preserve the Phase 2C evidence; later automated Phase 3 results cannot clear either device gate. Source-loaded mobile-service and WebSocket tests are not physical Android evidence. Continue local/staging implementation while retaining the Phase 2C architecture, fixes and regressions, and extend those tests for academic identity changes.

A real Android device must verify every item before production migration or student-beta readiness can become YES:

- Open/send/receive chat; keyboard/composer behavior.
- Image picker; document picker; attachment retry/recovery.
- Reactions; double-tap heart; mentions/profile navigation.
- Search/pagination/scroll; account logout/switch.
- Foreground/background lifecycle; epoch rotation on device; Hardware Back.
- Foreground push; background push; terminated-app push.
- Killed-app auth restoration; exact chat target navigation/highlight.
- Revoked-room notification denial; mixed post/notice/chat notification ordering.

## Workspace and safety

Read the Phase 2B handoff before editing. Phase 2B modules and concurrent Notification Center work were present. Preserved concurrent Notification Center, academic-cohort, library and UI edits; did not revert them. The workspace continued changing during QA, including the cohort header's display name and semester suffix. The browser assertion now checks the assigned cohort name and exact authoritative room identity without prescribing that unrelated suffix.

No production database/provider was contacted by this phase. No production migration, deployment, commit, push, OTA or APK/AAB build was performed. The Phase 2A runtime test-mode gate and absent-provider failure behavior passed the auth regression. A tracked-file scan found no tracked `.env` files or literal service-role JWTs in HEAD; the mobile/public working-source scan found no service-role JWT literals. Public realtime-config was also checked against the actual disposable signing/server secrets. This is evidence about these checks and this session, not a remote audit of other sessions' production activity.

The live fixture reads only an explicitly supplied status JSON file, validates loopback API/database destinations, requires `NODE_ENV=test COHORT_CHAT_LOCAL=1`, requires a clean Realtime policy set and a private-only tenant, and installs one SELECT-only Broadcast policy in an isolated schema. There is no client Broadcast/Presence write policy. Real Supabase Auth creates synthetic users and verifies their access tokens at the fixture HTTP boundary. Real application routes/services, a disposable SQLite authority database, PostgreSQL authorization projection, private REST publication and actual browser WebSockets participate. The existing real-application login/requireLogin path is separately covered by the auth regression.

After verification the disposable Supabase stack was stopped with `supabase stop --no-backup`; no running provider containers remain from this phase.

## Test results and exact commands

All DB-sensitive files within each command run sequentially. Live provider authority uses its own disposable database; legacy suites use in-memory SQLite and block external fetches.

**52/52 passed**, zero skipped:

```sh
NODE_ENV=test COHORT_CHAT_LOCAL=1 DB_PATH=:memory: node \
  --require ./tests/helpers/cohort-local-network.cjs --test --test-concurrency=1 \
  tests/cohort-chat-clients.test.js tests/cohort-chat-browser.test.js \
  tests/cohort-chat-backend.test.js tests/cohort-chat-audit.test.js \
  tests/cohort-chat-auth.test.js tests/chat-cache-regression.test.js \
  tests/mobile-chat-state.test.js tests/mobile-keyboard-architecture.test.js \
  tests/cohort-chat-notifications.test.js tests/cohort-web-auth.test.js
```

**36/36 passed**, zero skipped, including Notification Center, legacy push and mobile notification regressions:

```sh
NODE_ENV=test DB_PATH=:memory: COHORT_CHAT_LOCAL=0 node \
  --require ./tests/helpers/cohort-local-network.cjs --test --test-concurrency=1 \
  tests/cohort-chat-notifications.test.js tests/notification-center.test.js \
  tests/push-events.test.js tests/mobile-notifications.test.js
```

**1/1 live integration test passed with 36 named checks**, 168 authenticated fixture requests and 122 trusted publications (including seeded history and intentional replay). The two commands above overlap on the actual-source notification test; do not sum them as distinct tests. The live run took approximately 52 seconds. Its sanitized results are in [cohort-chat-phase2c-evidence.json](cohort-chat-phase2c-evidence.json).

```sh
NODE_ENV=test COHORT_CHAT_LOCAL=1 \
  COHORT_LIVE_STATUS=/tmp/cohort-phase2c/provider-status.json \
  node --test --test-force-exit tests/cohort-chat-live.test.cjs
```

This file requires explicit provider configuration; missing configuration is an error, not a skipped/pass result. `--test-force-exit` bounds remaining SDK retry handles after fixture teardown. The fixture closes its HTTP server, removes synthetic Auth users, drops its own projection schema/policy and closes databases. No service-role/signing material is in the saved evidence.

**TypeScript passed** from the actual mobile directory:

```sh
cd /Users/sauu_gat/semester-library/mobile
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint app/notifications.tsx app/notification-settings.tsx \
  services/notifications.ts --format json \
  --output-file /tmp/cohort-phase2c/lint-changed-final.json
./node_modules/.bin/eslint . --format json \
  --output-file /tmp/cohort-phase2c/lint-final.json
```

Changed mobile files: **0 errors, 0 warnings**. Phase 2C baseline: **130 errors, 120 warnings**. Current whole workspace: **129 errors, 111 warnings**. Phase 2C's Notification Center fix accounts for **−1 error, −8 warnings**; a concurrent library edit accounts for the other removed warning. The repository is not lint-clean. Scoped `git diff --check` and changed JavaScript syntax checks pass. A whole-workspace diff check also observed unrelated whitespace in `public/style.v4.css`; this phase did not edit that file.

## Browser and service QA matrix

- **Two accounts — PASS, live:** m1 and m2 use real local Auth sessions in separate browser contexts. A sends to B and B sends to A over private WebSockets. Sender acknowledgement plus broadcast produces one bubble. Same display names retain distinct student IDs, avatars and profile-link targets.
- **Room isolation — PASS, live plus regression:** Venus sees its own data, never Mercury content. Wrong-room exact messages and attachment HTTP access return 404. Cache and event receipts are partitioned by server/account/immutable room; the same event ID in two rooms does not suppress the second room's event. Stale-room sends/attachment retries and late HTTP/realtime results are rejected in source-loaded tests.
- **Revocation — PASS, live:** revoke m2, rotate projection, wait for its active config refresh. Context becomes unavailable, history disappears and composer disables. Online metadata clears. New realtime-config is denied; an epoch-1 credential cannot join epoch 2. Session reset also clears reply, mentions, search, unread, typing and attachment UI.
- **Account switch — PASS, live browser:** local sign-out immediately clears history in the same tab. Sign in to Venus, reload and validate before hydration; Mercury history does not appear. Sign back in to Mercury with a fresh Auth session and validate again. Mobile account/cache/late-response coverage is automated service-level coverage, not physical-device evidence.
- **Offline privacy — PASS, live browser plus source-loaded mobile:** cold offline browser reload displays no chat history; after online validation, temporary network loss retains authorized history. Explicit authorization denial clears state. Mobile cold-cache denial and validated scope partitioning pass. Chrome's offline error document is not an application cache.
- **Idempotency — PASS:** live file upload is accepted but its HTTP response is deliberately lost. Retry returns the same message ID and both sender/peer retain one message. Mobile stable-ID, acknowledgement/broadcast merge, pending-reopen and stale attachment tests pass. Native background/reopen interaction is still a device gate.
- **Attachments — PASS for automated coverage; native UI PENDING:** real image and document uploads, lost-response retry, cross-room fetch denial and a deliberately delayed download across logout pass. The late download opens/saves no file. SQLite pending references survive module recreation. Native picker completion and upload interaction on hardware are not claimed tested. Browser File objects remain local to the document and require re-selection after reload.
- **Reactions — PASS:** two different users' reactions arrive live; canonical/cache and duplicate reducers, heart toggle, reload/pagination regression checks pass. Physical double-tap interaction remains pending.
- **Mentions — PASS:** room-scoped suggestions, stable selected IDs despite duplicate display names, persisted structured mentions and immutable profile targets pass. The durable mention push intent targets only the intended peer. This is not evidence of actual Expo/device push delivery.
- **Typing — PASS, live:** typing arrives through the trusted provider and expires after the sender stops. Source lifecycle tests check state reset/background behavior. No Presence publication is used.
- **Heartbeat — PASS, automated:** 25-second minimum write cadence, 75-second backend TTL, multiple-device dedupe, background stop and local badge expiry pass. Revocation clears the browser count.
- **Pagination — PASS:** 85 seeded messages support recent and older history while live messages arrive. Existing reconciliation tests cover recent deletion/reaction repair, stable IDs and ordering. Older pages remain available through canonical HTTP.
- **Event dedupe — PASS:** live duplicate publication before/after browser reload gives one message. SQLite apply/receipt atomicity, rollback and module restart pass. Receipt-expiry simulation still produces one logical message. A simulated stale browser storage overwrite is repaired by canonical merge. Two actual same-account tabs receive one canonical message each; localStorage does not provide cross-tab transactional isolation.
- **Realtime provider — PASS, live:** authenticated HTTP config and realtime-config issue short-lived room/epoch credentials; both client implementations explicitly call `setAuth` before private subscribe. An authenticated Venus outsider is denied Mercury Broadcast subscription. Browser instrumentation observes zero application Broadcast/Presence writes. The browser SDK is the installed real SDK, supplied locally to avoid contacting a CDN.
- **Epoch rotation — PASS:** surviving browser automatically discovers epoch 2 within the 30-second refresh policy plus connection time, without restart. Old subscription is discarded; immutable-room history remains. The actual mobile Realtime service obtains fresh config, reconnects and receives epoch-2 content; the hook's automatic periodic/foreground behavior is separately covered by its deterministic lifecycle test. Physical mobile automatic recovery is pending.
- **Exact deep link — PASS:** fresh config precedes exact lookup, target insertion and highlight. The browser regression additionally verifies the highlighted target is within the viewport. Foreign/recycled room targets are denied. Notification Center chat links preserve room/message IDs through the same native route contract.
- **Notification ordering — PASS at source level:** cold authentication handoff, post/notice→chat and chat→notice routing, duplicate tap handling, and cancellation of older delayed navigation pass against the actual notification module. Foreground/background/terminated OS delivery is not simulated as a pass.
- **Notification Center regression — PASS:** persistence, recipient isolation, seen/read/unread, grouping, preferences and push regressions pass after the ID fix. The requested one-error/eight-warning delta is removed.

## Manual Android matrix — blocked, not run

The user offered to connect the existing development-build device. Repeated `adb devices -l` checks returned an empty device list; `adb mdns services` also discovered no device. No APK or emulator substitute was built. Each of the following remains **NOT RUN — device unavailable to this session**:

- Open chat; send; receive; verify sender/avatar/timestamp on hardware.
- Keyboard open/close; multiline composer; Keyboard V2 viewport behavior.
- Document picker; image picker; late picker completion; native pending attachment recovery.
- Mention suggestions/profile navigation; tap reactions; double-tap heart.
- Search; older history; scroll stability; unread badge.
- Background/foreground during send and during epoch rotation.
- Account logout/switch/reopen; cold offline launch on device.
- Hardware Back from normal chat and notification-opened exact message to Home.
- Foreground push, background push and terminated-app push receipt/tap.
- Killed-app authentication restoration, Home baseline, fresh config, exact target scroll/highlight.
- Revoked-room notification denial on hardware.
- Mixed post/notice/chat notification ordering during OS lifecycle transitions.

No real Expo push was sent. Only synthetic durable push intents/fixture dispatch were tested. Native transaction/hook tests and real mobile-service WebSockets do not replace this matrix.

## Defects found and fixes

1. **Notification Center SQLite IDs:** text-key schemas omitted `id` but recipient rows referenced a numeric rowid. This caused foreign-key failures. Inserts now use UUIDs for text keys and preserve compatibility with existing integer-key schemas. PostgreSQL insertion also uses the resolved deep-link values. Concurrent compatibility work in the same service remains intact.
2. **Notification Center lint:** moved loading initiation to the tab interaction and state completion into asynchronous callbacks; removed unused imports/state/destructuring. No broad lint cleanup.
3. **Web sender profile target:** incoming avatars now link by immutable student ID.
4. **Same-tab logout:** browser storage events do not fire in the same document. The chat now observes Auth identity changes and stops immediately on logout/account replacement.
5. **Revoked-room metadata:** clear the header's cohort identity and visible online/member counts alongside history.
6. **Late old-session 401:** the shared web auth helper could redirect a newer account to Login after an old download completed. Refresh/redirect now checks the current credential. A focused test confirms legitimate current-session expiry still redirects.
7. **Notification Center exact targets/order:** chat inbox navigation discarded room/message parameters and could leave an older push route scheduled. It now preserves explicit target fields and supersedes delayed navigation through the shared dispatcher.

Harness fixes are separate from product defects: load the real browser SDK before instrumentation; use a scoped access-token supplier for hostile Node subscription probes; avoid storage access on Chrome's opaque offline error document; sign back in after logout rather than reuse a revoked Auth refresh token; accept the concurrent cohort display-name change in the older browser test.

## Phase 2C files

- `lib/notifications-service.js` — targeted persistence/deep-link corrections within concurrent work.
- `mobile/app/notifications.tsx`, `mobile/app/notification-settings.tsx` — requested lint corrections.
- `mobile/services/notifications.ts` — inbox exact targets and navigation ordering.
- `public/auth.js`, `public/chat.html` — session race, immediate clearing and sender profile target.
- `tests/helpers/cohort-live-provider.cjs`, `tests/cohort-chat-live.test.cjs` — disposable real provider fixture and live integration.
- `tests/cohort-web-auth.test.js` — delayed 401/current expiry regression.
- `tests/cohort-chat-clients.test.js`, `tests/cohort-chat-notifications.test.js`, `tests/cohort-chat-browser.test.js` — receipt expiry/canonical repair, routing order and current header contract.
- `docs/cohort-chat-phase2c.md`, `docs/cohort-chat-phase2c-evidence.json` — handoff and sanitized evidence.

These are Phase 2C edits, not a claim that every current working-tree change belongs to this task. Provider configuration remains outside the repository. Reproduction uses a fresh disposable Supabase CLI project with Auth, Realtime, PostgreSQL, Kong and REST, a private-only tenant and no preexisting `realtime.messages` policies. Never point this fixture at production.

## Remaining gates

Physical Android interaction and foreground/background/killed-app push delivery are still required. Production provider wiring, PostgreSQL deployment verification, operational rollout and full-project lint are not certified by this local run. Concurrent academic-cohort changes need their own scope/review; this phase does not approve their rollout.

READY_FOR_PRODUCTION_MIGRATION = NO

READY_FOR_LIMITED_STUDENT_BETA = NO
