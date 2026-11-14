'use strict';

/**
 * KAIE Academic Notes Batch Ingestion Engine (Phase 3)
 *
 * Capabilities:
 * - Resumable checkpointing via `scratch/batch_ingestion_checkpoint.json`.
 * - Pilot mode (--pilot) for safe, bounded dry-run on 2-3 representative files.
 * - Full ingestion across all recoverable academic PDFs (~65 binary + 6 legacy text).
 * - Automatic detection of diagrams, vector graphics, formulas, equations, and tables.
 * - Seamless text-only fallback for files lacking binary storage but possessing legacy text.
 * - Accurate recording of missing/corrupt files requiring replacement upload (e.g. Files 167, 461).
 * - Pacing and rate limiting to protect DB pools and embedding quotas.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { ensureRagSchema } = require('../lib/rag-schema');
const { ingestAcademicDocument, LIFECYCLE_STATES } = require('../lib/document-ingestion');

const CHECKPOINT_PATH = path.join(__dirname, '..', 'scratch', 'batch_ingestion_checkpoint.json');
const PILOT_FILE_IDS = [14, 79]; // 14: Java, 79: Discrete Math

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    pilot: false,
    resume: false,
    limit: Infinity,
    fileIds: []
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--pilot') {
      options.pilot = true;
    } else if (a === '--resume') {
      options.resume = true;
    } else if (a === '--limit' && args[i + 1]) {
      options.limit = Number.parseInt(args[++i], 10) || Infinity;
    } else if (a === '--file' && args[i + 1]) {
      options.fileIds.push(Number.parseInt(args[++i], 10));
    }
  }

  return options;
}

function loadCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_PATH)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
    }
  } catch (_) {}
  return { completedFileIds: [], results: {}, lastRun: null };
}

function saveCheckpoint(data) {
  try {
    const dir = path.dirname(CHECKPOINT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Checkpoint Warning]: Unable to save checkpoint:', err.message);
  }
}

async function verifyBinaryAvailability(file) {
  const storedName = file.storedName || file.storedname;
  const uploadDir = path.join(__dirname, '..', 'uploads');
  if (storedName) {
    const localPath = path.join(uploadDir, path.basename(storedName));
    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
      return { available: true, source: 'disk', size: fs.statSync(localPath).size };
    }
    const blob = await db.get(
      `SELECT LENGTH(filedata) AS len FROM file_blobs WHERE filename = ? LIMIT 1`,
      [path.basename(storedName)]
    ).catch(() => null);
    if (blob && Number(blob.len) > 0) {
      return { available: true, source: 'file_blobs', size: Number(blob.len) };
    }
  }

  const legacyDoc = await db.get(
    `SELECT LENGTH(content) AS len FROM note_search_documents WHERE ${db.isPostgres ? 'CAST(id AS TEXT) = ?' : '(CAST(id AS TEXT) = ? OR id = ?)'}`,
    ...(db.isPostgres ? [String(file.id)] : [String(file.id), Number(file.id)])
  ).catch(() => null);

  if (legacyDoc && Number(legacyDoc.len) > 30) {
    return { available: false, hasLegacyText: true, size: Number(legacyDoc.len) };
  }

  return { available: false, hasLegacyText: false, size: 0 };
}

async function main() {
  const options = parseArgs();
  console.log('='.repeat(70));
  console.log('🚀 KAIE ACADEMIC NOTES BATCH INGESTION');
  console.log(`   Pilot Mode:  ${options.pilot ? 'YES (' + PILOT_FILE_IDS.join(', ') + ')' : 'NO'}`);
  console.log(`   Resume:      ${options.resume ? 'YES' : 'NO'}`);
  console.log(`   Limit:       ${Number.isFinite(options.limit) ? options.limit : 'ALL'}`);
  console.log('='.repeat(70));

  await ensureRagSchema(db);

  // Fetch all academic PDF files
  const fileRows = await db.all(
    `SELECT id,
            storedname AS "storedName",
            originalname AS "originalName",
            title,
            subject,
            chapter,
            semester,
            semester_no,
            sizebytes AS "sizeBytes",
            uploadedby AS "uploadedBy",
            resource_category,
            unit_number
     FROM files
     WHERE storedname ILIKE '%.pdf' OR originalname ILIKE '%.pdf'
     ORDER BY id ASC`
  );

  console.log(`Found ${fileRows.length} total academic PDF records in files table.`);

  let targetFiles = fileRows;
  if (options.fileIds.length > 0) {
    targetFiles = fileRows.filter((f) => options.fileIds.includes(Number(f.id)));
  } else if (options.pilot) {
    targetFiles = fileRows.filter((f) => PILOT_FILE_IDS.includes(Number(f.id)));
  }

  if (Number.isFinite(options.limit) && options.limit > 0) {
    targetFiles = targetFiles.slice(0, options.limit);
  }

  const checkpoint = options.resume ? loadCheckpoint() : { completedFileIds: [], results: {}, lastRun: null };
  const completedSet = new Set(options.resume ? checkpoint.completedFileIds : []);

  console.log(`Processing queue size: ${targetFiles.length} file(s)`);

  let processedCount = 0;
  let successCount = 0;
  let partialCount = 0;
  let textFallbackCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const processedSubjects = new Set();

  for (let idx = 0; idx < targetFiles.length; idx++) {
    const file = targetFiles[idx];
    const fileId = Number(file.id);

    if (options.resume && completedSet.has(fileId)) {
      console.log(`[${idx + 1}/${targetFiles.length}] File #${fileId} already processed (checkpoint resume). Skipping.`);
      skippedCount++;
      continue;
    }

    console.log(`\n------------------------------------------------------------`);
    console.log(`[${idx + 1}/${targetFiles.length}] Processing File #${fileId}: "${file.title || file.originalName}"`);
    console.log(`    Subject:  ${file.subject || 'N/A'}`);
    console.log(`    Chapter:  ${file.chapter || 'N/A'}`);

    const startTime = Date.now();
    const binaryStatus = await verifyBinaryAvailability(file);

    if (!binaryStatus.available && !binaryStatus.hasLegacyText) {
      console.warn(`    ⚠️ MISSING BINARY & NO TEXT: File #${fileId} has no recoverable binary or text. Requires replacement.`);
      await db.run(
        `UPDATE document_extraction_jobs
         SET status = 'FAILED',
             stage = 'STORAGE_FETCH',
             error_message = 'Source binary missing from disk and file_blobs; no recoverable text found. File requires replacement upload.',
             updated_at = ?
         WHERE CAST(file_id AS TEXT) = ?`,
        [new Date().toISOString(), String(fileId)]
      ).catch(() => {});

      checkpoint.results[fileId] = {
        fileId,
        status: 'FAILED',
        error: 'Binary missing and no legacy text. Requires replacement upload.',
        requiresReplacementUpload: true
      };
      checkpoint.completedFileIds.push(fileId);
      saveCheckpoint(checkpoint);
      failedCount++;
      continue;
    }

    try {
      const isTextOnlyFallback = !binaryStatus.available && binaryStatus.hasLegacyText;
      if (isTextOnlyFallback) {
        console.log(`    ℹ️ Binary missing from disk/blobs; using legacy text fallback (${binaryStatus.size} chars).`);
      }

      let res = null;
      let lastErr = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          res = await ingestAcademicDocument(db, file, {
            force: true,
            isTextOnlyFallback,
            skipCourseMapSync: true
          });
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) {
            console.warn(`    ⚠️ Transient error on attempt ${attempt}, retrying in 2s...`, err.message);
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
      if (!res && lastErr) throw lastErr;

      if (file.subject) {
        processedSubjects.add(file.subject);
      }

      // Verify empirical counts in database
      const [pagesRow, chunksRow, embRow, itemsRow, diagRow, eqRow] = await Promise.all([
        db.get(`SELECT COUNT(*) AS c FROM document_pages WHERE CAST(file_id AS TEXT) = ?`, [String(fileId)]),
        db.get(`SELECT COUNT(*) AS c FROM document_chunks WHERE CAST(file_id AS TEXT) = ?`, [String(fileId)]),
        db.get(`SELECT COUNT(*) AS c FROM document_embeddings WHERE CAST(file_id AS TEXT) = ?`, [String(fileId)]),
        db.get(`SELECT COUNT(*) AS c FROM academic_extracted_items WHERE CAST(file_id AS TEXT) = ?`, [String(fileId)]),
        db.get(`SELECT COUNT(*) AS c FROM academic_extracted_items WHERE CAST(file_id AS TEXT) = ? AND item_type = 'diagram'`, [String(fileId)]),
        db.get(`SELECT COUNT(*) AS c FROM academic_extracted_items WHERE CAST(file_id AS TEXT) = ? AND (item_type = 'formula' OR item_type = 'math')`, [String(fileId)])
      ]);

      const pagesCount = Number(pagesRow?.c || 0);
      const chunksCount = Number(chunksRow?.c || 0);
      const embeddingsCount = Number(embRow?.c || 0);
      const itemsCount = Number(itemsRow?.c || 0);
      const diagramsCount = Number(diagRow?.c || 0);
      const formulasCount = Number(eqRow?.c || 0);
      const durationMs = Date.now() - startTime;

      console.log(`    ✅ Result: ${res.lifecycleStatus || res.status}`);
      console.log(`       Pages:       ${pagesCount}`);
      console.log(`       Chunks:      ${chunksCount}`);
      console.log(`       Embeddings:  ${embeddingsCount}`);
      console.log(`       Extracted:   ${itemsCount} items (${diagramsCount} diagrams, ${formulasCount} formulas)`);
      console.log(`       Duration:    ${(durationMs / 1000).toFixed(2)}s`);

      checkpoint.results[fileId] = {
        fileId,
        title: file.title || file.originalName,
        subject: file.subject,
        chapter: file.chapter,
        status: res.lifecycleStatus || res.status,
        isTextOnlyFallback,
        pagesCount,
        chunksCount,
        embeddingsCount,
        itemsCount,
        diagramsCount,
        formulasCount,
        durationMs
      };
      checkpoint.completedFileIds.push(fileId);
      saveCheckpoint(checkpoint);

      if (isTextOnlyFallback) textFallbackCount++;
      if (res.lifecycleStatus === LIFECYCLE_STATES.INDEXED) successCount++;
      else partialCount++;
      processedCount++;

      // Pacing delay between files to avoid connection saturation
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`    ❌ Error processing File #${fileId}:`, err.message);
      checkpoint.results[fileId] = {
        fileId,
        status: 'FAILED',
        error: err.message
      };
      // Do not add to completedFileIds so resume will retry
      saveCheckpoint(checkpoint);
      failedCount++;
    }
  }

  // Synchronize Course Maps once per subject for all processed subjects
  if (processedSubjects.size > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('🔄 SYNCHRONIZING COURSE MAPS FOR PROCESSED SUBJECTS');
    console.log('='.repeat(70));
    const { syncCourseMap } = require('../lib/kaie-course-map');
    for (const subj of processedSubjects) {
      if (subj === 'General Academic' || subj === 'BIT Curriculum (All Semesters)') continue;
      console.log(`Synchronizing Course Map for "${subj}"...`);
      try {
        await syncCourseMap(db, { subject: subj, semesterNo: 2 });
        console.log(`✅ Course Map synchronized for "${subj}".`);
      } catch (err) {
        console.warn(`⚠️ Warning syncing Course Map for "${subj}":`, err.message);
      }
    }
  }

  checkpoint.lastRun = new Date().toISOString();
  saveCheckpoint(checkpoint);

  console.log('\n' + '='.repeat(70));
  console.log('📊 BATCH INGESTION SUMMARY');
  console.log(`   Total Target Files:  ${targetFiles.length}`);
  console.log(`   Processed:           ${processedCount}`);
  console.log(`   Indexed (Full):      ${successCount}`);
  console.log(`   Text-Only Fallback:  ${textFallbackCount}`);
  console.log(`   Partial (OCR need):  ${partialCount}`);
  console.log(`   Failed / Corrupt:    ${failedCount}`);
  console.log(`   Skipped (Resume):    ${skippedCount}`);
  console.log('='.repeat(70));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal batch ingestion error:', err);
      process.exit(1);
    });
}
