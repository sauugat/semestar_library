/**
 * SEMESTER LIBRARY — SAFE PRODUCTION CLEANUP
 * ============================================
 * Based on the dry-run inventory results, this script:
 * 1. Resolves real users by their immutable studentId
 * 2. Classifies all remaining accounts as CONFIRMED_SYNTHETIC
 * 3. Deletes synthetic records in FK-safe order
 * 4. Verifies cleanup results
 *
 * SAFETY: Uses transactions. Only deletes CONFIRMED_SYNTHETIC records.
 *         Real user accounts are protected by immutable ID keep-list.
 *
 * Usage:
 *   node scripts/test-data-cleanup.js [--execute]
 *   Without --execute, runs in dry-run mode (default).
 */

const path = require('path');
const fs = require('fs');

// Load .env
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
      }
    });
  }
} catch (_) {}

const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const EXECUTE = process.argv.includes('--execute');

// ─── IMMUTABLE REAL USER KEEP-LIST ───
// Resolved from the dry-run inventory. These are the ONLY real production accounts.
const REAL_USER_KEEP_LIST = [
  { studentId: '26020266', name: 'Saugat Subedi', role: 'admin' },
  { studentId: '26020260', name: 'Sandesh Dhakal', role: 'student' },
  { studentId: '26020268', name: 'Subarna Poudel', role: 'student' },
  { studentId: '3322',     name: 'swostika subedi', role: 'student' },
  { studentId: '366372',   name: 'Trojan Virus', role: 'student' },
];

const KEEP_IDS = new Set(REAL_USER_KEEP_LIST.map(u => u.studentId));

async function main() {
  const client = await pool.connect();
  try {
    console.log('=' .repeat(70));
    console.log(`  SEMESTER LIBRARY — PRODUCTION CLEANUP (${EXECUTE ? '🔴 EXECUTE' : '🟡 DRY-RUN'})`);
    console.log('=' .repeat(70));
    console.log();

    // Step 1: Verify keep-list
    console.log('STEP 1: VERIFYING REAL USER KEEP-LIST');
    console.log('-'.repeat(50));
    for (const u of REAL_USER_KEEP_LIST) {
      const res = await client.query(
        `SELECT "studentid", "name", "role" FROM students WHERE "studentid" = $1`,
        [u.studentId]
      );
      if (res.rows.length > 0) {
        console.log(`  ✅ ${res.rows[0].name} (${res.rows[0].studentid}) — ${res.rows[0].role}`);
      } else {
        console.log(`  ⚠️  NOT FOUND: ${u.name} (${u.studentId})`);
      }
    }
    console.log();

    // Step 2: Identify all synthetic accounts (everything NOT in keep-list)
    console.log('STEP 2: IDENTIFYING SYNTHETIC ACCOUNTS');
    console.log('-'.repeat(50));

    const allStudents = await client.query(`SELECT "studentid", "name", "role" FROM students`);
    const syntheticAccounts = allStudents.rows.filter(r => !KEEP_IDS.has(r.studentid));
    const syntheticIds = syntheticAccounts.map(r => r.studentid);

    console.log(`  Total accounts: ${allStudents.rows.length}`);
    console.log(`  Real (keep): ${KEEP_IDS.size}`);
    console.log(`  Synthetic (delete): ${syntheticAccounts.length}`);
    console.log();

    for (const s of syntheticAccounts) {
      console.log(`    🗑️  ${s.name} (${s.studentid})`);
    }
    console.log();

    if (syntheticIds.length === 0) {
      console.log('No synthetic accounts found. Nothing to clean.');
      return;
    }

    // Step 3: Count records before cleanup
    console.log('STEP 3: RECORD COUNTS BEFORE CLEANUP');
    console.log('-'.repeat(50));

    const countTable = async (table) => {
      try {
        const r = await client.query(`SELECT COUNT(*) as cnt FROM ${table}`);
        return parseInt(r.rows[0].cnt, 10);
      } catch { return -1; }
    };

    const tables = [
      'students', 'posts', 'post_media', 'post_likes', 'post_comments',
      'post_comment_reactions', 'chat_messages', 'chat_reactions',
      'chat_read_receipts', 'chat_typing', 'chat_pinned',
      'chat_message_mentions', 'notifications',
      'student_device_tokens', 'student_notification_preferences',
      'files', 'follows', 'post_attachment_staging',
    ];

    const beforeCounts = {};
    for (const t of tables) {
      beforeCounts[t] = await countTable(t);
      console.log(`  ${t}: ${beforeCounts[t]}`);
    }
    console.log();

    if (!EXECUTE) {
      console.log('🟡 DRY-RUN MODE — No data will be modified.');
      console.log('   Run with --execute to perform the cleanup.');
      console.log();
      return;
    }

    // Step 4: Delete in FK-safe order (within transaction)
    console.log('STEP 4: DELETING SYNTHETIC RECORDS');
    console.log('-'.repeat(50));

    await client.query('BEGIN');

    try {
      const deletionOrder = [
        // Dependent records first
        { table: 'post_comment_reactions', col: 'user_id', label: 'post_comment_reactions' },
        { table: 'post_comments', col: 'user_id', label: 'post_comments' },
        { table: 'post_likes', col: 'user_id', label: 'post_likes' },
        { table: 'post_attachment_staging', col: 'uploader_student_id', label: 'post_attachment_staging' },
        // post_media via posts
        { table: 'post_media', col: null, label: 'post_media (via posts)', 
          customQuery: `DELETE FROM post_media WHERE post_id IN (SELECT id FROM posts WHERE user_id = ANY($1))` },
        { table: 'posts', col: 'user_id', label: 'posts' },
        { table: 'chat_message_mentions', col: null, label: 'chat_message_mentions (via messages)',
          customQuery: `DELETE FROM chat_message_mentions WHERE message_id IN (SELECT id FROM chat_messages WHERE studentid = ANY($1))` },
        // Also delete mentions where the mentioned user is synthetic
        { table: 'chat_message_mentions', col: 'mentioned_student_id', label: 'chat_message_mentions (mentioned synthetic)' },
        { table: 'chat_reactions', col: 'studentid', label: 'chat_reactions' },
        { table: 'chat_read_receipts', col: 'studentid', label: 'chat_read_receipts' },
        { table: 'chat_typing', col: 'studentid', label: 'chat_typing' },
        { table: 'chat_pinned', col: 'pinnedby', label: 'chat_pinned' },
        { table: 'chat_messages', col: 'studentid', label: 'chat_messages' },
        { table: 'notifications', col: 'recipientstudentid', label: 'notifications' },
        { table: 'student_device_tokens', col: 'student_id', label: 'student_device_tokens' },
        { table: 'student_notification_preferences', col: 'student_id', label: 'student_notification_preferences' },
        { table: 'files', col: 'uploadedby', label: 'files' },
        { table: 'follows', col: null, label: 'follows',
          customQuery: `DELETE FROM follows WHERE "followerid" = ANY($1) OR "followingid" = ANY($1)` },
        // Also delete submissions-related records
        { table: 'submission_events', col: 'studentid', label: 'submission_events' },
        { table: 'submissions', col: 'studentid', label: 'submissions' },
        { table: 'file_comments', col: 'studentid', label: 'file_comments' },
        { table: 'file_likes', col: 'studentid', label: 'file_likes' },
        { table: 'mobile_tokens', col: 'studentid', label: 'mobile_tokens' },
        // Finally the account itself
        { table: 'students', col: 'studentid', label: 'students' },
      ];

      for (const item of deletionOrder) {
        try {
          let result;
          if (item.customQuery) {
            result = await client.query(item.customQuery, [syntheticIds]);
          } else {
            result = await client.query(
              `DELETE FROM ${item.table} WHERE ${item.col} = ANY($1)`,
              [syntheticIds]
            );
          }
          const count = result.rowCount || 0;
          if (count > 0) {
            console.log(`  ✅ ${item.label}: ${count} rows deleted`);
          } else {
            console.log(`  ⏭️  ${item.label}: 0 rows`);
          }
        } catch (err) {
          console.log(`  ⚠️  ${item.label}: skipped (${err.message})`);
        }
      }

      // Also clean content-marker chat messages from real users (test content)
      try {
        const contentResult = await client.query(
          `DELETE FROM chat_messages
           WHERE (text ILIKE '%SMOKE_%' OR text ILIKE '%TEST_%' OR text ILIKE '%MENTION_%'
                  OR text ILIKE '%automated dispatch%' OR text ILIKE '%mass mention%'
                  OR text ILIKE '%duplicate mention%' OR text ILIKE '%broadcast test%')
             AND studentid NOT IN (SELECT unnest($1::text[]))`,
          [Array.from(KEEP_IDS)]
        );
        console.log(`  ✅ content-marker chat messages (non-real): ${contentResult.rowCount} rows deleted`);
      } catch (err) {
        console.log(`  ⚠️  content-marker cleanup: ${err.message}`);
      }

      await client.query('COMMIT');
      console.log('\n  ✅ Transaction committed successfully.\n');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`\n  ❌ Transaction ROLLED BACK: ${err.message}\n`);
      throw err;
    }

    // Step 5: Verify post-cleanup state
    console.log('STEP 5: RECORD COUNTS AFTER CLEANUP');
    console.log('-'.repeat(50));

    const afterCounts = {};
    for (const t of tables) {
      afterCounts[t] = await countTable(t);
      const diff = beforeCounts[t] - afterCounts[t];
      console.log(`  ${t}: ${afterCounts[t]} (removed ${diff})`);
    }
    console.log();

    // Verification queries
    console.log('STEP 6: VERIFICATION');
    console.log('-'.repeat(50));

    const verifyZero = async (table, col, label) => {
      try {
        const r = await client.query(
          `SELECT COUNT(*) as cnt FROM ${table} WHERE ${col} NOT IN (SELECT unnest($1::text[]))`,
          [Array.from(KEEP_IDS)]
        );
        const cnt = parseInt(r.rows[0].cnt, 10);
        // For tables that reference students, check for orphaned records
        if (table === 'posts') {
          const check = await client.query(
            `SELECT COUNT(*) as cnt FROM ${table} WHERE ${col} NOT IN (SELECT studentid FROM students)`
          );
          const orphaned = parseInt(check.rows[0].cnt, 10);
          console.log(`  ${label}: ${cnt} non-real, ${orphaned} orphaned`);
        } else {
          console.log(`  ${label}: ${cnt} non-real-user records remain`);
        }
      } catch (err) {
        console.log(`  ${label}: (check error: ${err.message})`);
      }
    };

    // Check no synthetic accounts remain
    const remainingStudents = await client.query(`SELECT "studentid", "name" FROM students`);
    console.log(`  Remaining student accounts: ${remainingStudents.rows.length}`);
    for (const r of remainingStudents.rows) {
      console.log(`    ${r.name} (${r.studentid}) — ${KEEP_IDS.has(r.studentid) ? '✅ REAL' : '❓ UNKNOWN'}`);
    }
    console.log();

    console.log('=' .repeat(70));
    console.log('  CLEANUP COMPLETE');
    console.log('=' .repeat(70));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('CLEANUP ERROR:', err);
  pool.end().catch(() => {});
  process.exit(1);
});
