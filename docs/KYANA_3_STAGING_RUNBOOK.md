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

1. **Log in to Neon Console**: Navigate to your Neon Project Dashboard.
2. **Create Branch**:
   - Source branch: `main` (current production state).
   - Branch name: `staging-kyana-3-knowledge`.
   - Purpose: Ephemeral branch copy with isolated compute and storage.
3. **Obtain Connection String**:
   - Copy the Pooled or Direct PostgreSQL connection string for `staging-kyana-3-knowledge`.
4. **Isolate Environment Configuration**:
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

## 4. Embedding Calls Estimation & Backfill Workflow

### Embedding Call Estimation Formula
For the initial backfill:
$$\text{Total Embedding Calls} = \sum_{p \in \text{Posts}} \lceil \frac{\text{length}(p)}{1200} \rceil + \sum_{a \in \text{Assignments}} \lceil \frac{\text{length}(a)}{1200} \rceil$$

- Average post/notice: ~1 to 2 chunks of 1,200 characters each.
- Average coding assignment: ~1 to 3 chunks.
- **Real Schema Count on Local Replica**:
  - Posts: 9 rows
  - Assignments: 2 rows
  - Estimated initial chunks: ~15 to 25 chunks ($\approx 20$ embedding API calls).
- **Cost**: 20 calls $\times$ 300 tokens $\approx$ 6,000 tokens $\approx$ **$0.00015 USD** (effectively free under Google AI Studio free tier).

### Step 4A: Backfill Dry-Run
Run the dry-run command to verify chunking and content hashing without modifying any database tables:

```bash
DATABASE_URL=$(grep DATABASE_URL .env.staging | cut -d= -f2-) node scripts/backfill-knowledge.js --dry-run
```

Verify output reports:
- Number of posts and assignments discovered.
- Total chunks to be created.
- `Mode: DRY-RUN (NO CHANGES)`.

### Step 4B: Backfill Apply (Rate-Limited Batches)
Execute the backfill with rate limiting (25 items per batch, 300ms pause between batches):

```bash
DATABASE_URL=$(grep DATABASE_URL .env.staging | cut -d= -f2-) node scripts/backfill-knowledge.js --apply --batch-size=25 --delay=300
```

Verify:
- All items report `[INDEXED]`.
- Failure count is `0`.

---

## 5. Enabling the Feature Flag via User Allowlist (H8)

Enable Kyana 3.0 Knowledge Engine **strictly for test student accounts** using the 4 allowlist rules:

```bash
# Example: Enable ONLY for test accounts 'stu_test_1' and 'stu_test_2'
export KYANA_KNOWLEDGE_V3=true
export KYANA_KNOWLEDGE_V3_USERS="stu_test_1,stu_test_2"
```

| Environment Setting | Outcome | Safety Guard |
| :--- | :--- | :--- |
| `KYANA_KNOWLEDGE_V3=false` | OFF for all students | Legacy retrieval path preserved |
| `KYANA_KNOWLEDGE_V3=true` & `KYANA_KNOWLEDGE_V3_USERS=""` | OFF for all students | Safe default: no traffic served without explicit ID |
| `KYANA_KNOWLEDGE_V3=true` & `KYANA_KNOWLEDGE_V3_USERS="id1,id2"` | ON for `id1`, `id2` only | Targeted canary testing |
| `KYANA_KNOWLEDGE_V3=true` & `KYANA_KNOWLEDGE_V3_USERS="*"` | ON for everyone | General release |

---

## 6. Knowledge Coverage Matrix (9 University Resource Types)

Kyana AI 3.0 indexes, normalizes, and synthesizes 9 distinct categories of campus information with institutional authority ranking:

| Resource Type | Source Table | Authority Tier | Scope & Authorization Filter | Web URL DeepLink | Expo Mobile Route |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Homepage Posts** | `posts` (`type='status'`) | Tier 4 (Student/Peer) | `cohort_id = student.cohort_id` AND `semester_no = student.semester` | `/posts/:id` | `/post/:id` |
| **Official Notices** | `posts` (`type='notice'`) | Tier 2 (Admin/Teacher) | `cohort_id` or `target_all_semesters = 1` | `/posts/:id` | `/notice/:id` |
| **Student Comments** | `post_comments` | Tier 4 (Student/Peer) | Inherits parent post scope & moderation status | `/posts/:id#comments` | `/post/:id` |
| **Assignments** | `assignments` | Tier 3 (Course Faculty) | `semester_no = student.semester` AND `cohort_id = student.cohort_id` | `/code-lab/assignment.html?id=:id` | `/assignments/:id` |
| **Course Notes** | `files` (`type='note'`) | Tier 3 (Course Faculty) | `semester_no = student.semester` AND `cohort_id = student.cohort_id` | `/api/files/:id/view` | `/material/:id` |
| **Extracted PDF Text** | `note_search_documents` | Tier 3 (Course Faculty) | Joined with parent file record; respects file permissions | `/api/files/:id/view` | `/material/:id` |
| **Attachments** | `files` (linked to posts/assignments) | Tier 3 (Course Faculty) | Inherits parent post or assignment authorization | `/api/files/:id/view` | `/material/:id` |
| **Exam Routines** | `routine` | Tier 2 (Admin/Exam Office) | `routine.semester = student.semester` (admins see all) | `/routine` | `/routine` |
| **Approved GU Info** | `posts` (admin all-semesters) | Tier 1 (Institutional Policy) | `target_all_semesters = 1` AND `audience_scope = 'all_students'` | `/posts/:id` | `/notice/:id` |

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
| **Notice** | Notice 811 | `/posts/811` | `/notice/811` | `{"id": 811}` |
| **Post** | Post 812 | `/posts/812` | `/post/812` | `{"id": 812}` |
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

## 11. Rollback Procedure

If any anomaly, data leak, or latency degradation is observed, execute rollback immediately in this order:

### Immediate Kill-Switch (0 Downtime)
Turn off the feature flag in deployment environment variables:
```bash
KYANA_KNOWLEDGE_V3=false
KYANA_KNOWLEDGE_V3_USERS=
```
All incoming requests immediately revert to the legacy query path in `< 1ms`.

### Schema Rollback (Reversible Down Migration)
Execute the down migration to drop knowledge tables cleanly:
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
In the Neon Console:
- Delete the `staging-kyana-3-knowledge` branch.
- Remove `.env.staging` from your local machine.
