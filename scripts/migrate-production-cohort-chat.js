'use strict';

/**
 * scripts/migrate-production-cohort-chat.js
 *
 * Production-safe migration script for Cohort Chat schema (Phase 2A / 2C).
 * Uses migrations/003-cohort-chat-production.js inside a single PostgreSQL transaction.
 *
 * Usage:
 *   node scripts/migrate-production-cohort-chat.js            # Dry-run audit report
 *   node scripts/migrate-production-cohort-chat.js --apply    # Transactional execution
 */

const db = require('../db');
const { migrateProductionCohortChat } = require('../migrations/003-cohort-chat-production');

const SUPPORT_TABLES = [
  'chat_send_keys',
  'chat_attachment_ownership',
  'chat_room_read_receipts',
  'chat_room_typing',
  'chat_pinned_announcements',
  'chat_room_revocations',
  'chat_online_sessions',
  'chat_realtime_memberships',
  'chat_realtime_outbox',
  'chat_recycle_jobs',
  'chat_erasure_files',
  'chat_lifecycle_audit'
];

async function run() {
  const isApply = process.argv.includes('--apply');
  const isDryRun = !isApply;

  console.log('=============================================================================');
  console.log(`  Cohort Chat Production Migration — Mode: ${isDryRun ? 'DRY-RUN AUDIT' : 'APPLY MIGRATION'}`);
  console.log('=============================================================================');

  if (!db.isPostgres && isApply) {
    console.error('ERROR: Production migration requires a PostgreSQL database.');
    process.exit(1);
  }

  // 1. Check schema_migrations
  let appliedMigration = null;
  try {
    appliedMigration = await db.get("SELECT id, applied_at FROM schema_migrations WHERE id = '003-cohort-chat-production'");
  } catch (_) {}

  console.log(`\nMigration '003-cohort-chat-production' status: ${appliedMigration ? `APPLIED at ${appliedMigration.applied_at || appliedMigration.appliedat}` : 'NOT YET APPLIED'}`);

  // 2. Audit Core Cohort Entities
  const cohorts = await db.all("SELECT id, group_code, current_semester, status FROM cohorts WHERE status = 'active' ORDER BY current_semester");
  console.log(`\nActive Cohorts (${cohorts.length}):`);
  for (const c of cohorts) {
    console.log(`  - [${c.group_code}] Sem ${c.current_semester || c.currentSemester} (ID: ${c.id})`);
  }

  const rooms = await db.all("SELECT id, cohort_id, kind, status, realtime_epoch FROM chat_groups WHERE status = 'active' AND kind = 'cohort'");
  console.log(`\nActive Cohort Chat Rooms (${rooms.length}):`);
  for (const r of rooms) {
    console.log(`  - Room ID: ${r.id} (Cohort: ${r.cohort_id || r.cohortId}, Epoch: ${r.realtime_epoch || r.realtimeEpoch})`);
  }

  const slots = await db.all("SELECT group_code, current_chat_group_id FROM chat_group_slots");
  console.log(`\nChat Group Slots (${slots.length}):`);
  for (const s of slots) {
    console.log(`  - ${s.group_code} -> Room: ${s.current_chat_group_id}`);
  }

  // 3. Audit chat_messages columns
  let chatMsgCols = [];
  if (db.isPostgres) {
    chatMsgCols = (await db.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'chat_messages'")).map(r => r.column_name);
  } else {
    chatMsgCols = (await db.all("PRAGMA table_info(chat_messages)")).map(r => r.name);
  }
  const hasChatGroupId = chatMsgCols.includes('chat_group_id');
  const hasClientId = chatMsgCols.includes('client_id');
  console.log(`\nchat_messages columns:`);
  console.log(`  - chat_group_id column: ${hasChatGroupId ? 'PRESENT' : 'MISSING (will be added)'}`);
  console.log(`  - client_id column:     ${hasClientId ? 'PRESENT' : 'MISSING (will be added)'}`);

  const totalMessages = await db.get("SELECT COUNT(*) AS c FROM chat_messages");
  console.log(`  - Total messages in table: ${totalMessages?.c || 0} (will be preserved safely)`);

  // 4. Audit Support Tables
  console.log(`\nSupport Tables Audit:`);
  for (const table of SUPPORT_TABLES) {
    let exists = false;
    if (db.isPostgres) {
      const res = await db.all("SELECT table_name FROM information_schema.tables WHERE table_name = ?", table);
      exists = res.length > 0;
    } else {
      const res = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table);
      exists = res.length > 0;
    }
    console.log(`  - ${table}: ${exists ? 'EXISTS' : 'MISSING (will be created)'}`);
  }

  // 5. Quarantined Legacy Room Audit
  const legacyRoom = await db.get("SELECT id, status FROM chat_groups WHERE kind = 'legacy'");
  console.log(`\nLegacy Quarantined Room: ${legacyRoom ? `EXISTS (ID: ${legacyRoom.id}, Status: ${legacyRoom.status})` : 'MISSING (will be created)'}`);

  if (isDryRun) {
    console.log('\n-----------------------------------------------------------------------------');
    console.log('DRY-RUN COMPLETE. No database changes were made.');
    console.log('To execute this migration, run: node scripts/migrate-production-cohort-chat.js --apply');
    console.log('-----------------------------------------------------------------------------');
    process.exit(0);
  }

  // APPLY PHASE
  console.log('\n>>> Applying 003-cohort-chat-production migration...');
  const result = await migrateProductionCohortChat(db);
  console.log('Migration result:', JSON.stringify(result, null, 2));
  console.log('>>> Migration successfully applied!');
  process.exit(0);
}

if (require.main === module) {
  run().catch(err => {
    console.error('\n[MIGRATION ERROR]:', err);
    process.exit(1);
  });
}

module.exports = { run };
