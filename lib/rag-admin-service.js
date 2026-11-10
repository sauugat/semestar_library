'use strict';

const { ensureRagSchema } = require('./rag-schema');
const { ensureIndex, indexNote, syncMissingRagDocuments } = require('./note-search');
const { ingestAcademicDocument, processDocumentIngestionJobs } = require('./document-ingestion');
const { retrieveAcademicEvidence } = require('./hybrid-rag-engine');

function safeParseJson(str, fallback) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch (_) {
    return fallback;
  }
}

/**
 * Phase 9: Admin Document Indexing Dashboard Summary.
 * Strictly scopes to academic library documents (`files` table) and never exposes private student data.
 */
async function getRagIndexingDashboard(db) {
  await ensureIndex(db);
  await ensureRagSchema(db);

  const allFiles = await db.all(`
    SELECT f.id, f.title, f.originalName, f.storedName, f.subject, f.chapter,
           f.semester, f.semester_no, f.visibility, f.audience_scope, f.sizeBytes, f.uploadedAt,
           nsd.extraction_status AS legacy_status, nsd.extraction_error AS legacy_error, nsd.indexed_at AS legacy_indexed_at,
           j.status AS job_status, j.stage AS job_stage, j.doc_version, j.file_checksum,
           j.ocr_required, j.ocr_applied, j.pages_total, j.pages_extracted,
           j.chunks_total, j.embeddings_total, j.extraction_quality,
           j.error_message AS job_error, j.updated_at AS job_updated_at, j.completed_at
    FROM files f
    LEFT JOIN note_search_documents nsd ON nsd.id = f.id
    LEFT JOIN document_extraction_jobs j ON j.file_id = CAST(f.id AS TEXT)
    WHERE COALESCE(f.visibility, 'students') != 'private'
      AND COALESCE(f.audience_scope, 'general') != 'private'
    ORDER BY f.id DESC
  `);

  let totalDocuments = 0;
  let indexedDocuments = 0;
  let processingDocuments = 0;
  let failedDocuments = 0;
  let partialDocuments = 0;
  let ocrRequiredDocuments = 0;
  let lastIndexingTime = null;
  const extractionErrors = [];
  const documents = [];

  for (const row of allFiles || []) {
    totalDocuments += 1;
    const jobStatus = row.job_status || mapLegacyStatus(row.legacy_status);
    const isOcrRequired = Boolean(Number(row.ocr_required) === 1 || /ocr/i.test(String(row.legacy_error || row.job_error || '')));
    const errorMessage = row.job_error || row.legacy_error || null;
    const indexedAt = row.completed_at || row.job_updated_at || row.legacy_indexed_at || null;

    if (indexedAt && (!lastIndexingTime || indexedAt > lastIndexingTime)) {
      lastIndexingTime = indexedAt;
    }

    if (jobStatus === 'INDEXED') {
      indexedDocuments += 1;
    } else if (jobStatus === 'PARTIAL') {
      partialDocuments += 1;
    } else if (jobStatus === 'FAILED') {
      failedDocuments += 1;
    } else if (['UPLOADED', 'QUEUED', 'PROCESSING', 'EXTRACTED', 'CHUNKED', 'EMBEDDED', 'RETRYING'].includes(jobStatus)) {
      processingDocuments += 1;
    } else {
      processingDocuments += 1;
    }

    if (isOcrRequired) {
      ocrRequiredDocuments += 1;
    }

    if (errorMessage || jobStatus === 'FAILED' || jobStatus === 'PARTIAL') {
      extractionErrors.push({
        fileId: row.id,
        title: row.title || row.originalName,
        subject: row.subject || null,
        status: jobStatus,
        ocrRequired: isOcrRequired,
        errorMessage: errorMessage || 'Document processing incomplete',
        updatedAt: indexedAt
      });
    }

    documents.push({
      id: row.id,
      title: row.title || row.originalName,
      originalName: row.originalName,
      subject: row.subject || null,
      chapter: row.chapter || null,
      semester: row.semester || (row.semester_no ? `Semester ${row.semester_no}` : null),
      status: jobStatus,
      stage: row.job_stage || jobStatus,
      docVersion: Number(row.doc_version) || 1,
      fileChecksum: row.file_checksum || null,
      ocrRequired: isOcrRequired,
      ocrApplied: Boolean(Number(row.ocr_applied) === 1),
      pagesTotal: Number(row.pages_total) || 0,
      pagesExtracted: Number(row.pages_extracted) || 0,
      chunksTotal: Number(row.chunks_total) || 0,
      embeddingsTotal: Number(row.embeddings_total) || 0,
      extractionQuality: row.extraction_quality !== null && row.extraction_quality !== undefined ? Number(row.extraction_quality) : null,
      errorMessage,
      indexedAt
    });
  }

  return {
    totalDocuments,
    indexedDocuments,
    processingDocuments,
    failedDocuments,
    partialDocuments,
    ocrRequiredDocuments,
    lastIndexingTime,
    extractionErrors,
    documents
  };
}

function mapLegacyStatus(legacyStatus) {
  const s = String(legacyStatus || '').toLowerCase();
  if (s === 'indexed') return 'INDEXED';
  if (s === 'empty') return 'PARTIAL';
  if (s === 'error' || s === 'unsupported' || s === 'too_large') return 'FAILED';
  return 'QUEUED';
}

/**
 * Phase 9: Inspect a specific academic document's extracted text, pages, chunks, topics, and errors.
 * Never exposes private student content.
 */
async function inspectDocumentIndex(db, fileId) {
  await ensureIndex(db);
  await ensureRagSchema(db);

  const file = await db.get(
    `SELECT id, title, originalName, storedName, subject, chapter, semester, semester_no,
            visibility, audience_scope, sizeBytes, uploadedAt
     FROM files
     WHERE id = ?`,
    [Number(fileId)]
  );

  if (!file) return null;
  if (String(file.visibility || '').toLowerCase() === 'private' || String(file.audience_scope || '').toLowerCase() === 'private') {
    const err = new Error('Private user files cannot be inspected via the academic RAG dashboard.');
    err.statusCode = 403;
    throw err;
  }

  const fidStr = String(file.id);
  const [job, legacyDoc, pages, chunks, topicMeta, graphEdges, versions] = await Promise.all([
    db.get(`SELECT * FROM document_extraction_jobs WHERE file_id = ?`, [fidStr]),
    db.get(`SELECT * FROM note_search_documents WHERE id = ?`, [Number(file.id)]),
    db.all(`SELECT * FROM document_pages WHERE file_id = ? ORDER BY page_number ASC`, [fidStr]),
    db.all(`SELECT id, chunk_index, parent_chunk_id, chunk_level, page_start, page_end, chapter, unit, section_heading, heading_path, content, token_count, content_hash, topics_json, terminology_json, has_table, has_definition FROM document_chunks WHERE file_id = ? ORDER BY chunk_index ASC`, [fidStr]),
    db.get(`SELECT * FROM document_topic_metadata WHERE file_id = ?`, [fidStr]),
    db.all(`SELECT * FROM academic_knowledge_graph WHERE file_id = ?`, [fidStr]),
    db.all(`SELECT * FROM document_index_versions WHERE file_id = ? ORDER BY doc_version DESC`, [fidStr])
  ]);

  const extractedText = (pages && pages.length > 0)
    ? pages.map((p) => p.cleaned_text || p.raw_text).filter(Boolean).join('\n\f\n')
    : (legacyDoc ? legacyDoc.content : '');

  return {
    file: {
      id: file.id,
      title: file.title || file.originalName,
      originalName: file.originalName,
      subject: file.subject,
      chapter: file.chapter,
      semester: file.semester || (file.semester_no ? `Semester ${file.semester_no}` : null),
      sizeBytes: file.sizeBytes,
      uploadedAt: file.uploadedAt
    },
    indexingStatus: {
      status: (job && job.status) || mapLegacyStatus(legacyDoc && legacyDoc.extraction_status),
      stage: (job && job.stage) || 'INDEXED',
      docVersion: (job && job.doc_version) || 1,
      fileChecksum: (job && job.file_checksum) || null,
      ocrRequired: Boolean(job && Number(job.ocr_required) === 1),
      ocrApplied: Boolean(job && Number(job.ocr_applied) === 1),
      extractionQuality: job ? Number(job.extraction_quality) : null,
      errorMessage: (job && job.error_message) || (legacyDoc && legacyDoc.extraction_error) || null,
      diagnostics: job ? safeParseJson(job.diagnostics_json, {}) : {},
      updatedAt: (job && job.updated_at) || (legacyDoc && legacyDoc.indexed_at) || null
    },
    extractedText,
    pages: (pages || []).map((p) => ({
      pageNumber: p.page_number,
      charCount: p.char_count,
      isEmpty: Boolean(p.is_empty),
      isScanned: Boolean(p.is_scanned),
      ocrApplied: Boolean(p.ocr_applied),
      extractionConfidence: p.extraction_confidence,
      headings: safeParseJson(p.headings_json, []),
      tables: safeParseJson(p.tables_json, []),
      textPreview: String(p.cleaned_text || '').slice(0, 500)
    })),
    academicMetadata: topicMeta ? {
      title: topicMeta.title,
      subject: topicMeta.subject,
      subjectCode: topicMeta.subject_code,
      semesterNo: topicMeta.semester_no,
      chapter: topicMeta.chapter,
      unit: topicMeta.unit,
      sectionHeadings: safeParseJson(topicMeta.section_headings_json, []),
      mainTopics: safeParseJson(topicMeta.main_topics_json, []),
      subtopics: safeParseJson(topicMeta.subtopics_json, []),
      terminology: safeParseJson(topicMeta.terminology_json, []),
      relatedConcepts: safeParseJson(topicMeta.related_concepts_json, []),
      summary: topicMeta.summary,
      learningObjectives: safeParseJson(topicMeta.learning_objectives_json, []),
      confidence: topicMeta.confidence,
      provenance: topicMeta.provenance
    } : null,
    chunks: (chunks || []).map((c) => ({
      id: c.id,
      chunkIndex: c.chunk_index,
      parentChunkId: c.parent_chunk_id,
      chunkLevel: c.chunk_level,
      pageStart: c.page_start,
      pageEnd: c.page_end,
      sectionHeading: c.section_heading,
      headingPath: c.heading_path,
      tokenCount: c.token_count,
      contentHash: c.content_hash,
      topics: safeParseJson(c.topics_json, []),
      terminology: safeParseJson(c.terminology_json, []),
      hasTable: Boolean(c.has_table),
      hasDefinition: Boolean(c.has_definition),
      content: c.content
    })),
    knowledgeGraphEdgesCount: (graphEdges || []).length,
    versions: versions || []
  };
}

/**
 * Phase 9: Trigger re-indexing for a single document or all library documents.
 */
async function triggerDocumentReindex(db, fileId, options = {}) {
  await ensureIndex(db);
  await ensureRagSchema(db);
  const file = await db.get(`SELECT * FROM files WHERE id = ?`, [Number(fileId)]);
  if (!file) {
    const err = new Error('Document not found.');
    err.statusCode = 404;
    throw err;
  }

  // If raw content already exists in note_search_documents and the physical file blob isn't in local tmp,
  // allow re-indexing from either the physical file or the stored extracted text.
  try {
    const res = await indexNote(db, file, { buffer: options.buffer, ocrProvider: options.ocrProvider });
    if (res.status === 'error' && !options.buffer) {
      const legacy = await db.get(`SELECT content FROM note_search_documents WHERE id = ?`, [Number(file.id)]);
      if (legacy && legacy.content) {
        const ragRes = await ingestAcademicDocument(db, {
          ...file,
          originalName: `${file.title || 'document'}.txt`
        }, { rawContent: legacy.content, force: true });
        return {
          fileId: file.id,
          status: 'ready',
          lifecycleStatus: ragRes.lifecycleStatus,
          docVersion: ragRes.docVersion,
          chunksCount: ragRes.chunksCount,
          pagesCount: ragRes.pagesCount
        };
      }
    }
    const ragRes = await ingestAcademicDocument(db, file, {
      buffer: options.buffer,
      ocrProvider: options.ocrProvider,
      force: true
    });
    return {
      fileId: file.id,
      status: res.status,
      lifecycleStatus: ragRes.lifecycleStatus || (res.status === 'indexed' ? 'INDEXED' : 'FAILED'),
      docVersion: ragRes.docVersion || 1,
      chunksCount: ragRes.chunksCount || 0,
      pagesCount: ragRes.pagesCount || 0,
      error: ragRes.error || res.error || null
    };
  } catch (err) {
    return {
      fileId: file.id,
      status: 'failed',
      lifecycleStatus: 'FAILED',
      error: err.message
    };
  }
}

async function triggerReindexAllDocuments(db, options = {}) {
  await ensureIndex(db);
  await ensureRagSchema(db);
  const files = await db.all(`SELECT id FROM files ORDER BY id ASC`);
  const results = [];
  for (const f of files || []) {
    const r = await triggerDocumentReindex(db, f.id, options);
    results.push(r);
  }
  return {
    totalProcessed: results.length,
    indexedCount: results.filter((r) => r.lifecycleStatus === 'INDEXED').length,
    failedCount: results.filter((r) => r.lifecycleStatus === 'FAILED').length,
    results
  };
}

/**
 * Phase 9: Verify document searchability by running a sample hybrid retrieval query against it.
 */
async function verifyDocumentSearchability(db, fileId, sampleQuery = '') {
  const detail = await inspectDocumentIndex(db, fileId);
  if (!detail) return null;

  const effectiveQuery = sampleQuery ||
    (detail.academicMetadata && detail.academicMetadata.mainTopics && detail.academicMetadata.mainTopics[0]) ||
    detail.file.title ||
    detail.file.subject ||
    '';

  const retrieval = await retrieveAcademicEvidence(db, {
    query: effectiveQuery,
    maxChunks: 10,
    maxDocuments: 10
  });

  const matchedDoc = (retrieval.documents || []).find((d) => String(d.id) === String(fileId));
  const matchedPassages = (retrieval.passages || []).filter((p) => String(p.fileId) === String(fileId));

  return {
    fileId: detail.file.id,
    title: detail.file.title,
    queryTested: effectiveQuery,
    searchable: Boolean(matchedDoc && matchedPassages.length > 0),
    relevanceScore: matchedDoc ? matchedDoc.bestRelevanceScore : 0,
    matchedPassagesCount: matchedPassages.length,
    sampleCitations: matchedPassages.slice(0, 3).map((p) => p.citation)
  };
}

module.exports = {
  getRagIndexingDashboard,
  inspectDocumentIndex,
  triggerDocumentReindex,
  triggerReindexAllDocuments,
  verifyDocumentSearchability
};
