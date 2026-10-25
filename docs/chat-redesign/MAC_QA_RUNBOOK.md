# Semester Library — Mac Local QA Runbook (Cohort Group Chat & Direct Messaging)

This runbook provides the verified commands, credentials, paths, ports, endpoints, and behavioral expectations for testing Cohort Group Chat and One-to-One Direct Messaging (DMs) locally on your Mac on branch `fix/chat-c2`.

Every claim in this runbook is explicitly labeled:
- **[VERIFIED BY RUNNING]**: Executed in an isolated `env -i` QA process against a disposable SQLite database and confirmed from runtime output.
- **[READ FROM CODE]**: Inspected directly in the source files (`scripts/qa-server.js`, `scripts/seed-qa.js`, `server.js`, `lib/dm-service.js`, `lib/cohort-chat.js`, `public/dm-chat-client.js`, `public/cohort-chat-client.js`, `mobile/services/*`).

---

## (a) Pre-Flight Safety Check (Hostnames Only — Never Prints Secrets)

Run this one-liner from `/Users/sauu_gat/semester-library` before starting QA. It verifies that `env -i` + `QA_MODE=true` passes `assertSafeQaEnvironment()`, confirms `db.js` connects to local SQLite (`isPostgres: false`), and prints **only hostnames** (or `NONE`) for any URL variables—never credentials or tokens **[VERIFIED BY RUNNING]**:

```bash
cd /Users/sauu_gat/semester-library && \
env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" QA_MODE=true NODE_ENV=qa \
node -e '
  const { assertSafeQaEnvironment } = require("./lib/qa-guard");
  assertSafeQaEnvironment();
  const db = require("./db");
  const urlKeys = [
    "DATABASE_URL", "POSTGRES_URL", "DIRECT_URL", "PGHOST",
    "TURSO_DATABASE_URL", "LIBSQL_URL", "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL", "COHORT_SUPABASE_URL", "DM_SUPABASE_URL"
  ];
  const hosts = Object.fromEntries(urlKeys.map(k => {
    const raw = process.env[k];
    if (!raw) return [k, "NONE"];
    try { return [k, new URL(raw).hostname || "LOCAL"]; }
    catch { return [k, "SET_NON_URL"]; }
  }));
  console.log("QA_GUARD_PASSED=true");
  console.log("DB_ENGINE=" + (db.isPostgres ? "postgres" : "sqlite-local"));
  console.log("URL_HOSTS=", JSON.stringify(hosts, null, 2));
'
```

Expected output **[VERIFIED BY RUNNING]**:
- `QA_GUARD_PASSED=true`
- `DB_ENGINE=sqlite-local`
- Every entry in `URL_HOSTS` is `"NONE"`.

---

## (b) Verified Database Path, Port & Status Endpoints

| Setting / Endpoint | Real Value / Status | Verification Status |
| :--- | :--- | :--- |
| **Default QA Database Path** | `/Users/sauu_gat/semester-library/database.qa.db` (`path.join(__dirname, '..', 'database.qa.db')` in `scripts/seed-qa.js` and `scripts/qa-server.js`) | **[VERIFIED BY RUNNING]** & **[READ FROM CODE]** |
| **Default QA Server Host & Port** | `0.0.0.0:3000` (`http://localhost:3000`, overrideable via `PORT=...`) | **[READ FROM CODE]** (`scripts/qa-server.js:97-98`) |
| **`GET /api/qa/status`** | **DOES NOT EXIST** (returns `404`). There is no `/api/qa/*` route anywhere in `server.js` or `routes/`. | **[VERIFIED BY RUNNING]** & **[READ FROM CODE]** |
| **`GET /api/health`** | **EXISTS** (`server.js:907`). Returns `{ status: 'ok', timestamp, uptime }`. | **[READ FROM CODE]** |
| **`GET /api/dm-status`** | **EXISTS** (`server.js:959`). Requires login; returns `{ enabled: true }` for accounts in `DM_TEST_USER_IDS` (`99000001..99000004`) and `{ enabled: false }` for others when `DM_ENABLED=false`. | **[VERIFIED BY RUNNING]** & **[READ FROM CODE]** |
| **`GET /api/chat/health`** | **EXISTS** (`server.js:5110`). Returns `{ status, mode: 'local', cohortChatEnabled: true, providerConfigured: false, ... }`. | **[READ FROM CODE]** |

---

## (c) Seeding the Local QA Database

Run `scripts/seed-qa.js` in a clean environment (`env -i`) so no shell variables from your terminal can leak in. The script runs `db.initSchema()`, `ensureAcademicCohortSchema()`, `ensureTeacherSchema()`, `ensurePostsSchema()`, `ensureAuditSchema()`, `002-cohort-chat.js`, `cohort-chat-support-schema.js`, and `005-direct-messaging-schema.js` idempotently against `/Users/sauu_gat/semester-library/database.qa.db` **[VERIFIED BY RUNNING]**:

```bash
cd /Users/sauu_gat/semester-library && \
env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
  QA_MODE=true \
  NODE_ENV=qa \
  DB_PATH="/Users/sauu_gat/semester-library/database.qa.db" \
  COHORT_CHAT_LOCAL=1 \
  DM_ENABLED=false \
  DM_TEST_USER_IDS="99000001,99000002,99000003,99000004" \
  EXPO_PUSH_DISABLED=true \
  TEACHER_ONBOARDING_ENABLED=false \
  node scripts/seed-qa.js
```

You can re-run this command at any time; all table migrations and account `ON CONFLICT` upserts are idempotent **[VERIFIED BY RUNNING]**.

---

## (d) Starting the QA Server & Opening the Web App Safely

Start `scripts/qa-server.js` on port **`3000`** (`http://localhost:3000`) inside a clean `env -i` environment **[READ FROM CODE]**:

```bash
cd /Users/sauu_gat/semester-library && \
env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
  QA_MODE=true \
  NODE_ENV=qa \
  PORT=3000 \
  DB_PATH="/Users/sauu_gat/semester-library/database.qa.db" \
  COHORT_CHAT_LOCAL=1 \
  DM_ENABLED=false \
  DM_TEST_USER_IDS="99000001,99000002,99000003,99000004" \
  EXPO_PUSH_DISABLED=true \
  TEACHER_ONBOARDING_ENABLED=false \
  node scripts/qa-server.js
```

*(Note: Pass `--reset` to `node scripts/qa-server.js --reset` if you want the launcher to delete and re-seed `database.qa.db` on startup **[READ FROM CODE]**.)*

- **Safe Way to Open the Web App**:
  Open an isolated browser profile or Guest/Incognito window (so cached cookies or `localStorage` on `localhost` do not interfere) and navigate to **[READ FROM CODE]**:
  - Login page: `http://localhost:3000/login.html`
  - Chat & DM page: `http://localhost:3000/chat.html`

---

## (e) Real Seeded QA Login Accounts, Passwords & Cohort Rooms

> **Correction Notice**: Earlier notes/reports mentioned `qa_alice`, `qa_bob`, `qa_charlie` and password `qa-pass-123`. **Those accounts and passwords do NOT exist in `scripts/seed-qa.js` [VERIFIED BY RUNNING].**
>
> Below are the exact synthetic QA accounts and password constants from `QA_PASSWORD_HASHES` in `scripts/seed-qa.js:29-34`, verified by seeding a temporary SQLite database and querying `SELECT studentId, username, name, role, department, semester, cohort_id, account_status, verification_status, supabase_uid FROM students` **[VERIFIED BY RUNNING]**.

### 1. Numeric QA Accounts (Allowlisted in `DM_TEST_USER_IDS` for DM + Cohort Chat Testing) **[VERIFIED BY RUNNING]**

When `DM_ENABLED=false` and `DM_TEST_USER_IDS="99000001,99000002,99000003,99000004"`, `/api/dm-status` returns `{ enabled: true }` for these 4 accounts **[VERIFIED BY RUNNING]**:

| Role | `studentId` | `username` | Display `name` | Synthetic Password (`QA_PASSWORD_HASHES`) | `cohort_id` / Cohort Room | `verification_status` | `supabase_uid` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin** | `99000001` | `qa_admin_num` | `QA Numeric Admin` | `QaAdmin123!` | `null` (Admin accesses active `MERCURY` room `group-qa-mercury`) | `verified` | `null` |
| **Student** | `99000002` | `qa_student_num` | `QA Numeric Student` | `QaStudent123!` | `qa-cohort-mercury` (`group-qa-mercury`, `BIT 2025 Mercury`, Sem 1) | `verified` | `null` |
| **CR** | `99000003` | `qa_cr_num` | `QA Numeric CR` | `QaCr123!` | `qa-cohort-mercury` (`group-qa-mercury`, `BIT 2025 Mercury`, Sem 1) | `verified` | `null` |
| **Teacher** | `99000004` | `qa_teacher_num` | `QA Numeric Teacher` | `QaTeacher123!` | `null` (Faculty / DM access; not assigned to a student cohort) | `verified` | `null` |

### 2. Named QA Accounts (Non-DM Allowlist — Useful to Verify DM Feature Flag Gating) **[VERIFIED BY RUNNING]**

These 4 accounts are also seeded by `scripts/seed-qa.js`, but are **not** in `DM_TEST_USER_IDS`. When `DM_ENABLED=false`, `/api/dm-status` returns `{ enabled: false }` for them while Cohort Chat and portal features remain active **[VERIFIED BY RUNNING]**:

| Role | `studentId` | `username` | Display `name` | Synthetic Password (`QA_PASSWORD_HASHES`) | `cohort_id` / Cohort Room | `verification_status` | `supabase_uid` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin** | `qa_admin` | `qa_admin` | `QA Administrator` | `QaAdmin123!` | `null` (Admin accesses active `MERCURY` room `group-qa-mercury`) | `verified` | `null` |
| **Student** | `qa_student` | `qa_student` | `QA Student` | `QaStudent123!` | `qa-cohort-mercury` (`group-qa-mercury`, `BIT 2025 Mercury`, Sem 1) | `verified` | `null` |
| **CR** | `qa_cr` | `qa_cr` | `QA Class Representative` | `QaCr123!` | `qa-cohort-mercury` (`group-qa-mercury`, `BIT 2025 Mercury`, Sem 1) | `verified` | `null` |
| **Teacher** | `qa_teacher` | `qa_teacher` | `QA Teacher` | `QaTeacher123!` | `null` (Assigned `CS101` & `CS102`) | `verified` | `null` |

*(Note on Seeded Cohort Rooms **[VERIFIED BY RUNNING]**: Migration `002-cohort-chat.js` creates all 4 slot rows (`MERCURY`, `VENUS`, `EARTH`, `MARS`) in `chat_group_slots`, and `scripts/seed-qa.js` seeds one active cohort (`qa-cohort-mercury`, `BIT 2025 Mercury`) and one active cohort chat room (`group-qa-mercury`, mapped to `MERCURY`), while `VENUS`, `EARTH`, and `MARS` have `current_chat_group_id = null` unless additional cohorts are created via `/api/chat/admin/cohorts`.)*

---

## (f) Realtime Behavior in Local QA (When Supabase Is Unset) & What QA Can/Cannot Prove

In QA mode (`QA_MODE=true`), `lib/qa-guard.js` blocks any production Supabase URL and `scripts/qa-server.js` runs with all Supabase environment variables unset (`SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `COHORT_SUPABASE_URL`, `DM_SUPABASE_URL` are all empty). Here is the exact behavior of both chat systems when Supabase is unset:

### 1. Direct Messaging (DM) Realtime Behavior with Supabase Unset
- **Server (`lib/dm-service.js:getRealtimeConfig` & `lib/dm-realtime.js`)** **[VERIFIED BY RUNNING]** & **[READ FROM CODE]**:
  1. Seeded QA users have `supabase_uid: null`. Unless `NODE_ENV=test` or `DM_ALLOW_SYNTHETIC_UID=true` is set, `providers.credentials.subject(caller)` throws `SUPABASE_UID_REQUIRED`, and `GET /api/dm/conversations/:id/realtime-config` returns **HTTP `403`** (`{ message: "Private live updates require both participants to sign in with their verified Supabase accounts.", code: "SUPABASE_UID_REQUIRED" }`) **[VERIFIED BY RUNNING]**.
  2. Even if `DM_ALLOW_SYNTHETIC_UID=true` is set in QA, `providers.projection.sync()` sees no Supabase `origin` or `serviceKey` and throws `REALTIME_PERMISSION_DENIED`, which `getRealtimeConfig` catches and returns as **HTTP `502`** (`{ message: "Realtime authorization synchronization failed. Private live updates are temporarily unavailable.", code: "REALTIME_PERMISSION_DENIED" }`) **[VERIFIED BY RUNNING]**.
- **Web DM Client (`public/dm-chat-client.js:subscribeRealtime`)** **[READ FROM CODE]**:
  - Calls `GET /api/dm/conversations/:id/realtime-config`.
  - When it receives HTTP `403`, `catch (err)` calls `this.updateConnectionStatus(false)` and **stops retrying** (because `[401, 403, 404].includes(err.status)` does not schedule a reconnect timer) **[READ FROM CODE]** (`public/dm-chat-client.js:1765-1772`).
  - If it receives HTTP `502` (or network error), it calls `this.updateConnectionStatus(false)` and retries with exponential backoff (`1s, 2s, 4s, 8s, 16s, 30s` max) **[READ FROM CODE]**.
  - **Fallback on Web DM**: There is **no background `setInterval` polling loop** in `public/dm-chat-client.js`. Instead, `dmClient` catches up via HTTP (`GET /api/dm/conversations/:id/sync` or `GET /api/dm/conversations/:id/messages`) when:
    - The user switches browser tab visibility back to visible (`document.addEventListener('visibilitychange')` -> `this.syncActiveConversation()`) **[READ FROM CODE]** (`public/dm-chat-client.js:132-136`),
    - The browser regains network connectivity (`window.addEventListener('online')` -> `this.syncActiveConversation()`) **[READ FROM CODE]** (`public/dm-chat-client.js:130`),
    - The user clicks the conversation in the sidebar or reloads the page (`this.loadMessages(convId)`) **[READ FROM CODE]**.
  - **What the Web User Sees**: At the top of the active DM thread, `#dmConnBanner` remains visible (`display: flex`) showing `"Connecting to real-time updates..."` and the peer status dot `#dmPeerStatusDot` stays grey (not `.online`). Sending, editing, deleting, blocking, reporting, and reading messages via HTTP work immediately for the acting user, while the other browser window sees new messages/edits/deletions/read-receipts when switching tab focus (`visibilitychange`), clicking the conversation, or refreshing **[READ FROM CODE]**.
- **Mobile DM Client (`mobile/services/dm-realtime.ts` & `mobile/app/dm/[id].tsx`)** **[READ FROM CODE]**:
  - `subscribeDmConversationRealtime` calls `fetchDmRealtimeConfig(conversationId)`. On HTTP `403`, `callbacks.onConnectionChange(false)` is called (`realtimeConnected = false`) and it does not hammer the server with retries **[READ FROM CODE]** (`mobile/services/dm-realtime.ts:96-103`).
  - **Fallback on Mobile DM**: `mobile/app/dm/[id].tsx:427-429` runs a **15-second fallback polling timer** (`setInterval` every `15000ms`) whenever `!connectedNow && AppState.currentState === 'active'`, calling `loadMessages()` (`GET /api/dm/conversations/:id/messages?limit=50`). It also syncs immediately on screen focus and `AppState` foreground resume **[READ FROM CODE]**.

### 2. Cohort Group Chat Realtime Behavior with Supabase Unset
- **Server (`server.js:5150-5153` & `lib/cohort-chat.js:604-619`)** **[VERIFIED BY RUNNING]** & **[READ FROM CODE]**:
  - Because `scripts/qa-server.js` sets `COHORT_CHAT_LOCAL=1`, `server.js` instantiates `createCohortChat(db)` with default empty `providers = {}` (no Supabase projection or JWT credentials provider) **[READ FROM CODE]**.
  - `GET /api/chat/config` succeeds (`200 OK`) and returns the room configuration (`chatGroupId: "group-qa-mercury"`, `realtimeEpoch: 1`, `projectionStatus: "ready"`, `projectionEpoch: 0`) **[VERIFIED BY RUNNING]**.
  - `GET /api/chat/realtime-config` checks `if (ctx.projectionStatus !== 'ready' || ctx.projectionEpoch !== ctx.realtimeEpoch || !providers.credentials?.issue)` and throws **HTTP `503`** (`{ message: "Realtime authorization is not ready." }`) **[VERIFIED BY RUNNING]**.
- **Web Cohort Chat Client (`public/cohort-chat-client.js` & `public/chat.html`)** **[READ FROM CODE]**:
  - `refresh()` calls:
    1. `GET /api/chat/config` (`200 OK`),
    2. `options.onReconcile()` -> `fetchNewMessages()` (`GET /api/chat/messages?chatGroupId=...`), which loads/merges messages, reactions, read receipts, and active typers **[READ FROM CODE]**,
    3. `POST /api/chat/heartbeat` (`200 OK`), which updates the online member list **[READ FROM CODE]**,
    4. `realtime()` -> `GET /api/chat/realtime-config` (`503`), which throws and is caught silently by `try { await realtime(generation); } catch { disconnect(); }` **[READ FROM CODE]** (`public/cohort-chat-client.js:97`).
  - **Fallback on Web Cohort Chat**: In `finally { refreshing = null; arm(); }`, `arm()` schedules the next `refresh()` in **30 seconds** (`30000ms` when `expiry === 0`), and `document.addEventListener('visibilitychange')` triggers `roomClient.setActive(!document.hidden)` -> `refresh()` immediately whenever the user focuses the tab **[READ FROM CODE]** (`public/cohort-chat-client.js:80, 100`, `public/chat.html:2507`).
  - **What the Web User Sees**: No error banner is shown for the `503` realtime-config response. The header `#onlineCountText` updates from the HTTP heartbeat response (e.g., `"1 online"`), and messages/reactions/pins update automatically every 30 seconds or immediately on tab focus / page reload **[READ FROM CODE]**.
- **Mobile Cohort Chat Client (`mobile/hooks/useClassChat.ts` & `mobile/services/chat-realtime.ts`)** **[READ FROM CODE]**:
  - `initChatRealtime()` calls `fetchRealtimeConfig()`, catches the `503` error, sets `isConnected = false`, and backs off (`1s..30s`) **[READ FROM CODE]**.
  - **Fallback on Mobile Cohort Chat**: `useClassChat.ts:346` runs a **30-second fallback polling timer** (`setInterval(() => { void refresh(); void heartbeat(); }, 30000)`) plus immediate `refresh()` on screen focus and `AppState` foreground resume. The header subtitle displays `"Class conversation"` when `isConnected` is `false` and `error` is `null` **[READ FROM CODE]** (`mobile/app/(tabs)/chat.tsx:480-493`).

### 3. Honest Summary: What Local QA Can and Cannot Prove
- **What Local QA CAN Prove**:
  - Fail-closed production guards (`QA_MODE=true` refuses production Neon/Supabase URLs and `NODE_ENV=production`).
  - Idempotent SQLite schema migrations (`002`, support schema, `005`) and synthetic account seeding.
  - Authentication, role permissions, and `DM_TEST_USER_IDS` feature-flag gating (`/api/dm-status`).
  - End-to-end HTTP DM flows: user search, starting/getting a conversation (`conversation.id` + `conversationId`), sending messages with idempotent `clientId`, replying, editing (`message` object + flat fields), deleting (`for_me` and `for_everyone` tombstones), read receipts (`markRead` + `syncConversation`), blocking/unblocking (`isBlocked`/`isBlockedByCaller`/`isBlockedByPeer` UI mapping), and reporting (`harassment`, `spam`, `inappropriate_content`, `other`).
  - Persistent offline DM outbox (`origin::studentId::conversationId`) with **Retry** and **Discard**, plus complete cache/outbox/Kyana cleanup on logout and account switch.
  - Cohort chat HTTP flows: room config, sending messages/attachments, replies, reactions, pinning/unpinning, and member lists.
  - HTTP catch-up sync (`visibilitychange` / tab focus / manual refresh on web; 15s DM and 30s Cohort polling on mobile).
- **What Local QA CANNOT Prove**:
  - **Live Supabase WebSocket broadcast delivery**: Because Supabase is intentionally unset in QA mode, neither Cohort Chat nor DMs open a WebSocket to Supabase (`getRealtimeConfig` returns `503` for Cohort Chat and `403`/`502` for DMs).
  - **Instant sub-second push of messages, edits, deletions, read receipts, or ephemeral typing indicators across two idle browser windows without tab focus/refresh**: On web DM, typing indicators (`POST /api/dm/conversations/:id/typing`) return `{ ok: true, dispatched: false }` because no Supabase broadcast provider is configured, so the peer window will not display live `"Typing..."` over WebSocket in local QA.
  - **Supabase RPC projection sync (`sync_dm_conversation_projection` / `sync_cohort_chat_projection`) and Row-Level Security policies on Supabase**.
  - **Live Expo push notification delivery to physical devices** (`EXPO_PUSH_DISABLED=true` mocks push tickets locally).
  - **PostgreSQL-specific SQL paths** (e.g., `FOR UPDATE SKIP LOCKED` and Postgres advisory locks, which only run against PostgreSQL).

---

## (g) Testing DMs Between Two Accounts Using Two Browser Profiles

Because session cookies and `localStorage` are shared across tabs in the same browser window, use **two separate browser contexts** on your Mac **[READ FROM CODE]**:

1. **Browser Profile A (Numeric Student — `99000002`)**:
   - Open a normal Chrome/Safari window (or run `open -na "Google Chrome" --args --user-data-dir="/tmp/sl-qa-profile-a" "http://localhost:3000/login.html"`).
   - Sign in with username **`qa_student_num`** (or ID `99000002`) and password **`QaStudent123!`** **[VERIFIED BY RUNNING]**.
   - Go to `http://localhost:3000/chat.html` and click the **Direct Messages** tab.
2. **Browser Profile B (Numeric CR — `99000003`)**:
   - Open an Incognito/Private window (or run `open -na "Google Chrome" --args --user-data-dir="/tmp/sl-qa-profile-b" "http://localhost:3000/login.html"`).
   - Sign in with username **`qa_cr_num`** (or ID `99000003`) and password **`QaCr123!`** **[VERIFIED BY RUNNING]**.
   - Go to `http://localhost:3000/chat.html` and click the **Direct Messages** tab.

---

## (h) Step-by-Step QA Verification Checklist

### Direct Messaging (DMs)
- [ ] **Start a New DM**: In Profile A (`qa_student_num`), click **New Message**, search for `qa_cr_num` (or `QA Numeric CR`), and click the result. Confirm the conversation opens immediately without error (`conversation.id` and `conversationId` resolved) **[VERIFIED BY RUNNING]** (in `tests/qa-chat-c2.test.js`).
- [ ] **Send & Reply (with HTTP Catch-Up)**: Send a message from Profile A (`"Hello from Student 99000002"`). In Profile B (`qa_cr_num`), open/select the conversation (or switch tab focus to trigger `syncActiveConversation()`), reply to that message using the **Reply** action, and confirm the quoted reply header renders on both sides once Profile A syncs/refreshes **[READ FROM CODE]**.
- [ ] **Edit Message**: In Profile A, edit your sent message (`"Hello from Student 99000002 (updated)"`). Confirm the text updates in place with the `(edited)` label and never blanks out or turns `undefined` **[VERIFIED BY RUNNING]** (in `tests/dm-client-integration.test.js`).
- [ ] **Delete Message (For Me vs. For Everyone)**:
  - Send two messages from Profile A.
  - Delete the first with **Delete for me**: confirm it disappears in Profile A but remains visible in Profile B after refresh.
  - Delete the second with **Delete for everyone**: confirm both Profile A and Profile B (after tab focus/refresh) show the `"This message was deleted"` tombstone **[READ FROM CODE]**.
- [ ] **Typing Endpoint Check**: Type in Profile A's composer and verify in DevTools Network that `POST /api/dm/conversations/<id>/typing` returns HTTP `200` (`{ ok: true, isTyping: true, dispatched: false }`). *(Note: Profile B will not show live `"Typing..."` in local QA because Supabase Realtime broadcast is disabled **[VERIFIED BY RUNNING]** & **[READ FROM CODE]**.)*
- [ ] **Read Receipts**: Send a message from Profile A (`✓` Sent). Open/view the conversation in Profile B (`POST /api/dm/conversations/<id>/read` returns `200`), then focus/refresh Profile A (`GET /api/dm/conversations/<id>/sync` returns `peerLastReadMessageId`) and confirm the receipt advances to Seen (`✓✓`) **[VERIFIED BY RUNNING]** (in `tests/dm-client-integration.test.js`).
- [ ] **Block & Unblock**:
  - In Profile A, open the header menu (`•••`) and select **Block User**.
  - Confirm the composer hides, the blocked banner appears (`"You have blocked this user. Unblock to send messages."`), and Profile B receives HTTP `403` when attempting to send **[VERIFIED BY RUNNING]** (in `tests/dm-client-integration.test.js`).
  - Click **Unblock** in Profile A and confirm both users can send messages again.
- [ ] **Report Message**: Open the report modal on a peer message, submit each reason (`harassment`, `spam`, `inappropriate_content`, `other`), and verify HTTP `201` success with no `CHECK` constraint error **[VERIFIED BY RUNNING]** (in `tests/dm-client-integration.test.js`).
- [ ] **Offline Outbox, Retry & Discard**:
  - In Profile A DevTools -> **Network** tab, toggle **Offline** (or stop the QA server briefly).
  - Send a message (`"Offline test message"`). Confirm the message is **not deleted**, transitions to **Failed to send**, is stored in `localStorage` under `http://localhost:3000::99000002::<convId>`, and shows **Retry** and **Discard** buttons **[VERIFIED BY RUNNING]** (in `tests/dm-account-isolation.test.js`).
  - Reload the page while still offline or after re-enabling network: confirm the failed message is restored from `localStorage`.
  - Re-enable network and click **Retry**: confirm it sends using the **same `clientId`** and transitions to sent (`✓`).
  - Send another message while offline and click **Discard**: confirm it is removed from the timeline and `localStorage` **[VERIFIED BY RUNNING]**.
- [ ] **Logout & Account Isolation**:
  - Leave an unsent/failed DM message in Profile A (`qa_student_num`), then click **Log Out**.
  - Confirm `localStorage` keys for `http://localhost:3000::99000002::*`, `sl_dm_cache_99000002`, `kyana_chat_sessions_v1`, and `kyana_active_session_id` are removed before redirecting to `/login.html` **[VERIFIED BY RUNNING]** (in `tests/dm-account-isolation.test.js`).
  - Log in as `qa_cr_num` (`99000003`) in that same browser profile and confirm zero messages, drafts, or caches from `99000002` leak.

### Cohort Group Chat (`MERCURY` Room — `group-qa-mercury`)
- [ ] **Open Cohort Chat**: In Profile A (`qa_student_num`) and Profile B (`qa_cr_num`), switch to the **Class Chat** tab (`MERCURY` — `BIT 2025 Mercury`, `chatGroupId: group-qa-mercury`) **[VERIFIED BY RUNNING]**.
- [ ] **Send, Reply & React**: Send a group message from `qa_student_num`, switch focus or wait 30s in Profile B (`qa_cr_num`) to reconcile, reply to it, and toggle emoji reactions (`👍`, `❤️`) on the message **[READ FROM CODE]**.
- [ ] **Pin Announcement (CR / Admin)**: As `qa_cr_num` (CR) or `qa_admin_num` (Admin), pin a message and confirm the pinned banner updates at the top of the room **[READ FROM CODE]**.
- [ ] **Admin Room View**: Sign in as `qa_admin_num` (`99000001` / `QaAdmin123!`) and verify `/api/chat/admin/rooms` lists the seeded active `MERCURY` room (`group-qa-mercury`) and allows admin participation **[VERIFIED BY RUNNING]**.

---

## (i) Running the Mobile App Against the QA Server (Without Editing Any File)

While `scripts/qa-server.js` is running on port `3000` in Terminal 1, open **Terminal 2** and launch Expo Metro by passing environment variables at launch only (no edits to `mobile/.env` or `app.json`) **[READ FROM CODE]**:

```bash
cd /Users/sauu_gat/semester-library/mobile && \
LAN_IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || echo "127.0.0.1") && \
EXPO_PUBLIC_QA_MODE=true \
EXPO_PUBLIC_API_URL="http://${LAN_IP}:3000" \
npx expo start --clear --host lan
```

### Precautions When Testing Mobile Against Local QA **[READ FROM CODE]**
1. **Metro Bundler Cache (`--clear`)**: Expo inlines `EXPO_PUBLIC_*` variables into the JS bundle. Always pass `--clear` when switching between QA and normal dev so Metro does not serve a cached bundle pointing at an old URL.
2. **Stored Server URL Override in `SecureStore`**: In `__DEV__`, `mobile/services/api.ts` checks `SecureStore.getItemAsync('semester_library_server_url')`. When `EXPO_PUBLIC_QA_MODE=true` is set, `isQaMode()` refuses any non-local URL and blocks all outbound requests to `*.vercel.app` and `*.supabase.co`. Logging out or switching server URLs in `AuthContext` clears `SecureStore`, `chat-db`, `dm-db`, and `kyana-db` caches (`clearCachedKyanaMessages()` called with no args).
3. **Fallback Polling in Mobile QA**: Because Supabase Realtime is unset in QA mode, mobile DM polls every **15 seconds** while the conversation screen is focused (`mobile/app/dm/[id].tsx:427-429`), and mobile Cohort Chat polls every **30 seconds** while the room is active (`mobile/hooks/useClassChat.ts:346`).

---

## (j) Stopping Everything and Wiping the QA Database

1. **Stop the QA Server and Metro Bundler**:
   - Press `Ctrl+C` in Terminal 1 (`qa-server.js`) and Terminal 2 (`expo start`).
2. **Wipe the Disposable QA Database & Temporary Browser Profiles** **[READ FROM CODE]**:
   ```bash
   rm -f /Users/sauu_gat/semester-library/database.qa.db \
         /Users/sauu_gat/semester-library/database.qa.db-wal \
         /Users/sauu_gat/semester-library/database.qa.db-shm && \
   rm -rf /tmp/sl-qa-profile-a /tmp/sl-qa-profile-b
   ```
   *(Double-check that you only remove `database.qa.db*` and never `database.db`.)*
