/**
 * DRY-RUN Historical Engagement Audit Script
 * Audits the 52 suspect likes associated with student 26020266.
 *
 * CRITICAL SAFETY: Strictly read-only. Does NOT perform any DELETE, UPDATE, or INSERT.
 */

const db = require('../db');

async function auditHistoricalLikes() {
  console.log('================================================================');
  console.log('  SEMESTER LIBRARY — HISTORICAL ENGAGEMENT AUDIT (DRY-RUN ONLY) ');
  console.log('================================================================\n');

  try {
    const studentId = '26020266';
    const student = await db.get('SELECT studentId, name, role, email, semester FROM students WHERE studentId = ?', studentId);
    console.log('Target Student Profile:');
    console.log(student ? `  Name: ${student.name} | Role: ${student.role} | Semester: ${student.semester} | Email: ${student.email || 'N/A'}` : '  [Student record not found in students table]');
    console.log('----------------------------------------------------------------\n');

    // Fetch all likes by student 26020266
    const likes = await db.all('SELECT fileId, studentId FROM file_likes WHERE studentId = ? ORDER BY fileId ASC', studentId);
    console.log(`Total like rows registered for ${studentId}: ${likes.length}\n`);

    if (likes.length === 0) {
      console.log('No historical likes found for this student.');
      return;
    }

    const provenSynthetic = [];
    const uncertainOrganic = [];

    for (const like of likes) {
      const file = await db.get(
        'SELECT id, title, originalName, semester, subject, uploadedBy, uploadedAt, sizeBytes FROM files WHERE id = ?',
        like.fileId
      );

      if (!file) {
        provenSynthetic.push({
          fileId: like.fileId,
          reason: 'ORPHANED_RECORD (Referenced file has already been deleted)',
          confidence: 'PROVEN_SYNTHETIC',
          file: null
        });
        continue;
      }

      // Criterion 1: Files seeded in seed.js (IDs 1 through 10)
      if (file.id <= 10) {
        provenSynthetic.push({
          fileId: file.id,
          title: file.title,
          uploadedBy: file.uploadedBy,
          uploadedAt: file.uploadedAt,
          reason: 'SEED_SCRIPT_FABRICATION (File ID <= 10 seeded via Math.random() > 0.4 loop in seed.js)',
          confidence: 'PROVEN_SYNTHETIC'
        });
        continue;
      }

      // Criterion 2: Files uploaded by 26020266 where server.js auto-liked on upload
      if (file.uploadedBy === studentId) {
        provenSynthetic.push({
          fileId: file.id,
          title: file.title,
          uploadedBy: file.uploadedBy,
          uploadedAt: file.uploadedAt,
          reason: 'SELF_UPLOAD_AUTOLIKE_BUG (server.js auto-inserted like for 26020266 on every upload by this user)',
          confidence: 'PROVEN_SYNTHETIC'
        });
        continue;
      }

      // Criterion 3: Files uploaded by other teachers/students
      uncertainOrganic.push({
        fileId: file.id,
        title: file.title,
        uploadedBy: file.uploadedBy,
        uploadedAt: file.uploadedAt,
        reason: 'OTHER_UPLOADER (May be genuine student interaction or manual QA test click)',
        confidence: 'UNCERTAIN_POSSIBLE_ORGANIC'
      });
    }

    console.log('----------------------------------------------------------------');
    console.log(`PROVEN SYNTHETIC ROWS (${provenSynthetic.length} rows):`);
    console.log('----------------------------------------------------------------');
    provenSynthetic.forEach((row, i) => {
      console.log(`  ${i + 1}. [File #${row.fileId}] "${row.title || 'N/A'}" (UploadedBy: ${row.uploadedBy || 'N/A'})`);
      console.log(`     Reason: ${row.reason}`);
    });

    console.log('\n----------------------------------------------------------------');
    console.log(`UNCERTAIN / POSSIBLY ORGANIC ROWS (${uncertainOrganic.length} rows):`);
    console.log('----------------------------------------------------------------');
    uncertainOrganic.forEach((row, i) => {
      console.log(`  ${i + 1}. [File #${row.fileId}] "${row.title}" (UploadedBy: ${row.uploadedBy})`);
      console.log(`     Reason: ${row.reason}`);
    });

    console.log('\n================================================================');
    console.log('AUDIT SUMMARY:');
    console.log(`  Total suspect likes examined: ${likes.length}`);
    console.log(`  Proven synthetic rows:        ${provenSynthetic.length} (${((provenSynthetic.length / likes.length) * 100).toFixed(1)}%)`);
    console.log(`  Uncertain / organic rows:     ${uncertainOrganic.length} (${((uncertainOrganic.length / likes.length) * 100).toFixed(1)}%)`);
    console.log('================================================================');
    console.log('SAFE CLEANUP STRATEGY:');
    console.log('  1. Zero automatic deletion was executed (DRY-RUN validated).');
    console.log('  2. For the proven synthetic rows, an administrator may safely purge using:');
    console.log(`     DELETE FROM file_likes WHERE studentId = '${studentId}' AND fileId IN (${provenSynthetic.map(r => r.fileId).join(', ')});`);
    console.log('  3. The uncertain rows should NOT be deleted to preserve potential authentic student activity.');
    console.log('================================================================\n');

  } catch (err) {
    console.error('Audit execution error:', err);
  } finally {
    process.exit(0);
  }
}

auditHistoricalLikes();
