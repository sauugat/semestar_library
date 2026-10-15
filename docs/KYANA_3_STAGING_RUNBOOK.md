# KYANA AI 3.0 — Staging Runbook (Step 6 Preparation)

> [!IMPORTANT]
> **Strict Isolation Rule**: This runbook is strictly for execution against a dedicated, temporary Neon staging branch. **NEVER** run migrations, backfills, or evaluation scripts directly against production Neon.

---

## 1. Overview & Data Privacy Disclosure

### What Data Leaves Our Servers?
When Kyana AI 3.0 Knowledge Engine is active, only the following data leaves our servers and is sent to Google's Gemini API:
1. **Indexed Resource Content**: The text of published community posts, official notices, and assignments (`chunkText`), sent to `gemini-embedding-001` via `embedText(text, { taskType: 'RETRIEVAL_DOCUMENT' })` to compute 768-dimensional vector representations.
2. **Student Natural Language Questions**: The query string entered by the student in the Kyana chat box, sent to `gemini-embedding-001` via `embedText(query, { taskType: 'RETRIEVAL_QUERY' })` and synthesized by `gemini-3.1-flash-lite` with retrieved knowledge chunks.

### What Data NEVER Leaves Our Servers?
- **Student Identities & Passwords**: Passwords (bcrypt hashes), auth tokens, session cookies, student emails, and phone numbers are **NEVER** sent to Gemini or any third-party AI provider.
- **Unauthorized Semester/Cohort Data**: In-SQL filtering enforces semester isolation before rows leave PostgreSQL. Gemini never receives unauthorized or cross-cohort rows in its context window.
- **Timing Telemetry**: The `/timings` endpoint records only timestamps, status codes, and numeric latencies (ms). Zero queries, zero student IDs, and zero secrets are retained in telemetry.

---

## 2. Neon Staging Branch Creation

To validate on realistic schema and data without risking production:

### Option A: Using the Neon CLI
```bash
# 1. Install or authenticate Neon CLI
npm install -g neonctl
neonctl auth

# 2. Create isolated staging branch from main
neonctl branches create --name staging-kyana-3-knowledge

# 3. Retrieve the dedicated connection string (pooled or direct)
neonctl connection-string staging-kyana-3-knowledge
```

### Option B: Using the Neon Web Console
1. **Log in to Neon Console**: Navigate to your Neon Project Dashboard.
2. **Create Branch**:
   - Source branch: `main` (current production state).
   - Branch name: `staging-kyana-3-knowledge`.
   - Purpose: Ephemeral branch copy with isolated compute and storage.
3. **Obtain Connection String**:
   - Copy the Pooled or Direct PostgreSQL connection string for `staging-kyana-3-knowledge`.

### Isolate Environment Configuration
- **DO NOT** put this connection string in `.env` or commit it to Git.
- Create a dedicated staging env file: `.env.staging` (which is git-ignored):
  ```bash
  cat << 'EOF' > .env.staging
  # KYANA 3.0 STAGING CONFIGURATION ONLY (NEVER COMMIT)
  DATABASE_URL=postgresql://user:password@ep-staging-xyz.ap-southeast-1.neon.tech/neondb?sslmode=require
  KYANA_KNOWLEDGE_V3=false
  KYANA_KNOWLEDGE_V3_USERS=
  ENABLE_LIVE_GEMINI_IN_TESTS=true
  EOF
  ```

---

## 3. Applying the Up Migration

Apply the reversible schema migration (`20261014_kyana_v3_knowledge.up.sql`) using the staging connection string:

```bash
# Verify connection to staging branch
node -e '
process.loadEnvFile(".env.staging");
const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => { console.log("Connected to staging Neon branch successfully."); process.exit(0); });
'

# Apply the UP migration
node -e '
process.loadEnvFile(".env.staging");
const { Client } = require("pg");
const { applyKnowledgeMigration } = require("./lib/knowledge-schema");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log("Applying KYANA 3.0 knowledge schema migration...");
  await applyKnowledgeMigration(c);
  console.log("Migration applied successfully!");
  await c.end();
})();
'
```

---

## 4. Embedding Calls Estimation, Backfill Workflow & Real Data Coverage Audit

### Embedding Call Estimation Formula
For the unified backfill across all 6 campus knowledge sources:
$$\text{Total Embedding Calls} = \sum_{r \in \text{Resources}} \lceil \frac{\text{length}(r)}{1200} \rceil$$

- **Posts & Notices**: ~1 to 2 chunks of 1,200 characters each.
- **Coding Assignments**: ~1 to 3 chunks.
- **Notes & Study Materials**: ~1 to 5 chunks per document (for files with extracted text in `note_search_documents`).
  > [!NOTE]
  > Scanned image PDFs without machine-readable text are indexed by metadata only (title, subject, chapter) with message: *"No readable text found; scanned PDFs require OCR"*.
- **Exam Routines**: ~1 to 2 chunks per semester schedule.
- **Post Comments**: ~1 chunk per comment (Tier 2/3/4 authority based on author role).
- **Gandaki University Public Notices**: ~1 to 3 chunks per official notice (Tier 1 institutional authority).
- **Estimated initial chunks on typical staging replica**: ~25 to 50 chunks ($\approx 35$ embedding API calls).
- **Estimated Cost**: 35 calls $\times$ 300 tokens $\approx$ 10,500 tokens $\approx$ **$0.00026 USD** (well within Google AI Studio free tier limits of 60 RPM).

### Step 4A: Pre-Backfill Real Data Coverage Audit
Inspect the staging database before mutating:

```bash
node scripts/audit-real-data-coverage.js --db-url="$(grep DATABASE_URL .env.staging | cut -d= -f2-)"
```

### Step 4B: Backfill Dry-Run
Run the dry-run command to verify chunking and content hashing without modifying any database tables:

```bash
node scripts/backfill-knowledge.js --dry-run --db-url="$(grep DATABASE_URL .env.staging | cut -d= -f2-)"
```

Verify output reports:
- Number of posts, assignments, notes, routines, and comments discovered.
- Total chunks to be created.
- `Mode: DRY-RUN (NO CHANGES)`.

### Step 4C: Backfill Apply (Rate-Limited Batches + University Sync)
Execute the backfill with rate limiting (25 items per batch, 300ms pause between batches) and optional official university sync:

```bash
node scripts/backfill-knowledge.js --apply --include-gu --batch-size=25 --delay=300 --db-url="$(grep DATABASE_URL .env.staging | cut -d= -f2-)"
```

Verify:
- All items report `[INDEXED]`.
- Re-running the command immediately yields 100% `Skipped(Unchanged)` due to canonical content hash matching.
- Failure count is `0`.

### Step 4D: Post-Backfill Real Data Coverage Audit
Confirm that 100% coverage was achieved:

```bash
node scripts/audit-real-data-coverage.js --db-url="$(grep DATABASE_URL .env.staging | cut -d= -f2-)"
```

---

## 5. Enabling the Feature Flag via User Allowlist & Canary Rollout

### 5A: Single-User Canary Testing
Enable Kyana 3.0 Knowledge Engine **strictly for a single test student account** using the granular allowlist:

```bash
# Example: Enable ONLY for your specific test account
export KYANA_KNOWLEDGE_V3=true
export KYANA_KNOWLEDGE_V3_USERS="stu_your_test_id"
```

| Environment Setting | Outcome | Safety Guard |
| :--- | :--- | :--- |
| `KYANA_KNOWLEDGE_V3=false` | OFF for all students | Legacy retrieval path preserved |
| `KYANA_KNOWLEDGE_V3=true` & `KYANA_KNOWLEDGE_V3_USERS=""` | OFF for all students | Safe default: no traffic served without explicit ID |
| `KYANA_KNOWLEDGE_V3=true` & `KYANA_KNOWLEDGE_V3_USERS="stu_your_test_id"` | ON for `stu_your_test_id` only | Single-user canary isolation |
| `KYANA_KNOWLEDGE_V3=true` & `KYANA_KNOWLEDGE_V3_USERS="stu_id1,stu_id2"` | ON for allowlisted IDs only | Controlled cohort canary |
| `KYANA_KNOWLEDGE_V3=true` & `KYANA_KNOWLEDGE_V3_USERS="*"` | ON for everyone | General campus release |

### 5B: Vercel Deployment Propagation Rule
> [!IMPORTANT]
> **Vercel Serverless Propagation**: Updating environment variables in the Vercel Dashboard or via `vercel env add` **does NOT** update running serverless lambdas.
> You **MUST** trigger a new deployment or promote an existing deployment for the updated environment variables to take effect:
> ```bash
> # 1. Update environment variable in Vercel project
> npx vercel env add KYANA_KNOWLEDGE_V3 staging
> npx vercel env add KYANA_KNOWLEDGE_V3_USERS staging
>
> # 2. Trigger a redeployment to propagate environment variables to lambdas
> npx vercel redeploy <deployment-url>
> # OR trigger via git push to the staging preview branch
> ```

---

## 6. Knowledge Coverage Matrix & Authority Hierarchy

Kyana AI 3.0 indexes, normalizes, and synthesizes 9 distinct categories of campus information with institutional authority ranking:

| Resource Type | Source Table / Origin | Authority Tier | Scope & Authorization Filter | Web URL DeepLink | Expo Mobile Route |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GU Official Notices** | `https://gandakiuniversity.edu.np` | **Tier 1 (Institutional Authority)** | `target_all_semesters = 1` AND `audience_scope = 'all_students'` | Canonical university notice URL | `/notice/:id` |
| **Official Campus Notices** | `posts` (`type='notice'`) | **Tier 2 (Campus Admin / Faculty)** | `target_all_semesters = 1` OR `cohort_id = student.cohort_id` | `/posts/:id` | `/notice/:id` |
| **Teacher Comments** | `post_comments` (role='teacher') | **Tier 2 (Faculty Clarification)** | Inherits parent post scope, cohort, and moderation status | `/posts/:postId#comment-:id` | `/post/:postId` |
| **Class Representative Comments** | `post_comments` (role='cr') | **Tier 3 (Cohort Official Clarification)** | Inherits parent post scope, cohort, and moderation status | `/posts/:postId#comment-:id` | `/post/:postId` |
| **Student Comments** | `post_comments` (role='student') | **Tier 4 (Peer Discussion)** | Inherits parent post scope, cohort, and moderation status | `/posts/:postId#comment-:id` | `/post/:postId` |
| **Assignments** | `assignments` | **Tier 3 (Course Faculty)** | `semester_no = student.semester` AND `cohort_id = student.cohort_id` | `/code-lab/assignment.html?id=:id` | `/assignments/:id` |
| **Course Notes & Materials** | `files` (`type='note'`) | **Tier 3 (Course Faculty)** | `semester_no = student.semester` AND `cohort_id = student.cohort_id` | `/api/files/:id/view` | `/material/:id` |
| **Extracted PDF Text** | `note_search_documents` | **Tier 3 (Course Faculty)** | Joined with parent file record; respects file permissions | `/api/files/:id/view` | `/material/:id` |
| **Exam Routines** | `routine` | **Tier 2 (Admin / Exam Office)** | `routine.semester = student.semester` (admins see all) | `/routine` | `/routine` |
| **Homepage Posts** | `posts` (`type='status'`) | **Tier 4 (Student / Peer)** | `cohort_id = student.cohort_id` AND `semester_no = student.semester` | `/posts/:id` | `/post/:id` |

### Architectural Highlights

#### 1. Phase 5: Student & Teacher Comment Knowledge Engine
- **Role-Aware Authority Ranking**: Automatically resolves commenter role from `students.role`. Teacher comments rank at Tier 2 (outranking peer discussions), CR comments at Tier 3, and student comments at Tier 4.
- **Parent Scope Inheritance**: Comments automatically inherit parent post `cohort_id`, `semester_no`, `audience_scope`, `visibility`, and `target_all_semesters`. Cross-cohort students can never see comments on posts they do not have permission to view.
- **Cascading Lifecycle Sync**:
  - `onCommentSaved`: Real-time indexing on comment creation and edits.
  - `onCommentDeleted`: Immediate unsearchability on deletion.
  - `onCommentModerationChanged`: Soft-deleted / removed comments hidden immediately.
  - Parent post soft-deletion or moderation automatically cascades to child comments.

#### 2. Phase 6: Gandaki University Public Integration
- **Live Ingestion Source**: Connects to `https://www.gandakiuniversity.edu.np/wp-json/wp/v2/pdfposter` and `/pages` (academic calendar).
- **Controlled Normalization**: Strips HTML tags, decodes HTML entities, discovers attached PDF document links, and preserves the official canonical URL for deep-linking.
- **Tier 1 Institutional Ranking**: When official university notices and student posts provide conflicting dates, Kyana AI 3.0 gives priority to the official Gandaki University notice.
- **Automated Cron Sync**: Scheduled twice daily via `0 6,12 * * *` on `/api/internal/knowledge/sync-university`.

---

## 7. 100-Question Staging Validation Suite & Benchmark Results

The 100-question automated evaluation suite (`scripts/eval-100-staging.js`) validates Kyana AI 3.0 against an isolated staging PostgreSQL database (`test_semester_library`).

### Benchmark Results (100% Pass Rate Achieved)

```text
=============================================================
STAGING VALIDATION RESULTS SUMMARY
=============================================================
Total Scenarios Tested : 100
Passed                 : 100 (100.0%)
Failed                 : 0
-------------------------------------------------------------
  - Positive Lookups          : 25/25 passed (100%)
  - Recommendation Demo       : 2/2 passed (100%)
  - Multi-Turn Flow           : 8/8 passed (100%)
  - Conflicting Sources       : 10/10 passed (100%)
  - Semester Isolation        : 15/15 passed (100%)
  - Role Permissions          : 10/10 passed (100%)
  - Negative Lookups          : 15/15 passed (100%)
  - Adversarial Defense       : 10/10 passed (100%)
  - Resource Navigation       : 3/3 passed (100%)
  - Sync & Revocation         : 2/2 passed (100%)
=============================================================
ALL 100 STAGING EVALUATION SCENARIOS PASSED WITH 100% ACCURACY!
```

### Verified 2-Turn Conversational Demonstration

#### Turn 1: Initial Notice Request in Romanized Nepali
- **Student Prompt**: *"Yrr hamro semester ko latest exam notice k xa?"*
- **Kyana AI Response**: Explains in natural Nepali-English that the Examination Controller Office released revised Notice 811 regarding the Terminal Semester Examination schedule change due to university sports week.
- **Resource Card Returned**:
  ```json
  {
    "type": "notice",
    "id": 811,
    "title": "URGENT: Revised Examination Schedule Notice for Semester 3",
    "webUrl": "/posts/811",
    "mobileRoute": "/notice/811"
  }
  ```

#### Turn 2: Follow-up Comparing Conflicting Notices
- **Student Prompt**: *"Tyo notice ma exam date change vako xa?"*
- **Kyana AI Response**: Successfully references prior Notice 811 and compares it against initial Notice 810. Explicitly confirms that the **DBMS (Database Management Systems)** examination was rescheduled and postponed from **2026-11-03** to **2026-11-05 at 11:00 AM in Room 302**, while the **Operating Systems (OS)** examination date remains unchanged on **2026-11-08 in Room 304**.

---

## 8. Security & Adversarial Defense Architecture

1. **Untrusted Campus Record Encapsulation**:
   - All retrieved database passages are wrapped in `<untrusted_campus_record id="..." type="...">` tags.
   - All user-supplied text inside chunks undergoes strict XML entity escaping (`&` $\to$ `&amp;`, `<` $\to$ `&lt;`, `>` $\to$ `&gt;`).
2. **Zero-Tool Knowledge Synthesis**:
   - During knowledge synthesis, no tool calls or code execution endpoints are exposed to the LLM. It acts purely as a constrained summarizer grounded strictly in retrieved records.
3. **Prompt-Injection Resistance**:
   - Tested against 10 realistic campus attack vectors (direct prompt overrides, environment variable leaks, admin password extraction, multilingual translation escapes, terminal simulation jailbreaks, XSS script injection, and fake card injection). All 10 returned clean refusals with zero leaks.
4. **Independent Backend Authorization**:
   - Permissions are enforced entirely in SQL (`WHERE (r.audience_scope = 'all_students' OR r.semester_no = $1)`) before rows are retrieved. The LLM is never relied upon to filter unauthorized content.

---

## 9. Exact Resource Navigation Mappings

Resource cards generated by Kyana AI 3.0 include precomputed, verified navigation targets for both the web application and Expo React Native mobile client:

| Resource Type | Canonical ID Example | Web Link (`deepLink` / `viewUrl`) | Expo Mobile Route (`mobileRoute`) | Mobile Parameters (`mobileParams`) |
| :--- | :--- | :--- | :--- | :--- |
| **GU Official Notice** | GU Notice 102 | Official URL (`https://...`) | `/notice/gu_102` | `{"id": "gu_102"}` |
| **Campus Notice** | Notice 811 | `/posts/811` | `/notice/811` | `{"id": 811}` |
| **Campus Post** | Post 812 | `/posts/812` | `/post/812` | `{"id": 812}` |
| **Comment** | Comment 105 (on Post 812) | `/posts/812#comment-105` | `/post/812` | `{"id": 812, "commentId": 105}` |
| **Assignment** | Assignment 703 | `/code-lab/assignment.html?id=703` | `/assignments/703` | `{"id": 703}` |
| **Note / File** | File 903 | `/api/files/903/view` | `/material/903` | `{"id": 903}` |
| **Routine** | Semester 3 | `/routine` | `/routine` | `{}` |

---

## 10. Monitoring Timings & Gemini Quota

### Live Telemetry Monitoring
Monitor performance via the timing endpoint:
```bash
curl -s "http://127.0.0.1:3000/api/internal/knowledge/timings?limit=10" | jq .
```
Verify:
- `summary.p95TotalMs` $< 3,500$ ms.
- `summary.p50RetrievalMs` $< 50$ ms.
- `fallbackCount` is 0.

### Structured Log Inspection
In Vercel / serverless logs, filter by:
```text
[KYANA_TIMING]
```
Ensure structured lines output context load, embedding, retrieval, and TTFT metrics with zero content or secret leakage.

### Gemini API Usage Monitoring
Check the Google Cloud / Google AI Studio Console:
- Verify request rate stays well under the 60 RPM free tier quota.
- Ensure error rate (HTTP 429 or 503) is 0%.

---

## 11. Rollback Procedure & Vercel Propagation

If any anomaly, data leak, or latency degradation is observed, execute rollback immediately in this order:

### Immediate Kill-Switch (0 Downtime)
Turn off the feature flag in deployment environment variables:
```bash
# Set flag OFF
npx vercel env add KYANA_KNOWLEDGE_V3 staging <<< "false"
npx vercel env add KYANA_KNOWLEDGE_V3_USERS staging <<< ""
```

> [!IMPORTANT]
> **Vercel Propagation Note**: Remember to trigger a redeployment (`npx vercel redeploy <deployment-url>` or push an empty commit `git commit --allow-empty -m "trigger redeploy" && git push`) so that running serverless functions reload the updated environment variables.

Once propagated, all incoming requests immediately revert to the legacy query path in `< 1ms`.

### Schema Rollback (Reversible Down Migration)
If testing on staging is complete or database tables need to be cleared, execute the down migration:
```bash
node -e '
process.loadEnvFile(".env.staging");
const { Client } = require("pg");
const { rollbackKnowledgeMigration } = require("./lib/knowledge-schema");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log("Rolling back KYANA 3.0 knowledge schema...");
  await rollbackKnowledgeMigration(c);
  console.log("Rollback completed.");
  await c.end();
})();
'
```

### Staging Branch Teardown
In the Neon Console or via Neon CLI:
```bash
neonctl branches delete staging-kyana-3-knowledge
rm -f .env.staging
```
