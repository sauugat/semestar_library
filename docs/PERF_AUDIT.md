# Semester Library — Comprehensive Performance Audit (`docs/PERF_AUDIT.md`)

> **Audit Scope:** Read-only baseline audit of `/public` pages, Express backend routes (`server.js`, `routes/*.js`, `lib/*.js`), database queries/indexes (`db.js`, `migrations/`), static asset weights, HTTP caching headers, BFCache eligibility, and Vercel + Neon infrastructure configuration.

---

## 1. Pages in `/public` and API Calls Made on Load

There are **49 HTML pages** in `/public` (including `/public/code-lab/*` and `/public/files/syllabus.html`).

### Shared Script Behavior on Load
Almost every page loads `/auth.js?v=3` in `<head>`, which registers a `DOMContentLoaded` listener (`onReady`) that executes:
1. `SemesterAuth.getUserSync()` (reads `sessionStorage.getItem('sl_user_cache')` or `localStorage` `sb-*-auth-token`).
2. `SemesterAuth.getUser()` -> calls `getSession()` (loads `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` dynamically if not in DOM, then fetches `GET /api/auth/config` if `window.SUPABASE_URL` is unset) -> then fetches `GET /api/me` sequentially.
3. `SemesterAuth.initHeader(user)` -> if `user.avatarUrl` is falsy, fires `GET /api/profile` sequentially.
4. Pages calling `SemesterAuth.protectPage()` in `<head>` also run `getSession()` -> `POST /api/auth/sync-session` (fire-and-forget) -> `GET /api/me` -> `initHeader(user)`.

### Per-Page On-Load API Call Inventory

| # | Page (`/public/...`) | Size | On-Load API Calls (Endpoint & Execution Order) | Sequential vs. Parallel |
|---|---|---|---|---|
| 1 | `/index.html` | 92.1 KB | `GET /api/auth/config` -> `GET /api/me` -> (if no avatar) `GET /api/profile` via `auth.js` | **Sequential** (3-step auth chain) |
| 2 | `/dashboard.html` | 230.7 KB | 1. `protectPage()`: `GET /api/auth/config` -> `POST /api/auth/sync-session` + `GET /api/me` -> `GET /api/profile`<br>2. Inline script 1: `GET /api/me` -> `GET /api/profile` -> `AcademicContext.renderBadge()` (`GET /api/academic-context`)<br>3. Inline `loadFeed()`: if `!window.currentUserData`, awaits `GET /api/me` sequentially, then runs `Promise.all([GET /api/files, GET /api/code-lab/assignments, GET /api/posts?limit=20])` | **Mixed (Sequential waterfall then Parallel):** `/api/me` is called up to **3 times** and `/api/profile` up to **2 times** on a cold load; `loadFeed()` waits on `/api/me` before firing the 3 parallel feed requests. |
| 3 | `/library.html` | 244.1 KB | 1. `auth.js`: `GET /api/auth/config` -> `GET /api/me` -> `GET /api/profile`<br>2. Inline `init()`: `Promise.all([GET /syllabus-data.json, GET /api/library/stats, GET /api/files, GET /api/academic-context])` -> if teacher without subjects, sequential `GET /api/teacher/subjects`<br>3. If URL hash selects a subject: `Promise.all([GET /api/library/files?subject=..., GET /api/library/custom-chapters?subject=...&code=...])` | **Parallel** for the 4 main library resources (`Promise.all`), **Sequential** for teacher subject fallback and hash deep-link subject view, plus 200ms artificial `setTimeout` delay (`if (elapsed < 200)`). |
| 4 | `/notices.html` | 7.9 KB | 1. `auth.js`: `GET /api/auth/config` -> `GET /api/me` -> `GET /api/profile`<br>2. `DOMContentLoaded`: `GET /api/posts?type=notice&official=true` | **Parallel** with `auth.js` (`loadOfficialNotices` runs on `DOMContentLoaded`), though `authFetch` awaits token resolution if uncached. |
| 5 | `/routine.html` | 13.1 KB | 1. `auth.js`: `GET /api/auth/config` -> `GET /api/me` -> `GET /api/profile`<br>2. `routine.js` (`initRoutinePage()`): `await AcademicContext.getAcademicContext()` (`GET /api/academic-context`) -> `await loadRoutines()` (`GET /api/routine`) -> `await checkAdminAccess()` (`GET /api/profile`, then if admin `GET /api/routine/admin`) | **Strictly Sequential Waterfall** (4 sequential round-trips in `routine.js`: `/api/academic-context` -> `/api/routine` -> `/api/profile` -> `/api/routine/admin`). |
| 6 | `/syllabus.html` | 36.4 KB | 1. `auth.js`: `GET /api/auth/config` -> `GET /api/me` -> `GET /api/profile`<br>2. Inline `render()`: `GET /syllabus-data.json` | **Parallel** (`loadData()` fetches `/syllabus-data.json` while `SemesterAuth.getUser()` runs). |
| 7 | `/notifications.html` | 27.6 KB | 1. `auth.js`: `GET /api/auth/config` -> `GET /api/me` -> `GET /api/profile`<br>2. Inline IIFE: opens SSE `GET /api/notifications/realtime` + calls `GET /api/notifications?tab=all` -> if `unseenCount > 0`, sequentially calls `POST /api/notifications/seen` | **Sequential** (`/api/notifications?tab=all` -> `POST /api/notifications/seen`), in parallel with SSE connection. |
| 8 | `/chat.html` | 118.4 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. Inline script: `GET /api/me` -> initializes `dmClient.init()` (`GET /api/dm-status` -> `GET /api/dm/conversations?limit=40`) AND `createCohortClient()` (`GET /api/chat/config` -> `GET /api/chat/realtime-config` -> `POST /api/chat/heartbeat` + `GET /api/chat/messages?before=2147483647&limit=40` + `GET /api/chat/members` + `GET /api/chat/pinned`) + `GET /api/profile` + (if staff) `GET /api/chat/admin/rooms` | **Sequential Waterfall:** Everything waits on `fetch('/api/me')`, then `cohort-chat-client.js` sequentially awaits `/api/chat/config` -> `/api/chat/realtime-config` before firing message history, members, and heartbeat; `dm-chat-client.js` sequentially awaits `/api/dm-status` before `/api/dm/conversations?limit=40`. |
| 9 | `/profile.html` | 56.0 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. `loadProfile()`: awaits `GET /api/profile` (or `/api/profile/:id`), then after it resolves fires `loadUserFiles()` (`GET /api/profile/:studentId/files`) and `loadClassmates()` (`GET /api/students/suggested`) in parallel. | **Sequential then Parallel** (`loadUserFiles` and `loadClassmates` wait for `/api/profile` to finish even when `targetStudentId` is known). |
| 10 | `/files.html` | 39.9 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. Inline script: fires `GET /api/me`, `GET /api/profile`, and `Promise.all([GET /syllabus-data.json, GET /api/library/stats, GET /api/files])` | **Parallel** (`Promise.all` for syllabus, stats, files, alongside duplicate `/api/me` and `/api/profile`). |
| 11 | `/attendance.html` | 12.0 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. `DOMContentLoaded`: awaits `SemesterAuth.getUser()` (`/api/me`), then:<br>- **Student:** `StudentAttendance.init()` -> `GET /api/attendance/my-summary`<br>- **Teacher:** `TeacherAttendance.init()` -> awaits `GET /api/attendance/teacher/context`, then `Promise.all([GET /api/attendance/backup/status (-> GET /api/attendance/backup/pending), GET /api/attendance/roster?..., GET /api/attendance/sessions?...])` | **Sequential Waterfall:** Waits for `getUser()`, then teacher flow awaits `/api/attendance/teacher/context` before firing roster, sessions, and backup status; backup status sequentially awaits `/api/attendance/backup/pending`. |
| 12 | `/teacher-dashboard.html` | 60.4 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. `DOMContentLoaded`: awaits `GET /api/teacher/dashboard-init` sequentially, then runs `Promise.all([GET /api/teacher/notes, GET /api/teacher/assignments, GET /api/posts])` | **Sequential then Parallel** (`dashboard-init` blocks `notes`, `assignments`, and `posts`). |
| 13 | `/admin-dashboard.html` | 163.2 KB | 1. `auth.js`: `GET /api/auth/config` -> `GET /api/me`<br>2. `DOMContentLoaded`: `GET /api/admin/overview` | **Parallel** with `auth.js` on load (other tabs fetch `/api/admin/users`, `/api/admin/academics`, `/api/admin/content`, `/api/admin/moderation/*` on tab switch). |
| 14 | `/admin-cohorts.html` | 32.0 KB | 1. `auth.js`: `GET /api/auth/config` -> `GET /api/me`<br>2. `DOMContentLoaded` (`loadData()`): `GET /api/admin/cohorts` -> sequentially `GET /api/admin/unassigned-students` | **Sequential** (`/api/admin/cohorts` then `/api/admin/unassigned-students`). |
| 15 | `/admin-teachers.html` | 66.9 KB | 1. `auth.js`: `GET /api/auth/config` -> `GET /api/me`<br>2. Inline init: awaits `GET /api/me` -> awaits `GET /api/admin/teacher-invites` -> awaits `GET /api/admin/subjects` -> awaits `GET /api/admin/teachers/assignments` | **Strictly Sequential** (4 sequential awaits on startup). |
| 16 | `/create-post.html` | 87.7 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. Inline script: `Promise.all([GET /api/me, GET /api/posts/meta])` -> `AcademicContext.getAcademicContext()` (`GET /api/academic-context`) | **Parallel** (`Promise.all` for `/api/me` and `/api/posts/meta`), then `/api/academic-context`. |
| 17 | `/search.html` | 47.8 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. If `?q=` query param present on load: `GET /api/search?q=...` | **Parallel** with auth hydration if `?q=` is present. |
| 18 | `/chatbot.html` | 21.1 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. `chatbot.js`: `GET /api/ai/conversations` -> if active conversation in `localStorage`, sequentially `GET /api/ai/conversations/:id/messages` | **Sequential** (`/api/ai/conversations` -> `/api/ai/conversations/:id/messages`). |
| 19 | `/compiler.html` | 81.4 KB | `auth.js`: `GET /api/auth/config` -> `GET /api/me` -> `GET /api/profile` | **Sequential** (auth header hydration only). |
| 20 | `/login.html` | 7.8 KB | `auth.js`: `GET /api/auth/config` (if session token exists in `localStorage`, validates `/api/me`) | **Sequential** (none if logged out). |
| 21 | `/register.html` | 32.5 KB | `auth.js`: `GET /api/auth/config` -> if `?code=` or token present, `GET /api/me` | **Sequential** (none if logged out). |
| 22 | `/reset-password.html` | 13.8 KB | `auth.js`: `GET /api/auth/config` | **Sequential** (only when exchanging recovery code). |
| 23 | `/teacher-onboarding.html` | 14.9 KB | `teacher-onboarding.js`: `GET /api/teacher/onboarding/state` -> sequentially `GET /api/teacher/onboarding/subjects` | **Sequential** (2 sequential calls when onboarding token exists). |
| 24 | `/teacher-verify.html` | 8.6 KB | `POST /api/teacher/onboarding/finalize` (when verification session/hash is present) | **Single call** on load. |
| 25 | `/settings.html` | 8.5 KB | `auth.js`: `GET /api/auth/config` -> `GET /api/me` -> `GET /api/profile` | **Sequential** (auth header hydration only). |
| 26 | `/delete-account.html` | 10.5 KB | `auth.js`: `GET /api/auth/config` -> `GET /api/me` | **Sequential** (auth header hydration only). |
| 27 | `/download.html` | 31.1 KB | `auth.js`: `GET /api/auth/config` -> `GET /api/me` | **Sequential** (auth header hydration only). |
| 28 | `/about.html` | 5.8 KB | `auth.js`: `GET /api/auth/config` -> `GET /api/me` | **Sequential** (auth header hydration only). |
| 29 | `/gallery.html` | 60.9 KB | `auth.js`: `GET /api/auth/config` -> `GET /api/me` | **Sequential** (auth header hydration only). |
| 30 | `/portal.html` | 56.4 KB | `auth.js`: `GET /api/auth/config` -> `GET /api/me` | **Sequential** (auth header hydration only). |
| 31 | `/privacy.html` | 17.3 KB | `auth.js`: `GET /api/auth/config` -> `GET /api/me` | **Sequential** (auth header hydration only). |
| 32 | `/termsandconditions.html` | 12,164.8 KB | `auth.js`: `GET /api/auth/config` -> `GET /api/me` | **Sequential** (12.16 MB HTML document!). |
| 33 | `/404.html` | 7.2 KB | `auth.js`: `GET /api/auth/config` -> `GET /api/me` | **Sequential** (auth header hydration only). |
| 34 | `/semester.html` | 2.3 KB | Immediate client redirect (`window.location.replace('/library.html#...')`), plus `auth.js` | **None** (redirects immediately). |
| 35 | `/semesters.html` | 2.2 KB | Immediate client redirect (`window.location.replace('/library.html')`), plus `auth.js` | **None** (redirects immediately). |
| 36 | `/campus-editor.html` | 382.4 KB | None (loads local Three.js scene) | **None** |
| 37 | `/campus-map-debug-view.html` | 93.5 KB | None (static debug canvas) | **None** |
| 38 | `/googlef8be9396b0363a54.html` | 0.1 KB | None (Google Search Console verification file) | **None** |
| 39 | `/files/syllabus.html` | 12.6 KB | None (static printable BIT syllabus page) | **None** |
| 40 | `/code-lab/subjects.html` | 149.5 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. `initPage()`: awaits `SemesterAuth.getUser()` (`/api/me`) -> awaits `GET /api/profile` -> awaits `AcademicContext.getAcademicContext()` (`GET /api/academic-context`) -> awaits `SyllabusHelper.loadSyllabusData()` (`GET /syllabus-data.json`) -> awaits `GET /api/code-lab/subjects` -> awaits `GET /api/code-lab/assignments` | **Strictly Sequential Waterfall** (6 sequential awaits on page load!). |
| 41 | `/code-lab/assignments.html` | 21.8 KB | 1. `initHeaderProfile()`: `SemesterAuth.getUser()` (`/api/me`) or `GET /api/profile`<br>2. `loadAssignments()`: awaits `GET /api/academic-context` -> sequentially awaits `GET /api/code-lab/assignments?subject=...` | **Sequential** (`/api/academic-context` -> `/api/code-lab/assignments`). |
| 42 | `/code-lab/assignment.html` | 116.1 KB | 1. `initHeaderProfile()`: `SemesterAuth.getUser()` (`/api/me`)<br>2. Inline script: `GET /api/code-lab/assignments/:id` -> if staff viewing student, `GET /api/code-lab/questions/:qId/events/:studentId` | **Parallel** (`initHeaderProfile()` and `fetch('/api/code-lab/assignments/' + assignmentId)` start together). |
| 43 | `/code-lab/create.html` | 46.8 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. Inline init: awaits `GET /api/academic-context` -> awaits `GET /syllabus-data.json` -> awaits `GET /api/code-lab/subjects` | **Sequential** (3 sequential awaits). |
| 44 | `/code-lab/my-submissions.html` | 82.4 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. Inline `init()`: awaits `GET /api/me` -> then if staff awaits `GET /api/code-lab/my-assignments`, else awaits `GET /api/code-lab/my-submissions` | **Sequential** (`/api/me` -> `/api/code-lab/my-submissions` or `/my-assignments`). |
| 45 | `/code-lab/submissions.html` | 139.6 KB | 1. `protectPage()`: `GET /api/auth/config` -> `GET /api/me`<br>2. Inline `init()`: awaits `GET /api/me` -> awaits `GET /api/code-lab/assignments` -> if `?id=` present, sequentially awaits `GET /api/code-lab/assignments/:id/submissions` -> then runs `Promise.all` of `GET /api/code-lab/questions/:qId/similarity` for every question | **Sequential** (`/api/me` -> `/api/code-lab/assignments` -> `/submissions` -> similarity fan-out). |
| 46 | `/code-lab/report.html` | 38.5 KB | `ReportGenerator.fetchReportData()`: `Promise.all([GET /api/code-lab/assignments/:id/report/:studentId, GET /api/code-lab/assignments/:id])` (or fallback sequential `/submissions` + `/events/:studentId` + per-question `/similarity`) | **Parallel** on primary path, **Sequential + N+1** on fallback path. |
| 47 | `/code-lab/events.html` | 21.2 KB | `init()`: `GET /api/code-lab/questions/:questionId/events/:studentId` (or `/api/code-lab/assignments/:id/events/:studentId`) | **Single call** (plus `auth.js`). |
| 48 | `/code-lab/timelapse.html` | 22.6 KB | `init()`: `GET /api/code-lab/questions/:questionId/events/:studentId` (or `/api/code-lab/assignments/:id/events/:studentId`) | **Single call** (plus `auth.js`). |
| 49 | `/code-lab/index.html` | 20.8 KB | `auth.js`: `GET /api/auth/config` -> `GET /api/me` | **Sequential** (auth header hydration only). |

---

## 2. Backend Endpoint DB Query Counts, Sequential Execution & N+1 Patterns

### Middleware Overhead on Every Authenticated Request
Before a route handler even runs, Express executes:
1. **Session Middleware (`CustomDbStore.get`)**: If the browser sends a `__gu_session` cookie (which happens on every browser request after login/sync-session), `CustomDbStore.get` executes `SELECT sess FROM session WHERE sid = $1 AND expire >= CURRENT_TIMESTAMP` (**1 sequential DB query**).
2. **Auth Middleware (`lib/auth-middleware.js`)**: If `Authorization: Bearer <jwt>` is present, verifies JWT and executes `SELECT ... FROM students WHERE supabase_uid = ? OR LOWER(email) = ?` (**1 sequential DB query**).
3. **`requireLogin` (`server.js:825`)**: If `req.user` wasn't populated (cookie-only request), executes `SELECT ... FROM students WHERE studentId = ?` (**1 sequential DB query**).

### Endpoint-by-Endpoint DB Query Audit

| Endpoint | Total DB Queries (incl. middleware) | Sequential vs. Parallel | N+1 Patterns & Bottlenecks |
|---|---|---|---|
| `GET /api/me` | **10–11 queries** (1–2 auth + 8–9 in `getStudentProfile`) | **100% Sequential** | `getStudentProfile()` (`server.js:5914`) runs **8 to 9 sequential `await db.get()` queries** one after another: `students` lookup -> `COUNT(*) FROM files` -> `COUNT(*) FROM posts` -> `COUNT(*) FROM post_media` -> `COUNT(*) FROM assignments` -> `COUNT(*) FROM file_likes JOIN files` -> `COUNT(*) FROM follows (followingId)` -> `COUNT(*) FROM follows (followerId)` -> `getTeacherSubjects` (if teacher). None of these `COUNT(*)` queries are parallelized with `Promise.all` or combined! |
| `GET /api/profile` & `GET /api/profile/:studentId` | **10–11 queries** | **100% Sequential** | Calls the exact same `getStudentProfile()` function (`server.js:5914`) with **8–9 sequential queries** (+1 more `follows` check when viewing another student). Worse, `/api/me` and `/api/profile` are both called on the same page load on `dashboard.html`, `chat.html`, `files.html`, and `code-lab/subjects.html`, running **20 sequential DB queries** just to render the user's name and avatar! |
| `GET /api/academic-context` | **3–5 queries** (1–2 auth + 2–3 in `getAcademicContext`) | **Sequential** | `getAcademicContext()` (`lib/academic-context.js:274`) queries `students` (if `cohort_id` is missing on `req.user`), then sequentially queries `cohorts` (`WHERE id = ?` for students, or all `cohorts` + `getTeacherSubjects` + `SELECT DISTINCT s.semester FROM teacher_subjects` sequentially for teachers). Also called redundantly inside `/api/posts`, `/api/files`, `/api/library/files`, `/api/library/stats`, `/api/routine`, and `/api/code-lab/assignments`! |
| `GET /api/posts` (Feed & Notices) | **6–8 queries** (1–2 auth + 1 `req.postUser` + 1–2 `getAcademicContext` + 1 `isModerationSchemaAvailable` + 1 `SELECT posts` + 1 `post_media` + 1 `post_target_semesters`) | **100% Sequential** | 1. `buildSelectPosts()` (`routes/posts.js:180`) runs **3 full-table grouped subqueries** on every request (`(SELECT post_id, COUNT(*) FROM post_likes GROUP BY post_id)`, `(SELECT post_id, COUNT(*) FROM post_comments GROUP BY post_id)`, `(SELECT post_id, COUNT(*) FROM post_submissions GROUP BY post_id)`), scanning the entire `post_likes`, `post_comments`, and `post_submissions` tables instead of filtering to the page's 20 posts!<br>2. `attachMediaToPosts(posts)` and `attachTargetSemestersToPosts(posts)` (`routes/posts.js:717-718`) are awaited **sequentially** instead of in `Promise.all`. |
| `GET /api/files` | **4–6 queries** (1–2 auth + 1–2 `getAcademicContext` + 1 `getTeacherSubjects` + 1 `SELECT files` + 1 `isStudentAdmin`) | **Sequential** context, then `Promise.all` for `files` + `isStudentAdmin` | 1. **No default `LIMIT`** when `req.query.limit` is omitted (`dashboard.html`, `library.html`, `files.html` all call `/api/files` without `limit`), returning all matching rows (**201.5 KB** payload).<br>2. Joins `students.avatarUrl` which contains inline base64 data URLs repeated across every file row.<br>3. Runs 3 correlated subqueries per file (`COUNT(*) FROM file_likes`, `EXISTS(...)`, `COUNT(*) FROM file_comments`). |
| `GET /api/library/files` | **5–6 queries** (1 auth + 1 `isStudentAdmin` + 1–2 `getAcademicContext` + 1 `getTeacherSubjects` + 1 `SELECT files`) | **100% Sequential** | `isStudentAdmin()`, `getAcademicContext()`, `getTeacherSubjects()`, and `db.all(query)` are all awaited **sequentially** (`server.js:4869-4920`). Also lacks a `LIMIT` and repeats inline `students.avatarUrl` on every row (**201.5 KB**). |
| `GET /api/library/stats` | **3–4 queries** (1–2 auth + 1–2 `getAcademicContext` + 1 `GROUP BY semester, subject, chapter`) | **Sequential** | Awaits `getAcademicContext()` then runs `SELECT semester, subject, chapter, COUNT(*) FROM files GROUP BY ...`. |
| `GET /api/library/custom-chapters` | **2–3 queries** | **Sequential** | Awaits `SELECT ... FROM library_custom_chapters` and then **sequentially** awaits `SELECT ... FROM library_chapter_overrides` (`server.js:4618-4636`) instead of `Promise.all`. |
| `GET /api/routine` | **3–4 queries** (1–2 auth + 1–2 `getAcademicContext` + 1 `SELECT * FROM routine`) | **Sequential** | Awaits `getAcademicContext()` then queries `routine`. Sends `Cache-Control: no-store` even for public semester routine queries. |
| `GET /api/notifications` | **4–5 queries** (1–2 auth + 1 `getNotifications` + 1 `getUnseenCount`) | **100% Sequential** | In `routes/notifications.js:35-44`, `getNotifications(db, ...)` and `getUnseenCount(db, userId)` are awaited **sequentially** instead of in `Promise.all`. |
| `GET /api/code-lab/assignments` | **4–5 queries** (1–2 auth + 1–2 `getAcademicContext` + 1 `SELECT assignments` + 1 `isAdmin`) | **100% Sequential** | 1. Awaits `getAcademicContext()`, then `db.all(sql)`, then **sequentially** `await isAdmin(currentStudentId)` (`routes/code-lab/assignments.js:430-493`).<br>2. Selects `a.*` (including full problem `description` text for every assignment in the list).<br>3. References `sub.released = 1` on `submissions` (`L477`), which throws a `500 SQLITE_ERROR: no such column: sub.released` on SQLite because `released` lives on `submission_grades`! |
| `GET /api/code-lab/assignments/:id` | **5–6 queries** (1–2 auth + 1 `SELECT assignment` + 1–2 `getAcademicContext` + 1 `SELECT assignment_questions` + 1 `SELECT submissions` + 1 `isAdmin`) | **100% Sequential** | All 5 queries (`assignment`, `getAcademicContext`, `questions`, `userSubmissions`, `isAdmin`) are executed **sequentially** (`routes/code-lab/assignments.js:618-651`). |
| `GET /api/chat/messages` (Cohort Chat `lib/cohort-chat.js`) | **86 to 166 queries** for a 40-message load! | **100% Sequential + Severe N+1** | **Critical N+1 Query Pattern:** In `lib/cohort-chat.js:244-252`, `service.history()` fetches `rows` (default 40 messages) and loops `for (const row of rows) messages.push(await hydrate(tx, row))`. Each `hydrate()` call (`L174-186`) runs **2 sequential queries**: `SELECT ... FROM chat_reactions WHERE ... AND m.id=?` and `SELECT ... FROM chat_message_mentions WHERE ... AND m.id=?`. When `recent=40` is also passed during polling (`chat.html:1297`), it loops over another 40 rows! Plus `withContext` runs `context()` **twice** (`L160-163`: `initial = await context()`, `await lockRoom()`, `ctx = await context()`). Total: **4 + 2N (or 4N) sequential queries inside a single transaction with `FOR UPDATE` room lock**! |
| `GET /api/chat/messages` (Legacy Fallback `server.js:5134`) | **6–7 queries** | **Partially Parallel** | Batches reactions and mentions with `WHERE messageId IN (...)`, but runs `recentMessages` and `chat_typing` sequentially after `Promise.all([messagesPromise, readReceiptsPromise])`. |
| `GET /api/chat/members` (`server.js:5229`) | **3–4 queries** | **Parallel** (`Promise.all`) | Selects `s.avatarUrl` for all BIT students without excluding huge inline base64 strings, producing a **209.9 KB** JSON response for 45 students! Also runs `SELECT studentId, MAX(createdAt) FROM chat_messages GROUP BY studentId` full-table scan. |
| `GET /api/students/suggested` (`server.js:6675`) | **2–3 queries** | **Single query** after auth | Runs correlated subquery `(SELECT COUNT(*) FROM files WHERE files.uploadedBy = students.studentId) AS filesCount` and `EXISTS(SELECT 1 FROM follows ...)` for every student row, sorting by `filesCount DESC` with `LIMIT 12` (11.73 ms local SQLite scan). Also returns full inline base64 `avatarUrl`. |
| `GET /api/admin/overview` (`routes/admin-dashboard.js:60`) | **12–13 queries** (1–2 auth + 1 `requireAdminRole` + 10 `COUNT(*)` queries) | **Parallel** (`Promise.all` of 10 queries) | Runs 4 separate `SELECT COUNT(*) FROM students WHERE role = ...` queries instead of a single conditional aggregation query, exhausting Neon pool connections (10 simultaneous connections for 1 request). |
| `GET /api/admin/cohorts` (`routes/admin-cohorts.js:77`) | **3–4 queries** | **Sequential** | `requireAdminRole` queries `students` even if `req.user.role === 'admin'`, then `getAllCohortsWithHistory` runs 3 correlated subqueries per cohort. |
| `GET /api/attendance/teacher/context` (`lib/attendance-service.js:1164`) | **4–5 queries** | **100% Sequential** | Sequentially runs `resolveAuthenticatedActor` -> `SELECT ... FROM teacher_subjects JOIN subjects` -> `SELECT ... FROM cohorts`. |
| `GET /api/attendance/roster` (`lib/attendance-service.js:1368`) | **6–7 queries** | **100% Sequential** | Sequentially runs `resolveAuthenticatedActor` -> `subjRow` -> `cohortRow` -> `resolveTeacherProfileForSession` -> `queryCohortEligibleRoster` -> `existingSessionRow` -> `attendance_records`. |
| `GET /api/attendance/my-summary` (`lib/attendance-service.js:2416`) | **4–5 queries** | **100% Sequential** | Sequentially queries student actor -> `cohortRow` -> `subjectsRows` -> `sessionRows` -> `getEligibilityThresholdConfig`. |

---

## 3. Static Assets Loaded Per Page and Their Sizes

### Global Shared Local Assets in `/public`
| Asset | Type | Size (KB / Bytes) | Loaded By |
|---|---|---|---|
| `/style.v4.css` | CSS | **417.8 KB** (427,846 B) | 43 of 49 HTML pages (monolithic unminified stylesheet) |
| `/theme-overrides.css` | CSS | **26.8 KB** (27,447 B) | 41 HTML pages |
| `/home.css` | CSS | **59.4 KB** (60,806 B) | `/index.html`, `/download.html` |
| `/home-motion.css` | CSS | **12.7 KB** (13,054 B) | `/index.html`, `/download.html` |
| `/chatbot.css` | CSS | **43.0 KB** (44,010 B) | `/dashboard.html`, `/library.html`, `/files.html`, `/profile.html`, `/routine.html`, `/syllabus.html`, `/attendance.html`, `/chatbot.html` (loaded even on pages where only the floating button is shown) |
| `/dm-chat.css` | CSS | **23.0 KB** (23,573 B) | `/chat.html` |
| `/group-chat.css` | CSS | **22.3 KB** (22,800 B) | `/chat.html` |
| `/auth-ui.css` | CSS | **20.8 KB** (21,306 B) | `/login.html`, `/register.html`, `/reset-password.html`, `/delete-account.html`, `/teacher-onboarding.html`, `/teacher-verify.html` |
| `/routine-admin.css` | CSS | **10.6 KB** (10,881 B) | `/routine.html` |
| `/auth-modal.css` | CSS | **1.7 KB** (1,780 B) | 26 HTML pages (loaded **twice** on `/library.html`!) |
| `/auth.js` (`/js/auth.js`) | JS | **34.1 KB** (34,908 B) | 45 HTML pages (plus dynamically injects `@supabase/supabase-js@2` ~155 KB from CDN on every page!) |
| `/theme.js` | JS | **11.3 KB** (11,540 B) | 43 HTML pages (render-blocking in `<head>`) |
| `/academic-context.js` | JS | **9.0 KB** (9,242 B) | `/dashboard.html`, `/library.html`, `/routine.html`, `/attendance.html`, `/create-post.html`, `/search.html`, `/code-lab/assignments.html`, `/code-lab/create.html`, `/code-lab/subjects.html` |
| `/chatbot.js` | JS | **66.3 KB** (67,903 B) | `/dashboard.html`, `/library.html`, `/files.html`, `/profile.html`, `/routine.html`, `/syllabus.html`, `/chatbot.html` |
| `/js/teacher-attendance.js` | JS | **81.9 KB** (83,839 B) | `/attendance.html`, `/teacher-dashboard.html` (loaded even for students visiting `/attendance.html`!) |
| `/js/attendance-drive-sync.js` | JS | **65.5 KB** (67,117 B) | `/attendance.html`, `/teacher-dashboard.html` (loaded even for students visiting `/attendance.html`!) |
| `/js/student-attendance.js` | JS | **25.5 KB** (26,070 B) | `/attendance.html` |
| `/dm-chat-client.js` | JS | **63.5 KB** (65,038 B) | `/chat.html` |
| `/cohort-chat-client.js` | JS | **8.7 KB** (8,887 B) | `/chat.html` |
| `/chat-cache.js` | JS | **3.2 KB** (3,305 B) | `/chat.html` |
| `/code-lab/report-generator.js` | JS | **63.4 KB** (64,910 B) | `/code-lab/report.html`, `/code-lab/submissions.html` |
| `/teacher-onboarding.js` | JS | **25.8 KB** (26,409 B) | `/teacher-onboarding.html` |
| `/home.js` | JS | **19.4 KB** (19,916 B) | `/index.html` |
| `/script.js` | JS | **15.8 KB** (16,190 B) | `/login.html` |
| `/markdown.js` | JS | **15.2 KB** (15,573 B) | `/dashboard.html`, `/create-post.html`, `/search.html`, `/teacher-dashboard.html` |
| `/auth-modal.js` | JS | **14.7 KB** (15,071 B) | 25 HTML pages (loaded **twice** on `/library.html`!) |
| `/routine.js` | JS | **11.6 KB** (11,909 B) | `/routine.html` |
| `/syllabus-helper.js` | JS | **6.4 KB** (6,521 B) | `/library.html`, `/files.html`, `/code-lab/create.html`, `/code-lab/subjects.html` |
| `/code-lab/utils.js` | JS | **1.5 KB** (1,575 B) | All `/code-lab/*.html` pages |
| `/syllabus-data.json` | JSON | **221.7 KB** (227,008 B) | `/library.html`, `/syllabus.html`, `/files.html`, `/code-lab/create.html`, `/code-lab/subjects.html` |
| `/vendor/three.min.js` | JS | **589.3 KB** (603,445 B) | `/campus-editor.html` |

### Images, Fonts & Third-Party Libraries Loaded Per Page
- **Large Uncompressed Images in `/public`:**
  - `/copp.png`: **1,856.2 KB** (1.86 MB)
  - `/Mystic.jpg`: **1,360.4 KB** (1.36 MB)
  - `/Portrait.jpg`: **1,350.4 KB** (1.35 MB)
  - `/images/dev-subarna.png`: **714.7 KB** (loaded twice on `/index.html` without `width`/`height` or WebP conversion!)
  - `/images/dev-saugat.png`: **675.7 KB** (loaded twice on `/index.html`!)
  - `/images/dev-sandesh.png`: **562.9 KB** (loaded twice on `/index.html`!)
  - `/images/assignments-hero-banner.png`: **499.5 KB**
  - `/images/kyana-mono-raw.png`: **433.3 KB**
  - `/images/kyana-logo-raw.png`: **360.5 KB**
  - `/images/kyana-logo-crop.png`: **295.5 KB** (used as `<link rel="icon">` on `/chatbot.html` — 295 KB favicon!)
  - `/images/kyana-mono-mark.png`: **295.5 KB**
  - `/jitter_thumbnail.png`: **151.9 KB**
  - `/images/kyana-logo-hero.png`: **71.4 KB**
  - `/logo.jpg`: **44.8 KB** (used as favicon/logo across 24 pages)
  - `/images/kyana-mono-hero.png`: **41.7 KB** (`/chatbot.html`)
  - `/minecraft-404-voxel-ruby.svg`: **21.7 KB** (`/404.html`, `/dashboard.html`, `/library.html`, `/search.html`, `/code-lab/*`)
- **Google Fonts (`fonts.googleapis.com`):**
  - Most pages load **3 to 5 font families** (`Plus Jakarta Sans` weights 300–800, `Outfit` weights 500–800, `Inter` weights 300–800, `Fraunces` weights 500–700, `JetBrains Mono` weights 400–700, `Fira Code` weights 400–700, `Merriweather` weights 300–700) — totaling **12–18 font weight variants (~250–400 KB of WOFF2)** per page with no `<link rel="preload">` for the primary font.
- **Third-Party CDN Libraries:**
  - `@supabase/supabase-js@2` (**~155 KB min / ~48 KB gzip**): Loaded on `/chat.html`, `/library.html`, `/files.html`, and dynamically injected by `/auth.js` on **every page** when `getSession()` runs!
  - `CodeMirror 5.65.16` + 6 modes + 2 addons + `xterm 5.3.0` + `xterm-addon-fit` (**~610 KB unminified/minified across 11 blocking `<script>` and 2 `<link>` tags**): Loaded on `/compiler.html`.
  - `Monaco Editor 0.52.2` (`loader.js` + editor core **~2.4 MB**): Loaded on `/code-lab/assignment.html` and `/code-lab/index.html`.
  - `PrismJS 1.29.0` + 5 to 10 language grammars (**~95 KB across 6–11 `<script>` tags**): Loaded on `/chatbot.html`, `/code-lab/my-submissions.html`, `/code-lab/report.html`, `/code-lab/submissions.html`, `/code-lab/timelapse.html`.
  - `KaTeX 0.16.11` (`katex.min.js` + `auto-render.min.js` + `katex.min.css` **~310 KB**): Loaded synchronously on `/chatbot.html`.
  - `Marked 12.0.2` + `DOMPurify 3.1.6` (**~62 KB**): Loaded on `/chatbot.html` (`marked` also on `/code-lab/assignment.html`).
  - `Chart.js 4.4.4` (**~205 KB**) + `html2pdf.js 0.10.1` (**~900 KB**) + `JSZip 3.10.1` (**~95 KB**): Loaded synchronously in `<head>` on `/code-lab/submissions.html` and `/code-lab/report.html` even before the user clicks "Generate PDF Report" or "Download ZIP"!
  - `Google AdSense` (`adsbygoogle.js` **~140 KB**): Loaded on `/index.html` and `/chatbot.html`.

---

## 4. Response Headers Currently Sent (HTML, Static Assets, API GETs)

### `vercel.json` Configuration
```json
{
  "version": 2,
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/api/index.js"
    }
  ],
  "crons": [...]
}
```
- **Critical Finding in `vercel.json`:** Because `/(.*)` rewrites **every request** (including HTML, CSS, JS, images, and `/syllabus-data.json`) to `/api/index.js` (the Express serverless function) and there are **no `headers` rules** in `vercel.json`, every asset request invokes the Express serverless function unless cached by the browser!

### Express Static & Route Header Configuration (`server.js`)
1. **HTML Pages:**
   - Served via `res.sendFile(...)` or `express.static(path.join(__dirname, 'public'))` with default Express `send` options:
     - `Cache-Control: public, max-age=0`
     - `ETag: W/"..."` (weak ETag based on mtime + size)
     - `Last-Modified: ...`
     - **Exception:** `/register` (`/register.html`) explicitly sets `Cache-Control: no-cache, no-store, must-revalidate` (`server.js:746`), which blocks bfcache on `/register.html`.
     - **Note on compression:** `compression` middleware (gzip/brotli) is **not configured** in `server.js`!
2. **Static Assets (CSS, JS, Fonts, Images, JSON):**
   - `express.static(path.join(__dirname, 'public'))` (`server.js:804`) does **not** set `maxAge` or `immutable`! Every CSS (`style.v4.css` 417.8 KB), JS (`chatbot.js` 66.3 KB, `teacher-attendance.js` 81.9 KB), image (`dev-*.png` ~2 MB), and `/syllabus-data.json` (221.7 KB) is sent with:
     - `Cache-Control: public, max-age=0`
     - `ETag: W/"..."`
     - This forces the browser to make a conditional network round-trip (`If-None-Match` -> `304 Not Modified`) to the Express serverless function on **every repeat page load**!
   - **Explicit `no-store` overrides on static JS:**
     - `GET /auth.js` and `GET /js/auth.js` (`server.js:794`): `Cache-Control: no-cache, no-store, must-revalidate` (forces full 34.1 KB download on every single page navigation!).
     - `GET /academic-context.js` (`server.js:799`): `Cache-Control: no-cache, no-store, must-revalidate` (forces full 9.0 KB download on every page navigation!).
   - **Avatars & Covers:**
     - `GET /api/avatar/:filename` (`server.js:6331`) and `GET /api/cover/:filename` (`server.js:6485`): `Cache-Control: public, max-age=86400` (1 day).
3. **API GET Endpoints:**
   - **Endpoints sending `Cache-Control: no-store` (or `private, no-store`):**
     - `GET /api/posts` (including public official notices `GET /api/posts?type=notice&official=true`!) (`routes/posts.js:719`)
     - `GET /api/posts/:id` (`routes/posts.js:1251`)
     - `GET /api/posts/:id/comments` (`routes/posts.js:1411`) & replies (`L1447`, `routes/comments.js:33`)
     - `GET /api/routine` (`routes/routine.js:36, 50`)
     - `GET /api/notifications` (`routes/notifications.js:46`)
     - `GET /api/chat/*` (`routes/cohort-chat.js:12`, `server.js:5221`)
     - `GET /api/dm/*` (`routes/direct-messaging.js:15`)
     - `GET /api/attendance/backup/runs/:runId/artifacts` (`routes/attendance.js:490, 544`)
   - **Endpoints sending NO `Cache-Control` header at all (defaults to none / `ETag` only via `res.json`):**
     - `GET /api/me`, `GET /api/profile`, `GET /api/academic-context`, `GET /api/files`, `GET /api/library/files`, `GET /api/library/stats`, `GET /api/library/subjects`, `GET /api/library/custom-chapters`, `GET /api/search`, `GET /api/students/suggested`, `GET /api/code-lab/assignments`, `GET /api/code-lab/subjects`, `GET /api/admin/*`, `GET /api/teacher/*`, `GET /api/attendance/*`.
   - **`Server-Timing` Header:**
     - Currently (`lib/request-timing.js:14`), `messagingTiming` has `if (!/^\/api\/(dm(?:\/|-status)|chat(?:\/|$))/.test(req.path)) return next();` — so `Server-Timing` is **only sent on `/api/chat` and `/api/dm`**, and is completely missing from all other API endpoints!

---

## 5. Back/Forward Cache (BFCache) Blockers (`unload`/`beforeunload` & `Cache-Control: no-store` on HTML)

1. **`beforeunload` Listeners in `/public`:**
   - **`/public/js/teacher-attendance.js` (line 1209):**
     ```js
     window.addEventListener('beforeunload', (e) => {
       if (hasUnsavedChanges()) {
         e.preventDefault();
         e.returnValue = '';
       }
     });
     ```
     - **Impact:** Unconditionally registers a `beforeunload` listener as soon as `teacher-attendance.js` is parsed on `/attendance.html` and `/teacher-dashboard.html` (even when `hasUnsavedChanges()` is `false`, and even for students visiting `/attendance.html`!). Unconditional `beforeunload` listeners disqualify pages from bfcache in Chromium/WebKit or penalize restoration. It should only be attached dynamically while `hasUnsavedChanges()` is true (or replaced with `pagehide`).
   - **`/public/code-lab/assignment.html` (line 1587):**
     ```js
     window.addEventListener('beforeunload', flushAllEvents);
     ```
     - **Impact:** Uses `beforeunload` + `fetch('/api/code-lab/events')` (without `keepalive: true` or `navigator.sendBeacon`) to flush keystroke telemetry events on page leave. This blocks bfcache on `/code-lab/assignment.html` and should use `pagehide` / `visibilitychange` with `keepalive: true`.
2. **`Cache-Control: no-store` on HTML Pages:**
   - **`server.js:745-747` (`GET /register` and `GET /register.html`):**
     ```js
     app.get(['/register', '/register.html'], (req, res) => {
       res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
       res.sendFile(path.join(__dirname, 'public', 'register.html'));
     });
     ```
     - **Impact:** Sends `Cache-Control: no-store` on `/register.html`, which directly blocks browser bfcache restoration.
   - **`server.js:534` (`PROTECTED_PAGES` middleware):**
     - Contains `res.setHeader('Cache-Control', 'no-store, ...')`, though `PROTECTED_PAGES` is currently an empty `Set([])`.
3. **Other BFCache / Tab-Switch Reload Causes:**
   - **Open SSE connection on `/notifications.html` (`new EventSource('/api/notifications/realtime')` at line 771):** Never closed on `pagehide`, which can prevent bfcache in several browsers.
   - **`auth.js` (`requireAuth` / `protectPage`):** Adds `html.auth-checking body { visibility: hidden !important; opacity: 0 !important; }` on load and has no `pageshow` (`event.persisted`) handler.

---

## 6. Vercel Function Region, Neon DB Region, and Pooled Connection String

1. **Neon Database Region:**
   - **Region:** AWS US East 1 (N. Virginia) — **`us-east-1`** (`ep-fancy-mud-awd6zxph.c-12.us-east-1.aws.neon.tech`, documented in `docs/KYANA_3_AUDIT.md` and `test-neon.js` / `check-blobs.js`).
2. **Vercel Function Region:**
   - **Current `vercel.json` setting:** **Not explicitly set** in `vercel.json` (no `"regions"` key). While Vercel defaults hobby/pro functions to `iad1` (Washington, D.C. / `us-east-1`), leaving `"regions"` unset in `vercel.json` risks region drift if project settings change. It should be explicitly pinned to `"regions": ["iad1"]` in `vercel.json` to match Neon's `us-east-1`.
3. **Neon Pooled Connection String & Singleton Pool Status:**
   - **Singleton Pool:** `db.js` (lines 33–53) creates `pgPool = new Pool({ connectionString })` once at module load time per Node process.
   - **Pooled Connection String (`-pooler`):** The configured Neon hostname (`ep-fancy-mud-awd6zxph.c-12.us-east-1.aws.neon.tech`) does **not** include `-pooler` (`ep-fancy-mud-awd6zxph-pooler.c-12.us-east-1.aws.neon.tech`), and `db.js` does not normalize direct `.neon.tech` endpoints to their `-pooler` PgBouncer hostname! Without PgBouncer pooling (`-pooler`), every serverless instance / parallel query opens direct PostgreSQL backend connections, adding ~35–80ms TLS/connection overhead on cold starts and risking connection exhaustion under load.

---

## 7. Ranked Top 10 Slowest Bottlenecks & Estimated Impact

| Rank | Bottleneck | Where It Happens | Estimated Latency / Weight Impact |
|---|---|---|---|
| **1** | **Severe N+1 Query Pattern in Cohort Chat History (`2N + 4` sequential queries per load/poll)** | `lib/cohort-chat.js:244-252` (`service.history` -> `for (const row of rows) await hydrate(tx, row)`) | **~1,200 ms – 2,800 ms on Neon WAN** (84 to 164 sequential DB round-trips for 40 messages + 40 recent messages inside a `FOR UPDATE` transaction). Batching reactions & mentions with `WHERE messageId IN (...)` reduces this to **1 round-trip (~35 ms)**. |
| **2** | **`getStudentProfile()` Runs 8–9 Sequential `COUNT(*)` Queries on Every `/api/me` and `/api/profile` Call (and Pages Call Both!)** | `server.js:5914-6016` (`getStudentProfile`), called by `/api/me` (`L2048`) and `/api/profile` (`L6021`) | **~300 ms – 650 ms per page load on Neon WAN** (8–9 sequential queries × 2 endpoints = **16–20 sequential DB round-trips** on `dashboard.html`, `chat.html`, `files.html`, `code-lab/subjects.html`). Parallelizing/combining into 1–2 queries + deduplicating `/api/me` saves **~250–550 ms** on every page load. |
| **3** | **Massive Unpaginated List Payloads with Inline Base64 Avatars (`/api/files`, `/api/library/files`, `/api/chat/members`)** | `server.js:3595` (`/api/files`), `server.js:4866` (`/api/library/files`), `server.js:5229` (`/api/chat/members`) | **~200 KB – 410 KB of JSON per page load (~150–400 ms transfer + parse time)**. `students.avatarUrl` stores inline base64 images that get duplicated across every single file row in `/api/files` (201.5 KB) and `/api/chat/members` (209.9 KB), and `/api/files` has no default `LIMIT`. |
| **4** | **No Client-Side SWR Cache — Every Navigation & Back Button Re-fetches All Data from Scratch** | `/dashboard.html`, `/library.html`, `/notices.html`, `/routine.html`, `/syllabus.html`, `/notifications.html` | **~400 ms – 1,200 ms blank/skeleton wait on every repeat visit or back navigation**. Implementing `swr.js` with `localStorage`/IndexedDB reduces repeat-visit and back-navigation data render time to **< 10 ms (0 ms network wait)**. |
| **5** | **Static Assets Served with `max-age=0` (and `no-store` on `auth.js` & `academic-context.js`) + All Requests Rewritten to `/api/index.js`** | `server.js:793-804`, `vercel.json` | **~300 ms – 700 ms on repeat visits** and **~600 KB+ re-validated/re-downloaded**. `style.v4.css` (417.8 KB), `chatbot.js` (66.3 KB), `syllabus-data.json` (221.7 KB), `auth.js` (34.1 KB `no-store`), and `academic-context.js` (9.0 KB `no-store`) hit the serverless function on every navigation. |
| **6** | **Full-Table Grouped Subqueries in `GET /api/posts` + Sequential Post Hydration + Redundant `getAcademicContext` Lookup** | `routes/posts.js:180-195, 554, 717-718` | **~150 ms – 350 ms per feed/notice load**. `buildSelectPosts()` groups `post_likes`, `post_comments`, and `post_submissions` across the entire database instead of scoping to the 20 returned posts, and awaits `attachMediaToPosts` and `attachTargetSemestersToPosts` sequentially. |
| **7** | **Sequential Client-Side Request Waterfalls on Page Load (`dashboard.html`, `routine.js`, `chat.html`, `code-lab/subjects.html`)** | `public/dashboard.html:4562`, `public/routine.js:206`, `public/code-lab/subjects.html:3558`, `public/auth.js:23` | **~250 ms – 800 ms wasted waiting on serial HTTP round-trips**. E.g., `routine.js` chains 4 sequential requests (`/api/academic-context` -> `/api/routine` -> `/api/profile` -> `/api/routine/admin`); `auth.js` dynamically injects `@supabase/supabase-js` CDN script and fetches `/api/auth/config` before `/api/me`; `library.html` even has an artificial `await new Promise(res => setTimeout(res, 200 - elapsed))` delay (`L3697`)! |
| **8** | **Uncompressed Multi-Megabyte Images, Unminified 418 KB CSS, and Heavy Blocking Third-Party Scripts (`html2pdf`, `Chart.js`, `Monaco`, `CodeMirror`, 15 Font Weights)** | `/public/images/dev-*.png` (1.95 MB total on `index.html`), `/public/copp.png` (1.86 MB), `/public/Mystic.jpg` (1.36 MB), `/public/Portrait.jpg` (1.35 MB), `/public/style.v4.css` (417.8 KB), `/public/termsandconditions.html` (12.16 MB) | **~1.5 MB – 3.2 MB excess page weight** and **~400 ms – 1,500 ms LCP/FCP delay**. Converting images to WebP, minifying CSS/JS, deferring scripts, and preloading primary fonts with `font-display: swap` cuts page weight by **60–80%**. |
| **9** | **Direct (Non-Pooled) Neon Connection String & Missing Database Indexes on Sort/Join Columns** | `db.js:35-44` (missing `-pooler` normalization), missing indexes on `posts(created_at DESC)`, `post_media(post_id)`, `post_comments(post_id)`, `post_likes(post_id)`, `notifications(recipientStudentId)`, `submissions(assignmentId)`, `files(subject, chapter)` | **~50 ms – 200 ms per cold/concurrent request** from non-pooled connections and sequential table scans on unindexed foreign keys and sort columns. |
| **10** | **BFCache Blockers (`beforeunload` Listeners, `Cache-Control: no-store` on `/register.html`, Unclosed SSE on `/notifications.html`, Async Header Flash)** | `public/js/teacher-attendance.js:1209`, `public/code-lab/assignment.html:1587`, `server.js:746`, `public/notifications.html:771`, `public/auth.js:636` | **~500 ms – 1,500 ms on Back/Forward navigation** (forces full document reload and re-execution of all scripts instead of instant 0ms bfcache restore, plus visible header/profile chip layout shift on every page load). |
