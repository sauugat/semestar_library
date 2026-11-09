---
name: semester-library-architect
description: Architectural engineering, security, database, UI/UX, and Kyana AI guide for the Semester Library platform (Node.js/Express, Neon PostgreSQL, SQLite/libsql, Supabase Auth/Realtime, Vanilla Web UI, and Expo/React Native mobile). Use whenever planning, inspecting, implementing, refactoring, debugging, or testing any backend route, database schema/migration, authentication flow, Kyana AI feature, web page, or mobile screen in Semester Library.
---

# Semester Library Architect

Architectural reference and engineering workflow for the Semester Library platform across its Node.js/Express backend, dual-engine database layer (Neon PostgreSQL and SQLite/libsql), Supabase Auth and Realtime integration, Kyana AI assistant engine, web frontend, and Expo/React Native mobile application.

## When to Use

- Modifying or adding Express routes, middleware, or services in `server.js`, `ai-assistant.js`, `routes/`, or `lib/`
- Working on Kyana AI intent routing, multi-step tool execution, source grounding, academic intelligence, or visual learning blocks
- Writing or reviewing database queries, schema initializations, or migrations in `db.js` and `migrations/`
- Touching authentication, session handling, Supabase JWT verification, mobile tokens, or role/cohort/semester access controls
- Building or updating web interfaces in `public/` or mobile screens and components in `mobile/`
- Running, adding, or debugging unit, integration, or regression tests in `tests/` and `test/`

## 1. Codebase Understanding

Always inspect the existing implementation before modifying code. Search first with targeted queries, inspect relevant line ranges, map module relationships, and reuse established utilities instead of rewriting working systems.

Key repository map:

- `server.js` and `api/index.js`: Main Express application (`server.js`) and Vercel serverless entrypoint (`api/index.js`). Handles security headers, `CustomDbStore` session persistence (`__gu_session`), CSRF/Origin guards, rate limiters, file uploads/previews, and route mounting.
- `db.js` and `lib/db-transaction.js`: Dual-engine database abstraction (`query`, `get`, `all`, `run`, `exec`, `prepare`, `withTransaction`), automatic `?` to `$1..$n` placeholder conversion (`toPostgresSql`), row key normalization (`camelMap` in `formatRow`), startup readiness verification (`verifyStartupReady`), and persistent binary storage (`file_blobs`).
- `ai-assistant.js`: Primary Kyana AI orchestrator handling scope gates, V3 knowledge retrieval, direct tool execution, Kyana Agent Engine delegation, grounding verification, resource card revalidation, and SSE streaming.
- `lib/`: Domain services and Kyana AI modules (`kyana-agent-engine.js`, `academic-intelligence.js`, `academic-event-intelligence.js`, `temporal-intelligence.js`, `nepali-dates.js`, `chat-tools.js`, `ai-search-tools.js`, `chat-grounding.js`, `chat-security.js`, `chat-personality.js`, `kyana-access.js`, `academic-context.js`, `note-search.js`, `knowledge-search.js`, `knowledge-sync.js`, `auth-middleware.js`, `supabase.js`, `attendance-service.js`, `marks-service.js`, `teacher-service.js`, `dm-service.js`, `cohort-chat.js`, `push-notifications.js`).
- `routes/`: Modular Express routers (`posts.js`, `post-images.js`, `comments.js`, `routine.js`, `attendance.js`, `marks.js`, `notifications.js`, `direct-messaging.js`, `cohort-chat.js`, `admin-dashboard.js`, `admin-teachers.js`, `admin-cohorts.js`, `teacher-onboarding.js`, `advertisements.js`, `games.js`, `code-lab/`).
- `public/`: Web frontend HTML, CSS, and vanilla JavaScript modules (`chatbot.html`, `chatbot.js`, `chatbot.css`, `dashboard.html`, `library.html`, `files.html`, `routine.html`, `syllabus.html`, `syllabus-data.json`, `attendance.html`, `marks-entry.html`, `results.html`, `auth.js`, `academic-context.js`, `style.v4.css`, `code-lab/`).
- `mobile/`: Expo SDK 58 / React Native 0.88.1 mobile client using `expo-router` (`mobile/app/`, `mobile/components/`, `mobile/services/`, `mobile/context/`, `mobile/constants/theme.ts`).
- `migrations/`: Numbered and timestamped SQL and JS migrations for PostgreSQL, SQLite, and Supabase Realtime RLS.
- `tests/` and `test/`: Node.js built-in test runner suites (`node --test`).

## 2. Technology Architecture

Respect the exact runtime and platform implementation details verified in the codebase:

- **Node.js and Express**: Targets Node.js `24.x` (`package.json` engines) and Express `4.19.2`. `server.js` patches `express/lib/router/layer` so rejected promises in async route handlers forward to `next(err)`. State-changing cookie-authenticated requests pass through an Origin/Referer CSRF check, while `Authorization: Bearer` requests bypass cookie session writes and CSRF origin checks.
- **Neon PostgreSQL**: Activated when `DATABASE_URL`, `POSTGRES_URL`, or `PGHOST` is set and `NODE_ENV !== 'test'` and `QA_MODE !== 'true'`. Uses `@neondatabase/serverless` `Pool` with `ws` WebSocket pipelining (`neonConfig.pipelineConnect = 'password'`). Pooled URLs (`-pooler.`) are used for runtime queries (`ensureNeonPoolerUrl`), while unpooled direct URLs (`ensureNeonDirectUrl`) are used for DDL migrations in `initSchema()`. Cold starts use `verifyStartupReady()` (`to_regclass` catalog check in `<15ms`) before falling back to `initSchema()`.
- **SQLite and libsql**: Uses `@libsql/client` (`database.db` locally, `database.qa.db` when `QA_MODE=true`, `/tmp/database.db` on Vercel without Postgres, or `file::memory:?cache=shared` in tests) with `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000`. Embedded PostgreSQL 16 tests use `@electric-sql/pglite`.
- **Supabase Auth, Storage, and Realtime**:
  - `lib/supabase.js` verifies HS256 Supabase JWTs locally via `verifySupabaseJwtLocally` (`crypto.timingSafeEqual` with `SUPABASE_JWT_SECRET`, checking `exp`, `nbf`, `aud: 'authenticated'`, `role: 'authenticated'`, `sub`, and `iss`) to avoid network latency, falling back to `client.auth.getUser(token)`. When `QA_MODE === 'true'`, remote Supabase admin/auth mutations are blocked.
  - Direct-to-storage library uploads use HMAC-signed upload tokens (`createUploadToken` / `verifyUploadToken`) and verify file existence, size, and MIME type in the `library_files` bucket (`POST /api/files/authorize-upload` and `POST /api/files/record-upload`).
  - Cohort chat and direct messaging use private schemas (`cohort_chat_private` and `dm_chat_private`) and `RESTRICTIVE` RLS policies on `realtime.messages` (`migrations/004-cohort-realtime-supabase.sql` and `migrations/006-direct-messaging-realtime-supabase.sql`).
- **JavaScript, HTML, and CSS (Web)**: Vanilla JS modules in `public/` with zero frontend bundler overhead for core pages. `public/chatbot.js` uses Marked (`12.0.2`), DOMPurify (`3.1.6`), KaTeX (`0.16.11`), a single-pass syntax highlighter (`highlightChatCode` with zero placeholder leakage enforced by `assertAndCleanPlaceholders`), and `renderAdaptiveVisualBlockHtml`.
- **React Native and Expo (Mobile)**: Located in `mobile/` (`version: 1.6.0`). Uses Expo `~58.0.23`, React `19.3.0`, React Native `0.88.1`, `expo-router` `~58.0.30`, `@tanstack/react-query` `^5.105.3`, `react-native-reanimated` `4.7.1`, and `expo-sqlite` `~58.0.15`. Always use `npx expo install <package>` when authorized to add mobile packages.
- **Vercel Deployment**: Configured in `vercel.json` (`regions: ["iad1"]`). Rewrites all paths to `/api/index.js`. Critical auth and state scripts (`auth.js`, `auth-modal.js`, `academic-context.js`, `sw.js`, `swr.js`, `teacher-attendance.js`, `student-attendance.js`, `attendance-drive-sync.js`, `teacher-marks-entry.js`, `student-results.js`) and `.html` files serve with `Cache-Control: public, max-age=0, must-revalidate`. Binary uploads stage in `/tmp/uploads` on Vercel and persist in the `file_blobs` table. Scheduled crons hit `/api/internal/push/process` and `/api/internal/posts/cleanup-staging` guarded by `verifyInternalCron`.

## 3. Kyana AI Engineering

Kyana AI is an intelligent academic companion built across `ai-assistant.js` and `lib/kyana-*` / `lib/chat-*` / `lib/academic-*`:

- **Multi-Step Agent Engine (`lib/kyana-agent-engine.js`)**: Executes the bounded loop `UNDERSTAND -> PLAN -> SELECT TOOLS -> EXECUTE -> OBSERVE -> REPLAN -> VERIFY -> RESPOND` (`DEFAULT_MAX_ITERATIONS = 8`, `DEFAULT_MAX_TOOL_CALLS = 10`, `DEFAULT_EXECUTION_TIMEOUT_MS = 20000`). Uses per-DB read caching invalidated automatically on mutating SQL and across instances via `kyana_cache_state` epochs and PostgreSQL `LISTEN/NOTIFY` (`kyana_cache_invalidation`).
- **Academic & Temporal Intelligence (`lib/academic-intelligence.js`, `lib/temporal-intelligence.js`, `lib/nepali-dates.js`)**: All dates, deadlines, and exam countdowns are computed deterministically server-side in Nepal Standard Time (`Asia/Kathmandu`, `UTC+05:45`) with Bikram Sambat (BS) and Gregorian (AD) conversion and Devanagari digit normalization. Never let the LLM guess date math or confuse a notice's publication date with an event's effective date.
- **Context Retrieval & Source Grounding (`lib/chat-grounding.js`, `lib/knowledge-search.js`, `lib/note-search.js`, `lib/ai-search-tools.js`)**:
  - Uploaded notes are indexed in `note_search_documents` using PDF.js (`pdfjs-dist`) and Mammoth (`mammoth`), backed by SQLite FTS5 or PostgreSQL `tsvector` GIN indexes.
  - Every campus claim is verified against retrieved evidence via `verifyGrounding()` and `validateRetrievedEvidence()`. Reference tags (`<referenced_records>`, `[REF: ...]`) are stripped from live SSE streams via `createReferenceTrailerStreamFilter()`.
  - Official notices require verified author roles (`admin` Tier 1, `teacher` Tier 2, `cr` Tier 3). Student posts (`role = 'student'`) are never classified as official notices. Newer notices supersede older notices via `compareAndResolveTemporalRecords()`.
- **University Knowledge Boundaries (`lib/chat-security.js`)**: Two-stage scope gate (`preContextScopeCheck` before DB lookup and `isOutOfScopeRequest` after context resolution). Blocks prompt injections, strict off-topic subjects (crypto, betting, sports scores, celebrity gossip, politics, non-BIT coding), while allowing contextual overrides when paired with platform keywords (e.g., a holiday notice due to an election).
- **Student Privacy (`lib/kyana-access.js`, `lib/chat-security.js`)**: Enforces four retrieval policies (`GLOBAL_INFORMATION`, `CURRENT_SEMESTER_LEARNING`, `EXPLICIT_CROSS_SEMESTER_LEARNING`, `PERSONAL_ACADEMIC_RECORDS`). Personal records (attendance, published exam marks/results, and assignment submissions/grades) are strictly private to the authenticated student. `resolveRequestedRecordOwner` and `isOtherStudentDataRequest` block cross-student lookups and individual student lookups by staff in chat.
- **Visual Learning & Adaptive Formatting (`lib/academic-intelligence.js`, `public/chatbot.js`)**: Supports validated visual blocks (`syllabus`, `diagram`, `flowchart`, `graph`, `trace`, `quiz`, `roadmap`, `comparison`, `complexity`, `timeline`, `simulation`, `code_preview`, `illustration`) checked by `validateVisualBlockPayload` (`MAX_PAYLOAD_BYTES = 32768`, `MAX_DIAGRAM_NODES = 24`, `MAX_CHART_POINTS = 50`, `MAX_TRACE_STEPS = 20`, `MAX_QUIZ_QUESTIONS = 10`). Simple factual lookups use concise conversational prose without forced visual blocks.
- **Tool Execution & Action Origin Isolation (`lib/chat-security.js`)**: Untrusted retrieved text (`<untrusted_campus_record>`) is sanitized via `sanitizeUntrustedRecordText` and `sanitizeUntrustedValue`. `verifyActionOrigin` ensures untrusted evidence can never trigger mutating tools, and non-read-only tools require explicit user confirmation (`userConfirmedAction: true`).

## 4. Security

Enforce defense-in-depth across every layer:

- **Role-Based & Academic-Scope Authorization**: Always resolve the caller via `createAuthMiddleware(db)` (`req.user` / `req.student` / `req.session`) and `getAcademicContext(db, req)`. Use `requireLogin`, `requireAdmin`, `requireTeacher`, `buildAcademicContentFilter`, `assertContentAccess`, `canReadResource`, and `revalidateCards`. Verify teacher subject assignments via `validateTeacherSubjectAuthorization` (`lib/teacher-service.js`).
- **Protect Student-Specific Records**: Scope all queries for `attendance_records`, `student_marks`, `submissions`, `submission_grades`, `notifications`, and `mobile_tokens` to the authenticated `studentId`. Never confirm whether another student ID exists in chat refusals.
- **Validate API Inputs & Uploads**: Validate parameter types, bounds, and formats. For Kyana tools, run `validateAgentToolArgs` to block prototype pollution (`__proto__`, `constructor`, `prototype`) and SQL meta-probes. For file uploads, enforce `isAllowedUploadFile`, `DANGEROUS_UPLOAD_EXTS` blocklists, `isSafeUploadPath` path-traversal checks, and `Content-Security-Policy: sandbox` on inline HTML/SVG responses.
- **Authentication & Token Handling**: Reject suspended accounts (`account_status === 'suspended'`) and revoke active `mobile_tokens` and `session` rows on password change, password reset, or account suspension. Block restricted `typ: 'teacher_onboarding'` JWTs from general API endpoints.
- **Database Query Protection**: Always use parameterized queries (`?` or `$1..$n`) through `db.get`, `db.all`, `db.run`, or `db.query`. Never interpolate raw user input into SQL strings. Validate SQL table aliases against `/^[a-z0-9_]+$/` (as in `resourceFilter`).
- **Supabase RLS Policies**: Keep `cohort_chat_private` and `dm_chat_private` schemas revoked from `PUBLIC`, `anon`, and `authenticated`. Maintain `RESTRICTIVE` read and write fences on `realtime.messages` so clients cannot spoof broadcasts or read unauthorized room topics.
- **Secrets Management**: Never hardcode, log, or expose API keys, `SESSION_SECRET`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`, or `CRON_SECRET`. Redact `token=` query parameters in HTTP logs and check LLM outputs with `unsafeOutput()`.

## 5. UI/UX Engineering

Maintain the platform's signature strict monochrome aesthetic and responsive ergonomics across web and mobile:

- **Monochrome Design System**: Follow `Monochrome` and `Colors` in `mobile/constants/theme.ts` and CSS tokens in `public/chatbot.css` and `public/style.v4.css`. Primary dark palette uses obsidian/charcoal surfaces (`#080808` / `#0a0a0a` background, `#141414` surface, `#1c1c1c` elevated surface, `#282828` border, `#ffffff` primary text, `#a1a1a1` secondary text, `#171717` incoming chat bubble, `#626262` outgoing chat bubble). Avoid arbitrary rainbow gradients or decorative clutter.
- **8-Point Spacing & Touch Targets**: Use the 8-point spacing rhythm (`4, 8, 12, 16, 24, 32, 48`), standardized radii (`card: 16`, `input/button: 11`, `sheet: 24`, `pill: 9999`), and minimum touch targets of `44dp` (`TouchTarget.min = 44`).
- **Web and Mobile Consistency**: Ensure features and resource cards (`deepLink` on web, `mobileRoute` and `mobileParams` on mobile) work seamlessly across both `public/` web pages and `mobile/app/` Expo Router screens.
- **Accessibility & Motion**: Support `Reduce Motion` preferences (e.g., `FluidChatBackground.tsx`), semantic `accessibilityLabel` / `aria-label` attributes, keyboard navigation, and safe area insets (`useSafeAreaInsets`, `StickyComposer`, `KeyboardContentBoundary`). Avoid heavy animations or unnecessary UI dependencies.

## 6. Database Engineering

All database changes must work across both PostgreSQL (Neon / PGlite) and SQLite (`@libsql/client`):

- **Inspect Existing Schemas First**: Check `db.js`, `schema.sql`, `migrations/`, and domain `ensure*Schema` modules (`lib/posts.js`, `lib/routine.js`, `lib/academic-context.js`, `lib/attendance-service.js`, `lib/marks-service.js`, `lib/teacher-service.js`, `lib/notifications-service.js`, `lib/push-notifications.js`, `lib/ai-chat-service.js`) before proposing any table or column change.
- **Cross-Dialect Compatibility**:
  - Write standard `?` placeholders in application queries so `db.js` (`toPostgresSql`) translates them for PostgreSQL while executing them directly in SQLite/libsql.
  - Handle dialect-specific DDL in `initSchema()` and migrations (`SERIAL PRIMARY KEY` vs `INTEGER PRIMARY KEY AUTOINCREMENT`, `TIMESTAMPTZ` vs `TEXT`, `ON CONFLICT ... DO UPDATE` vs `INSERT OR REPLACE` / `INSERT OR IGNORE`).
  - Register new snake_case columns in `camelMap` inside `db.js` if callers expect camelCase properties on returned rows.
- **Transactions & Migrations**: Use `db.withTransaction(async (tx) => { ... })` (`lib/db-transaction.js`) so all statements execute on a single connection with proper `COMMIT`/`ROLLBACK`. Keep migrations idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` or `PRAGMA table_info` checks).
- **Indexes & Query Performance**: Add covering indexes for foreign keys, status filters, and cursor pagination columns (see `migrations/003-perf-audit-indexes.js`).
- **Data Safety**: Preserve existing data at all times. Never run `DROP TABLE`, `TRUNCATE`, or destructive schema changes against production or user databases without explicit approval.

## 7. Testing and Verification

Verify actual behavior empirically before declaring any work complete:

- **Run Relevant Test Suites**:
  - Full test suite: `npm test` (`NODE_ENV=test node --test --test-concurrency=1 tests/*.test.js test/*.test.js`)
  - Chat & Kyana suites: `npm run test:chat` or targeted suites such as `node --test --test-concurrency=1 tests/kyana-agent-engine-v1.test.js tests/kyana-v1-2-final-staging-validation.test.js`
  - Feature suites: `npm run test:posts`, `npm run test:routine`, `npm run test:notifications`, `npm run test:cohorts`, `npm run test:group-chat`
  - Mobile checks: `npm --prefix mobile run lint` and `npx --prefix mobile tsc --noEmit`
- **Write Regression Tests**: Every bug fix or new capability must include a deterministic test in `tests/` using isolated SQLite (`:memory:`) or PGlite fixtures and mocked provider calls (never rely on live paid API calls in unit tests).
- **Check Web & Mobile Compatibility**: Verify that API responses include both web and mobile fields where applicable (e.g., `deepLink` and `mobileRoute`/`mobileParams` on Kyana resource cards, camelCase and snake_case aliases on post/comment/file payloads).
- **Honest Reporting**: Capture and inspect actual command outputs. Never claim a test passed if it was not executed or if it failed.

## 8. Performance

Optimize for low latency on both serverless cold starts and mobile networks:

- **Database & API Efficiency**: Consolidate related lookups into single round-trips (such as token + student profile join in `lib/auth-middleware.js`) or run independent queries concurrently with `Promise.all` (such as `/api/search` and `/api/files/:id`). Enforce pagination limits (`LIMIT` / cursor pagination) on all list endpoints.
- **Serverless Cold-Start Discipline**: Keep `verifyStartupReady()` fast (`<15ms` catalog check) and avoid running heavy synchronous work at module load time. Skip `sessionMiddleware` DB writes on stateless `Authorization: Bearer` requests.
- **Caching & Invalidation**: Use bounded caches (`lastCardsPerSession`, `paginationStatePerSession`, `agentReadCaches`, `noteSearch` cache) and always invalidate caches on mutations (`invalidateCache(db)`, `invalidateAgentCache(db)`, `noteSearch.invalidateSearchCache(db)`).
- **Frontend & Mobile Rendering**: Avoid unnecessary React re-renders in `mobile/` (`useCallback`, `useMemo`, inverted `FlatList` windowing). On web (`public/chatbot.js`), batch streaming DOM updates inside `requestAnimationFrame` and defer heavy syntax highlighting and KaTeX rendering until streaming completes (`streaming = false`).

## 9. Development Workflow

Follow this 9-step process for every substantial task:

1. **Understand the request**: Identify the exact user goal, affected user roles (`student`, `cr`, `teacher`, `admin`), and target surfaces (backend, database, Kyana AI, web, mobile).
2. **Inspect the relevant code**: Search first, then read the specific functions, schemas, and tests in the repository.
3. **Map dependencies and potential side effects**: Trace callers, shared modules in `lib/`, database tables, cache invalidation hooks, and web/mobile response contracts.
4. **Identify risks**: Check for authorization gaps, cross-student privacy leaks, SQL dialect mismatches (PostgreSQL vs SQLite), serverless `/tmp` state assumptions, or regressions in existing tests.
5. **Prepare an implementation plan**: Define minimal, atomic steps with clear verification commands.
6. **Implement the smallest reliable change**: Modify only what is needed while preserving existing patterns and backward compatibility.
7. **Run tests**: Execute affected unit/integration test suites (`node --test`) and add regression tests for new behavior or bug fixes.
8. **Inspect the final diff**: Run `git status` and `git diff` to confirm no unintended edits, leftover debug logs, or secret leaks were introduced.
9. **Report modified files, tests, results, and remaining risks**: Present a concise, factual summary of every file changed, exact test results, and any operational considerations.

## 10. Strict Restrictions

- Never deploy to production or run `vercel --prod` / `eas build` / `eas update` without explicit permission.
- Never modify or delete production database records without explicit approval.
- Never remove working functionality, routes, or compatibility aliases without justification and approval.
- Never introduce new npm or Expo dependencies unless strictly necessary and approved.
- Never claim tests passed unless you actually executed them and verified the passing output.
- Never invent architecture details, endpoints, table names, or university facts without verifying them in the codebase.

## Gotchas

- **Dual SQL Dialect**: Always test queries mentally (and with tests) against both SQLite and PostgreSQL. Avoid SQLite-only functions in shared queries unless handled by `toPostgresSql` or `db.isPostgres` branches.
- **Notice Authority vs Student Posts**: Feed posts in `posts` can have `type = 'status'` and `category = 'NOTICE'`. Always verify the author's role in `students` (`admin`, `teacher`, `cr`) before treating any post as an official notice.
- **Publication Date vs Effective Date**: A notice published on `2026-11-08` announcing classes resume on `2026-11-16` (`30 Kartik`) must never have its publication date confused with the event date or "today". Always anchor countdowns to the authoritative Nepal clock (`lib/nepali-dates.js` / `lib/temporal-intelligence.js`).
- **Placeholder Leakage in Chat UI**: Never introduce temporary markdown/code placeholder tokens in `public/chatbot.js` without ensuring `restoreCodeBlocks` and `assertAndCleanPlaceholders` strip them before DOM insertion.
