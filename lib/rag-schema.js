'use strict';

const ragSchemaPromises = new WeakMap();
const pgVectorSupportMap = new WeakMap();

async function ensureRagSchema(db) {
  if (!db || (typeof db.run !== 'function' && typeof db.exec !== 'function')) {
    return { ok: false, pgVectorSupported: false };
  }
  if (ragSchemaPromises.has(db)) {
    return ragSchemaPromises.get(db);
  }

  const runSql = async (sql) => {
    if (typeof db.run === 'function') {
      return db.run(sql);
    }
    if (typeof db.exec === 'function') {
      return db.exec(sql);
    }
  };

  const promise = (async () => {
    let pgVectorSupported = false;
    const statements = [
      `CREATE TABLE IF NOT EXISTS document_extraction_jobs (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UPLOADED',
        stage TEXT NOT NULL DEFAULT 'UPLOADED',
        kaie_stage TEXT DEFAULT 'PENDING',
        file_checksum TEXT,
        doc_version INTEGER NOT NULL DEFAULT 1,
        format TEXT,
        ocr_required INTEGER NOT NULL DEFAULT 0,
        ocr_applied INTEGER NOT NULL DEFAULT 0,
        pages_total INTEGER NOT NULL DEFAULT 0,
        pages_extracted INTEGER NOT NULL DEFAULT 0,
        chunks_total INTEGER NOT NULL DEFAULT 0,
        embeddings_total INTEGER NOT NULL DEFAULT 0,
        extraction_quality REAL DEFAULT 1.0,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        error_message TEXT,
        diagnostics_json TEXT,
        locked_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_doc_extraction_jobs_file_id ON document_extraction_jobs(file_id)`,
      `CREATE INDEX IF NOT EXISTS idx_doc_extraction_jobs_status ON document_extraction_jobs(status, updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_doc_extraction_jobs_checksum ON document_extraction_jobs(file_checksum)`,
      `CREATE INDEX IF NOT EXISTS idx_doc_jobs_kaie_stage ON document_extraction_jobs(kaie_stage)`,

      `CREATE TABLE IF NOT EXISTS document_pages (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        doc_version INTEGER NOT NULL DEFAULT 1,
        page_number INTEGER NOT NULL,
        raw_text TEXT NOT NULL DEFAULT '',
        cleaned_text TEXT NOT NULL DEFAULT '',
        char_count INTEGER NOT NULL DEFAULT 0,
        is_empty INTEGER NOT NULL DEFAULT 0,
        is_scanned INTEGER NOT NULL DEFAULT 0,
        ocr_applied INTEGER NOT NULL DEFAULT 0,
        extraction_confidence REAL NOT NULL DEFAULT 1.0,
        headings_json TEXT DEFAULT '[]',
        tables_json TEXT DEFAULT '[]',
        sections_json TEXT DEFAULT '[]',
        diagrams_json TEXT DEFAULT '[]',
        equations_json TEXT DEFAULT '[]',
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(file_id, doc_version, page_number)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_document_pages_file_id ON document_pages(file_id, doc_version, page_number)`,

      `CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        doc_version INTEGER NOT NULL DEFAULT 1,
        chunk_index INTEGER NOT NULL,
        parent_chunk_id TEXT,
        chunk_level TEXT NOT NULL DEFAULT 'child',
        page_start INTEGER,
        page_end INTEGER,
        chapter TEXT,
        unit TEXT,
        section_heading TEXT,
        heading_path TEXT,
        content TEXT NOT NULL,
        clean_content TEXT NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT NOT NULL,
        subject TEXT,
        subject_code TEXT,
        semester_no INTEGER,
        cohort_id INTEGER,
        audience_scope TEXT DEFAULT 'general',
        visibility TEXT DEFAULT 'students',
        uploaded_by TEXT,
        topics_json TEXT DEFAULT '[]',
        terminology_json TEXT DEFAULT '[]',
        has_table INTEGER NOT NULL DEFAULT 0,
        has_definition INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_document_chunks_file_id ON document_chunks(file_id, doc_version)`,
      `CREATE INDEX IF NOT EXISTS idx_document_chunks_parent ON document_chunks(parent_chunk_id)`,
      `CREATE INDEX IF NOT EXISTS idx_document_chunks_subject_sem ON document_chunks(subject, semester_no)`,
      `CREATE INDEX IF NOT EXISTS idx_document_chunks_level ON document_chunks(chunk_level, file_id)`,
      `CREATE INDEX IF NOT EXISTS idx_document_chunks_hash ON document_chunks(content_hash)`,

      `CREATE TABLE IF NOT EXISTS document_embeddings (
        chunk_id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        doc_version INTEGER NOT NULL DEFAULT 1,
        model_name TEXT NOT NULL,
        model_version TEXT NOT NULL DEFAULT '1',
        dimensions INTEGER NOT NULL DEFAULT 256,
        embedding_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_document_embeddings_file_id ON document_embeddings(file_id, doc_version)`,
      `CREATE INDEX IF NOT EXISTS idx_document_embeddings_model ON document_embeddings(model_name, model_version)`,
      `CREATE INDEX IF NOT EXISTS idx_document_embeddings_hash ON document_embeddings(content_hash, model_name)`,

      `CREATE TABLE IF NOT EXISTS syllabus_topic_embeddings (
        topic_key TEXT NOT NULL,
        model_name TEXT NOT NULL,
        model_version TEXT NOT NULL DEFAULT '1',
        subject TEXT NOT NULL,
        subject_code TEXT,
        semester_no INTEGER,
        unit_number INTEGER,
        topic_title TEXT NOT NULL,
        normalized_topic TEXT NOT NULL,
        dimensions INTEGER NOT NULL DEFAULT 256,
        embedding_json TEXT NOT NULL,
        content_hash TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (topic_key, model_name, model_version)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_syllabus_topic_embed_sub ON syllabus_topic_embeddings(subject, semester_no, model_name)`,

      `CREATE TABLE IF NOT EXISTS document_topic_metadata (
        file_id TEXT PRIMARY KEY,
        doc_version INTEGER NOT NULL DEFAULT 1,
        title TEXT,
        subject TEXT,
        subject_code TEXT,
        semester_no INTEGER,
        chapter TEXT,
        unit TEXT,
        section_headings_json TEXT DEFAULT '[]',
        main_topics_json TEXT DEFAULT '[]',
        subtopics_json TEXT DEFAULT '[]',
        terminology_json TEXT DEFAULT '[]',
        related_concepts_json TEXT DEFAULT '[]',
        summary TEXT DEFAULT '',
        learning_objectives_json TEXT DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0.8,
        provenance TEXT NOT NULL DEFAULT 'hybrid',
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_doc_topic_metadata_subject ON document_topic_metadata(subject, semester_no)`,

      `CREATE TABLE IF NOT EXISTS academic_knowledge_graph (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        subject_code TEXT,
        semester_no INTEGER,
        unit TEXT,
        chapter TEXT,
        topic TEXT NOT NULL,
        normalized_topic TEXT NOT NULL,
        subtopic TEXT,
        section_heading TEXT,
        relation_type TEXT DEFAULT 'COVERS_TOPIC',
        file_id TEXT,
        chunk_id TEXT,
        page_number INTEGER,
        page_start INTEGER,
        page_end INTEGER,
        review_status TEXT DEFAULT 'AUTO_APPROVED',
        confidence REAL NOT NULL DEFAULT 0.8,
        provenance TEXT NOT NULL DEFAULT 'syllabus_and_document',
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_akg_normalized_topic ON academic_knowledge_graph(normalized_topic)`,
      `CREATE INDEX IF NOT EXISTS idx_akg_subject_sem ON academic_knowledge_graph(subject, semester_no)`,
      `CREATE INDEX IF NOT EXISTS idx_akg_file_id ON academic_knowledge_graph(file_id)`,

      `CREATE TABLE IF NOT EXISTS document_index_versions (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        doc_version INTEGER NOT NULL,
        file_checksum TEXT NOT NULL,
        status TEXT NOT NULL,
        pages_count INTEGER NOT NULL DEFAULT 0,
        chunks_count INTEGER NOT NULL DEFAULT 0,
        embedding_model TEXT,
        indexed_at TEXT NOT NULL,
        UNIQUE(file_id, doc_version)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_doc_index_versions_file ON document_index_versions(file_id, doc_version DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_doc_index_versions_checksum ON document_index_versions(file_checksum)`,

      `CREATE TABLE IF NOT EXISTS pyq_papers (
        id TEXT PRIMARY KEY,
        file_id INTEGER,
        subject TEXT NOT NULL,
        subject_code TEXT,
        semester_no INTEGER NOT NULL,
        exam_year TEXT NOT NULL,
        exam_type TEXT NOT NULL DEFAULT 'Final Exam',
        university TEXT NOT NULL DEFAULT 'Gandaki University',
        title TEXT NOT NULL,
        total_marks INTEGER DEFAULT 100,
        pass_marks INTEGER DEFAULT 40,
        questions_count INTEGER NOT NULL DEFAULT 0,
        extraction_status TEXT NOT NULL DEFAULT 'INDEXED',
        paper_fingerprint TEXT,
        uploaded_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_pyq_papers_sub_sem ON pyq_papers(subject, semester_no)`,
      `CREATE INDEX IF NOT EXISTS idx_pyq_papers_code ON pyq_papers(subject_code, semester_no)`,
      `CREATE INDEX IF NOT EXISTS idx_pyq_papers_fp ON pyq_papers(paper_fingerprint)`,

      `CREATE TABLE IF NOT EXISTS pyq_questions (
        id TEXT PRIMARY KEY,
        paper_id TEXT NOT NULL,
        file_id INTEGER,
        subject TEXT NOT NULL,
        subject_code TEXT,
        semester_no INTEGER NOT NULL,
        exam_year TEXT NOT NULL,
        exam_type TEXT NOT NULL DEFAULT 'Final Exam',
        section_label TEXT,
        question_number TEXT NOT NULL,
        question_text TEXT NOT NULL,
        clean_question_text TEXT NOT NULL,
        marks INTEGER DEFAULT 5,
        unit_number INTEGER,
        chapter_title TEXT,
        primary_topic TEXT,
        normalized_topic TEXT,
        difficulty TEXT DEFAULT 'medium',
        question_category TEXT DEFAULT 'theory',
        model_answer_hint TEXT,
        page_number INTEGER DEFAULT 1,
        page_end INTEGER,
        page_provenance_status TEXT DEFAULT 'verified',
        mapping_confidence TEXT DEFAULT 'high',
        mapping_status TEXT DEFAULT 'AUTO_CONFIRMED',
        semantic_score REAL DEFAULT 0.0,
        lexical_score REAL DEFAULT 0.0,
        content_fingerprint TEXT,
        subparts_json TEXT DEFAULT '[]',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_pyq_questions_sub_unit ON pyq_questions(subject, semester_no, unit_number)`,
      `CREATE INDEX IF NOT EXISTS idx_pyq_questions_norm_topic ON pyq_questions(normalized_topic)`,
      `CREATE INDEX IF NOT EXISTS idx_pyq_questions_paper ON pyq_questions(paper_id)`,

      `CREATE TABLE IF NOT EXISTS pyq_topic_links (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        subject_code TEXT,
        semester_no INTEGER,
        unit_number INTEGER,
        topic TEXT NOT NULL,
        normalized_topic TEXT NOT NULL,
        note_file_id TEXT,
        note_chunk_id TEXT,
        note_page_number INTEGER,
        relevance_score REAL NOT NULL DEFAULT 0.85,
        mapping_confidence TEXT DEFAULT 'high',
        mapping_status TEXT DEFAULT 'AUTO_CONFIRMED',
        semantic_score REAL DEFAULT 0.0,
        lexical_score REAL DEFAULT 0.0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_pyq_links_question ON pyq_topic_links(question_id)`,
      `CREATE INDEX IF NOT EXISTS idx_pyq_links_topic ON pyq_topic_links(normalized_topic, subject)`,

      `CREATE TABLE IF NOT EXISTS study_partner_sessions (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        conversation_id TEXT,
        subject TEXT NOT NULL,
        subject_code TEXT,
        semester_no INTEGER NOT NULL,
        unit_number INTEGER,
        chapter_title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        pedagogical_stage TEXT NOT NULL DEFAULT 'TEACHING',
        current_step_index INTEGER NOT NULL DEFAULT 1,
        total_steps INTEGER NOT NULL DEFAULT 1,
        mastered_steps INTEGER NOT NULL DEFAULT 0,
        reconciled_plan_json TEXT NOT NULL DEFAULT '[]',
        source_files_json TEXT NOT NULL DEFAULT '[]',
        pyq_summary_json TEXT NOT NULL DEFAULT '{}',
        last_interaction_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_study_sessions_student ON study_partner_sessions(student_id, status, updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_study_sessions_conv ON study_partner_sessions(conversation_id, status)`,

      `CREATE TABLE IF NOT EXISTS study_partner_topic_progress (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        topic_title TEXT NOT NULL,
        normalized_topic TEXT NOT NULL,
        source_origin TEXT NOT NULL DEFAULT 'syllabus_and_note',
        syllabus_ref TEXT,
        note_citations_json TEXT DEFAULT '[]',
        pyq_matches_json TEXT DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'PENDING',
        checkpoint_question TEXT,
        student_last_answer TEXT,
        attempts_count INTEGER NOT NULL DEFAULT 0,
        mastered_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(session_id, step_index)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_study_topic_progress_session ON study_partner_topic_progress(session_id, step_index)`,
      `CREATE INDEX IF NOT EXISTS idx_study_topic_progress_student ON study_partner_topic_progress(student_id, normalized_topic)`,

      `CREATE TABLE IF NOT EXISTS course_syllabus_units (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        subject_code TEXT,
        semester_no INTEGER NOT NULL,
        unit_number INTEGER NOT NULL,
        unit_title TEXT NOT NULL,
        teaching_hours INTEGER DEFAULT 0,
        source_origin TEXT NOT NULL DEFAULT 'official_syllabus',
        syllabus_file_id TEXT,
        total_topics INTEGER NOT NULL DEFAULT 0,
        covered_topics INTEGER NOT NULL DEFAULT 0,
        pyq_questions_count INTEGER NOT NULL DEFAULT 0,
        coverage_ratio REAL NOT NULL DEFAULT 0.0,
        updated_at TEXT NOT NULL,
        UNIQUE(subject, semester_no, unit_number)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_course_syllabus_units_sub_sem ON course_syllabus_units(subject, semester_no, unit_number)`,
      `CREATE INDEX IF NOT EXISTS idx_course_syllabus_units_code ON course_syllabus_units(subject_code, semester_no)`,

      `CREATE TABLE IF NOT EXISTS course_syllabus_topics (
        id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        subject_code TEXT,
        semester_no INTEGER NOT NULL,
        unit_number INTEGER NOT NULL,
        step_index INTEGER NOT NULL,
        topic_code TEXT,
        topic_title TEXT NOT NULL,
        normalized_topic TEXT NOT NULL,
        parent_topic_id TEXT,
        origin_type TEXT NOT NULL DEFAULT 'official_syllabus',
        source_origin TEXT NOT NULL DEFAULT 'syllabus_only',
        coverage_status TEXT NOT NULL DEFAULT 'MISSING_NOTES',
        prerequisite_topic_ids_json TEXT DEFAULT '[]',
        curriculum_version INTEGER NOT NULL DEFAULT 1,
        is_locked_by_teacher INTEGER NOT NULL DEFAULT 0,
        has_notes INTEGER NOT NULL DEFAULT 0,
        has_practical INTEGER NOT NULL DEFAULT 0,
        has_pyq INTEGER NOT NULL DEFAULT 0,
        note_chunks_count INTEGER NOT NULL DEFAULT 0,
        practical_chunks_count INTEGER NOT NULL DEFAULT 0,
        pyq_count INTEGER NOT NULL DEFAULT 0,
        exam_weight_score REAL NOT NULL DEFAULT 0.0,
        updated_at TEXT NOT NULL,
        UNIQUE(unit_id, step_index)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_course_syllabus_topics_unit ON course_syllabus_topics(unit_id, step_index)`,
      `CREATE INDEX IF NOT EXISTS idx_course_syllabus_topics_sub_unit ON course_syllabus_topics(subject, semester_no, unit_number)`,
      `CREATE INDEX IF NOT EXISTS idx_course_syllabus_topics_norm ON course_syllabus_topics(normalized_topic)`,

      `CREATE TABLE IF NOT EXISTS topic_source_mappings (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        semester_no INTEGER NOT NULL,
        cohort_id TEXT,
        unit_number INTEGER NOT NULL,
        normalized_topic TEXT NOT NULL,
        source_type TEXT NOT NULL,
        file_id TEXT,
        file_title TEXT,
        chunk_id TEXT,
        extracted_item_id TEXT,
        pyq_question_id TEXT,
        page_start INTEGER,
        page_end INTEGER,
        section_heading TEXT,
        relevance_score REAL NOT NULL DEFAULT 0.85,
        review_status TEXT NOT NULL DEFAULT 'AUTO_APPROVED',
        conflict_status TEXT NOT NULL DEFAULT 'NONE',
        curriculum_version INTEGER NOT NULL DEFAULT 1,
        snippet TEXT DEFAULT '',
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_topic_source_mappings_topic ON topic_source_mappings(topic_id, source_type)`,
      `CREATE INDEX IF NOT EXISTS idx_topic_source_mappings_file ON topic_source_mappings(file_id)`,
      `CREATE INDEX IF NOT EXISTS idx_topic_source_mappings_sub_unit ON topic_source_mappings(subject, semester_no, unit_number)`,

      `CREATE TABLE IF NOT EXISTS academic_extracted_items (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        doc_version INTEGER NOT NULL DEFAULT 1,
        chunk_id TEXT,
        course_code TEXT,
        subject TEXT NOT NULL,
        subject_code TEXT,
        semester_no INTEGER,
        cohort_id TEXT,
        unit_number INTEGER,
        chapter TEXT,
        topic TEXT,
        normalized_topic TEXT,
        topic_id TEXT,
        item_type TEXT NOT NULL,
        concept_key TEXT NOT NULL,
        title TEXT,
        content_text TEXT NOT NULL,
        structured_json TEXT DEFAULT '{}',
        page_start INTEGER NOT NULL DEFAULT 1,
        page_end INTEGER NOT NULL DEFAULT 1,
        confidence REAL NOT NULL DEFAULT 0.85,
        provenance TEXT DEFAULT 'document_extracted',
        created_at TEXT NOT NULL,
        updated_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_aei_file ON academic_extracted_items(file_id, doc_version)`,
      `CREATE INDEX IF NOT EXISTS idx_aei_topic ON academic_extracted_items(subject, semester_no, unit_number, item_type)`,
      `CREATE INDEX IF NOT EXISTS idx_aei_concept ON academic_extracted_items(subject, concept_key)`,

      `CREATE TABLE IF NOT EXISTS kaie_teacher_review_queue (
        id TEXT PRIMARY KEY,
        course_code TEXT,
        subject TEXT NOT NULL,
        subject_code TEXT,
        semester_no INTEGER,
        cohort_id TEXT,
        unit_number INTEGER,
        review_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        candidate_topic_id TEXT,
        topic_title TEXT,
        extracted_concept TEXT,
        concept_key TEXT,
        primary_file_id TEXT NOT NULL,
        primary_file_title TEXT,
        primary_page_start INTEGER,
        secondary_file_id TEXT,
        secondary_file_title TEXT,
        secondary_page_start INTEGER,
        evidence_summary TEXT NOT NULL,
        payload_json TEXT DEFAULT '{}',
        confidence REAL DEFAULT 0.5,
        resolved_by_user_id TEXT,
        resolution_note TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ktrq_course_status ON kaie_teacher_review_queue(subject, semester_no, status)`,
      `CREATE INDEX IF NOT EXISTS idx_ktrq_primary_file ON kaie_teacher_review_queue(primary_file_id)`
    ];

    for (const sql of statements) {
      try {
        await runSql(sql);
      } catch (_) {}
    }

    const columnsToEnsure = [
      `ALTER TABLE files ADD COLUMN semester_no INTEGER`,
      `ALTER TABLE files ADD COLUMN cohort_id TEXT`,
      `ALTER TABLE files ADD COLUMN audience_scope TEXT DEFAULT 'all_students'`,
      `ALTER TABLE files ADD COLUMN visibility TEXT DEFAULT 'everyone'`,
      `ALTER TABLE files ADD COLUMN resource_category TEXT DEFAULT 'lecture_notes'`,
      `ALTER TABLE files ADD COLUMN unit_number INTEGER`,
      `ALTER TABLE document_extraction_jobs ADD COLUMN kaie_stage TEXT DEFAULT 'PENDING'`,
      `ALTER TABLE document_pages ADD COLUMN diagrams_json TEXT DEFAULT '[]'`,
      `ALTER TABLE document_pages ADD COLUMN equations_json TEXT DEFAULT '[]'`,
      `ALTER TABLE academic_knowledge_graph ADD COLUMN relation_type TEXT DEFAULT 'COVERS_TOPIC'`,
      `ALTER TABLE academic_knowledge_graph ADD COLUMN page_start INTEGER`,
      `ALTER TABLE academic_knowledge_graph ADD COLUMN page_end INTEGER`,
      `ALTER TABLE academic_knowledge_graph ADD COLUMN review_status TEXT DEFAULT 'AUTO_APPROVED'`,
      `ALTER TABLE course_syllabus_topics ADD COLUMN origin_type TEXT DEFAULT 'official_syllabus'`,
      `ALTER TABLE course_syllabus_topics ADD COLUMN prerequisite_topic_ids_json TEXT DEFAULT '[]'`,
      `ALTER TABLE course_syllabus_topics ADD COLUMN curriculum_version INTEGER DEFAULT 1`,
      `ALTER TABLE course_syllabus_topics ADD COLUMN is_locked_by_teacher INTEGER DEFAULT 0`,
      `ALTER TABLE topic_source_mappings ADD COLUMN cohort_id TEXT`,
      `ALTER TABLE topic_source_mappings ADD COLUMN extracted_item_id TEXT`,
      `ALTER TABLE topic_source_mappings ADD COLUMN review_status TEXT DEFAULT 'AUTO_APPROVED'`,
      `ALTER TABLE topic_source_mappings ADD COLUMN conflict_status TEXT DEFAULT 'NONE'`,
      `ALTER TABLE topic_source_mappings ADD COLUMN curriculum_version INTEGER DEFAULT 1`,
      `ALTER TABLE academic_extracted_items ADD COLUMN course_code TEXT`,
      `ALTER TABLE academic_extracted_items ADD COLUMN chapter TEXT`,
      `ALTER TABLE academic_extracted_items ADD COLUMN topic TEXT`,
      `ALTER TABLE academic_extracted_items ADD COLUMN normalized_topic TEXT`,
      `ALTER TABLE academic_extracted_items ADD COLUMN provenance TEXT DEFAULT 'document_extracted'`,
      `ALTER TABLE academic_extracted_items ADD COLUMN updated_at TEXT`,
      `ALTER TABLE kaie_teacher_review_queue ADD COLUMN course_code TEXT`,
      `ALTER TABLE kaie_teacher_review_queue ADD COLUMN extracted_concept TEXT`,
      `ALTER TABLE kaie_teacher_review_queue ADD COLUMN payload_json TEXT DEFAULT '{}'`,
      `ALTER TABLE kaie_teacher_review_queue ADD COLUMN updated_at TEXT`,
      `ALTER TABLE pyq_papers ADD COLUMN paper_fingerprint TEXT`,
      `ALTER TABLE pyq_questions ADD COLUMN page_end INTEGER`,
      `ALTER TABLE pyq_questions ADD COLUMN page_provenance_status TEXT DEFAULT 'verified'`,
      `ALTER TABLE pyq_questions ADD COLUMN mapping_confidence TEXT DEFAULT 'high'`,
      `ALTER TABLE pyq_questions ADD COLUMN mapping_status TEXT DEFAULT 'AUTO_CONFIRMED'`,
      `ALTER TABLE pyq_questions ADD COLUMN semantic_score REAL DEFAULT 0.0`,
      `ALTER TABLE pyq_questions ADD COLUMN lexical_score REAL DEFAULT 0.0`,
      `ALTER TABLE pyq_questions ADD COLUMN content_fingerprint TEXT`,
      `ALTER TABLE pyq_questions ADD COLUMN subparts_json TEXT DEFAULT '[]'`,
      `ALTER TABLE pyq_topic_links ADD COLUMN mapping_confidence TEXT DEFAULT 'high'`,
      `ALTER TABLE pyq_topic_links ADD COLUMN mapping_status TEXT DEFAULT 'AUTO_CONFIRMED'`,
      `ALTER TABLE pyq_topic_links ADD COLUMN semantic_score REAL DEFAULT 0.0`,
      `ALTER TABLE pyq_topic_links ADD COLUMN lexical_score REAL DEFAULT 0.0`,
      `ALTER TABLE syllabus_topic_embeddings ADD COLUMN content_hash TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_files_category ON files(resource_category)`,
      `CREATE INDEX IF NOT EXISTS idx_doc_jobs_kaie_stage ON document_extraction_jobs(kaie_stage)`,
      `CREATE INDEX IF NOT EXISTS idx_pyq_papers_fp ON pyq_papers(paper_fingerprint)`
    ];
    for (const alterSql of columnsToEnsure) {
      try {
        await runSql(alterSql);
      } catch (_) {}
    }

    if (db.dialect === 'postgres' || db.isPostgres) {
      try {
        await runSql(`
          CREATE INDEX IF NOT EXISTS idx_document_chunks_fts
          ON document_chunks
          USING GIN (to_tsvector('english', COALESCE(section_heading, '') || ' ' || COALESCE(clean_content, '')))
        `);
      } catch (_) {}

      try {
        await runSql(`CREATE EXTENSION IF NOT EXISTS vector`);
        await runSql(`ALTER TABLE document_embeddings ADD COLUMN IF NOT EXISTS embedding_vector vector(768)`);
        pgVectorSupported = true;
      } catch (_) {
        pgVectorSupported = false;
      }
    }

    pgVectorSupportMap.set(db, pgVectorSupported);
    return { ok: true, pgVectorSupported };
  })().catch((err) => {
    ragSchemaPromises.delete(db);
    throw err;
  });

  ragSchemaPromises.set(db, promise);
  return promise;
}

function resetRagSchemaCache(db) {
  if (db) {
    ragSchemaPromises.delete(db);
    pgVectorSupportMap.delete(db);
  }
}

module.exports = {
  ensureRagSchema,
  resetRagSchemaCache,
  isPgVectorSupported: (db) => (db ? Boolean(pgVectorSupportMap.get(db)) : false)
};
