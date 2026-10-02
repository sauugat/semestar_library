/**
 * Targeted Cleanup Script: 50 Proven Synthetic Likes for Student 26020266
 *
 * Requirements:
 * 1. Export IDs and details being removed to backup/rollback file.
 * 2. Dry-run verify exact matching rows.
 * 3. Delete ONLY the exact 50 proven synthetic rows.
 * 4. NEVER touch the 2 uncertain rows (File IDs 149, 172).
 * 5. Verify the post-deletion count in the database is exactly 2.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

const TARGET_STUDENT = '26020266';
const PRESERVED_FILE_IDS = [149, 172];

async function runCleanup() {
  console.log('================================================================');
  console.log('  SEMESTER LIBRARY — HISTORICAL SYNTHETIC LIKES CLEANUP         ');
  console.log('================================================================\n');

  try {
    // 1. Fetch all likes currently belonging to TARGET_STUDENT
    const allLikes = await db.all(
      'SELECT fileId, studentId FROM file_likes WHERE studentId = ? ORDER BY fileId ASC',
      TARGET_STUDENT
    );
    console.log(`Initial DB State: Found ${allLikes.length} total like rows for student ${TARGET_STUDENT}`);

    if (allLikes.length !== 52) {
      console.warn(`WARNING: Expected 52 total likes, but found ${allLikes.length}. Aborting for safety.`);
      process.exit(1);
    }

    const provenSynthetic = [];
    const preservedRows = [];

    for (const like of allLikes) {
      const fileId = Number(like.fileId);
      const file = await db.get(
        'SELECT id, title, originalName, semester, subject, uploadedBy, uploadedAt FROM files WHERE id = ?',
        fileId
      );

      // Check if it's one of the preserved uncertain rows
      if (PRESERVED_FILE_IDS.includes(fileId)) {
        preservedRows.push({
          fileId,
          title: file?.title || 'Unknown',
          uploadedBy: file?.uploadedBy || 'Unknown',
          uploadedAt: file?.uploadedAt || null,
          status: 'PRESERVED_UNCERTAIN_ROW'
        });
        continue;
      }

      // Check proven synthetic conditions
      let reason = '';
      if (!file) {
        reason = 'ORPHANED_RECORD (Referenced file has already been deleted)';
      } else if (file.id <= 10) {
        reason = 'SEED_SCRIPT_FABRICATION (File ID <= 10 from database-seed.js)';
      } else if (file.uploadedBy === TARGET_STUDENT) {
        reason = 'SELF_UPLOAD_AUTOLIKE_BUG (server.js auto-liked on upload by 26020266)';
      } else {
        throw new Error(`Unexpected like record for fileId ${fileId} uploaded by ${file.uploadedBy}. Safety abort.`);
      }

      provenSynthetic.push({
        studentId: TARGET_STUDENT,
        fileId,
        title: file?.title || null,
        uploadedBy: file?.uploadedBy || null,
        uploadedAt: file?.uploadedAt || null,
        reason,
        confidence: 'PROVEN_SYNTHETIC'
      });
    }

    console.log(`\nClassification Summary:`);
    console.log(`  - Proven Synthetic Rows to Delete: ${provenSynthetic.length}`);
    console.log(`  - Uncertain Rows to PRESERVE:       ${preservedRows.length}`);

    if (provenSynthetic.length !== 50 || preservedRows.length !== 2) {
      console.error(`FATAL: Classification mismatch. Expected 50 synthetic & 2 preserved. Found ${provenSynthetic.length} & ${preservedRows.length}. Aborting.`);
      process.exit(1);
    }

    // 2. Export IDs and rollback backup
    const backupData = {
      timestamp: new Date().toISOString(),
      studentId: TARGET_STUDENT,
      deletedCount: provenSynthetic.length,
      preservedCount: preservedRows.length,
      preservedRows,
      deletedRows: provenSynthetic,
      rollbackSql: provenSynthetic.map(r => `INSERT INTO file_likes ("fileId", "studentId") VALUES (${r.fileId}, '${TARGET_STUDENT}') ON CONFLICT DO NOTHING;`)
    };

    const backupPath = path.join(__dirname, 'backup-synthetic-likes-26020266.json');
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf8');
    console.log(`\n✓ Backup & Rollback log written to: ${backupPath}`);

    // 3. Dry-run confirmation
    const targetFileIds = provenSynthetic.map(r => r.fileId);
    console.log(`Target File IDs to remove (${targetFileIds.length}):\n[ ${targetFileIds.join(', ')} ]\n`);
    console.log(`Preserved File IDs (${preservedRows.length}):\n[ ${preservedRows.map(r => r.fileId).join(', ')} ]\n`);

    // Ensure preserved file IDs are strictly excluded
    for (const preservedId of PRESERVED_FILE_IDS) {
      if (targetFileIds.includes(preservedId)) {
        console.error(`CRITICAL SAFETY VIOLATION: Preserved File ID ${preservedId} found in deletion list!`);
        process.exit(1);
      }
    }

    // 4. Execute deletion
    console.log('Executing targeted deletion of the 50 proven synthetic rows...');
    
    // We execute deletion by exact fileId matching in chunks or single parameterized query
    for (const fId of targetFileIds) {
      await db.run('DELETE FROM file_likes WHERE studentId = ? AND fileId = ?', TARGET_STUDENT, fId);
    }

    console.log('✓ Deletion execution finished.');

    // 5. Verification of post-deletion state
    const remainingLikes = await db.all(
      'SELECT fileId, studentId FROM file_likes WHERE studentId = ? ORDER BY fileId ASC',
      TARGET_STUDENT
    );

    console.log(`\nPost-Deletion Verification:`);
    console.log(`  - Remaining like rows for student ${TARGET_STUDENT}: ${remainingLikes.length}`);
    const remainingIds = remainingLikes.map(r => Number(r.fileId));
    console.log(`  - Remaining File IDs: [ ${remainingIds.join(', ')} ]`);

    if (remainingLikes.length === 2 && remainingIds[0] === 149 && remainingIds[1] === 172) {
      console.log('\n================================================================');
      console.log('  SUCCESS: Exactly 50 synthetic rows purged.                    ');
      console.log('  Exactly 2 uncertain rows preserved (File #149 & #172).        ');
      console.log('================================================================\n');
    } else {
      console.error('FATAL: Unexpected post-deletion state! Review database immediately.');
      process.exit(1);
    }

  } catch (err) {
    console.error('Cleanup execution error:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

runCleanup();
