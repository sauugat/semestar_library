/**
 * SEMESTER LIBRARY — TEST/SYNTHETIC DATA DRY-RUN INVENTORY
 * =========================================================
 * This script connects to the production Neon Postgres database, resolves the
 * immutable studentId for all known real users, then scans every relevant table
 * for synthetic / test / bot records.
 *
 * OUTPUT:  A classified inventory printed to stdout.
 * SAFETY:  This script performs **READ-ONLY** queries. It does NOT delete anything.
 *
 * Usage:
 *   node scripts/test-data-dryrun.js
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

// ─── KNOWN REAL USERS (resolve by name) ───
const KNOWN_REAL_NAMES = ['Saugat', 'Sandesh', 'Subarna', 'Torjan Virus', 'Swostika'];

// ─── SYNTHETIC MARKERS ───
const SYNTHETIC_NAME_MARKERS = [
  'Sender User', 'Admin User', 'Student Sem', 'Prof. Sharma',
  'Alice Sender', 'Bob Receiver', 'Student B', 'Test Student',
  'Bot User', 'Smoke Test', 'SMOKE_', 'TEST_',
];

const SYNTHETIC_CONTENT_MARKERS = [
  'SMOKE_', 'TEST_', 'MENTION_', 'automated dispatch',
  'test mention', 'mass mention', 'duplicate mention',
  'broadcast test', 'Alice Sender', 'Bob Receiver',
  'Student B', 'Prof. Sharma',
];

async function main() {
  const client = await pool.connect();
  try {
    console.log('=' .repeat(70));
    console.log('  SEMESTER LIBRARY — TEST DATA DRY-RUN INVENTORY');
    console.log('=' .repeat(70));
    console.log();

    // ───────────────────────────────────────────────────────────────────
    // STEP 1: Resolve real user IDs by name (immutable studentId)
    // ───────────────────────────────────────────────────────────────────
    console.log('STEP 1: RESOLVING REAL USER IDs');
    console.log('-'.repeat(50));

    const realUsersResult = await client.query(
      `SELECT "studentid", "name", "role", "created_at"
       FROM students
       WHERE name = ANY($1)
       ORDER BY name`,
      [KNOWN_REAL_NAMES]
    );

    const KEEP_IDS = new Set();
    const keepList = [];

    for (const row of realUsersResult.rows) {
      KEEP_IDS.add(row.studentid);
      keepList.push({
        studentId: row.studentid,
        name: row.name,
        role: row.role,
        createdAt: row.created_at,
      });
      console.log(`  ✅ KEEP_REAL: ${row.name} → studentId="${row.studentid}" (${row.role})`);
    }

    if (keepList.length === 0) {
      console.log('  ⚠️  No matching real users found by exact name. Check names.');
    }
    console.log();

    // ───────────────────────────────────────────────────────────────────
    // STEP 2: Find ALL student accounts and classify
    // ───────────────────────────────────────────────────────────────────
    console.log('STEP 2: CLASSIFYING ALL STUDENT ACCOUNTS');
    console.log('-'.repeat(50));

    const allStudents = await client.query(
      `SELECT "studentid", "name", "role", "email", "created_at" FROM students ORDER BY created_at`
    );

    const classified = { KEEP_REAL: [], CONFIRMED_SYNTHETIC: [], REVIEW_REQUIRED: [] };

    for (const row of allStudents.rows) {
      if (KEEP_IDS.has(row.studentid)) {
        classified.KEEP_REAL.push(row);
      } else {
        const nameUpper = (row.name || '').toUpperCase();
        const idUpper = (row.studentid || '').toUpperCase();
        const isSynthetic = SYNTHETIC_NAME_MARKERS.some(m =>
          nameUpper.includes(m.toUpperCase()) || idUpper.includes(m.toUpperCase())
        );
        if (isSynthetic) {
          classified.CONFIRMED_SYNTHETIC.push(row);
        } else {
          classified.REVIEW_REQUIRED.push(row);
        }
      }
    }

    console.log(`  KEEP_REAL:           ${classified.KEEP_REAL.length}`);
    for (const r of classified.KEEP_REAL) {
      console.log(`    ✅ ${r.name} (${r.studentid})`);
    }
    console.log(`  CONFIRMED_SYNTHETIC: ${classified.CONFIRMED_SYNTHETIC.length}`);
    for (const r of classified.CONFIRMED_SYNTHETIC) {
      console.log(`    🗑️  ${r.name} (${r.studentid})`);
    }
    console.log(`  REVIEW_REQUIRED:     ${classified.REVIEW_REQUIRED.length}`);
    for (const r of classified.REVIEW_REQUIRED) {
      console.log(`    ❓ ${r.name} (${r.studentid}) — role=${r.role}`);
    }
    console.log();

    const syntheticIds = classified.CONFIRMED_SYNTHETIC.map(r => r.studentid);

    // ───────────────────────────────────────────────────────────────────
    // STEP 3: Count synthetic records per table
    // ───────────────────────────────────────────────────────────────────
    console.log('STEP 3: SYNTHETIC RECORD COUNTS PER TABLE');
    console.log('-'.repeat(50));

    const countByOwner = async (table, ownerCol, label) => {
      try {
        if (syntheticIds.length === 0) {
          console.log(`  ${label}: 0 (no synthetic accounts)`);
          return 0;
        }
        const result = await client.query(
          `SELECT COUNT(*) as cnt FROM ${table} WHERE ${ownerCol} = ANY($1)`,
          [syntheticIds]
        );
        const cnt = parseInt(result.rows[0].cnt, 10);
        console.log(`  ${label}: ${cnt}`);
        return cnt;
      } catch (err) {
        console.log(`  ${label}: (table not found or error: ${err.message})`);
        return 0;
      }
    };

    const countByContent = async (table, contentCol, label) => {
      try {
        const markers = SYNTHETIC_CONTENT_MARKERS.map(m => `%${m}%`);
        const conditions = markers.map((_, i) => `${contentCol} ILIKE $${i + 1}`).join(' OR ');
        const result = await client.query(
          `SELECT COUNT(*) as cnt FROM ${table} WHERE ${conditions}`,
          markers
        );
        const cnt = parseInt(result.rows[0].cnt, 10);
        console.log(`  ${label}: ${cnt}`);
        return cnt;
      } catch (err) {
        console.log(`  ${label}: (error: ${err.message})`);
        return 0;
      }
    };

    const counts = {};
    // Student-owned records
    counts.posts = await countByOwner('posts', 'user_id', 'posts (by synthetic users)');
    counts.postMedia = await countByOwner('post_media', 'post_id',
      'post_media (via synthetic posts)').catch(() => 0);
    // For post_media, need to join through posts
    try {
      if (syntheticIds.length > 0) {
        const pmResult = await client.query(
          `SELECT COUNT(*) as cnt FROM post_media pm
           JOIN posts p ON pm.post_id = p.id
           WHERE p.user_id = ANY($1)`,
          [syntheticIds]
        );
        counts.postMedia = parseInt(pmResult.rows[0].cnt, 10);
        console.log(`  post_media (via synthetic posts, corrected): ${counts.postMedia}`);
      }
    } catch (_) {}

    counts.postLikes = await countByOwner('post_likes', 'user_id', 'post_likes (by synthetic users)');
    counts.postComments = await countByOwner('post_comments', 'user_id', 'post_comments (by synthetic users)');
    counts.postCommentReactions = await countByOwner('post_comment_reactions', 'user_id', 'post_comment_reactions (by synthetic users)');
    counts.chatMessages = await countByOwner('chat_messages', 'studentid', 'chat_messages (by synthetic users)');
    counts.chatReactions = await countByOwner('chat_reactions', 'studentid', 'chat_reactions (by synthetic users)');
    counts.chatReadReceipts = await countByOwner('chat_read_receipts', 'studentid', 'chat_read_receipts (by synthetic users)');
    counts.chatTyping = await countByOwner('chat_typing', 'studentid', 'chat_typing (by synthetic users)');
    counts.chatPinned = await countByOwner('chat_pinned', 'pinnedby', 'chat_pinned (by synthetic users)');
    counts.notifications = await countByOwner('notifications', 'recipientstudentid', 'notifications (to synthetic users)');
    counts.deviceTokens = await countByOwner('student_device_tokens', 'student_id', 'student_device_tokens (synthetic users)');
    counts.files = await countByOwner('files', 'uploadedby', 'files (uploaded by synthetic users)');
    counts.follows = 0;
    try {
      if (syntheticIds.length > 0) {
        const fResult = await client.query(
          `SELECT COUNT(*) as cnt FROM follows
           WHERE "followerid" = ANY($1) OR "followingid" = ANY($1)`,
          [syntheticIds]
        );
        counts.follows = parseInt(fResult.rows[0].cnt, 10);
        console.log(`  follows (involving synthetic users): ${counts.follows}`);
      }
    } catch (err) {
      console.log(`  follows: (error: ${err.message})`);
    }

    // Chat mentions
    try {
      if (syntheticIds.length > 0) {
        const mentionResult = await client.query(
          `SELECT COUNT(*) as cnt FROM chat_message_mentions
           WHERE mentioned_student_id = ANY($1)`,
          [syntheticIds]
        );
        counts.chatMentions = parseInt(mentionResult.rows[0].cnt, 10);
        console.log(`  chat_message_mentions (mentioning synthetic users): ${counts.chatMentions}`);
      }
    } catch (err) {
      console.log(`  chat_message_mentions: (error: ${err.message})`);
      counts.chatMentions = 0;
    }

    // Content-based scan for synthetic chat messages by content markers
    counts.chatMessagesByContent = await countByContent('chat_messages', 'text', 'chat_messages (by content markers)');

    // Push receipt tickets for synthetic users
    counts.pushReceipts = await countByOwner('push_receipt_tickets', 'student_id', 'push_receipt_tickets (synthetic users)').catch(() => 0);

    // Notification prefs for synthetic users
    counts.notifPrefs = await countByOwner('student_notification_preferences', 'student_id', 'student_notification_preferences (synthetic users)').catch(() => 0);

    // Post attachment staging by synthetic users
    counts.postStaging = await countByOwner('post_attachment_staging', 'uploader_student_id', 'post_attachment_staging (synthetic users)').catch(() => 0);

    console.log();

    // ───────────────────────────────────────────────────────────────────
    // STEP 4: Sample synthetic records for review
    // ───────────────────────────────────────────────────────────────────
    console.log('STEP 4: SAMPLE SYNTHETIC RECORDS');
    console.log('-'.repeat(50));

    if (syntheticIds.length > 0) {
      // Sample posts
      try {
        const samplePosts = await client.query(
          `SELECT id, user_id, LEFT(content, 80) as content_preview, type, created_at
           FROM posts WHERE user_id = ANY($1) ORDER BY created_at DESC LIMIT 10`,
          [syntheticIds]
        );
        if (samplePosts.rows.length > 0) {
          console.log('\n  Sample synthetic posts:');
          for (const p of samplePosts.rows) {
            console.log(`    Post #${p.id} by ${p.user_id}: "${p.content_preview}" (${p.type})`);
          }
        }
      } catch (_) {}

      // Sample chat messages
      try {
        const sampleChat = await client.query(
          `SELECT id, studentid, LEFT(text, 80) as text_preview, createdat
           FROM chat_messages WHERE studentid = ANY($1) ORDER BY createdat DESC LIMIT 10`,
          [syntheticIds]
        );
        if (sampleChat.rows.length > 0) {
          console.log('\n  Sample synthetic chat messages:');
          for (const m of sampleChat.rows) {
            console.log(`    Msg #${m.id} by ${m.studentid}: "${m.text_preview}"`);
          }
        }
      } catch (_) {}

      // Sample notifications
      try {
        const sampleNotifs = await client.query(
          `SELECT id, recipientstudentid, type, LEFT(message, 80) as msg_preview, isread
           FROM notifications WHERE recipientstudentid = ANY($1) ORDER BY id DESC LIMIT 10`,
          [syntheticIds]
        );
        if (sampleNotifs.rows.length > 0) {
          console.log('\n  Sample synthetic notification rows:');
          for (const n of sampleNotifs.rows) {
            console.log(`    Notif #${n.id} → ${n.recipientstudentid}: "${n.msg_preview}" (read=${n.isread})`);
          }
        }
      } catch (_) {}
    }

    // Content-marker search across chat messages (regardless of sender)
    try {
      const contentMarker = await client.query(
        `SELECT id, studentid, LEFT(text, 80) as text_preview
         FROM chat_messages
         WHERE text ILIKE '%SMOKE_%' OR text ILIKE '%TEST_%' OR text ILIKE '%MENTION_%'
            OR text ILIKE '%automated dispatch%' OR text ILIKE '%mass mention%'
            OR text ILIKE '%duplicate mention%' OR text ILIKE '%broadcast test%'
         ORDER BY id DESC LIMIT 15`
      );
      if (contentMarker.rows.length > 0) {
        console.log('\n  Chat messages matching content markers (any sender):');
        for (const m of contentMarker.rows) {
          const isReal = KEEP_IDS.has(m.studentid);
          console.log(`    Msg #${m.id} by ${m.studentid}${isReal ? ' (REAL USER)' : ''}: "${m.text_preview}"`);
        }
      }
    } catch (_) {}

    console.log();

    // ───────────────────────────────────────────────────────────────────
    // SUMMARY
    // ───────────────────────────────────────────────────────────────────
    console.log('=' .repeat(70));
    console.log('  DRY-RUN SUMMARY');
    console.log('=' .repeat(70));
    console.log();
    console.log('REAL_ACCOUNT_KEEP_LIST:');
    for (const k of keepList) {
      console.log(`  ${k.name} → ${k.studentId} (${k.role})`);
    }
    console.log();
    console.log(`SYNTHETIC_ACCOUNTS_FOUND: ${classified.CONFIRMED_SYNTHETIC.length}`);
    console.log(`SYNTHETIC_POSTS_FOUND: ${counts.posts}`);
    console.log(`SYNTHETIC_CHAT_MESSAGES_FOUND: ${counts.chatMessages}`);
    console.log(`SYNTHETIC_NOTIFICATION_ROWS_FOUND: ${counts.notifications}`);
    console.log(`SYNTHETIC_DEVICE_TOKENS: ${counts.deviceTokens}`);
    console.log(`SYNTHETIC_FOLLOWS: ${counts.follows}`);
    console.log(`SYNTHETIC_CHAT_MENTIONS: ${counts.chatMentions || 0}`);
    console.log(`AMBIGUOUS_RECORDS (REVIEW_REQUIRED): ${classified.REVIEW_REQUIRED.length}`);
    console.log();

    if (classified.REVIEW_REQUIRED.length > 0) {
      console.log('⚠️  AMBIGUOUS ACCOUNTS — DO NOT AUTO-DELETE:');
      for (const r of classified.REVIEW_REQUIRED) {
        console.log(`    ${r.name} (${r.studentid}) — role=${r.role}`);
      }
      console.log();
    }

    console.log('STATUS: DRY-RUN COMPLETE — NO DATA WAS MODIFIED');
    console.log('To proceed with cleanup, review the output above and run the cleanup script.');
    console.log();
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('DRY-RUN ERROR:', err);
  pool.end().catch(() => {});
  process.exit(1);
});
